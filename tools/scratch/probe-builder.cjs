// Seeds the template copy's Tool Builder chat with Flow's captured turn (builder/t1-32.json) and
// compares the sidebar with Flow's dump of it.
const geometry = require('./probe-geometry.cjs');

const USER = 'Make the generate arrow button blue when it is enabled.';
const THOUGHTS = '**Refining Button Appearance**\n\nI\'ve zeroed in on the "generate" button\'s styling within `App.tsx`. My current focus is altering its enabled state color. The user requested blue, so I\'m considering swapping `text-white` for `text-[#007AFF]` or `text-blue-500` whenever `isCanvasEmpty` is false, and keeping `bg-[#969696]` for the disabled state.';
const REPLY = 'I\'ve updated the **generate arrow button** to turn blue (`#007AFF`) when it is enabled. This provides a clearer visual cue that the tool is ready to refine your sketch once you\'ve drawn something on the canvas.\n\n* **Blue Arrow**: The button now highlights in blue as soon as the canvas is no longer empty.\n* **Hover State**: Added a lighter blue hover effect for better interactive feedback.\n\nLet me know if you\'d like any other visual adjustments!';

module.exports = async (ctx) => {
  const { page, ensureCopy, go } = ctx;
  const id = await ensureCopy();
  await page.evaluate(async ({ id, user, thoughts, reply }) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('WillowMediaToolsDB'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const record = await new Promise((res) => {
      const q = db.transaction('tools', 'readonly').objectStore('tools').getAll();
      q.onsuccess = () => res(q.result.find((r) => String(r.key).endsWith(`tool:${id}`)));
    });
    const scope = String(record.key).match(/^scope:(.*):tool:/)[1];
    const messages = [
      { id: 'u-seed', role: 'user', text: user, createdAt: Date.now() - 60000 },
      { id: 'a-seed', role: 'agent', text: reply, thoughts, versionId: record.tool.versionId, createdAt: Date.now() - 30000, status: 'done' },
    ];
    const tx = db.transaction('chats', 'readwrite');
    tx.objectStore('chats').put({ key: `scope:${scope}:tool:${id}`, messages });
    await new Promise((res) => { tx.oncomplete = res; });
    db.close();
  }, { id, user: USER, thoughts: THOUGHTS, reply: REPLY });
  process.env.PROBE_PATH = `/media/tool/${id}?mode=EDIT`;
  await geometry({ ...ctx, goTarget: (t) => go(t) });
  await ctx.shot('builder-seeded');
};
