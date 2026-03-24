// Revenue Trend MoM Card
// Dataset: JOB_FINANCIALS_wo_JOIN_v2 (977fd639-75bb-422c-8773-a26488330bca)
// Combo chart + table toggle: Revenue by month, Actual vs Budget vs Forecast
// Drill: chart click → Parent Account breakdown; table → Region → Account → Job hierarchy

(function () {
  'use strict';

  var sourceActual = 'ACTUAL';
  var sourceBudget = 'OPS_FIN_BUDGET';
  var sourceForecast = 'JOB_FORECAST';

  var currentYear = new Date().getFullYear();

  var monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];

  var yearSuffix = ' ' + String(currentYear).slice(-2);

  // SQL query — pre-aggregate at dataset level
  var SQL_QUERY = "SELECT `GLPostingDate`, `SOURCE`, " +
    "`Region`, `Parent Account`, `JobNumber`, `JobDescription`, " +
    "`Operations Lead`, `Client`, `most_recent_closing_period`, " +
    "SUM(`Amount`) as `Amount` " +
    "FROM dataset " +
    "WHERE `KeepActiveData` = 1 " +
    "AND `P&L Category Name` = 'Service Revenue' " +
    "AND YEAR(`GLPostingDate`) = " + currentYear + " " +
    "GROUP BY `GLPostingDate`, `SOURCE`, `Region`, `Parent Account`, " +
    "`JobNumber`, `JobDescription`, `Operations Lead`, `Client`, " +
    "`most_recent_closing_period`";

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

  function monthKey(d) {
    var year = d.getUTCFullYear();
    var mm = ('0' + (d.getUTCMonth() + 1)).slice(-2);
    return year + '-' + mm;
  }

  function monthLabel(key) {
    var parts = key.split('-');
    var monthNum = parseInt(parts[1], 10);
    return monthNames[monthNum - 1] + ' ' + parts[0].slice(-2);
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

  // Normalize revenue: actuals are stored negative, budget/forecast may vary
  // Always return positive revenue
  function normalizeRevenue(amount, source) {
    var val = parseFloat(amount) || 0;
    if (source === sourceActual) return Math.abs(val);
    // Budget & forecast: if negative, flip to positive
    return val < 0 ? Math.abs(val) : val;
  }

  // ─── State ──────────────────────────────────────────────────────────

  var rawRows = null;
  var col = null;
  var closingPeriodKey = null; // monthKey of most_recent_closing_period
  var chartInstance = null;
  var currentView = 'chart';

  var loader = document.getElementById('loader');
  var loaderText = document.getElementById('loader-text');

  loaderText.textContent = 'Fetching revenue data...';

  // ─── Data fetch ─────────────────────────────────────────────────────

  domo.post('/sql/v1/dataset', SQL_QUERY, { contentType: 'text/plain' })
    .then(function (resp) {
      loaderText.textContent = 'Building view...';
      var cols = resp.columns;
      rawRows = resp.rows;
      col = {
        date: findCol(cols, ['GLPostingDate', 'glpostingdate']),
        amount: findCol(cols, ['Amount', 'amount', 'AMOUNT']),
        source: findCol(cols, ['SOURCE', 'Source', 'source']),
        region: findCol(cols, ['Region', 'region', 'REGION']),
        account: findCol(cols, ['Parent Account', 'ParentAccount', 'PARENT_ACCOUNT']),
        job: findCol(cols, ['JobNumber', 'jobnumber', 'JOB_NUMBER']),
        jobDesc: findCol(cols, ['JobDescription', 'jobdescription']),
        opsLead: findCol(cols, ['Operations Lead', 'OperationsLead', 'OpsLead']),
        client: findCol(cols, ['Client', 'client']),
        closingPeriod: findCol(cols, ['most_recent_closing_period', 'mostRecentClosingPeriod'])
      };

      // Determine closing period from the first row that has it
      for (var r = 0; r < rawRows.length; r++) {
        if (col.closingPeriod >= 0 && rawRows[r][col.closingPeriod]) {
          var cpDate = parseDate(rawRows[r][col.closingPeriod]);
          closingPeriodKey = monthKey(cpDate);
          break;
        }
      }
      // Fallback: if no closing period found, use prior month
      if (!closingPeriodKey) {
        var now = new Date();
        var prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        closingPeriodKey = monthKey(prevMonth);
      }

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
  var filterAccount = document.getElementById('filter-account');
  var filterJob = document.getElementById('filter-job');
  var accountList = document.getElementById('account-list');
  var jobList = document.getElementById('job-list');

  function populateFilters() {
    var regions = {};
    var accounts = {};
    var jobs = {};

    for (var r = 0; r < rawRows.length; r++) {
      var row = rawRows[r];
      var rgn = col.region >= 0 ? row[col.region] : null;
      var a = col.account >= 0 ? row[col.account] : null;
      var j = col.job >= 0 ? row[col.job] : null;
      if (rgn) regions[rgn] = true;
      if (a) accounts[a] = true;
      if (j) jobs[j] = true;
    }

    fillSelect(filterRegion, Object.keys(regions).sort());
    fillDatalist(accountList, Object.keys(accounts).sort());
    fillDatalist(jobList, Object.keys(jobs).sort());
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

  filterRegion.addEventListener('change', refreshView);

  var searchTimer = null;
  [filterAccount, filterJob].forEach(function (el) {
    el.addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(refreshView, 300);
    });
    el.addEventListener('change', refreshView);
  });

  document.getElementById('filter-clear').addEventListener('click', function () {
    filterRegion.value = '';
    filterAccount.value = '';
    filterJob.value = '';
    refreshView();
  });

  function getFilteredRows() {
    var rVal = filterRegion.value;
    var aVal = filterAccount.value.trim();
    var jVal = filterJob.value.trim();

    if (!rVal && !aVal && !jVal) return rawRows;

    var aLower = aVal.toLowerCase();
    var jLower = jVal.toLowerCase();

    return rawRows.filter(function (row) {
      if (rVal && col.region >= 0 && row[col.region] !== rVal) return false;
      if (aVal && col.account >= 0) {
        var rowAcct = (row[col.account] || '').toString().toLowerCase();
        if (rowAcct.indexOf(aLower) === -1) return false;
      }
      if (jVal && col.job >= 0) {
        var rowJob = (row[col.job] || '').toString().toLowerCase();
        if (rowJob.indexOf(jLower) === -1) return false;
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

    if (currentView === 'chart') {
      var agg = aggregateForChart(filteredRows);
      buildChart(agg);
    } else {
      buildTable(filteredRows);
    }
  }

  // ─── Chart aggregation ──────────────────────────────────────────────

  function aggregateForChart(rows) {
    var actual = {};   // monthKey → sum
    var budget = {};
    var forecast = {};

    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var source = row[col.source];
      var d = parseDate(row[col.date]);
      var mk = monthKey(d);
      var amount = normalizeRevenue(row[col.amount], source);

      if (source === sourceActual) {
        actual[mk] = (actual[mk] || 0) + amount;
      } else if (source === sourceBudget) {
        budget[mk] = (budget[mk] || 0) + amount;
      } else if (source === sourceForecast) {
        forecast[mk] = (forecast[mk] || 0) + amount;
      }
    }

    // Build month keys for full year
    var sortedKeys = [];
    for (var m = 1; m <= 12; m++) {
      var k = currentYear + '-' + ('0' + m).slice(-2);
      sortedKeys.push(k);
    }

    var labels = [];
    var actualData = [];
    var forecastData = [];
    var budgetData = [];
    var momVarPct = [];
    var mkArray = [];

    for (var i = 0; i < sortedKeys.length; i++) {
      var key = sortedKeys[i];
      labels.push(monthLabel(key));
      mkArray.push(key);

      var isClosedMonth = key <= closingPeriodKey;

      // Actual bar: only for closed months
      actualData.push(isClosedMonth ? (actual[key] || 0) : null);
      // Forecast bar: only for open months
      forecastData.push(!isClosedMonth ? (forecast[key] || actual[key] || 0) : null);
      // Budget line: full year
      budgetData.push(budget[key] || 0);

      // MoM variance % based on actual (closed) or forecast (open)
      var curVal = isClosedMonth ? (actual[key] || 0) : (forecast[key] || 0);
      if (i === 0) {
        momVarPct.push(null);
      } else {
        var prevKey = sortedKeys[i - 1];
        var prevClosed = prevKey <= closingPeriodKey;
        var prevVal = prevClosed ? (actual[prevKey] || 0) : (forecast[prevKey] || 0);
        if (prevVal !== 0) {
          momVarPct.push(parseFloat((((curVal - prevVal) / Math.abs(prevVal)) * 100).toFixed(1)));
        } else {
          momVarPct.push(null);
        }
      }
    }

    return {
      labels: labels,
      monthKeys: mkArray,
      actual: actualData,
      forecast: forecastData,
      budget: budgetData,
      momVarPct: momVarPct
    };
  }

  // ─── MoM label plugin ───────────────────────────────────────────────
  // Draws MoM variance % as small badges above each bar group

  var momLabelPlugin = {
    id: 'momLabels',
    afterDatasetsDraw: function (chart) {
      var meta0 = chart.getDatasetMeta(0); // actual
      var meta1 = chart.getDatasetMeta(1); // forecast
      var momData = chart.data.datasets[3] ? chart.data.datasets[3].data : [];
      if (!momData || momData.length === 0) return;

      var ctx = chart.ctx;
      ctx.save();
      ctx.font = '600 10px "Open Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';

      for (var i = 0; i < momData.length; i++) {
        if (momData[i] === null || momData[i] === undefined) continue;

        // Find the visible bar for this index (actual or forecast)
        var bar = (meta0.data[i] && meta0.data[i].y !== undefined && chart.data.datasets[0].data[i] !== null)
          ? meta0.data[i]
          : meta1.data[i];
        if (!bar) continue;

        var val = momData[i];
        var sign = val >= 0 ? '+' : '';
        var label = sign + val.toFixed(1) + '%';
        var x = bar.x;
        var y = bar.y - 8;

        // Pill background
        var textWidth = ctx.measureText(label).width;
        var pw = textWidth + 10;
        var ph = 16;
        var px = x - pw / 2;
        var py = y - ph + 2;

        ctx.fillStyle = val > 0 ? 'rgba(39, 174, 96, 0.12)' : val < 0 ? 'rgba(231, 76, 60, 0.12)' : 'rgba(0,0,0,0.06)';
        ctx.beginPath();
        ctx.roundRect(px, py, pw, ph, 4);
        ctx.fill();

        ctx.fillStyle = val > 0 ? '#27ae60' : val < 0 ? '#e74c3c' : '#888';
        ctx.fillText(label, x, y);
      }
      ctx.restore();
    }
  };

  // ─── Chart build ────────────────────────────────────────────────────

  function buildChart(data) {
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }

    var ctx = document.getElementById('revenueChart').getContext('2d');

    chartInstance = new Chart(ctx, {
      type: 'bar',
      plugins: [momLabelPlugin],
      data: {
        labels: data.labels,
        datasets: [
          {
            label: 'Actual Revenue',
            data: data.actual,
            backgroundColor: 'rgba(39, 174, 96, 0.85)',
            borderColor: 'rgba(39, 174, 96, 1)',
            borderWidth: 1,
            borderRadius: 3,
            yAxisID: 'y',
            order: 3
          },
          {
            label: 'Forecast Revenue',
            data: data.forecast,
            backgroundColor: 'rgba(74, 144, 217, 0.55)',
            borderColor: 'rgba(74, 144, 217, 0.85)',
            borderWidth: 1,
            borderRadius: 3,
            yAxisID: 'y',
            order: 2
          },
          {
            label: 'Budget Revenue',
            data: data.budget,
            backgroundColor: 'rgba(232, 131, 58, 0.15)',
            borderColor: '#e8833a',
            borderWidth: 2,
            borderDash: [4, 3],
            borderRadius: 3,
            yAxisID: 'y',
            order: 1
          },
          {
            label: 'MoM Variance %',
            data: data.momVarPct,
            hidden: true,
            yAxisID: 'y'
          }
        ]
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        layout: {
          padding: { top: 28 }
        },
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(0,0,0,0.8)',
            titleFont: { size: 13, weight: '600' },
            bodyFont: { size: 12 },
            padding: 10,
            cornerRadius: 6,
            filter: function (item) {
              return item.dataset.label !== 'MoM Variance %';
            },
            callbacks: {
              label: function (context) {
                var label = context.dataset.label || '';
                var value = context.parsed.y;
                if (value === null || value === undefined) return null;
                return '  ' + label + ': ' + fmtCurrency(value);
              },
              afterBody: function (tooltipItems) {
                if (!tooltipItems.length) return '';
                var idx = tooltipItems[0].dataIndex;
                var mom = data.momVarPct[idx];
                if (mom === null || mom === undefined) return '';
                var sign = mom >= 0 ? '+' : '';
                return '\n  MoM: ' + sign + mom.toFixed(1) + '%';
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 11 }, color: '#888' }
          },
          y: {
            type: 'linear',
            position: 'left',
            beginAtZero: true,
            title: {
              display: true,
              text: 'Revenue',
              font: { size: 12, weight: '600' },
              color: '#555'
            },
            grid: { color: 'rgba(0,0,0,0.06)' },
            ticks: {
              font: { size: 11 },
              color: '#888',
              callback: function (value) {
                return fmtCurrencyShort(value);
              }
            }
          }
        },
        onClick: function (event, elements) {
          if (elements.length === 0) return;
          var idx = elements[0].index;
          var mk = data.monthKeys[idx];
          showDrilldown(mk);
        }
      }
    });
  }

  // ─── Table view ─────────────────────────────────────────────────────
  // Hierarchical: Region → Parent Account → Job
  // Columns: Label, Jan 26, Feb 26, ... Dec 26, FY Total

  var TABLE_PAGE_SIZE = 200;

  function buildTable(rows) {
    var thead = document.getElementById('summary-thead');
    var tbody = document.getElementById('summary-tbody');
    thead.innerHTML = '';
    tbody.innerHTML = '';

    // Build month columns
    var monthKeysArr = [];
    for (var m = 1; m <= 12; m++) {
      monthKeysArr.push(currentYear + '-' + ('0' + m).slice(-2));
    }

    // Header row
    var trHead = document.createElement('tr');
    var thLabel = document.createElement('th');
    thLabel.textContent = '';
    thLabel.style.minWidth = '200px';
    trHead.appendChild(thLabel);

    monthKeysArr.forEach(function (mk) {
      var th = document.createElement('th');
      th.className = 'num';
      th.textContent = monthLabel(mk);
      trHead.appendChild(th);
    });

    var thFY = document.createElement('th');
    thFY.className = 'num';
    thFY.textContent = 'FY Total';
    trHead.appendChild(thFY);
    thead.appendChild(trHead);

    // Aggregate: Region → Account → Job → monthKey → { actual, budget, forecast }
    var tree = {};

    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var region = (col.region >= 0 ? row[col.region] : 'Unknown') || 'Unknown';
      var account = (col.account >= 0 ? row[col.account] : 'Unknown') || 'Unknown';
      var job = (col.job >= 0 ? row[col.job] : '') || '';
      var jobDesc = (col.jobDesc >= 0 ? row[col.jobDesc] : '') || '';
      var source = row[col.source];
      var d = parseDate(row[col.date]);
      var mk = monthKey(d);
      var amount = normalizeRevenue(row[col.amount], source);

      if (!tree[region]) tree[region] = {};
      if (!tree[region][account]) tree[region][account] = {};
      var jobKey = job + (jobDesc ? ' — ' + jobDesc : '');
      if (!tree[region][account][jobKey]) tree[region][account][jobKey] = {};
      if (!tree[region][account][jobKey][mk]) {
        tree[region][account][jobKey][mk] = { actual: 0, budget: 0, forecast: 0 };
      }

      var cell = tree[region][account][jobKey][mk];
      if (source === sourceActual) cell.actual += amount;
      else if (source === sourceBudget) cell.budget += amount;
      else if (source === sourceForecast) cell.forecast += amount;
    }

    // Render rows
    var rowCount = 0;
    var regions = Object.keys(tree).sort();

    regions.forEach(function (region) {
      // Region row
      var trRegion = document.createElement('tr');
      trRegion.className = 'region-row';
      var tdRegionLabel = document.createElement('td');
      tdRegionLabel.className = 'row-toggle expanded';
      tdRegionLabel.textContent = region;
      trRegion.appendChild(tdRegionLabel);

      var regionTotals = buildEmptyMonthTotals(monthKeysArr);
      var accounts = tree[region];

      // Pre-calculate region totals
      Object.keys(accounts).forEach(function (account) {
        var jobs = accounts[account];
        Object.keys(jobs).forEach(function (jobKey) {
          var months = jobs[jobKey];
          monthKeysArr.forEach(function (mk, mi) {
            var cell = months[mk];
            if (cell) {
              var isClosed = mk <= closingPeriodKey;
              var val = isClosed ? cell.actual : (cell.forecast || cell.actual);
              regionTotals[mi] += val;
            }
          });
        });
      });

      appendMonthCells(trRegion, regionTotals, monthKeysArr);
      tbody.appendChild(trRegion);
      rowCount++;

      var accountKeys = Object.keys(accounts).sort();
      var accountRows = [];

      accountKeys.forEach(function (account) {
        var trAccount = document.createElement('tr');
        trAccount.className = 'account-row';
        trAccount.setAttribute('data-region', region);
        var tdAcctLabel = document.createElement('td');
        tdAcctLabel.className = 'indent-1 row-toggle expanded';
        tdAcctLabel.textContent = account;
        trAccount.appendChild(tdAcctLabel);

        var acctTotals = buildEmptyMonthTotals(monthKeysArr);
        var jobs = accounts[account];

        Object.keys(jobs).forEach(function (jobKey) {
          var months = jobs[jobKey];
          monthKeysArr.forEach(function (mk, mi) {
            var cell = months[mk];
            if (cell) {
              var isClosed = mk <= closingPeriodKey;
              var val = isClosed ? cell.actual : (cell.forecast || cell.actual);
              acctTotals[mi] += val;
            }
          });
        });

        appendMonthCells(trAccount, acctTotals, monthKeysArr);
        tbody.appendChild(trAccount);
        accountRows.push(trAccount);
        rowCount++;

        var jobKeys = Object.keys(jobs).sort();
        var jobRows = [];

        jobKeys.forEach(function (jobKey) {
          if (rowCount >= TABLE_PAGE_SIZE) return;

          var trJob = document.createElement('tr');
          trJob.className = 'job-row';
          trJob.setAttribute('data-region', region);
          trJob.setAttribute('data-account', account);
          var tdJobLabel = document.createElement('td');
          tdJobLabel.className = 'indent-2';
          tdJobLabel.textContent = jobKey || '(no job)';
          trJob.appendChild(tdJobLabel);

          var jobTotals = buildEmptyMonthTotals(monthKeysArr);
          var months = jobs[jobKey];

          monthKeysArr.forEach(function (mk, mi) {
            var cell = months[mk];
            if (cell) {
              var isClosed = mk <= closingPeriodKey;
              var val = isClosed ? cell.actual : (cell.forecast || cell.actual);
              jobTotals[mi] += val;
            }
          });

          appendMonthCells(trJob, jobTotals, monthKeysArr);
          tbody.appendChild(trJob);
          jobRows.push(trJob);
          rowCount++;
        });

        // Toggle account → show/hide jobs
        tdAcctLabel.addEventListener('click', (function (jRows, label) {
          return function () {
            var isExpanded = label.classList.contains('expanded');
            label.classList.toggle('expanded');
            jRows.forEach(function (jr) {
              jr.style.display = isExpanded ? 'none' : '';
            });
          };
        })(jobRows, tdAcctLabel));
      });

      // Toggle region → show/hide accounts + jobs
      tdRegionLabel.addEventListener('click', (function (aRows, regionKey) {
        return function () {
          var isExpanded = tdRegionLabel.classList.contains('expanded');
          tdRegionLabel.classList.toggle('expanded');
          var rows = tbody.querySelectorAll('tr[data-region="' + regionKey + '"]');
          for (var i = 0; i < rows.length; i++) {
            rows[i].style.display = isExpanded ? 'none' : '';
          }
        };
      })(accountRows, region));
    });

    if (rowCount >= TABLE_PAGE_SIZE) {
      var trMore = document.createElement('tr');
      var tdMore = document.createElement('td');
      tdMore.colSpan = monthKeysArr.length + 2;
      tdMore.style.textAlign = 'center';
      tdMore.style.padding = '12px';
      tdMore.style.color = '#999';
      tdMore.style.fontStyle = 'italic';
      tdMore.textContent = 'Showing first ' + TABLE_PAGE_SIZE + ' rows. Use filters to narrow results.';
      trMore.appendChild(tdMore);
      tbody.appendChild(trMore);
    }
  }

  function buildEmptyMonthTotals(monthKeysArr) {
    var totals = [];
    for (var i = 0; i < monthKeysArr.length; i++) totals.push(0);
    return totals;
  }

  function appendMonthCells(tr, totals, monthKeysArr) {
    var fyTotal = 0;
    totals.forEach(function (val, i) {
      var td = document.createElement('td');
      td.className = 'num';
      if (val === 0) {
        td.textContent = '\u2014';
        td.style.color = '#ccc';
      } else {
        td.textContent = fmtCurrencyShort(val);
      }
      tr.appendChild(td);
      fyTotal += val;
    });

    var tdFY = document.createElement('td');
    tdFY.className = 'num';
    tdFY.style.fontWeight = '600';
    tdFY.textContent = fyTotal === 0 ? '\u2014' : fmtCurrencyShort(fyTotal);
    tr.appendChild(tdFY);
  }

  // ─── Drill-down ─────────────────────────────────────────────────────
  // Chart click → show Parent Account breakdown for that month

  function showDrilldown(mk) {
    var overlay = document.getElementById('drilldown-overlay');
    var title = document.getElementById('drilldown-title');
    var thead = document.getElementById('drilldown-thead');
    var tbody = document.getElementById('drilldown-tbody');

    title.textContent = monthLabel(mk) + ' \u2014 Revenue by Parent Account';

    var filteredRows = getFilteredRows();
    var agg = {}; // account → { actual, budget, forecast }

    for (var r = 0; r < filteredRows.length; r++) {
      var row = filteredRows[r];
      var source = row[col.source];
      var d = parseDate(row[col.date]);
      if (monthKey(d) !== mk) continue;

      var account = (col.account >= 0 ? row[col.account] : 'Unknown') || 'Unknown';
      var amount = normalizeRevenue(row[col.amount], source);

      if (!agg[account]) agg[account] = { actual: 0, budget: 0, forecast: 0 };
      if (source === sourceActual) agg[account].actual += amount;
      else if (source === sourceBudget) agg[account].budget += amount;
      else if (source === sourceForecast) agg[account].forecast += amount;
    }

    thead.innerHTML = '';
    tbody.innerHTML = '';

    var isClosed = mk <= closingPeriodKey;
    var headers = ['Parent Account', isClosed ? 'Actual' : 'Forecast', 'Budget', 'Variance $', 'Variance %'];
    headers.forEach(function (h) {
      var th = document.createElement('th');
      th.textContent = h;
      if (h !== 'Parent Account') th.style.textAlign = 'right';
      thead.appendChild(th);
    });

    var accounts = Object.keys(agg).sort(function (a, b) {
      var valA = isClosed ? agg[a].actual : agg[a].forecast;
      var valB = isClosed ? agg[b].actual : agg[b].forecast;
      return valB - valA;
    });

    accounts.forEach(function (account) {
      var data = agg[account];
      var primary = isClosed ? data.actual : (data.forecast || data.actual);
      var budgetVal = data.budget;
      var variance = primary - budgetVal;
      var variancePct = budgetVal !== 0 ? ((variance / Math.abs(budgetVal)) * 100) : 0;

      var tr = document.createElement('tr');

      var tdAcct = document.createElement('td');
      tdAcct.textContent = account;
      tr.appendChild(tdAcct);

      var tdPrimary = document.createElement('td');
      tdPrimary.className = 'num';
      tdPrimary.textContent = fmtCurrency(primary);
      tr.appendChild(tdPrimary);

      var tdBudget = document.createElement('td');
      tdBudget.className = 'num';
      tdBudget.textContent = fmtCurrency(budgetVal);
      tr.appendChild(tdBudget);

      var tdVar = document.createElement('td');
      tdVar.className = 'num';
      tdVar.textContent = fmtCurrency(variance);
      if (variance > 0) tdVar.classList.add('positive');
      else if (variance < 0) tdVar.classList.add('negative');
      tr.appendChild(tdVar);

      var tdVarPct = document.createElement('td');
      tdVarPct.className = 'num';
      var sign = variancePct >= 0 ? '+' : '';
      tdVarPct.textContent = sign + variancePct.toFixed(1) + '%';
      if (variancePct > 0) tdVarPct.classList.add('positive');
      else if (variancePct < 0) tdVarPct.classList.add('negative');
      tr.appendChild(tdVarPct);

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
