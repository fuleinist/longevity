# SPEC — longevity

## Problem

Buyers cannot compare repairability at the point of sale. Repair scores, spare
parts and local repairers are spread across different sites. The EU Digital
Product Passport becomes mandatory in 2027. Consumer tools are still missing.

## Product

`longevity` is a repairability scanner for household products. A user scans a
barcode or searches a model. The tool shows a repairability score, the repair
record, spare-parts links, nearby repairers and a life-cost estimate.

Three categories in the first release: phones, laptops and washing machines.

## Users

1. A buyer who compares two products before purchase.
2. An owner who decides whether to repair or replace.
3. A repair shop or repair cafe that wants a shared score.

## Scope of the first release

### Must have

- A curated product index with sourced data. Each entry records its sources.
- A Longevity Score from 0 to 100. The score has four parts with fixed weights.
- A life-cost estimate in AUD per year of use.
- A repair-or-replace verdict with the numbers behind it.
- Search by brand, model or category.
- Barcode lookup by EAN-13, UPC-A or GTIN-14. The lookup checks the checksum.
- A self-audit for products with no published repair score.
- A local repairer list from OpenStreetMap. Cache every response.
- A printable HTML brief for one product.
- A static PWA. It works offline after the first load.
- A CLI with the same data and the same math as the PWA.

### Must not have

- No runtime dependencies. Development tools only.
- No API keys in the first release.
- No accounts, tracking or personal data.
- No invented data. A missing value stays missing and lowers the coverage.

### Out of scope for the first release

- Live price feeds.
- Barcode crowdsourcing.
- User reviews.
- Multi-language UI.
- Server-side search.

## Data sources

| Source | Use | Access |
| --- | --- | --- |
| iFixit API v2.0 | Repairability score, guide count, tool count, image | Public, no key |
| OpenStreetMap Overpass | Repair shops and repair cafes near a point | Public, no key |
| UPCitemdb trial | Optional barcode to product title lookup | Public trial, 100 calls per day |
| Manufacturer pages | Spare-parts links | Public links, curated |

EPREL was checked. The public API returned HTTP 403 without a key. The first
release does not use it. The README states this limit.

## Longevity Score

Three parts. Each part returns 0 to 100.

| Part | Weight | Input |
| --- | --- | --- |
| Repair | 65 | iFixit score x 10, or the self-audit score |
| Support | 25 | Guide count and tool count, log scale |
| Parts | 10 | A spare-parts link is present |

A missing part is removed. The remaining weights are scaled back to 100. The
score also reports coverage: the share of weights that had data.

Running cost is not part of the score. It appears in the life-cost estimate,
where the user can set the tariff. The score compares repair, support and
parts only.

The score is a comparison aid. It is not a prediction of product life. The UI
and the README state this.

## Life cost

```
lifeYears = categoryBaseYears x (0.55 + 0.09 x repairScore10)
total     = price + repairEvents x repairCost + yearlyEnergyCost x lifeYears
perYear   = total / lifeYears
```

When the catalog has no energy value, the user can supply yearly kWh. When
neither is present, the energy term is zero and the output says so.

Category base years: phone 5, laptop 7, washer 12. The repair factor spans
0.55 to 1.45. A product with no score uses the audit score. A product with no
repair data uses 0.55.

`repairEvents` is a scenario value. It defaults to 1 for phones and laptops,
and 2 for washers. The user can change it.

Tariff defaults to 0.30 AUD per kWh. The user can change it.

## Repair or replace

```
remainingYears = max(0.5, lifeYears - ageYears)
repairPerYear  = repairCost / remainingYears
replacePerYear = price / lifeYears
ratio          = repairPerYear / replacePerYear
```

- ratio <= 1.0: repair.
- ratio <= 1.5: consider.
- ratio > 1.5: replace.

## Self-audit

Eight yes/no questions. Each question has a fixed weight. Unknown counts as no.

1. The drum or main module is accessible without moving the machine. (15)
2. Fasteners are standard screws. No glue and no rivets. (15)
3. Bearings are sold as a separate part. (15)
4. The control board is sold as a separate part. (15)
5. The door seal and the pump are sold as spares. (15)
6. Error codes are readable without a service tool. (10)
7. A repair manual or a parts diagram is public. (10)
8. The maker promises spare parts for 5 years or more. (5)

## Barcode rules

- Accept EAN-13, UPC-A and GTIN-14.
- Strip spaces and hyphens.
- A 12-digit code is UPC-A. Add a leading zero for the check.
- Validate the check digit. Reject a bad code with exit code 2.
- Lookup order: local index, then the optional UPCitemdb trial call.
- A remote hit that is not in the index shows the remote title and a clear
  "not in the index" message.

## CLI

```
longevity build [--data data/products.json] [--out web/catalog.json]
longevity search <query> [--category phone|laptop|washer] [--json]
longevity show <id> [--price N] [--tariff N] [--json]
longevity scan <code> [--remote] [--json]
longevity compare <id...> [--json]
longevity repairers --lat N --lon N [--radius M] [--json]
longevity report <id> [--out FILE] [--price N] [--tariff N]
longevity audit [--json]
longevity refresh [--data data/products.json]
longevity demo [--json]
```

Exit codes: 0 ok, 1 runtime error, 2 usage or bad input, 3 data error.

## Acceptance criteria

1. `npm run build` passes with TypeScript strict mode.
2. `npm test` passes. Tests cover the score, life cost, barcode checksum,
   search, catalog validation, Overpass parsing, report escaping and the CLI.
3. `longevity demo` works with no network.
4. `longevity refresh` updates iFixit scores and guide counts.
5. The PWA loads `web/catalog.json`, works offline, and shows the same score as
   the CLI for the same product.
6. The README shows the logo, the pitch, the features, the quick start, the
   screenshots, the data sources and the licence.
7. Every product entry lists its sources and the date of the data.

## Risks and limits

- iFixit scores are missing for many models. The tool shows "no published
  score" and offers the self-audit.
- Washing machines rarely have a published score. The self-audit is the main
  path for that category.
- Overpass servers can be busy. The client tries three mirrors, then a cache.
- Prices are estimates. The user can override the price on the command line.
- Barcode coverage is sparse. A barcode miss is a normal result, not an error.