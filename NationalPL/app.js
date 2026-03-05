/* Debug v4: single minimal fetch with error handling */
(function () {
  var out = document.getElementById('loader');
  out.innerHTML = '<p style="font-weight:bold">Debug v4</p>';

  function log(msg) {
    console.log(msg);
    var p = document.createElement('p');
    p.style.cssText = 'font-size:11px;margin:2px 0;font-family:monospace;word-break:break-all;white-space:pre-wrap;';
    p.textContent = msg;
    out.appendChild(p);
  }

  log('Starting fetch...');

  var controller = new AbortController();
  setTimeout(function () { controller.abort(); }, 10000);

  fetch('/data/v1/dataset', { signal: controller.signal })
    .then(function (r) {
      log('Status: ' + r.status);
      log('Content-Type: ' + r.headers.get('content-type'));
      return r.text();
    })
    .then(function (text) {
      log('Response length: ' + text.length);
      log('First 1000 chars:');
      log(text.substring(0, 1000));
      if (text.length > 1000) {
        log('... (truncated, total ' + text.length + ' chars)');
      }
    })
    .catch(function (err) {
      log('FETCH ERROR: ' + err.name + ': ' + err.message);
    });
})();
