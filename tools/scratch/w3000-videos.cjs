// Read-only: the video items of the project open in the user's :3000 Media tab (from the
// window.canvasMediaItems MediaView publishes) — how each is stored, and whether this browser can
// load it as a video. No clicks, no navigation, nothing written.
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000/media'));
  if (!page) { console.log('no :3000 media tab'); await browser.disconnect(); return; }
  const out = await page.evaluate(async () => {
    const items = (window.canvasMediaItems || []).filter((m) => m.kind === 'video');
    const probe = (url) => new Promise((resolve) => {
      if (!url) { resolve('no url'); return; }
      const v = document.createElement('video');
      v.muted = true;
      v.preload = 'metadata';
      const timer = setTimeout(() => { done(`timeout (readyState ${v.readyState}, networkState ${v.networkState})`); }, 8000);
      function done(r) { clearTimeout(timer); v.removeAttribute('src'); v.load(); resolve(r); }
      v.onloadedmetadata = () => done(`ok ${v.videoWidth}x${v.videoHeight} ${v.duration.toFixed(1)}s`);
      v.onerror = () => done(`error ${v.error?.code}: ${v.error?.message || ''}`);
      v.src = url;
    });
    const rows = [];
    for (const m of items.slice(0, 40)) {
      const url = m.url || '';
      rows.push({
        id: m.id.slice(0, 28),
        status: m.status,
        model: m.modelId,
        stored: url.startsWith('data:') ? `data: ${Math.round(url.length / 1048576 * 10) / 10}MB` : url.startsWith('blob:') ? 'blob' : url ? url.slice(0, 20) : 'none',
        onDisk: !!m.isSavedToFS,
        loads: m.status === 'completed' ? await probe(url) : '-',
      });
    }
    return { videos: items.length, rows };
  });
  console.log(`videos in the open project: ${out.videos}`);
  for (const r of out.rows) console.log(JSON.stringify(r));
  await browser.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
