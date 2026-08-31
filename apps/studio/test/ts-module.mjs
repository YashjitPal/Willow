/**
 * Import a TypeScript source module from a test.
 *
 * The other tests in this directory read sources as text and assert on the text,
 * which is enough for constants but cannot exercise behaviour: a class like the
 * voice orb's speaking gate has to actually run to be worth testing, and a
 * re-implementation in the test file would only be testing itself.
 *
 * `esbuild-wasm` is already a dependency (the production build script uses it),
 * so type-stripping is available without adding a loader. Transpiled modules are
 * imported as `data:` URLs; those cannot resolve relative specifiers, so a
 * module's own imports are transpiled first and their specifiers rewritten to the
 * resulting data URLs. Cyclic imports are not supported and throw.
 *
 * `@willow/*` specifiers are followed too, because a module that crosses a
 * package boundary uses the alias rather than a `../../` path — refusing them
 * would mean the only importable modules are the ones that happen to be
 * self-contained. The alias map is parsed out of `apps/studio/vite.config.ts`
 * rather than restated here, so a test cannot resolve a specifier differently
 * from the build.
 *
 * Bare specifiers (`nanostores`) resolve to a `file:` URL in node_modules and
 * are handed to Node untranspiled. A `data:` URL module has no parent to resolve
 * against, so before this a module under test could not import any real
 * dependency — the import failed with `ERR_UNSUPPORTED_RESOLVE_REQUEST` naming
 * only the package, which reads like a missing install rather than a loader
 * limit. They are deliberately NOT walked: published JS needs no type-stripping,
 * and recursing into a package's own tree would transpile hundreds of files to
 * reach one export.
 *
 * Vite's `?raw` and `?url` suffixes are honoured, and `.json` is imported as its
 * parsed value — all three are things Vite resolves specially, so a module using
 * them would otherwise be untestable here.
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import esbuild from 'esbuild-wasm';

let initialized = null;

const ensureEsbuild = async () => {
  initialized ??= esbuild.initialize({ worker: false });
  await initialized;
};

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

/**
 * `{ find: "@willow/x", replacement: path.resolve(ROOT, "y/z") }` -> `{ "@willow/x": "<abs>/y/z" }`.
 *
 * Longest find first, so `@willow/agent-builder` is not shadowed by a shorter
 * alias that happens to prefix it.
 */
const willowAliases = () => {
  const config = fs.readFileSync(
    path.join(REPO_ROOT, 'apps/studio/vite.config.ts'),
    'utf8',
  );
  const entries = [
    ...config.matchAll(
      /\{\s*find:\s*["'](@willow\/[^"']+)["']\s*,\s*replacement:\s*path\.resolve\(\s*ROOT\s*,\s*["']([^"']+)["']\s*\)\s*\}/g,
    ),
  ].map(([, find, target]) => [find, path.resolve(REPO_ROOT, target)]);
  if (entries.length === 0) throw new Error('no @willow aliases found in vite.config.ts');
  return entries.sort(([a], [b]) => b.length - a.length);
};

let aliasCache = null;

/**
 * Every specifier in a source file. Relative and `@willow/*` ones are
 * transpiled and rewritten; bare package names are resolved to a file URL;
 * `node:` builtins are left exactly as written.
 */
const ANY_IMPORT_SPECIFIER = /(\bfrom\s*|\bimport\s*)(['"])([^'"]+)\2/g;

/**
 * `import type { X } from './y'` — a statement esbuild erases outright.
 *
 * Following one is not merely wasted work: it invents import cycles that do not
 * exist at runtime. `canvas-store.ts` takes `ChatMsg` from `chat-message.ts`,
 * which takes `CanvasRef` back from `canvas-store.ts`, and both are type-only —
 * the transpiled modules do not reference each other at all, but walking the
 * specifiers as if they were values throws `import cycle` and makes the whole
 * subsystem untestable.
 *
 * Bounded on `[^;]` so it cannot run past the end of one statement into the
 * `from` of a later import.
 */
const TYPE_ONLY_IMPORT = /\bimport\s+type\s+[^;]*?\bfrom\s*(['"])([^'"]+)\1/g;

const isBuiltin = (specifier) => specifier.startsWith('node:');

const isBare = (specifier) =>
  !specifier.startsWith('.') && !specifier.startsWith('@willow/') && !isBuiltin(specifier);

/**
 * Vite query suffixes this understands.
 *
 * `?raw` hands back the file's text as the default export — the repo imports
 * shaders and, in the Code tab's Agent harness, vendored prompt files that way. `?url`
 * hands back a path string, matching the asset stub below.
 *
 * The suffix is stripped before resolution and remembered, because the file on
 * disk has no `?raw` in its name.
 */
const splitQuery = (specifier) => {
  const at = specifier.indexOf('?');
  if (at === -1) return { path: specifier, query: '' };
  return { path: specifier.slice(0, at), query: specifier.slice(at + 1) };
};

const requireFromRepo = createRequire(path.join(REPO_ROOT, 'package.json'));

/**
 * A bare specifier as a `file:` URL Node can import.
 *
 * `require.resolve` follows `main`/`exports` the same way the runtime would, so
 * this lands on the file the app would load. Unresolvable specifiers are left
 * alone: the import then fails naming the package, which is the right error for
 * something genuinely not installed.
 *
 * A package's own stylesheet is the exception. `import 'katex/dist/katex.min.css'`
 * is a side effect Vite performs and a test can never observe, but handing the
 * `.css` file to Node fails the whole import with `Unknown file extension ".css"`
 * — naming a stylesheet, from a test that only wanted a helper function three
 * modules away. It stubs to an empty module. A bare specifier landing on an
 * image or a font gets the same URL-string stub a relative one would.
 */
const resolveBare = (specifier) => {
  let resolved;
  try {
    resolved = requireFromRepo.resolve(specifier);
  } catch {
    return null;
  }
  if (STYLE_EXTENSIONS.has(path.extname(resolved).toLowerCase())) return toDataUrl('');
  if (isAsset(resolved)) return toDataUrl(`export default ${JSON.stringify(resolved)};`);
  return pathToFileURL(resolved).href;
};

/** Extensions Vite injects as a stylesheet rather than evaluating as a module. */
const STYLE_EXTENSIONS = new Set(['.css', '.scss', '.sass', '.less', '.styl']);

const EXTENSIONS = ['.ts', '.tsx', '.mts', '/index.ts', '/index.tsx'];

/** Resolve an extensionless relative or `@willow/*` specifier. */
const resolveSpecifier = (fromFile, specifier) => {
  let base;
  if (specifier.startsWith('@willow/')) {
    aliasCache ??= willowAliases();
    const hit = aliasCache.find(
      ([find]) => specifier === find || specifier.startsWith(`${find}/`),
    );
    if (!hit) throw new Error(`no @willow alias matches ${specifier}`);
    const [find, target] = hit;
    base = path.join(target, specifier.slice(find.length));
  } else {
    base = path.resolve(path.dirname(fromFile), specifier);
  }
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  for (const extension of EXTENSIONS) {
    const candidate = `${base}${extension}`;
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`cannot resolve ${specifier} from ${fromFile}`);
};

const toDataUrl = (code) =>
  `data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`;

/**
 * Asset extensions Vite resolves to a URL string rather than a module.
 *
 * A module that imports one (`platform/core/src/file-type-icons.ts` imports 30 PNGs)
 * would otherwise be read as UTF-8 and handed to esbuild, which fails on the first
 * non-text byte. Vite's own behaviour is to hand back a URL string, so these stub to
 * the file path — enough for a test to assert an icon resolved without embedding bytes.
 *
 * Only extensions imported for their URL are listed. `.glsl` is deliberately absent:
 * this repo imports shaders as `?raw`, where Vite hands back the file's text instead,
 * and a URL stub would be quietly wrong.
 */
const ASSET_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.bmp',
  '.svg', '.mp3', '.wav', '.woff', '.woff2', '.cur',
]);

const isAsset = (file) => ASSET_EXTENSIONS.has(path.extname(file).toLowerCase());

/**
 * Transpile `file` and every relative module it reaches, returning a data URL.
 *
 * `cache` keys absolute paths to data URLs so a module imported twice is
 * transpiled once and keeps a single instance, which matters for modules holding
 * state. `pending` carries the current import chain to name a cycle if one exists.
 */
const buildModule = async (file, cache, pending, query = '') => {
  const absolute = path.resolve(file);
  // Keyed with the query: the same file imported both normally and as `?raw`
  // is two different modules.
  const key = query ? `${absolute}?${query}` : absolute;
  const cached = cache.get(key);
  if (cached) return cached;

  if (pending.includes(key)) {
    const cycle = [...pending, key].map((entry) => path.basename(entry)).join(' -> ');
    throw new Error(`import cycle: ${cycle}`);
  }

  // `?raw` is the file's text; `?url` is its path. Both terminate the walk —
  // neither is a module with imports of its own.
  if (query === 'raw') {
    const url = toDataUrl(
      `export default ${JSON.stringify(fs.readFileSync(absolute, 'utf8'))};`,
    );
    cache.set(key, url);
    return url;
  }
  if (query === 'url') {
    const url = toDataUrl(`export default ${JSON.stringify(absolute)};`);
    cache.set(key, url);
    return url;
  }

  // An asset is a URL string to Vite, not a module. Stand one up rather than reading
  // binary through esbuild.
  if (isAsset(absolute)) {
    const url = toDataUrl(`export default ${JSON.stringify(absolute)};`);
    cache.set(key, url);
    return url;
  }

  // A stylesheet is a side effect Vite performs; esbuild's `ts` loader would try to
  // parse the CSS as TypeScript and fail on the first selector.
  if (STYLE_EXTENSIONS.has(path.extname(absolute).toLowerCase())) {
    const url = toDataUrl('');
    cache.set(key, url);
    return url;
  }

  // JSON is a module whose default export is the parsed value. esbuild's `ts`
  // loader would read it as a statement and produce nonsense.
  if (absolute.endsWith('.json')) {
    const url = toDataUrl(`export default ${fs.readFileSync(absolute, 'utf8')};`);
    cache.set(key, url);
    return url;
  }

  const source = fs.readFileSync(absolute, 'utf8');
  const specifiers = new Map();
  // Ranges of the type-only imports, so their specifiers can be left where they
  // are. A path imported both as a type and as a value still gets walked: the
  // value occurrence falls outside every range.
  const typeRanges = [...source.matchAll(TYPE_ONLY_IMPORT)]
    .map((match) => [match.index, match.index + match[0].length]);
  const valueOccurrence = (at) => !typeRanges.some(([from, to]) => at >= from && at < to);
  const walkable = new Set();
  for (const match of source.matchAll(ANY_IMPORT_SPECIFIER)) {
    if (valueOccurrence(match.index)) walkable.add(match[3]);
  }
  for (const [, , , specifier] of source.matchAll(ANY_IMPORT_SPECIFIER)) {
    if (specifiers.has(specifier)) continue;
    if (isBuiltin(specifier)) continue;
    if (!walkable.has(specifier)) continue;
    if (isBare(specifier)) {
      const url = resolveBare(specifier);
      if (url) specifiers.set(specifier, url);
      continue;
    }
    const { path: bare, query } = splitQuery(specifier);
    const target = resolveSpecifier(absolute, bare);
    specifiers.set(
      specifier,
      await buildModule(target, cache, [...pending, key], query),
    );
  }

  const rewritten = source.replace(
    ANY_IMPORT_SPECIFIER,
    (match, keyword, quote, specifier) => {
      const url = specifiers.get(specifier);
      return url ? `${keyword}${quote}${url}${quote}` : match;
    },
  );

  const { code } = await esbuild.transform(rewritten, {
    loader: absolute.endsWith('x') ? 'tsx' : 'ts',
    format: 'esm',
    target: 'es2022',
  });

  const url = toDataUrl(code);
  cache.set(key, url);
  return url;
};

/** Transpile a TypeScript module and its relative imports, then import it. */
export const importTs = async (file) => {
  await ensureEsbuild();
  const url = await buildModule(file, new Map(), []);
  return import(url);
};
