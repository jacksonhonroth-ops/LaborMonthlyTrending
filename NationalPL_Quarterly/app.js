/* ================================================================
   National P&L – Quarterly View
   Three columns per quarter: Actuals, Budget, Forecast
   Plus FY Total (Act, Bud, Fcst) and FY Variance (Bud − Act).
   Actuals: if the full quarter is closed, show actuals.
            Otherwise, show forecast for the entire quarter.
   Budget:  GL_BUDGET source only.
   Forecast: GL_FORECAST source only.
   ================================================================ */
(function () {
  'use strict';

  var DATA_URL = '/data/v1/dataset?limit=5000000';

  /* ── P&L Structure ── */
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

  /* Sub-columns per quarter group */
  var Q_SOURCES = ['act', 'bud', 'fcst'];
  var Q_SOURCE_LABELS = { act: 'Actuals', bud: 'Budget', fcst: 'Forecast' };

  /* FY group has an extra Variance column */
  var FY_SOURCES = ['act', 'bud', 'fcst', 'var'];
  var FY_SOURCE_LABELS = { act: 'Actuals', bud: 'Budget', fcst: 'Forecast', var: 'Variance' };

  var CURRENT_YEAR = '2026';
  var QUARTERS = [
    { label: 'Q1', months: [CURRENT_YEAR + '-01', CURRENT_YEAR + '-02', CURRENT_YEAR + '-03'] },
    { label: 'Q2', months: [CURRENT_YEAR + '-04', CURRENT_YEAR + '-05', CURRENT_YEAR + '-06'] },
    { label: 'Q3', months: [CURRENT_YEAR + '-07', CURRENT_YEAR + '-08', CURRENT_YEAR + '-09'] },
    { label: 'Q4', months: [CURRENT_YEAR + '-10', CURRENT_YEAR + '-11', CURRENT_YEAR + '-12'] }
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

  /* Variance class: positive = good (green), negative = bad (red) */
  function varClass(val) {
    if (val == null || isNaN(val) || val === 0) return '';
    return val > 0 ? 'val-positive' : 'val-negative';
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

  /* ── Aggregate ── */
  function aggregateRows(rows) {
    var actData  = {};   /* category -> { month -> amount } */
    var budData  = {};
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
      var isBudget   = (src === 'GL_BUDGET' || src === 'BUDGET' || src === 'BUD');
      var isForecast = (src === 'GL_FORECAST' || src === 'FORECAST' || src === 'FCST');
      if (!isActual && !isBudget && !isForecast) continue;

      var isCredit = CREDIT_CATS.indexOf(cat) !== -1;
      var amt = (isCredit && isActual) ? rawAmt * -1 : rawAmt;

      if (isActual) {
        if (!actData[cat]) actData[cat] = {};
        actData[cat][mk] = (actData[cat][mk] || 0) + amt;
        monthActCount[mk] = (monthActCount[mk] || 0) + 1;
      } else if (isBudget) {
        if (!budData[cat]) budData[cat] = {};
        budData[cat][mk] = (budData[cat][mk] || 0) + rawAmt;
      } else {
        if (!fcstData[cat]) fcstData[cat] = {};
        fcstData[cat][mk] = (fcstData[cat][mk] || 0) + rawAmt;
      }
    }

    /* Current month key — only months before this can be ACT */
    var now = new Date();
    var curMonthKey = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2);

    var allMonths = [];
    QUARTERS.forEach(function (q) {
      q.months.forEach(function (mk) { allMonths.push(mk); });
    });

    var monthType = {};
    allMonths.forEach(function (mk) {
      monthType[mk] = (mk < curMonthKey && monthActCount[mk]) ? 'ACT' : 'FCST';
    });

    /* Determine which quarters are fully closed */
    var quarterClosed = {};
    QUARTERS.forEach(function (q) {
      quarterClosed[q.label] = q.months.every(function (mk) {
        return monthType[mk] === 'ACT';
      });
    });

    /* Collect all categories seen */
    var allCats = {};
    [actData, budData, fcstData].forEach(function (d) {
      for (var c in d) allCats[c] = true;
    });

    /* Helper: sum category list from a data object for given months */
    function sumCatsFrom(dataObj, catList, months) {
      var total = 0;
      catList.forEach(function (c) {
        months.forEach(function (mk) {
          if (dataObj[c] && dataObj[c][mk] != null) total += dataObj[c][mk];
        });
      });
      return total;
    }

    var compKeys = ['_totalRevenue','_totalCOGS','_grossProfit','_gpPct','_totalOpEx','_totalOther','_netIncome','_niPct'];

    /* Roll up a data source directly to quarterly totals */
    function rollUpSource(dataObj) {
      var qData = {};
      for (var cat in allCats) {
        qData[cat] = {};
        var fyTotal = 0;
        QUARTERS.forEach(function (q) {
          var sum = 0;
          q.months.forEach(function (mk) {
            sum += (dataObj[cat] && dataObj[cat][mk]) || 0;
          });
          qData[cat][q.label] = sum;
          fyTotal += sum;
        });
        qData[cat]['FY'] = fyTotal;
      }

      /* Computed subtotals */
      compKeys.forEach(function (k) {
        if (k === '_gpPct' || k === '_niPct') return;
        qData[k] = {};
      });

      var qLabels = QUARTERS.map(function (q) { return q.label; });
      qLabels.push('FY');

      qLabels.forEach(function (ql) {
        var months = ql === 'FY'
          ? allMonths
          : QUARTERS.filter(function (q) { return q.label === ql; })[0].months;

        var rev   = sumCatsFrom(dataObj, REVENUE_CATS, months);
        var cogs  = sumCatsFrom(dataObj, COGS_CATS, months);
        var opex  = sumCatsFrom(dataObj, OPEX_CATS, months);
        var other = sumCatsFrom(dataObj, OTHER_CATS, months);
        var gp    = rev - cogs;
        var ni    = gp - opex - other;

        qData['_totalRevenue'][ql] = rev;
        qData['_totalCOGS'][ql]    = cogs;
        qData['_grossProfit'][ql]  = gp;
        qData['_totalOpEx'][ql]    = opex;
        qData['_totalOther'][ql]   = other;
        qData['_netIncome'][ql]    = ni;
      });

      /* Pct rows from quarterly totals */
      qData['_gpPct'] = {};
      qData['_niPct'] = {};
      qLabels.forEach(function (ql) {
        var rev = qData['_totalRevenue'][ql];
        qData['_gpPct'][ql] = rev !== 0 ? qData['_grossProfit'][ql] / rev : 0;
        qData['_niPct'][ql] = rev !== 0 ? qData['_netIncome'][ql] / rev : 0;
      });

      return qData;
    }

    var qActRaw  = rollUpSource(actData);
    var qBud     = rollUpSource(budData);
    var qFcst    = rollUpSource(fcstData);

    /* Build "Actuals" display: full quarter actuals if closed, else forecast */
    var qAct = {};
    var allKeys = Object.keys(allCats).concat(compKeys);
    allKeys.forEach(function (key) {
      qAct[key] = {};
      QUARTERS.forEach(function (q) {
        if (quarterClosed[q.label]) {
          qAct[key][q.label] = (qActRaw[key] && qActRaw[key][q.label]) || 0;
        } else {
          qAct[key][q.label] = (qFcst[key] && qFcst[key][q.label]) || 0;
        }
      });
      /* FY = sum of quarterly values */
      var fy = 0;
      QUARTERS.forEach(function (q) { fy += qAct[key][q.label]; });
      qAct[key]['FY'] = fy;
    });

    /* Re-compute FY pct rows for actuals from the FY totals */
    var fyActRev = qAct['_totalRevenue']['FY'];
    qAct['_gpPct']['FY'] = fyActRev !== 0 ? qAct['_grossProfit']['FY'] / fyActRev : 0;
    qAct['_niPct']['FY'] = fyActRev !== 0 ? qAct['_netIncome']['FY'] / fyActRev : 0;
    QUARTERS.forEach(function (q) {
      var rev = qAct['_totalRevenue'][q.label];
      qAct['_gpPct'][q.label] = rev !== 0 ? qAct['_grossProfit'][q.label] / rev : 0;
      qAct['_niPct'][q.label] = rev !== 0 ? qAct['_netIncome'][q.label] / rev : 0;
    });

    /* FY Variance = Budget − Actuals (positive means under budget = favorable) */
    var qVar = {};
    allKeys.forEach(function (key) {
      qVar[key] = {};
      var budVal = (qBud[key] && qBud[key]['FY']) || 0;
      var actVal = (qAct[key] && qAct[key]['FY']) || 0;
      qVar[key]['FY'] = budVal - actVal;
    });
    /* Variance pct rows: budget pct - actuals pct */
    ['_gpPct', '_niPct'].forEach(function (k) {
      var budVal = (qBud[k] && qBud[k]['FY']) || 0;
      var actVal = (qAct[k] && qAct[k]['FY']) || 0;
      qVar[k]['FY'] = budVal - actVal;
    });

    return {
      qAct: qAct,
      qBud: qBud,
      qFcst: qFcst,
      qVar: qVar,
      quarterClosed: quarterClosed,
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
    var qAct  = result.qAct;
    var qBud  = result.qBud;
    var qFcst = result.qFcst;
    var qVar  = result.qVar;
    var quarterClosed = result.quarterClosed;
    var displayRows = result.displayRows;
    var table = document.getElementById('pl-table');
    var thead = document.getElementById('pl-thead');
    var tbody = document.getElementById('pl-tbody');

    /* Q1-Q4 have 3 sub-cols; FY has 4 (act, bud, fcst, variance) */
    var totalDataCols = (QUARTERS.length * 3) + 4;

    /* Colgroup */
    var cg = document.createElement('colgroup');
    var c0 = document.createElement('col');
    c0.className = 'col-label';
    cg.appendChild(c0);
    for (var ci = 0; ci < totalDataCols; ci++) {
      var c = document.createElement('col');
      c.className = 'col-data';
      cg.appendChild(c);
    }
    table.insertBefore(cg, thead);

    /* Header row 1: Group labels */
    var tr1 = document.createElement('tr');
    tr1.className = 'header-months';
    var th0 = document.createElement('th');
    th0.className = 'col-label-header';
    th0.textContent = 'P&L Category';
    th0.rowSpan = 2;
    tr1.appendChild(th0);

    QUARTERS.forEach(function (q) {
      var th = document.createElement('th');
      th.textContent = q.label;
      th.colSpan = 3;
      th.className = quarterClosed[q.label] ? 'quarter-group act' : 'quarter-group fcst';
      tr1.appendChild(th);
    });

    var thFY = document.createElement('th');
    thFY.textContent = 'FY Total';
    thFY.colSpan = 4;
    thFY.className = 'fy-total';
    tr1.appendChild(thFY);
    thead.appendChild(tr1);

    /* Header row 2: Sub-column labels */
    var tr2 = document.createElement('tr');
    tr2.className = 'header-type';

    QUARTERS.forEach(function (q) {
      var closed = quarterClosed[q.label];
      Q_SOURCES.forEach(function (src) {
        var th = document.createElement('th');
        if (src === 'act') {
          th.textContent = closed ? 'Actuals' : 'Forecast';
        } else {
          th.textContent = Q_SOURCE_LABELS[src];
        }
        th.className = 'sub-' + src;
        tr2.appendChild(th);
      });
    });

    FY_SOURCES.forEach(function (src) {
      var th = document.createElement('th');
      th.textContent = FY_SOURCE_LABELS[src];
      th.className = 'sub-' + src + ' fy-sub';
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
        td.colSpan = totalDataCols + 1;
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
      }

      if (type === 'header') {
        var tdH = document.createElement('td');
        tdH.colSpan = totalDataCols + 1;
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

      /* Quarter columns (act, bud, fcst) */
      QUARTERS.forEach(function (q) {
        var actSrc  = qAct[key];
        var budSrc  = qBud[key];
        var fcstSrc = qFcst[key];

        var vals = {
          act:  actSrc  ? (actSrc[q.label]  || 0) : 0,
          bud:  budSrc  ? (budSrc[q.label]  || 0) : 0,
          fcst: fcstSrc ? (fcstSrc[q.label] || 0) : 0
        };

        Q_SOURCES.forEach(function (src) {
          var td = document.createElement('td');
          var val = vals[src];
          td.textContent = isPct ? fmtPct(val) : fmt(val);
          var cls = valClass(val);
          if (cls) td.className = cls;
          tr.appendChild(td);
        });
      });

      /* FY columns (act, bud, fcst, variance) */
      FY_SOURCES.forEach(function (src) {
        var td = document.createElement('td');
        var dataSource;
        if (src === 'act') dataSource = qAct[key];
        else if (src === 'bud') dataSource = qBud[key];
        else if (src === 'fcst') dataSource = qFcst[key];
        else dataSource = qVar[key];

        var val = dataSource ? (dataSource['FY'] || 0) : 0;

        if (isPct) {
          td.textContent = src === 'var' ? fmtPct(val) : fmtPct(val);
        } else {
          td.textContent = fmt(val);
        }

        td.className = 'fy-total-cell';
        var cls = src === 'var' ? varClass(val) : valClass(val);
        if (cls) td.className += ' ' + cls;
        if (src === 'var') td.className += ' var-cell';
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
