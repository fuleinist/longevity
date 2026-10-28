import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Repairer } from './types.js';

export const OVERPASS_MIRRORS: readonly string[] = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

export const DEFAULT_RADIUS_M = 5000;
export const DEFAULT_CACHE_HOURS = 24;

export interface Point {
  lat: number;
  lon: number;
}

export interface RepairerQuery extends Point {
  radiusM?: number;
}

export interface RepairerResult {
  repairers: Repairer[];
  source: 'fixture' | 'cache' | 'live' | 'none';
  fetchedAt: string | null;
  note?: string;
}

export interface RepairerOptions extends RepairerQuery {
  cacheDir?: string;
  fetchImpl?: typeof fetch;
  now?: Date;
  ttlHours?: number;
  fixturePath?: string;
}

export function buildQuery(query: RepairerQuery): string {
  const radius = Math.round(query.radiusM ?? DEFAULT_RADIUS_M);
  const around = `(around:${radius},${query.lat},${query.lon})`;
  return [
    '[out:json][timeout:25];',
    '(',
    `  nwr["shop"="repair"]${around};`,
    `  nwr["craft"="repair"]${around};`,
    `  nwr["repair"="yes"]${around};`,
    ');',
    'out center tags;',
  ].join('\n');
}

export function distanceMeters(a: Point, b: Point): number {
  const earthRadius = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const lat1 = a.lat * toRad;
  const lat2 = b.lat * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(h));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function readString(tags: Record<string, unknown>, key: string): string | undefined {
  const value = tags[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function addressOf(tags: Record<string, unknown>): string | undefined {
  const parts = [
    readString(tags, 'addr:housenumber'),
    readString(tags, 'addr:street'),
    readString(tags, 'addr:suburb') ?? readString(tags, 'addr:city'),
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(' ') : undefined;
}

/** Parse an Overpass JSON response into repairers, sorted by distance. */
export function parseOverpass(payload: unknown, origin: Point): Repairer[] {
  const root = asRecord(payload);
  const elements = root?.['elements'];
  if (!Array.isArray(elements)) return [];

  const repairers: Repairer[] = [];
  for (const element of elements) {
    const record = asRecord(element);
    if (!record) continue;
    const tags = asRecord(record['tags']) ?? {};
    const center = asRecord(record['center']);
    const lat = typeof record['lat'] === 'number' ? record['lat'] : center?.['lat'];
    const lon = typeof record['lon'] === 'number' ? record['lon'] : center?.['lon'];
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;

    const id = `${String(record['type'] ?? 'node')}/${String(record['id'] ?? '')}`;
    const kind = readString(tags, 'shop') ?? readString(tags, 'craft') ?? 'repair';
    const address = addressOf(tags);
    repairers.push({
      id,
      name: readString(tags, 'name') ?? 'Unnamed repair business',
      kind,
      lat,
      lon,
      ...(address ? { address } : {}),
      distanceM: Math.round(distanceMeters(origin, { lat, lon })),
      tags: Object.fromEntries(
        Object.entries(tags).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      ),
    });
  }

  repairers.sort((a, b) => a.distanceM - b.distanceM);
  return repairers;
}

function cachePathFor(cacheDir: string, query: string): string {
  const hash = createHash('sha1').update(query).digest('hex').slice(0, 16);
  return join(cacheDir, `overpass-${hash}.json`);
}

interface CacheFile {
  fetchedAt: string;
  query: string;
  payload: unknown;
}

async function readCache(path: string): Promise<CacheFile | null> {
  try {
    const text = await readFile(path, 'utf8');
    const parsed: unknown = JSON.parse(text);
    const record = asRecord(parsed);
    if (!record || typeof record['fetchedAt'] !== 'string') return null;
    return {
      fetchedAt: record['fetchedAt'],
      query: typeof record['query'] === 'string' ? record['query'] : '',
      payload: record['payload'],
    };
  } catch {
    return null;
  }
}

function cacheIsFresh(fetchedAt: string, now: Date, ttlHours: number): boolean {
  const time = Date.parse(fetchedAt);
  if (!Number.isFinite(time)) return false;
  return now.getTime() - time < ttlHours * 3600 * 1000;
}

/**
 * Fetch repairers from Overpass. The cache is checked first. Every mirror is
 * tried in turn. A stale cache is better than an empty result.
 */
export async function fetchRepairers(options: RepairerOptions): Promise<RepairerResult> {
  const origin = { lat: options.lat, lon: options.lon };
  if (options.fixturePath) {
    const text = await readFile(options.fixturePath, 'utf8');
    const payload: unknown = JSON.parse(text);
    return {
      repairers: parseOverpass(payload, origin),
      source: 'fixture',
      fetchedAt: null,
      note: 'Fixture data. No network call.',
    };
  }

  const query = buildQuery(options);
  const cacheDir = options.cacheDir;
  const cachePath = cacheDir ? cachePathFor(cacheDir, query) : null;
  const cached = cachePath ? await readCache(cachePath) : null;
  const now = options.now ?? new Date();
  const ttl = options.ttlHours ?? DEFAULT_CACHE_HOURS;

  if (cached && cacheIsFresh(cached.fetchedAt, now, ttl)) {
    return {
      repairers: parseOverpass(cached.payload, origin),
      source: 'cache',
      fetchedAt: cached.fetchedAt,
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  for (const mirror of OVERPASS_MIRRORS) {
    let payload: unknown;
    try {
      const response = await fetchImpl(mirror, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
          'user-agent': 'longevity/0.1 (repairer lookup)',
        },
        body: new URLSearchParams({ data: query }).toString(),
        signal: AbortSignal.timeout(25000),
      });
      if (!response.ok) continue;
      payload = await response.json();
    } catch {
      continue;
    }

    const fetchedAt = now.toISOString();
    if (cachePath) {
      try {
        await mkdir(dirname(cachePath), { recursive: true });
        const file: CacheFile = { fetchedAt, query, payload };
        await writeFile(cachePath, `${JSON.stringify(file)}\n`, 'utf8');
      } catch {
        // A cache write must not fail the lookup.
      }
    }
    return { repairers: parseOverpass(payload, origin), source: 'live', fetchedAt };
  }

  if (cached) {
    return {
      repairers: parseOverpass(cached.payload, origin),
      source: 'cache',
      fetchedAt: cached.fetchedAt,
      note: 'Overpass mirrors are unreachable. Showing the last cached result.',
    };
  }

  return {
    repairers: [],
    source: 'none',
    fetchedAt: null,
    note: 'Overpass mirrors are unreachable and no cache exists. Try again later.',
  };
}