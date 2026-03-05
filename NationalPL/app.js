/* Debug v8: try DOMO main API directly */
(function () {
  var out = document.getElementById('loader');
  out.innerHTML = '<p style="font-weight:bold">Debug v8 - direct DOMO API</p>';

  function log(msg) {
    console.log(msg);
    var p = document.createElement('p');
    p.style.cssText = 'font-size:10px;margin:1px 0;font-family:monospace;word-break:break-all;white-space:pre-wrap;';
    p.textContent = typeof msg === 'string' ? msg : JSON.stringify(msg);
    out.appendChild(p);
  }

  var token = window.__RYUU_AUTHENTICATION_TOKEN__;
  var params = new URLSearchParams(window.location.search);
  var customer = params.get('customer') || params.get('USER_GROUP');
  log('Customer/instance: ' + customer);

  var datasetId = '6c5e3f1b-56c4-4273-98ec-4af164645cfa';

  function tryXHR(label, url, headers) {
    return new Promise(function (resolve) {
      log('--- ' + label + ' ---');
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      if (headers) {
        for (var k in headers) {
          try { xhr.setRequestHeader(k, headers[k]); } catch(e) { log('  header error: ' + e.message); }
        }
      }
      xhr.timeout = 6000;
      xhr.onload = function () {
        log(label + ' status: ' + xhr.status);
        var body = (xhr.responseText || '').substring(0, 400);
        log(label + ' body: ' + body);
        if (xhr.status === 200 && xhr.responseText) {
          try {
            var data = JSON.parse(xhr.responseText);
            if (Array.isArray(data)) {
              log(label + ': SUCCESS! Array of ' + data.length + ' rows');
              if (data.length > 0) log(label + ' keys: ' + Object.keys(data[0]).join(', '));
              if (data.length > 0) log(label + ' row0: ' + JSON.stringify(data[0]).substring(0, 300));
            } else {
              log(label + ': object keys=' + Object.keys(data).join(', '));
            }
          } catch(e) {}
        }
        resolve();
      };
      xhr.onerror = function () { log(label + ' error (CORS?)'); resolve(); };
      xhr.ontimeout = function () { log(label + ' timeout'); resolve(); };
      xhr.send();
    });
  }

  var domoBase = 'https://' + customer + '.domo.com';
  log('DOMO base: ' + domoBase);

  // Try paths on the app's own domain first (non /data/v1/)
  tryXHR('app-root', '/', {})
  .then(function () {
    return tryXHR('app-api', '/api/data/v1/' + datasetId, {
      'x-domo-authentication': token,
      'Accept': 'application/json'
    });
  })
  .then(function () {
    // Try DOMO main instance
    return tryXHR('domo-query', domoBase + '/api/query/v1/execute/' + datasetId, {
      'x-domo-authentication': token,
      'Accept': 'application/json'
    });
  })
  .then(function () {
    return tryXHR('domo-data', domoBase + '/api/data/v1/' + datasetId + '?includeHeader=true&limit=5', {
      'x-domo-authentication': token,
      'Accept': 'application/json'
    });
  })
  .then(function () {
    return tryXHR('domo-sql', domoBase + '/sql/v1/' + datasetId, {
      'x-domo-authentication': token,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    });
  })
  .then(function () {
    // Try without custom headers (rely on cookies)
    return tryXHR('domo-data-nocreds', domoBase + '/api/data/v1/' + datasetId + '?includeHeader=true&limit=5', {
      'Accept': 'application/json'
    });
  })
  .then(function () {
    // Try fetch with credentials: include to send cookies cross-origin
    log('--- fetch-with-cookies ---');
    return fetch(domoBase + '/api/data/v1/' + datasetId + '?includeHeader=true&limit=5', {
      credentials: 'include',
      headers: { 'Accept': 'application/json' }
    }).then(function (r) {
      log('fetch-with-cookies status: ' + r.status);
      return r.text();
    }).then(function (t) {
      log('fetch-with-cookies body: ' + t.substring(0, 400));
    }).catch(function (e) {
      log('fetch-with-cookies error: ' + e.message);
    });
  })
  .then(function () {
    log('=== ALL DONE ===');
  });
})();
