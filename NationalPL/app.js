/* Debug v5: try XMLHttpRequest and different fetch modes */
(function () {
  var out = document.getElementById('loader');
  out.innerHTML = '<p style="font-weight:bold">Debug v5</p>';

  function log(msg) {
    console.log(msg);
    var p = document.createElement('p');
    p.style.cssText = 'font-size:11px;margin:2px 0;font-family:monospace;word-break:break-all;white-space:pre-wrap;';
    p.textContent = typeof msg === 'string' ? msg : JSON.stringify(msg);
    out.appendChild(p);
  }

  /* ── Method 1: XMLHttpRequest (sync-ish) ── */
  log('=== Method 1: XMLHttpRequest ===');
  try {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/data/v1/dataset', true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        log('XHR status: ' + xhr.status);
        log('XHR responseText length: ' + (xhr.responseText ? xhr.responseText.length : 'null'));
        log('XHR first 500: ' + (xhr.responseText || '').substring(0, 500));
        if (xhr.responseText && xhr.responseText.length > 0) {
          try {
            var data = JSON.parse(xhr.responseText);
            if (Array.isArray(data)) {
              log('XHR: array of ' + data.length + ' rows');
              if (data.length > 0) {
                log('XHR keys: ' + Object.keys(data[0]).join(', '));
                log('XHR row 0: ' + JSON.stringify(data[0]));
              }
            } else {
              log('XHR: object with keys: ' + Object.keys(data).join(', '));
              log('XHR data: ' + JSON.stringify(data).substring(0, 500));
            }
          } catch (e) {
            log('XHR parse error: ' + e.message);
          }
        }
      }
    };
    xhr.onerror = function () {
      log('XHR onerror fired');
    };
    xhr.send();
  } catch (e) {
    log('XHR exception: ' + e.message);
  }

  /* ── Method 2: fetch with mode/credentials ── */
  log('=== Method 2: fetch same-origin ===');
  fetch('/data/v1/dataset', {
    mode: 'same-origin',
    credentials: 'same-origin'
  }).then(function (r) {
    log('fetch2 status: ' + r.status);
    return r.json();
  }).then(function (data) {
    if (Array.isArray(data)) {
      log('fetch2: array of ' + data.length + ' rows');
      if (data.length > 0) {
        log('fetch2 keys: ' + Object.keys(data[0]).join(', '));
        log('fetch2 row 0: ' + JSON.stringify(data[0]));
      }
    } else {
      log('fetch2: object keys: ' + Object.keys(data).join(', '));
      log('fetch2 data: ' + JSON.stringify(data).substring(0, 500));
    }
  }).catch(function (e) {
    log('fetch2 error: ' + e.message);
  });

  /* ── Method 3: listen for postMessage from parent ── */
  log('=== Method 3: listening for postMessage ===');
  window.addEventListener('message', function (event) {
    log('postMessage received!');
    log('origin: ' + event.origin);
    log('data type: ' + typeof event.data);
    if (typeof event.data === 'string') {
      log('data (first 500): ' + event.data.substring(0, 500));
    } else {
      log('data keys: ' + Object.keys(event.data || {}).join(', '));
      log('data: ' + JSON.stringify(event.data).substring(0, 500));
    }
  });

  /* ── Method 4: try requesting data from parent via postMessage ── */
  log('=== Method 4: postMessage to parent ===');
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'getData',
        alias: 'dataset'
      }, '*');
      log('Sent postMessage to parent');
    } else {
      log('No parent frame');
    }
  } catch (e) {
    log('postMessage to parent error: ' + e.message);
  }
})();
