/* ================================================================
   National P&L – Quarterly View
   Same data source as NationalPL, aggregated into Q1–Q4 + FY Total.
   A quarter is ACT only when ALL months in that quarter are closed.
   ================================================================ */
(function () {
  'use strict';

  var DATA_URL = '/data/v1/dataset?limit=5000000';

  /* ── P&L Structure ──
     [label, matchKey, type]
     type: header | category | subtotal | spacer | pct */
  var PL_ROWS = [
    ['Revenue',              null,                   'header'],
    ['Service Revenue',      'Service Revenue',      'category'],
    ['Total Revenue',        '_totalRevenue',        'subtotal'],
    [null,                   null,                   'spacer'],

    ['Cost of Goods Sold',   null,                   'header'],
    ['Total Labor',          'Total Labor',          'category'],
    ['Contract Expenses',    'Contract Expenses',    'category'],
    ['Supplies & Materials', 'Supplies & Materials', 'category'],
    ['Total COGS',           '_totalCOGS',           'subtotal'],
    [null,                   null,                   'spacer'],

    ['Gross Profit',         '_grossProfit',         'subtotal'],
    ['GP %',                 '_gpPct',               'pct'],
    [null,                   null,                   'spacer'],

    ['Operating Expenses',   null,                   'header'],
    ['Field Overhead',       'Field Overhead',       'category'],
    ['HQ Overhead',          'HQ Overhead',          'category'],
    ['Sales Overhead',       'Sales Overhead',       'category'],
    ['Benefits & Taxes',     'Benefits & Taxes',     'category'],
    ['Total OpEx',           '_totalOpEx',           'subtotal'],
    [null,                   null,                   'spacer'],

    ['Other Income/Expense', null,                   'header'],
    ['Income Taxes',         'Income Taxes',         'category'],
    ['Other Income/ Expense','Other Income/ Expense','category'],
    ['Total Other',          '_totalOther',          'subtotal'],
    [null,                   null,                   'spacer'],

    ['Net Income',           '_netIncome',           'subtotal'],
    ['NI %',                 '_niPct',               'pct']
  ];

  var REVENUE_CATS  = ['Service Revenue'];
  var COGS_CATS     = ['Total Labor', 'Contract Expenses', 'Supplies & Materials'];
  var OPEX_CATS     = ['Field Overhead', 'HQ Overhead', 'Sales Overhead', 'Benefits & Taxes'];
  var OTHER_CATS    = ['Income Taxes', 'Other Income/ Expense'];

  var CREDIT_CATS   = ['Service Revenue', 'Other Income/ Expense'];

  var METRICS_MAP = {
    'Other Expense (Income)': 'Other Income/ Expense'
  };

  var VALID_CATS = {};
  PL_ROWS.forEach(function (r) { if (r[1] && r[1][0] !== '_') VALID_CATS[r[1]] = true; });

  /* Quarter definitions: label, month keys */
  var CURRENT_YEAR = '2026';
  var QUARTERS = [
    { label: 'Q1 26', months: [CURRENT_YEAR + '-01', CURRENT_YEAR + '-02', CURRENT_YEAR + '-03'] },
    { label: 'Q2 26', months: [CURRENT_YEAR + '-04', CURRENT_YEAR + '-05', CURRENT_YEAR + '-06'] },
    { label: 'Q3 26', months: [CURRENT_YEAR + '-07', CURRENT_YEAR + '-08', CURRENT_YEAR + '-09'] },
    { label: 'Q4 26', months: [CURRENT_YEAR + '-10', CURRENT_YEAR + '-11', CURRENT_YEAR + '-12'] }
  ];

  /* ── Formatting ── */
  function fmt(val) {
    if (val == null || isNaN(val)) return '';
    var neg = val < 0;
    var abs = Math.abs(val);
    var str = '$' + Math.round(abs).toLocaleString('en-US');
    return neg ? '(' + str + ')' : str;
  }

  function fmtPct(val) {
    if (val == null || isNaN(val) || !isFinite(val)) return '';
    return (val * 100).toFixed(1) + '%';
  }

  function valClass(val) {
    if (val == null || isNaN(val)) return '';
    return val < 0 ? 'val-negative' : '';
  }

  /* ── Stored state ── */
  var rawRows = null;
  var colIdx = null;

  /* ── Multi-select Region filter ── */
  var selectedRegions = {};
  var allRegions = [];
  var regionToggle = document.getElementById('region-toggle');
  var regionDropdown = document.getElementById('region-dropdown');

  regionToggle.addEventListener('click', function (e) {
    e.stopPropagation();
    var open = !regionDropdown.classList.contains('hidden');
    regionDropdown.classList.toggle('hidden');
    regionToggle.classList.toggle('open');
    if (open) refreshPL();
  });

  document.addEventListener('click', function (e) {
    if (!document.getElementById('region-multi').contains(e.target)) {
      if (!regionDropdown.classList.contains('hidden')) {
        regionDropdown.classList.add('hidden');
        regionToggle.classList.remove('open');
        refreshPL();
      }
    }
  });

  document.getElementById('filter-clear').addEventListener('click', function () {
    allRegions.forEach(function (r) { selectedRegions[r] = true; });
    syncRegionCheckboxes();
    updateRegionLabel();
    refreshPL();
  });

  function syncRegionCheckboxes() {
    var boxes = regionDropdown.querySelectorAll('input[type="checkbox"]');
    boxes.forEach(function (cb) { cb.checked = !!selectedRegions[cb.value]; });
  }

  function updateRegionLabel() {
    var sel = allRegions.filter(function (r) { return selectedRegions[r]; });
    if (sel.length === 0) {
      regionToggle.textContent = 'None selected';
    } else if (sel.length === allRegions.length) {
      regionToggle.textContent = 'All Regions';
    } else if (sel.length <= 3) {
      regionToggle.textContent = sel.join(', ');
    } else {
      regionToggle.textContent = sel.length + ' of ' + allRegions.length + ' regions';
    }
  }

  /* ── Data Loading ── */
  function loadData() {
    if (typeof domo === 'undefined' || !domo.get) {
      showError('domo.js not loaded');
      return;
    }
    domo.get(DATA_URL, { format: 'array-of-arrays' })
      .then(function (resp) { initData(resp); })
      .catch(function (err) {
        var msg = err && err.message ? err.message : JSON.stringify(err);
        showError('Load error: ' + msg);
      });
  }

  function showError(msg) {
    document.getElementById('loader').innerHTML =
      '<span style="color:#d32f2f;font-size:13px;">' + msg + '</span>';
  }

  function initData(resp) {
    var cols = resp.columns;
    rawRows = resp.rows;

    colIdx = {
      month:   findCol(cols, ['MONTH', 'Month']),
      amount:  findCol(cols, ['AMOUNT', 'Amount']),
      source:  findCol(cols, ['SOURCE', 'Source']),
      cat:     findCol(cols, ['P&L Category Name', 'PLCategoryName']),
      metrics: findCol(cols, ['Metrics', 'METRICS', 'Metric']),
      region:  findCol(cols, ['Region', 'region', 'REGION'])
    };

    if (colIdx.month === -1 || colIdx.amount === -1 || (colIdx.cat === -1 && colIdx.metrics === -1)) {
      showError('Missing columns. Found: ' + cols.join(', '));
      return;
    }

    populateFilters();
    refreshPL();
  }

  function findCol(cols, names) {
    for (var i = 0; i < names.length; i++) {
      var idx = cols.indexOf(names[i]);
      if (idx !== -1) return idx;
    }
    return -1;
  }

  /* ── Populate region multi-select ── */
  function populateFilters() {
    var regionSet = {};
    if (colIdx.region !== -1) {
      for (var r = 0; r < rawRows.length; r++) {
        var v = rawRows[r][colIdx.region];
        if (v) regionSet[v] = true;
      }
    }
    allRegions = Object.keys(regionSet).sort();

    allRegions.forEach(function (r) {
      selectedRegions[r] = r.toUpperCase() !== 'HQ';
    });

    var actionsDiv = document.createElement('div');
    actionsDiv.className = 'multi-select-actions';
    var btnAll = document.createElement('button');
    btnAll.textContent = 'Select All';
    btnAll.addEventListener('click', function (e) {
      e.stopPropagation();
      allRegions.forEach(function (r) { selectedRegions[r] = true; });
      syncRegionCheckboxes();
      updateRegionLabel();
    });
    var btnNone = document.createElement('button');
    btnNone.textContent = 'Deselect All';
    btnNone.addEventListener('click', function (e) {
      e.stopPropagation();
      allRegions.forEach(function (r) { selectedRegions[r] = false; });
      syncRegionCheckboxes();
      updateRegionLabel();
    });
    actionsDiv.appendChild(btnAll);
    actionsDiv.appendChild(btnNone);
    regionDropdown.appendChild(actionsDiv);

    allRegions.forEach(function (rgn) {
      var lbl = document.createElement('label');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = rgn;
      cb.checked = selectedRegions[rgn];
      cb.addEventListener('change', function (e) {
        e.stopPropagation();
        selectedRegions[rgn] = cb.checked;
        updateRegionLabel();
      });
      lbl.appendChild(cb);
      lbl.appendChild(document.createTextNode(rgn));
      regionDropdown.appendChild(lbl);
    });

    updateRegionLabel();
  }

  /* ── Get filtered rows ── */
  function getFilteredRows() {
    if (colIdx.region === -1) return rawRows;
    var allSelected = allRegions.every(function (r) { return selectedRegions[r]; });
    if (allSelected) return rawRows;
    return rawRows.filter(function (row) {
      return !!selectedRegions[row[colIdx.region]];
    });
  }

  /* ── Refresh ── */
  function refreshPL() {
    if (!rawRows) return;
    var rows = getFilteredRows();
    var result = aggregateRows(rows);
    clearTable();
    renderTable(result);
  }

  /* ── Aggregate into monthly buckets, then roll up to quarters ── */
  function aggregateRows(rows) {
    var actData  = {};
    var fcstData = {};
    var monthActCount = {};

    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var cat = (colIdx.cat >= 0 && row[colIdx.cat]) ? row[colIdx.cat] : '';
      if (!cat && colIdx.metrics >= 0) cat = row[colIdx.metrics] || '';
      if (METRICS_MAP[cat]) cat = METRICS_MAP[cat];
      var rawMonth = row[colIdx.month];
      var rawAmt = parseFloat(row[colIdx.amount]) || 0;
      var src = colIdx.source >= 0 ? (row[colIdx.source] || '').trim().toUpperCase() : '';

      if (!cat || !rawMonth || !VALID_CATS[cat]) continue;

      var mk = rawMonth.substring(0, 7);
      if (mk.substring(0, 4) !== CURRENT_YEAR) continue;

      var isActual   = (src === 'ACTUAL' || src === 'ACTUALS' || src === 'GL_ACTUALS' || src === 'ACT');
      var isForecast = (src === 'GL_FORECAST' || src === 'FORECAST' || src === 'FCST');
      if (!isActual && !isForecast) continue;

      var isCredit = CREDIT_CATS.indexOf(cat) !== -1;
      var amt = (isCredit && isActual) ? rawAmt * -1 : rawAmt;

      if (isActual) {
        if (!actData[cat]) actData[cat] = {};
        actData[cat][mk] = (actData[cat][mk] || 0) + amt;
        monthActCount[mk] = (monthActCount[mk] || 0) + 1;
      } else {
        if (!fcstData[cat]) fcstData[cat] = {};
        fcstData[cat][mk] = (fcstData[cat][mk] || 0) + amt;
      }
    }

    /* Determine current month key — only closed months can be ACT */
    var now = new Date();
    var curMonthKey = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2);

    var monthType = {};
    var allMonths = [];
    QUARTERS.forEach(function (q) {
      q.months.forEach(function (mk) { allMonths.push(mk); });
    });
    allMonths.forEach(function (mk) {
      monthType[mk] = (mk < curMonthKey && monthActCount[mk]) ? 'ACT' : 'FCST';
    });

    /* Merge: pick actuals for closed months, forecast otherwise */
    var allCats = {};
    [actData, fcstData].forEach(function (d) {
      for (var c in d) allCats[c] = true;
    });

    var merged = {};
    for (var cat in allCats) {
      merged[cat] = {};
      allMonths.forEach(function (mk) {
        if (monthType[mk] === 'ACT') {
          merged[cat][mk] = (actData[cat] && actData[cat][mk]) || 0;
        } else {
          merged[cat][mk] = (fcstData[cat] && fcstData[cat][mk]) || 0;
        }
      });
    }

    /* Roll up to quarters */
    function sumCats(catList, mk) {
      var total = 0;
      catList.forEach(function (c) {
        if (merged[c] && merged[c][mk] != null) total += merged[c][mk];
      });
      return total;
    }

    /* Compute subtotals per month first */
    var computed = {};
    var compKeys = ['_totalRevenue','_totalCOGS','_grossProfit','_gpPct','_totalOpEx','_totalOther','_netIncome','_niPct'];
    compKeys.forEach(function (k) { computed[k] = {}; });

    allMonths.forEach(function (mk) {
      var rev   = sumCats(REVENUE_CATS, mk);
      var cogs  = sumCats(COGS_CATS, mk);
      var opex  = sumCats(OPEX_CATS, mk);
      var other = sumCats(OTHER_CATS, mk);
      var gp    = rev - cogs;
      var ni    = gp - opex - other;

      computed['_totalRevenue'][mk] = rev;
      computed['_totalCOGS'][mk]    = cogs;
      computed['_grossProfit'][mk]  = gp;
      computed['_gpPct'][mk]        = rev !== 0 ? gp / rev : 0;
      computed['_totalOpEx'][mk]    = opex;
      computed['_totalOther'][mk]   = other;
      computed['_netIncome'][mk]    = ni;
      computed['_niPct'][mk]        = rev !== 0 ? ni / rev : 0;
    });

    /* Build quarterly aggregates */
    var quarterData = {};   /* key -> { Q1: val, Q2: val, ... , FY: val } */
    var quarterType = {};   /* Q1: ACT|FCST|MIXED */

    /* Determine quarter type: ACT only if ALL months in the quarter are ACT */
    QUARTERS.forEach(function (q) {
      var allAct = q.months.every(function (mk) { return monthType[mk] === 'ACT'; });
      var anyAct = q.months.some(function (mk) { return monthType[mk] === 'ACT'; });
      if (allAct) {
        quarterType[q.label] = 'ACT';
      } else if (anyAct) {
        quarterType[q.label] = 'MIXED';
      } else {
        quarterType[q.label] = 'FCST';
      }
    });

    /* Aggregate category data per quarter */
    function buildQuarterRow(source) {
      var qRow = {};
      var fyTotal = 0;
      QUARTERS.forEach(function (q) {
        var sum = 0;
        q.months.forEach(function (mk) {
          sum += (source && source[mk]) || 0;
        });
        qRow[q.label] = sum;
        fyTotal += sum;
      });
      qRow['FY Total'] = fyTotal;
      return qRow;
    }

    /* Percentage rows need special handling — compute from quarterly totals */
    function buildQuarterPctRow(numKey, denomKey) {
      var qRow = {};
      var numQ = quarterData[numKey];
      var denomQ = quarterData[denomKey];
      QUARTERS.forEach(function (q) {
        var d = denomQ[q.label];
        qRow[q.label] = d !== 0 ? numQ[q.label] / d : 0;
      });
      var dFY = denomQ['FY Total'];
      qRow['FY Total'] = dFY !== 0 ? numQ['FY Total'] / dFY : 0;
      return qRow;
    }

    /* Build quarter data for all categories and computed rows */
    for (var cat in merged) {
      quarterData[cat] = buildQuarterRow(merged[cat]);
    }
    compKeys.forEach(function (k) {
      if (k === '_gpPct' || k === '_niPct') return;
      quarterData[k] = buildQuarterRow(computed[k]);
    });
    /* Compute pct rows from quarterly totals */
    quarterData['_gpPct'] = buildQuarterPctRow('_grossProfit', '_totalRevenue');
    quarterData['_niPct'] = buildQuarterPctRow('_netIncome', '_totalRevenue');

    return {
      quarterData: quarterData,
      quarterType: quarterType,
      displayRows: PL_ROWS.slice()
    };
  }

  /* ── Clear table ── */
  function clearTable() {
    var table = document.getElementById('pl-table');
    var thead = document.getElementById('pl-thead');
    var tbody = document.getElementById('pl-tbody');
    thead.innerHTML = '';
    tbody.innerHTML = '';
    var cg = table.querySelector('colgroup');
    if (cg) table.removeChild(cg);
  }

  /* ── Render ── */
  function renderTable(result) {
    var quarterData = result.quarterData;
    var quarterType = result.quarterType;
    var displayRows = result.displayRows;
    var table = document.getElementById('pl-table');
    var thead = document.getElementById('pl-thead');
    var tbody = document.getElementById('pl-tbody');

    var colLabels = QUARTERS.map(function (q) { return q.label; });
    colLabels.push('FY Total');

    /* Colgroup */
    var cg = document.createElement('colgroup');
    var c0 = document.createElement('col');
    c0.className = 'col-label';
    cg.appendChild(c0);
    colLabels.forEach(function () {
      var c = document.createElement('col');
      c.className = 'col-data';
      cg.appendChild(c);
    });
    table.insertBefore(cg, thead);

    /* Header row 1: Quarter labels */
    var tr1 = document.createElement('tr');
    tr1.className = 'header-months';
    var th0 = document.createElement('th');
    th0.className = 'col-label-header';
    th0.textContent = 'P&L Category';
    th0.rowSpan = 2;
    tr1.appendChild(th0);

    colLabels.forEach(function (label) {
      var th = document.createElement('th');
      th.textContent = label;
      if (label === 'FY Total') {
        th.className = 'fy-total';
      } else {
        var qt = quarterType[label];
        th.className = qt === 'ACT' ? 'act' : qt === 'MIXED' ? 'mixed' : 'fcst';
      }
      tr1.appendChild(th);
    });
    thead.appendChild(tr1);

    /* Header row 2: ACT / FCST */
    var tr2 = document.createElement('tr');
    tr2.className = 'header-type';
    colLabels.forEach(function (label) {
      var th = document.createElement('th');
      if (label === 'FY Total') {
        th.textContent = '';
        th.className = 'fy-total';
      } else {
        var qt = quarterType[label];
        if (qt === 'MIXED') {
          th.textContent = 'ACT+FCST';
        } else {
          th.textContent = qt;
        }
        th.className = qt === 'ACT' ? 'act' : qt === 'MIXED' ? 'mixed' : 'fcst';
      }
      tr2.appendChild(th);
    });
    thead.appendChild(tr2);

    /* Body */
    displayRows.forEach(function (def) {
      var label = def[0];
      var key   = def[1];
      var type  = def[2];

      var tr = document.createElement('tr');
      tr.className = 'row-' + type;

      if (type === 'spacer') {
        var td = document.createElement('td');
        td.colSpan = colLabels.length + 1;
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
      }

      if (type === 'header') {
        var tdH = document.createElement('td');
        tdH.colSpan = colLabels.length + 1;
        tdH.textContent = label;
        tr.appendChild(tdH);
        tbody.appendChild(tr);
        return;
      }

      /* Label cell */
      var tdLabel = document.createElement('td');
      tdLabel.textContent = label;
      tr.appendChild(tdLabel);

      var isPct = type === 'pct';
      var source = quarterData[key];

      colLabels.forEach(function (colLabel) {
        var td = document.createElement('td');
        var val = source ? (source[colLabel] || 0) : 0;

        if (colLabel === 'FY Total') {
          td.className = 'fy-total-cell';
        }

        if (isPct) {
          td.textContent = fmtPct(val);
        } else {
          td.textContent = fmt(val);
        }
        var vc = valClass(val);
        if (vc) td.className += (td.className ? ' ' : '') + vc;
        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });

    document.getElementById('loader').classList.add('hidden');
  }

  /* Boot */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadData);
  } else {
    loadData();
  }
})();
