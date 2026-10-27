# PLAN — longevity

Six cycles. Each cycle ends with a passing build and a commit.

## Cycle 1 — Scaffold and data model

- `package.json`, `tsconfig.json`, `.gitignore`, `LICENSE`, `PLAN.md`.
- `src/types.ts`: catalog and score types.
- `src/catalog.ts`: load, validate and index the catalog.
- `src/util.ts`: slug, clamp, round, parse numbers.
- Tests for the validator and the index.

## Cycle 2 — Seed catalog

- `scripts/seed-catalog.mjs`: query iFixit for each model, read the wiki, take
  the score, the guide count and the tool count. Write `data/products.json`
  with sources and a fetch date.
- Curated price, repair cost and parts link per product.
- Washing machine entries without a published score.
- Tests for the catalog data: unique ids, valid category, source on each entry.

## Cycle 3 — Score and life cost

- `src/score.ts`: four parts, weights, coverage, band labels.
- `src/lifecost.ts`: life years, total cost, cost per year.
- `src/decide.ts`: repair-or-replace ratio and verdict.
- `src/audit.ts`: eight questions, weights and score.
- Tests for each formula and for the missing-data paths.

## Cycle 4 — Search, barcode and compare

- `src/search.ts`: token match, brand boost, category filter, rank order.
- `src/barcode.ts`: normalise, validate, look up, optional remote adapter.
- `src/compare.ts`: compare rows with the best value marked.
- Tests for checksum edge cases, ranking and compare.

## Cycle 5 — CLI, repairers, report

- `src/cli.ts`: all commands, text and JSON output, exit codes.
- `src/overpass.ts`: query builder, three mirrors, parser, cache, fixture mode.
- `src/report.ts`: printable one-page HTML.
- `src/refresh.ts`: iFixit refresh with a rate limit and a dry-run mode.
- End-to-end tests with a temporary directory.

## Cycle 6 — PWA, assets and README

- `web/index.html`, `web/app.js`, `web/styles.css`, `web/sw.js`,
  `web/manifest.webmanifest`.
- `scripts/serve.mjs`: static server for local use and screenshots.
- Logo from local ComfyUI. Fallback: an SVG pixel mark.
- Real screenshot of the product view.
- README with logo, pitch, features, quick start, screenshots, data sources,
  limits and licence.
- Dogfood run on the real catalog. Push.

## Rules

- Zero runtime dependencies.
- Every external response is cached on disk.
- Every missing value stays null. Do not fill it with a guess.
- Commit after each cycle. Verify each commit.