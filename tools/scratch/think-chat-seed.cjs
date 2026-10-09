/**
 * One neutral chat fixture with thinking steps, for checking the "Thinking steps" panel in
 * Willow. Writes the body through Willow's own `willow-db` module (scope `{ userId,
 * rootId: 'browser' }`, the no-folder scope) and adds the id to the scoped chat registry,
 * then reloads the tab so the registry is re-read. `purge` removes exactly that chat.
 *
 *   node tools/scratch/think-chat-seed.cjs seed | purge
 */
const puppeteer = require('puppeteer-core');

const CHAT_ID = 'Thinking steps fixture';

(async () => {
  const command = process.argv[2] || 'seed';
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60000 });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  const result = await page.evaluate(async (cmd, chatId) => {
    const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /\/indexeddb\/willow-db\.ts(\?|$)/.test(n));
    if (!url) return { error: 'willow-db not loaded' };
    const db = await import(url);
    const chatsKey = Object.keys(localStorage).find((k) => /^willow_local_chats:.+%3A%3Abrowser$/.test(k));
    if (!chatsKey) return { error: 'no browser chat registry' };
    const suffix = chatsKey.slice('willow_local_chats:'.length);
    const scopeId = decodeURIComponent(suffix);
    const userId = scopeId.split('::')[0];
    const keys = { chats: chatsKey, timestamps: `willow_chat_timestamps:${suffix}`, sync: `willow_chat_sync_state:${suffix}` };
    const read = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k) || '') ?? fallback; } catch { return fallback; } };
    const scope = { userId, rootId: 'browser' };
    const chats = read(keys.chats, []);
    const timestamps = read(keys.timestamps, {});
    const sync = read(keys.sync, {});
    if (cmd === 'purge') {
      localStorage.setItem(keys.chats, JSON.stringify(chats.filter((id) => id !== chatId)));
      delete timestamps[chatId];
      delete sync[chatId];
      localStorage.setItem(keys.timestamps, JSON.stringify(timestamps));
      localStorage.setItem(keys.sync, JSON.stringify(sync));
      await db.deleteChatBody(chatId, scope);
      return { purged: chatId, remaining: chats.filter((id) => id !== chatId).length };
    }
    const now = Date.now();
    await db.saveChatBody(chatId, [
      { id: 'fixture-user-1', role: 'user', content: 'A test prompt for checking the thinking steps panel.' },
      {
        id: 'fixture-assistant-1',
        role: 'assistant',
        content: 'A short test reply.',
        thinkingTime: 4,
        thinkingText: '**Checking the panel**\n\nA neutral test thought that runs long enough to wrap across a few lines on a phone, so the dotted rail and the body text can be measured.\n\n**Second step**\n\nAnother neutral thought, shorter.',
        modelSnapshot: { provider: 'google', modelId: 'gemini-3.8-flash', label: '3.8 Flash Extended', thinkingLevel: 2 },
      },
    ], scope);
    localStorage.setItem(keys.chats, JSON.stringify([chatId, ...chats.filter((id) => id !== chatId)]));
    localStorage.setItem(keys.timestamps, JSON.stringify({ ...timestamps, [chatId]: now }));
    localStorage.setItem(keys.sync, JSON.stringify({
      ...sync,
      [chatId]: { revision: 1, diskRevision: 0, diskMtime: 0, dirty: false, tombstone: false, updatedAt: now, notebookId: '', locationDirty: false },
    }));
    return { seeded: chatId, scopeId: scopeId.replace(/^[^:]+/, '<uid>') };
  }, command, CHAT_ID);
  console.log(JSON.stringify(result));
  if (!result.error) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 3500));
    console.log('reloaded', page.url());
  }
  browser.disconnect();
})();
