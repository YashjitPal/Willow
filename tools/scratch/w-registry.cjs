// One-off: the :3101 project registry entries named "Collections Test", and the manifest on disk.
const { session } = require('../../.agents/skills/clone-google-app-ui/scripts/cdp-kit.cjs');

(async () => {
  const s = await session({ tab: 'willow-test', out: 'tools/scratch' });
  const out = await s.eval(async () => {
    const hits = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      const v = localStorage.getItem(k) || '';
      if (v.includes('Collections Test')) {
        let parsed = null;
        try { parsed = JSON.parse(v); } catch {}
        const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? Object.values(parsed) : [];
        hits.push({ key: k, entries: list.filter((p) => JSON.stringify(p).includes('Collections Test')).map((p) => JSON.stringify(p).slice(0, 220)) });
      }
    }
    const root = await navigator.storage.getDirectory();
    const proj = await (await (await root.getDirectoryHandle('willow-test-root')).getDirectoryHandle('Media')).getDirectoryHandle('Collections Test');
    const manifest = await (await (await proj.getFileHandle('.willow.json')).getFile()).text();
    return { hits, manifest };
  });
  console.log(JSON.stringify(out, null, 1));
  await s.close();
})().catch((e) => { console.error(e); process.exit(1); });
