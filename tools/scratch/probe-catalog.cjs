// Every catalog tool through Willow's compiler and runner (a stub host: nothing generates, storage
// is in memory), reporting mounted / compile error / runtime error / timed out per tool.
//   CATALOG_ONLY=id1,id2 node tools/scratch/w-tools-probe.cjs tools/scratch/probe-catalog.cjs
const fs = require('fs');
const path = require('path');

module.exports = async ({ page, go, waitFor, sleep }) => {
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../../features/media/src/tools/catalog/catalog.json'), 'utf8'));
  let tools = [...catalog.templates, ...catalog.community].map((t) => ({ id: t.id, name: t.name }));
  if (process.env.CATALOG_ONLY) tools = tools.filter((t) => process.env.CATALOG_ONLY.split(',').includes(t.id));
  await go('/media/tools');
  await waitFor(() => document.querySelector('.applet-section'), null, 120000);
  const results = [];
  for (const tool of tools) {
    const result = await page.evaluate(async (id) => {
      const root = '/@fs/C:/Users/Yashjit%202/Workspace/Willow%20Code/features/media/src/tools';
      const { loadCatalogFiles } = await import(`${root}/catalog-sources.ts`);
      const { ToolRunner } = await import(`${root}/runtime/bridge.ts`);
      const files = await loadCatalogFiles(id);
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;left:0;top:0;width:1200px;height:760px;z-index:-1;opacity:0;pointer-events:none';
      document.body.appendChild(box);
      const memory = new Map();
      const fail = async () => { throw new Error('stub'); };
      const host = {
        generateImage: fail, generateVideo: fail, generateText: fail, saveMedia: fail,
        selectMedia: async () => null, mediaBase64: fail,
        storage: {
          getItem: async (k) => memory.get(k) ?? null, setItem: async (k, v) => { memory.set(k, v); },
          removeItem: async (k) => { memory.delete(k); }, clear: async () => memory.clear(), keys: async (p) => [...memory.keys()].filter((k) => k.startsWith(p ?? '')),
        },
        persistLocalStorage: () => {},
      };
      const events = [];
      const done = new Promise((resolve) => {
        const runner = new ToolRunner(box, host, (e) => {
          events.push(e.type === 'compile_error' ? `compile_error: ${e.errors.join(' | ').slice(0, 300)}` : e.type === 'runtime_error' ? `runtime_error: ${e.error.slice(0, 300)}` : e.type === 'csp_violation' ? `csp: ${e.blockedURI}` : e.type);
          if (e.type === 'app_mounted' || e.type === 'compile_error') setTimeout(() => resolve(runner), 1500);
        });
        void runner.run(files, {});
        setTimeout(() => resolve(runner), 30000);
      });
      const runner = await done;
      runner.dispose();
      box.remove();
      return { files: files.length, events };
    }, tool.id).catch((e) => ({ files: 0, events: [`probe failed: ${String(e.message).slice(0, 200)}`] }));
    const mounted = result.events.includes('app_mounted');
    const status = mounted ? (result.events.some((e) => e.startsWith('runtime_error')) ? 'MOUNTED+ERROR' : 'OK') : result.events.find((e) => e.startsWith('compile_error')) ? 'COMPILE' : result.events.find((e) => e.startsWith('runtime_error')) ? 'RUNTIME' : 'TIMEOUT';
    results.push({ ...tool, status, events: result.events.filter((e) => e !== 'compiling' && e !== 'sdk_ready') });
    console.log(`${status.padEnd(14)} ${tool.name} (${tool.id}) ${status === 'OK' ? '' : JSON.stringify(results[results.length - 1].events).slice(0, 400)}`);
  }
  const tally = results.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] || 0) + 1 }), {});
  console.log('TALLY', JSON.stringify(tally));
  fs.writeFileSync(path.join(__dirname, 'out-catalog-run.json'), JSON.stringify(results, null, 1));
};
