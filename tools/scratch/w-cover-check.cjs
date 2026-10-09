// One-off: the sbtest1 collection's stored coverId, and which item each cover slot of its tile shows.
const { session } = require('../../.agents/skills/clone-google-app-ui/scripts/cdp-kit.cjs');

(async () => {
  const s = await session({ tab: 'willow-test' });
  console.log(JSON.stringify(await s.eval(async () => {
    const all = async (dbName, storeName) => {
      const open = indexedDB.open(dbName);
      const db = await new Promise((res, rej) => { open.onsuccess = () => res(open.result); open.onerror = () => rej(open.error); });
      const store = db.transaction(storeName, 'readonly').objectStore(storeName);
      const values = await new Promise((res) => { const r = store.getAll(); r.onsuccess = () => res(r.result); });
      db.close();
      return values;
    };
    const collection = (await all('WillowMediaCollectionsDB', 'collections')).map((v) => v.collection).find((c) => c && c.name);
    const mediaRecord = (await all('WillowMediaDB', 'project_media')).find((v) => JSON.stringify(v).includes(collection.id));
    const items = (Array.isArray(mediaRecord) ? mediaRecord : mediaRecord?.items ?? mediaRecord?.media ?? []).filter((m) => m.collectionId === collection.id);
    const tail = (u) => (u || '').slice(-120);
    return {
      coverId: collection.coverId ?? null,
      items: items.map((m) => `${m.id} ${(m.url || '').slice(0, 22)}`),
      slots: [...document.querySelectorAll('[data-drop-collection] .ct-thumb')].map((t) => items.find((m) => tail(m.url) === tail(t.getAttribute('src')))?.id ?? 'unmatched'),
    };
  }), null, 1));
  await s.close();
})().catch((e) => { console.error(e); process.exit(1); });
