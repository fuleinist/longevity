import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildQuery,
  distanceMeters,
  fetchRepairers,
  parseOverpass,
} from '../src/overpass.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const fixturePath = join(root, 'fixtures', 'repairers.json');

const origin = { lat: -33.7969, lon: 151.183 };

function fakeFetch(payload: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
}

test('buildQuery includes the radius and the three filters', () => {
  const query = buildQuery({ lat: -33.8, lon: 151.2, radiusM: 1500 });
  assert.match(query, /around:1500,-33\.8,151\.2/);
  assert.match(query, /shop"="repair"/);
  assert.match(query, /craft"="repair"/);
  assert.match(query, /out center tags/);
});

test('distanceMeters is zero for one point', () => {
  assert.equal(Math.round(distanceMeters(origin, origin)), 0);
});

test('distanceMeters matches a known short hop', () => {
  const a = { lat: 0, lon: 0 };
  const b = { lat: 0, lon: 0.001 };
  const distance = distanceMeters(a, b);
  assert.ok(distance > 110 && distance < 112, `got ${distance}`);
});

test('parseOverpass reads nodes and way centers', async () => {
  const payload = JSON.parse(await readFile(fixturePath, 'utf8')) as unknown;
  const repairers = parseOverpass(payload, origin);
  assert.equal(repairers.length, 3);
  assert.equal(repairers[0]?.name, 'North Shore Repair Cafe');
  assert.equal(repairers[0]?.kind, 'repair');
  assert.equal(repairers[1]?.address, '12 Victoria Avenue Chatswood');
  assert.ok((repairers[0]?.distanceM ?? 0) <= (repairers[1]?.distanceM ?? 0));
});

test('parseOverpass skips elements without a position', () => {
  const repairers = parseOverpass({ elements: [{ type: 'node', id: 1, tags: {} }] }, origin);
  assert.equal(repairers.length, 0);
});

test('parseOverpass handles a malformed payload', () => {
  assert.deepEqual(parseOverpass(null, origin), []);
  assert.deepEqual(parseOverpass({ elements: 'nope' }, origin), []);
});

test('fetchRepairers reads the fixture without the network', async () => {
  const result = await fetchRepairers({ ...origin, fixturePath });
  assert.equal(result.source, 'fixture');
  assert.equal(result.repairers.length, 3);
});

test('fetchRepairers writes and reuses the cache', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'longevity-cache-'));
  try {
    const first = await fetchRepairers({
      ...origin,
      cacheDir: dir,
      fetchImpl: fakeFetch({ elements: [] }),
      now: new Date('2026-10-28T00:00:00.000Z'),
    });
    assert.equal(first.source, 'live');

    const second = await fetchRepairers({
      ...origin,
      cacheDir: dir,
      fetchImpl: (async () => {
        throw new Error('the cache should win');
      }) as unknown as typeof fetch,
      now: new Date('2026-10-28T01:00:00.000Z'),
    });
    assert.equal(second.source, 'cache');
    assert.equal(second.fetchedAt, '2026-10-28T00:00:00.000Z');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('fetchRepairers falls back to a stale cache', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'longevity-stale-'));
  try {
    await fetchRepairers({
      ...origin,
      cacheDir: dir,
      fetchImpl: fakeFetch({ elements: [] }),
      now: new Date('2026-10-01T00:00:00.000Z'),
    });
    const result = await fetchRepairers({
      ...origin,
      cacheDir: dir,
      fetchImpl: (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
      now: new Date('2026-10-28T00:00:00.000Z'),
    });
    assert.equal(result.source, 'cache');
    assert.match(result.note ?? '', /unreachable/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('fetchRepairers reports no source when all mirrors fail', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'longevity-none-'));
  try {
    const result = await fetchRepairers({
      ...origin,
      cacheDir: dir,
      fetchImpl: (async () => new Response('busy', { status: 503 })) as unknown as typeof fetch,
    });
    assert.equal(result.source, 'none');
    assert.equal(result.repairers.length, 0);
    assert.match(result.note ?? '', /no cache/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});