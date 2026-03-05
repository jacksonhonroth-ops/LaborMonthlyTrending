/* ================================================================
   National P&L – DOMO Pro Code Card  (DEBUG v2)
   Try multiple methods to load data from DOMO
   ================================================================ */

console.log('app.js loaded');
console.log('typeof domo:', typeof domo);
console.log('window.location:', window.location.href);

var loader = document.getElementById('loader');

function log(msg, color) {
  console.log(msg);
  var p = document.createElement('p');
  p.style.color = color || '#333';
  p.style.fontSize = '12px';
  p.style.margin = '4px 0';
  p.textContent = msg;
  loader.appendChild(p);
}

// Log all scripts on the page
var scripts = document.querySelectorAll('script');
for (var i = 0; i < scripts.length; i++) {
  log('Script ' + i + ': ' + (scripts[i].src || '(inline)'));
}

// Check for domo global
log('typeof domo: ' + typeof domo, typeof domo !== 'undefined' ? '#2e7d32' : '#d32f2f');

// Check for other DOMO globals
log('typeof domoBridge: ' + typeof domoBridge);
log('typeof DomoPhoenix: ' + typeof DomoPhoenix);

// Try to list all window properties that might be DOMO-related
var domoProps = [];
for (var key in window) {
  if (key.toLowerCase().indexOf('domo') >= 0 || key.toLowerCase().indexOf('phoenix') >= 0) {
    domoProps.push(key);
  }
}
log('DOMO-related window props: ' + (domoProps.length ? domoProps.join(', ') : 'NONE'), domoProps.length ? '#2e7d32' : '#d32f2f');

// Try fetch directly
log('Trying fetch /data/v1/dataset ...', '#1565c0');
fetch('/data/v1/dataset')
  .then(function(resp) {
    log('fetch /data/v1/dataset status: ' + resp.status, resp.ok ? '#2e7d32' : '#d32f2f');
    return resp.text();
  })
  .then(function(text) {
    log('Response (first 300 chars): ' + text.substring(0, 300));
  })
  .catch(function(err) {
    log('fetch /data/v1/dataset error: ' + err.message, '#d32f2f');
  });

// Also try the v2 endpoint
fetch('/data/v2/dataset')
  .then(function(resp) {
    log('fetch /data/v2/dataset status: ' + resp.status, resp.ok ? '#2e7d32' : '#d32f2f');
    return resp.text();
  })
  .then(function(text) {
    log('v2 Response (first 300 chars): ' + text.substring(0, 300));
  })
  .catch(function(err) {
    log('fetch /data/v2/dataset error: ' + err.message, '#d32f2f');
  });

// Try fetching domo.js to see what happens
fetch('domo.js')
  .then(function(resp) {
    log('fetch domo.js status: ' + resp.status, resp.ok ? '#2e7d32' : '#d32f2f');
    return resp.text();
  })
  .then(function(text) {
    log('domo.js content (first 200 chars): ' + text.substring(0, 200));
  })
  .catch(function(err) {
    log('fetch domo.js error: ' + err.message, '#d32f2f');
  });
