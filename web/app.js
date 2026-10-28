import {
  AUDIT_QUESTIONS,
  analyze,
  auditScore,
  computeLifeCost,
  decide,
  inspectBarcode,
  scoreProduct,
  searchProducts,
} from './score.js';

const state = {
  catalog: null,
  products: [],
  query: '',
  category: '',
  selectedId: null,
  compare: new Set(),
  auditAnswers: {},
  controls: { price: '', tariff: '', kwh: '', age: '', events: '' },
};

const el = {
  form: document.getElementById('search-form'),
  input: document.getElementById('search-input'),
  list: document.getElementById('result-list'),
  count: document.getElementById('result-count'),
  empty: document.getElementById('empty-state'),
  detail: document.getElementById('detail'),
  compare: document.getElementById('compare'),
  compareTable: document.getElementById('compare-table'),
  clearCompare: document.getElementById('clear-compare'),
  scanButton: document.getElementById('scan-button'),
  scanStatus: document.getElementById('scan-status'),
  toast: document.getElementById('toast'),
  chips: [...document.querySelectorAll('.chip')],
  install: document.getElementById('install-hint'),
};

let toastTimer = null;

function toast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.hidden = true;
  }, 3200);
}

function money(amount) {
  const rounded = Math.round(amount);
  return `A$${rounded.toLocaleString('en-AU')}`;
}

function moneyPrecise(amount) {
  return `A$${amount.toFixed(2)}`;
}

function label(category) {
  return { phone: 'Phone', laptop: 'Laptop', washer: 'Washing machine' }[category] ?? category;
}

function bandLabel(band) {
  return band === null ? 'No score' : band[0].toUpperCase() + band.slice(1);
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function controlsFor(product, catalog) {
  const numbers = {};
  if (state.controls.price !== '') numbers.price = Number(state.controls.price);
  if (state.controls.tariff !== '') numbers.tariffAud = Number(state.controls.tariff);
  if (state.controls.kwh !== '') numbers.annualKwh = Number(state.controls.kwh);
  if (state.controls.age !== '') numbers.ageYears = Number(state.controls.age);
  if (state.controls.events !== '') numbers.repairEvents = Number(state.controls.events);
  for (const [key, value] of Object.entries(numbers)) {
    if (!Number.isFinite(value)) delete numbers[key];
  }
  if (product.auditScore !== undefined && state.auditAnswers[product.id]) {
    numbers.repairScore10 = auditScore({ answers: auditFor(product), checkedOn: 'today' }) / 10;
  }
  return analyze(product, numbers, catalog.tariffAud);
}

function auditFor(product) {
  const answers = state.auditAnswers[product.id] ?? {};
  return AUDIT_QUESTIONS.filter((question) => question.id in answers).map((question) => ({
    id: question.id,
    answer: Boolean(answers[question.id]),
  }));
}

function renderList() {
  let hits;
  if (state.query === '') {
    // An empty query lists the whole catalog. The chip is a plain filter.
    hits = state.products
      .filter((product) => state.category === '' || product.category === state.category)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((product) => ({ product }));
  } else {
    hits = searchProducts(state.products, state.query, {
      category: state.category || undefined,
      limit: 50,
    });
  }

  el.count.textContent = hits.length === 0 ? '' : `${hits.length}`;
  el.list.innerHTML = '';
  el.empty.hidden = hits.length > 0;

  for (const hit of hits) {
    const product = hit.product;
    const analysis = analyze(product, {}, state.catalog.tariffAud);
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `result${product.id === state.selectedId ? ' is-active' : ''}`;
    button.innerHTML = `
      <span class="name">${escapeHtml(product.name)}</span>
      <span class="meta">
        <span>${escapeHtml(product.brand)}</span>
        <span class="badge ${analysis.score.band ?? 'none'}">${analysis.score.score === null ? 'No score' : `${analysis.score.score}/100`}</span>
      </span>`;
    button.addEventListener('click', () => selectProduct(product.id));
    item.append(button);
    el.list.append(item);
  }
}

function selectProduct(id) {
  state.selectedId = id;
  state.auditAnswers[id] = state.auditAnswers[id] ?? {};
  renderList();
  renderDetail();
  el.detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderDetail() {
  const product = state.products.find((entry) => entry.id === state.selectedId);
  if (!product) return;
  const analysis = controlsFor(product, state.catalog);
  const { score, lifeCost, decision } = analysis;

  const partRows = score.parts
    .map((part) => {
      const value = part.value === null ? 0 : Math.round(part.value);
      const text = part.value === null ? 'no data' : `${Math.round(part.value)}/100`;
      return `
        <div class="part">
          <span>${escapeHtml(part.label)} <span class="of">${part.weight}%</span></span>
          <span class="bar"><span style="width:${value}%"></span></span>
          <span class="pct">${text}</span>
        </div>`;
    })
    .join('');

  const verdict = decision
    ? `<div class="verdict ${decision.verdict}">
        <strong>${escapeHtml(decision.verdict)}</strong>
        <p>A repair costs ${money(decision.repairPerYear)} per remaining year. A replacement costs ${money(decision.replacePerYear)} per year of use. Ratio ${decision.ratio}. Remaining life ${decision.remainingYears} years.</p>
      </div>`
    : '<p class="audit-note">Set the product age to get a repair-or-replace verdict.</p>';

  const auditBlock = product.ifixit && product.ifixit.score !== null
    ? ''
    : `<h3>Self-audit</h3>
       <p class="audit-note">No published repair score. Answer the questions to get a score.</p>
       <div class="audit" id="audit-box">
         ${AUDIT_QUESTIONS.map(
           (question) => `<label><input type="checkbox" data-audit="${question.id}" ${state.auditAnswers[product.id]?.[question.id] ? 'checked' : ''}> <span>${escapeHtml(question.text)} <em>(${question.weight})</em></span></label>`,
         ).join('')}
       </div>`;

  const sources = product.sources
    .map((url) => `<li><a href="${escapeHtml(url)}" rel="noreferrer noopener" target="_blank">${escapeHtml(url)}</a></li>`)
    .join('');

  const comparePressed = state.compare.has(product.id);

  el.detail.innerHTML = `
    <div class="detail-head">
      <div>
        <h2>${escapeHtml(product.name)}</h2>
        <p class="sub">${escapeHtml(product.brand)} ${escapeHtml(product.model)} - ${escapeHtml(label(product.category))}</p>
      </div>
      <div class="scorebox">
        <div>
          <div class="num">${score.score === null ? '--' : score.score}<span class="of">/100</span></div>
          <div class="band">${escapeHtml(bandLabel(score.band))}</div>
        </div>
        <div class="cov">coverage<br>${score.coverage}%</div>
      </div>
    </div>

    <div class="parts">${partRows}</div>

    <h3>Life cost</h3>
    <table class="kv">
      <tr><td>Purchase price</td><td>${money(lifeCost.purchase)}</td></tr>
      <tr><td>Repairs</td><td>${money(lifeCost.repairs)}</td></tr>
      <tr><td>Energy over ${lifeCost.lifeYears} years${lifeCost.energyKnown ? '' : ' (no value)'}</td><td>${money(lifeCost.energy)}</td></tr>
      <tr class="total"><td>Total</td><td>${money(lifeCost.total)}</td></tr>
      <tr class="total"><td>Per year</td><td>${money(lifeCost.perYear)}</td></tr>
    </table>
    <p class="audit-note">Life estimate ${lifeCost.lifeYears} years. Tariff ${moneyPrecise(analysis.tariffAud)} per kWh. Energy source: ${analysis.energySource}.</p>

    <h3>Your numbers</h3>
    <div class="controls">
      <label class="field">Price (A$)<input data-control="price" type="number" min="0" step="10" value="${state.controls.price}" placeholder="${product.price.amount}"></label>
      <label class="field">Tariff (A$/kWh)<input data-control="tariff" type="number" min="0" step="0.01" value="${state.controls.tariff}" placeholder="${state.catalog.tariffAud}"></label>
      <label class="field">Yearly kWh<input data-control="kwh" type="number" min="0" step="10" value="${state.controls.kwh}" placeholder="${product.energy ? product.energy.annualKwh : 'unknown'}"></label>
      <label class="field">Repairs<input data-control="events" type="number" min="0" step="1" value="${state.controls.events}" placeholder="${product.repairEvents}"></label>
      <label class="field">Age (years)<input data-control="age" type="number" min="0" step="0.5" value="${state.controls.age}" placeholder="0"></label>
    </div>

    <h3>Repair or replace</h3>
    ${verdict}
    ${auditBlock}

    <div class="actions">
      <button type="button" id="compare-toggle">${comparePressed ? 'Remove from compare' : 'Add to compare'}</button>
      <button type="button" class="secondary" id="print-brief">Print brief</button>
      ${product.partsUrl ? `<a class="secondary" href="${escapeHtml(product.partsUrl)}" target="_blank" rel="noreferrer noopener"><button type="button" class="secondary">Spare parts</button></a>` : ''}
    </div>

    <h3>Sources</h3>
    <ul class="sources">${sources}</ul>
    <p class="audit-note">Data reviewed ${escapeHtml(product.updatedAt)}. Prices are estimates.</p>
  `;

  el.detail.querySelectorAll('[data-control]').forEach((input) => {
    input.addEventListener('input', () => {
      state.controls[input.dataset.control] = input.value;
      renderDetail();
      const again = el.detail.querySelector(`[data-control="${input.dataset.control}"]`);
      if (again) {
        again.focus();
        again.setSelectionRange?.(again.value.length, again.value.length);
      }
    });
  });

  el.detail.querySelectorAll('[data-audit]').forEach((input) => {
    input.addEventListener('change', () => {
      state.auditAnswers[product.id] = state.auditAnswers[product.id] ?? {};
      state.auditAnswers[product.id][input.dataset.audit] = input.checked;
      renderDetail();
    });
  });

  document.getElementById('compare-toggle')?.addEventListener('click', () => {
    if (state.compare.has(product.id)) state.compare.delete(product.id);
    else state.compare.add(product.id);
    renderDetail();
    renderCompare();
  });

  document.getElementById('print-brief')?.addEventListener('click', () => window.print());
}

function renderCompare() {
  const rows = [...state.compare]
    .map((id) => state.products.find((product) => product.id === id))
    .filter(Boolean)
    .map((product) => {
      const analysis = analyze(product, {}, state.catalog.tariffAud);
      return { product, analysis };
    });

  el.compare.hidden = rows.length === 0;
  if (rows.length === 0) {
    el.compareTable.innerHTML = '';
    return;
  }

  const scores = rows.map((row) => row.analysis.score.score).filter((value) => value !== null);
  const bestScore = scores.length ? Math.max(...scores) : null;
  const bestCost = Math.min(...rows.map((row) => row.analysis.lifeCost.perYear));

  rows.sort((a, b) => (b.analysis.score.score ?? -1) - (a.analysis.score.score ?? -1));

  el.compareTable.innerHTML = `
    <thead><tr><th>Product</th><th class="num">Score</th><th class="num">Coverage</th><th class="num">Life</th><th class="num">Per year</th><th></th></tr></thead>
    <tbody>
      ${rows
        .map((row) => {
          const { product, analysis } = row;
          const best = analysis.score.score === bestScore || analysis.lifeCost.perYear === bestCost;
          return `<tr class="${best ? 'best' : ''}">
            <td>${escapeHtml(product.name)}</td>
            <td class="num">${analysis.score.score ?? '-'}</td>
            <td class="num">${analysis.score.coverage}%</td>
            <td class="num">${analysis.lifeCost.lifeYears}</td>
            <td class="num">${money(analysis.lifeCost.perYear)}</td>
            <td class="num"><button type="button" class="ghost small" data-remove="${product.id}">Remove</button></td>
          </tr>`;
        })
        .join('')}
    </tbody>`;

  el.compareTable.querySelectorAll('[data-remove]').forEach((button) => {
    button.addEventListener('click', () => {
      state.compare.delete(button.dataset.remove);
      renderDetail();
      renderCompare();
    });
  });
}

function applyScan(code) {
  const result = inspectBarcode(code);
  if (!result.ok) {
    el.scanStatus.hidden = false;
    el.scanStatus.textContent = result.reason;
    return;
  }
  el.scanStatus.hidden = false;
  const match = state.products.find((product) =>
    product.barcodes.some(
      (barcode) =>
        barcode === result.info.code ||
        barcode.padStart(14, '0') === result.info.gtin14 ||
        barcode.slice(-12) === result.info.gtin14.slice(-12),
    ),
  );
  if (match) {
    el.scanStatus.textContent = `Barcode ${result.info.format.toUpperCase()} matched ${match.name}.`;
    selectProduct(match.id);
  } else {
    el.scanStatus.textContent = `Valid ${result.info.format.toUpperCase()} code. This product is not in the index yet.`;
  }
}

async function startScanner() {
  if (!('BarcodeDetector' in window)) {
    el.scanStatus.hidden = false;
    el.scanStatus.textContent = 'This browser has no barcode detector. Type the barcode in the search box instead.';
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    el.scanStatus.hidden = false;
    el.scanStatus.textContent = 'No camera access. Type the barcode in the search box instead.';
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch {
    el.scanStatus.hidden = false;
    el.scanStatus.textContent = 'Camera permission was refused. Type the barcode in the search box instead.';
    return;
  }

  const video = document.createElement('video');
  video.playsInline = true;
  video.muted = true;
  video.srcObject = stream;
  video.style.cssText = 'width:100%;max-width:420px;border-radius:12px;margin-top:12px';
  el.scanStatus.hidden = false;
  el.scanStatus.textContent = 'Point the camera at the barcode.';
  el.scanStatus.after(video);
  await video.play();

  const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
  let stopped = false;
  const stop = () => {
    stopped = true;
    stream.getTracks().forEach((track) => track.stop());
    video.remove();
  };

  const tick = async () => {
    if (stopped) return;
    try {
      const codes = await detector.detect(video);
      if (codes.length > 0) {
        stop();
        applyScan(codes[0].rawValue);
        return;
      }
    } catch {
      // Keep trying while the camera runs.
    }
    setTimeout(tick, 350);
  };
  setTimeout(tick, 500);
  video.addEventListener('click', stop);
}

el.form.addEventListener('submit', (event) => {
  event.preventDefault();
  state.query = el.input.value.trim();
  renderList();
});

el.input.addEventListener('input', () => {
  state.query = el.input.value.trim();
  renderList();
});

el.chips.forEach((chip) => {
  chip.addEventListener('click', () => {
    state.category = chip.dataset.category ?? '';
    el.chips.forEach((other) => other.classList.toggle('is-active', other === chip));
    renderList();
  });
});

el.scanButton.addEventListener('click', () => {
  startScanner();
});

el.clearCompare.addEventListener('click', () => {
  state.compare.clear();
  renderDetail();
  renderCompare();
});

async function boot() {
  try {
    const response = await fetch('./catalog.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.catalog = await response.json();
    state.products = state.catalog.products;
  } catch (error) {
    el.detail.innerHTML = `<div class="placeholder"><h2>The catalog did not load</h2>
      <p>Run <code>longevity build</code> in the project folder, then reload this page.</p></div>`;
    el.empty.hidden = true;
    return;
  }

  el.input.value = state.query;
  renderList();
  if (state.products.length > 0) {
    const best = [...state.products].sort(
      (a, b) => (scoreProduct(b).score ?? -1) - (scoreProduct(a).score ?? -1),
    )[0];
    selectProduct(best.id);
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

boot();