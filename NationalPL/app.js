/* ================================================================
   National P&L – DOMO Phoenix Pro Code Card (Monthly View)
   Uses SQL aggregation to correctly filter: Metrics = P&L Category Name
   Columns: monthly ACT/FCST, FY Total, FY Budget, FY Variance
   ================================================================ */
(function () {
  'use strict';

  /* Addbacks are summed via Metrics only (ignoring P&L Category Name) because
     the ETL splits sub-category rows where P&L Category Name != 'Total Addbacks',
     which would fail the Metrics = P&L Category Name constraint used for the
     other (single-level) categories. */
  var SQL_QUERY =
    "SELECT `MONTH`, `Region`, `Column` as `SOURCE`, " +
    "'Total Addbacks' as `Metrics`, SUM(`AMOUNT`) as `AMOUNT` " +
    "FROM dataset " +
    "WHERE `Column` IN ('ACTUAL', 'GL_FORECAST', 'GL_BUDGET') " +
    "AND `Metrics` = 'Total Addbacks' " +
    "GROUP BY `MONTH`, `Region`, `Column` " +
    "UNION ALL " +
    "SELECT `MONTH`, `Region`, `Column` as `SOURCE`, " +
    "`Metrics`, SUM(`AMOUNT`) as `AMOUNT` " +
    "FROM dataset " +
    "WHERE `Column` IN ('ACTUAL', 'GL_FORECAST', 'GL_BUDGET') " +
    "AND `Metrics` IN ('Service Revenue','Total Labor','Contract Expenses'," +
    "'Supplies & Materials','Field Overhead','HQ Overhead','Sales Overhead'," +
    "'Benefits & Taxes') " +
    "AND `Metrics` = `P&L Category Name` " +
    "GROUP BY `MONTH`, `Region`, `Column`, `Metrics`";

  /* ── P&L Structure ── */
  var PL_ROWS = [
    ['Total Revenue',                   'Service Revenue',      'subtotal'],
    [null,                              null,                   'spacer'],
    ['Total Labor',                     'Total Labor',          'category'],
    ['Total Labor % of Tot Revenue',    '_laborPctRev',         'pct'],
    ['Benefits & Taxes',                'Benefits & Taxes',     'category'],
    ['B&T % of Total Labor',            '_bntPctLabor',         'pct'],
    ['Supplies & Materials',            'Supplies & Materials', 'category'],
    ['Supplies % of Total Labor',       '_suppliesPctLabor',    'pct'],
    [null,                              null,                   'spacer'],
    ['Gross Margin',                    '_grossMargin',         'subtotal'],
    ['GM %',                            '_gmPct',               'pct'],
    [null,                              null,                   'spacer'],
    ['Contract Expenses',               'Contract Expenses',    'category'],
    ['Contract Expenses % of Revenue',  '_contractPctRev',      'pct'],
    [null,                              null,                   'spacer'],
    ['Gross Contribution',              '_grossContribution',   'subtotal'],
    ['GC %',                            '_gcPct',               'pct'],
    [null,                              null,                   'spacer'],
    ['Field Overhead',                  'Field Overhead',       'category'],
    ['Sales Overhead',                  'Sales Overhead',       'category'],
    ['HQ Overhead',                     'HQ Overhead',          'category'],
    ['TOTAL Overhead',                  '_totalOverhead',       'subtotal'],
    ['OH % of Revenue',                 '_ohPctRev',            'pct'],
    [null,                              null,                   'spacer'],
    ['Net Income',                      '_netIncome',           'subtotal'],
    [null,                              null,                   'spacer'],
    ['Total Addbacks',                  'Total Addbacks',       'category'],
    ['Adj EBITDA',                      '_adjEbitda',           'subtotal'],
    ['Adj EBITDA as a % of Total Revenue', '_ebitdaPctRev',     'pct']
  ];

  /* Revenue is stored as credit (negative) in ACTUALS; forecast/budget already positive */
  var CREDIT_CATS = ['Service Revenue'];

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

  function varClass(val) {
    if (val == null || isNaN(val) || val === 0) return '';
    return val > 0 ? 'val-positive' : 'val-negative';
  }

  function monthLabel(key) {
    var parts = key.split('-');
    var names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return names[parseInt(parts[1], 10) - 1] + '-' + parts[0].slice(-2);
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

  /* ── Data Loading (SQL) ── */
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

  function initData(resp) {
    var cols = resp.columns;
    rawRows = resp.rows;

    colIdx = {
      month:   findCol(cols, ['MONTH', 'Month']),
      amount:  findCol(cols, ['AMOUNT', 'Amount']),
      source:  findCol(cols, ['SOURCE', 'Source', 'Column']),
      metrics: findCol(cols, ['Metrics', 'METRICS', 'Metric']),
      region:  findCol(cols, ['Region', 'region', 'REGION'])
    };

    if (colIdx.month === -1 || colIdx.amount === -1 || colIdx.metrics === -1) {
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

  /* ── Refresh P&L ── */
  function refreshPL() {
    if (!rawRows) return;
    var rows = getFilteredRows();
    var result = aggregateRows(rows);
    clearTable();
    renderTable(result);
  }

  /* ── Compute all derived rows from a getCat(name) function ── */
  function computeRows(getCat) {
    var rev       = getCat('Service Revenue');
    var labor     = getCat('Total Labor');
    var bnt       = getCat('Benefits & Taxes');
    var supplies  = getCat('Supplies & Materials');
    var contracts = getCat('Contract Expenses');
    var fieldOH   = getCat('Field Overhead');
    var salesOH   = getCat('Sales Overhead');
    var hqOH      = getCat('HQ Overhead');
    var addbacks  = getCat('Total Addbacks');

    var grossMargin       = rev - labor - bnt - supplies;
    var grossContribution = grossMargin - contracts;
    var totalOverhead     = fieldOH + salesOH + hqOH;
    var netIncome         = grossContribution - totalOverhead;
    var adjEbitda         = netIncome + addbacks;

    return {
      '_laborPctRev':       rev !== 0 ? labor / rev : 0,
      '_bntPctLabor':       labor !== 0 ? bnt / labor : 0,
      '_suppliesPctLabor':  labor !== 0 ? supplies / labor : 0,
      '_grossMargin':       grossMargin,
      '_gmPct':             rev !== 0 ? grossMargin / rev : 0,
      '_contractPctRev':    rev !== 0 ? contracts / rev : 0,
      '_grossContribution': grossContribution,
      '_gcPct':             rev !== 0 ? grossContribution / rev : 0,
      '_totalOverhead':     totalOverhead,
      '_ohPctRev':          rev !== 0 ? totalOverhead / rev : 0,
      '_netIncome':         netIncome,
      '_adjEbitda':         adjEbitda,
      '_ebitdaPctRev':      rev !== 0 ? adjEbitda / rev : 0
    };
  }

  /* ── Aggregate (data pre-aggregated by SQL, just pivot here) ── */
  function aggregateRows(rows) {
    var actData  = {};
    var budData  = {};
    var fcstData = {};
    var monthSet = {};
    var monthActCount = {};

    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var cat = row[colIdx.metrics] || '';
      var rawMonth = row[colIdx.month];
      var rawAmt = parseFloat(row[colIdx.amount]) || 0;
      var src = colIdx.source >= 0 ? (row[colIdx.source] || '').trim().toUpperCase() : '';

      if (!cat || !rawMonth || !VALID_CATS[cat]) continue;

      var mk = ('' + rawMonth).substring(0, 7);
      if (mk.substring(0, 4) !== '2026') continue;

      var isActual   = (src === 'ACTUAL' || src === 'ACTUALS' || src === 'GL_ACTUALS');
      var isBudget   = (src === 'GL_BUDGET' || src === 'BUDGET');
      var isForecast = (src === 'GL_FORECAST' || src === 'FORECAST');
      if (!isActual && !isBudget && !isForecast) continue;

      monthSet[mk] = true;

      /* Negate credit categories for ACTUALS only */
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

    var months = Object.keys(monthSet).sort();

    var now = new Date();
    var curMonthKey = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2);

    var monthType = {};
    months.forEach(function (mk) {
      monthType[mk] = (mk < curMonthKey && monthActCount[mk]) ? 'ACT' : 'FCST';
    });

    /* Merged data: actuals for closed months, forecast for open */
    var merged = {};
    var allCats = {};
    [actData, budData, fcstData].forEach(function (d) {
      for (var c in d) allCats[c] = true;
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

    /* Compute derived rows per month */
    var computed = {};
    months.forEach(function (mk) {
      var vals = computeRows(function (c) {
        return (merged[c] && merged[c][mk]) || 0;
      });
      for (var k in vals) {
        if (!computed[k]) computed[k] = {};
        computed[k][mk] = vals[k];
      }
    });

    /* FY Budget totals */
    var budTotals = {};
    for (var bc in allCats) {
      var total = 0;
      months.forEach(function (mk) {
        total += (budData[bc] && budData[bc][mk]) || 0;
      });
      budTotals[bc] = total;
    }
    var budComputed = computeRows(function (c) { return budTotals[c] || 0; });

    return {
      displayRows: PL_ROWS.slice(),
      months: months,
      monthType: monthType,
      merged: merged,
      computed: computed,
      budTotals: budTotals,
      budComputed: budComputed
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
    var displayRows = result.displayRows;
    var months      = result.months;
    var monthType   = result.monthType;
    var merged      = result.merged;
    var computed    = result.computed;
    var budTotals   = result.budTotals;
    var budComputed = result.budComputed;

    var table = document.getElementById('pl-table');
    var thead = document.getElementById('pl-thead');
    var tbody = document.getElementById('pl-tbody');

    var totalCols = months.length + 4;

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
    for (var ci = 0; ci < 3; ci++) {
      var cf = document.createElement('col');
      cf.className = 'col-data';
      cg.appendChild(cf);
    }
    table.insertBefore(cg, thead);

    /* Header row 1 */
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

    var thBud = document.createElement('th');
    thBud.textContent = 'FY Budget';
    thBud.className = 'budget-header';
    thBud.rowSpan = 2;
    tr1.appendChild(thBud);

    var thVar = document.createElement('th');
    thVar.textContent = 'Variance';
    thVar.className = 'var-header';
    thVar.rowSpan = 2;
    tr1.appendChild(thVar);

    thead.appendChild(tr1);

    /* Header row 2 */
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
        td.colSpan = totalCols;
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
      }

      if (type === 'header') {
        var tdH = document.createElement('td');
        tdH.colSpan = totalCols;
        tdH.textContent = label;
        tr.appendChild(tdH);
        tbody.appendChild(tr);
        return;
      }

      var tdLabel = document.createElement('td');
      tdLabel.textContent = label;
      tr.appendChild(tdLabel);

      var isPct = type === 'pct';
      var isComputed = key && key[0] === '_';
      var source = isComputed ? computed[key] : merged[key];
      var fyTotal = 0;

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
        tr.appendChild(td);
      });

      /* FY Total */
      var tdFY = document.createElement('td');
      tdFY.className = 'fy-total-cell';
      var fyVal;
      if (isPct) {
        var fyComp = computeRows(function (c) {
          var s = merged[c];
          if (!s) return 0;
          var t = 0;
          months.forEach(function (mk) { t += s[mk] || 0; });
          return t;
        });
        fyVal = fyComp[key] || 0;
        tdFY.textContent = fmtPct(fyVal);
      } else {
        fyVal = fyTotal;
        tdFY.textContent = fmt(fyTotal);
        tdFY.className += ' ' + valClass(fyTotal);
      }
      tr.appendChild(tdFY);

      /* FY Budget */
      var tdBud = document.createElement('td');
      tdBud.className = 'budget-cell';
      var budVal = isComputed ? (budComputed[key] || 0) : (budTotals[key] || 0);
      tdBud.textContent = isPct ? fmtPct(budVal) : fmt(budVal);
      var bvc = valClass(budVal);
      if (bvc) tdBud.className += ' ' + bvc;
      tr.appendChild(tdBud);

      /* FY Variance */
      var tdVar = document.createElement('td');
      tdVar.className = 'var-cell';
      var variance = fyVal - budVal;
      tdVar.textContent = isPct ? fmtPct(variance) : fmt(variance);
      tdVar.className += ' ' + varClass(variance);
      tr.appendChild(tdVar);

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
