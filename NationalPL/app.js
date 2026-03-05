/* ================================================================
   National P&L – DOMO Pro Code Card
   Connects to GL_FINANCIALS dataset
   Shows ACT for closed months, FCST for open months (2026 only)
   ================================================================ */

// ── CONFIG ──────────────────────────────────────────────────────
var DATASET    = 'dataset';
var CURRENT_YEAR = new Date().getFullYear();     // 2026

// Map P&L Category Names from the dataset to display rows.
// Keys = exact PLCategoryName values from GL_FINANCIALS.
// Adjust these to match your actual data.
var REVENUE_CATEGORIES  = ['Service Revenue'];
var LABOR_CATEGORIES    = ['Total Labor'];
var BENEFITS_CATEGORIES = ['Benefits & Taxes'];
var SUPPLIES_CATEGORIES = ['Supplies & Materials'];
var CONTRACT_CATEGORIES = ['Contract Expenses'];
var FIELD_OH_CATEGORIES = ['Field Overhead'];
var REG_OH_CATEGORIES   = ['Regional Overhead'];
var CORP_OH_CATEGORIES  = ['Corporate Overhead'];
var DA_CATEGORIES       = ['Depreciation & Amortization', 'D&A'];

// Source values
var SRC_ACTUAL   = 'ACTUAL';
var SRC_BUDGET   = 'GL_BUDGET';
var SRC_FORECAST = 'GL_FORECAST';

// Month names for header display
var MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ── COLUMN INDICES (set after data arrives) ─────────────────────
var COL = {};

// ── DATA ────────────────────────────────────────────────────────
var rawRows = [];
var closingPeriod = null;   // Date: most_recent_closing_period

// ── P&L ROW DEFINITIONS ────────────────────────────────────────
// type: 'data'     = aggregated from dataset
// type: 'calc'     = calculated from other rows
// type: 'pct'      = percentage row
// type: 'spacer'   = blank separator
var PL_ROWS = [
  { id: 'revenue',       label: 'Total Revenue',       type: 'data',    categories: REVENUE_CATEGORIES,  sign: 1,  cssClass: 'row-header'   },
  { id: 'labor',         label: 'Total Labor',          type: 'data',    categories: LABOR_CATEGORIES,    sign: 1,  cssClass: 'row-category' },
  { id: 'benefits',      label: 'Benefits & Taxes',     type: 'data',    categories: BENEFITS_CATEGORIES, sign: 1,  cssClass: 'row-category' },
  { id: 'supplies',      label: 'Supplies & Materials', type: 'data',    categories: SUPPLIES_CATEGORIES, sign: 1,  cssClass: 'row-category' },
  { id: 'grossMargin',   label: 'Gross Margin',         type: 'calc',    calc: function(m){ return m.revenue - m.labor - m.benefits - m.supplies; }, cssClass: 'row-subtotal' },
  { id: 'grossMarginPct',label: 'GM %',                 type: 'pct',     numRow: 'grossMargin', denRow: 'revenue', cssClass: 'row-pct' },
  { id: 'sp1',           label: '',                     type: 'spacer' },
  { id: 'contract',      label: 'Contract Expenses',    type: 'data',    categories: CONTRACT_CATEGORIES, sign: 1,  cssClass: 'row-category' },
  { id: 'grossContrib',  label: 'Gross Contribution',   type: 'calc',    calc: function(m){ return m.grossMargin - m.contract; }, cssClass: 'row-subtotal' },
  { id: 'grossContribPct',label:'GC %',                 type: 'pct',     numRow: 'grossContrib', denRow: 'revenue', cssClass: 'row-pct' },
  { id: 'sp2',           label: '',                     type: 'spacer' },
  { id: 'fieldOH',       label: 'Field Overhead',       type: 'data',    categories: FIELD_OH_CATEGORIES, sign: 1,  cssClass: 'row-category' },
  { id: 'regionalOH',    label: 'Regional Overhead',    type: 'data',    categories: REG_OH_CATEGORIES,   sign: 1,  cssClass: 'row-category' },
  { id: 'corpOH',        label: 'Corporate Overhead',   type: 'data',    categories: CORP_OH_CATEGORIES,  sign: 1,  cssClass: 'row-category' },
  { id: 'totalOH',       label: 'Total Overhead',       type: 'calc',    calc: function(m){ return m.fieldOH + m.regionalOH + m.corpOH; }, cssClass: 'row-subtotal' },
  { id: 'sp3',           label: '',                     type: 'spacer' },
  { id: 'netIncome',     label: 'Net Income',           type: 'calc',    calc: function(m){ return m.grossContrib - m.totalOH; }, cssClass: 'row-subtotal' },
  { id: 'netIncomePct',  label: 'NI %',                 type: 'pct',     numRow: 'netIncome', denRow: 'revenue', cssClass: 'row-pct' },
  { id: 'sp4',           label: '',                     type: 'spacer' },
  { id: 'da',            label: 'D&A',                  type: 'data',    categories: DA_CATEGORIES,       sign: 1,  cssClass: 'row-category' },
  { id: 'ebitda',        label: 'Adj EBITDA',           type: 'calc',    calc: function(m){ return m.netIncome + m.da; }, cssClass: 'row-subtotal' },
  { id: 'ebitdaPct',     label: 'EBITDA %',             type: 'pct',     numRow: 'ebitda', denRow: 'revenue', cssClass: 'row-pct' }
];

// ── INIT ────────────────────────────────────────────────────────
// In DOMO Pro Code, domo.js may load async. Wait for it.
function waitForDomo(cb, retries) {
  if (typeof domo !== 'undefined') { cb(); return; }
  if (retries <= 0) { showError('domo.js did not load. Check manifest.json and dataset mapping.'); return; }
  setTimeout(function() { waitForDomo(cb, retries - 1); }, 200);
}
waitForDomo(fetchData, 25);

function fetchData() {
  domo.get('/data/v1/' + DATASET + '?limit=100000', { format: 'array-of-arrays' })
    .then(function(data) {
      if (!data || !data.columns || !data.rows || data.rows.length === 0) {
        showError('No data returned from dataset.');
        return;
      }
      // Map column indices
      data.columns.forEach(function(name, i) { COL[name] = i; });
      rawRows = data.rows;

      // Determine closing period from data
      closingPeriod = detectClosingPeriod(rawRows);
      render();
    })
    .catch(function(err) {
      showError('Error loading data: ' + (err.message || err));
    });
}

// ── DETECT CLOSING PERIOD ───────────────────────────────────────
function detectClosingPeriod(rows) {
  var maxDate = null;
  var cpIdx = COL['mostrecentclosingperiod'];
  if (cpIdx !== undefined) {
    for (var i = 0; i < rows.length; i++) {
      var d = parseDate(rows[i][cpIdx]);
      if (d && (!maxDate || d > maxDate)) maxDate = d;
    }
  }
  // Fallback: use the max MONTH with ACTUAL source
  if (!maxDate) {
    var mIdx = COL['MONTH'];
    var sIdx = COL['SOURCE'];
    for (var j = 0; j < rows.length; j++) {
      if (rows[j][sIdx] === SRC_ACTUAL) {
        var d2 = parseDate(rows[j][mIdx]);
        if (d2 && (!maxDate || d2 > maxDate)) maxDate = d2;
      }
    }
  }
  return maxDate;
}

// ── AGGREGATE DATA ──────────────────────────────────────────────
function aggregateData(rows) {
  // Build month keys for current year: 0..11
  var months = [];
  for (var m = 0; m < 12; m++) {
    var dt = new Date(CURRENT_YEAR, m, 1);
    months.push({
      index: m,
      date: dt,
      key: CURRENT_YEAR + '-' + pad2(m + 1),
      label: MONTH_ABBR[m] + '-' + String(CURRENT_YEAR).slice(2),
      isActual: closingPeriod ? dt <= closingPeriod : false
    });
  }

  var mIdx  = COL['MONTH'];
  var aIdx  = COL['AMOUNT'];
  var plIdx = COL['PLCategoryName'];
  var sIdx  = COL['SOURCE'];

  // Init buckets: actual[monthKey][plCategory], forecast[...], budget[...]
  var actual = {}, forecast = {}, budget = {};

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var d = parseDate(row[mIdx]);
    if (!d || d.getFullYear() !== CURRENT_YEAR) continue;

    var mk  = CURRENT_YEAR + '-' + pad2(d.getMonth() + 1);
    var cat = row[plIdx];
    var src = row[sIdx];
    var amt = parseFloat(row[aIdx]) || 0;

    var bucket;
    if (src === SRC_ACTUAL)        bucket = actual;
    else if (src === SRC_FORECAST) bucket = forecast;
    else if (src === SRC_BUDGET)   bucket = budget;
    else continue;

    if (!bucket[mk]) bucket[mk] = {};
    bucket[mk][cat] = (bucket[mk][cat] || 0) + amt;
  }

  return { months: months, actual: actual, forecast: forecast, budget: budget };
}

// ── COMPUTE P&L VALUES ──────────────────────────────────────────
function computePL(agg) {
  var months = agg.months;

  // For each month, pick ACTUAL if closed, else FORECAST
  // Also compute full-year budget
  var monthData = [];  // array of { values: { rowId: amount } } per month
  var budgetData = {}; // { rowId: amount } for full year budget

  for (var m = 0; m < 12; m++) {
    var mk = months[m].key;
    var isAct = months[m].isActual;
    var src = isAct ? agg.actual : agg.forecast;
    var monthBucket = src[mk] || {};
    var budgetBucket = agg.budget[mk] || {};

    var vals = {};
    // First pass: data rows
    for (var r = 0; r < PL_ROWS.length; r++) {
      var row = PL_ROWS[r];
      if (row.type === 'data') {
        var sum = 0;
        for (var c = 0; c < row.categories.length; c++) {
          sum += (monthBucket[row.categories[c]] || 0);
        }
        vals[row.id] = sum * row.sign;

        // Budget
        var bSum = 0;
        for (var bc = 0; bc < row.categories.length; bc++) {
          bSum += (budgetBucket[row.categories[bc]] || 0);
        }
        budgetData[row.id] = (budgetData[row.id] || 0) + bSum * row.sign;
      }
    }
    // Second pass: calc rows
    for (var r2 = 0; r2 < PL_ROWS.length; r2++) {
      var row2 = PL_ROWS[r2];
      if (row2.type === 'calc') {
        vals[row2.id] = row2.calc(vals);
      }
    }
    monthData.push(vals);
  }

  // Compute budget calc rows
  var budgetCalcVals = {};
  for (var rb = 0; rb < PL_ROWS.length; rb++) {
    var bRow = PL_ROWS[rb];
    if (bRow.type === 'data') {
      budgetCalcVals[bRow.id] = budgetData[bRow.id] || 0;
    }
  }
  for (var rb2 = 0; rb2 < PL_ROWS.length; rb2++) {
    var bRow2 = PL_ROWS[rb2];
    if (bRow2.type === 'calc') {
      budgetCalcVals[bRow2.id] = bRow2.calc(budgetCalcVals);
      budgetData[bRow2.id] = budgetCalcVals[bRow2.id];
    }
  }

  // Compute FY totals (sum of monthly)
  var fyData = {};
  for (var rf = 0; rf < PL_ROWS.length; rf++) {
    var fRow = PL_ROWS[rf];
    if (fRow.type === 'data' || fRow.type === 'calc') {
      var total = 0;
      for (var fm = 0; fm < 12; fm++) {
        total += (monthData[fm][fRow.id] || 0);
      }
      fyData[fRow.id] = total;
    }
  }

  // Variance = FY Total - Budget
  var varData = {};
  for (var rv = 0; rv < PL_ROWS.length; rv++) {
    var vRow = PL_ROWS[rv];
    if (vRow.type === 'data' || vRow.type === 'calc') {
      varData[vRow.id] = (fyData[vRow.id] || 0) - (budgetData[vRow.id] || 0);
    }
  }

  return {
    months: months,
    monthData: monthData,
    fyData: fyData,
    budgetData: budgetData,
    varData: varData
  };
}

// ── RENDER ──────────────────────────────────────────────────────
function render() {
  var agg = aggregateData(rawRows);
  var pl  = computePL(agg);

  renderHeader(pl.months);
  renderBody(pl);

  document.getElementById('loader').classList.add('hidden');
}

function renderHeader(months) {
  var thead = document.getElementById('pl-thead');
  thead.innerHTML = '';

  // Colgroup
  var table = document.getElementById('pl-table');
  var existingColgroup = table.querySelector('colgroup');
  if (existingColgroup) existingColgroup.remove();

  var colgroup = document.createElement('colgroup');
  var colLabel = document.createElement('col');
  colLabel.className = 'col-label';
  colgroup.appendChild(colLabel);
  for (var i = 0; i < 15; i++) { // 12 months + FY + Budget + Var
    var col = document.createElement('col');
    col.className = 'col-data';
    colgroup.appendChild(col);
  }
  table.insertBefore(colgroup, thead);

  // Row 1: Month labels
  var tr1 = document.createElement('tr');
  tr1.className = 'header-months';

  var th0 = document.createElement('th');
  th0.className = 'col-label-header';
  th0.textContent = 'P&L Category';
  tr1.appendChild(th0);

  for (var m = 0; m < months.length; m++) {
    var th = document.createElement('th');
    th.className = months[m].isActual ? 'act' : 'fcst';
    th.textContent = months[m].label;
    tr1.appendChild(th);
  }

  var thFY = document.createElement('th');
  thFY.className = 'fy-total';
  thFY.textContent = 'FY Total';
  tr1.appendChild(thFY);

  var thBud = document.createElement('th');
  thBud.className = 'budget-col';
  thBud.textContent = 'Budget';
  tr1.appendChild(thBud);

  var thVar = document.createElement('th');
  thVar.className = 'var-col';
  thVar.textContent = 'Fcst vs Bud';
  tr1.appendChild(thVar);

  thead.appendChild(tr1);

  // Row 2: ACT / FCST labels
  var tr2 = document.createElement('tr');
  tr2.className = 'header-type';

  var th02 = document.createElement('th');
  th02.className = 'col-label-header';
  tr2.appendChild(th02);

  for (var m2 = 0; m2 < months.length; m2++) {
    var th2 = document.createElement('th');
    th2.className = months[m2].isActual ? 'act' : 'fcst';
    th2.textContent = months[m2].isActual ? 'ACT' : 'FCST';
    tr2.appendChild(th2);
  }

  var th2FY = document.createElement('th');
  th2FY.className = 'fy-total';
  th2FY.textContent = '';
  tr2.appendChild(th2FY);

  var th2Bud = document.createElement('th');
  th2Bud.className = 'budget-col';
  th2Bud.textContent = '';
  tr2.appendChild(th2Bud);

  var th2Var = document.createElement('th');
  th2Var.className = 'var-col';
  th2Var.textContent = '';
  tr2.appendChild(th2Var);

  thead.appendChild(tr2);
}

function renderBody(pl) {
  var tbody = document.getElementById('pl-tbody');
  tbody.innerHTML = '';

  for (var r = 0; r < PL_ROWS.length; r++) {
    var rowDef = PL_ROWS[r];
    var tr = document.createElement('tr');
    if (rowDef.cssClass) tr.className = rowDef.cssClass;

    if (rowDef.type === 'spacer') {
      tr.className = 'row-spacer';
      var tdSpacer = document.createElement('td');
      tdSpacer.colSpan = 16;
      tr.appendChild(tdSpacer);
      tbody.appendChild(tr);
      continue;
    }

    // Label cell
    var tdLabel = document.createElement('td');
    tdLabel.textContent = rowDef.label;
    tr.appendChild(tdLabel);

    if (rowDef.type === 'pct') {
      // Percentage row
      for (var m = 0; m < 12; m++) {
        var num = pl.monthData[m][rowDef.numRow] || 0;
        var den = pl.monthData[m][rowDef.denRow] || 0;
        var pct = den !== 0 ? (num / den * 100) : 0;
        var td = document.createElement('td');
        td.textContent = formatPct(pct);
        tr.appendChild(td);
      }
      // FY %
      var fyNum = pl.fyData[rowDef.numRow] || 0;
      var fyDen = pl.fyData[rowDef.denRow] || 0;
      var fyPct = fyDen !== 0 ? (fyNum / fyDen * 100) : 0;
      var tdFY = document.createElement('td');
      tdFY.className = 'fy-total-cell';
      tdFY.textContent = formatPct(fyPct);
      tr.appendChild(tdFY);

      // Budget %
      var bNum = pl.budgetData[rowDef.numRow] || 0;
      var bDen = pl.budgetData[rowDef.denRow] || 0;
      var bPct = bDen !== 0 ? (bNum / bDen * 100) : 0;
      var tdB = document.createElement('td');
      tdB.className = 'budget-cell';
      tdB.textContent = formatPct(bPct);
      tr.appendChild(tdB);

      // Var pp
      var tdV = document.createElement('td');
      tdV.className = 'var-cell';
      var pp = fyPct - bPct;
      tdV.textContent = formatPctPP(pp);
      applyVarColor(tdV, pp);
      tr.appendChild(tdV);

    } else {
      // Data or calc row
      for (var m2 = 0; m2 < 12; m2++) {
        var val = pl.monthData[m2][rowDef.id] || 0;
        var td2 = document.createElement('td');
        td2.textContent = formatCurrency(val);
        if (val < 0) td2.classList.add('val-negative');
        tr.appendChild(td2);
      }
      // FY
      var fyVal = pl.fyData[rowDef.id] || 0;
      var tdFY2 = document.createElement('td');
      tdFY2.className = 'fy-total-cell';
      tdFY2.textContent = formatCurrency(fyVal);
      if (fyVal < 0) tdFY2.classList.add('val-negative');
      tr.appendChild(tdFY2);

      // Budget
      var bVal = pl.budgetData[rowDef.id] || 0;
      var tdB2 = document.createElement('td');
      tdB2.className = 'budget-cell';
      tdB2.textContent = formatCurrency(bVal);
      if (bVal < 0) tdB2.classList.add('val-negative');
      tr.appendChild(tdB2);

      // Variance
      var vVal = pl.varData[rowDef.id] || 0;
      var tdV2 = document.createElement('td');
      tdV2.className = 'var-cell';
      tdV2.textContent = formatCurrency(vVal);
      // For revenue: positive variance is good. For expenses: negative variance is good.
      // Simplify: use raw value sign for coloring
      applyVarColor(tdV2, vVal);
      tr.appendChild(tdV2);
    }

    tbody.appendChild(tr);
  }
}

// ── FORMATTING ──────────────────────────────────────────────────
function formatCurrency(val) {
  if (val === 0 || val === null || val === undefined) return '-';
  var abs = Math.abs(val);
  var formatted;
  if (abs >= 1000000) {
    formatted = '$' + (abs / 1000000).toFixed(1) + 'M';
  } else if (abs >= 1000) {
    formatted = '$' + Math.round(abs / 1000) + 'K';
  } else {
    formatted = '$' + Math.round(abs);
  }
  return val < 0 ? '(' + formatted + ')' : formatted;
}

function formatPct(val) {
  if (val === 0 || isNaN(val)) return '-';
  return val.toFixed(1) + '%';
}

function formatPctPP(val) {
  if (val === 0 || isNaN(val)) return '-';
  var sign = val > 0 ? '+' : '';
  return sign + val.toFixed(1) + 'pp';
}

function applyVarColor(el, val) {
  if (val > 0) el.classList.add('val-positive');
  else if (val < 0) el.classList.add('val-negative');
}

// ── UTILITIES ───────────────────────────────────────────────────
function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val;
  var d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

function showError(msg) {
  var loader = document.getElementById('loader');
  loader.innerHTML = '<span style="color:#d32f2f;">' + msg + '</span>';
}
