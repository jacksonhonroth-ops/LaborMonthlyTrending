// Labor MOM Trending Card
// Data source: Job_Financials_wo_JoinV2 (977fd639-75bb-422c-8773-a26488330bca)
// Uses SQL aggregation to reduce data transfer — only fetches Total Labor + Service Revenue
// Compares ACTUAL vs OPS_FIN_BUDGET, drill-down on click, filter by Region/Job/Account/OpsLead

(function () {
  'use strict';

  // P&L Category Name values
  var laborCategories = ["Total Labor"];
  var revenueCategory = "Service Revenue";

  // Source values
  var sourceActual = "ACTUAL";
  var sourceForecast = "JOB_FORECAST";
  var sourceBudget = "OPS_FIN_BUDGET";

  // Current year filter
  var currentYear = 2026;

  // SQL query — pre-aggregate server-side, only fetch needed categories/sources
  var SQL_QUERY = "SELECT `MONTH`, `SOURCE`, `P&L Category Name` as `Category`, " +
    "`Region`, `JobNumber`, `Parent Account`, `Operations Lead`, " +
    "SUM(`Amount`) as `Amount` " +
    "FROM dataset " +
    "WHERE `SOURCE` IN ('ACTUAL', 'JOB_FORECAST', 'OPS_FIN_BUDGET') " +
    "GROUP BY `MONTH`, `SOURCE`, `P&L Category Name`, `Region`, " +
    "`JobNumber`, `Parent Account`, `Operations Lead`";

  var monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ];

  // Find a column index by trying multiple possible names
  function findCol(columns, names) {
    for (var i = 0; i < names.length; i++) {
      var idx = columns.indexOf(names[i]);
      if (idx !== -1) return idx;
    }
    return -1;
  }

  // Parse a DOMO date value to a Date object (handles epoch ms and ISO strings)
  function parseDate(raw) {
    if (typeof raw === "number") return new Date(raw);
    var s = String(raw);
    if (/^\d{10,}$/.test(s)) return new Date(parseInt(s, 10));
    return new Date(s);
  }

  var loader = document.getElementById("loader");
  var loaderText = document.getElementById("loader-text");

  loaderText.textContent = "Fetching from Job Financials...";

  // Store raw data for drill-down and filtering
  var rawRows = null;
  var colIndices = null;
  var chartInstance = null;
  var currentView = "chart"; // "chart" or "table"

  domo.post('/sql/v1/dataset', SQL_QUERY, { contentType: 'text/plain' })
    .then(function (resp) {
      loaderText.textContent = "Building chart...";
      var cols = resp.columns;
      rawRows = resp.rows;
      colIndices = {
        month: findCol(cols, ["MONTH", "Month", "month"]),
        amount: findCol(cols, ["Amount", "amount", "AMOUNT"]),
        category: findCol(cols, ["Category", "P&L Category Name", "PLCategoryName"]),
        source: findCol(cols, ["SOURCE", "Source", "source"]),
        region: findCol(cols, ["Region", "region", "REGION"]),
        job: findCol(cols, ["JobNumber", "Job Number", "JOB_NUMBER"]),
        account: findCol(cols, ["Parent Account", "ParentAccount", "PARENT_ACCOUNT"]),
        opsLead: findCol(cols, ["Operations Lead", "OperationsLead", "OpsLead", "OPS_LEAD"])
      };
      populateFilters();
      refreshView();
      loader.classList.add("hidden");
    })
    .catch(function (err) {
      var msg = err && err.message ? err.message : JSON.stringify(err);
      loaderText.textContent = "SQL error: " + msg;
    });

  // ─── Filters ──────────────────────────────────────────────────────────

  var filterRegion = document.getElementById("filter-region");
  var filterOps = document.getElementById("filter-ops");
  var filterJob = document.getElementById("filter-job");
  var filterAccount = document.getElementById("filter-account");
  var jobList = document.getElementById("job-list");
  var accountList = document.getElementById("account-list");

  function populateFilters() {
    var regions = {};
    var jobs = {};
    var accounts = {};
    var leads = {};

    for (var r = 0; r < rawRows.length; r++) {
      var row = rawRows[r];
      var rgn = colIndices.region >= 0 ? row[colIndices.region] : null;
      var j = colIndices.job >= 0 ? row[colIndices.job] : null;
      var a = colIndices.account >= 0 ? row[colIndices.account] : null;
      var o = colIndices.opsLead >= 0 ? row[colIndices.opsLead] : null;
      if (rgn && rgn !== "HQ") regions[rgn] = true;
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
      var opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      el.appendChild(opt);
    });
  }

  function fillDatalist(el, values) {
    values.forEach(function (v) {
      var opt = document.createElement("option");
      opt.value = v;
      el.appendChild(opt);
    });
  }

  // Filter change listeners — dropdowns
  [filterRegion, filterOps].forEach(function (el) {
    el.addEventListener("change", refreshView);
  });

  // Search inputs — debounced refresh on input
  var searchTimer = null;
  [filterJob, filterAccount].forEach(function (el) {
    el.addEventListener("input", function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(refreshView, 300);
    });
    el.addEventListener("change", refreshView);
  });

  document.getElementById("filter-clear").addEventListener("click", function () {
    filterRegion.value = "";
    filterOps.value = "";
    filterJob.value = "";
    filterAccount.value = "";
    refreshView();
  });

  // Apply filters to raw rows
  function getFilteredRows() {
    var rVal = filterRegion.value;
    var oVal = filterOps.value;
    var jVal = filterJob.value.trim();
    var aVal = filterAccount.value.trim();

    if (!rVal && !jVal && !aVal && !oVal) return rawRows;

    var jLower = jVal.toLowerCase();
    var aLower = aVal.toLowerCase();

    return rawRows.filter(function (row) {
      if (colIndices.region >= 0 && row[colIndices.region] === "HQ") return false;
      if (rVal && colIndices.region >= 0 && row[colIndices.region] !== rVal) return false;
      if (oVal && colIndices.opsLead >= 0 && row[colIndices.opsLead] !== oVal) return false;
      if (jVal && colIndices.job >= 0) {
        var rowJob = (row[colIndices.job] || "").toString().toLowerCase();
        if (rowJob.indexOf(jLower) === -1) return false;
      }
      if (aVal && colIndices.account >= 0) {
        var rowAcct = (row[colIndices.account] || "").toString().toLowerCase();
        if (rowAcct.indexOf(aLower) === -1) return false;
      }
      return true;
    });
  }

  // ─── View toggle ──────────────────────────────────────────────────────

  var btnChart = document.getElementById("btn-chart");
  var btnTable = document.getElementById("btn-table");
  var chartContainer = document.getElementById("chart-container");
  var tableContainer = document.getElementById("table-container");

  btnChart.addEventListener("click", function () {
    if (currentView === "chart") return;
    currentView = "chart";
    btnChart.classList.add("active");
    btnTable.classList.remove("active");
    chartContainer.classList.remove("hidden");
    tableContainer.classList.add("hidden");
    refreshView();
  });

  btnTable.addEventListener("click", function () {
    if (currentView === "table") return;
    currentView = "table";
    btnTable.classList.add("active");
    btnChart.classList.remove("active");
    tableContainer.classList.remove("hidden");
    chartContainer.classList.add("hidden");
    refreshView();
  });

  // ─── Refresh ──────────────────────────────────────────────────────────

  function refreshView() {
    if (!rawRows) return;
    var filteredRows = getFilteredRows();
    var processed = aggregateData(filteredRows);

    if (currentView === "chart") {
      buildChart(processed);
    } else {
      buildTable(processed);
    }
  }

  // ─── Aggregation ──────────────────────────────────────────────────────

  function aggregateData(rows) {
    var actual = {};
    var forecast = {};
    var budget = {};

    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var monthRaw = row[colIndices.month];
      var amount = parseFloat(row[colIndices.amount]) || 0;
      var category = row[colIndices.category];
      var source = row[colIndices.source];

      if (source !== sourceActual && source !== sourceForecast && source !== sourceBudget) continue;

      var d = parseDate(monthRaw);
      var year = d.getUTCFullYear();
      if (year !== currentYear) continue;

      var mm = ("0" + (d.getUTCMonth() + 1)).slice(-2);
      var monthKey = year + "-" + mm;

      var target = (source === sourceActual) ? actual : (source === sourceForecast) ? forecast : budget;
      if (!target[monthKey]) {
        target[monthKey] = { labor: 0, revenue: 0 };
      }

      if (laborCategories.indexOf(category) !== -1) {
        target[monthKey].labor += amount;
      } else if (category === revenueCategory) {
        // Revenue is stored as credit (negative) in ACTUALS only; forecast/budget already positive
        var rev = (source === sourceActual) ? amount * -1 : amount;
        target[monthKey].revenue += rev;
      }
    }

    // Build sorted month keys from all data
    var allKeys = {};
    Object.keys(actual).forEach(function (k) { allKeys[k] = true; });
    Object.keys(forecast).forEach(function (k) { allKeys[k] = true; });
    var sortedKeys = Object.keys(allKeys).sort();

    // Determine current month key — months not yet closed should be FCST
    var now = new Date();
    var curMonthKey = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2);

    var months = [];
    var actualLabor = [];
    var budgetLabor = [];
    var actualDL = [];
    var budgetDL = [];
    var monthSources = [];
    var monthKeys = [];

    sortedKeys.forEach(function (key) {
      var parts = key.split("-");
      var monthNum = parseInt(parts[1], 10);

      var a = actual[key];
      var f = forecast[key] || { labor: 0, revenue: 0 };
      var b = budget[key] || { labor: 0, revenue: 0 };

      var useActual = key < curMonthKey && a && (a.labor !== 0 || a.revenue !== 0);
      var display = useActual ? a : f;

      var label = monthNames[monthNum - 1] + " " + parts[0];
      months.push(label);
      monthKeys.push(key);
      monthSources.push(useActual ? "ACT" : "FCST");

      actualLabor.push(display.labor);
      budgetLabor.push(b.labor);

      var dispRev = display.revenue;
      var bRev = b.revenue;
      actualDL.push(dispRev !== 0 ? parseFloat(((display.labor / dispRev) * 100).toFixed(2)) : 0);
      budgetDL.push(bRev !== 0 ? parseFloat(((b.labor / bRev) * 100).toFixed(2)) : 0);
    });

    return {
      months: months,
      monthKeys: monthKeys,
      monthSources: monthSources,
      actualLabor: actualLabor,
      budgetLabor: budgetLabor,
      actualDL: actualDL,
      budgetDL: budgetDL
    };
  }

  // ─── Chart ────────────────────────────────────────────────────────────

  function buildChart(data) {
    var months = data.months;
    var actualLabor = data.actualLabor;
    var budgetLabor = data.budgetLabor;
    var actualDL = data.actualDL;
    var budgetDL = data.budgetDL;
    var monthKeys = data.monthKeys;
    var monthSources = data.monthSources;

    var barColors = monthSources.map(function (s) {
      return s === "ACT" ? "rgba(74, 144, 217, 0.85)" : "rgba(74, 144, 217, 0.45)";
    });
    var barBorders = monthSources.map(function (s) {
      return s === "ACT" ? "rgba(74, 144, 217, 1)" : "rgba(74, 144, 217, 0.7)";
    });

    var xLabels = months.map(function (m, i) {
      return m + "\n(" + monthSources[i] + ")";
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

    var ctx = document.getElementById("trendChart").getContext("2d");

    chartInstance = new Chart(ctx, {
      type: "bar",
      data: {
        labels: xLabels,
        datasets: [
          {
            label: "Actual Labor $",
            type: "bar",
            data: actualLabor,
            backgroundColor: barColors,
            borderColor: barBorders,
            borderWidth: 1,
            borderRadius: 3,
            yAxisID: "yDollars",
            order: 4
          },
          {
            label: "Budget Labor $",
            type: "bar",
            data: budgetLabor,
            backgroundColor: "rgba(74, 144, 217, 0.2)",
            borderColor: "rgba(74, 144, 217, 0.6)",
            borderWidth: 1,
            borderRadius: 3,
            borderDash: [4, 3],
            yAxisID: "yDollars",
            order: 3
          },
          {
            label: "DL % Actual",
            type: "line",
            data: actualDL,
            borderColor: "#e8833a",
            backgroundColor: "rgba(232, 131, 58, 0.1)",
            borderWidth: 2.5,
            pointBackgroundColor: "#e8833a",
            pointBorderColor: "#fff",
            pointBorderWidth: 1.5,
            pointRadius: 4,
            pointHoverRadius: 6,
            tension: 0.3,
            fill: false,
            yAxisID: "yPercent",
            order: 1
          },
          {
            label: "DL % Budget",
            type: "line",
            data: budgetDL,
            borderColor: "#e8833a",
            borderDash: [6, 4],
            borderWidth: 1.5,
            pointBackgroundColor: "#fff",
            pointBorderColor: "#e8833a",
            pointBorderWidth: 1.5,
            pointRadius: 3,
            pointHoverRadius: 5,
            tension: 0.3,
            fill: false,
            yAxisID: "yPercent",
            order: 2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: "index",
          intersect: false
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: "rgba(0,0,0,0.8)",
            titleFont: { size: 13, weight: "600" },
            bodyFont: { size: 12 },
            padding: 10,
            cornerRadius: 6,
            callbacks: {
              label: function (context) {
                var label = context.dataset.label || "";
                var value = context.parsed.y;
                var idx = context.dataIndex;

                if (label.indexOf("Labor $") !== -1) {
                  var formatted = "$" + value.toLocaleString("en-US", {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0
                  });
                  if (label === "Actual Labor $") {
                    var mom = momLaborChange[idx];
                    if (mom !== null) {
                      var sign = mom >= 0 ? "+" : "";
                      formatted += "  (" + sign + "$" + mom.toLocaleString("en-US", {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0
                      }) + " MOM)";
                    }
                  }
                  if (label === "Budget Labor $") {
                    var variance = actualLabor[idx] - budgetLabor[idx];
                    var sign2 = variance >= 0 ? "+" : "";
                    formatted += "  (var: " + sign2 + "$" + variance.toLocaleString("en-US", {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 0
                    }) + ")";
                  }
                  return "  " + label + ": " + formatted;
                }

                if (label.indexOf("DL %") !== -1) {
                  var fmtPct = value.toFixed(1) + "%";
                  if (label === "DL % Actual") {
                    var momDL = momDLChange[idx];
                    if (momDL !== null) {
                      var sign3 = momDL >= 0 ? "+" : "";
                      fmtPct += "  (" + sign3 + momDL.toFixed(1) + "pp MOM)";
                    }
                  }
                  if (label === "DL % Budget") {
                    var dlVar = actualDL[idx] - budgetDL[idx];
                    var sign4 = dlVar >= 0 ? "+" : "";
                    fmtPct += "  (var: " + sign4 + dlVar.toFixed(1) + "pp)";
                  }
                  return "  " + label + ": " + fmtPct;
                }

                return "  " + label + ": " + value;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              font: { size: 11 },
              color: "#888"
            }
          },
          yDollars: {
            type: "linear",
            position: "left",
            beginAtZero: true,
            title: {
              display: true,
              text: "Labor $",
              font: { size: 12, weight: "600" },
              color: "#4a90d9"
            },
            grid: { color: "rgba(0,0,0,0.06)" },
            ticks: {
              font: { size: 11 },
              color: "#888",
              callback: function (value) {
                if (value >= 1000000) return "$" + (value / 1000000).toFixed(1) + "M";
                if (value >= 1000) return "$" + (value / 1000).toFixed(0) + "K";
                return "$" + value;
              }
            }
          },
          yPercent: {
            type: "linear",
            position: "right",
            beginAtZero: true,
            title: {
              display: true,
              text: "DL %",
              font: { size: 12, weight: "600" },
              color: "#e8833a"
            },
            grid: { drawOnChartArea: false },
            ticks: {
              font: { size: 11 },
              color: "#888",
              callback: function (value) {
                return value.toFixed(0) + "%";
              }
            }
          }
        },
        onClick: function (event, elements) {
          if (elements.length === 0) return;
          var idx = elements[0].index;
          var monthKey = monthKeys[idx];
          showDrilldown(monthKey);
        }
      }
    });
  }

  // ─── Table View ───────────────────────────────────────────────────────

  function buildTable(data) {
    var thead = document.getElementById("summary-thead");
    var tbody = document.getElementById("summary-tbody");
    thead.innerHTML = "";
    tbody.innerHTML = "";

    var headers = ["Month", "Actual Labor $", "Budget Labor $", "Variance $", "DL % Actual", "DL % Budget", "DL % Var"];
    var numCols = [false, true, true, true, true, true, true];

    headers.forEach(function (h, i) {
      var th = document.createElement("th");
      th.textContent = h;
      if (numCols[i]) th.className = "num";
      thead.appendChild(th);
    });

    var totActual = 0;
    var totBudget = 0;

    data.months.forEach(function (month, i) {
      var aLabor = data.actualLabor[i];
      var bLabor = data.budgetLabor[i];
      var variance = aLabor - bLabor;
      var aDL = data.actualDL[i];
      var bDL = data.budgetDL[i];
      var dlVar = aDL - bDL;

      totActual += aLabor;
      totBudget += bLabor;

      var tr = document.createElement("tr");
      tr.style.cursor = "pointer";
      tr.setAttribute("data-month-key", data.monthKeys[i]);
      tr.addEventListener("click", function () {
        showDrilldown(this.getAttribute("data-month-key"));
      });

      var tdMonth = document.createElement("td");
      tdMonth.className = "month-label";
      tdMonth.textContent = month;
      tr.appendChild(tdMonth);

      tr.appendChild(makeCurrencyCell(aLabor));
      tr.appendChild(makeCurrencyCell(bLabor));

      var tdVar = makeCurrencyCell(variance);
      if (variance > 0) tdVar.classList.add("negative");
      else if (variance < 0) tdVar.classList.add("positive");
      tr.appendChild(tdVar);

      tr.appendChild(makePercentCell(aDL));
      tr.appendChild(makePercentCell(bDL));

      var tdDLVar = makePercentCell(dlVar, true);
      if (dlVar > 0.01) tdDLVar.classList.add("negative");
      else if (dlVar < -0.01) tdDLVar.classList.add("positive");
      tr.appendChild(tdDLVar);

      tbody.appendChild(tr);
    });

    // Totals row
    var totalVariance = totActual - totBudget;
    var trTotal = document.createElement("tr");
    trTotal.className = "totals-row";

    var tdTotLabel = document.createElement("td");
    tdTotLabel.className = "month-label";
    tdTotLabel.textContent = "Total";
    trTotal.appendChild(tdTotLabel);

    trTotal.appendChild(makeCurrencyCell(totActual));
    trTotal.appendChild(makeCurrencyCell(totBudget));

    var tdTotVar = makeCurrencyCell(totalVariance);
    if (totalVariance > 0) tdTotVar.classList.add("negative");
    else if (totalVariance < 0) tdTotVar.classList.add("positive");
    trTotal.appendChild(tdTotVar);

    for (var x = 0; x < 3; x++) {
      var tdBlank = document.createElement("td");
      tdBlank.className = "num";
      tdBlank.textContent = "\u2014";
      trTotal.appendChild(tdBlank);
    }

    tbody.appendChild(trTotal);
  }

  function makeCurrencyCell(value) {
    var td = document.createElement("td");
    td.className = "num";
    var prefix = value < 0 ? "-$" : "$";
    td.textContent = prefix + Math.abs(value).toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    });
    return td;
  }

  function makePercentCell(value, showSign) {
    var td = document.createElement("td");
    td.className = "num";
    var prefix = showSign && value > 0 ? "+" : "";
    td.textContent = prefix + value.toFixed(1) + "%";
    return td;
  }

  // ─── Drill-down table ─────────────────────────────────────────────────

  function showDrilldown(monthKey) {
    var overlay = document.getElementById("drilldown-overlay");
    var title = document.getElementById("drilldown-title");
    var thead = document.getElementById("drilldown-thead");
    var tbody = document.getElementById("drilldown-tbody");

    var parts = monthKey.split("-");
    var monthNum = parseInt(parts[1], 10);
    var label = monthNames[monthNum - 1] + " " + parts[0];
    title.textContent = label + " \u2014 Labor & Revenue Detail";

    var filteredRows = getFilteredRows();
    var agg = {};

    for (var r = 0; r < filteredRows.length; r++) {
      var row = filteredRows[r];
      var source = row[colIndices.source];
      if (source !== sourceActual && source !== sourceBudget) continue;

      var category = row[colIndices.category];
      if (laborCategories.indexOf(category) === -1 && category !== revenueCategory) continue;

      var d = parseDate(row[colIndices.month]);
      var year = d.getUTCFullYear();
      if (year !== currentYear) continue;

      var mm = ("0" + (d.getUTCMonth() + 1)).slice(-2);
      var key = year + "-" + mm;
      if (key !== monthKey) continue;

      var amount = parseFloat(row[colIndices.amount]) || 0;
      var aggKey = source + "|" + category;
      if (!agg[aggKey]) agg[aggKey] = { source: source, category: category, sum: 0, count: 0 };
      agg[aggKey].sum += amount;
      agg[aggKey].count += 1;
    }

    var aggRows = Object.keys(agg).sort().map(function (k) { return agg[k]; });

    thead.innerHTML = "";
    tbody.innerHTML = "";

    ["Source", "P&L Category", "Amount", "Row Count"].forEach(function (h) {
      var th = document.createElement("th");
      th.textContent = h;
      thead.appendChild(th);
    });

    aggRows.forEach(function (r) {
      var tr = document.createElement("tr");

      var tdSource = document.createElement("td");
      tdSource.textContent = r.source === sourceBudget ? "Budget" : "Actual";
      tr.appendChild(tdSource);

      var tdCat = document.createElement("td");
      tdCat.textContent = r.category;
      tr.appendChild(tdCat);

      var tdAmount = document.createElement("td");
      tdAmount.className = "num";
      tdAmount.textContent = "$" + r.sum.toLocaleString("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      });
      tr.appendChild(tdAmount);

      var tdCount = document.createElement("td");
      tdCount.className = "num";
      tdCount.textContent = r.count.toLocaleString();
      tr.appendChild(tdCount);

      tbody.appendChild(tr);
    });

    overlay.classList.remove("hidden");
  }

  // Close drill-down
  document.getElementById("drilldown-close").addEventListener("click", function () {
    document.getElementById("drilldown-overlay").classList.add("hidden");
  });

  document.getElementById("drilldown-overlay").addEventListener("click", function (e) {
    if (e.target === this) {
      this.classList.add("hidden");
    }
  });
})();
