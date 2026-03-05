/* Debug v11: /data/v1/dataset with limits and long timeout */
(function () {
  var out = document.getElementById('loader');
  out.innerHTML = '<p style="font-weight:bold">Debug v11 - dataset alias with limits</p>';

  function log(msg) {
    console.log(msg);
    var p = document.createElement('p');
    p.style.cssText = 'font-size:10px;margin:1px 0;font-family:monospace;word-break:break-all;white-space:pre-wrap;';
    p.textContent = typeof msg === 'string' ? msg : JSON.stringify(msg);
    out.appendChild(p);
  }

  function tryReq(label, url, timeout) {
    return new Promise(function (resolve) {
      log('>>> ' + label + ': ' + url);
      var start = Date.now();
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.timeout = timeout || 30000;
      xhr.onload = function () {
        var elapsed = ((Date.now() - start) / 1000).toFixed(1);
        log(label + ' → ' + xhr.status + ' in ' + elapsed + 's, ' + (xhr.responseText||'').length + ' bytes');
        if (xhr.status === 200 && xhr.responseText) {
          log(label + ' FIRST 800: ' + xhr.responseText.substring(0, 800));
          try {
            var data = JSON.parse(xhr.responseText);
            if (Array.isArray(data)) {
              log(label + ': ARRAY ' + data.length + ' rows');
              if (data.length > 0) {
                log('KEYS: ' + Object.keys(data[0]).join(', '));
                log('ROW0: ' + JSON.stringify(data[0]));
                if (data.length > 1) log('ROW1: ' + JSON.stringify(data[1]));
              }
            } else {
              log(label + ': OBJECT keys=' + Object.keys(data).join(', '));
              for (var k in data) {
                var v = data[k];
                if (Array.isArray(v)) log('  ' + k + ': array[' + v.length + ']');
                else log('  ' + k + ': ' + JSON.stringify(v).substring(0, 200));
              }
            }
          } catch(e) { log('parse err: ' + e.message); }
        } else if (xhr.status !== 200) {
          log(label + ' body: ' + (xhr.responseText||'').substring(0, 300));
        }
        resolve();
      };
      xhr.onerror = function () {
        log(label + ' ERROR after ' + ((Date.now()-start)/1000).toFixed(1) + 's');
        resolve();
      };
      xhr.ontimeout = function () {
        log(label + ' TIMEOUT after ' + ((Date.now()-start)/1000).toFixed(1) + 's');
        resolve();
      };
      xhr.send();
    });
  }

  // Try the alias "dataset" with various query/limit params
  tryReq('sql-limit3', '/data/v1/dataset?query=' + encodeURIComponent('SELECT * FROM dataset LIMIT 3'), 30000)
  .then(function () {
    return tryReq('limit-param', '/data/v1/dataset?limit=3', 30000);
  })
  .then(function () {
    return tryReq('fields-limit', '/data/v1/dataset?fields=MONTH,AMOUNT&limit=3', 30000);
  })
  .then(function () {
    return tryReq('sql-count', '/data/v1/dataset?query=' + encodeURIComponent('SELECT COUNT(*) FROM dataset'), 30000);
  })
  .then(function () {
    // Long timeout on plain fetch - maybe it just takes >8s
    return tryReq('plain-30s', '/data/v1/dataset', 45000);
  })
  .then(function () {
    log('=== DONE ===');
  });
})();
