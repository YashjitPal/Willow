// One-off: the sbtest1 media records on the :3101 test origin — id, kind, modelId, prompt, collection.
const { session } = require('../../.agents/skills/clone-google-app-ui/scripts/cdp-kit.cjs');

(async () => {
  const s = await session({ tab: 'willow-test' });
  console.log(JSON.stringify(await s.eval(async () => {
    const open = indexedDB.open('WillowMediaDB');
    const db = await new Promise((res, rej) => { open.onsuccess = () => res(open.result); open.onerror = () => rej(open.error); });
    const tx = db.transaction('project_media', 'readonly');
    const store = tx.objectStore('project_media');
    const keys = await new Promise((res) => { const r = store.getAllKeys(); r.onsuccess = () => res(r.result); });
    const out = {};
    for (const k of keys) {
      if (!String(k).includes('sbtest1')) continue;
      const v = await new Promise((res) => { const r = store.get(k); r.onsuccess = () => res(r.result); });
      const items = Array.isArray(v) ? v : v?.items ?? v?.media ?? [];
      out[k] = items.map((m) => `${m.id} ${m.kind} ${m.modelId} ${m.status} "${(m.prompt || '').slice(0, 24)}" ${m.collectionId || '-'} ${m.historyParentId ? 'v' : ''}`);
    }
    db.close();
    return out;
  }), null, 1));
  await s.close();
})().catch((e) => { console.error(e); process.exit(1); });
