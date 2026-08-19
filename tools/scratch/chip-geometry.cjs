/** Full computed geometry of Gemini's source chip internals vs Willow's. Read-only. */
const { connect, save } = require('../ui-research/scrapers/notebooks/lib.cjs');

const PROBE = `(rootSel) => {
  const PROPS = ['display','position','alignItems','justifyContent','gap','width','height','margin','marginLeft','marginRight','padding','border','borderRadius','backgroundColor','boxShadow','objectFit','overflow','zIndex','fontSize','fontWeight','fontFamily','lineHeight','color','flexDirection','outline','transform'];
  const root = document.querySelector(rootSel);
  if (!root) return { error: 'not found: ' + rootSel };
  const walk = (el, depth) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const styles = {};
    for (const p of PROPS) styles[p] = cs[p];
    const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).filter(Boolean).join(' ');
    return {
      tag: el.tagName.toLowerCase(),
      cls: el.className && el.className.toString ? el.className.toString() : '',
      src: el.getAttribute && el.getAttribute('src') || undefined,
      text: own || undefined,
      rect: { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 },
      styles,
      children: depth < 12 ? Array.from(el.children).map((c) => walk(c, depth + 1)) : [],
    };
  };
  return walk(root, 0);
}`;

const flat = (node, depth = 0, out = []) => {
  if (node.error) return [node];
  const pad = '  '.repeat(depth);
  out.push(`${pad}${node.tag}.${node.cls.split(' ').slice(0, 2).join('.')} ${node.rect.w}x${node.rect.h} @${node.rect.x},${node.rect.y}`
    + (node.text ? ` "${node.text}"` : '')
    + (node.src ? ` src=${node.src}` : ''));
  const s = node.styles;
  out.push(`${pad}   d=${s.display} pad=${s.padding} m=${s.margin} r=${s.borderRadius} bg=${s.backgroundColor} gap=${s.gap} ai=${s.alignItems} bd=${s.border} shadow=${s.boxShadow}`);
  out.push(`${pad}   font=${s.fontSize}/${s.lineHeight} w=${s.fontWeight} color=${s.color} objectFit=${s.objectFit}`);
  for (const c of node.children || []) flat(c, depth + 1, out);
  return out;
};

(async () => {
  const browser = await connect();
  try {
    const pages = await browser.pages();
    for (const [tag, match, sel] of [
      ['gemini', /gemini\.google\.com\/notebook/, 'gem-source-list-chip'],
      ['willow', /localhost:3000\/notebook/, '.nb-source-chip'],
    ]) {
      const page = pages.find((p) => match.test(p.url()));
      if (!page) { console.log(`no ${tag} tab`); continue; }
      const data = await page.evaluate(new Function('return ' + PROBE)(), sel);
      save(`src-chip/${tag}-geometry.json`, data);
      console.log(`\n=== ${tag}`);
      console.log(flat(data).join('\n'));
    }
  } finally {
    await browser.disconnect();
  }
})();
