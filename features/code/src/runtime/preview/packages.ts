/**
 * npm packages for the in-browser preview, loaded from esm.sh.
 *
 * The preview has no package manager and no node_modules, so a bare import such
 * as `lucide-react` is resolved to an ES module on esm.sh, downloaded once, and
 * bundled into the preview like any project file. React and React DOM are the
 * exception: the preview page already loads them as UMD globals, and a second
 * copy would break hooks, so every package is fetched with `external=react,react-dom`
 * and its React imports resolve to the page's copy at runtime.
 *
 * Versions come from the project's `/package.json` when it declares the package,
 * and esm.sh resolves semver ranges itself. An undeclared package still loads,
 * at its latest version, and `undeclaredPackages` lets a strict build say so.
 */

export const CDN_ORIGIN = 'https://esm.sh';

/** The namespace esbuild uses for modules that came from the CDN. */
export const CDN_NAMESPACE = 'willow-cdn';

/**
 * Packages the preview page provides itself.
 *
 * Matches `react`, `react-dom` and their subpaths (`react/jsx-runtime`,
 * `react-dom/client`) and nothing else — `react-router-dom` and `react-icons`
 * are ordinary packages.
 */
export const RUNTIME_PROVIDED = /^react(-dom)?(\/.*)?$/;

/**
 * Node built-ins. There is no Node process behind the preview, so importing one
 * is always a mistake worth naming rather than a package to download.
 */
const NODE_BUILTINS = new Set([
  'assert', 'buffer', 'child_process', 'cluster', 'crypto', 'dgram', 'dns', 'events',
  'fs', 'fs/promises', 'http', 'http2', 'https', 'module', 'net', 'os', 'path',
  'perf_hooks', 'process', 'querystring', 'readline', 'stream', 'string_decoder',
  'timers', 'tls', 'tty', 'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib',
]);

export const isNodeBuiltin = (specifier: string): boolean =>
  specifier.startsWith('node:') || NODE_BUILTINS.has(specifier);

/**
 * Packages whose esm.sh build is large because it bundles every export.
 *
 * For these, a build that only uses named imports asks esm.sh for exactly those
 * exports (`?exports=`), which turns a ~1MB icon library into a few kilobytes.
 * Kept to a list because the optimisation is only safe for packages whose
 * named exports are independent of one another.
 */
const TREE_SHAKEN_PACKAGES = [
  'lucide-react',
  '@tabler/icons-react',
  '@phosphor-icons/react',
  '@heroicons/react',
  '@radix-ui/react-icons',
  'react-icons',
  'date-fns',
];

export interface PackageSpecifier {
  name: string;
  /** Includes the leading slash, or is empty. */
  subpath: string;
}

export function splitPackageSpecifier(specifier: string): PackageSpecifier {
  const parts = specifier.split('/');
  if (specifier.startsWith('@') && parts.length >= 2) {
    return { name: `${parts[0]}/${parts[1]}`, subpath: parts.length > 2 ? `/${parts.slice(2).join('/')}` : '' };
  }
  return { name: parts[0]!, subpath: parts.length > 1 ? `/${parts.slice(1).join('/')}` : '' };
}

const VALID_PACKAGE_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;

export const isValidPackageName = (name: string): boolean => VALID_PACKAGE_NAME.test(name);

/** `dependencies`, `devDependencies` and `peerDependencies` of `/package.json`. */
export function readProjectDependencies(files: Record<string, string>): Record<string, string> {
  const manifest = files['/package.json'] ?? files['/src/package.json'];
  if (!manifest) return {};
  try {
    const parsed = JSON.parse(manifest) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const field of ['peerDependencies', 'devDependencies', 'dependencies']) {
      const block = parsed[field];
      if (!block || typeof block !== 'object') continue;
      for (const [name, version] of Object.entries(block as Record<string, unknown>)) {
        if (typeof version === 'string') out[name] = version;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * A `package.json` range in the form esm.sh accepts, or `''` for latest.
 *
 * Protocols npm understands and a CDN cannot (`workspace:`, `file:`, git URLs)
 * fall back to latest rather than producing a URL that 404s.
 */
export function cleanVersion(range: string | undefined): string {
  if (!range) return '';
  let value = range.trim();
  if (value.startsWith('npm:')) {
    const at = value.lastIndexOf('@');
    value = at > 4 ? value.slice(at + 1) : '';
  }
  if (!value || value === '*' || value === 'latest' || value === 'x') return '';
  if (/^(workspace|file|link|git|github|http|https):/i.test(value) || value.includes('/')) return '';
  return value.replace(/\s+/g, '');
}

type ImportUse = Set<string> | 'all';

const IMPORT_STATEMENT = /\bimport\s+(type\s+)?([\s\S]*?)\s*from\s*['"]([^'"\n]+)['"]/g;
const SIDE_EFFECT_IMPORT = /\bimport\s*['"]([^'"\n]+)['"]/g;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g;
const REEXPORT = /\bexport\s+(type\s+)?(\*(?:\s+as\s+\w+)?|\{[\s\S]*?\})\s*from\s*['"]([^'"\n]+)['"]/g;

const isBareSpecifier = (specifier: string): boolean =>
  !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('@/') &&
  !/^[a-z]+:/i.test(specifier);

/**
 * How each bare specifier is imported across the project.
 *
 * A set of names when every import is named, `'all'` as soon as one is a
 * default, namespace, side-effect or dynamic import — those need the whole
 * module. Type-only imports are skipped; they are erased before bundling.
 */
export function collectPackageImports(files: Record<string, string>): Map<string, ImportUse> {
  const uses = new Map<string, ImportUse>();
  const markAll = (specifier: string) => uses.set(specifier, 'all');
  const addNames = (specifier: string, names: string[]) => {
    const current = uses.get(specifier);
    if (current === 'all') return;
    const next = current ?? new Set<string>();
    for (const name of names) next.add(name);
    uses.set(specifier, next);
  };

  for (const [path, source] of Object.entries(files)) {
    if (!/\.(tsx?|jsx?|mjs)$/.test(path)) continue;

    for (const match of source.matchAll(IMPORT_STATEMENT)) {
      const [, typeOnly, clause, specifier] = match;
      if (!specifier || !isBareSpecifier(specifier) || typeOnly) continue;
      const trimmed = clause!.trim();
      const braces = /\{([\s\S]*)\}/.exec(trimmed);
      const outside = trimmed.replace(/\{[\s\S]*\}/, '').replace(/,/g, '').trim();
      if (outside) {
        markAll(specifier);
        continue;
      }
      if (!braces) {
        markAll(specifier);
        continue;
      }
      const names = braces[1]!
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part && !part.startsWith('type '))
        .map((part) => part.split(/\s+as\s+/)[0]!.trim())
        .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
      if (names.length === 0) continue;
      addNames(specifier, names);
    }

    for (const match of source.matchAll(SIDE_EFFECT_IMPORT)) {
      if (match[1] && isBareSpecifier(match[1])) markAll(match[1]);
    }
    for (const match of source.matchAll(DYNAMIC_IMPORT)) {
      if (match[1] && isBareSpecifier(match[1])) markAll(match[1]);
    }
    for (const match of source.matchAll(REEXPORT)) {
      const [, typeOnly, clause, specifier] = match;
      if (!specifier || !isBareSpecifier(specifier) || typeOnly) continue;
      if (clause!.startsWith('*')) {
        markAll(specifier);
        continue;
      }
      const names = clause!
        .slice(1, -1)
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part && !part.startsWith('type '))
        .map((part) => part.split(/\s+as\s+/)[0]!.trim())
        .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name) && name !== 'default');
      if (names.length > 0) addNames(specifier, names);
      else markAll(specifier);
    }
  }

  return uses;
}

/** The esm.sh URL a bare specifier is fetched from. */
export function packageUrl(
  specifier: string,
  dependencies: Record<string, string>,
  imports?: Map<string, ImportUse>,
): string {
  const { name, subpath } = splitPackageSpecifier(specifier);
  const version = cleanVersion(dependencies[name]);
  const params = ['external=react,react-dom', 'target=es2022'];

  const use = imports?.get(specifier);
  const treeShake =
    use instanceof Set &&
    use.size > 0 &&
    !/\.(css|json)$/i.test(subpath) &&
    TREE_SHAKEN_PACKAGES.some((pkg) => name === pkg || name.startsWith(`${pkg}/`));
  if (treeShake) params.unshift(`exports=${[...(use as Set<string>)].sort().join(',')}`);

  return `${CDN_ORIGIN}/${name}${version ? `@${version}` : ''}${subpath}?${params.join('&')}`;
}

/** Package names imported by the project but absent from `/package.json`. */
export function undeclaredPackages(files: Record<string, string>): string[] {
  const dependencies = readProjectDependencies(files);
  const names = new Set<string>();
  for (const specifier of collectPackageImports(files).keys()) {
    if (RUNTIME_PROVIDED.test(specifier) || isNodeBuiltin(specifier)) continue;
    const { name } = splitPackageSpecifier(specifier);
    if (!dependencies[name]) names.add(name);
  }
  return [...names].sort();
}

/* ------------------------------------------------------------------------ */
/* Fetching                                                                  */
/* ------------------------------------------------------------------------ */

export interface FetchedModule {
  contents: string;
  /** Where the module ended up after redirects; relative imports resolve here. */
  url: string;
}

const memoryCache = new Map<string, Promise<FetchedModule>>();
const CACHE_NAME = 'willow-preview-packages-v1';

export class PackageFetchError extends Error {
  constructor(message: string, readonly url: string) {
    super(message);
    this.name = 'PackageFetchError';
  }
}

async function openCache(): Promise<Cache | null> {
  try {
    if (typeof caches === 'undefined') return null;
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

async function download(url: string): Promise<FetchedModule> {
  const cache = await openCache();
  const cached = await cache?.match(url).catch(() => undefined);
  if (cached) {
    const finalUrl = cached.headers.get('x-willow-final-url') || url;
    return { contents: await cached.text(), url: finalUrl };
  }

  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new PackageFetchError(
      `Could not reach ${CDN_ORIGIN} to download ${describeUrl(url)}. ` +
        'The preview needs a network connection to load npm packages.',
      url,
    );
  }
  if (!response.ok) {
    throw new PackageFetchError(
      response.status === 404
        ? `${describeUrl(url)} was not found on npm (HTTP 404). Check the package name and version in /package.json.`
        : `Downloading ${describeUrl(url)} failed with HTTP ${response.status}.`,
      url,
    );
  }

  const contents = await response.text();
  const finalUrl = response.url || url;
  if (cache) {
    const headers = new Headers({
      'content-type': response.headers.get('content-type') || 'application/javascript',
      'x-willow-final-url': finalUrl,
    });
    cache.put(url, new Response(contents, { headers })).catch(() => {});
  }
  return { contents, url: finalUrl };
}

/** A package as a human reads it: `lucide-react@0.460.0`, not the whole URL. */
export function describeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\/+/, '').replace(/\/(es20\d\d|esnext)\/.*$/, '') || url;
  } catch {
    return url;
  }
}

/** Downloads a module once per session; a failure is not cached. */
export function fetchModule(url: string): Promise<FetchedModule> {
  const existing = memoryCache.get(url);
  if (existing) return existing;
  const pending = download(url).catch((error) => {
    memoryCache.delete(url);
    throw error;
  });
  memoryCache.set(url, pending);
  return pending;
}

/** Resolves an import found inside a CDN module against that module's URL. */
export function resolveCdnImport(specifier: string, importerUrl: string): string {
  if (/^https?:\/\//i.test(specifier)) return specifier;
  if (specifier.startsWith('/')) return `${CDN_ORIGIN}${specifier}`;
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    return new URL(specifier, importerUrl).href;
  }
  return packageUrl(specifier, {});
}

/**
 * A stylesheet from a package, as a module that injects it.
 *
 * Relative `url(...)` references are made absolute, because the stylesheet ends
 * up inline in a document whose base URL is a blob, where `./fonts/x.woff2`
 * resolves to nothing.
 */
export function cssModule(css: string, baseUrl: string): string {
  const absolute = css.replace(/url\(\s*(['"]?)(?!data:|https?:|#|\/\/)([^'")]+)\1\s*\)/g, (_match, quote: string, ref: string) => {
    try {
      return `url(${quote}${new URL(ref, baseUrl).href}${quote})`;
    } catch {
      return `url(${quote}${ref}${quote})`;
    }
  });
  return [
    'const style = document.createElement("style");',
    `style.textContent = ${JSON.stringify(absolute)};`,
    'document.head.appendChild(style);',
  ].join('\n');
}
