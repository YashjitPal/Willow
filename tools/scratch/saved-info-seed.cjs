/**
 * Seeds Willow's Saved info (in the debug Chrome's Willow tab) with placeholder entries the
 * lengths of the reference account's first few, so the two lists can be compared row for
 * row, and clears them again. Goes through the app's own saved-info-store instance (found on
 * the resource timeline), so the disk mirror is written and cleared by the normal path.
 *
 *   node tools/scratch/saved-info-seed.cjs seed     add the placeholders (no-op if present)
 *   node tools/scratch/saved-info-seed.cjs clear    remove exactly the placeholders it added
 */
const puppeteer = require('puppeteer-core');

const MARK = 'Placeholder entry';
const LENGTHS = [249, 160, 63, 173, 154, 46];
const WORDS = 'keep answers short and practical when the topic is simple and explain the reasoning step by step when it is not'.split(' ');

const placeholder = (index, length) => {
  let text = `${MARK} ${index + 1}:`;
  for (let i = 0; text.length < length; i += 1) text += ` ${WORDS[i % WORDS.length]}`;
  return `${text.slice(0, length - 1).trimEnd()}.`;
};

(async () => {
  const command = process.argv[2] || 'seed';
  const browser = await puppeteer.connect({
    browserURL: process.env.SPARK_CDP_URL || 'http://[::1]:9222',
    defaultViewport: null,
    protocolTimeout: 30_000,
  });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000'));
  if (!page) throw new Error('no Willow tab');
  const result = await page.evaluate(async (cmd, entries, mark) => {
    const url = performance.getEntriesByType('resource').map((e) => e.name)
      .find((name) => /\/saved-info-store\.ts(\?|$)/.test(name));
    if (!url) return { error: 'saved-info-store not loaded yet' };
    const store = await import(url);
    const state = () => store.savedInfoStore.get();
    const ours = () => state().instructions.filter((entry) => entry.text.startsWith(mark));
    if (cmd === 'seed') {
      if (ours().length) return { already: ours().length };
      // The page lists newest first; add in reverse so entry 1 heads the list.
      for (const text of [...entries].reverse()) store.addSavedInstruction(text);
      return { added: ours().length, total: state().instructions.length };
    }
    if (cmd === 'clear') {
      const ids = ours().map((entry) => entry.id);
      for (const id of ids) store.removeSavedInstruction(id);
      return { removed: ids.length, remaining: state().instructions.length };
    }
    return { error: `unknown command ${cmd}` };
  }, command, LENGTHS.map((n, i) => placeholder(i, n)), MARK);
  console.log(JSON.stringify(result));
  await browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
