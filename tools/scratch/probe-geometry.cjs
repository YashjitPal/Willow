// Flow's dumped boxes against Willow's: every dumped node with a class of its own (not Material's
// plumbing) under each ROOT is paired, in order, with Willow's element of the same classes, and
// sizes that differ by more than 2px are listed. Flow's hosts (`flow-x`) are Willow's `.ng-flow-x`.
//   DUMP=edit-mode-edit ROOT=flow-applet-view-header,flow-applet-chat-sidebar PROBE_PATH=/media/tool/{copy}?mode=EDIT \
//     node tools/scratch/w-tools-probe.cjs tools/scratch/probe-geometry.cjs
const fs = require('fs');
const path = require('path');

const PLUMBING = /^(mat-|mdc-|cdk-|ng-|notranslate$|google-symbols$|flow-button-|flow-icon-button-|flow-icon-[smlx]+$|fill$|editable$)/;

function flowNodes(dump, root) {
  const json = JSON.parse(fs.readFileSync(path.join(__dirname, '../ui-research/captures/flow/tools/dump', `${dump}.json`), 'utf8'));
  const nodes = json.nodes || json;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const isUnder = (n, rootId) => { for (let p = n; p; p = byId.get(p.p)) if (p.id === rootId) return true; return false; };
  const rootNode = nodes.find((n) => n.tag === root || (n.cls || '').split(' ').includes(root));
  if (!rootNode) throw new Error(`no ${root} in ${dump}`);
  return nodes.filter((n) => isUnder(n, rootNode.id)).map((n) => {
    const own = (n.cls || '').split(' ').filter((c) => c && !PLUMBING.test(c));
    const host = n.tag.startsWith('flow-') ? `ng-${n.tag}` : null;
    const classes = host ? [host, ...own] : own;
    return classes.length ? { classes, rect: n.rect, text: n.text } : null;
  }).filter(Boolean);
}

module.exports = async ({ page, goTarget, sleep, waitFor }) => {
  const dump = process.env.DUMP;
  const roots = process.env.ROOT.split(',');
  await goTarget(process.env.PROBE_PATH || '/media/tools');
  const first = roots[0].startsWith('flow-') ? `.ng-${roots[0]}` : `.${roots[0]}`;
  await waitFor((s) => document.querySelector(s), first, 60000);
  await sleep(Number(process.env.PROBE_WAIT || 2000));
  const action = process.env.PROBE_ACTION_FILE ? fs.readFileSync(process.env.PROBE_ACTION_FILE, 'utf8') : process.env.PROBE_ACTION;
  if (action) { await page.evaluate(action); await sleep(1000); }
  for (const root of roots) {
    const flow = flowNodes(dump, root);
    const rootSel = root.startsWith('flow-') ? `.ng-${root}` : `.${root}`;
    const willow = await page.evaluate((rs, wanted) => {
      const rootEl = document.querySelector(rs);
      const used = new Map();
      return wanted.map((w) => {
        const sel = w.classes.map((c) => `.${CSS.escape(c)}`).join('');
        const all = rootEl ? [...rootEl.querySelectorAll(sel)] : [];
        if (rootEl?.matches(sel)) all.unshift(rootEl);
        const k = used.get(sel) ?? 0;
        used.set(sel, k + 1);
        const el = all[k];
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return [r.x, r.y, r.width, r.height];
      });
    }, rootSel, flow);
    const rows = [];
    flow.forEach((f, i) => {
      const w = willow[i];
      const label = `${f.classes.join('.')}${f.text ? ` "${String(f.text).slice(0, 30)}"` : ''}`;
      if (!w) { rows.push(`  MISSING ${label} flow=${f.rect.map(Math.round).join(',')}`); return; }
      const dw = Math.round(w[2] - f.rect[2]);
      const dh = Math.round(w[3] - f.rect[3]);
      if (Math.abs(dw) > 2 || Math.abs(dh) > 2) rows.push(`  SIZE ${label} flow=${f.rect.slice(2).map(Math.round).join('x')} willow=${w.slice(2).map(Math.round).join('x')}`);
    });
    console.log(`${root}: ${flow.length} nodes, ${rows.length} off`);
    if (rows.length) console.log(rows.join('\n'));
  }
};
