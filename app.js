
// ═══════════════════════════════════════════════════ STATE
let state = {
  parsedData: null,
  fileName: '',
  extraSelected: [],
  charts: {},
  results: null,
};

const SAMPLE_CSV = `Month,Sales,Units,Marketing_Spend
Jan 2024,42000,210,5000
Feb 2024,38500,190,4500
Mar 2024,51000,260,6200
Apr 2024,47000,235,5800
May 2024,53000,270,6500
Jun 2024,61000,310,7400
Jul 2024,58000,295,7000
Aug 2024,65000,330,7800
Sep 2024,72000,360,8600
Oct 2024,69000,345,8200
Nov 2024,84000,420,10000
Dec 2024,91000,460,11000`;

// ═══════════════════════════════════════════════════ CHART.JS DEFAULTS
Chart.defaults.color = '#4b6280';
Chart.defaults.borderColor = '#1c2a3a';
Chart.defaults.font.family = "'Space Mono', monospace";
Chart.defaults.font.size = 10;

// ═══════════════════════════════════════════════════ HELPERS
function parseCSV(text) {
  const lines = text.trim().split('\n').filter(Boolean);
  if (lines.length < 2) return null;
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g,''));
  const rows = lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim().replace(/"/g,''));
    const obj = {};
    headers.forEach((h,i) => obj[h] = vals[i] || '');
    return obj;
  });
  return { headers, rows };
}

function detectColumns(headers, rows) {
  const numericCols = headers.filter(h =>
    rows.slice(0,10).some(r => !isNaN(parseFloat(r[h])) && r[h] !== '')
  );
  const dateLike = headers.filter(h =>
    ['date','month','year','period','time','week','quarter'].some(k => h.toLowerCase().includes(k))
  );
  return { numericCols, dateLike };
}

function linReg(ys) {
  const n = ys.length;
  const xs = ys.map((_,i) => i);
  const xm = xs.reduce((a,b)=>a+b,0)/n;
  const ym = ys.reduce((a,b)=>a+b,0)/n;
  const slope = xs.reduce((acc,x,i)=>acc+(x-xm)*(ys[i]-ym),0) /
                xs.reduce((acc,x)=>acc+(x-xm)**2,0);
  const intercept = ym - slope*xm;
  const preds = xs.map(x => slope*x + intercept);
  const ssRes = ys.reduce((a,y,i)=>a+(y-preds[i])**2,0);
  const ssTot = ys.reduce((a,y)=>a+(y-ym)**2,0);
  const r2 = 1 - ssRes/ssTot;
  const rmse = Math.sqrt(ssRes/n);
  return { slope, intercept, r2, rmse, preds, ym };
}

function generateInsights(model, targetCol) {
  const pct    = ((model.slope/model.ym)*100).toFixed(1);
  const r2pct  = (model.r2*100).toFixed(1);
  const errPct = (model.rmse/model.ym*100).toFixed(1);
  const lines  = [];

  if (model.slope > 0)
    lines.push(`📈 <b>Upward trend</b> — "${targetCol}" grows by <b>${Math.abs(model.slope).toFixed(1)}</b> units/period (+${pct}% of avg), suggesting healthy momentum.`);
  else
    lines.push(`📉 <b>Downward trend</b> — "${targetCol}" declines by <b>${Math.abs(model.slope).toFixed(1)}</b> units/period (${pct}% of avg). Review contributing factors.`);

  if (model.r2 > 0.85)
    lines.push(`🎯 <b>High accuracy</b> — R² of ${r2pct}% means the linear trend explains most variance. Forecasts are reliable for near-term planning.`);
  else if (model.r2 > 0.5)
    lines.push(`⚠️ <b>Moderate fit</b> — R² of ${r2pct}% captures general direction but some variance is unexplained. Use forecasts as a guide, not a guarantee.`);
  else
    lines.push(`🔴 <b>Low fit</b> — R² of ${r2pct}% suggests non-linear or volatile data. A more complex model may be needed.`);

  if (parseFloat(errPct) < 10)
    lines.push(`✅ <b>Low error</b> — RMSE is only ${errPct}% of the mean, indicating predictions stay close to actuals.`);
  else
    lines.push(`📊 <b>Error margin</b> is ${errPct}% of the mean — consider adding more features or a non-linear model.`);

  return lines.join('<br>');
}

function fmt(n) { return Number(n).toLocaleString(); }
function destroyChart(id) { if (state.charts[id]) { state.charts[id].destroy(); delete state.charts[id]; } }

// ═══════════════════════════════════════════════════ NAVIGATION
function goTo(stage) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById('sec-' + stage).classList.add('active');
  const stages = ['upload','mapping','results'];
  stages.forEach((s,i) => {
    const dot = document.getElementById('dot-'+i);
    const lbl = document.getElementById('lbl-'+i);
    const on  = s === stage;
    dot.classList.toggle('active', on);
    lbl.classList.toggle('active', on);
  });
  document.getElementById('btn-reset').style.display = stage === 'upload' ? 'none' : '';
}

function switchTab(name, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');
}

function resetApp() {
  state = { parsedData:null, fileName:'', extraSelected:[], charts:{}, results:null };
  Object.keys(state.charts||{}).forEach(destroyChart);
  goTo('upload');
}

// ═══════════════════════════════════════════════════ FILE LOADING
function loadSampleData() {
  ingestCSV(SAMPLE_CSV, 'sample_sales.csv');
}

function handleFileInput(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => ingestCSV(ev.target.result, file.name);
  reader.readAsText(file);
}

function ingestCSV(text, name) {
  const parsed = parseCSV(text);
  if (!parsed || parsed.rows.length < 3) {
    alert('Could not parse CSV. Ensure it has headers and at least 3 rows.');
    return;
  }
  state.parsedData = parsed;
  state.fileName   = name;

  const { numericCols, dateLike } = detectColumns(parsed.headers, parsed.rows);

  // Populate selects
  ['sel-label','sel-target'].forEach(id => {
    const sel = document.getElementById(id);
    sel.innerHTML = parsed.headers.map(h => `<option value="${h}">${h}</option>`).join('');
  });
  document.getElementById('sel-label').value  = dateLike[0]   || parsed.headers[0];
  document.getElementById('sel-target').value = numericCols[0] || parsed.headers[0];

  // Extra cols toggles
  state.extraSelected = numericCols.slice(1,3);
  buildExtraToggles(numericCols, parsed.headers);

  // Preview table
  buildPreviewTable(parsed, dateLike[0]||parsed.headers[0], numericCols[0]||'');

  document.getElementById('file-name-label').textContent = 'File loaded: ' + name;
  document.getElementById('file-stats').textContent = `${parsed.rows.length} rows · ${parsed.headers.length} columns detected`;

  goTo('mapping');
}

function buildExtraToggles(numericCols, allHeaders) {
  const grp = document.getElementById('extra-cols-group');
  grp.innerHTML = '';
  const labelVal  = document.getElementById('sel-label').value;
  const targetVal = document.getElementById('sel-target').value;
  numericCols.filter(h => h !== labelVal && h !== targetVal).forEach(h => {
    const btn = document.createElement('button');
    btn.className = 'toggle-btn' + (state.extraSelected.includes(h) ? ' on' : '');
    btn.textContent = h;
    btn.onclick = () => {
      if (state.extraSelected.includes(h)) {
        state.extraSelected = state.extraSelected.filter(c => c !== h);
        btn.classList.remove('on');
      } else if (state.extraSelected.length < 3) {
        state.extraSelected.push(h);
        btn.classList.add('on');
      }
    };
    grp.appendChild(btn);
  });
}

function buildPreviewTable(parsed, labelCol, targetCol) {
  const table = document.getElementById('preview-table');
  const ths = parsed.headers.map(h => {
    const cls = h===targetCol ? 'col-target' : h===labelCol ? 'col-label' : '';
    const sfx = h===targetCol ? ' 🎯' : h===labelCol ? ' 🏷️' : '';
    return `<th class="${cls}">${h}${sfx}</th>`;
  }).join('');
  const rows = parsed.rows.slice(0,5).map(r => {
    const tds = parsed.headers.map(h => `<td>${r[h]}</td>`).join('');
    return `<tr>${tds}</tr>`;
  }).join('');
  table.innerHTML = `<thead><tr>${ths}</tr></thead><tbody>${rows}</tbody>`;
}

// ═══════════════════════════════════════════════════ DROP ZONE
const dz = document.getElementById('drop-zone');
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
dz.addEventListener('drop', e => {
  e.preventDefault(); dz.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) { const r = new FileReader(); r.onload = ev => ingestCSV(ev.target.result, file.name); r.readAsText(file); }
});

// ═══════════════════════════════════════════════════ RUN PIPELINE
function runPipeline() {
  const { parsedData } = state;
  if (!parsedData) return;

  const labelCol  = document.getElementById('sel-label').value;
  const targetCol = document.getElementById('sel-target').value;
  const forecastN = parseInt(document.getElementById('forecast-range').value);

  const ys     = parsedData.rows.map(r => parseFloat(r[targetCol])).filter(v => !isNaN(v));
  const labels = parsedData.rows.map(r => r[labelCol] || '');

  if (ys.length < 3) { alert('Need at least 3 numeric rows in the target column.'); return; }

  const model = linReg(ys);

  // Forecasts
  const forecasts = Array.from({length: forecastN}, (_,i) => {
    const xi   = ys.length + i;
    const pred = Math.round(model.slope * xi + model.intercept);
    return { label: `+${i+1}mo`, predicted: pred, lower: Math.round(pred*.88), upper: Math.round(pred*1.12) };
  });

  // Chart data
  const chartData = ys.map((y,i) => ({
    label:     labels[i] || `Row ${i+1}`,
    actual:    y,
    predicted: Math.round(model.preds[i]),
    residual:  Math.round(y - model.preds[i]),
  }));

  // Extra correlation data
  const extraData = state.extraSelected.map(col => ({
    col,
    points: parsedData.rows.map((r,i) => ({ x: parseFloat(r[col]), y: ys[i], label: labels[i] }))
                           .filter(p => !isNaN(p.x) && !isNaN(p.y)),
  }));

  state.results = { model, chartData, forecasts, extraData, ys, labels, targetCol, labelCol, forecastN };

  renderResults();
  goTo('results');
  // Switch to overview tab
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelector('.tab-btn').classList.add('active');
  document.getElementById('tab-overview').classList.add('active');
}

// ═══════════════════════════════════════════════════ RENDER RESULTS
function renderResults() {
  const { model, chartData, forecasts, extraData, ys, targetCol, forecastN } = state.results;

  // ── KPIs ──
  const kpis = [
    { icon:'📊', label:'Data Points',    value: ys.length,                                 color:'var(--accent)', sub: state.fileName },
    { icon:'🎯', label:'R² Accuracy',    value: (model.r2*100).toFixed(1)+'%',             color: model.r2>.85?'var(--green)':model.r2>.6?'var(--amber)':'var(--red)', sub:'Model fit score' },
    { icon:'📉', label:'RMSE Error',     value: model.rmse.toFixed(0),                      color:'var(--amber)', sub:'Root mean sq. error' },
    { icon:'📈', label:'Slope',          value: model.slope.toFixed(1),                     color: model.slope>0?'var(--green)':'var(--red)', sub: model.slope>0?'Upward ↑':'Downward ↓' },
    { icon:'🔮', label:'Next Period',    value: fmt(forecasts[0]?.predicted),               color:'var(--purple)', sub:'Forecast +1' },
    { icon:'📆', label:`+${forecastN} Forecast`, value: fmt(forecasts[forecastN-1]?.predicted), color:'var(--pink)', sub:`Period +${forecastN}` },
  ];
  document.getElementById('kpi-grid').innerHTML = kpis.map(k => `
    <div class="kpi-card" style="border-top-color:${k.color}">
      <div class="kpi-label">${k.icon} ${k.label}</div>
      <div class="kpi-value" style="color:${k.color}">${k.value}</div>
      <div class="kpi-sub">${k.sub}</div>
    </div>`).join('');

  // ── Insights ──
  document.getElementById('insight-text').innerHTML = generateInsights(model, targetCol);

  // ── Chart 1: Actual vs Predicted ──
  document.getElementById('chart1-title').textContent = `Actual vs Predicted — ${targetCol}`;
  destroyChart('actual-pred');
  state.charts['actual-pred'] = new Chart(document.getElementById('chart-actual-pred'), {
    type: 'line',
    data: {
      labels: chartData.map(d => d.label),
      datasets: [
        { label:'Actual',        data: chartData.map(d=>d.actual),    borderColor:'#38bdf8', backgroundColor:'rgba(56,189,248,.1)', borderWidth:2, pointRadius:3, tension:.35 },
        { label:'Predicted (LR)',data: chartData.map(d=>d.predicted), borderColor:'#fbbf24', backgroundColor:'transparent',          borderWidth:2, pointRadius:0, borderDash:[5,3], tension:.35 },
      ]
    },
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ labels:{ color:'#4b6280' } } }, scales:{ x:{ ticks:{ maxTicksLimit:9 } }, y:{ ticks:{ callback: v => fmt(v) } } } }
  });

  // ── Chart 2: Residuals ──
  destroyChart('residuals');
  state.charts['residuals'] = new Chart(document.getElementById('chart-residuals'), {
    type: 'bar',
    data: {
      labels: chartData.map(d=>d.label),
      datasets: [{ label:'Residual', data: chartData.map(d=>d.residual), backgroundColor: chartData.map(d=>d.residual>=0?'rgba(52,211,153,.7)':'rgba(248,113,113,.7)'), borderRadius:3 }]
    },
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ labels:{ color:'#4b6280' } } }, scales:{ x:{ ticks:{ maxTicksLimit:9 } }, y:{ ticks:{ callback: v => fmt(v) } } } }
  });

  // ── Chart 3: Forecast ──
  document.getElementById('forecast-badge').textContent = `+${forecastN} periods`;
  const fLabels  = [...chartData.slice(-5).map(d=>d.label), ...forecasts.map(f=>f.label)];
  const fActual  = [...chartData.slice(-5).map(d=>d.actual),   ...Array(forecastN).fill(null)];
  const fFitted  = [...chartData.slice(-5).map(d=>d.predicted),...Array(forecastN).fill(null)];
  const fFore    = [...Array(5).fill(null), ...forecasts.map(f=>f.predicted)];
  const fUpper   = [...Array(5).fill(null), ...forecasts.map(f=>f.upper)];
  const fLower   = [...Array(5).fill(null), ...forecasts.map(f=>f.lower)];

  destroyChart('forecast');
  state.charts['forecast'] = new Chart(document.getElementById('chart-forecast'), {
    type: 'line',
    data: {
      labels: fLabels,
      datasets: [
        { label:'Upper',         data:fUpper,  borderColor:'transparent', backgroundColor:'rgba(52,211,153,.15)', fill:'+1', pointRadius:0, tension:.35 },
        { label:'Lower',         data:fLower,  borderColor:'transparent', backgroundColor:'rgba(52,211,153,.15)', fill:false, pointRadius:0, tension:.35 },
        { label:'Actual',        data:fActual, borderColor:'#38bdf8', borderWidth:2, pointRadius:3, tension:.35, fill:false },
        { label:'Fitted',        data:fFitted, borderColor:'#fbbf24', borderWidth:1.5, borderDash:[4,2], pointRadius:0, tension:.35, fill:false },
        { label:'Forecast',      data:fFore,   borderColor:'#34d399', borderWidth:2.5, pointRadius:5, pointBackgroundColor:'#34d399', tension:.35, fill:false },
      ]
    },
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ labels:{ color:'#4b6280', filter: i => !['Upper','Lower'].includes(i.text) } } }, scales:{ x:{}, y:{ ticks:{ callback: v=>fmt(v) } } } }
  });

  // ── Forecast Cards ──
  document.getElementById('forecast-cards').innerHTML = forecasts.map(f => `
    <div class="forecast-card">
      <div class="fc-period">Period ${f.label}</div>
      <div class="fc-value">${fmt(f.predicted)}</div>
      <div class="fc-range">${fmt(f.lower)} – ${fmt(f.upper)}</div>
    </div>`).join('');

  // ── Correlation Charts ──
  const corrWrap = document.getElementById('correlation-charts');
  // Remove old scatter charts
  corrWrap.querySelectorAll('.scatter-panel').forEach(el => el.remove());
  Object.keys(state.charts).filter(k=>k.startsWith('scatter')).forEach(k => { destroyChart(k); });

  extraData.forEach((ed, idx) => {
    const id = `scatter-${idx}`;
    const panel = document.createElement('div');
    panel.className = 'chart-panel scatter-panel';
    panel.innerHTML = `<div class="section-title"><div class="bar"></div><span>${ed.col} vs ${targetCol}</span></div><div class="chart-wrap" style="height:200px"><canvas id="${id}"></canvas></div>`;
    corrWrap.insertBefore(panel, corrWrap.querySelector('.chart-panel'));
    destroyChart(id);
    state.charts[id] = new Chart(document.getElementById(id), {
      type: 'scatter',
      data: { datasets: [{ label:`${ed.col} vs ${targetCol}`, data: ed.points.map(p=>({x:p.x,y:p.y})), backgroundColor:'rgba(56,189,248,.75)', pointRadius:5 }] },
      options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ labels:{ color:'#4b6280' } } }, scales:{ x:{ ticks:{ callback:v=>fmt(v) } }, y:{ ticks:{ callback:v=>fmt(v) } } } }
    });
  });

  // ── Stats Table ──
  const statsRows = [
    ['Algorithm',    'Linear Regression'],
    ['Slope (β₁)',   model.slope.toFixed(4)],
    ['Intercept (β₀)', model.intercept.toFixed(2)],
    ['R² Score',     (model.r2*100).toFixed(2)+'%'],
    ['RMSE',         model.rmse.toFixed(2)],
    ['Mean Value',   model.ym.toFixed(2)],
    ['Trend',        model.slope>0?'📈 Positive':'📉 Negative'],
    ['Samples',      ys.length],
  ];
  document.getElementById('stats-table').innerHTML = statsRows.map(([k,v]) =>
    `<div class="stats-row"><span class="sk">${k}</span><span class="sv">${v}</span></div>`
  ).join('');

  // ── Data Table ──
  document.getElementById('data-rows-badge').textContent = `${chartData.length} rows`;
  const headers = `<thead><tr>${['#','Label','Actual','Predicted','Residual','Error %'].map(h=>`<th>${h}</th>`).join('')}</tr></thead>`;
  const rows = chartData.map((d,i) => {
    const errPct = ((Math.abs(d.residual)/d.actual)*100).toFixed(1);
    const errCls = parseFloat(errPct)<5?'err-low':parseFloat(errPct)<15?'err-mid':'err-hi';
    return `<tr>
      <td>${i+1}</td>
      <td class="lbl">${d.label}</td>
      <td>${fmt(d.actual)}</td>
      <td class="pred">${fmt(d.predicted)}</td>
      <td class="${d.residual>=0?'pos':'neg'}">${d.residual>=0?'+':''}${fmt(d.residual)}</td>
      <td class="${errCls}">${errPct}%</td>
    </tr>`;
  }).join('');
  document.getElementById('data-table').innerHTML = headers + `<tbody>${rows}</tbody>`;
}
