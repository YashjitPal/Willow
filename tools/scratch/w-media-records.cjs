// One-off: the stored media records of a :3101 project (id, fsName, collectionId, url kind), the
// stored collections, and the live grid — to see what the reconcile wrote.
//   node tools/scratch/w-media-records.cjs <projectId>
const { session } = require('../../.agents/skills/clone-google-app-ui/scripts/cdp-kit.cjs');

(async () => {
  const s = await session({ tab: 'willow-test', out: 'tools/scratch' });
  const pid = process.argv[2];
  const out = await s.eval(async (projectId) => {
    const open = (name) => new Promise((resolve, reject) => { const r = indexedDB.open(name); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const all = (db, store) => new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const allKeys = (db, store) => new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAllKeys();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const dbs = (await indexedDB.databases()).map((d) => d.name);
    const media = [];
    for (const name of dbs.filter((n) => /media/i.test(n))) {
      const db = await open(name);
      for (const store of db.objectStoreNames) {
        const keys = await allKeys(db, store);
        const vals = await all(db, store);
        keys.forEach((k, i) => {
          if (!String(k).includes(projectId)) return;
          const v = vals[i];
          const list = Array.isArray(v) ? v : Array.isArray(v?.items) ? v.items : null;
          if (list) for (const m of list) media.push(`${store}: ${m.id} fs=${m.fsName} col=${m.collectionId ?? '-'} url=${(m.url || '').slice(0, 10)} saved=${m.isSavedToFS}`);
          else if (v?.collection) media.push(`collection: ${v.collection.id} "${v.collection.name}" folder=${v.collection.folder} onDisk=${v.collection.onDisk}`);
        });
      }
      db.close();
    }
    return { dbs, media };
  }, pid);
  console.log(out.dbs.join(', '));
  console.log(out.media.join('\n'));
  await s.close();
})().catch((e) => { console.error(e); process.exit(1); });
