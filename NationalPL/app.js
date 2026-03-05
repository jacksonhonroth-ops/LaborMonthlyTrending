/* Debug v7: use RYUU auth token for data fetch */
(function () {
  var out = document.getElementById('loader');
  out.innerHTML = '<p style="font-weight:bold">Debug v7 - authenticated fetch</p>';

  function log(msg) {
    console.log(msg);
    var p = document.createElement('p');
    p.style.cssText = 'font-size:10px;margin:1px 0;font-family:monospace;word-break:break-all;white-space:pre-wrap;';
    p.textContent = typeof msg === 'string' ? msg : JSON.stringify(msg);
    out.appendChild(p);
  }

  var token = window.__RYUU_AUTHENTICATION_TOKEN__;
  var sid = window.__RYUU_SID__;
  log('Token: ' + (token ? token.substring(0, 50) + '...' : 'MISSING'));
  log('SID: ' + (sid || 'MISSING'));

  function tryXHR(label, url, headers) {
    return new Promise(function (resolve) {
      log('--- ' + label + ' ---');
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      if (headers) {
        for (var k in headers) {
          xhr.setRequestHeader(k, headers[k]);
        }
      }
      xhr.timeout = 8000;
      xhr.onload = function () {
        log(label + ' status: ' + xhr.status);
        log(label + ' response length: ' + (xhr.responseText || '').length);
        log(label + ' body (first 500): ' + (xhr.responseText || '').substring(0, 500));
        if (xhr.responseText) {
          try {
            var data = JSON.parse(xhr.responseText);
            if (Array.isArray(data)) {
              log(label + ': ARRAY of ' + data.length + ' rows');
              if (data.length > 0) {
                log(label + ' keys: ' + Object.keys(data[0]).join(', '));
                log(label + ' row[0]: ' + JSON.stringify(data[0]).substring(0, 300));
              }
            } else {
              log(label + ': OBJECT keys: ' + Object.keys(data).join(', '));
            }
          } catch (e) {
            log(label + ' not JSON');
          }
        }
        resolve();
      };
      xhr.onerror = function () { log(label + ' XHR error'); resolve(); };
      xhr.ontimeout = function () { log(label + ' XHR timeout (8s)'); resolve(); };
      xhr.send();
    });
  }

  // Try various auth header patterns
  tryXHR('bearer', '/data/v1/dataset', {
    'Authorization': 'Bearer ' + token
  })
  .then(function () {
    return tryXHR('x-domo-auth', '/data/v1/dataset', {
      'x-domo-authentication': token
    });
  })
  .then(function () {
    return tryXHR('x-domo-auth+accept', '/data/v1/dataset', {
      'x-domo-authentication': token,
      'Accept': 'application/json'
    });
  })
  .then(function () {
    return tryXHR('ryuu-token', '/data/v1/dataset', {
      'x-ryuu-token': token
    });
  })
  .then(function () {
    return tryXHR('cookie-sid', '/data/v1/dataset', {
      'x-domo-authentication': token,
      'x-ryuu-sid': sid
    });
  })
  .then(function () {
    // Also try SQL query with auth
    var sql = encodeURIComponent('SELECT * FROM dataset LIMIT 3');
    return tryXHR('sql+auth', '/data/v1/dataset?query=' + sql, {
      'x-domo-authentication': token,
      'Accept': 'application/json'
    });
  })
  .then(function () {
    log('=== ALL DONE ===');
  });
})();
