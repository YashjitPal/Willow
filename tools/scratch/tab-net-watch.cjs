/**
 * Watches one tab's network for a while without touching the page: requests and WebSockets per
 * host, and how many are still pending at the end. For finding a tab that floods the profile's
 * socket pool.
 *
 *   node tools/scratch/tab-net-watch.cjs <url-prefix> [seconds=10]
 */
const puppeteer = require('puppeteer-core');

const [prefix, seconds = '10'] = process.argv.slice(2);
if (!prefix) throw new Error('tab-net-watch <url-prefix> [seconds]');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 30_000 });
  const target = browser.targets().find((t) => t.type() === 'page' && t.url().startsWith(prefix));
  if (!target) throw new Error(`no tab at ${prefix}`);
  const cdp = await target.createCDPSession();
  const hosts = new Map();
  const pending = new Map();
  const failed = new Map();
  let sockets = 0;
  const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);
  cdp.on('Network.requestWillBeSent', ({ requestId, request }) => {
    const host = new URL(request.url).host || request.url.slice(0, 40);
    bump(hosts, host);
    pending.set(requestId, host);
  });
  cdp.on('Network.loadingFinished', ({ requestId }) => pending.delete(requestId));
  cdp.on('Network.loadingFailed', ({ requestId, errorText }) => {
    bump(failed, `${pending.get(requestId) || '?'} ${errorText}`);
    pending.delete(requestId);
  });
  cdp.on('Network.webSocketCreated', ({ url }) => { sockets += 1; bump(hosts, `ws ${new URL(url).host}`); });
  await cdp.send('Network.enable');
  await new Promise((resolve) => setTimeout(resolve, Number(seconds) * 1000));
  await cdp.send('Network.disable');
  console.log(`in ${seconds}s: ${[...hosts.values()].reduce((a, b) => a + b, 0)} requests, ${sockets} WebSockets`);
  for (const [host, n] of [...hosts].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${n}  ${host}`);
  console.log(`still pending: ${pending.size}`);
  for (const [why, n] of [...failed].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  failed ${n}x  ${why}`);
  await cdp.detach();
  await browser.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
