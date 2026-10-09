/**
 * Neutral notebook fixtures for checking the Gem editor's "Add notebook" dialog in Willow.
 * Goes through Willow's own `notebooks-store` (which must already be loaded — open the
 * dialog once), records the ids it made, and purge deletes exactly those.
 *
 *   node tools/scratch/gem-nb-seed.cjs seed | purge
 */
const puppeteer = require('puppeteer-core');

const FIXTURES = [
  { title: 'Test notebook C', sources: 3 },
  { title: 'Test notebook B', sources: 1 },
  { title: 'Test notebook A', sources: 0 },
];

(async () => {
  const command = process.argv[2] || 'seed';
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 30000 });
  const page = (await browser.pages()).find((p) => (p.url().startsWith('http://localhost:3000') && !p.url().includes('/media')));
  console.log(JSON.stringify(await page.evaluate(async (cmd, fixtures) => {
    const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /\/notebooks-store\.ts(\?|$)/.test(n));
    if (!url) return { error: 'notebooks-store not loaded' };
    const store = await import(url);
    const KEY = 'willow:gems:nb-seed-fixtures';
    const saved = JSON.parse(localStorage.getItem(KEY) || '[]');
    store.hydrateNotebooks();
    if (cmd === 'purge') {
      let removed = 0;
      for (const id of saved) if (store.getNotebook(id)) { store.deleteNotebook(id); removed += 1; }
      localStorage.removeItem(KEY);
      return { removed };
    }
    if (saved.some((id) => store.getNotebook(id))) return { already: saved.length };
    const created = [];
    for (const spec of fixtures) {
      const notebook = store.createNotebook({ title: spec.title });
      for (let i = 0; i < spec.sources; i += 1) {
        store.addNotebookSource(notebook.id, { title: `Source ${i + 1}.txt`, kind: 'file', mimeType: 'text/plain', content: `Placeholder text for source ${i + 1}.` });
      }
      created.push(notebook.id);
      await new Promise((r) => setTimeout(r, 5));
    }
    localStorage.setItem(KEY, JSON.stringify(created));
    return { created: created.length };
  }, command, FIXTURES)));
  browser.disconnect();
})();
