/**
 * Prints a capture's nodes (from capture-nodes.cjs / gemini-open-capture.cjs) with their styles.
 * Usage: node print-capture-nodes.cjs <capture.json> [/start pattern/] [count]
 */
const fs = require('fs');
const [file, pattern, countArg] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const nodes = data.nodes || [];
const re = pattern ? new RegExp(pattern.replace(/^\/|\/$/g, '')) : null;
const start = re ? Math.max(0, nodes.findIndex((n) => re.test(`${n.tag}.${n.cls || ''} ${n.testId || ''} ${n.text || ''}`))) : 0;
const count = Number(countArg) || 60;
for (const n of nodes.slice(start, start + count)) {
  const c = n.cs || {};
  const label = `${n.tag}.${(n.cls || '').split(' ').slice(0, 3).join('.')}`.slice(0, 58);
  const text = (n.icon || n.text || '').replace(/\s+/g, ' ').slice(0, 30);
  const style = [
    c.font, c.fvs && c.fvs.replace(/"/g, ''), c.color, c.bg && `bg:${c.bg}`, c.radius && `r:${c.radius}`,
    c.padding && `p:${c.padding}`, c.border && `b:${c.border}`, c.margin && `m:${c.margin}`, c.flex, c.shadow && `sh:${c.shadow.slice(0, 60)}`,
  ].filter(Boolean).join(' | ');
  console.log(label.padEnd(58), text.padEnd(30), JSON.stringify(n.rect).padEnd(32), style);
}
