/**
 * The `@willow/*` alias map, read from tsconfig.base.json.
 *
 * esbuild has no notion of tsconfig `paths` when the entry point sits outside
 * the tsconfig's directory, and hand-maintaining a second copy of the map is
 * how the two silently drift. Both esbuild-based scripts in this folder call
 * `willowAliasPlugin()` instead.
 */
import fs from 'node:fs';
import path from 'node:path';

const EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.json'];

/**
 * Split `compilerOptions.paths` into exact aliases ("@models") and prefix
 * aliases ("@willow/core/*"), resolved to absolute paths.
 *
 * tsconfig.base.json is strict JSON — its "//" entries are ordinary keys, not
 * comments — so plain JSON.parse is safe here.
 */
export function readTsconfigAliases(repoRoot) {
  const tsconfig = JSON.parse(fs.readFileSync(path.join(repoRoot, 'tsconfig.base.json'), 'utf8'));
  const paths = tsconfig.compilerOptions?.paths ?? {};
  const exact = new Map();
  const prefixes = [];

  for (const [pattern, targets] of Object.entries(paths)) {
    const target = targets?.[0];
    if (!target) continue;
    if (pattern.endsWith('/*')) {
      prefixes.push({ from: pattern.slice(0, -1), to: path.join(repoRoot, target.slice(0, -1)) });
    } else {
      exact.set(pattern, path.join(repoRoot, target));
    }
  }

  // Longest prefix first: "@willow/agent-builder/" must beat any shorter
  // "@willow/a…" entry that also matches.
  prefixes.sort((a, b) => b.from.length - a.from.length);

  // tsconfig points "path" at a package directory; esbuild needs the file.
  exact.set('path', path.join(repoRoot, 'node_modules/path-browserify/index.js'));

  return { exact, prefixes };
}

/** Add the extension / index.* that the import specifier left off. */
export function resolveLocal(candidate) {
  const attempts = [
    candidate,
    ...EXTENSIONS.map((extension) => `${candidate}${extension}`),
    ...EXTENSIONS.map((extension) => path.join(candidate, `index${extension}`)),
  ];
  return attempts.find((attempt) => {
    try { return fs.statSync(attempt).isFile(); }
    catch { return false; }
  });
}

/** esbuild plugin that resolves every alias declared in tsconfig.base.json. */
export function willowAliasPlugin(repoRoot) {
  const { exact, prefixes } = readTsconfigAliases(repoRoot);
  return {
    name: 'willow-aliases',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        const exactTarget = exact.get(args.path);
        if (exactTarget) return { path: resolveLocal(exactTarget) ?? exactTarget };

        for (const { from, to } of prefixes) {
          if (!args.path.startsWith(from)) continue;
          const candidate = path.join(to, args.path.slice(from.length));
          return { path: resolveLocal(candidate) ?? candidate };
        }
        return undefined;
      });
    },
  };
}
