import type { Analysis } from './analyze.js';
import { BAND_LABEL, money, moneyPrecise } from './text.js';
import { CATEGORY_LABEL, type Repairer } from './types.js';

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; font: 16px/1.5 "Segoe UI", system-ui, sans-serif; color: #1c1c1c; background: #f4f1ea; }
main { max-width: 760px; margin: 0 auto; padding: 32px 24px 48px; background: #fff; }
.kicker { text-transform: uppercase; letter-spacing: .12em; font-size: 12px; color: #6b6b6b; margin: 0 0 4px; }
h1 { font-size: 32px; margin: 0 0 4px; }
.sub { color: #5c5c5c; margin: 0 0 24px; }
.score { display: flex; align-items: baseline; gap: 12px; padding: 16px 20px; border-radius: 12px; background: #143d2b; color: #fff; }
.score strong { font-size: 44px; line-height: 1; }
.score span { font-size: 14px; opacity: .85; }
h2 { font-size: 18px; margin: 28px 0 8px; border-bottom: 1px solid #e2ded4; padding-bottom: 4px; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #eee9df; }
th { color: #6b6b6b; font-weight: 600; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
.decision { margin-top: 12px; padding: 12px 16px; border-left: 4px solid #143d2b; background: #f3f8f4; }
.decision strong { text-transform: uppercase; letter-spacing: .06em; font-size: 13px; }
.small { font-size: 13px; color: #6b6b6b; }
ul { padding-left: 20px; }
li { margin-bottom: 6px; }
footer { margin-top: 36px; border-top: 1px solid #e2ded4; padding-top: 12px; font-size: 12px; color: #6b6b6b; }
@media print { body { background: #fff; } main { padding: 0; } .score { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`;

export interface ReportOptions {
  now?: Date;
  repairers?: Repairer[];
  /** Base URL or file name for the sources list. */
  note?: string;
}

function partRows(analysis: Analysis): string {
  return analysis.score.parts
    .map((part) => {
      const value = part.value === null ? 'no data' : `${part.value}/100`;
      return `<tr><td>${escapeHtml(part.label)}</td><td class="num">${escapeHtml(value)}</td><td class="num">${part.weight}%</td><td>${escapeHtml(part.detail)}</td></tr>`;
    })
    .join('\n');
}

/**
 * Render a one-page printable brief for one product. All dynamic text is
 * escaped. The page needs no network and no scripts.
 */
export function renderReport(analysis: Analysis, options: ReportOptions = {}): string {
  const { product, score, lifeCost, decision } = analysis;
  const now = options.now ?? new Date();
  const date = now.toISOString().slice(0, 10);
  const scoreText = score.score === null ? 'No score' : `${score.score}/100`;
  const band = score.score === null ? 'Not enough data' : BAND_LABEL[score.band ?? 'poor'];

  const decisionBlock = decision
    ? `<div class="decision"><strong>${escapeHtml(decision.verdict)}</strong>
      <p>A repair costs ${money(decision.repairPerYear)} per remaining year.
      A replacement costs ${money(decision.replacePerYear)} per year of use.
      The ratio is ${decision.ratio}. Remaining life is ${decision.remainingYears} years.</p></div>`
    : '<p class="small">Add the product age to get a repair-or-replace verdict.</p>';

  const repairerBlock =
    options.repairers && options.repairers.length > 0
      ? `<h2>Nearby repairers</h2>
<ul>${options.repairers
          .slice(0, 8)
          .map(
            (repairer) =>
              `<li>${escapeHtml(repairer.name)} - ${escapeHtml(repairer.kind)}, ${Math.round(repairer.distanceM / 100) / 10} km</li>`,
          )
          .join('')}</ul>`
      : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(product.name)} - Longevity brief</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<p class="kicker">Longevity brief - ${escapeHtml(date)}</p>
<h1>${escapeHtml(product.name)}</h1>
<p class="sub">${escapeHtml(product.brand)} ${escapeHtml(product.model)} - ${escapeHtml(CATEGORY_LABEL[product.category])}</p>

<div class="score"><strong>${escapeHtml(scoreText)}</strong><span>${escapeHtml(band)} - coverage ${score.coverage}%</span></div>

<h2>Score parts</h2>
<table>
<thead><tr><th>Part</th><th class="num">Value</th><th class="num">Weight</th><th>Detail</th></tr></thead>
<tbody>
${partRows(analysis)}
</tbody>
</table>
<p class="small">The score compares repair, support and parts. It is not a prediction of product life.</p>

<h2>Life cost</h2>
<table>
<tbody>
<tr><td>Purchase price</td><td class="num">${money(lifeCost.purchase)}</td></tr>
<tr><td>Repairs</td><td class="num">${money(lifeCost.repairs)}</td></tr>
<tr><td>Energy over ${lifeCost.lifeYears} years${lifeCost.energyKnown ? '' : ' (no energy value)'}</td><td class="num">${money(lifeCost.energy)}</td></tr>
<tr><th>Total</th><th class="num">${money(lifeCost.total)}</th></tr>
<tr><th>Per year</th><th class="num">${money(lifeCost.perYear)}</th></tr>
</tbody>
</table>
<p class="small">Life estimate: ${lifeCost.lifeYears} years. Tariff: ${moneyPrecise(analysis.tariffAud)} per kWh.
Energy source: ${analysis.energySource}.</p>

<h2>Repair or replace</h2>
${decisionBlock}
${repairerBlock}

<h2>Sources</h2>
<ul>${product.sources.map((source) => `<li><a href="${escapeHtml(source)}">${escapeHtml(source)}</a></li>`).join('')}</ul>
<p class="small">Data reviewed ${escapeHtml(product.updatedAt)}. Prices are estimates. Check the seller before you buy.</p>
<footer>Made with longevity. Public data from iFixit and OpenStreetMap. No account and no tracking.</footer>
</main>
</body>
</html>`;
}