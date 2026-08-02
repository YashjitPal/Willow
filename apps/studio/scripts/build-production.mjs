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
import { willowAliasPlugin } from './lib/willow-aliases.mjs';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(appDir, '../..');
const output = path.join(appDir, 'dist');
const temporary = path.join(appDir, `.dist-build-${process.pid}`);

const ENTRY = path.join(appDir, 'src', 'main.tsx');

const aliasPlugin = willowAliasPlugin(repoRoot);

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
    minify: true,
    metafile: true,
    entryNames: '[name]-[hash]',
    chunkNames: 'chunk-[name]-[hash]',
    assetNames: 'asset-[name]-[hash]',
    loader: {
      '.cur': 'file', '.gif': 'file', '.jpeg': 'file', '.jpg': 'file', '.mp3': 'file',
      '.mp4': 'file', '.png': 'file', '.svg': 'file', '.wasm': 'file', '.webm': 'file',
      '.webp': 'file', '.woff': 'file', '.woff2': 'file', '.ttf': 'file',
    },
    define: {
      'process.env.NODE_ENV': '"production"',
      'process.env.BABEL_8_BREAKING': 'false',
      'process.env.BABEL_TYPES_8_BREAKING': 'false',
    },
    plugins: [urlPlugin, aliasPlugin],
  });
  const entry = Object.entries(result.metafile.outputs)
    .find(([, metadata]) => metadata.entryPoint?.endsWith('main.tsx'))?.[0];
  if (!entry) throw new Error('production entry bundle was not emitted');
  const entryUrl = `/${path.relative(temporary, path.resolve(appDir, entry)).split(path.sep).join('/')}`;
  const html = fs.readFileSync(path.join(appDir, 'index.html'), 'utf8').replace('/src/main.tsx', entryUrl);
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
