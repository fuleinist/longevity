import { readFile } from 'node:fs/promises';
import { CATEGORIES, type Catalog, type CatalogFile, type Category, type Product } from './types.js';
import { DataError } from './errors.js';
import { isHttpUrl, isIsoDate, slug } from './util.js';

const ALLOWED_KEYS = new Set([
  'version',
  'tariffAud',
  'products',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: unknown, path: string, problems: string[]): string {
  if (typeof value !== 'string' || value.trim() === '') {
    problems.push(`${path} must be a non-empty string`);
    return '';
  }
  return value.trim();
}

function finiteNumber(value: unknown, path: string, problems: string[]): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push(`${path} must be a finite number`);
    return 0;
  }
  return value;
}

function validateProduct(raw: unknown, index: number, problems: string[]): Product | null {
  const path = `products[${index}]`;
  if (!isRecord(raw)) {
    problems.push(`${path} must be an object`);
    return null;
  }

  const id = stringField(raw['id'], `${path}.id`, problems);
  if (id && slug(id) !== id) {
    problems.push(`${path}.id must be a lowercase slug`);
  }
  const brand = stringField(raw['brand'], `${path}.brand`, problems);
  const model = stringField(raw['model'], `${path}.model`, problems);
  const name = stringField(raw['name'], `${path}.name`, problems);

  const category = raw['category'];
  if (typeof category !== 'string' || !(CATEGORIES as readonly string[]).includes(category)) {
    problems.push(`${path}.category must be one of ${CATEGORIES.join(', ')}`);
  }

  const barcodesRaw = raw['barcodes'];
  const barcodes: string[] = [];
  if (barcodesRaw !== undefined) {
    if (!Array.isArray(barcodesRaw)) {
      problems.push(`${path}.barcodes must be an array`);
    } else {
      for (const [barcodeIndex, barcode] of barcodesRaw.entries()) {
        if (typeof barcode !== 'string' || !/^\d{8,14}$/.test(barcode)) {
          problems.push(`${path}.barcodes[${barcodeIndex}] must be 8 to 14 digits`);
        } else {
          barcodes.push(barcode);
        }
      }
    }
  }

  const priceRaw = raw['price'];
  let priceAmount = 0;
  let priceCheckedOn = '';
  let priceSourceUrl = '';
  let priceKind: 'street' | 'rrp' = 'street';
  let priceEstimate = true;
  if (!isRecord(priceRaw)) {
    problems.push(`${path}.price must be an object`);
  } else {
    priceAmount = finiteNumber(priceRaw['amount'], `${path}.price.amount`, problems);
    if (priceAmount <= 0) problems.push(`${path}.price.amount must be greater than 0`);
    priceCheckedOn = stringField(priceRaw['checkedOn'], `${path}.price.checkedOn`, problems);
    if (priceCheckedOn && !isIsoDate(priceCheckedOn)) {
      problems.push(`${path}.price.checkedOn must be YYYY-MM-DD`);
    }
    priceSourceUrl = stringField(priceRaw['sourceUrl'], `${path}.price.sourceUrl`, problems);
    if (priceSourceUrl && !isHttpUrl(priceSourceUrl)) {
      problems.push(`${path}.price.sourceUrl must be an http(s) URL`);
    }
    const kind = priceRaw['kind'];
    if (kind !== 'street' && kind !== 'rrp') {
      problems.push(`${path}.price.kind must be street or rrp`);
    } else {
      priceKind = kind;
    }
    if (priceRaw['estimate'] !== undefined && typeof priceRaw['estimate'] !== 'boolean') {
      problems.push(`${path}.price.estimate must be a boolean`);
    } else if (typeof priceRaw['estimate'] === 'boolean') {
      priceEstimate = priceRaw['estimate'];
    }
  }

  const repairCost = finiteNumber(raw['repairCost'], `${path}.repairCost`, problems);
  if (repairCost < 0) problems.push(`${path}.repairCost must be 0 or more`);
  const repairEvents = finiteNumber(raw['repairEvents'], `${path}.repairEvents`, problems);
  if (!Number.isInteger(repairEvents) || repairEvents < 0) {
    problems.push(`${path}.repairEvents must be a whole number, 0 or more`);
  }

  const sourcesRaw = raw['sources'];
  const sources: string[] = [];
  if (!Array.isArray(sourcesRaw) || sourcesRaw.length === 0) {
    problems.push(`${path}.sources must be a non-empty array`);
  } else {
    for (const [sourceIndex, source] of sourcesRaw.entries()) {
      if (typeof source !== 'string' || !isHttpUrl(source)) {
        problems.push(`${path}.sources[${sourceIndex}] must be an http(s) URL`);
      } else {
        sources.push(source);
      }
    }
  }

  const updatedAt = stringField(raw['updatedAt'], `${path}.updatedAt`, problems);
  if (updatedAt && !isIsoDate(updatedAt)) {
    problems.push(`${path}.updatedAt must be YYYY-MM-DD`);
  }

  let energy: Product['energy'];
  const energyRaw = raw['energy'];
  if (energyRaw !== undefined) {
    if (!isRecord(energyRaw)) {
      problems.push(`${path}.energy must be an object`);
    } else {
      const annualKwh = finiteNumber(energyRaw['annualKwh'], `${path}.energy.annualKwh`, problems);
      if (annualKwh <= 0) problems.push(`${path}.energy.annualKwh must be greater than 0`);
      const sourceUrl = stringField(energyRaw['sourceUrl'], `${path}.energy.sourceUrl`, problems);
      if (sourceUrl && !isHttpUrl(sourceUrl)) {
        problems.push(`${path}.energy.sourceUrl must be an http(s) URL`);
      }
      energy = { annualKwh, sourceUrl };
      if (typeof energyRaw['note'] === 'string') energy.note = energyRaw['note'];
    }
  }

  let ifixit: Product['ifixit'];
  const ifixitRaw = raw['ifixit'];
  if (ifixitRaw !== undefined) {
    if (!isRecord(ifixitRaw)) {
      problems.push(`${path}.ifixit must be an object`);
    } else {
      const wikiid = finiteNumber(ifixitRaw['wikiid'], `${path}.ifixit.wikiid`, problems);
      if (!Number.isInteger(wikiid) || wikiid <= 0) {
        problems.push(`${path}.ifixit.wikiid must be a positive whole number`);
      }
      const title = stringField(ifixitRaw['title'], `${path}.ifixit.title`, problems);
      const url = stringField(ifixitRaw['url'], `${path}.ifixit.url`, problems);
      if (url && !isHttpUrl(url)) problems.push(`${path}.ifixit.url must be an http(s) URL`);
      const scoreRaw = ifixitRaw['score'];
      let score: number | null = null;
      if (scoreRaw !== null) {
        const parsed = finiteNumber(scoreRaw, `${path}.ifixit.score`, problems);
        if (parsed < 0 || parsed > 10) problems.push(`${path}.ifixit.score must be 0 to 10`);
        score = parsed;
      }
      const guideCount = finiteNumber(ifixitRaw['guideCount'], `${path}.ifixit.guideCount`, problems);
      if (!Number.isInteger(guideCount) || guideCount < 0) {
        problems.push(`${path}.ifixit.guideCount must be 0 or more`);
      }
      const toolCount = finiteNumber(ifixitRaw['toolCount'], `${path}.ifixit.toolCount`, problems);
      if (!Number.isInteger(toolCount) || toolCount < 0) {
        problems.push(`${path}.ifixit.toolCount must be 0 or more`);
      }
      const fetchedAt = stringField(ifixitRaw['fetchedAt'], `${path}.ifixit.fetchedAt`, problems);
      if (fetchedAt && !/^\d{4}-\d{2}-\d{2}T/.test(fetchedAt)) {
        problems.push(`${path}.ifixit.fetchedAt must be an ISO timestamp`);
      }
      ifixit = {
        wikiid,
        title,
        url,
        score,
        guideCount,
        toolCount,
        fetchedAt,
      };
      if (typeof ifixitRaw['imageUrl'] === 'string') {
        if (!isHttpUrl(ifixitRaw['imageUrl'])) {
          problems.push(`${path}.ifixit.imageUrl must be an http(s) URL`);
        } else {
          ifixit.imageUrl = ifixitRaw['imageUrl'];
        }
      }
    }
  }

  let audit: Product['audit'];
  const auditRaw = raw['audit'];
  if (auditRaw !== undefined) {
    if (!isRecord(auditRaw)) {
      problems.push(`${path}.audit must be an object`);
    } else {
      const answersRaw = auditRaw['answers'];
      const answers: { id: string; answer: boolean }[] = [];
      if (!Array.isArray(answersRaw)) {
        problems.push(`${path}.audit.answers must be an array`);
      } else {
        for (const [answerIndex, answer] of answersRaw.entries()) {
          if (!isRecord(answer)) {
            problems.push(`${path}.audit.answers[${answerIndex}] must be an object`);
            continue;
          }
          const answerId = stringField(answer['id'], `${path}.audit.answers[${answerIndex}].id`, problems);
          if (typeof answer['answer'] !== 'boolean') {
            problems.push(`${path}.audit.answers[${answerIndex}].answer must be a boolean`);
          } else {
            answers.push({ id: answerId, answer: answer['answer'] });
          }
        }
      }
      const checkedOn = stringField(auditRaw['checkedOn'], `${path}.audit.checkedOn`, problems);
      if (checkedOn && !isIsoDate(checkedOn)) {
        problems.push(`${path}.audit.checkedOn must be YYYY-MM-DD`);
      }
      audit = { answers, checkedOn };
    }
  }

  if (problems.length > 0 && !id) return null;

  return {
    id,
    brand,
    model,
    name,
    category: category as Category,
    barcodes,
    price: {
      amount: priceAmount,
      currency: 'AUD',
      kind: priceKind,
      checkedOn: priceCheckedOn,
      sourceUrl: priceSourceUrl,
      estimate: priceEstimate,
    },
    repairCost,
    repairEvents,
    ...(typeof raw['repairNote'] === 'string' ? { repairNote: raw['repairNote'] } : {}),
    ...(energy ? { energy } : {}),
    ...(typeof raw['partsUrl'] === 'string' && isHttpUrl(raw['partsUrl'])
      ? { partsUrl: raw['partsUrl'] }
      : {}),
    ...(typeof raw['manualUrl'] === 'string' && isHttpUrl(raw['manualUrl'])
      ? { manualUrl: raw['manualUrl'] }
      : {}),
    ...(typeof raw['serviceNote'] === 'string' ? { serviceNote: raw['serviceNote'] } : {}),
    ...(ifixit ? { ifixit } : {}),
    ...(audit ? { audit } : {}),
    sources,
    updatedAt,
  };
}

export function parseCatalog(raw: unknown): CatalogFile {
  const problems: string[] = [];
  if (!isRecord(raw)) {
    throw new DataError('Catalog must be an object');
  }
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_KEYS.has(key)) problems.push(`unknown key "${key}"`);
  }
  const version = raw['version'];
  if (version !== 1) problems.push('version must be 1');
  const tariffAud = finiteNumber(raw['tariffAud'], 'tariffAud', problems);
  if (tariffAud <= 0) problems.push('tariffAud must be greater than 0');

  const productsRaw = raw['products'];
  const products: Product[] = [];
  const ids = new Set<string>();
  const barcodes = new Set<string>();
  if (!Array.isArray(productsRaw) || productsRaw.length === 0) {
    problems.push('products must be a non-empty array');
  } else {
    productsRaw.forEach((entry, index) => {
      const product = validateProduct(entry, index, problems);
      if (!product) return;
      if (ids.has(product.id)) problems.push(`duplicate product id "${product.id}"`);
      ids.add(product.id);
      for (const barcode of product.barcodes) {
        if (barcodes.has(barcode)) problems.push(`duplicate barcode "${barcode}"`);
        barcodes.add(barcode);
      }
      products.push(product);
    });
  }

  if (problems.length > 0) {
    throw new DataError('Catalog validation failed', problems);
  }
  return { version: 1, tariffAud, products };
}

export async function readCatalogFile(path: string): Promise<CatalogFile> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    throw new DataError(`Cannot read catalog at ${path}`, [String(error)]);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new DataError(`Catalog at ${path} is not valid JSON`, [String(error)]);
  }
  return parseCatalog(raw);
}

export interface ProductIndex {
  byId: Map<string, Product>;
  byBarcode: Map<string, Product>;
  products: Product[];
}

export function indexProducts(products: Product[]): ProductIndex {
  const byId = new Map<string, Product>();
  const byBarcode = new Map<string, Product>();
  for (const product of products) {
    byId.set(product.id, product);
    for (const barcode of product.barcodes) {
      byBarcode.set(barcode, product);
    }
  }
  return { byId, byBarcode, products };
}

export function buildCatalog(catalog: CatalogFile, generatedAt = new Date().toISOString()): Catalog {
  return {
    version: 1,
    generatedAt,
    tariffAud: catalog.tariffAud,
    products: [...catalog.products].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function categoryCounts(products: Product[]): Record<Category, number> {
  const counts: Record<Category, number> = { phone: 0, laptop: 0, washer: 0 };
  for (const product of products) counts[product.category] += 1;
  return counts;
}