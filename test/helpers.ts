import type { Product } from '../src/types.js';

/** Build a complete product for tests. Pass overrides for the fields in play. */
export function makeProduct(
  patch: Partial<Product> & Pick<Product, 'id' | 'name'>,
): Product {
  return {
    brand: 'Test',
    model: patch.name,
    category: 'phone',
    barcodes: [],
    price: {
      amount: 1000,
      currency: 'AUD',
      kind: 'street',
      checkedOn: '2026-10-28',
      sourceUrl: 'https://example.com/price',
      estimate: true,
    },
    repairCost: 150,
    repairEvents: 1,
    sources: ['https://example.com/source'],
    updatedAt: '2026-10-28',
    ...patch,
  };
}