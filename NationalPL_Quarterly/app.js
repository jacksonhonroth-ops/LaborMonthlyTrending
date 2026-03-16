/* ================================================================
   National P&L – Quarterly View
   Per quarter: Actuals (or QTD), Budget, Forecast
   FY: Total (closed-Q actuals + forecast for open), Budget, Variance
   ================================================================ */
(function () {
  'use strict';

  var DATA_URL = '/data/v1/dataset?limit=5000000';

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

  var CREDIT_CATS = ['Service Revenue'];

  var METRICS_MAP = {
    'Other Expense (Income)': 'Other Income/ Expense'
  };

  var VALID_CATS = {};
  PL_ROWS.forEach(function (r) { if (r[1] && r[1][0] !== '_') VALID_CATS[r[1]] = true; });

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

  function varClass(val) {
    if (val == null || isNaN(val) || val === 0) return '';
    return val > 0 ? 'val-positive' : 'val-negative';
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
    var actData  = {};
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

    /* Quarter status */
    var quarterStatus = {};
    QUARTERS.forEach(function (q) {
      var actCount = q.months.filter(function (mk) { return monthType[mk] === 'ACT'; }).length;
      if (actCount === 3) quarterStatus[q.label] = 'closed';
      else if (actCount > 0) quarterStatus[q.label] = 'partial';
      else quarterStatus[q.label] = 'none';
    });

    var allCats = {};
    [actData, budData, fcstData].forEach(function (d) {
      for (var c in d) allCats[c] = true;
    });

    /* Roll up a data source to quarterly + FY */
    function rollUpSource(dataObj) {
      var qData = {};
      for (var cat in allCats) {
        qData[cat] = {};
        var fy = 0;
        QUARTERS.forEach(function (q) {
          var sum = 0;
          q.months.forEach(function (mk) {
            sum += (dataObj[cat] && dataObj[cat][mk]) || 0;
          });
          qData[cat][q.label] = sum;
          fy += sum;
        });
        qData[cat]['FY'] = fy;
      }
      return qData;
    }

    /* Roll up actuals for closed months only (for QTD) */
    function rollUpActualsQTD() {
      var qData = {};
      for (var cat in allCats) {
        qData[cat] = {};
        QUARTERS.forEach(function (q) {
          var sum = 0;
          q.months.forEach(function (mk) {
            if (monthType[mk] === 'ACT') {
              sum += (actData[cat] && actData[cat][mk]) || 0;
            }
          });
          qData[cat][q.label] = sum;
        });
      }
      return qData;
    }

    var qActQTD = rollUpActualsQTD();
    var qBudRaw = rollUpSource(budData);
    var qFcstRaw = rollUpSource(fcstData);

    /* Compute derived rows per quarter for each source */
    function computeQuarterRows(qCatData, labels) {
      var qComp = {};
      labels.forEach(function (ql) {
        var vals = computeRows(function (c) {
          return (qCatData[c] && qCatData[c][ql]) || 0;
        });
        for (var k in vals) {
          if (!qComp[k]) qComp[k] = {};
          qComp[k][ql] = vals[k];
        }
      });
      return qComp;
    }

    var qLabels = QUARTERS.map(function (q) { return q.label; });

    var actQTDComp = computeQuarterRows(qActQTD, qLabels);
    var budComp    = computeQuarterRows(qBudRaw, qLabels.concat(['FY']));
    var fcstComp   = computeQuarterRows(qFcstRaw, qLabels.concat(['FY']));

    /* FY Total: closed-quarter actuals + forecast for open quarters */
    var fyTotalCats = {};
    for (var cat in allCats) {
      var fy = 0;
      QUARTERS.forEach(function (q) {
        if (quarterStatus[q.label] === 'closed') {
          fy += (qActQTD[cat] && qActQTD[cat][q.label]) || 0;
        } else {
          fy += (qFcstRaw[cat] && qFcstRaw[cat][q.label]) || 0;
        }
      });
      fyTotalCats[cat] = fy;
    }
    var fyTotalComp = computeRows(function (c) { return fyTotalCats[c] || 0; });

    /* FY Variance = FY Total - FY Budget */
    var fyBudCats = {};
    for (var bc in allCats) {
      fyBudCats[bc] = (qBudRaw[bc] && qBudRaw[bc]['FY']) || 0;
    }
    var fyBudComp = computeRows(function (c) { return fyBudCats[c] || 0; });

    return {
      qActQTD: qActQTD,
      actQTDComp: actQTDComp,
      qBud: qBudRaw,
      budComp: budComp,
      qFcst: qFcstRaw,
      fcstComp: fcstComp,
      fyTotalCats: fyTotalCats,
      fyTotalComp: fyTotalComp,
      fyBudCats: fyBudCats,
      fyBudComp: fyBudComp,
      quarterStatus: quarterStatus,
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
    var qActQTD     = result.qActQTD;
    var actQTDComp  = result.actQTDComp;
    var qBud        = result.qBud;
    var budComp     = result.budComp;
    var qFcst       = result.qFcst;
    var fcstComp    = result.fcstComp;
    var fyTotalCats = result.fyTotalCats;
    var fyTotalComp = result.fyTotalComp;
    var fyBudCats   = result.fyBudCats;
    var fyBudComp   = result.fyBudComp;
    var quarterStatus = result.quarterStatus;
    var displayRows = result.displayRows;
    var table = document.getElementById('pl-table');
    var thead = document.getElementById('pl-thead');
    var tbody = document.getElementById('pl-tbody');

    /* Build column layout dynamically */
    var colDefs = [];
    QUARTERS.forEach(function (q) {
      var st = quarterStatus[q.label];
      if (st === 'closed') {
        colDefs.push({ group: q.label, type: 'act', label: 'Actuals' });
      } else if (st === 'partial') {
        colDefs.push({ group: q.label, type: 'act', label: 'Actuals QTD' });
      }
      colDefs.push({ group: q.label, type: 'bud', label: 'Budget' });
      colDefs.push({ group: q.label, type: 'fcst', label: 'Forecast' });
    });
    colDefs.push({ group: 'FY', type: 'total', label: 'Total' });
    colDefs.push({ group: 'FY', type: 'bud',   label: 'Budget' });
    colDefs.push({ group: 'FY', type: 'var',   label: 'Variance' });

    var totalDataCols = colDefs.length;

    /* Group spans for header row 1 */
    var groupSpans = {};
    colDefs.forEach(function (cd) {
      groupSpans[cd.group] = (groupSpans[cd.group] || 0) + 1;
    });
    var groupOrder = [];
    colDefs.forEach(function (cd) {
      if (groupOrder.indexOf(cd.group) === -1) groupOrder.push(cd.group);
    });

    /* Colgroup */
    var cg = document.createElement('colgroup');
    var c0 = document.createElement('col');
    c0.className = 'col-label';
    cg.appendChild(c0);
    colDefs.forEach(function (cd) {
      var c = document.createElement('col');
      c.className = cd.group === 'FY' ? 'col-data col-fy' : 'col-data';
      cg.appendChild(c);
    });
    table.insertBefore(cg, thead);

    /* Header row 1 */
    var tr1 = document.createElement('tr');
    tr1.className = 'header-months';
    var th0 = document.createElement('th');
    th0.className = 'col-label-header';
    th0.textContent = 'P&L Category';
    th0.rowSpan = 2;
    tr1.appendChild(th0);

    groupOrder.forEach(function (grp) {
      var th = document.createElement('th');
      th.colSpan = groupSpans[grp];
      if (grp === 'FY') {
        th.textContent = 'FY Total';
        th.className = 'fy-total';
      } else {
        th.textContent = grp;
        var st = quarterStatus[grp];
        th.className = 'quarter-group' + (st === 'closed' ? ' act' : st === 'partial' ? ' partial' : ' fcst');
      }
      tr1.appendChild(th);
    });
    thead.appendChild(tr1);

    /* Header row 2 */
    var tr2 = document.createElement('tr');
    tr2.className = 'header-type';
    colDefs.forEach(function (cd) {
      var th = document.createElement('th');
      th.textContent = cd.label;
      th.className = 'sub-' + cd.type + (cd.group === 'FY' ? ' fy-sub' : '');
      tr2.appendChild(th);
    });
    thead.appendChild(tr2);

    /* Helper: get value for a key from the right source */
    function getVal(key, cd) {
      var isComputed = key && key[0] === '_';

      if (cd.group === 'FY') {
        if (cd.type === 'total') {
          return isComputed ? (fyTotalComp[key] || 0) : (fyTotalCats[key] || 0);
        } else if (cd.type === 'bud') {
          return isComputed ? (fyBudComp[key] || 0) : (fyBudCats[key] || 0);
        } else if (cd.type === 'var') {
          var totVal = isComputed ? (fyTotalComp[key] || 0) : (fyTotalCats[key] || 0);
          var budVal = isComputed ? (fyBudComp[key] || 0) : (fyBudCats[key] || 0);
          return totVal - budVal;
        }
      }

      /* Quarter columns */
      if (cd.type === 'act') {
        if (isComputed) return (actQTDComp[key] && actQTDComp[key][cd.group]) || 0;
        return (qActQTD[key] && qActQTD[key][cd.group]) || 0;
      } else if (cd.type === 'bud') {
        if (isComputed) return (budComp[key] && budComp[key][cd.group]) || 0;
        return (qBud[key] && qBud[key][cd.group]) || 0;
      } else if (cd.type === 'fcst') {
        if (isComputed) return (fcstComp[key] && fcstComp[key][cd.group]) || 0;
        return (qFcst[key] && qFcst[key][cd.group]) || 0;
      }
      return 0;
    }

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

      var tdLabel = document.createElement('td');
      tdLabel.textContent = label;
      tr.appendChild(tdLabel);

      var isPct = type === 'pct';

      colDefs.forEach(function (cd) {
        var td = document.createElement('td');
        var val = getVal(key, cd);

        td.textContent = isPct ? fmtPct(val) : fmt(val);

        var cls = '';
        if (cd.group === 'FY') cls = 'fy-total-cell';
        if (cd.type === 'var') {
          cls += (cls ? ' ' : '') + varClass(val) + ' var-cell';
        } else {
          var vc = valClass(val);
          if (vc) cls += (cls ? ' ' : '') + vc;
        }
        if (cls) td.className = cls;

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
