/* Debug v6: brute-force discover the DOMO postMessage protocol */
(function () {
  var out = document.getElementById('loader');
  out.innerHTML = '<p style="font-weight:bold">Debug v6 - postMessage protocol discovery</p>';

  function log(msg) {
    console.log(msg);
    var p = document.createElement('p');
    p.style.cssText = 'font-size:10px;margin:1px 0;font-family:monospace;word-break:break-all;white-space:pre-wrap;';
    p.textContent = typeof msg === 'string' ? msg : JSON.stringify(msg);
    out.appendChild(p);
  }

  /* Listen for ALL messages from parent */
  var msgCount = 0;
  window.addEventListener('message', function (event) {
    msgCount++;
    log('MSG #' + msgCount + ' from: ' + event.origin);
    var d = event.data;
    if (typeof d === 'string') {
      log('  string (' + d.length + '): ' + d.substring(0, 300));
      try { d = JSON.parse(d); } catch(e) { return; }
    }
    if (d && typeof d === 'object') {
      log('  keys: ' + Object.keys(d).join(', '));
      log('  json: ' + JSON.stringify(d).substring(0, 500));
    }
  });

  /* Try various postMessage formats that DOMO might use */
  var formats = [
    // ryuu protocol
    { __ryuu: true, method: 'GET', url: '/data/v1/dataset' },
    { __ryuu: true, method: 'GET', url: '/data/v1/dataset', channel: 'data' },
    // domo.get style
    { type: 'domo.get', alias: 'dataset' },
    { type: 'domo-get', alias: 'dataset' },
    { channel: 'data', method: 'GET', url: '/data/v1/dataset' },
    // request/response pattern
    { request: 'data', alias: 'dataset', id: 'req1' },
    { action: 'getData', datasetAlias: 'dataset', id: 'req2' },
    // Phoenix brick protocol
    { type: 'getCardData' },
    { type: 'requestData', datasetId: '6c5e3f1b-56c4-4273-98ec-4af164645cfa' },
    // DDX custom app protocol
    { type: 'getData', dataSetId: '6c5e3f1b-56c4-4273-98ec-4af164645cfa' },
    // Generic
    'getData',
    'getCardData',
    JSON.stringify({ type: 'getData', alias: 'dataset' })
  ];

  log('Sending ' + formats.length + ' message formats to parent...');
  formats.forEach(function (msg, i) {
    try {
      window.parent.postMessage(msg, '*');
      log('Sent #' + i + ': ' + JSON.stringify(msg).substring(0, 100));
    } catch (e) {
      log('Send #' + i + ' error: ' + e.message);
    }
  });

  /* Also check: is there a service worker? */
  log('=== Service Worker check ===');
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      log('Service workers: ' + regs.length);
      regs.forEach(function (r, i) {
        log('SW ' + i + ': scope=' + r.scope + ' active=' + (r.active ? r.active.scriptURL : 'none'));
      });
    });
  } else {
    log('No serviceWorker support');
  }

  /* Check for any global variables that might be DOMO-related */
  log('=== Window globals scan ===');
  var interesting = [];
  for (var key in window) {
    try {
      if (window[key] && typeof window[key] === 'object' && key !== 'window' && key !== 'self' && key !== 'top' && key !== 'parent' && key !== 'frames') {
        if (key.length < 30 && !/^(HTML|CSS|DOM|SVG|URL|IDB|Event|Perf|Nav|Screen|Storage|Location|History|Crypto|Cache|Int|Uint|Float|Big|Array|Map|Set|Weak|Promise|Proxy|Reflect|Symbol|WebSocket|Worker|Shared|Blob|File|Image|Audio|Video|Text|Range|Node|Element|Document|Mutation|Intersection|Resize)/.test(key)) {
          interesting.push(key);
        }
      }
    } catch (e) { /* skip */ }
  }
  log('Interesting globals: ' + interesting.join(', '));

  /* Check inline scripts that DOMO injected */
  log('=== Inline script contents ===');
  var scripts = document.querySelectorAll('script');
  for (var i = 0; i < scripts.length; i++) {
    if (!scripts[i].src && scripts[i].textContent.trim()) {
      log('Inline script ' + i + ' (' + scripts[i].textContent.length + ' chars): ' + scripts[i].textContent.substring(0, 300));
    }
  }

  /* After 5 seconds, report what we got */
  setTimeout(function () {
    log('=== 5s timeout: received ' + msgCount + ' messages total ===');
  }, 5000);
})();
