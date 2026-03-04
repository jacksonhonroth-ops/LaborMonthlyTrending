// Labor MOM Trending Card
// Data source: Job_Financials_wo_JoinV2 (977fd639-75bb-422c-8773-a26488330bca)
// Aggregates Amount by P&L Category Name to derive Labor $ and DL %
// Compares ACTUAL vs OPS_FIN_BUDGET, drill-down on click, filter by Region/Job/Account/OpsLead

var datasets = ["dataset"];

// Manifest aliases used in the query URL
var queryAliases = ["MONTH", "Amount", "PLCategoryName", "SOURCE", "Region", "JobNumber", "ParentAccount", "OpsLead"];

// P&L Category Name values that constitute labor
var laborCategories = ["Total Labor"];
var revenueCategory = "Service Revenue";

// Source values
var sourceActual = "ACTUAL";
var sourceBudget = "OPS_FIN_BUDGET";

// Current year filter
var currentYear = 2026;

// Data query for live DOMO data
var query = "/data/v1/" + datasets[0] + "?fields=" + queryAliases.join();

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

var monthNames = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

var loader = document.getElementById("loader");
var loaderText = document.getElementById("loader-text");

loaderText.textContent = "Fetching from Job Financials...";

// Store raw data for drill-down and filtering
var rawData = null;
var colIndices = null;
var chartInstance = null;
var currentView = "chart"; // "chart" or "table"

domo.get(query, { format: "array-of-arrays" })
  .then(function (data) {
    loaderText.textContent = "Building chart...";
    rawData = data;
    colIndices = {
      month: findCol(data.columns, ["MONTH", "Month", "month"]),
      amount: findCol(data.columns, ["Amount", "amount", "AMOUNT"]),
      category: findCol(data.columns, ["PLCategoryName", "P&L Category Name", "P&L_Category_Name"]),
      source: findCol(data.columns, ["SOURCE", "Source", "source"]),
      region: findCol(data.columns, ["Region", "region", "REGION"]),
      job: findCol(data.columns, ["JobNumber", "Job Number", "JOB_NUMBER"]),
      account: findCol(data.columns, ["ParentAccount", "Parent Account", "PARENT_ACCOUNT"]),
      opsLead: findCol(data.columns, ["OpsLead", "Ops Lead", "OPS_LEAD"])
    };
    populateFilters(data, colIndices);
    refreshView();
    loader.classList.add("hidden");
  });

// ─── Filters ──────────────────────────────────────────────────────────

var filterRegion = document.getElementById("filter-region");
var filterOps = document.getElementById("filter-ops");

// Search-select instances for Job Number and Parent Account
var ssJob = null;
var ssAccount = null;

function populateFilters(data, cols) {
  var regions = {};
  var jobs = {};
  var accounts = {};
  var leads = {};

  data.rows.forEach(function (row) {
    var r = row[cols.region];
    var j = row[cols.job];
    var a = row[cols.account];
    var o = row[cols.opsLead];
    if (r) regions[r] = true;
    if (j) jobs[j] = true;
    if (a) accounts[a] = true;
    if (o) leads[o] = true;
  });

  fillSelect(filterRegion, Object.keys(regions).sort());
  fillSelect(filterOps, Object.keys(leads).sort());

  ssJob = initSearchSelect("ss-job", "filter-job", Object.keys(jobs).sort(), refreshView);
  ssAccount = initSearchSelect("ss-account", "filter-account", Object.keys(accounts).sort(), refreshView);
}

function fillSelect(el, values) {
  values.forEach(function (v) {
    var opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    el.appendChild(opt);
  });
}

// ─── Search-Select Widget ─────────────────────────────────────────────

function initSearchSelect(wrapperId, inputId, allValues, onChange) {
  var wrapper = document.getElementById(wrapperId);
  var input = document.getElementById(inputId);
  var dropdown = wrapper.querySelector(".ss-dropdown");
  var clearBtn = wrapper.querySelector(".ss-clear");
  var highlightIdx = -1;
  var selectedValue = "";
  var visible = [];

  function render(query) {
    dropdown.innerHTML = "";
    highlightIdx = -1;
    var q = (query || "").toLowerCase();

    visible = allValues.filter(function (v) {
      return !q || v.toLowerCase().indexOf(q) !== -1;
    });

    if (visible.length === 0) {
      var noRes = document.createElement("div");
      noRes.className = "ss-no-results";
      noRes.textContent = "No matches";
      dropdown.appendChild(noRes);
      return;
    }

    visible.forEach(function (v, i) {
      var div = document.createElement("div");
      div.className = "ss-option";
      div.setAttribute("data-value", v);

      // Highlight matching text
      if (q) {
        var lowerV = v.toLowerCase();
        var matchStart = lowerV.indexOf(q);
        if (matchStart !== -1) {
          div.innerHTML = escapeHtml(v.substring(0, matchStart)) +
            '<span class="ss-match">' + escapeHtml(v.substring(matchStart, matchStart + q.length)) + '</span>' +
            escapeHtml(v.substring(matchStart + q.length));
        } else {
          div.textContent = v;
        }
      } else {
        div.textContent = v;
      }

      div.addEventListener("mousedown", function (e) {
        e.preventDefault(); // prevent input blur
        selectValue(v);
      });

      dropdown.appendChild(div);
    });
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  function selectValue(val) {
    selectedValue = val;
    input.value = val;
    dropdown.classList.add("hidden");
    clearBtn.classList.remove("hidden");
    onChange();
  }

  function clearValue() {
    selectedValue = "";
    input.value = "";
    clearBtn.classList.add("hidden");
    onChange();
  }

  function showDropdown() {
    render(input.value);
    dropdown.classList.remove("hidden");
  }

  function hideDropdown() {
    dropdown.classList.add("hidden");
    highlightIdx = -1;
  }

  function setHighlight(idx) {
    var items = dropdown.querySelectorAll(".ss-option");
    items.forEach(function (el) { el.classList.remove("highlighted"); });
    if (idx >= 0 && idx < items.length) {
      items[idx].classList.add("highlighted");
      items[idx].scrollIntoView({ block: "nearest" });
    }
    highlightIdx = idx;
  }

  input.addEventListener("focus", function () {
    showDropdown();
  });

  input.addEventListener("blur", function () {
    // Small delay so mousedown on option can fire first
    setTimeout(function () {
      hideDropdown();
      // If typed value doesn't match a valid option, revert
      if (selectedValue && input.value !== selectedValue) {
        input.value = selectedValue;
      } else if (!selectedValue) {
        input.value = "";
      }
    }, 150);
  });

  input.addEventListener("input", function () {
    selectedValue = ""; // Clear locked selection while typing
    clearBtn.classList.add("hidden");
    showDropdown();
  });

  input.addEventListener("keydown", function (e) {
    var items = dropdown.querySelectorAll(".ss-option");
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!dropdown.classList.contains("hidden")) {
        setHighlight(Math.min(highlightIdx + 1, items.length - 1));
      } else {
        showDropdown();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight(Math.max(highlightIdx - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightIdx >= 0 && highlightIdx < visible.length) {
        selectValue(visible[highlightIdx]);
      }
    } else if (e.key === "Escape") {
      hideDropdown();
      input.blur();
    }
  });

  clearBtn.addEventListener("click", function () {
    clearValue();
    input.focus();
  });

  return {
    getValue: function () { return selectedValue; },
    clear: function () { clearValue(); }
  };
}

// Filter change listeners for regular selects
[filterRegion, filterOps].forEach(function (el) {
  el.addEventListener("change", refreshView);
});

document.getElementById("filter-clear").addEventListener("click", function () {
  filterRegion.value = "";
  filterOps.value = "";
  if (ssJob) ssJob.clear();
  if (ssAccount) ssAccount.clear();
  refreshView();
});

// Apply filters to raw rows
function getFilteredRows() {
  var rVal = filterRegion.value;
  var jVal = ssJob ? ssJob.getValue() : "";
  var aVal = ssAccount ? ssAccount.getValue() : "";
  var oVal = filterOps.value;

  if (!rVal && !jVal && !aVal && !oVal) return rawData.rows;

  return rawData.rows.filter(function (row) {
    if (rVal && row[colIndices.region] !== rVal) return false;
    if (jVal && row[colIndices.job] !== jVal) return false;
    if (aVal && row[colIndices.account] !== aVal) return false;
    if (oVal && row[colIndices.opsLead] !== oVal) return false;
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
  if (!rawData) return;
  var filteredRows = getFilteredRows();
  var processed = aggregateData(filteredRows, colIndices);

  if (currentView === "chart") {
    buildChart(processed);
  } else {
    buildTable(processed);
  }
}

// ─── Aggregation ──────────────────────────────────────────────────────

function aggregateData(rows, cols) {
  var actual = {};
  var budget = {};

  rows.forEach(function (row) {
    var monthRaw = row[cols.month];
    var amount = parseFloat(row[cols.amount]) || 0;
    var category = row[cols.category];
    var source = row[cols.source];

    if (source !== sourceActual && source !== sourceBudget) return;

    var d = parseDate(monthRaw);
    var year = d.getUTCFullYear();
    if (year !== currentYear) return;

    var mm = ("0" + (d.getUTCMonth() + 1)).slice(-2);
    var monthKey = year + "-" + mm;

    var target = (source === sourceActual) ? actual : budget;
    if (!target[monthKey]) {
      target[monthKey] = { labor: 0, revenue: 0 };
    }

    if (laborCategories.indexOf(category) !== -1) {
      target[monthKey].labor += amount;
    } else if (category === revenueCategory) {
      target[monthKey].revenue += amount;
    }
  });

  // Merge month keys from both sources
  var allKeys = {};
  Object.keys(actual).forEach(function (k) { allKeys[k] = true; });
  Object.keys(budget).forEach(function (k) { allKeys[k] = true; });
  var sortedKeys = Object.keys(allKeys).sort();

  var months = [];
  var actualLabor = [];
  var budgetLabor = [];
  var actualDL = [];
  var budgetDL = [];

  sortedKeys.forEach(function (key) {
    var parts = key.split("-");
    var monthNum = parseInt(parts[1], 10);
    months.push(monthNames[monthNum - 1] + " " + parts[0]);

    var a = actual[key] || { labor: 0, revenue: 0 };
    var b = budget[key] || { labor: 0, revenue: 0 };

    actualLabor.push(a.labor);
    budgetLabor.push(b.labor);

    var aRev = Math.abs(a.revenue);
    var bRev = Math.abs(b.revenue);
    actualDL.push(aRev !== 0 ? parseFloat(((a.labor / aRev) * 100).toFixed(2)) : 0);
    budgetDL.push(bRev !== 0 ? parseFloat(((b.labor / bRev) * 100).toFixed(2)) : 0);
  });

  return {
    months: months,
    monthKeys: sortedKeys,
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

  // MOM changes for actual
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

  // Destroy previous chart if exists
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }

  var ctx = document.getElementById("trendChart").getContext("2d");

  chartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: months,
      datasets: [
        {
          label: "Actual Labor $",
          type: "bar",
          data: actualLabor,
          backgroundColor: "rgba(74, 144, 217, 0.75)",
          borderColor: "rgba(74, 144, 217, 1)",
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
                  var sign = variance >= 0 ? "+" : "";
                  formatted += "  (var: " + sign + "$" + variance.toLocaleString("en-US", {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0
                  }) + ")";
                }
                return "  " + label + ": " + formatted;
              }

              if (label.indexOf("DL %") !== -1) {
                var formatted = value.toFixed(1) + "%";
                if (label === "DL % Actual") {
                  var mom = momDLChange[idx];
                  if (mom !== null) {
                    var sign = mom >= 0 ? "+" : "";
                    formatted += "  (" + sign + mom.toFixed(1) + "pp MOM)";
                  }
                }
                if (label === "DL % Budget") {
                  var variance = actualDL[idx] - budgetDL[idx];
                  var sign = variance >= 0 ? "+" : "";
                  formatted += "  (var: " + sign + variance.toFixed(1) + "pp)";
                }
                return "  " + label + ": " + formatted;
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
  var totActualRev = 0;
  var totBudgetRev = 0;

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

    // Month
    var tdMonth = document.createElement("td");
    tdMonth.className = "month-label";
    tdMonth.textContent = month;
    tr.appendChild(tdMonth);

    // Actual Labor
    tr.appendChild(makeCurrencyCell(aLabor));

    // Budget Labor
    tr.appendChild(makeCurrencyCell(bLabor));

    // Variance
    var tdVar = makeCurrencyCell(variance);
    if (variance > 0) tdVar.classList.add("negative");
    else if (variance < 0) tdVar.classList.add("positive");
    tr.appendChild(tdVar);

    // DL % Actual
    tr.appendChild(makePercentCell(aDL));

    // DL % Budget
    tr.appendChild(makePercentCell(bDL));

    // DL % Variance
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

  // Leave DL % cells blank for totals (avg doesn't make sense without weighting)
  for (var x = 0; x < 3; x++) {
    var tdBlank = document.createElement("td");
    tdBlank.className = "num";
    tdBlank.textContent = "—";
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
  title.textContent = label + " — Labor & Revenue Detail";

  // Filter raw data for this month, applying current filters
  var filteredRows = getFilteredRows();
  var rows = [];
  filteredRows.forEach(function (row) {
    var source = row[colIndices.source];
    if (source !== sourceActual && source !== sourceBudget) return;

    var category = row[colIndices.category];
    if (laborCategories.indexOf(category) === -1 && category !== revenueCategory) return;

    var d = parseDate(row[colIndices.month]);
    var year = d.getUTCFullYear();
    if (year !== currentYear) return;

    var mm = ("0" + (d.getUTCMonth() + 1)).slice(-2);
    var key = year + "-" + mm;
    if (key !== monthKey) return;

    rows.push({
      source: source,
      category: category,
      amount: parseFloat(row[colIndices.amount]) || 0,
      region: row[colIndices.region] || "",
      job: row[colIndices.job] || "",
      account: row[colIndices.account] || "",
      opsLead: row[colIndices.opsLead] || ""
    });
  });

  // Aggregate by source + category for a cleaner table
  var agg = {};
  rows.forEach(function (r) {
    var k = r.source + "|" + r.category;
    if (!agg[k]) agg[k] = { source: r.source, category: r.category, sum: 0, count: 0 };
    agg[k].sum += r.amount;
    agg[k].count += 1;
  });

  var aggRows = Object.keys(agg).sort().map(function (k) { return agg[k]; });

  // Build table
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
