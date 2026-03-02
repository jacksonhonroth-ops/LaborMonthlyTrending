// Labor MOM Trending Card
// Data source: Job_Financials_wo_JoinV2 (977fd639-75bb-422c-8773-a26488330bca)
// Aggregates Amount by P&L Category Name to derive Labor $ and DL %
// Compares ACTUAL vs OPS_FIN_BUDGET, drill-down on click

var datasets = ["dataset"];

// Manifest aliases used in the query URL
var queryAliases = ["MONTH", "Amount", "PLCategoryName", "SOURCE"];

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

// Store raw data for drill-down
var rawData = null;
var colIndices = null;

domo.get(query, { format: "array-of-arrays" })
  .then(function (data) {
    loaderText.textContent = "Building chart...";
    rawData = data;
    colIndices = {
      month: findCol(data.columns, ["MONTH", "Month", "month"]),
      amount: findCol(data.columns, ["Amount", "amount", "AMOUNT"]),
      category: findCol(data.columns, ["PLCategoryName", "P&L Category Name", "P&L_Category_Name"]),
      source: findCol(data.columns, ["SOURCE", "Source", "source"])
    };
    var processed = aggregateData(data, colIndices);
    buildChart(processed);
    loader.classList.add("hidden");
  });

function aggregateData(data, cols) {
  // Separate buckets for actual and budget
  var actual = {};
  var budget = {};

  data.rows.forEach(function (row) {
    var monthRaw = row[cols.month];
    var amount = parseFloat(row[cols.amount]) || 0;
    var category = row[cols.category];
    var source = row[cols.source];

    // Only process ACTUAL and BUDGET sources
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

  var ctx = document.getElementById("trendChart").getContext("2d");

  new Chart(ctx, {
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
                // Show MOM change for actual only
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
                // Show variance for budget
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

// ─── Drill-down table ──────────────────────────────────────────────────

function showDrilldown(monthKey) {
  var overlay = document.getElementById("drilldown-overlay");
  var title = document.getElementById("drilldown-title");
  var thead = document.getElementById("drilldown-thead");
  var tbody = document.getElementById("drilldown-tbody");

  var parts = monthKey.split("-");
  var monthNum = parseInt(parts[1], 10);
  var label = monthNames[monthNum - 1] + " " + parts[0];
  title.textContent = label + " — Labor & Revenue Detail";

  // Filter raw data for this month, ACTUAL + BUDGET, labor + revenue categories
  var rows = [];
  rawData.rows.forEach(function (row) {
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
      amount: parseFloat(row[colIndices.amount]) || 0
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
    tdSource.textContent = r.source;
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
