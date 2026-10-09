/**
 * Production build without Vite.
 *
 * Vite's build path loads dotenv, which reads files this app has no business
 * reading in CI. esbuild alone is enough: bundle src/main.tsx, copy public/,
 * and rewrite the entry <script> in index.html.
 *
 * Path aliases come from tsconfig.base.json via ./lib/willow-aliases.mjs, so
 * this script and the type checker can never disagree about where `@willow/*`
 * points.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { readTsconfigAliases, willowAliasPlugin } from './lib/willow-aliases.mjs';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(appDir, '../..');
const output = path.join(appDir, 'dist');
const temporary = path.join(appDir, `.dist-build-${process.pid}`);

const ENTRY = path.join(appDir, 'src', 'main.tsx');

const aliasPlugin = willowAliasPlugin(repoRoot);

/** `?url`: the file as a separate asset and its URL, whatever it is — pdf.js's worker is JavaScript that must not be bundled in. */
const urlPlugin = {
  name: 'url-imports',
  setup(build) {
    build.onResolve({ filter: /\?url$/ }, async (args) => {
      const resolved = await build.resolve(args.path.slice(0, -4), { resolveDir: args.resolveDir, kind: args.kind });
      if (resolved.errors.length) return { errors: resolved.errors };
      return { path: resolved.path, namespace: 'asset-url' };
    });
    build.onLoad({ filter: /.*/, namespace: 'asset-url' }, async (args) => ({ contents: await fs.promises.readFile(args.path), loader: 'file' }));
  },
};

/** `?raw`: the file's text, as Vite gives it (prompts, grammars, shaders). */
const rawPlugin = {
  name: 'raw-imports',
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, async (args) => {
      const resolved = await build.resolve(args.path.slice(0, -4), { resolveDir: args.resolveDir, kind: args.kind });
      if (resolved.errors.length) return { errors: resolved.errors };
      return { path: resolved.path, namespace: 'raw-text' };
    });
    build.onLoad({ filter: /.*/, namespace: 'raw-text' }, async (args) => ({ contents: await fs.promises.readFile(args.path, 'utf8'), loader: 'text' }));
  },
};

/**
 * `import.meta.glob`, in the forms Willow uses: eager (an object of modules,
 * or of default exports with `import: 'default'`) and lazy (an object of
 * loaders). Keys follow Vite: relative patterns keep their `./` form; aliased
 * patterns become paths from the repository root.
 */
const globPlugin = (root) => {
  const { prefixes } = readTsconfigAliases(root);
  const posix = (value) => value.split(path.sep).join('/');
  const toRegExp = (glob) => new RegExp(`^${glob
    .replace(/[.+^$()|[\]\\]/g, '\\$&')
    .replace(/\{([^}]+)\}/g, (_, list) => `(?:${list.split(',').join('|')})`)
    .replace(/\*\*\//g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '(?:.*/)?')}$`);

  const expand = (pattern, importer) => {
    const alias = prefixes.find((entry) => pattern.startsWith(entry.from));
    let absolute;
    let keyFor;
    if (alias) {
      absolute = posix(path.join(alias.to, pattern.slice(alias.from.length)));
      keyFor = (file) => `/${posix(path.relative(root, file))}`;
    } else if (pattern.startsWith('.')) {
      absolute = posix(path.resolve(path.dirname(importer), pattern));
      keyFor = (file) => {
        const relative = posix(path.relative(path.dirname(importer), file));
        return relative.startsWith('.') ? relative : `./${relative}`;
      };
    } else {
      throw new Error(`import.meta.glob('${pattern}') in ${importer}: only relative and @willow patterns are supported`);
    }
    const base = absolute.slice(0, absolute.lastIndexOf('/', absolute.search(/[*{]/)));
    const matches = toRegExp(absolute.slice(base.length + 1));
    const files = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (matches.test(posix(path.relative(base, full)))) files.push(full);
      }
    };
    if (fs.existsSync(base)) walk(base);
    return files.sort().map((file) => ({ file: posix(file), key: keyFor(file) }));
  };

  return {
    name: 'import-meta-glob',
    setup(build) {
      build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (args) => {
        if (args.path.includes(`${path.sep}node_modules${path.sep}`)) return undefined;
        const source = await fs.promises.readFile(args.path, 'utf8');
        if (!source.includes('import.meta.glob')) return undefined;
        const imports = [];
        const contents = source.replace(
          /import\.meta\.glob(?:<[^>(]*>)?\(\s*(['"])([^'"]+)\1\s*(?:,\s*(\{[^)]*\}))?\s*,?\s*\)/g,
          (_call, _quote, pattern, options = '') => {
            const eager = /eager\s*:\s*true/.test(options);
            const onlyDefault = /import\s*:\s*['"]default['"]/.test(options);
            const entries = expand(pattern, args.path).map(({ file, key }) => {
              const specifier = JSON.stringify(file);
              if (eager) {
                const name = `__glob_${imports.length}`;
                imports.push(onlyDefault ? `import ${name} from ${specifier};` : `import * as ${name} from ${specifier};`);
                return `${JSON.stringify(key)}: ${name}`;
              }
              return `${JSON.stringify(key)}: () => import(${specifier})${onlyDefault ? '.then((module) => module.default)' : ''}`;
            });
            return `({ ${entries.join(', ')} })`;
          },
        );
        const extension = path.extname(args.path).replace(/^\.[cm]?/, '');
        return { contents: `${imports.join('\n')}\n${contents}`, loader: extension, resolveDir: path.dirname(args.path) };
      });
    },
  };
};

if (!output.startsWith(`${appDir}${path.sep}`) || !temporary.startsWith(`${appDir}${path.sep}`)) {
  throw new Error('refusing to build outside apps/studio');
}
fs.rmSync(temporary, { recursive: true, force: true });
fs.mkdirSync(path.join(temporary, 'assets'), { recursive: true });
if (fs.existsSync(path.join(appDir, 'public'))) fs.cpSync(path.join(appDir, 'public'), temporary, { recursive: true });

try {
  const result = await esbuild.build({
    absWorkingDir: appDir,
    entryPoints: [ENTRY],
    outdir: path.join(temporary, 'assets'),
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2022'],
    // As Vite builds it: the automatic JSX runtime, and asset URLs that work from any route.
    jsx: 'automatic',
    publicPath: '/assets/',
    minify: true,
    metafile: true,
    entryNames: '[name]-[hash]',
    chunkNames: 'chunk-[name]-[hash]',
    assetNames: 'asset-[name]-[hash]',
    loader: {
      '.aac': 'file', '.cur': 'file', '.gif': 'file', '.jpeg': 'file', '.jpg': 'file', '.m4a': 'file',
      '.mp3': 'file', '.mp4': 'file', '.ogg': 'file', '.png': 'file', '.svg': 'file', '.wasm': 'file',
      '.wav': 'file', '.webm': 'file', '.webp': 'file', '.woff': 'file', '.woff2': 'file', '.ttf': 'file',
    },
    define: {
      'process.env.NODE_ENV': '"production"',
      'process.env.BABEL_8_BREAKING': 'false',
      'process.env.BABEL_TYPES_8_BREAKING': 'false',
      // What Vite would provide, minus every VITE_* value: this build reads no env files.
      'import.meta.env': JSON.stringify({ MODE: 'production', DEV: false, PROD: true, SSR: false, BASE_URL: '/' }),
    },
    plugins: [urlPlugin, rawPlugin, globPlugin(repoRoot), aliasPlugin],
  });
  const entry = Object.entries(result.metafile.outputs)
    .find(([, metadata]) => metadata.entryPoint?.endsWith('main.tsx'))?.[0];
  if (!entry) throw new Error('production entry bundle was not emitted');
  const urlOf = (output) => `/${path.relative(temporary, path.resolve(appDir, output)).split(path.sep).join('/')}`;
  const entryUrl = urlOf(entry);

  /*
   * The CSS that components import, as Vite loads it: the entry's stylesheet
   * from index.html, and each lazy chunk's when that chunk loads — awaited, so
   * a feature never paints unstyled, and no feature's styles apply before it
   * is first opened.
   */
  const entryCss = result.metafile.outputs[entry].cssBundle;
  for (const [output, metadata] of Object.entries(result.metafile.outputs)) {
    if (!output.endsWith('.js') || !metadata.cssBundle || output === entry) continue;
    const href = JSON.stringify(urlOf(metadata.cssBundle));
    const loadCss = `await new Promise((done) => { if (document.querySelector('link[href="' + ${href} + '"]')) return done(); const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = ${href}; link.onload = link.onerror = () => done(); document.head.appendChild(link); });\n`;
    const file = path.resolve(appDir, output);
    fs.writeFileSync(file, loadCss + fs.readFileSync(file, 'utf8'));
  }

  // The script tag itself: index.html's comments mention /src/main.tsx too.
  let html = fs.readFileSync(path.join(appDir, 'index.html'), 'utf8')
    .replace(/(<script\b[^>]*\bsrc=["'])\/src\/main\.tsx(["'])/, `$1${entryUrl}$2`);
  if (!html.includes(entryUrl)) throw new Error('index.html has no <script src="/src/main.tsx"> to point at the bundle');
  if (entryCss) html = html.replace('</head>', `  <link rel="stylesheet" href="${urlOf(entryCss)}" />\n  </head>`);
  fs.writeFileSync(path.join(temporary, 'index.html'), html);
  fs.rmSync(output, { recursive: true, force: true });
  try {
    fs.renameSync(temporary, output);
  } catch (error) {
    if (error?.code !== 'EPERM') throw error;
    fs.mkdirSync(output, { recursive: true });
    fs.cpSync(temporary, output, { recursive: true, force: true });
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  console.log(`Built Willow Studio without Vite or dotenv: ${entryUrl}`);
} catch (error) {
  fs.rmSync(temporary, { recursive: true, force: true });
  throw error;
}
