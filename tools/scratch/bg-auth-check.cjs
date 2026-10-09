/** Reports whether Firebase still holds a signed-in user for localhost:3000, read from a fresh tab. */
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = await browser.newPage();
  await page.goto('http://localhost:3000/favicon.ico', { waitUntil: 'domcontentloaded' }).catch(() => undefined);
  const result = await page.evaluate(async () => {
    const databases = await indexedDB.databases();
    const names = databases.map((db) => db.name);
    const read = () => new Promise((resolve) => {
      const open = indexedDB.open('firebaseLocalStorageDb');
      open.onerror = () => resolve('cannot open');
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('firebaseLocalStorage')) { resolve('no store'); return; }
        const request = db.transaction('firebaseLocalStorage').objectStore('firebaseLocalStorage').getAll();
        request.onsuccess = () => resolve(request.result.map((row) => ({
          key: row.fbase_key,
          email: row.value?.email,
          uid: row.value?.uid?.slice(0, 6),
          expires: row.value?.stsTokenManager?.expirationTime ? new Date(row.value.stsTokenManager.expirationTime).toISOString() : undefined,
        })));
        request.onerror = () => resolve('read failed');
      };
    });
    return { hasFirebaseDb: names.includes('firebaseLocalStorageDb'), users: names.includes('firebaseLocalStorageDb') ? await read() : null, now: new Date().toISOString() };
  });
  console.log(JSON.stringify(result, null, 1));
  await page.close();
  browser.disconnect();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
