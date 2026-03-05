/* Debug v3: dump raw responses from every endpoint variation */
(function () {
  var out = document.getElementById('loader');

  function log(msg) {
    console.log(msg);
    var p = document.createElement('p');
    p.style.cssText = 'font-size:11px;margin:2px 0;font-family:monospace;word-break:break-all;';
    p.textContent = msg;
    out.appendChild(p);
  }

  function tryFetch(label, url, headers) {
    log('--- ' + label + ' ---');
    log('URL: ' + url);
    return fetch(url, { headers: headers || {} })
      .then(function (r) {
        log(label + ' status: ' + r.status + ' ' + r.statusText);
        log(label + ' content-type: ' + r.headers.get('content-type'));
        return r.text();
      })
      .then(function (text) {
        log(label + ' length: ' + text.length);
        log(label + ' body (first 500): ' + text.substring(0, 500));
        // Try to parse as JSON to check structure
        try {
          var json = JSON.parse(text);
          log(label + ' type: ' + typeof json);
          if (Array.isArray(json)) {
            log(label + ' array length: ' + json.length);
            if (json.length > 0) {
              log(label + ' first row keys: ' + Object.keys(json[0]).join(', '));
              log(label + ' first row: ' + JSON.stringify(json[0]));
              if (json.length > 1) log(label + ' 2nd row: ' + JSON.stringify(json[1]));
            }
          } else if (typeof json === 'object') {
            log(label + ' keys: ' + Object.keys(json).join(', '));
            // Check for nested data
            for (var k in json) {
              var v = json[k];
              if (Array.isArray(v)) {
                log(label + ' json.' + k + ' is array, length=' + v.length);
                if (v.length > 0) {
                  log(label + ' json.' + k + '[0]: ' + JSON.stringify(v[0]).substring(0, 200));
                }
              } else {
                log(label + ' json.' + k + ' = ' + JSON.stringify(v).substring(0, 100));
              }
            }
          }
        } catch (e) {
          log(label + ' not JSON: ' + e.message);
        }
      })
      .catch(function (err) {
        log(label + ' ERROR: ' + err.message);
      });
  }

  // Clear spinner
  out.innerHTML = '<p style="font-weight:bold;font-size:13px;">Debug v3 - Raw Response Dump</p>';

  // Try various endpoint patterns
  Promise.resolve()
    .then(function () {
      return tryFetch('plain', '/data/v1/dataset');
    })
    .then(function () {
      return tryFetch('json-header', '/data/v1/dataset', { 'Accept': 'application/json' });
    })
    .then(function () {
      return tryFetch('sql-select-all', '/data/v1/dataset?query=' + encodeURIComponent('SELECT * FROM dataset LIMIT 5'));
    })
    .then(function () {
      return tryFetch('sql-simple', '/data/v1/dataset?query=' + encodeURIComponent('SELECT MONTH, AMOUNT, PLCategoryName, SOURCE FROM dataset LIMIT 5'));
    })
    .then(function () {
      return tryFetch('fields-param', '/data/v1/dataset?fields=MONTH,AMOUNT,PLCategoryName,SOURCE&limit=5');
    })
    .then(function () {
      return tryFetch('no-alias', '/data/v1');
    })
    .then(function () {
      log('=== DONE ===');
    });
})();
