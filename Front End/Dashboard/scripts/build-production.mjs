import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = path.resolve(root, '../..');
const output = path.join(root, 'dist');
const temporary = path.join(root, `.dist-build-${process.pid}`);

const alias = {
  '@agentbuilder': path.join(workspace, 'Back End/agent-builder/client/index.ts'),
  '@models': path.join(workspace, 'defaultmodel.ts'),
  path: path.join(root, 'node_modules/path-browserify/index.js'),
};

function resolveLocal(candidate) {
  const attempts = [
    candidate,
    ...['.tsx', '.ts', '.jsx', '.js', '.json'].map((extension) => `${candidate}${extension}`),
    ...['.tsx', '.ts', '.jsx', '.js', '.json'].map((extension) => path.join(candidate, `index${extension}`)),
  ];
  return attempts.find((attempt) => {
    try { return fs.statSync(attempt).isFile(); }
    catch { return false; }
  });
}

const aliasPlugin = {
  name: 'willow-aliases',
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      if (alias[args.path]) return { path: resolveLocal(alias[args.path]) ?? alias[args.path] };
      if (args.path.startsWith('@/') || args.path.startsWith('~/')) {
        const candidate = path.join(root, args.path.slice(2));
        return { path: resolveLocal(candidate) ?? candidate };
      }
      return undefined;
    });
  },
};

const urlPlugin = {
  name: 'url-imports',
  setup(build) {
    build.onResolve({ filter: /\?url$/ }, async (args) => {
      const resolved = await build.resolve(args.path.slice(0, -4), { resolveDir: args.resolveDir, kind: args.kind });
      if (resolved.errors.length) return { errors: resolved.errors };
      return { path: resolved.path, suffix: '?url' };
    });
  },
};

if (!output.startsWith(`${root}${path.sep}`) || !temporary.startsWith(`${root}${path.sep}`)) throw new Error('refusing to build outside Dashboard');
fs.rmSync(temporary, { recursive: true, force: true });
fs.mkdirSync(path.join(temporary, 'assets'), { recursive: true });
if (fs.existsSync(path.join(root, 'public'))) fs.cpSync(path.join(root, 'public'), temporary, { recursive: true });

try {
  const result = await esbuild.build({
    absWorkingDir: root,
    entryPoints: [path.join(root, 'index.tsx')],
    outdir: path.join(temporary, 'assets'),
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2022'],
    minify: true,
    metafile: true,
    entryNames: '[name]-[hash]',
    chunkNames: 'chunk-[name]-[hash]',
    assetNames: 'asset-[name]-[hash]',
    loader: {
      '.cur': 'file', '.gif': 'file', '.jpeg': 'file', '.jpg': 'file', '.mp3': 'file',
      '.mp4': 'file', '.png': 'file', '.svg': 'file', '.wasm': 'file', '.webm': 'file',
      '.webp': 'file', '.woff': 'file', '.woff2': 'file',
    },
    define: {
      'process.env.NODE_ENV': '"production"',
      'process.env.BABEL_8_BREAKING': 'false',
      'process.env.BABEL_TYPES_8_BREAKING': 'false',
    },
    plugins: [urlPlugin, aliasPlugin],
  });
  const entry = Object.entries(result.metafile.outputs).find(([, metadata]) => metadata.entryPoint?.endsWith('index.tsx'))?.[0];
  if (!entry) throw new Error('production entry bundle was not emitted');
  const entryUrl = `/${path.relative(temporary, path.resolve(root, entry)).split(path.sep).join('/')}`;
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace('/index.tsx', entryUrl);
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
  console.log(`Built Dashboard without Vite or dotenv: ${entryUrl}`);
} catch (error) {
  fs.rmSync(temporary, { recursive: true, force: true });
  throw error;
}
