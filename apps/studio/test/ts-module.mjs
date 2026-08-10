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
 */

import fs from 'node:fs';
import path from 'node:path';

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

const IMPORT_SPECIFIER = /(\bfrom\s*|\bimport\s*)(['"])((?:\.|@willow\/)[^'"]*)\2/g;

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
const buildModule = async (file, cache, pending) => {
  const absolute = path.resolve(file);
  const cached = cache.get(absolute);
  if (cached) return cached;

  if (pending.includes(absolute)) {
    const cycle = [...pending, absolute].map((entry) => path.basename(entry)).join(' -> ');
    throw new Error(`import cycle: ${cycle}`);
  }

  // An asset is a URL string to Vite, not a module. Stand one up rather than reading
  // binary through esbuild.
  if (isAsset(absolute)) {
    const url = toDataUrl(`export default ${JSON.stringify(absolute)};`);
    cache.set(absolute, url);
    return url;
  }

  const source = fs.readFileSync(absolute, 'utf8');
  const specifiers = new Map();
  for (const [, , , specifier] of source.matchAll(IMPORT_SPECIFIER)) {
    if (specifiers.has(specifier)) continue;
    const target = resolveSpecifier(absolute, specifier);
    specifiers.set(
      specifier,
      await buildModule(target, cache, [...pending, absolute]),
    );
  }

  const rewritten = source.replace(
    IMPORT_SPECIFIER,
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
  cache.set(absolute, url);
  return url;
};

/** Transpile a TypeScript module and its relative imports, then import it. */
export const importTs = async (file) => {
  await ensureEsbuild();
  const url = await buildModule(file, new Map(), []);
  return import(url);
};
