/**
 * Read-only: for every chat in Recents, in every workspace this browser has used,
 * whether its body holds Code-mode messages (`willowMode: 'code'`) and whether it
 * carries the Code marker the Recents click reads. A Code chat without the marker
 * opens in the Chat view. Opens nothing, clicks nothing, writes nothing.
 *
 *   node tools/scratch/code-chat-markers.cjs
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null });
  const page = await browser.newPage();
  try {
    await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('textarea', { visible: true, timeout: 90_000 });
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const report = await page.evaluate(async () => {
      const bodies = await new Promise((resolve, reject) => {
        const open = indexedDB.open('WillowDB');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('chats', 'readonly');
          const store = tx.objectStore('chats');
          const keysRequest = store.getAllKeys();
          const valuesRequest = store.getAll();
          tx.oncomplete = () => {
            const map = new Map();
            keysRequest.result.forEach((key, index) => map.set(String(key), valuesRequest.result[index]));
            db.close();
            resolve(map);
          };
          tx.onerror = () => reject(tx.error);
        };
      });
      const scopes = Object.keys(localStorage).filter((key) => key.startsWith('willow_local_chats:'))
        .map((key) => decodeURIComponent(key.slice('willow_local_chats:'.length)));
      return scopes.map((scope) => {
        const suffix = encodeURIComponent(scope);
        const list = JSON.parse(localStorage.getItem(`willow_local_chats:${suffix}`) || '[]');
        const snapshot = JSON.parse(localStorage.getItem(`willow_code_chats:v2:${suffix}`) || '{}');
        const statePrefix = `willow_code_chat_state:v2:${suffix}:`;
        const states = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key?.startsWith(statePrefix)) states[decodeURIComponent(key.slice(statePrefix.length))] = JSON.parse(localStorage.getItem(key) || '{}').present;
        }
        const marked = (id) => (id in states ? states[id] === true : snapshot[id] === true);
        const scanned = new Set(JSON.parse(localStorage.getItem(`willow_code_chat_scanned:v1:${suffix}`) || '[]'));
        const ids = Array.isArray(list) ? list : [];
        const rows = ids.map((id) => {
          const encoded = `:${encodeURIComponent(id)}`;
          const candidates = [...bodies.keys()].filter((key) => key === id || key.endsWith(encoded));
          const messages = candidates.map((key) => bodies.get(key)).find(Array.isArray) || null;
          const code = messages ? messages.some((m) => m?.willowMode === 'code') : null;
          return { id: id.slice(0, 48), messages: messages ? messages.length : null, codeBody: code, marked: marked(id), scanned: scanned.has(id) };
        });
        const markedNotListed = Object.keys({ ...snapshot, ...states }).filter((id) => marked(id) && !ids.includes(id));
        return {
          scope,
          chats: ids.length,
          codeChatsMissingMarker: rows.filter((row) => row.codeBody === true && !row.marked),
          markedChats: rows.filter((row) => row.marked).length,
          codeBodies: rows.filter((row) => row.codeBody === true).length,
          unreadBodies: rows.filter((row) => row.codeBody === null).length,
          markersForChatsNotInRecents: markedNotListed.slice(0, 12),
        };
      });
    });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await page.close().catch(() => {});
    browser.disconnect();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
