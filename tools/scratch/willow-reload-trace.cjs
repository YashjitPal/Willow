const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  await page.bringToFront();
  const client = await page.createCDPSession();
  await client.send('Runtime.enable');
  await client.send('Log.enable');
  const lines = [];
  client.on('Runtime.exceptionThrown', (e) => lines.push('EXC ' + (e.exceptionDetails.exception?.description || e.exceptionDetails.text).slice(0, 700)));
  client.on('Runtime.consoleAPICalled', (e) => { if (['error', 'warning'].includes(e.type)) lines.push(e.type + ' ' + e.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400)); });
  client.on('Log.entryAdded', (e) => lines.push('LOG ' + e.entry.level + ' ' + e.entry.text.slice(0, 400) + ' ' + (e.entry.url || '')));
  await page.reload({ waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 15000));
  const facts = await page.evaluate(() => ({
    root: document.getElementById('root')?.children.length,
    boot: Boolean(document.getElementById('willow-boot')),
    main: performance.getEntriesByType('resource').some((e) => e.name.includes('/src/main.tsx')),
    app: performance.getEntriesByType('resource').some((e) => e.name.includes('/src/app/App.tsx')),
    spark: performance.getEntriesByType('resource').some((e) => e.name.includes('SparkWorkspace.tsx')),
  }));
  console.log(JSON.stringify(facts));
  console.log(lines.slice(0, 30).join('\n'));
  browser.disconnect();
})();
