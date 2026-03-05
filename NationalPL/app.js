/* ================================================================
   National P&L – DOMO Phoenix Pro Code Card
   Uses native fetch against /data/v1/ proxy (no domo.js needed)
   ================================================================ */

(function () {
  'use strict';

  /* ── Config ── */
  var ALIAS = 'dataset';
  var DATA_URL = '/data/v1/' + ALIAS;

  /* P&L row order – each entry: [label, matchKey, type]
     type: 'header' | 'category' | 'subtotal' | 'pct' | 'spacer' */
  var PL_STRUCTURE = [
    ['Revenue',                   null,                          'header'],
    ['T&M Revenue',               'T&M Revenue',                 'category'],
    ['Fixed Price Revenue',       'Fixed Price Revenue',         'category'],
    ['Service Revenue',           'Service Revenue',             'category'],
    ['Total Revenue',             'Total Revenue',               'subtotal'],
    [null,                        null,                          'spacer'],
    ['Cost of Goods Sold',        null,                          'header'],
    ['Direct Labor',              'Direct Labor',                'category'],
    ['Subcontractor COGS',        'Subcontractor COGS',          'category'],
    ['Materials',                 'Materials',                   'category'],
    ['Equipment',                 'Equipment',                   'category'],
    ['Other Direct Costs',        'Other Direct Costs',          'category'],
    ['Total COGS',                'Total COGS',                  'subtotal'],
    [null,                        null,                          'spacer'],
    ['Gross Profit',              'Gross Profit',                'subtotal'],
    ['GP %',                      'GP %',                        'pct'],
    [null,                        null,                          'spacer'],
    ['Operating Expenses',        null,                          'header'],
    ['Indirect Labor',            'Indirect Labor',              'category'],
    ['Facilities',                'Facilities',                  'category'],
    ['Insurance',                 'Insurance',                   'category'],
    ['Vehicle Expense',           'Vehicle Expense',             'category'],
    ['Travel & Entertainment',    'Travel & Entertainment',      'category'],
    ['Office & Admin',            'Office & Admin',              'category'],
    ['Professional Fees',         'Professional Fees',           'category'],
    ['Other OpEx',                'Other OpEx',                  'category'],
    ['Total OpEx',                'Total OpEx',                  'subtotal'],
    [null,                        null,                          'spacer'],
    ['Net Income',                'Net Income',                  'subtotal'],
    ['NI %',                      'NI %',                        'pct']
  ];

  /* ── Helpers ── */
  function fmt(val, isPct) {
    if (val == null || isNaN(val)) return '';
    if (isPct) return (val * 100).toFixed(1) + '%';
    var neg = val < 0;
    var abs = Math.abs(val);
    var str;
    if (abs >= 1000) {
      str = '$' + Math.round(abs).toLocaleString('en-US');
    } else {
      str = '$' + abs.toFixed(0);
    }
    return neg ? '(' + str + ')' : str;
  }

  function valClass(val) {
    if (val == null || isNaN(val)) return '';
    return val < 0 ? 'val-negative' : '';
  }

  function monthKey(dateStr) {
    // dateStr might be "2025-01-01", "Jan 2025", "2025-01", etc.
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    var yyyy = d.getFullYear();
    var mm = ('0' + (d.getMonth() + 1)).slice(-2);
    return yyyy + '-' + mm;
  }

  function monthLabel(key) {
    // key = "2025-01" -> "Jan 25"
    var parts = key.split('-');
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[parseInt(parts[1], 10) - 1] + ' ' + parts[0].slice(-2);
  }

  function sortMonthKeys(keys) {
    return keys.sort(function (a, b) { return a.localeCompare(b); });
  }

  /* ── Fetch data via /data/v1/ proxy ── */
  function query(sql) {
    return fetch(DATA_URL + '?query=' + encodeURIComponent(sql), {
      headers: { 'Accept': 'application/json' }
    }).then(function (resp) {
      if (!resp.ok) throw new Error('Data query failed: ' + resp.status);
      return resp.json();
    });
  }

  /* ── Main ── */
  function init() {
    // Fetch all data grouped by category, month, source
    var sql = 'SELECT `PLCategoryName`, `MONTH`, `SOURCE`, SUM(`AMOUNT`) as TOTAL ' +
              'FROM `dataset` GROUP BY `PLCategoryName`, `MONTH`, `SOURCE` ' +
              'ORDER BY `MONTH`, `PLCategoryName`';

    query(sql).then(function (rows) {
      if (!rows || !rows.length) {
        showError('No data returned from dataset.');
        return;
      }
      processAndRender(rows);
    }).catch(function (err) {
      console.error('Data load error:', err);
      // Fallback: try without SQL (some DOMO versions return all rows)
      fetch(DATA_URL, { headers: { 'Accept': 'application/json' } })
        .then(function (resp) { return resp.json(); })
        .then(function (rows) {
          if (!rows || !rows.length) {
            showError('No data returned. Error: ' + err.message);
            return;
          }
          processAndRender(rows);
        })
        .catch(function (err2) {
          showError('Data load failed: ' + err.message + ' / ' + err2.message);
        });
    });
  }

  function showError(msg) {
    var loader = document.getElementById('loader');
    loader.innerHTML = '<span style="color:#d32f2f;font-size:13px;">' + msg + '</span>';
  }

  function processAndRender(rows) {
    // Discover field names (could be aliases or original names)
    var sample = rows[0];
    var catField = sample.PLCategoryName != null ? 'PLCategoryName' :
                   sample['P&L Category Name'] != null ? 'P&L Category Name' : 'PLCategoryName';
    var monthField = sample.MONTH != null ? 'MONTH' : 'Month';
    var sourceField = sample.SOURCE != null ? 'SOURCE' : 'Source';
    var amtField = sample.TOTAL != null ? 'TOTAL' :
                   sample.AMOUNT != null ? 'AMOUNT' :
                   sample.Amount != null ? 'Amount' : 'TOTAL';

    /* ── Build lookup: { category: { monthKey: { ACT: val, FCST: val } } } ── */
    var data = {};
    var monthSet = {};

    rows.forEach(function (r) {
      var cat = r[catField];
      var mk = monthKey(r[monthField]);
      var src = (r[sourceField] || '').toUpperCase().trim();
      var amt = parseFloat(r[amtField]) || 0;

      if (!cat) return;
      monthSet[mk] = true;
      if (!data[cat]) data[cat] = {};
      if (!data[cat][mk]) data[cat][mk] = { ACT: 0, FCST: 0 };

      // If pre-aggregated (SQL worked), use directly; otherwise accumulate
      if (src === 'ACT' || src === 'ACTUAL' || src === 'ACTUALS') {
        data[cat][mk].ACT += amt;
      } else {
        data[cat][mk].FCST += amt;
      }
    });

    var months = sortMonthKeys(Object.keys(monthSet));

    // Determine which months are ACT vs FCST based on data presence
    // A month is ACT if any category has ACT data for it
    var monthSource = {};
    months.forEach(function (mk) {
      var hasAct = false;
      for (var cat in data) {
        if (data[cat][mk] && data[cat][mk].ACT !== 0) {
          hasAct = true;
          break;
        }
      }
      monthSource[mk] = hasAct ? 'ACT' : 'FCST';
    });

    // Build the set of categories that actually exist in data
    var existingCats = {};
    for (var cat in data) existingCats[cat] = true;

    // Filter PL_STRUCTURE to only include categories that exist,
    // but keep headers/spacers/subtotals that have at least one adjacent category
    var displayRows = buildDisplayRows(existingCats);

    renderTable(displayRows, months, monthSource, data);
  }

  function buildDisplayRows(existingCats) {
    // If we have very few matching categories, just show what we have
    var matched = 0;
    PL_STRUCTURE.forEach(function (row) {
      if (row[1] && existingCats[row[1]]) matched++;
    });

    if (matched > 0) {
      // Use the structured layout, skipping categories that don't exist
      return PL_STRUCTURE.filter(function (row) {
        if (row[2] === 'header' || row[2] === 'spacer' || row[2] === 'subtotal' || row[2] === 'pct') return true;
        return row[1] && existingCats[row[1]];
      });
    }

    // Fallback: none of our predefined categories matched.
    // Build a simple list from the actual categories.
    var result = [];
    var cats = Object.keys(existingCats).sort();
    cats.forEach(function (cat) {
      result.push([cat, cat, 'category']);
    });
    return result;
  }

  function renderTable(displayRows, months, monthSource, data) {
    var table = document.getElementById('pl-table');
    var thead = document.getElementById('pl-thead');
    var tbody = document.getElementById('pl-tbody');

    /* ── Colgroup ── */
    var colgroup = document.createElement('colgroup');
    var col0 = document.createElement('col');
    col0.className = 'col-label';
    colgroup.appendChild(col0);
    months.forEach(function () {
      var col = document.createElement('col');
      col.className = 'col-data';
      colgroup.appendChild(col);
    });
    // FY Total column
    var colFY = document.createElement('col');
    colFY.className = 'col-data';
    colgroup.appendChild(colFY);
    table.insertBefore(colgroup, thead);

    /* ── Header row 1: Month names ── */
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

    /* ── Header row 2: ACT / FCST labels ── */
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
    thFY2.textContent = '';
    tr2.appendChild(thFY2);
    thead.appendChild(tr2);

    /* ── Body rows ── */
    displayRows.forEach(function (rowDef) {
      var label = rowDef[0];
      var matchKey = rowDef[1];
      var rowType = rowDef[2];

      var tr = document.createElement('tr');
      tr.className = 'row-' + rowType;

      if (rowType === 'spacer') {
        var td = document.createElement('td');
        td.colSpan = months.length + 2;
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
      }

      // Label cell
      var tdLabel = document.createElement('td');
      tdLabel.textContent = label;
      tr.appendChild(tdLabel);

      var catData = matchKey ? data[matchKey] : null;
      var isPct = rowType === 'pct';
      var fyTotal = 0;

      months.forEach(function (mk) {
        var td = document.createElement('td');
        if (catData && catData[mk]) {
          var val = monthSource[mk] === 'ACT' ? catData[mk].ACT : catData[mk].FCST;
          // If no split, use whichever is non-zero
          if (val === 0) val = catData[mk].ACT || catData[mk].FCST || 0;
          td.textContent = isPct ? fmt(val, true) : fmt(val);
          td.className = valClass(val);
          fyTotal += val;
        }
        tr.appendChild(td);
      });

      // FY Total
      var tdFY = document.createElement('td');
      tdFY.className = 'fy-total-cell';
      if (catData) {
        tdFY.textContent = isPct ? fmt(fyTotal / months.length, true) : fmt(fyTotal);
        tdFY.className += ' ' + valClass(fyTotal);
      }
      tr.appendChild(tdFY);

      tbody.appendChild(tr);
    });

    /* ── Hide loader ── */
    document.getElementById('loader').classList.add('hidden');
  }

  /* ── Boot ── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
