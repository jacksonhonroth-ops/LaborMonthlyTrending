// Labor MOM Trending Card
// Data source: Job_Financials_wo_JoinV2 (977fd639-75bb-422c-8773-a26488330bca)
// Aggregates Amount by P&L Category Name to derive Labor $ and DL %
// Filters to ACTUAL source and current year (2026)

var datasets = ["dataset"];

// Manifest aliases used in the query URL
var queryAliases = ["MONTH", "Amount", "PLCategoryName", "SOURCE"];

// P&L Category Name values that constitute "Direct Labor"
var laborCategories = ["Total Labor"];
var revenueCategory = "Service Revenue";

// Only show ACTUAL data (not budget or forecast)
var sourceFilter = "ACTUAL";

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

var loader = document.getElementById("loader");
var loaderText = document.getElementById("loader-text");

loaderText.textContent = "Fetching from Job Financials...";

domo.get(query, { format: "array-of-arrays" })
  .then(function (data) {
    loaderText.textContent = "Building chart...";
    var processed = aggregateData(data);
    buildChart(processed);
    loader.classList.add("hidden");
  });

function aggregateData(data) {
  // Try both manifest aliases and actual dataset column names
  var monthIdx = findCol(data.columns, ["MONTH", "Month", "month"]);
  var amountIdx = findCol(data.columns, ["Amount", "amount", "AMOUNT"]);
  var categoryIdx = findCol(data.columns, ["PLCategoryName", "P&L Category Name", "P&L_Category_Name"]);
  var sourceIdx = findCol(data.columns, ["SOURCE", "Source", "source"]);

  // DEBUG: collect unique values to diagnose mismatches
  var uniqueCategories = {};
  var uniqueSources = {};
  var sampleDateRaw = null;
  var totalRows = data.rows.length;

  // Buckets: { "2026-01": { labor: 0, revenue: 0 } }
  var buckets = {};
  // Track per-month category breakdown for debug
  var monthCats = {};

  data.rows.forEach(function (row) {
    var monthRaw = row[monthIdx];
    var amount = parseFloat(row[amountIdx]) || 0;
    var category = row[categoryIdx];
    var source = row[sourceIdx];

    // Track unique values for debug
    uniqueCategories[category] = (uniqueCategories[category] || 0) + 1;
    uniqueSources[source] = (uniqueSources[source] || 0) + 1;
    if (!sampleDateRaw) sampleDateRaw = monthRaw;

    // Filter: ACTUAL source only
    if (source !== sourceFilter) return;

    // Parse date - handle epoch ms (number), epoch string, or ISO string
    var d;
    if (typeof monthRaw === "number") {
      d = new Date(monthRaw);
    } else {
      var s = String(monthRaw);
      if (/^\d{10,}$/.test(s)) {
        d = new Date(parseInt(s, 10));
      } else {
        d = new Date(s);
      }
    }

    // Use UTC methods — DOMO date strings parse as UTC midnight, but
    // getFullYear/getMonth use local time which shifts dates back a day
    // in US timezones (e.g. "2026-02-01" UTC → Jan 31 in CT/PT)
    var year = d.getUTCFullYear();
    if (year !== currentYear) return;

    var mm = ("0" + (d.getUTCMonth() + 1)).slice(-2);
    var monthKey = year + "-" + mm;

    if (!buckets[monthKey]) {
      buckets[monthKey] = { labor: 0, revenue: 0 };
    }

    // Track category amounts per month for debug
    if (!monthCats[monthKey]) monthCats[monthKey] = {};
    if (!monthCats[monthKey][category]) monthCats[monthKey][category] = { sum: 0, count: 0 };
    monthCats[monthKey][category].sum += amount;
    monthCats[monthKey][category].count += 1;

    // Categorize amounts
    if (laborCategories.indexOf(category) !== -1) {
      buckets[monthKey].labor += amount;
    } else if (category === revenueCategory) {
      buckets[monthKey].revenue += amount;
    }
  });

  // DEBUG: show what's actually in the data
  var debugPanel = document.getElementById("debug-panel");
  var catList = Object.keys(uniqueCategories).sort().map(function (k) {
    return "  \"" + k + "\" (" + uniqueCategories[k] + " rows)";
  }).join("\n");
  var bucketSummary = Object.keys(buckets).sort().map(function (k) {
    var detail = "";
    if (monthCats[k]) {
      detail = Object.keys(monthCats[k]).sort().map(function (cat) {
        var mc = monthCats[k][cat];
        return "      " + cat + ": $" + mc.sum.toFixed(0) + " (" + mc.count + " rows)";
      }).join("\n");
    }
    return "  " + k + ": labor=" + buckets[k].labor.toFixed(0) +
      ", revenue=" + buckets[k].revenue.toFixed(0) + "\n" + detail;
  }).join("\n");
  debugPanel.textContent = "DEBUG - Total rows: " + totalRows +
    "\nColumns: " + JSON.stringify(data.columns) +
    "\nSample date raw: " + JSON.stringify(sampleDateRaw) + " (type: " + typeof sampleDateRaw + ")" +
    "\nColumn indices: month=" + monthIdx + " amount=" + amountIdx + " category=" + categoryIdx + " source=" + sourceIdx +
    "\n\nBuckets (ACTUAL, " + currentYear + " only, per-category breakdown):\n" + bucketSummary;

  // Sort months chronologically
  var sortedKeys = Object.keys(buckets).sort();

  var months = [];
  var laborDollars = [];
  var dlPercents = [];

  var monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ];

  sortedKeys.forEach(function (key) {
    var parts = key.split("-");
    var monthNum = parseInt(parts[1], 10);
    var label = monthNames[monthNum - 1] + " " + parts[0];
    months.push(label);

    var labor = buckets[key].labor;
    var revenue = buckets[key].revenue;
    laborDollars.push(labor);

    // DL % = Labor $ / |Revenue| * 100 (revenue may be negative per accounting convention)
    var absRevenue = Math.abs(revenue);
    var dlPct = absRevenue !== 0 ? (labor / absRevenue) * 100 : 0;
    dlPercents.push(parseFloat(dlPct.toFixed(2)));
  });

  return {
    months: months,
    monthKeys: sortedKeys,
    laborDollars: laborDollars,
    dlPercents: dlPercents
  };
}

function buildChart(data) {
  var months = data.months;
  var laborDollars = data.laborDollars;
  var dlPercents = data.dlPercents;

  // Calculate MOM changes
  var momLaborChange = [];
  var momDLChange = [];
  for (var i = 0; i < laborDollars.length; i++) {
    if (i === 0) {
      momLaborChange.push(null);
      momDLChange.push(null);
    } else {
      momLaborChange.push(laborDollars[i] - laborDollars[i - 1]);
      var dlChg = dlPercents[i] - dlPercents[i - 1];
      momDLChange.push(parseFloat(dlChg.toFixed(2)));
    }
  }

  // Store month keys for drill-down filtering
  var monthKeys = data.monthKeys;

  var ctx = document.getElementById("trendChart").getContext("2d");

  var chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: months,
      datasets: [
        {
          label: "Labor $",
          type: "bar",
          data: laborDollars,
          backgroundColor: "rgba(74, 144, 217, 0.75)",
          borderColor: "rgba(74, 144, 217, 1)",
          borderWidth: 1,
          borderRadius: 3,
          yAxisID: "yDollars",
          order: 2
        },
        {
          label: "DL %",
          type: "line",
          data: dlPercents,
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

              if (label === "Labor $") {
                var formatted = "$" + value.toLocaleString("en-US", {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0
                });
                var mom = momLaborChange[idx];
                if (mom !== null) {
                  var sign = mom >= 0 ? "+" : "";
                  formatted += "  (" + sign + "$" + mom.toLocaleString("en-US", {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0
                  }) + " MOM)";
                }
                return "  " + label + ": " + formatted;
              }

              if (label === "DL %") {
                var formatted = value.toFixed(1) + "%";
                var mom = momDLChange[idx];
                if (mom !== null) {
                  var sign = mom >= 0 ? "+" : "";
                  formatted += "  (" + sign + mom.toFixed(1) + "pp MOM)";
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
          grid: {
            display: false
          },
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
          grid: {
            color: "rgba(0,0,0,0.06)"
          },
          ticks: {
            font: { size: 11 },
            color: "#888",
            callback: function (value) {
              if (value >= 1000000) {
                return "$" + (value / 1000000).toFixed(1) + "M";
              }
              if (value >= 1000) {
                return "$" + (value / 1000).toFixed(0) + "K";
              }
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
          grid: {
            drawOnChartArea: false
          },
          ticks: {
            font: { size: 11 },
            color: "#888",
            callback: function (value) {
              return value.toFixed(0) + "%";
            }
          }
        }
      }
    },
    onClick: function (event, elements) {
      if (elements.length === 0) return;
      var idx = elements[0].index;
      var monthKey = monthKeys[idx]; // e.g. "2026-01"

      // Filter the dataset to the clicked month using domo.filterContainer
      domo.filterContainer([
        {
          column: "MONTH",
          dataSourceId: datasets[0],
          operand: "EQUALS",
          values: [monthKey + "-01"],
          dataType: "date"
        }
      ]);
    }
  });
}
