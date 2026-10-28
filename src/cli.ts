import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';
import { analyzeProduct, type AnalyzeOptions, type Analysis } from './analyze.js';
import { AUDIT_QUESTIONS, AUDIT_TOTAL_WEIGHT } from './audit.js';
import { buildCatalog, indexProducts, readCatalogFile } from './catalog.js';
import { scanBarcode } from './barcode.js';
import { compareProducts } from './compare.js';
import { DataError, UsageError } from './errors.js';
import { fetchRepairers } from './overpass.js';
import { refreshCatalog } from './refresh.js';
import { renderReport } from './report.js';
import { searchProducts } from './search.js';
import { bandLabel, money, moneyPrecise, pad, scoreLine } from './text.js';
import { CATEGORY_LABEL, type CatalogFile, type Category, type Product } from './types.js';
import { parseNumberFlag } from './util.js';

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

const consoleIo: CliIo = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
};

const DEFAULT_DATA = 'data/products.json';
const DEFAULT_OUT = 'web/catalog.json';
const DEFAULT_CACHE = '.cache/overpass';

type FlagSpec = Record<string, 'string' | 'boolean'>;
type Values = Record<string, string | boolean | undefined>;

function parseFlags(args: string[], spec: FlagSpec): { values: Values; positionals: string[] } {
  // parseArgs reads "--lat -33.7" as an option, not a value. Join the two
  // tokens when the value looks like a negative number.
  const merged: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] as string;
    const next = args[index + 1];
    if (/^--[a-z][a-z-]*$/.test(token) && next !== undefined && /^-\d/.test(next)) {
      merged.push(`${token}=${next}`);
      index += 1;
    } else {
      merged.push(token);
    }
  }

  try {
    const options: ParseArgsOptionsConfig = {};
    for (const [key, type] of Object.entries(spec)) options[key] = { type };
    const parsed = parseArgs({
      args: merged,
      options,
      allowPositionals: true,
      strict: true,
    });
    return { values: parsed.values as Values, positionals: parsed.positionals };
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
}

function text(values: Values, key: string): string | undefined {
  const value = values[key];
  return typeof value === 'string' ? value : undefined;
}

function numberFlag(values: Values, key: string): number | undefined {
  return parseNumberFlag(text(values, key), key) ?? undefined;
}

function categoryFlag(values: Values): Category | undefined {
  const value = text(values, 'category');
  if (value === undefined) return undefined;
  if (!['phone', 'laptop', 'washer'].includes(value)) {
    throw new UsageError('--category must be phone, laptop or washer');
  }
  return value as Category;
}

function analyzeOptions(values: Values): AnalyzeOptions {
  const options: AnalyzeOptions = {};
  const price = numberFlag(values, 'price');
  const tariff = numberFlag(values, 'tariff');
  const kwh = numberFlag(values, 'kwh');
  const events = numberFlag(values, 'events');
  const age = numberFlag(values, 'age');
  if (price !== undefined) options.price = price;
  if (tariff !== undefined) options.tariffAud = tariff;
  if (kwh !== undefined) options.annualKwh = kwh;
  if (events !== undefined) options.repairEvents = events;
  if (age !== undefined) options.ageYears = age;
  return options;
}

async function readCatalog(dataPath: string): Promise<CatalogFile> {
  return readCatalogFile(resolve(dataPath));
}

function findProduct(catalog: CatalogFile, id: string): Product {
  const product = catalog.products.find((entry) => entry.id === id);
  if (!product) {
    throw new UsageError(`No product with id "${id}". Try: longevity search <query>`);
  }
  return product;
}

function productLines(analysis: Analysis): string[] {
  const { product, score, lifeCost, decision } = analysis;
  const lines: string[] = [];
  lines.push(product.name);
  lines.push(`${product.brand} ${product.model} - ${CATEGORY_LABEL[product.category]}`);
  lines.push('');
  lines.push(`Score: ${scoreLine(score)}`);
  for (const part of score.parts) {
    const value = part.value === null ? 'no data' : `${part.value}/100`;
    lines.push(`  ${pad(part.label, 8)} ${pad(value, 9)} weight ${part.weight}%  ${part.detail}`);
  }
  lines.push('');
  lines.push(
    `Life cost: ${money(lifeCost.perYear)} per year over ${lifeCost.lifeYears} years (total ${money(lifeCost.total)})`,
  );
  lines.push(
    `  Purchase ${money(lifeCost.purchase)} / Repairs ${money(lifeCost.repairs)} / Energy ${money(lifeCost.energy)}${
      lifeCost.energyKnown ? '' : ' (no energy value)'
    }`,
  );
  if (decision) {
    lines.push('');
    lines.push(
      `Repair or replace: ${decision.verdict} (ratio ${decision.ratio}). Repair ${money(decision.repairPerYear)}/yr vs replace ${money(decision.replacePerYear)}/yr, ${decision.remainingYears} years left.`,
    );
  }
  lines.push('');
  lines.push(`Data reviewed ${product.updatedAt}. Prices are estimates.`);
  return lines;
}

function printProduct(analysis: Analysis, io: CliIo): void {
  for (const line of productLines(analysis)) io.out(line);
}

async function cmdBuild(args: string[], io: CliIo): Promise<number> {
  const { values } = parseFlags(args, { data: 'string', out: 'string' });
  const catalog = await readCatalog(text(values, 'data') ?? DEFAULT_DATA);
  const outPath = resolve(text(values, 'out') ?? DEFAULT_OUT);
  const built = buildCatalog(catalog);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(built, null, 2)}\n`, 'utf8');
  io.out(`Wrote ${built.products.length} products to ${outPath}`);
  return 0;
}

async function cmdSearch(args: string[], io: CliIo): Promise<number> {
  const { values, positionals } = parseFlags(args, {
    data: 'string',
    category: 'string',
    json: 'boolean',
    limit: 'string',
  });
  const query = positionals.join(' ').trim();
  if (query === '') throw new UsageError('Usage: longevity search <query>');
  const catalog = await readCatalog(text(values, 'data') ?? DEFAULT_DATA);
  const limit = numberFlag(values, 'limit') ?? 10;
  const hits = searchProducts(catalog.products, query, {
    category: categoryFlag(values),
    limit,
  });

  if (values['json']) {
    io.out(
      JSON.stringify(
        hits.map((hit) => {
          const analysis = analyzeProduct(hit.product, {}, catalog.tariffAud);
          return {
            id: hit.product.id,
            name: hit.product.name,
            brand: hit.product.brand,
            category: hit.product.category,
            rank: hit.rank,
            score: analysis.score.score,
            perYear: analysis.lifeCost.perYear,
          };
        }),
        null,
        2,
      ),
    );
    return 0;
  }

  if (hits.length === 0) {
    io.out(`No products match "${query}".`);
    return 0;
  }
  hits.forEach((hit, index) => {
    const analysis = analyzeProduct(hit.product, {}, catalog.tariffAud);
    io.out(
      `${index + 1}. ${hit.product.name} (${hit.product.id}) - ${scoreLine(analysis.score)} - ${money(analysis.lifeCost.perYear)}/yr`,
    );
  });
  return 0;
}

async function cmdShow(args: string[], io: CliIo): Promise<number> {
  const { values, positionals } = parseFlags(args, {
    data: 'string',
    price: 'string',
    tariff: 'string',
    kwh: 'string',
    events: 'string',
    age: 'string',
    json: 'boolean',
  });
  const id = positionals[0];
  if (!id) throw new UsageError('Usage: longevity show <id>');
  const catalog = await readCatalog(text(values, 'data') ?? DEFAULT_DATA);
  const product = findProduct(catalog, id);
  const analysis = analyzeProduct(product, analyzeOptions(values), catalog.tariffAud);
  if (values['json']) {
    io.out(JSON.stringify(analysis, null, 2));
    return 0;
  }
  printProduct(analysis, io);
  return 0;
}

async function cmdScan(args: string[], io: CliIo): Promise<number> {
  const { values, positionals } = parseFlags(args, {
    data: 'string',
    remote: 'boolean',
    json: 'boolean',
  });
  const code = positionals[0];
  if (!code) throw new UsageError('Usage: longevity scan <code>');
  const catalog = await readCatalog(text(values, 'data') ?? DEFAULT_DATA);
  const result = await scanBarcode(code, indexProducts(catalog.products), {
    remote: Boolean(values['remote']),
  });
  if (values['json']) {
    io.out(JSON.stringify(result, null, 2));
    return 0;
  }
  io.out(result.message);
  if (result.product) {
    io.out('');
    printProduct(analyzeProduct(result.product, {}, catalog.tariffAud), io);
  }
  return 0;
}

async function cmdCompare(args: string[], io: CliIo): Promise<number> {
  const { values, positionals } = parseFlags(args, { data: 'string', json: 'boolean' });
  if (positionals.length < 2) throw new UsageError('Usage: longevity compare <id...>');
  const catalog = await readCatalog(text(values, 'data') ?? DEFAULT_DATA);
  const products = positionals.map((id) => findProduct(catalog, id));
  const rows = compareProducts(products, catalog.tariffAud);
  if (values['json']) {
    io.out(
      JSON.stringify(
        rows.map((row) => ({
          id: row.product.id,
          name: row.product.name,
          score: row.score,
          coverage: row.coverage,
          lifeYears: row.lifeYears,
          total: row.total,
          perYear: row.perYear,
          bestScore: row.bestScore,
          bestCost: row.bestCost,
        })),
        null,
        2,
      ),
    );
    return 0;
  }

  io.out(`${pad('ID', 24)}${pad('Score', 9)}${pad('Coverage', 10)}${pad('Life', 6)}${pad('Total', 12)}Per year`);
  for (const row of rows) {
    const marks = `${row.bestScore ? '*' : ' '}${row.bestCost ? '+' : ' '}`;
    io.out(
      `${pad(`${row.product.id}${marks}`, 24)}${pad(row.score === null ? '-' : String(row.score), 9)}${pad(`${row.coverage}%`, 10)}${pad(String(row.lifeYears), 6)}${pad(money(row.total), 12)}${money(row.perYear)}`,
    );
  }
  io.out('');
  io.out('* best score   + lowest cost per year');
  return 0;
}

async function cmdRepairers(args: string[], io: CliIo): Promise<number> {
  const { values } = parseFlags(args, {
    lat: 'string',
    lon: 'string',
    radius: 'string',
    fixture: 'boolean',
    json: 'boolean',
    cache: 'string',
  });
  const lat = numberFlag(values, 'lat');
  const lon = numberFlag(values, 'lon');
  if (lat === undefined || lon === undefined) {
    throw new UsageError('Usage: longevity repairers --lat N --lon N [--radius M]');
  }
  const result = await fetchRepairers({
    lat,
    lon,
    radiusM: numberFlag(values, 'radius') ?? 5000,
    cacheDir: resolve(text(values, 'cache') ?? DEFAULT_CACHE),
    ...(values['fixture'] ? { fixturePath: resolve('fixtures/repairers.json') } : {}),
  });

  if (values['json']) {
    io.out(JSON.stringify(result, null, 2));
    return 0;
  }
  io.out(`Repairers within ${numberFlag(values, 'radius') ?? 5000} m (${result.source})`);
  if (result.note) io.out(result.note);
  if (result.repairers.length === 0) {
    io.out('No repairers found.');
    return 0;
  }
  for (const repairer of result.repairers) {
    const km = (repairer.distanceM / 1000).toFixed(1);
    io.out(`  ${repairer.name} - ${repairer.kind}, ${km} km${repairer.address ? `, ${repairer.address}` : ''}`);
  }
  return 0;
}

async function cmdReport(args: string[], io: CliIo): Promise<number> {
  const { values, positionals } = parseFlags(args, {
    data: 'string',
    out: 'string',
    price: 'string',
    tariff: 'string',
    kwh: 'string',
    events: 'string',
    age: 'string',
    lat: 'string',
    lon: 'string',
    radius: 'string',
  });
  const id = positionals[0];
  if (!id) throw new UsageError('Usage: longevity report <id> [--out FILE]');
  const catalog = await readCatalog(text(values, 'data') ?? DEFAULT_DATA);
  const product = findProduct(catalog, id);
  const analysis = analyzeProduct(product, analyzeOptions(values), catalog.tariffAud);

  const lat = numberFlag(values, 'lat');
  const lon = numberFlag(values, 'lon');
  let repairers;
  if (lat !== undefined && lon !== undefined) {
    const result = await fetchRepairers({
      lat,
      lon,
      radiusM: numberFlag(values, 'radius') ?? 5000,
      cacheDir: resolve(DEFAULT_CACHE),
    });
    repairers = result.repairers;
  }

  const html = renderReport(analysis, { repairers });
  const outPath = resolve(text(values, 'out') ?? `reports/${product.id}.html`);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, html, 'utf8');
  io.out(`Wrote ${outPath}`);
  return 0;
}

async function cmdAudit(args: string[], io: CliIo): Promise<number> {
  const { values } = parseFlags(args, { json: 'boolean' });
  if (values['json']) {
    io.out(JSON.stringify({ total: AUDIT_TOTAL_WEIGHT, questions: AUDIT_QUESTIONS }, null, 2));
    return 0;
  }
  io.out(`Self-audit questions (total ${AUDIT_TOTAL_WEIGHT})`);
  for (const question of AUDIT_QUESTIONS) {
    io.out(`  [${String(question.weight).padStart(2)}] ${question.id}: ${question.text}`);
  }
  io.out('');
  io.out('An unanswered question counts as no.');
  return 0;
}

async function cmdRefresh(args: string[], io: CliIo): Promise<number> {
  const { values } = parseFlags(args, {
    data: 'string',
    out: 'string',
    dryRun: 'boolean',
    delay: 'string',
    only: 'string',
  });
  const only = text(values, 'only');
  const result = await refreshCatalog({
    dataPath: resolve(text(values, 'data') ?? DEFAULT_DATA),
    ...(text(values, 'out') ? { outPath: resolve(text(values, 'out') as string) } : {}),
    dryRun: Boolean(values['dryRun']),
    delayMs: numberFlag(values, 'delay') ?? 450,
    ...(only ? { only: only.split(',').map((id) => id.trim()).filter(Boolean) } : {}),
  });

  io.out(`Updated: ${result.updated.length}${result.updated.length ? ` (${result.updated.join(', ')})` : ''}`);
  io.out(`Unchanged: ${result.unchanged.length}`);
  io.out(`Skipped: ${result.skipped.length}`);
  if (result.failures.length > 0) {
    io.out(`Failures: ${result.failures.length}`);
    for (const failure of result.failures) io.out(`  ${failure.id}: ${failure.error}`);
  }
  io.out(result.written ? 'Catalog written.' : 'Catalog not written.');
  return result.failures.length > 0 ? 1 : 0;
}

async function cmdDemo(args: string[], io: CliIo): Promise<number> {
  const { values } = parseFlags(args, { data: 'string', json: 'boolean' });
  const catalog = await readCatalog(text(values, 'data') ?? DEFAULT_DATA);
  const scored = catalog.products
    .map((product) => analyzeProduct(product, {}, catalog.tariffAud))
    .sort((a, b) => (b.score.score ?? -1) - (a.score.score ?? -1));

  if (values['json']) {
    io.out(
      JSON.stringify(
        scored.slice(0, 3).map((analysis) => ({
          id: analysis.product.id,
          name: analysis.product.name,
          score: analysis.score.score,
          band: bandLabel(analysis.score.band),
          perYear: analysis.lifeCost.perYear,
        })),
        null,
        2,
      ),
    );
    return 0;
  }

  io.out('Longevity demo - no network needed');
  io.out(`Catalog: ${catalog.products.length} products, tariff ${moneyPrecise(catalog.tariffAud)}/kWh`);
  io.out('');
  const top = scored[0];
  if (!top) {
    io.out('The catalog is empty.');
    return 0;
  }
  printProduct(top, io);
  io.out('');
  io.out('Top three by score:');
  for (const analysis of scored.slice(0, 3)) {
    io.out(`  ${pad(analysis.product.name, 28)} ${scoreLine(analysis.score)}  ${money(analysis.lifeCost.perYear)}/yr`);
  }
  return 0;
}

function printHelp(io: CliIo): void {
  io.out(`longevity - repairability scanner for household products

Usage:
  longevity build [--data FILE] [--out FILE]
  longevity search <query> [--category phone|laptop|washer] [--limit N] [--json]
  longevity show <id> [--price N] [--tariff N] [--kwh N] [--events N] [--age N] [--json]
  longevity scan <code> [--remote] [--json]
  longevity compare <id...> [--json]
  longevity repairers --lat N --lon N [--radius M] [--fixture] [--json]
  longevity report <id> [--out FILE] [--age N] [--lat N --lon N]
  longevity audit [--json]
  longevity refresh [--dry-run] [--only id,id] [--delay MS]
  longevity demo [--json]

Exit codes: 0 ok, 1 runtime error, 2 usage or bad input, 3 data error.`);
}

export async function runCli(argv: string[], io: CliIo = consoleIo): Promise<number> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case 'build':
        return await cmdBuild(rest, io);
      case 'search':
        return await cmdSearch(rest, io);
      case 'show':
        return await cmdShow(rest, io);
      case 'scan':
        return await cmdScan(rest, io);
      case 'compare':
        return await cmdCompare(rest, io);
      case 'repairers':
        return await cmdRepairers(rest, io);
      case 'report':
        return await cmdReport(rest, io);
      case 'audit':
        return await cmdAudit(rest, io);
      case 'refresh':
        return await cmdRefresh(rest, io);
      case 'demo':
        return await cmdDemo(rest, io);
      case 'help':
      case '--help':
      case '-h':
        printHelp(io);
        return 0;
      case undefined:
        printHelp(io);
        return 2;
      default:
        throw new UsageError(`Unknown command "${command}". Run longevity help.`);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`Error: ${error.message}`);
      return 2;
    }
    if (error instanceof DataError) {
      io.err(`Error: ${error.message}`);
      return 3;
    }
    io.err(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}