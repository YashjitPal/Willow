/**
 * Where a remote-browser screenshot's time goes. Runs one capture with the bridge's
 * options inside the proxied page's frame, with html2canvas logging on, and reports
 * its log (with timestamps) plus every network request made during the capture.
 *
 *   node tools/scratch/rb-capture-timing.cjs
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  if (!page) throw new Error('no willow tab');
  const frame = page.frames().find((f) => f.url().includes('.wb.localhost'));
  if (!frame) throw new Error('no remote-browser frame');
  const result = await frame.evaluate(async () => {
    if (!window.__probeH2C) {
      const source = await (await fetch(`${location.origin}/__willow_browse__/html2canvas.js`)).text();
      const previous = window.html2canvas;
      (0, eval)(source);
      window.__probeH2C = window.html2canvas;
      window.html2canvas = previous;
    }
    const started = performance.now();
    const log = [];
    const saved = {};
    for (const level of ['debug', 'info', 'log', 'warn', 'error']) {
      saved[level] = console[level];
      console[level] = (...args) => log.push(`${Math.round(performance.now() - started)}ms ${level}: ${args.map(String).join(' ').slice(0, 200)}`);
    }
    const requests = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.startTime < started) continue;
        requests.push({ name: entry.name.slice(0, 140), start: Math.round(entry.startTime - started), duration: Math.round(entry.duration), type: entry.initiatorType });
      }
    });
    observer.observe({ type: 'resource', buffered: false });
    let error = null;
    try {
      await window.__probeH2C(document.documentElement, {
        x: window.scrollX,
        y: window.scrollY,
        width: window.innerWidth,
        height: window.innerHeight,
        windowWidth: window.innerWidth,
        windowHeight: window.innerHeight,
        scale: 1,
        useCORS: false,
        allowTaint: false,
        proxy: `${location.origin}/__willow_browse__/raw`,
        imageTimeout: 4000,
        backgroundColor: '#ffffff',
        logging: true,
        onclone: (clone) => {
          log.push(`${Math.round(performance.now() - started)}ms onclone`);
          const entries = clone.defaultView.performance.getEntriesByType('resource')
            .sort((a, b) => b.duration - a.duration)
            .slice(0, 15)
            .map((entry) => `   clone ${entry.initiatorType} ${Math.round(entry.startTime)}+${Math.round(entry.duration)}ms ${entry.name.slice(0, 120)}`);
          log.push(`clone loaded ${clone.defaultView.performance.getEntriesByType('resource').length} resources; slowest:`, ...entries);
          const nav = clone.defaultView.performance.getEntriesByType('navigation')[0];
          if (nav) log.push(`clone navigation: domContentLoaded ${Math.round(nav.domContentLoadedEventEnd)} load ${Math.round(nav.loadEventEnd)}`);
          log.push(`clone stylesheets ${clone.styleSheets.length}, links ${clone.querySelectorAll('link').length}, imgs ${clone.images.length}, fonts ${clone.fonts ? clone.fonts.size : '?'}`);
        },
      });
    } catch (e) {
      error = e.message;
    }
    const total = Math.round(performance.now() - started);
    await new Promise((resolve) => setTimeout(resolve, 200));
    observer.disconnect();
    Object.assign(console, saved);
    return { total, error, images: document.images.length, log, requests };
  });
  console.log(`total ${result.total}ms, images in page ${result.images}, error ${result.error}`);
  console.log(result.log.join('\n'));
  console.log(`requests during capture: ${result.requests.length}`);
  const byType = {};
  for (const request of result.requests) byType[request.type] = (byType[request.type] || 0) + 1;
  console.log(JSON.stringify(byType));
  result.requests.sort((a, b) => b.duration - a.duration).slice(0, 12).forEach((r) => console.log(`${r.start}+${r.duration}ms ${r.type} ${r.name}`));
  browser.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
