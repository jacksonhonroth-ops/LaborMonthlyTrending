/* ================================================================
   National P&L – DOMO Phoenix Pro Code Card
   Fetches via /data/v1/dataset?limit=N (ryuu columnar format)
   SOURCE: ACTUAL = actuals, GL_FORECAST = forecast
   Filters: Region, Ops Lead, Job Number, Parent Account
   ================================================================ */
(function () {
  'use strict';

  var DATA_ALIAS = 'gl_financials';

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
    ['Control Account',      'Control Account',      'category'],
    ['Income Taxes',         'Income Taxes',         'category'],
    ['Other Income/ Expense','Other Income/ Expense','category'],
    ['Total Other',          '_totalOther',          'subtotal'],
    [null,                   null,                   'spacer'],

    ['Net Income',           '_netIncome',           'subtotal'],
    ['NI %',                 '_niPct',               'pct']
  ];

  /* Categories for each subtotal */
  var REVENUE_CATS  = ['Service Revenue'];
  var COGS_CATS     = ['Total Labor', 'Contract Expenses', 'Supplies & Materials'];
  var OPEX_CATS     = ['Field Overhead', 'HQ Overhead', 'Sales Overhead', 'Benefits & Taxes'];
  var OTHER_CATS    = ['Control Account', 'Income Taxes', 'Other Income/ Expense'];

  /* Categories stored as credits (negative in GL) — negate to show positive */
  var CREDIT_CATS   = ['Service Revenue', 'Other Income/ Expense'];

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

  function monthLabel(key) {
    var parts = key.split('-');
    var names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return names[parseInt(parts[1], 10) - 1] + ' ' + parts[0].slice(-2);
  }

  /* ── Stored state ── */
  var rawRows = null;
  var colIdx = null;

  /* ── Filter elements ── */
  var filterRegion  = document.getElementById('filter-region');
  var filterOps     = document.getElementById('filter-ops');
  var filterJob     = document.getElementById('filter-job');
  var filterAccount = document.getElementById('filter-account');

  /* Dropdown change listeners */
  [filterRegion, filterOps].forEach(function (el) {
    el.addEventListener('change', function () { refreshPL(); });
  });

  /* Search input listeners (debounced) */
  var searchTimer = null;
  [filterJob, filterAccount].forEach(function (el) {
    el.addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { refreshPL(); }, 300);
    });
    el.addEventListener('change', function () { refreshPL(); });
  });

  document.getElementById('filter-clear').addEventListener('click', function () {
    filterRegion.value = '';
    filterOps.value = '';
    filterJob.value = '';
    filterAccount.value = '';
    refreshPL();
  });

  /* ── Data Loading ── */
  function loadData() {
    if (typeof domo === 'undefined' || !domo.get) {
      showError('domo.js SDK not loaded – check script tag in index.html');
      return;
    }
    domo.get('/data/v1/' + DATA_ALIAS, { format: 'array-of-arrays' })
      .then(function (resp) { initData(resp); })
      .catch(function (err) {
        var msg = err && err.message ? err.message : JSON.stringify(err);
        showError('Data load failed: ' + msg);
      });
  }

  function showError(msg) {
    document.getElementById('loader').innerHTML =
      '<span style="color:#d32f2f;font-size:13px;">' + msg + '</span>';
  }

  /* ── Init: parse columns, populate filters, first render ── */
  function initData(resp) {
    var cols = resp.columns;
    rawRows = resp.rows;

    colIdx = {
      month:  findCol(cols, ['MONTH', 'Month']),
      amount: findCol(cols, ['AMOUNT', 'Amount']),
      source: findCol(cols, ['SOURCE', 'Source']),
      cat:    findCol(cols, ['P&L Category Name', 'PLCategoryName']),
      region: findCol(cols, ['Region', 'region', 'REGION']),
      job:    findCol(cols, ['JobNumber', 'Job Number']),
      account:findCol(cols, ['ParentAccount', 'Parent Account']),
      ops:    findCol(cols, ['OperationsLead', 'Operations Lead', 'OpsLead'])
    };

    if (colIdx.month === -1 || colIdx.amount === -1 || colIdx.cat === -1) {
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

  /* ── Populate filter dropdowns/datalists ── */
  function populateFilters() {
    var regions = {}, ops = {}, jobs = {}, accounts = {};
    for (var r = 0; r < rawRows.length; r++) {
      var row = rawRows[r];
      var v;
      if (colIdx.region !== -1) { v = row[colIdx.region]; if (v) regions[v] = true; }
      if (colIdx.ops !== -1)    { v = row[colIdx.ops];    if (v) ops[v] = true; }
      if (colIdx.job !== -1)    { v = row[colIdx.job];    if (v) jobs[v] = true; }
      if (colIdx.account !== -1){ v = row[colIdx.account]; if (v) accounts[v] = true; }
    }

    fillSelect(filterRegion, Object.keys(regions).sort());
    fillSelect(filterOps, Object.keys(ops).sort());
    fillDatalist('job-list', Object.keys(jobs).sort());
    fillDatalist('account-list', Object.keys(accounts).sort());
  }

  function fillSelect(el, values) {
    values.forEach(function (v) {
      var opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      el.appendChild(opt);
    });
  }

  function fillDatalist(id, values) {
    var dl = document.getElementById(id);
    if (!dl) return;
    values.forEach(function (v) {
      var opt = document.createElement('option');
      opt.value = v;
      dl.appendChild(opt);
    });
  }

  /* ── Get filtered rows ── */
  function getFilteredRows() {
    var rVal = filterRegion.value;
    var oVal = filterOps.value;
    var jVal = (filterJob.value || '').trim().toLowerCase();
    var aVal = (filterAccount.value || '').trim().toLowerCase();

    if (!rVal && !oVal && !jVal && !aVal) return rawRows;

    return rawRows.filter(function (row) {
      if (rVal && colIdx.region !== -1 && row[colIdx.region] !== rVal) return false;
      if (oVal && colIdx.ops !== -1 && row[colIdx.ops] !== oVal) return false;
      if (jVal && colIdx.job !== -1) {
        var rowJob = (row[colIdx.job] || '').toString().toLowerCase();
        if (rowJob.indexOf(jVal) === -1) return false;
      }
      if (aVal && colIdx.account !== -1) {
        var rowAcct = (row[colIdx.account] || '').toString().toLowerCase();
        if (rowAcct.indexOf(aVal) === -1) return false;
      }
      return true;
    });
  }

  /* ── Refresh P&L ── */
  function refreshPL() {
    if (!rawRows) return;
    var rows = getFilteredRows();
    var result = aggregateRows(rows);
    clearTable();
    renderTable(result.displayRows, result.months, result.monthType, result.merged, result.computed);
  }

  /* ── Aggregate ── */
  function aggregateRows(rows) {
    var actData  = {};
    var fcstData = {};
    var monthSet = {};
    var monthActCount  = {};
    var monthFcstCount = {};

    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var cat = row[colIdx.cat];
      var rawMonth = row[colIdx.month];
      var rawAmt = parseFloat(row[colIdx.amount]) || 0;
      var src = colIdx.source >= 0 ? (row[colIdx.source] || '').trim().toUpperCase() : '';

      if (!cat || !rawMonth) continue;

      var mk = rawMonth.substring(0, 7);
      if (mk.substring(0, 4) !== '2026') continue;

      /* Negate credit categories so they display positive */
      var amt = CREDIT_CATS.indexOf(cat) !== -1 ? rawAmt * -1 : rawAmt;

      monthSet[mk] = true;
      var isActual = (src === 'ACTUAL' || src === 'ACTUALS' || src === 'GL_ACTUALS');

      if (isActual) {
        if (!actData[cat]) actData[cat] = {};
        actData[cat][mk] = (actData[cat][mk] || 0) + amt;
        monthActCount[mk] = (monthActCount[mk] || 0) + 1;
      } else {
        if (!fcstData[cat]) fcstData[cat] = {};
        fcstData[cat][mk] = (fcstData[cat][mk] || 0) + amt;
        monthFcstCount[mk] = (monthFcstCount[mk] || 0) + 1;
      }
    }

    var months = Object.keys(monthSet).sort();

    var monthType = {};
    months.forEach(function (mk) {
      monthType[mk] = monthActCount[mk] ? 'ACT' : 'FCST';
    });

    /* Merged data: pick actuals or forecast per month */
    var merged = {};
    var allCats = {};
    [actData, fcstData].forEach(function (d) {
      for (var cat in d) allCats[cat] = true;
    });

    for (var cat in allCats) {
      merged[cat] = {};
      months.forEach(function (mk) {
        if (monthType[mk] === 'ACT') {
          merged[cat][mk] = (actData[cat] && actData[cat][mk]) || 0;
        } else {
          merged[cat][mk] = (fcstData[cat] && fcstData[cat][mk]) || 0;
        }
      });
    }

    /* Compute subtotals */
    function sumCats(catList, mk) {
      var total = 0;
      catList.forEach(function (c) {
        if (merged[c] && merged[c][mk] != null) total += merged[c][mk];
      });
      return total;
    }

    var computed = {};
    var compKeys = ['_totalRevenue','_totalCOGS','_grossProfit','_gpPct','_totalOpEx','_totalOther','_netIncome','_niPct'];
    compKeys.forEach(function (k) { computed[k] = {}; });

    months.forEach(function (mk) {
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

    /* Detect extra categories not in our P&L structure */
    var knownCats = {};
    PL_ROWS.forEach(function (r) { if (r[1] && r[1][0] !== '_') knownCats[r[1]] = true; });
    var extraCats = Object.keys(allCats).filter(function (c) { return !knownCats[c] && c; }).sort();

    var displayRows = PL_ROWS.slice();
    if (extraCats.length > 0) {
      var niIdx = displayRows.findIndex(function (r) { return r[1] === '_netIncome'; });
      displayRows.splice(niIdx, 0, [null, null, 'spacer'], ['Unclassified', null, 'header']);
      niIdx += 2;
      extraCats.forEach(function (c, i) {
        displayRows.splice(niIdx + i, 0, [c, c, 'category']);
      });
    }

    return {
      displayRows: displayRows,
      months: months,
      monthType: monthType,
      merged: merged,
      computed: computed
    };
  }

  /* ── Clear table for re-render ── */
  function clearTable() {
    var table = document.getElementById('pl-table');
    var thead = document.getElementById('pl-thead');
    var tbody = document.getElementById('pl-tbody');
    thead.innerHTML = '';
    tbody.innerHTML = '';
    /* Remove existing colgroup */
    var cg = table.querySelector('colgroup');
    if (cg) table.removeChild(cg);
  }

  /* ── Render ── */
  function renderTable(displayRows, months, monthType, merged, computed) {
    var table = document.getElementById('pl-table');
    var thead = document.getElementById('pl-thead');
    var tbody = document.getElementById('pl-tbody');

    /* Colgroup */
    var cg = document.createElement('colgroup');
    var c0 = document.createElement('col');
    c0.className = 'col-label';
    cg.appendChild(c0);
    months.forEach(function () {
      var c = document.createElement('col');
      c.className = 'col-data';
      cg.appendChild(c);
    });
    var cFY = document.createElement('col');
    cFY.className = 'col-data';
    cg.appendChild(cFY);
    table.insertBefore(cg, thead);

    /* Header row 1: Month names */
    var tr1 = document.createElement('tr');
    tr1.className = 'header-months';
    var th0 = document.createElement('th');
    th0.className = 'col-label-header';
    th0.textContent = 'P&L Category';
    th0.rowSpan = 2;
    tr1.appendChild(th0);
    months.forEach(function (mk) {
      var th = document.createElement('th');
      th.textContent = monthLabel(mk);
      th.className = monthType[mk] === 'ACT' ? 'act' : 'fcst';
      tr1.appendChild(th);
    });
    var thFY = document.createElement('th');
    thFY.textContent = 'FY Total';
    thFY.className = 'fy-total';
    thFY.rowSpan = 2;
    tr1.appendChild(thFY);
    thead.appendChild(tr1);

    /* Header row 2: ACT/FCST */
    var tr2 = document.createElement('tr');
    tr2.className = 'header-type';
    months.forEach(function (mk) {
      var th = document.createElement('th');
      th.textContent = monthType[mk];
      th.className = monthType[mk] === 'ACT' ? 'act' : 'fcst';
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
        td.colSpan = months.length + 2;
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
      }

      if (type === 'header') {
        var tdH = document.createElement('td');
        tdH.colSpan = months.length + 2;
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
      var isComputed = key && key[0] === '_';
      var source = isComputed ? computed[key] : merged[key];
      var fyTotal = 0;
      var fyCount = 0;

      months.forEach(function (mk) {
        var td = document.createElement('td');
        var val = source ? (source[mk] || 0) : 0;

        if (isPct) {
          td.textContent = fmtPct(val);
        } else {
          td.textContent = fmt(val);
          fyTotal += val;
        }
        td.className = valClass(val);
        fyCount++;
        tr.appendChild(td);
      });

      /* FY Total */
      var tdFY = document.createElement('td');
      tdFY.className = 'fy-total-cell';
      if (isPct) {
        tdFY.textContent = fmtPct(fyCount > 0 ? fyTotal / fyCount : 0);
      } else {
        tdFY.textContent = fmt(fyTotal);
        tdFY.className += ' ' + valClass(fyTotal);
      }
      tr.appendChild(tdFY);

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
