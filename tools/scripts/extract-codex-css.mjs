#!/usr/bin/env node
/*
 * Regenerates a scoped copy of the Codex desktop app's stylesheet rules for the
 * classes a set of ported Codex components use, so they cannot reach the rest
 * of Willow:
 *
 *   node tools/scripts/extract-codex-css.mjs <codex-css-dir> --scope .willow-dots \
 *     --out features/spark/src/dots/codex-dots.css --scan features/spark/src/dots
 *   node tools/scripts/extract-codex-css.mjs <codex-css-dir> --scope .willow-spaces --component-css \
 *     --out features/spark/src/spaces/codex-spaces.css --scan features/spark/src/spaces --scan features/spark/src/codex
 *
 * <codex-css-dir> holds Codex's extracted CSS bundles and the index.css that
 * imports them in load order (the Codex dots clone keeps them in
 * src/styles/vendor). Rules keep Codex's cascade order and media/supports
 * wrappers; cascade layers are dropped so the rules compete with Willow's
 * unlayered Tailwind by specificity, which the scope always wins. Codex's
 * non-colour theme tokens are copied onto the scope; its colour tokens are left
 * to the Willow theme file beside the output, which sets them to Willow's palette.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

const args = process.argv.slice(2);
const option = (name) => args.flatMap((arg, index) => (arg === name ? [args[index + 1]] : []));
const vendorDir = args[0];
const [scope] = option('--scope');
const [outArg] = option('--out');
const scanArgs = option('--scan');
// Component bundles (content, editor, page…) also style plain class names; without the flag only their CSS-module classes come along.
const componentCss = args.includes('--component-css');
if (!vendorDir || !scope || !outArg || scanArgs.length === 0) {
  console.error('usage: node tools/scripts/extract-codex-css.mjs <codex-css-dir> --scope <.class> --out <file.css> --scan <dir> [--scan <dir>...]');
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outFile = path.resolve(root, outArg);
const scanDirs = scanArgs.map((dir) => path.resolve(root, dir));
const mainBundles = /^(app-shared|app-initial|app-primary|index)\b/;
const hashed = /^_[A-Za-z0-9]+_[a-z0-9]{5}_\d+$/;

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
  });

// Every whitespace-separated word of every string literal is a candidate class name.
const tokens = new Set();
for (const file of scanDirs.flatMap(walk)) {
  for (const m of readFileSync(file, 'utf8').matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g)) {
    for (const token of (m[1] ?? m[2] ?? m[3]).replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) {
      if (token && token.length < 160) tokens.add(token);
    }
  }
}

const unescape = (name) =>
  name.replace(/\\([0-9a-fA-F]{1,6}\s?)/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16))).replace(/\\(.)/g, '$1');
const ownClasses = (selector) =>
  [...selector.replace(/:(?:where|is|not|has)\((?:[^()]|\([^()]*\))*\)/g, '').matchAll(/\.((?:\\[0-9a-fA-F]{1,6}\s?|\\.|[\w-])+)/g)].map((m) => unescape(m[1]));
const isGroupMarker = (cls) => /^(group|peer)(\/.*)?$/.test(cls);

const indexSource = readFileSync(path.join(vendorDir, 'index.css'), 'utf8');
const loadOrder = [...indexSource.matchAll(/@import\s+"\.\/([^"]+)"/g)].map((m) => m[1]);
for (const name of readdirSync(vendorDir)) {
  if (name.endsWith('.css') && name !== 'index.css' && !loadOrder.includes(name)) loadOrder.push(name);
}
loadOrder.push('index.css');

const kept = [];
const keyframes = new Map();
const rootVars = new Map();
let propertiesFallback = null;

// The selectors Codex's desktop window defines its tokens on (`:root`, `:where(:root),:where([data-theme])`,
// `:where([data-codex-window-type])`…), outside any media query; theme variants such as `[data-theme=dark]` are not.
const ROOT_PARTS = new Set([':root', ':host', '[data-theme]', '[data-codex-window-type]']);
const isRootSelector = (selector) =>
  selector
    .replace(/:where\(([^()]*)\)/g, '$1')
    .split(',')
    .every((part) => ROOT_PARTS.has(part.trim()));
const atTopLevel = (rule) => rule.parent?.type === 'root' || (rule.parent?.type === 'atrule' && rule.parent.name === 'layer' && rule.parent.parent?.type === 'root');

for (const name of loadOrder) {
  const isMain = mainBundles.test(name);
  const source = name === 'index.css' ? indexSource.replace(/@import[^;]+;/g, '') : readFileSync(path.join(vendorDir, name), 'utf8');
  const css = postcss.parse(source);
  css.walkAtRules('keyframes', (rule) => {
    if (!keyframes.has(rule.params)) keyframes.set(rule.params, rule.clone());
  });
  css.walkRules((rule) => {
    if (rule.parent?.type === 'atrule' && /keyframes$/.test(rule.parent.name)) return;
    if (isMain && atTopLevel(rule) && isRootSelector(rule.selector)) {
      rule.walkDecls(/^--/, (decl) => rootVars.set(decl.prop, decl.value));
      return;
    }
    if (isMain && propertiesFallback == null && /^\*,\s*:before/.test(rule.selector) && rule.nodes.some((node) => node.prop?.startsWith('--tw-'))) {
      propertiesFallback = rule.clone();
      return;
    }
    const selectors = rule.selectors.filter((selector) => {
      const own = ownClasses(selector);
      if (own.length === 0 || /^(:root|html|body|:host)\b/.test(selector.trim())) return false;
      if (!own.every((cls) => tokens.has(cls) || isGroupMarker(cls)) || !own.some((cls) => tokens.has(cls))) return false;
      return isMain || componentCss || own.some((cls) => hashed.test(cls));
    });
    if (selectors.length === 0) return;
    const wrappers = [];
    for (let parent = rule.parent; parent && parent.type !== 'root'; parent = parent.parent) {
      if (parent.type === 'rule') return;
      if (parent.type === 'atrule' && parent.name !== 'layer') wrappers.unshift(parent.clone({ nodes: [] }));
    }
    kept.push({ wrappers, rule: rule.clone({ selectors: selectors.map((selector) => `${scope} ${selector.trim()}`) }) });
  });
}

const out = postcss.root();
const usedVars = new Set();
const usedAnimations = new Set();
const seen = new Set();
for (const { wrappers, rule } of kept) {
  const key = wrappers.map((w) => `@${w.name} ${w.params}`).join('|') + rule.toString();
  if (seen.has(key)) continue;
  seen.add(key);
  rule.walkDecls((decl) => {
    for (const m of decl.value.matchAll(/var\(\s*(--[\w-]+)/g)) usedVars.add(m[1]);
    if (/^animation(-name)?$/.test(decl.prop)) for (const word of decl.value.split(/[\s,]+/)) usedAnimations.add(word);
  });
  let node = rule;
  for (let i = wrappers.length - 1; i >= 0; i -= 1) node = wrappers[i].append(node);
  out.append(node);
}

const themeVars = new Map();
const queue = [...usedVars];
while (queue.length) {
  const name = queue.pop();
  if (themeVars.has(name) || !rootVars.has(name)) continue;
  const value = rootVars.get(name);
  themeVars.set(name, value);
  for (const m of value.matchAll(/var\(\s*(--[\w-]+)/g)) queue.push(m[1]);
  if (name.startsWith('--animate-')) for (const word of value.split(/[\s,]+/)) usedAnimations.add(word);
}
const isColourToken = (name) => /^--(color-|shadow-color$)/.test(name);
const themeBlock = postcss.rule({ selector: scope });
for (const [name, value] of [...themeVars].sort()) if (!isColourToken(name)) themeBlock.append({ prop: name, value });
out.prepend(themeBlock);
if (propertiesFallback) {
  out.prepend(propertiesFallback.clone({ selectors: [`${scope} *`, `${scope} ::before`, `${scope} ::after`, `${scope} ::backdrop`] }));
}
for (const [name, rule] of keyframes) if (usedAnimations.has(name)) out.append(rule);

const header = `/*
 * Codex's stylesheet rules for the classes the ported Codex components use,
 * scoped under \`${scope}\`. Generated by tools/scripts/extract-codex-css.mjs
 * from the Codex desktop app's CSS; do not edit by hand. Willow's colours for
 * the Codex tokens are in the theme file beside it.
 */
`;
writeFileSync(outFile, header + out.toString());
console.log(`${seen.size} rules, ${themeVars.size} theme tokens -> ${path.relative(root, outFile)}`);
