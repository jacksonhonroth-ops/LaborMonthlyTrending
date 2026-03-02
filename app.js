// Labor MOM Trending Card
// Data source: Job_Financials_wo_JoinV2 (977fd639-75bb-422c-8773-a26488330bca)
// Aggregates Amount by P&L Category Name to derive Labor $ and DL %
// Filters to ACTUAL source and current year (2026)

var datasets = ["dataset"];

// Column aliases matching manifest.json
var colMonth = "MONTH";
var colAmount = "Amount";
var colPLCategory = "PLCategoryName";
var colSource = "SOURCE";

// P&L Category Name values that constitute "Direct Labor"
var laborCategories = ["Direct Labor", "Total Labor"];
var revenueCategory = "Service Revenue";

// Only show ACTUAL data (not budget or forecast)
var sourceFilter = "ACTUAL";

// Current year filter
var currentYear = 2026;

// Data query for live DOMO data
var fields = [colMonth, colAmount, colPLCategory, colSource];
var query = "/data/v1/" + datasets[0] + "?fields=" + fields.join();

// Switch between local sample data and live DOMO query:
// Live:  domo.get(query, { format: "array-of-arrays" })
// Local: domo.get('./data.json')
domo.get("./data.json")
  .then(function (data) {
    var processed = aggregateData(data);
    buildChart(processed);
  });

function aggregateData(data) {
  var monthIdx = data.columns.indexOf(colMonth);
  var amountIdx = data.columns.indexOf(colAmount);
  var categoryIdx = data.columns.indexOf(colPLCategory);
  var sourceIdx = data.columns.indexOf(colSource);

  // Buckets: { "2026-01": { labor: 0, revenue: 0 } }
  var buckets = {};

  data.rows.forEach(function (row) {
    var monthRaw = row[monthIdx];
    var amount = parseFloat(row[amountIdx]) || 0;
    var category = row[categoryIdx];
    var source = row[sourceIdx];

    // Filter: ACTUAL source only
    if (source !== sourceFilter) return;

    // Filter: current year only
    var dateStr = String(monthRaw);
    var year = parseInt(dateStr.substring(0, 4), 10);
    if (year !== currentYear) return;

    // Create month key like "2026-01"
    var monthKey = dateStr.substring(0, 7);

    if (!buckets[monthKey]) {
      buckets[monthKey] = { labor: 0, revenue: 0 };
    }

    // Categorize amounts
    if (laborCategories.indexOf(category) !== -1) {
      buckets[monthKey].labor += amount;
    } else if (category === revenueCategory) {
      buckets[monthKey].revenue += amount;
    }
  });

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

    // DL % = Labor $ / Revenue * 100
    var dlPct = revenue !== 0 ? (labor / revenue) * 100 : 0;
    dlPercents.push(parseFloat(dlPct.toFixed(2)));
  });

  return {
    months: months,
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

  var ctx = document.getElementById("trendChart").getContext("2d");

  new Chart(ctx, {
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
    }
  });
}
