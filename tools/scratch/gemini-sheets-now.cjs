/**
 * Saves every stylesheet the Gemini tab has right now (including lazily injected component
 * styles) to tools/ui-research/captures/spark/134-remote-browser/stylesheets-<label>.css.
 * Read-only; does not navigate.
 *
 *   node tools/scratch/gemini-sheets-now.cjs <label>
 */
const { session } = require('../../.agents/skills/clone-google-app-ui/scripts/cdp-kit.cjs');

(async () => {
  const label = process.argv[2] || 'now';
  const s = await session({ tab: 'gemini', out: 'tools/ui-research/captures/spark/134-remote-browser' });
  try { await s.sheets(label); } finally { await s.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
