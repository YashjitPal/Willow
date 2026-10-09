// The remote-browser parts of a cdp-kit dump, one line each: header, title, close, viewer, the
// bottom container and its buttons, the in-control bar, the keyboard bar, the disclaimer.
//   node tools/scratch/rb-dump-key.cjs <dump.json>…
const fs = require('fs');

const PARTS = /(^|\s)(fullscreen-panel|container|header|header-left|header-right|title|floating-container|iframe-container|scrim|bottom-container|in-control-container|left-container|right-container|keyboard-button|click-button|mobile-[a-z-]+-button|navigation-button|computer-use-disclaimer|chat-input-container|form-field|mat-mdc-text-field-wrapper|input-field|send-button|mobile-overlay-[a-z-]+|side-panel-content|computer-use-close-button)(\s|$)/;
const KEEP = ['width', 'height', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginBottom', 'gap', 'backgroundColor', 'color', 'borderRadius', 'borderTopWidth', 'borderTopColor', 'fontSize', 'fontWeight', 'lineHeight', 'fontVariationSettings', 'boxShadow', 'position', 'top', 'bottom', 'left', 'opacity', 'maxWidth', 'justifyContent', 'flexWrap', 'zIndex', 'animationName', 'animationDuration'];

for (const file of process.argv.slice(2)) {
  const dump = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(`\n== ${file.split(/[\\/]/).pop()}  viewport ${JSON.stringify(dump.viewport)}`);
  for (const node of dump.nodes) {
    const cls = typeof node.cls === 'string' ? node.cls : '';
    if (!PARTS.test(cls) && !['mat-icon', 'input'].includes(node.tag)) continue;
    if (node.tag === 'mat-icon' && !/remote|monitor|keyboard|web_traffic|history|youtube_live|close|backspace|send|chevron/.test(JSON.stringify(node.attrs || {}))) continue;
    const cs = Object.fromEntries(KEEP.filter((k) => node.cs?.[k] !== undefined && node.cs[k] !== 'none' && node.cs[k] !== 'normal' && node.cs[k] !== '0px').map((k) => [k, node.cs[k]]));
    const name = node.attrs?.['data-mat-icon-name'] || node.attrs?.['aria-label'] || node.attrs?.placeholder || '';
    console.log(`${'  '.repeat(Math.min(node.d, 8))}${node.tag}.${cls.split(/\s+/).filter((c) => PARTS.test(` ${c} `) || /full-screen|in-control|selected|is-remy/.test(c)).join('.')} ${JSON.stringify(node.rect.map((n) => Math.round(n * 10) / 10))}${name ? ` "${name}"` : ''}${node.text ? ` "${node.text.slice(0, 40)}"` : ''} ${JSON.stringify(cs)}`);
  }
}
