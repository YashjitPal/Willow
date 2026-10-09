/**
 * End-to-end check of the remote-browser proxy and bridge inside the Willow tab:
 * mounts a hidden, sandboxed iframe on a proxied page, waits for the bridge, takes
 * a screenshot over postMessage, clicks a link, and confirms the navigation stayed
 * on the proxy. Removes the iframe afterwards; touches nothing else.
 *
 *   node tools/scratch/willow-browse-frame-test.cjs [url]
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

(async () => {
  const target = process.argv[2] || 'https://example.com/';
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  if (!page) throw new Error('no willow tab');
  const clickAt = (process.argv[3] || '500,837').split(',').map(Number);
  const result = await page.evaluate(async (targetUrl, clickX, clickY) => {
    const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
    const encode = (origin) => {
      const bytes = new TextEncoder().encode(origin);
      let out = '';
      let bits = 0;
      let value = 0;
      for (const byte of bytes) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
      }
      if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
      return out.match(/.{1,60}/g).join('.');
    };
    const url = new URL(targetUrl);
    const src = `http://${encode(url.origin)}.wb.localhost:${location.port}${url.pathname}${url.search}`;
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
    frame.style.cssText = 'position:fixed;left:-20000px;top:0;width:1280px;height:937px;border:0;';
    const log = [];
    let pending = new Map();
    let seq = 0;
    const onMessage = (event) => {
      if (event.source !== frame.contentWindow || !event.data || event.data.__willowBrowse !== 1) return;
      const data = event.data;
      if (data.event) log.push({ t: Math.round(performance.now()), event: data.event, url: data.url, title: data.title, loading: data.loading });
      if (data.id && pending.has(data.id)) { pending.get(data.id)(data); pending.delete(data.id); }
    };
    window.addEventListener('message', onMessage);
    const waitFor = (predicate, ms) => new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        const hit = log.find((entry, index) => predicate(entry, index));
        if (hit || Date.now() - started > ms) resolve(hit || null);
        else setTimeout(tick, 100);
      };
      tick();
    });
    const call = (op, args = {}) => new Promise((resolve) => {
      const id = `t${++seq}`;
      pending.set(id, resolve);
      frame.contentWindow.postMessage({ __willowBrowse: 1, id, op, args }, '*');
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve({ ok: false, error: 'timeout' }); } }, 20000);
    });
    frame.src = src;
    document.body.appendChild(frame);
    const t0 = performance.now();
    const loaded = await waitFor((entry) => entry.event === 'state' && entry.loading === false, 20000);
    const loadMs = Math.round(performance.now() - t0);
    const shot = loaded ? await call('screenshot') : null;
    const ping = loaded ? await call('ping') : null;
    const before = log.length;
    // Click the first link on the page, at its centre, in normalized coordinates.
    const linkBox = await (async () => {
      try {
        const doc = frame.contentDocument;
        return doc ? 'same-origin?!' : null;
      } catch { return null; }
    })();
    const click = loaded ? await call('click', { x: clickX, y: clickY }) : null;
    let navigated = null;
    if (loaded) {
      const unload = await waitFor((entry, index) => index >= before && entry.event === 'unload', 8000);
      const next = unload
        ? await waitFor((entry) => entry.event === 'state' && entry.loading === false && entry.t > unload.t, 20000)
        : null;
      navigated = { unloaded: Boolean(unload), next, frameSrcAttr: frame.getAttribute('src') };
    }
    window.removeEventListener('message', onMessage);
    frame.remove();
    return {
      src,
      loadMs,
      loaded: Boolean(loaded),
      crossOriginToWillow: linkBox === null,
      log,
      ping: ping && ping.result,
      shot: shot && shot.ok ? { width: shot.result.width, height: shot.result.height, bytes: shot.result.dataUrl.length, dataUrl: shot.result.dataUrl } : shot,
      click: click && { ok: click.ok, result: click.result, error: click.error },
      eventsAfterClick: log.slice(before),
      navigated,
    };
  }, target, clickAt[0], clickAt[1]);
  const out = path.join('tools', 'ui-research', 'captures', 'spark', '134-remote-browser', 'bridge-shot.jpg');
  if (result.shot && result.shot.dataUrl) {
    fs.writeFileSync(out, Buffer.from(result.shot.dataUrl.split(',')[1], 'base64'));
    result.shot.dataUrl = `saved ${out}`;
  }
  console.log(JSON.stringify(result, null, 1));
  browser.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
