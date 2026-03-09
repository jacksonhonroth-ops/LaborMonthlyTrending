/* ================================================================
   National P&L – DOMO Phoenix Pro Code Card (SQL Version)
   Uses server-side SQL aggregation via domo.post('/sql/v1/dataset')
   SOURCE: ACTUAL = actuals, GL_FORECAST = forecast
   ================================================================ */
(function () {
  'use strict';

  var SQL_QUERY = "SELECT `MONTH`, `Region`, `Column` as `SOURCE`, " +
    "`Metrics`, SUM(`AMOUNT`) as `AMOUNT` " +
    "FROM dataset " +
    "WHERE `Column` IN ('ACTUAL', 'GL_FORECAST') " +
    "AND `Metrics` IN ('Service Revenue','Total Labor','Contract Expenses'," +
    "'Supplies & Materials','Field Overhead','HQ Overhead','Sales Overhead'," +
    "'Benefits & Taxes','Income Taxes','Other Expense (Income)') " +
    "AND (`Metrics` = `P&L Category Name` " +
    "OR (`Metrics` = 'Other Expense (Income)' " +
    "AND `P&L Category Name` IN ('Other Income/ Expense','Control Account'))) " +
    "GROUP BY `MONTH`, `Region`, `Column`, `Metrics`";

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

  /* Categories for each subtotal */
  var REVENUE_CATS  = ['Service Revenue'];
  var COGS_CATS     = ['Total Labor', 'Contract Expenses', 'Supplies & Materials'];
  var OPEX_CATS     = ['Field Overhead', 'HQ Overhead', 'Sales Overhead', 'Benefits & Taxes'];
  var OTHER_CATS    = ['Income Taxes', 'Other Income/ Expense'];

  /* Categories stored as credits (negative) in ACTUALS only — forecast is already positive */
  var CREDIT_CATS   = ['Service Revenue', 'Other Income/ Expense'];

  /* Map Metrics names to P&L Category Names where they differ */
  var CAT_MAP = {
    'Other Expense (Income)': 'Other Income/ Expense'
  };

  /* Only aggregate rows matching our defined P&L categories */
  var VALID_CATS = {};
  PL_ROWS.forEach(function (r) { if (r[1] && r[1][0] !== '_') VALID_CATS[r[1]] = true; });

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

  /* ── Data Loading (SQL aggregation via domo.post) ── */
  function loadData() {
    if (typeof domo === 'undefined' || !domo.post) {
      showError('domo.js not loaded');
      return;
    }
    domo.post('/sql/v1/dataset', SQL_QUERY, { contentType: 'text/plain' })
      .then(function (resp) { initData(resp); })
      .catch(function (err) {
        var msg = err && err.message ? err.message : JSON.stringify(err);
        showError('SQL error: ' + msg);
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

    console.log('[NatPL-SQL] Columns:', cols);
    console.log('[NatPL-SQL] Total rows:', rawRows.length);

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

  /* ── Refresh P&L ── */
  function refreshPL() {
    if (!rawRows) return;
    var rows = getFilteredRows();
    var result = aggregateRows(rows);
    clearTable();
    renderTable(result.displayRows, result.months, result.monthType, result.merged, result.computed);
  }

  /* ── Aggregate (data is pre-aggregated by SQL, just pivot here) ── */
  function aggregateRows(rows) {
    var actData  = {};
    var fcstData = {};
    var monthSet = {};
    var monthActCount  = {};
    var monthFcstCount = {};

    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      /* Use P&L Category Name; fall back to Metrics if empty */
      var cat = (colIdx.cat >= 0 && row[colIdx.cat]) ? row[colIdx.cat] : '';
      if (!cat && colIdx.metrics >= 0) cat = row[colIdx.metrics] || '';
      if (CAT_MAP[cat]) cat = CAT_MAP[cat];
      var rawMonth = row[colIdx.month];
      var rawAmt = parseFloat(row[colIdx.amount]) || 0;
      var src = colIdx.source >= 0 ? (row[colIdx.source] || '').trim().toUpperCase() : '';

      if (!cat || !rawMonth || !VALID_CATS[cat]) continue;

      var mk = ('' + rawMonth).substring(0, 7);
      if (mk.substring(0, 4) !== '2026') continue;

      var isActual = (src === 'ACTUAL' || src === 'ACTUALS' || src === 'GL_ACTUALS');

      monthSet[mk] = true;

      /* Negate credit categories for ACTUALS only (GL convention); forecast already positive */
      var isCredit = CREDIT_CATS.indexOf(cat) !== -1;
      var amt = (isCredit && isActual) ? rawAmt * -1 : rawAmt;

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

    console.log('[NatPL-SQL] Rows processed:', rows.length);
    console.log('[NatPL-SQL] Months found:', months.join(', '));
    console.log('[NatPL-SQL] monthActCount:', JSON.stringify(monthActCount));
    console.log('[NatPL-SQL] monthFcstCount:', JSON.stringify(monthFcstCount));
    console.log('[NatPL-SQL] ACTUAL cats:', JSON.stringify(Object.keys(actData)));
    console.log('[NatPL-SQL] FCST cats:', JSON.stringify(Object.keys(fcstData)));
    /* Debug: show Jan actual Service Revenue to verify totals */
    if (actData['Service Revenue'] && actData['Service Revenue']['2026-01']) {
      console.log('[NatPL-SQL] Jan ACT Service Revenue:', actData['Service Revenue']['2026-01']);
    }
    if (fcstData['Service Revenue'] && fcstData['Service Revenue']['2026-04']) {
      console.log('[NatPL-SQL] Apr FCST Service Revenue:', fcstData['Service Revenue']['2026-04']);
    }
    /* Debug: log first 5 skipped rows to see what categories are being dropped */
    var skipped = {};
    for (var s = 0; s < rows.length && Object.keys(skipped).length < 20; s++) {
      var srow = rows[s];
      var sc = (colIdx.cat >= 0 && srow[colIdx.cat]) ? srow[colIdx.cat] : '';
      if (!sc && colIdx.metrics >= 0) sc = srow[colIdx.metrics] || '';
      if (CAT_MAP[sc]) sc = CAT_MAP[sc];
      if (sc && !VALID_CATS[sc]) skipped[sc] = (skipped[sc] || 0) + 1;
    }
    console.log('[NatPL-SQL] Skipped categories (sample):', JSON.stringify(skipped));

    /* Determine current month key (YYYY-MM) */
    var now = new Date();
    var curMonthKey = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2);

    var monthType = {};
    months.forEach(function (mk) {
      if (monthActCount[mk]) {
        /* Current month with partial actuals: prefer forecast if available */
        if (mk === curMonthKey && monthFcstCount[mk]) {
          monthType[mk] = 'FCST';
        } else {
          monthType[mk] = 'ACT';
        }
      } else {
        monthType[mk] = 'FCST';
      }
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

    var displayRows = PL_ROWS.slice();

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
