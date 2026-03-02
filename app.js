/*
 * Developer Best Practices & Security Guidelines
 *
 * 1. Code Quality:
 *    - Follow SOLID principles for clean and maintainable code.
 *    - Use consistent naming conventions and meaningful variable names.
 *    - Keep your code DRY (Don’t Repeat Yourself) by reusing logic.
 *    - Write unit tests to ensure code reliability and maintain high coverage.
 *
 * 2. Security:
 *    - Validate and sanitize all user inputs to prevent common attacks.
 *    - Implement secure authentication and session management practices.
 *    - Encrypt sensitive data both at rest and in transit.
 *    - Follow the principle of least privilege in access control.
 *    - Regularly update dependencies and apply security patches.
 *
 * 3. Performance:
 *    - Optimize critical code paths for performance.
 *    - Implement caching and lazy loading to improve responsiveness.
 *
 * 4. Version Control:
 *    - Follow a clear branching strategy (e.g., Git Flow).
 *    - Use descriptive commit messages and conduct code reviews before merging.
 *
 * For more information on secure coding practices, visit: https://owasp.org/
 */

//Step 1. Select a dataset in the manifest editor

//Step 2. Style your chart using the following properties
//--------------------------------------------------
// Properties
//--------------------------------------------------

var barType = "Horizontal"; //"Vertical", "Horizontal"
var totalSort = "Descending"; //"None", "Ascending", "Descending", "A-Z", "Z-A"
var suppressMinMaxAvgLines = true;
var valueFormat = "Default"; //"Currency", "Percentage", "Number"
var valDecimalPlaces = "Default"; //"None", ".0", ".00", ".000", ".0000", ".00000"
var dataLabelText = "%_VALUE"; //"%_VALUE"
var chartMargin = 20; //space to leave around chart (in pixels)
var enableFiltering = true; //set to false to disable page filtering (cardbus)

//--------------------------------------------------
// For ultimate flexibility, modify the code below!
//--------------------------------------------------

//Available globals
var datasets = ["dataset"];
var chartContainer = document.getElementById("myDiv"); //get "myDiv" from the html tab

//Data Column Names
var dataNameColumnName = "Name";
var dataValueColumnName = "Value";

// Form the data query: https://developer.domo.com/docs/dev-studio-guides/data-queries
var fields = [dataNameColumnName, dataValueColumnName];
var groupby = [dataNameColumnName];
var query = `/data/v1/${datasets[0]}?fields=${fields.join()}&groupby=${groupby.join()}`;

//Get the data and chart it
/**
 * Replace line 47 with line 46 once you have added a dataset with the alias "dataset" to the manifest.
 */
// domo.get(query, { format: "array-of-arrays" })
domo.get('./data.json')
  .then(function (data) {
    chartIt(data);
  });

var chart = null;
var cardBus = new CardBus();
function chartIt(data) {
  // Read more about data types and mappings here: https://domoapps.github.io/domo-phoenix/#/domo-phoenix/api
  var columns = [
    {
      type: DomoPhoenix.DATA_TYPE.STRING,
      name: data.columns[0],
      mapping: DomoPhoenix.MAPPING.ITEM,
    },
    {
      type: DomoPhoenix.DATA_TYPE.DOUBLE,
      name: data.columns[1],
      mapping: DomoPhoenix.MAPPING.VALUE,
      format: getValueFormat(),
    },
  ];

  var domoBarType = DomoPhoenix.CHART_TYPE.HORIZ_BAR;
  if (barType.toLowerCase() == "vertical")
    domoBarType = DomoPhoenix.CHART_TYPE.BAR;

  var propertyOverrides = {
    total_sort: totalSort,
    suppress_minmaxavg: suppressMinMaxAvgLines,
    datalabel_text:
      dataLabelText && dataLabelText.length ? dataLabelText : undefined,
  };

  // Set your "Chart Options": https://domoapps.github.io/domo-phoenix/#/domo-phoenix/api
  var size = getChartSize();
  var options = {
    width: size.width,
    height: size.height,
    properties: propertyOverrides,
  };

  // Create the Phoenix Chart
  var phoenixData = { columns: columns, rows: data.rows };
  chart = new DomoPhoenix.Chart(domoBarType, phoenixData, options);

  // Append the canvas element to your div
  chartContainer.appendChild(chart.canvas);
  chartContainer.style.margin = chartMargin + "px";

  // Handle click events
  enableFiltering && cardBus.addChart(chart);

  // Render the chart when you're ready for the user to see it
  chart.render();
}

function getValueFormat() {
  var valFmt = "###,###";
  if (
    valDecimalPlaces.toLowerCase() != "default" &&
    valDecimalPlaces.toLowerCase() != "none"
  )
    valFmt += valDecimalPlaces;
  if (valueFormat.toLowerCase() == "currency") valFmt = "$" + valFmt;
  else if (valueFormat.toLowerCase() == "percentage") valFmt += "%";
  return valFmt;
}

function getChartSize() {
  return {
    width: window.innerWidth - chartMargin * 2,
    height: window.innerHeight - chartMargin * 2,
  };
}

window.addEventListener &&
  window.addEventListener("resize", function () {
    var size = getChartSize();
    chart && chart.resize(size.width, size.height);
  });

function CardBus() {
  var charts = [];

  function triggerBus(srcChart, ev) {
    charts.forEach((chart) => {
      if (srcChart == chart) {
        var isHighlightEvent = ev.highlight !== undefined;
        var isDrillEvent = ev.applyfilters !== undefined;
        if (isHighlightEvent) {
          var filters = ev.highlight;
          chart.highlight(filters);
        }
        if (isDrillEvent) {
          var filters = ev.applyfilters;
          console && console.log("Drill event", filters);
          if (filters != null) {
            for (var i = 0; i < filters.length; i++) {
              filters[i].operator = filters[i].operand;
            }
          }
          domo.filterContainer(filters);
        }
      }
    });
  }

  function addChart(chart) {
    charts.push(chart);
    chart.addEventListener("cardbus", (ev) => triggerBus(chart, ev));
  }

  return {
    addChart: addChart,
    triggerBus: triggerBus,
  };
}
