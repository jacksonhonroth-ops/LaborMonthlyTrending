// Labor MOM Trending Card
// Dataset: JOB_FINANCIALS_wo_JOIN_v2 (977fd639-75bb-422c-8773-a26488330bca)
// Combo chart: Actual/Forecast Labor vs Budget Labor (bars) + DL% and DL% Budget (lines)
// Uses most_recent_closing_period to determine closed vs open months
// Pulls ACTUAL, JOB_FORECAST, and OPS_FIN_BUDGET for Total Labor + Service Revenue

(function () {
  'use strict';

  // P&L Category Name values
  var laborCategories = ['Total Labor'];
  var revenueCategory = 'Service Revenue';

  // Source values
  var sourceActual = 'ACTUAL';
  var sourceBudget = 'OPS_FIN_BUDGET';
  var sourceForecast = 'JOB_FORECAST';

  var currentYear = new Date().getFullYear();

  var monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];

  // SQL query — pre-aggregate at dataset level using MONTH field.
  // NOTE: most_recent_closing_period is fetched via MAX() so it does NOT
  // appear in the GROUP BY to avoid splitting budget rows.
  var SQL_QUERY = "SELECT `MONTH`, `SOURCE`, `P&L Category Name` as `Category`, " +
    "`Region`, `JobNumber`, `Parent Account`, `Operations Lead`, " +
    "MAX(`most_recent_closing_period`) as `most_recent_closing_period`, " +
    "SUM(`Amount`) as `Amount` " +
    "FROM dataset " +
    "WHERE `KeepActiveData` = 1 " +
    "AND `SOURCE` IN ('ACTUAL', 'OPS_FIN_BUDGET', 'JOB_FORECAST') " +
    "AND `P&L Category Name` IN ('Total Labor', 'Service Revenue') " +
    "AND YEAR(`MONTH`) = " + currentYear + " " +
    "GROUP BY `MONTH`, `SOURCE`, `P&L Category Name`, `Region`, " +
    "`JobNumber`, `Parent Account`, `Operations Lead`";

  // ─── Utilities ──────────────────────────────────────────────────────

  function findCol(columns, names) {
    for (var i = 0; i < names.length; i++) {
      var idx = columns.indexOf(names[i]);
      if (idx !== -1) return idx;
    }
    return -1;
  }

  function parseDate(raw) {
    if (typeof raw === 'number') return new Date(raw);
    var s = String(raw);
    if (/^\d{10,}$/.test(s)) return new Date(parseInt(s, 10));
    return new Date(s);
  }

  // Parse closing period to a monthKey.
  // If the value is a date string like "2026-02-01", extract year-month directly
  // to avoid UTC timezone shifting (which would turn Feb 1 into Jan 31 UTC).
  // For epoch timestamps, parse normally with UTC.
  function closingPeriodToKey(raw) {
    var s = String(raw);
    // Try to extract YYYY-MM from an ISO-style date string first
    var match = s.match(/^(\d{4})-(\d{2})/);
    if (match) {
      return match[1] + '-' + match[2];
    }
    // Fallback for epoch timestamps — use UTC like the rest of the app
    var d = parseDate(raw);
    return mkKey(d);
  }

  function mkKey(d) {
    var year = d.getUTCFullYear();
    var mm = ('0' + (d.getUTCMonth() + 1)).slice(-2);
    return year + '-' + mm;
  }

  function monthLabel(key) {
    var parts = key.split('-');
    var monthNum = parseInt(parts[1], 10);
    return monthNames[monthNum - 1] + ' ' + parts[0];
  }

  function fmtCurrency(value) {
    var prefix = value < 0 ? '-$' : '$';
    return prefix + Math.abs(value).toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    });
  }

  function fmtCurrencyShort(value) {
    var abs = Math.abs(value);
    if (abs >= 1000000) return (value < 0 ? '-$' : '$') + (abs / 1000000).toFixed(1) + 'M';
    if (abs >= 1000) return (value < 0 ? '-$' : '$') + (abs / 1000).toFixed(0) + 'K';
    return fmtCurrency(value);
  }

  // Normalize amounts by source:
  // - Revenue: actuals stored as negative (GL credits) → negate to positive
  //            budget/forecast stored as positive → keep as-is
  // - Labor: always positive regardless of source
  function normalizeAmount(amount, source, category) {
    var val = parseFloat(amount) || 0;
    if (category === revenueCategory && source === sourceActual) {
      return Math.abs(val);
    }
    return val;
  }

  // ─── State ──────────────────────────────────────────────────────────

  var rawRows = null;
  var col = null;
  var closingPeriodKey = null;
  var chartInstance = null;
  var currentView = 'chart';

  var loader = document.getElementById('loader');
  var loaderText = document.getElementById('loader-text');

  loaderText.textContent = 'Fetching labor data...';

  // ─── Debug ─────────────────────────────────────────────────────────

  function showDebug(cols, rows) {
    var panel = document.getElementById('debug-panel');
    if (!panel) return;
    panel.style.display = 'block';

    var lines = [];
    lines.push('=== LABOR MOM DEBUG ===');
    lines.push('currentYear: ' + currentYear);
    lines.push('columns: ' + JSON.stringify(cols));
    lines.push('col indices: ' + JSON.stringify(col));
    lines.push('total rows returned: ' + rows.length);
    lines.push('');

    // Closing period info
    var cpRaw = (col.closingPeriod >= 0 && rows.length > 0) ? rows[0][col.closingPeriod] : 'N/A';
    lines.push('closing period raw value: ' + JSON.stringify(cpRaw) + ' (type: ' + typeof cpRaw + ')');
    lines.push('closingPeriodKey: ' + closingPeriodKey);
    lines.push('');

    // Sample first 5 rows
    lines.push('--- First 5 rows ---');
    for (var i = 0; i < Math.min(5, rows.length); i++) {
      lines.push('row[' + i + ']: ' + JSON.stringify(rows[i]));
    }
    lines.push('');

    // Count rows by source
    var sourceCounts = {};
    var sourceCategories = {};
    for (var r = 0; r < rows.length; r++) {
      var src = rows[r][col.source];
      sourceCounts[src] = (sourceCounts[src] || 0) + 1;
      var cat = rows[r][col.category];
      var key = src + ' | ' + cat;
      sourceCategories[key] = (sourceCategories[key] || 0) + 1;
    }
    lines.push('--- Rows by SOURCE ---');
    Object.keys(sourceCounts).sort().forEach(function (s) {
      lines.push('  ' + s + ': ' + sourceCounts[s] + ' rows');
    });
    lines.push('');
    lines.push('--- Rows by SOURCE | Category ---');
    Object.keys(sourceCategories).sort().forEach(function (s) {
      lines.push('  ' + s + ': ' + sourceCategories[s] + ' rows');
    });
    lines.push('');

    // Parse dates and show unique monthKeys per source
    var monthsBySource = {};
    var skippedYear = 0;
    for (var r2 = 0; r2 < rows.length; r2++) {
      var row = rows[r2];
      var d = parseDate(row[col.date]);
      var yr = d.getUTCFullYear();
      var src2 = row[col.source];
      var mk = mkKey(d);
      if (yr !== currentYear) { skippedYear++; continue; }
      if (!monthsBySource[src2]) monthsBySource[src2] = {};
      monthsBySource[src2][mk] = (monthsBySource[src2][mk] || 0) + 1;
    }
    lines.push('--- MonthKeys per SOURCE (year=' + currentYear + ') ---');
    lines.push('rows skipped (wrong year): ' + skippedYear);
    Object.keys(monthsBySource).sort().forEach(function (src) {
      var mks = monthsBySource[src];
      lines.push('  ' + src + ':');
      Object.keys(mks).sort().forEach(function (mk) {
        lines.push('    ' + mk + ': ' + mks[mk] + ' rows');
      });
    });
    lines.push('');

    // Show first MONTH raw value + parsed date
    if (rows.length > 0) {
      var rawDate = rows[0][col.date];
      var parsed = parseDate(rawDate);
      lines.push('--- Date parsing check ---');
      lines.push('raw MONTH value: ' + JSON.stringify(rawDate) + ' (type: ' + typeof rawDate + ')');
      lines.push('parsed Date: ' + parsed.toISOString());
      lines.push('mkKey result: ' + mkKey(parsed));
      lines.push('getUTCFullYear: ' + parsed.getUTCFullYear());
    }

    panel.textContent = lines.join('\n');
  }

  // ─── Data fetch ─────────────────────────────────────────────────────

  domo.post('/sql/v1/dataset', SQL_QUERY, { contentType: 'text/plain' })
    .then(function (resp) {
      loaderText.textContent = 'Building view...';
      var cols = resp.columns;
      rawRows = resp.rows;
      col = {
        date: findCol(cols, ['MONTH', 'Month', 'month']),
        amount: findCol(cols, ['Amount', 'amount', 'AMOUNT']),
        category: findCol(cols, ['Category', 'P&L Category Name', 'PLCategoryName']),
        source: findCol(cols, ['SOURCE', 'Source', 'source']),
        region: findCol(cols, ['Region', 'region', 'REGION']),
        job: findCol(cols, ['JobNumber', 'jobnumber', 'JOB_NUMBER']),
        account: findCol(cols, ['Parent Account', 'ParentAccount', 'PARENT_ACCOUNT']),
        opsLead: findCol(cols, ['Operations Lead', 'OperationsLead', 'OpsLead']),
        closingPeriod: findCol(cols, ['most_recent_closing_period', 'mostRecentClosingPeriod'])
      };

      // Determine closing period from the first row that has it.
      // Use local time parsing so "2026-02-01" → Feb, not Jan (UTC shift).
      for (var r = 0; r < rawRows.length; r++) {
        if (col.closingPeriod >= 0 && rawRows[r][col.closingPeriod]) {
          closingPeriodKey = closingPeriodToKey(rawRows[r][col.closingPeriod]);
          break;
        }
      }
      // Fallback: if no closing period found, use prior month
      if (!closingPeriodKey) {
        var now = new Date();
        closingPeriodKey = now.getFullYear() + '-' + ('0' + now.getMonth()).slice(-2);
      }

      // ── DEBUG: dump data structure ──
      showDebug(cols, rawRows);

      populateFilters();
      refreshView();
      loader.classList.add('hidden');
    })
    .catch(function (err) {
      var msg = err && err.message ? err.message : JSON.stringify(err);
      loaderText.textContent = 'SQL error: ' + msg;
    });

  // ─── Filters ────────────────────────────────────────────────────────

  var filterRegion = document.getElementById('filter-region');
  var filterOps = document.getElementById('filter-ops');
  var filterJob = document.getElementById('filter-job');
  var filterAccount = document.getElementById('filter-account');
  var jobList = document.getElementById('job-list');
  var accountList = document.getElementById('account-list');

  function populateFilters() {
    var regions = {};
    var jobs = {};
    var accounts = {};
    var leads = {};

    for (var r = 0; r < rawRows.length; r++) {
      var row = rawRows[r];
      var rgn = col.region >= 0 ? row[col.region] : null;
      var j = col.job >= 0 ? row[col.job] : null;
      var a = col.account >= 0 ? row[col.account] : null;
      var o = col.opsLead >= 0 ? row[col.opsLead] : null;
      if (rgn && rgn !== 'HQ') regions[rgn] = true;
      if (j) jobs[j] = true;
      if (a) accounts[a] = true;
      if (o) leads[o] = true;
    }

    fillSelect(filterRegion, Object.keys(regions).sort());
    fillSelect(filterOps, Object.keys(leads).sort());
    fillDatalist(jobList, Object.keys(jobs).sort());
    fillDatalist(accountList, Object.keys(accounts).sort());
  }

  function fillSelect(el, values) {
    values.forEach(function (v) {
      var opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      el.appendChild(opt);
    });
  }

  function fillDatalist(el, values) {
    values.forEach(function (v) {
      var opt = document.createElement('option');
      opt.value = v;
      el.appendChild(opt);
    });
  }

  // Filter change listeners
  [filterRegion, filterOps].forEach(function (el) {
    el.addEventListener('change', refreshView);
  });

  var searchTimer = null;
  [filterJob, filterAccount].forEach(function (el) {
    el.addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(refreshView, 300);
    });
    el.addEventListener('change', refreshView);
  });

  document.getElementById('filter-clear').addEventListener('click', function () {
    filterRegion.value = '';
    filterOps.value = '';
    filterJob.value = '';
    filterAccount.value = '';
    refreshView();
  });

  function getFilteredRows() {
    var rVal = filterRegion.value;
    var oVal = filterOps.value;
    var jVal = filterJob.value.trim();
    var aVal = filterAccount.value.trim();

    if (!rVal && !jVal && !aVal && !oVal) return rawRows;

    var jLower = jVal.toLowerCase();
    var aLower = aVal.toLowerCase();

    return rawRows.filter(function (row) {
      if (col.region >= 0 && row[col.region] === 'HQ') return false;
      if (rVal && col.region >= 0 && row[col.region] !== rVal) return false;
      if (oVal && col.opsLead >= 0 && row[col.opsLead] !== oVal) return false;
      if (jVal && col.job >= 0) {
        var rowJob = (row[col.job] || '').toString().toLowerCase();
        if (rowJob.indexOf(jLower) === -1) return false;
      }
      if (aVal && col.account >= 0) {
        var rowAcct = (row[col.account] || '').toString().toLowerCase();
        if (rowAcct.indexOf(aLower) === -1) return false;
      }
      return true;
    });
  }

  // ─── View toggle ────────────────────────────────────────────────────

  var btnChart = document.getElementById('btn-chart');
  var btnTable = document.getElementById('btn-table');
  var chartContainer = document.getElementById('chart-container');
  var tableContainer = document.getElementById('table-container');

  btnChart.addEventListener('click', function () {
    if (currentView === 'chart') return;
    currentView = 'chart';
    btnChart.classList.add('active');
    btnTable.classList.remove('active');
    chartContainer.classList.remove('hidden');
    tableContainer.classList.add('hidden');
    refreshView();
  });

  btnTable.addEventListener('click', function () {
    if (currentView === 'table') return;
    currentView = 'table';
    btnTable.classList.add('active');
    btnChart.classList.remove('active');
    tableContainer.classList.remove('hidden');
    chartContainer.classList.add('hidden');
    refreshView();
  });

  // ─── Refresh ────────────────────────────────────────────────────────

  function refreshView() {
    if (!rawRows) return;
    var filteredRows = getFilteredRows();
    var processed = aggregateData(filteredRows);

    if (currentView === 'chart') {
      buildChart(processed);
    } else {
      buildTable(processed);
    }
  }

  // ─── Aggregation ────────────────────────────────────────────────────

  function aggregateData(rows) {
    // Three buckets: actual, forecast, budget
    // Each keyed by monthKey → { labor, revenue }
    var actual = {};
    var forecast = {};
    var budget = {};

    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var source = row[col.source];
      var category = row[col.category];

      if (source !== sourceActual && source !== sourceBudget && source !== sourceForecast) continue;
      if (laborCategories.indexOf(category) === -1 && category !== revenueCategory) continue;

      var d = parseDate(row[col.date]);
      if (d.getUTCFullYear() !== currentYear) continue;
      var mk = mkKey(d);
      var amount = normalizeAmount(row[col.amount], source, category);

      var target;
      if (source === sourceActual) target = actual;
      else if (source === sourceForecast) target = forecast;
      else target = budget;

      if (!target[mk]) target[mk] = { labor: 0, revenue: 0 };

      if (laborCategories.indexOf(category) !== -1) {
        target[mk].labor += amount;
      } else if (category === revenueCategory) {
        target[mk].revenue += amount;
      }
    }

    // Build full 12-month year
    var sortedKeys = [];
    for (var m = 1; m <= 12; m++) {
      sortedKeys.push(currentYear + '-' + ('0' + m).slice(-2));
    }

    var months = [];
    var monthKeys = [];
    var monthSources = [];
    var actualFcstLabor = [];  // actual or forecast labor
    var budgetLaborArr = [];   // budget labor
    var actualDL = [];         // DL% based on actual or forecast
    var budgetDL = [];         // DL% based on budget

    sortedKeys.forEach(function (key) {
      var parts = key.split('-');
      var monthNum = parseInt(parts[1], 10);

      var isClosed = key <= closingPeriodKey;

      var a = actual[key] || { labor: 0, revenue: 0 };
      var f = forecast[key] || { labor: 0, revenue: 0 };
      var b = budget[key] || { labor: 0, revenue: 0 };

      // For display: closed months use actual, open months use forecast (fallback to actual)
      var display;
      var srcLabel;
      if (isClosed) {
        display = a;
        srcLabel = 'ACT';
      } else {
        // Use forecast if available, otherwise fall back to actual
        display = (f.labor !== 0 || f.revenue !== 0) ? f : a;
        srcLabel = 'FCST';
      }

      var label = monthNames[monthNum - 1] + ' ' + parts[0];
      months.push(label);
      monthKeys.push(key);
      monthSources.push(srcLabel);

      actualFcstLabor.push(display.labor);
      budgetLaborArr.push(b.labor);

      // DL% = Labor / Revenue * 100
      var dispRev = display.revenue;
      var bRev = b.revenue;
      actualDL.push(dispRev !== 0 ? parseFloat(((display.labor / dispRev) * 100).toFixed(2)) : 0);
      budgetDL.push(bRev !== 0 ? parseFloat(((b.labor / bRev) * 100).toFixed(2)) : 0);
    });

    return {
      months: months,
      monthKeys: monthKeys,
      monthSources: monthSources,
      actualFcstLabor: actualFcstLabor,
      budgetLabor: budgetLaborArr,
      actualDL: actualDL,
      budgetDL: budgetDL
    };
  }

  // ─── Chart ──────────────────────────────────────────────────────────

  function buildChart(data) {
    var months = data.months;
    var actualLabor = data.actualFcstLabor;
    var budgetLabor = data.budgetLabor;
    var actualDL = data.actualDL;
    var budgetDL = data.budgetDL;
    var monthKeys = data.monthKeys;
    var monthSources = data.monthSources;

    var barColors = monthSources.map(function (s) {
      return s === 'ACT' ? 'rgba(74, 144, 217, 0.85)' : 'rgba(74, 144, 217, 0.45)';
    });
    var barBorders = monthSources.map(function (s) {
      return s === 'ACT' ? 'rgba(74, 144, 217, 1)' : 'rgba(74, 144, 217, 0.7)';
    });

    var xLabels = months.map(function (m, i) {
      return m + '\n(' + monthSources[i] + ')';
    });

    // MOM changes
    var momLaborChange = [];
    var momDLChange = [];
    for (var i = 0; i < actualLabor.length; i++) {
      if (i === 0) {
        momLaborChange.push(null);
        momDLChange.push(null);
      } else {
        momLaborChange.push(actualLabor[i] - actualLabor[i - 1]);
        momDLChange.push(parseFloat((actualDL[i] - actualDL[i - 1]).toFixed(2)));
      }
    }

    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }

    var ctx = document.getElementById('trendChart').getContext('2d');

    chartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: xLabels,
        datasets: [
          {
            label: 'Actual / Forecast',
            type: 'bar',
            data: actualLabor,
            backgroundColor: barColors,
            borderColor: barBorders,
            borderWidth: 1,
            borderRadius: 3,
            yAxisID: 'yDollars',
            order: 4
          },
          {
            label: 'Budget',
            type: 'bar',
            data: budgetLabor,
            backgroundColor: 'rgba(74, 144, 217, 0.2)',
            borderColor: 'rgba(74, 144, 217, 0.6)',
            borderWidth: 1,
            borderRadius: 3,
            borderDash: [4, 3],
            yAxisID: 'yDollars',
            order: 3
          },
          {
            label: 'DL %',
            type: 'line',
            data: actualDL,
            borderColor: '#e8833a',
            backgroundColor: 'rgba(232, 131, 58, 0.1)',
            borderWidth: 2.5,
            pointBackgroundColor: '#e8833a',
            pointBorderColor: '#fff',
            pointBorderWidth: 1.5,
            pointRadius: 4,
            pointHoverRadius: 6,
            tension: 0.3,
            fill: false,
            yAxisID: 'yPercent',
            order: 1
          },
          {
            label: 'DL % Budget',
            type: 'line',
            data: budgetDL,
            borderColor: '#e8833a',
            borderDash: [6, 4],
            borderWidth: 1.5,
            pointBackgroundColor: '#fff',
            pointBorderColor: '#e8833a',
            pointBorderWidth: 1.5,
            pointRadius: 3,
            pointHoverRadius: 5,
            tension: 0.3,
            fill: false,
            yAxisID: 'yPercent',
            order: 2
          }
        ]
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: 'rgba(0,0,0,0.8)',
            titleFont: { size: 13, weight: '600' },
            bodyFont: { size: 12 },
            padding: 10,
            cornerRadius: 6,
            callbacks: {
              label: function (context) {
                var label = context.dataset.label || '';
                var value = context.parsed.y;
                var idx = context.dataIndex;

                if (label === 'Actual / Forecast' || label === 'Budget') {
                  var formatted = '$' + value.toLocaleString('en-US', {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0
                  });
                  if (label === 'Actual / Forecast') {
                    var mom = momLaborChange[idx];
                    if (mom !== null) {
                      var sign = mom >= 0 ? '+' : '';
                      formatted += '  (' + sign + '$' + mom.toLocaleString('en-US', {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0
                      }) + ' MOM)';
                    }
                  }
                  if (label === 'Budget') {
                    var variance = actualLabor[idx] - budgetLabor[idx];
                    var sign2 = variance >= 0 ? '+' : '';
                    formatted += '  (var: ' + sign2 + '$' + variance.toLocaleString('en-US', {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 0
                    }) + ')';
                  }
                  return '  ' + label + ': ' + formatted;
                }

                if (label.indexOf('DL %') !== -1) {
                  var fmtPct = value.toFixed(1) + '%';
                  if (label === 'DL %') {
                    var momDL = momDLChange[idx];
                    if (momDL !== null) {
                      var sign3 = momDL >= 0 ? '+' : '';
                      fmtPct += '  (' + sign3 + momDL.toFixed(1) + 'pp MOM)';
                    }
                  }
                  if (label === 'DL % Budget') {
                    var dlVar = actualDL[idx] - budgetDL[idx];
                    var sign4 = dlVar >= 0 ? '+' : '';
                    fmtPct += '  (var: ' + sign4 + dlVar.toFixed(1) + 'pp)';
                  }
                  return '  ' + label + ': ' + fmtPct;
                }

                return '  ' + label + ': ' + value;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              font: { size: 11 },
              color: '#888'
            }
          },
          yDollars: {
            type: 'linear',
            position: 'left',
            beginAtZero: true,
            title: {
              display: true,
              text: 'Labor $',
              font: { size: 12, weight: '600' },
              color: '#4a90d9'
            },
            grid: { color: 'rgba(0,0,0,0.06)' },
            ticks: {
              font: { size: 11 },
              color: '#888',
              callback: function (value) {
                return fmtCurrencyShort(value);
              }
            }
          },
          yPercent: {
            type: 'linear',
            position: 'right',
            beginAtZero: true,
            title: {
              display: true,
              text: 'DL %',
              font: { size: 12, weight: '600' },
              color: '#e8833a'
            },
            grid: { drawOnChartArea: false },
            ticks: {
              font: { size: 11 },
              color: '#888',
              callback: function (value) {
                return value.toFixed(0) + '%';
              }
            }
          }
        },
        onClick: function (event, elements) {
          if (elements.length === 0) return;
          var idx = elements[0].index;
          var mk = monthKeys[idx];
          showDrilldown(mk);
        }
      }
    });
  }

  // ─── Table View ─────────────────────────────────────────────────────

  function buildTable(data) {
    var thead = document.getElementById('summary-thead');
    var tbody = document.getElementById('summary-tbody');
    thead.innerHTML = '';
    tbody.innerHTML = '';

    var headers = ['Month', 'Actual/Fcst Labor $', 'Budget Labor $', 'Variance $', 'DL %', 'DL % Budget', 'DL % Var'];
    var numCols = [false, true, true, true, true, true, true];

    headers.forEach(function (h, i) {
      var th = document.createElement('th');
      th.textContent = h;
      if (numCols[i]) th.className = 'num';
      thead.appendChild(th);
    });

    var totActual = 0;
    var totBudget = 0;

    data.months.forEach(function (month, i) {
      var aLabor = data.actualFcstLabor[i];
      var bLabor = data.budgetLabor[i];
      var variance = aLabor - bLabor;
      var aDL = data.actualDL[i];
      var bDL = data.budgetDL[i];
      var dlVar = aDL - bDL;

      totActual += aLabor;
      totBudget += bLabor;

      var tr = document.createElement('tr');
      tr.style.cursor = 'pointer';
      tr.setAttribute('data-month-key', data.monthKeys[i]);
      tr.addEventListener('click', function () {
        showDrilldown(this.getAttribute('data-month-key'));
      });

      var tdMonth = document.createElement('td');
      tdMonth.className = 'month-label';
      tdMonth.textContent = month + ' (' + data.monthSources[i] + ')';
      tr.appendChild(tdMonth);

      tr.appendChild(makeCurrencyCell(aLabor));
      tr.appendChild(makeCurrencyCell(bLabor));

      var tdVar = makeCurrencyCell(variance);
      if (variance > 0) tdVar.classList.add('negative');
      else if (variance < 0) tdVar.classList.add('positive');
      tr.appendChild(tdVar);

      tr.appendChild(makePercentCell(aDL));
      tr.appendChild(makePercentCell(bDL));

      var tdDLVar = makePercentCell(dlVar, true);
      if (dlVar > 0.01) tdDLVar.classList.add('negative');
      else if (dlVar < -0.01) tdDLVar.classList.add('positive');
      tr.appendChild(tdDLVar);

      tbody.appendChild(tr);
    });

    // Totals row
    var totalVariance = totActual - totBudget;
    var trTotal = document.createElement('tr');
    trTotal.className = 'totals-row';

    var tdTotLabel = document.createElement('td');
    tdTotLabel.className = 'month-label';
    tdTotLabel.textContent = 'Total';
    trTotal.appendChild(tdTotLabel);

    trTotal.appendChild(makeCurrencyCell(totActual));
    trTotal.appendChild(makeCurrencyCell(totBudget));

    var tdTotVar = makeCurrencyCell(totalVariance);
    if (totalVariance > 0) tdTotVar.classList.add('negative');
    else if (totalVariance < 0) tdTotVar.classList.add('positive');
    trTotal.appendChild(tdTotVar);

    for (var x = 0; x < 3; x++) {
      var tdBlank = document.createElement('td');
      tdBlank.className = 'num';
      tdBlank.textContent = '\u2014';
      trTotal.appendChild(tdBlank);
    }

    tbody.appendChild(trTotal);
  }

  function makeCurrencyCell(value) {
    var td = document.createElement('td');
    td.className = 'num';
    var prefix = value < 0 ? '-$' : '$';
    td.textContent = prefix + Math.abs(value).toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    });
    return td;
  }

  function makePercentCell(value, showSign) {
    var td = document.createElement('td');
    td.className = 'num';
    var prefix = showSign && value > 0 ? '+' : '';
    td.textContent = prefix + value.toFixed(1) + '%';
    return td;
  }

  // ─── Drill-down ─────────────────────────────────────────────────────

  function showDrilldown(monthKey) {
    var overlay = document.getElementById('drilldown-overlay');
    var title = document.getElementById('drilldown-title');
    var thead = document.getElementById('drilldown-thead');
    var tbody = document.getElementById('drilldown-tbody');

    var parts = monthKey.split('-');
    var monthNum = parseInt(parts[1], 10);
    var label = monthNames[monthNum - 1] + ' ' + parts[0];
    var isClosed = monthKey <= closingPeriodKey;
    title.textContent = label + ' \u2014 Labor & Revenue Detail (' + (isClosed ? 'Actual' : 'Forecast') + ')';

    var filteredRows = getFilteredRows();
    var agg = {}; // account → { actual: {labor,revenue}, forecast: {labor,revenue}, budget: {labor,revenue} }

    for (var r = 0; r < filteredRows.length; r++) {
      var row = filteredRows[r];
      var source = row[col.source];
      if (source !== sourceActual && source !== sourceBudget && source !== sourceForecast) continue;

      var category = row[col.category];
      if (laborCategories.indexOf(category) === -1 && category !== revenueCategory) continue;

      var d = parseDate(row[col.date]);
      var key = mkKey(d);
      if (key !== monthKey) continue;

      var amount = normalizeAmount(row[col.amount], source, category);
      var account = (col.account >= 0 ? row[col.account] : 'Unknown') || 'Unknown';

      if (!agg[account]) {
        agg[account] = {
          actual: { labor: 0, revenue: 0 },
          forecast: { labor: 0, revenue: 0 },
          budget: { labor: 0, revenue: 0 }
        };
      }

      var target;
      if (source === sourceActual) target = agg[account].actual;
      else if (source === sourceForecast) target = agg[account].forecast;
      else target = agg[account].budget;

      if (laborCategories.indexOf(category) !== -1) {
        target.labor += amount;
      } else {
        target.revenue += amount;
      }
    }

    thead.innerHTML = '';
    tbody.innerHTML = '';

    ['Parent Account', 'Labor $', 'Budget Labor $', 'Variance $', 'DL %', 'DL % Budget'].forEach(function (h) {
      var th = document.createElement('th');
      th.textContent = h;
      if (h !== 'Parent Account') th.style.textAlign = 'right';
      thead.appendChild(th);
    });

    var accounts = Object.keys(agg).sort(function (a, b) {
      var dataA = agg[a];
      var dataB = agg[b];
      var valA = isClosed ? dataA.actual.labor : (dataA.forecast.labor || dataA.actual.labor);
      var valB = isClosed ? dataB.actual.labor : (dataB.forecast.labor || dataB.actual.labor);
      return valB - valA;
    });

    accounts.forEach(function (account) {
      var data = agg[account];
      var display = isClosed ? data.actual :
        (data.forecast.labor !== 0 || data.forecast.revenue !== 0) ? data.forecast : data.actual;
      var b = data.budget;

      var laborVal = display.labor;
      var budgetVal = b.labor;
      var variance = laborVal - budgetVal;
      var dlPct = display.revenue !== 0 ? (display.labor / display.revenue) * 100 : 0;
      var dlBudgetPct = b.revenue !== 0 ? (b.labor / b.revenue) * 100 : 0;

      var tr = document.createElement('tr');

      var tdAcct = document.createElement('td');
      tdAcct.textContent = account;
      tr.appendChild(tdAcct);

      var tdLabor = document.createElement('td');
      tdLabor.className = 'num';
      tdLabor.textContent = fmtCurrency(laborVal);
      tr.appendChild(tdLabor);

      var tdBudget = document.createElement('td');
      tdBudget.className = 'num';
      tdBudget.textContent = fmtCurrency(budgetVal);
      tr.appendChild(tdBudget);

      var tdVar = document.createElement('td');
      tdVar.className = 'num';
      tdVar.textContent = fmtCurrency(variance);
      if (variance > 0) tdVar.classList.add('negative');
      else if (variance < 0) tdVar.classList.add('positive');
      tr.appendChild(tdVar);

      var tdDL = document.createElement('td');
      tdDL.className = 'num';
      tdDL.textContent = dlPct.toFixed(1) + '%';
      tr.appendChild(tdDL);

      var tdDLB = document.createElement('td');
      tdDLB.className = 'num';
      tdDLB.textContent = dlBudgetPct.toFixed(1) + '%';
      tr.appendChild(tdDLB);

      tbody.appendChild(tr);
    });

    overlay.classList.remove('hidden');
  }

  // Close drill-down
  document.getElementById('drilldown-close').addEventListener('click', function () {
    document.getElementById('drilldown-overlay').classList.add('hidden');
  });

  document.getElementById('drilldown-overlay').addEventListener('click', function (e) {
    if (e.target === this) {
      this.classList.add('hidden');
    }
  });
})();
