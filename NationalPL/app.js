/* Debug v9: find the correct ryuu API path */
(function () {
  var out = document.getElementById('loader');
  out.innerHTML = '<p style="font-weight:bold">Debug v9 - find ryuu data path</p>';

  function log(msg) {
    console.log(msg);
    var p = document.createElement('p');
    p.style.cssText = 'font-size:10px;margin:1px 0;font-family:monospace;word-break:break-all;white-space:pre-wrap;';
    p.textContent = typeof msg === 'string' ? msg : JSON.stringify(msg);
    out.appendChild(p);
  }

  var token = window.__RYUU_AUTHENTICATION_TOKEN__;
  var dsId = '6c5e3f1b-56c4-4273-98ec-4af164645cfa';
  var headers = {
    'x-domo-authentication': token,
    'Accept': 'application/json'
  };

  function tryXHR(label, url) {
    return new Promise(function (resolve) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      for (var k in headers) { try { xhr.setRequestHeader(k, headers[k]); } catch(e){} }
      xhr.timeout = 5000;
      xhr.onload = function () {
        var status = xhr.status;
        var body = (xhr.responseText || '').substring(0, 200);
        var marker = status === 200 ? 'OK' : status === 404 ? '404' : status;
        log(marker + ' ' + label + ' → ' + url);
        if (status === 200) {
          log('  BODY: ' + body);
          try {
            var data = JSON.parse(xhr.responseText);
            if (Array.isArray(data)) {
              log('  ARRAY of ' + data.length + ' rows!');
              if (data.length > 0) {
                log('  KEYS: ' + Object.keys(data[0]).join(', '));
                log('  ROW0: ' + JSON.stringify(data[0]).substring(0, 300));
              }
            } else {
              log('  OBJ KEYS: ' + Object.keys(data).join(', '));
            }
          } catch(e) {}
        }
        resolve();
      };
      xhr.onerror = function () { log('ERR ' + label); resolve(); };
      xhr.ontimeout = function () { log('TMO ' + label); resolve(); };
      xhr.send();
    });
  }

  // Systematic path exploration
  var paths = [
    // /api/ prefix variations
    '/api/data/v1/dataset',
    '/api/data/v1/' + dsId,
    '/api/v1/data/dataset',
    '/api/v1/dataset',
    '/api/dataset',
    '/api/query/v1/execute/' + dsId,
    // /domo/ prefix
    '/domo/data/v1/dataset',
    '/domo/data/v1/' + dsId,
    // direct /data/ with auth (retry - maybe auth makes it work)
    '/data/v1/dataset',
    '/data/v1/' + dsId,
    '/data/v2/dataset',
    // /sql/ prefix
    '/sql/v1/' + dsId,
    // Other common patterns
    '/datasets/' + dsId + '/data',
    '/datasets/dataset/data',
    '/v1/datasets/' + dsId + '/data',
    // Phoenix brick patterns
    '/phoenix/data/dataset',
    '/brick/data/dataset',
    // Check what paths exist
    '/api',
    '/api/',
    '/api/v1',
  ];

  var i = 0;
  function next() {
    if (i >= paths.length) {
      log('=== DONE: tested ' + paths.length + ' paths ===');
      return;
    }
    tryXHR('path' + i, paths[i]).then(function () {
      i++;
      next();
    });
  }

  log('Testing ' + paths.length + ' path variations...');
  next();
})();
