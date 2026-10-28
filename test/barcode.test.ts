import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkDigitFor,
  findInIndex,
  inspectBarcode,
  lookupRemote,
  requireBarcode,
  scanBarcode,
} from '../src/barcode.js';
import { indexProducts } from '../src/catalog.js';
import { UsageError } from '../src/errors.js';
import { makeProduct } from './helpers.js';

const EAN13 = '5901234123457';
const UPCA = '036000291452';
const GTIN14 = '10012345000017';

function index() {
  return indexProducts([
    makeProduct({ id: 'fairphone-5', name: 'Fairphone 5', barcodes: [EAN13] }),
    makeProduct({ id: 'pixel-8', name: 'Pixel 8', barcodes: [GTIN14] }),
  ]);
}

test('computes standard check digits', () => {
  assert.equal(checkDigitFor('590123412345'), 7);
  assert.equal(checkDigitFor('036000291452'.slice(0, -1)), 2);
});

test('accepts EAN-13', () => {
  const result = inspectBarcode(EAN13);
  assert.ok(result.ok);
  assert.equal(result.info.format, 'ean13');
  assert.equal(result.info.gtin14, `0${EAN13}`);
});

test('accepts UPC-A and pads it to GTIN-14', () => {
  const result = inspectBarcode(UPCA);
  assert.ok(result.ok);
  assert.equal(result.info.format, 'upca');
  assert.equal(result.info.gtin14, `00${UPCA}`);
});

test('accepts GTIN-14', () => {
  const result = inspectBarcode(GTIN14);
  assert.ok(result.ok);
  assert.equal(result.info.format, 'gtin14');
});

test('strips spaces and hyphens', () => {
  const result = inspectBarcode('590-1234 123457');
  assert.ok(result.ok);
  assert.equal(result.info.code, EAN13);
});

test('rejects a bad check digit', () => {
  const result = inspectBarcode('5901234123458');
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /check digit/);
});

test('rejects letters', () => {
  const result = inspectBarcode('59012ABC123457');
  assert.equal(result.ok, false);
});

test('rejects an unsupported length', () => {
  const result = inspectBarcode('12345');
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /digits/);
});

test('requireBarcode throws a usage error', () => {
  assert.throws(() => requireBarcode('5901234123458'), (error: unknown) => {
    assert.ok(error instanceof UsageError);
    assert.equal(error.exitCode, 2);
    return true;
  });
});

test('findInIndex matches the typed code', () => {
  const info = requireBarcode(EAN13);
  assert.equal(findInIndex(info, index())?.id, 'fairphone-5');
});

test('findInIndex matches a GTIN-14 against a UPC-A entry', () => {
  const product = makeProduct({ id: 'mini', name: 'Mini', barcodes: [UPCA] });
  const idx = indexProducts([product]);
  const info = requireBarcode(`00${UPCA}`);
  assert.equal(findInIndex(info, idx)?.id, 'mini');
});

test('scanBarcode reports an index hit', async () => {
  const result = await scanBarcode(EAN13, index());
  assert.equal(result.product?.id, 'fairphone-5');
  assert.match(result.message, /in the index/);
});

test('scanBarcode reports a valid code with no match', async () => {
  const result = await scanBarcode('5901234123457', indexProducts([]));
  assert.equal(result.product, null);
  assert.match(result.message, /not in the index/);
});

test('scanBarcode can call the remote adapter', async () => {
  const fakeFetch = (async () =>
    new Response(JSON.stringify({ items: [{ title: 'Mystery Washer', brand: 'Acme' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
  const result = await scanBarcode(EAN13, indexProducts([]), {
    remote: true,
    fetchImpl: fakeFetch,
  });
  assert.equal(result.remote?.title, 'Mystery Washer');
  assert.match(result.message, /Remote title: Mystery Washer/);
  assert.match(result.message, /not in the index/);
});

test('scanBarcode survives a failed remote call', async () => {
  const fakeFetch = (async () => {
    throw new Error('offline');
  }) as unknown as typeof fetch;
  const result = await scanBarcode(EAN13, indexProducts([]), {
    remote: true,
    fetchImpl: fakeFetch,
  });
  assert.equal(result.remote, null);
  assert.match(result.message, /found nothing/);
});

test('lookupRemote handles an empty result', async () => {
  const fakeFetch = (async () =>
    new Response(JSON.stringify({ items: [] }), { status: 200 })) as unknown as typeof fetch;
  assert.equal(await lookupRemote(EAN13, fakeFetch), null);
});

test('lookupRemote handles a bad status', async () => {
  const fakeFetch = (async () => new Response('busy', { status: 503 })) as unknown as typeof fetch;
  assert.equal(await lookupRemote(EAN13, fakeFetch), null);
});