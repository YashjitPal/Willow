/**
 * Notebook fixtures for responsive checks: mirrors the reference Gemini account's 19
 * notebooks (title, emoji, source count, the pinned one) into Willow through its own
 * `notebooks-store`, so the two grids can be diffed element for element.
 *
 *   node tools/scratch/nb-seed.cjs seed     create them (no-op if already seeded)
 *   node tools/scratch/nb-seed.cjs purge    delete exactly the notebooks seed created
 *   node tools/scratch/nb-seed.cjs list     what is seeded
 *   node tools/scratch/nb-seed.cjs chats    file two placeholder chat ids on the pinned fixture
 *
 * Only localStorage is touched: with no local folder connected there is no disk mirror.
 * Created ids are kept under `willow:notebooks:seed-fixtures`, and purge removes only those.
 */
const puppeteer = require('puppeteer-core');

/* Gemini's order, newest first; created in reverse so the newest lands on top. */
const NOTEBOOKS = [
  { emoji: '📔', title: 'Electrochemistry', sources: 3, pinned: true },
  { emoji: '🔢', title: 'Matrix and Determinant', sources: 2 },
  { emoji: '⚗️', title: 'Chemistry', sources: 2 },
  { emoji: '📏', title: 'Physics PW', sources: 13 },
  { emoji: '📔', title: 'Biology', sources: 12 },
  { emoji: '🚀', title: 'Career', sources: 0 },
  { emoji: '📓', title: 'Test Notebook', sources: 0 },
  { emoji: '📈', title: 'Differentiation', sources: 0 },
  { emoji: '🧪', title: 'Chemical Kinetics', sources: 0 },
  { emoji: '🧪', title: 'Chemistry JEE', sources: 2 },
  { emoji: '🎯', title: 'Limits and Derivatives', sources: 0 },
  { emoji: '😥', title: 'English Literature', sources: 6 },
  { emoji: '🍎', title: 'Physics Alecc Daddy', sources: 1 },
  { emoji: '📔', title: 'Untitled notebook', sources: 0 },
  { emoji: '📔', title: 'Untitled notebook', sources: 0 },
  { emoji: '➡️', title: 'Physics JEE', sources: 1 },
  { emoji: '📔', title: 'Chemistry PW', sources: 0 },
  { emoji: '➕', title: 'Maths PW', sources: 1 },
  { emoji: '🎤', title: 'Taylor Swift', sources: 2 },
];

const SOURCE_KINDS = [
  { kind: 'file', mimeType: 'application/pdf', ext: '.pdf' },
  { kind: 'website', mimeType: 'text/html', ext: '' },
  { kind: 'text', mimeType: 'text/plain', ext: '' },
];

async function run(page, command) {
  return page.evaluate(async (cmd, notebooks, kinds) => {
    const url = performance.getEntriesByType('resource').map((entry) => entry.name)
      .find((name) => /\/notebooks-store\.ts(\?|$)/.test(name));
    if (!url) return { error: 'notebooks-store module not loaded yet — open the sidebar or /notebooks once first' };
    const store = await import(url);
    const SEED_KEY = 'willow:notebooks:seed-fixtures';
    const saved = JSON.parse(localStorage.getItem(SEED_KEY) || '{"notebooks":[]}');
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    if (cmd === 'list') {
      return { seeded: saved.notebooks.length, present: store.notebooksStore.get().filter((nb) => saved.notebooks.includes(nb.id)).map((nb) => nb.title) };
    }

    if (cmd === 'seed') {
      store.hydrateNotebooks();
      if (saved.notebooks.length && store.notebooksStore.get().some((nb) => saved.notebooks.includes(nb.id))) {
        return { already: saved.notebooks.length };
      }
      const created = [];
      for (const spec of [...notebooks].reverse()) {
        const notebook = store.createNotebook({ title: spec.title, emoji: spec.emoji });
        for (let i = 0; i < spec.sources; i += 1) {
          const type = kinds[i % kinds.length];
          const name = `${spec.title} notes ${i + 1}`;
          store.addNotebookSource(notebook.id, {
            title: type.kind === 'website' ? `https://en.wikipedia.org/wiki/${spec.title.replace(/\s+/g, '_')}_${i + 1}` : `${name}${type.ext}`,
            kind: type.kind,
            mimeType: type.mimeType,
            url: type.kind === 'website' ? `https://en.wikipedia.org/wiki/${spec.title.replace(/\s+/g, '_')}` : undefined,
            content: `Placeholder text for ${name}.`,
          });
        }
        if (spec.pinned) store.toggleNotebookPinned(notebook.id);
        created.push(notebook.id);
        await sleep(4);
      }
      localStorage.setItem(SEED_KEY, JSON.stringify({ notebooks: created }));
      return { created: created.length };
    }

    // Past-chat rows on the pinned fixture. The page drops ids the chat index does not
    // know, so these are the first two real ids from the signed-in browser scope —
    // filed in the registry only (no folder is connected, so no file moves), and
    // released again when purge deletes the fixture.
    if (cmd === 'chats') {
      store.hydrateNotebooks();
      const first = store.notebooksStore.get().find((nb) => saved.notebooks.includes(nb.id) && nb.pinned);
      if (!first) return { error: 'no seeded pinned notebook' };
      for (const id of [...first.chatIds]) store.removeChatFromNotebook(first.id, id);
      const indexKey = Object.keys(localStorage).find((key) => /^willow_local_chats:[^:]+%3A%3Abrowser$/.test(key));
      const ids = (JSON.parse(localStorage.getItem(indexKey) || '[]') || []).slice(0, 2);
      for (const id of [...ids].reverse()) store.addChatToNotebook(first.id, id);
      return { notebook: first.title, chatIds: store.getNotebook(first.id).chatIds };
    }

    if (cmd === 'purge') {
      store.hydrateNotebooks();
      let removed = 0;
      for (const id of saved.notebooks) {
        if (store.getNotebook(id)) {
          store.deleteNotebook(id);
          removed += 1;
        }
      }
      localStorage.removeItem(SEED_KEY);
      return { removed };
    }
    return { error: `unknown command ${cmd}` };
  }, command, NOTEBOOKS, SOURCE_KINDS);
}

(async () => {
  const command = process.argv[2] || 'seed';
  const browser = await puppeteer.connect({
    browserURL: process.env.SPARK_CDP_URL || 'http://[::1]:9222',
    defaultViewport: null,
    protocolTimeout: 30_000,
  });
  const page = (await browser.pages()).find((candidate) => candidate.url().startsWith('http://localhost:3000'));
  if (!page) throw new Error('no Willow tab');
  console.log(JSON.stringify(await run(page, command)));
  await browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
