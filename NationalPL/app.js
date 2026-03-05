/* ================================================================
   National P&L – DOMO Pro Code Card  (DEBUG / MINIMAL VERSION)
   Step 1: Confirm domo.js loads and data fetches successfully
   ================================================================ */

// Debug: log what globals are available
console.log('app.js loaded');
console.log('typeof domo:', typeof domo);

if (typeof domo === 'undefined') {
  document.getElementById('loader').innerHTML =
    '<span style="color:#d32f2f;">domo is not defined. domo.js did not load.</span>';
} else {
  console.log('domo object:', domo);
  document.getElementById('loader').innerHTML =
    '<span>domo.js loaded OK. Fetching data...</span>';

  domo.get('/data/v1/dataset', { format: 'array-of-arrays' })
    .then(function(data) {
      console.log('Data received:', data);
      var msg = 'Data loaded! ';
      if (data && data.columns) {
        msg += 'Columns: ' + data.columns.join(', ') + '. ';
        msg += 'Rows: ' + (data.rows ? data.rows.length : 0);
      } else if (Array.isArray(data)) {
        msg += 'Array format, ' + data.length + ' rows. ';
        if (data.length > 0) msg += 'First row keys: ' + Object.keys(data[0]).join(', ');
      } else {
        msg += JSON.stringify(data).substring(0, 500);
      }
      document.getElementById('loader').innerHTML =
        '<span style="color:#2e7d32;">' + msg + '</span>';
    })
    .catch(function(err) {
      console.error('Data fetch error:', err);
      document.getElementById('loader').innerHTML =
        '<span style="color:#d32f2f;">Error: ' + (err.message || JSON.stringify(err)) + '</span>';
    });
}
