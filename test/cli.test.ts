import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli, type CliIo } from '../src/cli.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const fixture = join(root, 'fixtures', 'sample-catalog.json');

function capture(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: { out: (line) => out.push(line), err: (line) => err.push(line) },
  };
}

test('help exits 0 and names the commands', async () => {
  const { io, out } = capture();
  assert.equal(await runCli(['help'], io), 0);
  assert.match(out.join('\n'), /longevity search/);
});

test('no command prints help and exits 2', async () => {
  const { io } = capture();
  assert.equal(await runCli([], io), 2);
});

test('an unknown command exits 2', async () => {
  const { io, err } = capture();
  assert.equal(await runCli(['frobnicate'], io), 2);
  assert.match(err.join('\n'), /Unknown command/);
});

test('show prints the score and the life cost', async () => {
  const { io, out } = capture();
  const code = await runCli(['show', 'fairphone-5', '--data', fixture], io);
  assert.equal(code, 0);
  const text = out.join('\n');
  assert.match(text, /Fairphone 5/);
  assert.match(text, /Score: \d+\/100/);
  assert.match(text, /per year/);
});

test('show with an unknown id exits 2', async () => {
  const { io, err } = capture();
  assert.equal(await runCli(['show', 'no-such-product', '--data', fixture], io), 2);
  assert.match(err.join('\n'), /No product with id/);
});

test('show takes a price and an age', async () => {
  const { io, out } = capture();
  const code = await runCli(
    ['show', 'fairphone-5', '--data', fixture, '--price', '900', '--age', '2'],
    io,
  );
  assert.equal(code, 0);
  const text = out.join('\n');
  assert.match(text, /A\$900/);
  assert.match(text, /Repair or replace: repair/);
});

test('show emits JSON on request', async () => {
  const { io, out } = capture();
  assert.equal(await runCli(['show', 'fairphone-5', '--data', fixture, '--json'], io), 0);
  const parsed = JSON.parse(out.join('\n')) as { score: { score: number } };
  assert.ok(parsed.score.score > 0);
});

test('search finds a product and exits 0', async () => {
  const { io, out } = capture();
  assert.equal(await runCli(['search', 'fairphone', '--data', fixture], io), 0);
  assert.match(out.join('\n'), /Fairphone 5/);
});

test('search with no query exits 2', async () => {
  const { io } = capture();
  assert.equal(await runCli(['search', '--data', fixture], io), 2);
});

test('search with a bad category exits 2', async () => {
  const { io } = capture();
  assert.equal(await runCli(['search', 'x', '--data', fixture, '--category', 'toaster'], io), 2);
});

test('a missing catalog exits 3', async () => {
  const { io, err } = capture();
  assert.equal(await runCli(['show', 'fairphone-5', '--data', 'no-file.json'], io), 3);
  assert.match(err.join('\n'), /Cannot read catalog/);
});

test('scan reports an index hit', async () => {
  const { io, out } = capture();
  assert.equal(await runCli(['scan', '8712412001231', '--data', fixture], io), 0);
  assert.match(out.join('\n'), /is in the index/);
});

test('scan rejects a bad check digit with exit 2', async () => {
  const { io, err } = capture();
  assert.equal(await runCli(['scan', '8712412001234', '--data', fixture], io), 2);
  assert.match(err.join('\n'), /check digit/);
});

test('compare needs two ids', async () => {
  const { io } = capture();
  assert.equal(await runCli(['compare', 'fairphone-5', '--data', fixture], io), 2);
});

test('compare prints a table with a best row', async () => {
  const { io, out } = capture();
  assert.equal(
    await runCli(['compare', 'fairphone-5', 'miele-w1-9kg', '--data', fixture], io),
    0,
  );
  const text = out.join('\n');
  assert.match(text, /best score/);
  assert.match(text, /fairphone-5\*/);
});

test('audit lists eight weighted questions', async () => {
  const { io, out } = capture();
  assert.equal(await runCli(['audit'], io), 0);
  assert.match(out.join('\n'), /total 100/);
});

test('repairers uses the fixture and sorts by distance', async () => {
  const { io, out } = capture();
  const code = await runCli(
    ['repairers', '--lat', '-33.7969', '--lon', '151.1830', '--fixture', '--json'],
    io,
  );
  assert.equal(code, 0);
  const parsed = JSON.parse(out.join('\n')) as {
    source: string;
    repairers: { name: string; distanceM: number }[];
  };
  assert.equal(parsed.source, 'fixture');
  assert.equal(parsed.repairers.length, 3);
  assert.ok(parsed.repairers[0]!.distanceM <= parsed.repairers[1]!.distanceM);
});

test('repairers without coordinates exits 2', async () => {
  const { io } = capture();
  assert.equal(await runCli(['repairers', '--fixture'], io), 2);
});

test('build writes the web catalog', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'longevity-build-'));
  const outPath = join(dir, 'catalog.json');
  const { io } = capture();
  try {
    assert.equal(await runCli(['build', '--data', fixture, '--out', outPath], io), 0);
    const parsed = JSON.parse(await readFile(outPath, 'utf8')) as {
      version: number;
      products: unknown[];
    };
    assert.equal(parsed.version, 1);
    assert.equal(parsed.products.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('report writes an HTML file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'longevity-report-'));
  const outPath = join(dir, 'brief.html');
  const { io } = capture();
  try {
    assert.equal(
      await runCli(['report', 'fairphone-5', '--data', fixture, '--out', outPath, '--age', '2'], io),
      0,
    );
    const html = await readFile(outPath, 'utf8');
    assert.match(html, /<!doctype html>/);
    assert.match(html, /Fairphone 5/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('demo works with no network', async () => {
  const { io, out } = capture();
  assert.equal(await runCli(['demo', '--data', fixture], io), 0);
  const text = out.join('\n');
  assert.match(text, /no network needed/);
  assert.match(text, /Top three by score/);
});

test('demo prints the tariff with cents', async () => {
  const { io, out } = capture();
  await runCli(['demo', '--data', fixture], io);
  assert.match(out.join('\n'), /A\$0\.30\/kWh/);
});

test('an unknown flag exits 2', async () => {
  const { io } = capture();
  assert.equal(await runCli(['show', 'fairphone-5', '--data', fixture, '--nope'], io), 2);
});