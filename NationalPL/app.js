/* ================================================================
   National P&L – DOMO Phoenix Pro Code Card
   Fetches via /data/v1/dataset?limit=N (ryuu columnar format)
   ================================================================ */
(function () {
  'use strict';

  var DATA_URL = '/data/v1/dataset?limit=100000';

  /* ── Helpers ── */
  function fmt(val) {
    if (val == null || isNaN(val)) return '';
    var neg = val < 0;
    var abs = Math.abs(val);
    var str = '$' + Math.round(abs).toLocaleString('en-US');
    return neg ? '(' + str + ')' : str;
  }

  function fmtPct(val) {
    if (val == null || isNaN(val)) return '';
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

  /* ── Fetch data ── */
  function loadData() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', DATA_URL, true);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.timeout = 60000;
    xhr.onload = function () {
      if (xhr.status !== 200) {
        showError('HTTP ' + xhr.status + ': ' + xhr.responseText.substring(0, 200));
        return;
      }
      try {
        var resp = JSON.parse(xhr.responseText);
        processData(resp);
      } catch (e) {
        showError('Parse error: ' + e.message);
      }
    };
    xhr.onerror = function () { showError('Network error'); };
    xhr.ontimeout = function () { showError('Request timeout (60s)'); };
    xhr.send();
  }

  function showError(msg) {
    document.getElementById('loader').innerHTML =
      '<span style="color:#d32f2f;font-size:13px;">' + msg + '</span>';
  }

  /* ── Process columnar data into P&L structure ── */
  function processData(resp) {
    var cols = resp.columns;
    var rows = resp.rows;

    // Find column indices
    var iMonth = cols.indexOf('MONTH');
    var iRegion = cols.indexOf('Region');
    var iAmount = cols.indexOf('AMOUNT');
    var iSource = cols.indexOf('SOURCE');
    var iCat = cols.indexOf('P&L Category Name');
    // Fallback to alias names
    if (iCat === -1) iCat = cols.indexOf('PLCategoryName');
    if (iAmount === -1) iAmount = cols.indexOf('Amount');

    if (iMonth === -1 || iAmount === -1 || iCat === -1) {
      showError('Missing columns. Found: ' + cols.join(', '));
      return;
    }

    /* Aggregate: { category: { monthKey: { ACT: sum, FCST: sum } } } */
    var data = {};
    var monthSet = {};
    var categorySet = {};

    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var cat = row[iCat];
      var rawMonth = row[iMonth];
      var amt = parseFloat(row[iAmount]) || 0;
      var src = iSource >= 0 ? (row[iSource] || '').toUpperCase().trim() : '';

      if (!cat || !rawMonth) continue;

      // Parse month: "2025-08-01" -> "2025-08"
      var mk = rawMonth.substring(0, 7);
      monthSet[mk] = true;
      categorySet[cat] = true;

      if (!data[cat]) data[cat] = {};
      if (!data[cat][mk]) data[cat][mk] = { ACT: 0, FCST: 0 };

      if (src === 'ACT' || src === 'ACTUAL' || src === 'ACTUALS') {
        data[cat][mk].ACT += amt;
      } else if (src === 'FCST' || src === 'FORECAST') {
        data[cat][mk].FCST += amt;
      } else {
        // Unknown source - add to both buckets, we'll pick the right one later
        data[cat][mk].ACT += amt;
      }
    }

    var months = Object.keys(monthSet).sort();

    // Determine ACT vs FCST per month
    var monthSource = {};
    months.forEach(function (mk) {
      var hasAct = false;
      for (var cat in data) {
        if (data[cat][mk] && data[cat][mk].ACT !== 0) { hasAct = true; break; }
      }
      monthSource[mk] = hasAct ? 'ACT' : 'FCST';
    });

    // Build display rows from actual categories
    var categories = Object.keys(categorySet).sort();
    renderTable(categories, months, monthSource, data);
  }

  /* ── Render ── */
  function renderTable(categories, months, monthSource, data) {
    var table = document.getElementById('pl-table');
    var thead = document.getElementById('pl-thead');
    var tbody = document.getElementById('pl-tbody');

    /* Colgroup */
    var cg = document.createElement('colgroup');
    var c0 = document.createElement('col');
    c0.className = 'col-label';
    cg.appendChild(c0);
    for (var m = 0; m < months.length; m++) {
      var c = document.createElement('col');
      c.className = 'col-data';
      cg.appendChild(c);
    }
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
      th.className = monthSource[mk] === 'ACT' ? 'act' : 'fcst';
      tr1.appendChild(th);
    });
    var thFY = document.createElement('th');
    thFY.textContent = 'FY Total';
    thFY.className = 'fy-total';
    tr1.appendChild(thFY);
    thead.appendChild(tr1);

    /* Header row 2: ACT/FCST */
    var tr2 = document.createElement('tr');
    tr2.className = 'header-type';
    months.forEach(function (mk) {
      var th = document.createElement('th');
      th.textContent = monthSource[mk];
      th.className = monthSource[mk] === 'ACT' ? 'act' : 'fcst';
      tr2.appendChild(th);
    });
    var thFY2 = document.createElement('th');
    thFY2.className = 'fy-total';
    tr2.appendChild(thFY2);
    thead.appendChild(tr2);

    /* Body rows */
    categories.forEach(function (cat) {
      var tr = document.createElement('tr');
      tr.className = 'row-category';

      var tdLabel = document.createElement('td');
      tdLabel.textContent = cat;
      tr.appendChild(tdLabel);

      var catData = data[cat];
      var fyTotal = 0;

      months.forEach(function (mk) {
        var td = document.createElement('td');
        if (catData && catData[mk]) {
          var val = monthSource[mk] === 'ACT' ? catData[mk].ACT : catData[mk].FCST;
          if (val === 0) val = catData[mk].ACT || catData[mk].FCST || 0;
          td.textContent = fmt(val);
          td.className = valClass(val);
          fyTotal += val;
        }
        tr.appendChild(td);
      });

      var tdFY = document.createElement('td');
      tdFY.className = 'fy-total-cell ' + valClass(fyTotal);
      tdFY.textContent = fmt(fyTotal);
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
