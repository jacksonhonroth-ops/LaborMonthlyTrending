/* ================================================================
   National P&L – DOMO Phoenix Pro Code Card
   Fetches via /data/v1/dataset?limit=N (ryuu columnar format)
   SOURCE: GL_FORECAST = forecast, anything else = actuals
   ================================================================ */
(function () {
  'use strict';

  var DATA_URL = '/data/v1/dataset?limit=500000';

  /* ── P&L Structure ──
     [label, matchKey (null=computed/header), type, sign]
     type: header | category | subtotal | spacer | pct
     sign: used for subtotal computation; categories inherit section sign */
  var PL_ROWS = [
    ['Revenue',            null,                  'header'],
    ['Service Revenue',    'Service Revenue',     'category'],
    ['Total Revenue',      '_totalRevenue',       'subtotal'],
    [null,                 null,                  'spacer'],

    ['Cost of Goods Sold', null,                  'header'],
    ['Total Labor',        'Total Labor',         'category'],
    ['Contract Expenses',  'Contract Expenses',   'category'],
    ['Supplies & Materials','Supplies & Materials','category'],
    ['Total COGS',         '_totalCOGS',          'subtotal'],
    [null,                 null,                  'spacer'],

    ['Gross Profit',       '_grossProfit',        'subtotal'],
    ['GP %',               '_gpPct',              'pct'],
    [null,                 null,                  'spacer'],

    ['Operating Expenses', null,                  'header'],
    ['Field Overhead',     'Field Overhead',      'category'],
    ['Benefits & Taxes',   'Benefits & Taxes',    'category'],
    ['Total OpEx',         '_totalOpEx',          'subtotal'],
    [null,                 null,                  'spacer'],

    ['Net Income',         '_netIncome',          'subtotal'],
    ['NI %',               '_niPct',              'pct']
  ];

  /* Categories that belong to each subtotal */
  var REVENUE_CATS = ['Service Revenue'];
  var COGS_CATS = ['Total Labor', 'Contract Expenses', 'Supplies & Materials'];
  var OPEX_CATS = ['Field Overhead', 'Benefits & Taxes'];

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

  /* ── Data Loading ── */
  function loadData() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', DATA_URL, true);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.timeout = 60000;
    xhr.onload = function () {
      if (xhr.status !== 200) {
        showError('HTTP ' + xhr.status);
        return;
      }
      try {
        processData(JSON.parse(xhr.responseText));
      } catch (e) {
        showError('Parse error: ' + e.message);
      }
    };
    xhr.onerror = function () { showError('Network error'); };
    xhr.ontimeout = function () { showError('Timeout – dataset may be too large'); };
    xhr.send();
  }

  function showError(msg) {
    document.getElementById('loader').innerHTML =
      '<span style="color:#d32f2f;font-size:13px;">' + msg + '</span>';
  }

  /* ── Process ── */
  function processData(resp) {
    var cols = resp.columns;
    var rows = resp.rows;

    var iMonth = cols.indexOf('MONTH');
    var iAmount = cols.indexOf('AMOUNT');
    var iSource = cols.indexOf('SOURCE');
    var iCat = cols.indexOf('P&L Category Name');
    if (iCat === -1) iCat = cols.indexOf('PLCategoryName');
    if (iAmount === -1) iAmount = cols.indexOf('Amount');

    if (iMonth === -1 || iAmount === -1 || iCat === -1) {
      showError('Missing columns. Found: ' + cols.join(', '));
      return;
    }

    /* Separate actuals and forecast into different buckets */
    var actData = {};   // { cat: { mk: sum } }
    var fcstData = {};  // { cat: { mk: sum } }
    var monthSet = {};
    var monthHasActuals = {};  // { mk: true } if any actual row exists

    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var cat = row[iCat];
      var rawMonth = row[iMonth];
      var amt = parseFloat(row[iAmount]) || 0;
      var src = iSource >= 0 ? (row[iSource] || '').trim() : '';

      if (!cat || !rawMonth) continue;

      var mk = rawMonth.substring(0, 7);
      monthSet[mk] = true;

      var isForecast = src.toUpperCase().indexOf('FORECAST') >= 0;

      if (isForecast) {
        if (!fcstData[cat]) fcstData[cat] = {};
        fcstData[cat][mk] = (fcstData[cat][mk] || 0) + amt;
      } else {
        if (!actData[cat]) actData[cat] = {};
        actData[cat][mk] = (actData[cat][mk] || 0) + amt;
        monthHasActuals[mk] = true;
      }
    }

    var months = Object.keys(monthSet).filter(function (mk) {
      return mk.substring(0, 4) === '2026';
    }).sort();

    /* For each month: use actuals if available, else forecast */
    var monthType = {};
    months.forEach(function (mk) {
      monthType[mk] = monthHasActuals[mk] ? 'ACT' : 'FCST';
    });

    /* Merged data: pick actuals or forecast per month */
    var merged = {};  // { cat: { mk: value } }
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
    months.forEach(function (mk) {
      var rev = sumCats(REVENUE_CATS, mk);
      var cogs = sumCats(COGS_CATS, mk);
      var opex = sumCats(OPEX_CATS, mk);
      var gp = rev - cogs;
      var ni = gp - opex;

      if (!computed['_totalRevenue']) computed['_totalRevenue'] = {};
      if (!computed['_totalCOGS']) computed['_totalCOGS'] = {};
      if (!computed['_grossProfit']) computed['_grossProfit'] = {};
      if (!computed['_gpPct']) computed['_gpPct'] = {};
      if (!computed['_totalOpEx']) computed['_totalOpEx'] = {};
      if (!computed['_netIncome']) computed['_netIncome'] = {};
      if (!computed['_niPct']) computed['_niPct'] = {};

      computed['_totalRevenue'][mk] = rev;
      computed['_totalCOGS'][mk] = cogs;
      computed['_grossProfit'][mk] = gp;
      computed['_gpPct'][mk] = rev !== 0 ? gp / rev : 0;
      computed['_totalOpEx'][mk] = opex;
      computed['_netIncome'][mk] = ni;
      computed['_niPct'][mk] = rev !== 0 ? ni / rev : 0;
    });

    /* Add any categories not in PL_ROWS to an "Other" section */
    var knownCats = {};
    PL_ROWS.forEach(function (r) { if (r[1] && r[1][0] !== '_') knownCats[r[1]] = true; });
    var extraCats = Object.keys(allCats).filter(function (c) { return !knownCats[c]; }).sort();

    var displayRows = PL_ROWS.slice();
    if (extraCats.length > 0) {
      // Insert extra categories before Net Income
      var niIdx = displayRows.findIndex(function (r) { return r[1] === '_netIncome'; });
      var extras = [[null, null, 'spacer'], ['Other', null, 'header']];
      extraCats.forEach(function (c) {
        extras.push([c, c, 'category']);
      });
      displayRows.splice(niIdx, 0, extras[0], extras[1]);
      for (var x = 2; x < extras.length; x++) {
        displayRows.splice(niIdx + x, 0, extras[x]);
      }
    }

    renderTable(displayRows, months, monthType, merged, computed);
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
      var key = def[1];
      var type = def[2];

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
