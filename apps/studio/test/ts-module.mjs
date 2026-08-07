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
 */

import fs from 'node:fs';
import path from 'node:path';

import esbuild from 'esbuild-wasm';

let initialized = null;

const ensureEsbuild = async () => {
  initialized ??= esbuild.initialize({ worker: false });
  await initialized;
};

const RELATIVE_IMPORT = /(\bfrom\s*|\bimport\s*)(['"])(\.[^'"]*)\2/g;

const EXTENSIONS = ['.ts', '.tsx', '.mts', '/index.ts', '/index.tsx'];

/** Resolve an extensionless relative specifier against the importing file. */
const resolveSpecifier = (fromFile, specifier) => {
  const base = path.resolve(path.dirname(fromFile), specifier);
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

  const source = fs.readFileSync(absolute, 'utf8');
  const specifiers = new Map();
  for (const [, , , specifier] of source.matchAll(RELATIVE_IMPORT)) {
    if (specifiers.has(specifier)) continue;
    const target = resolveSpecifier(absolute, specifier);
    specifiers.set(
      specifier,
      await buildModule(target, cache, [...pending, absolute]),
    );
  }

  const rewritten = source.replace(
    RELATIVE_IMPORT,
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
