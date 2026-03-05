/* Debug v10: dig into /data/v1/{uuid} which returns 400 */
(function () {
  var out = document.getElementById('loader');
  out.innerHTML = '<p style="font-weight:bold">Debug v10 - /data/v1/{uuid} deep probe</p>';

  function log(msg) {
    console.log(msg);
    var p = document.createElement('p');
    p.style.cssText = 'font-size:10px;margin:1px 0;font-family:monospace;word-break:break-all;white-space:pre-wrap;';
    p.textContent = typeof msg === 'string' ? msg : JSON.stringify(msg);
    out.appendChild(p);
  }

  var token = window.__RYUU_AUTHENTICATION_TOKEN__;
  var dsId = '6c5e3f1b-56c4-4273-98ec-4af164645cfa';
  var base = '/data/v1/' + dsId;

  function tryReq(label, method, url, hdrs, body) {
    return new Promise(function (resolve) {
      var xhr = new XMLHttpRequest();
      xhr.open(method, url, true);
      if (hdrs) {
        for (var k in hdrs) { try { xhr.setRequestHeader(k, hdrs[k]); } catch(e){} }
      }
      xhr.timeout = 6000;
      xhr.onload = function () {
        log(xhr.status + ' [' + method + '] ' + label);
        log('  → ' + (xhr.responseText || '').substring(0, 400));
        resolve(xhr);
      };
      xhr.onerror = function () { log('ERR ' + label); resolve(null); };
      xhr.ontimeout = function () { log('TMO ' + label); resolve(null); };
      xhr.send(body || null);
    });
  }

  // First: see what the 400 error body says
  tryReq('bare GET', 'GET', base, {})
  .then(function () {
    // Add auth
    return tryReq('GET+auth', 'GET', base, {
      'x-domo-authentication': token
    });
  })
  .then(function () {
    return tryReq('GET+auth+json', 'GET', base, {
      'x-domo-authentication': token,
      'Accept': 'application/json'
    });
  })
  .then(function () {
    return tryReq('GET+bearer', 'GET', base, {
      'Authorization': 'Bearer ' + token
    });
  })
  .then(function () {
    // Try with query params
    return tryReq('GET+auth+limit', 'GET', base + '?limit=5', {
      'x-domo-authentication': token,
      'Accept': 'application/json'
    });
  })
  .then(function () {
    // Try with SQL
    var sql = encodeURIComponent('SELECT * LIMIT 5');
    return tryReq('GET+auth+sql', 'GET', base + '?query=' + sql, {
      'x-domo-authentication': token,
      'Accept': 'application/json'
    });
  })
  .then(function () {
    // Try POST
    return tryReq('POST+auth', 'POST', base, {
      'x-domo-authentication': token,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }, JSON.stringify({ query: 'SELECT * LIMIT 5' }));
  })
  .then(function () {
    // Try POST with SQL body
    return tryReq('POST+sql-text', 'POST', base, {
      'x-domo-authentication': token,
      'Content-Type': 'text/plain',
      'Accept': 'application/json'
    }, 'SELECT * LIMIT 5');
  })
  .then(function () {
    // Try with includeHeader
    return tryReq('GET+includeHeader', 'GET', base + '?includeHeader=true&limit=5', {
      'x-domo-authentication': token,
      'Accept': 'text/csv'
    });
  })
  .then(function () {
    // Try text/csv accept
    return tryReq('GET+csv', 'GET', base, {
      'x-domo-authentication': token,
      'Accept': 'text/csv'
    });
  })
  .then(function () {
    // Try Accept: */*
    return tryReq('GET+star', 'GET', base, {
      'x-domo-authentication': token,
      'Accept': '*/*'
    });
  })
  .then(function () {
    // Try no Accept header at all, just auth
    return tryReq('GET+auth-only', 'GET', base, {
      'x-domo-authentication': token
    });
  })
  .then(function () {
    log('=== DONE ===');
  });
})();
