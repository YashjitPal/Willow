/**
 * The server behind the agent tabs: T3 Code, forked into vendor/t3code (its WILLOW.md has the
 * details). It keeps its own toolchain, pnpm 11 and Vite+, so it builds here rather than in
 * Willow's build:
 *
 *   vendor/t3code/apps/server/dist/bin.mjs      the server bundle, run with the bundled Node.js
 *   vendor/t3code/apps/server/dist/client/      its web client, which the server serves
 *
 * The bundle inlines its dependencies except the packages Node has to load from disk (native
 * addons and what they require; T3's scripts/lib/cli-external-packages.ts). Staging copies
 * those out of the fork's own install, patches included, into a plain node_modules beside it.
 *
 *   node apps/desktop/scripts/agents.mjs [--force]
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildDir, repoRoot } from './lib.mjs';

export const agentsDir = path.join(repoRoot, 'vendor', 't3code');
const serverDir = path.join(agentsDir, 'apps', 'server');
const STAMP = path.join(buildDir, 'agents-stamp.json');
/** What the bundle and its client are built from. */
const SOURCES = [
  'apps/server/src',
  'apps/server/package.json',
  'apps/server/vite.config.ts',
  'apps/web/src',
  'apps/web/public',
  'apps/web/index.html',
  'apps/web/package.json',
  'apps/web/vite.config.ts',
  'packages',
  'patches',
  'scripts/lib',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'vite.config.ts',
];
const SKIP = new Set(['node_modules', 'dist', '.vite', '.vite-plus', '.turbo', 'target']);
/** The server's dependencies the bundle leaves external, as T3's cli-external-packages.ts lists them. */
const RUNTIME_EXTERNAL = ['@cursor/sdk', 'node-pty', '@ff-labs/fff-node', '@napi-rs/keyring'];

const pnpm = (args) => new Promise((resolve, reject) => {
  // pnpm is a .cmd shim on Windows, which only a shell runs.
  const child = spawn('pnpm', args, { cwd: agentsDir, stdio: 'inherit', shell: process.platform === 'win32' });
  child.once('error', reject);
  child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`pnpm ${args.join(' ')} failed (exit ${code})`))));
});

const fingerprint = () => {
  const hash = crypto.createHash('sha256');
  const add = (relative) => {
    const full = path.join(agentsDir, relative);
    if (!fs.existsSync(full)) return;
    if (fs.statSync(full).isDirectory()) {
      for (const name of fs.readdirSync(full).sort()) if (!SKIP.has(name)) add(path.join(relative, name));
      return;
    }
    hash.update(relative.replaceAll('\\', '/')).update('\0').update(fs.readFileSync(full)).update('\0');
  };
  for (const source of SOURCES) add(source);
  return hash.digest('hex');
};

const webDist = path.join(agentsDir, 'apps', 'web', 'dist');
const clientDir = path.join(serverDir, 'dist', 'client');
const LOCK = path.join(buildDir, 'agents.lock');

const built = () => fs.existsSync(path.join(serverDir, 'dist', 'bin.mjs')) && fs.existsSync(path.join(clientDir, 'index.html'));

/** Every file under `dir` by its path relative to it, with its size. */
const listFiles = (dir, keep = () => true) => {
  const files = new Map();
  const walk = (relative) => {
    for (const entry of fs.readdirSync(path.join(dir, relative), { withFileTypes: true })) {
      const child = path.join(relative, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (keep(child)) files.set(child, fs.statSync(path.join(dir, child)).size);
    }
  };
  if (fs.existsSync(dir)) walk('');
  return files;
};

/** The files of `from` that `to` lacks or holds at another size. */
const missingFiles = (from, to, keep) => {
  const have = listFiles(to, keep);
  return [...listFiles(from, keep)].filter(([file, size]) => have.get(file) !== size).map(([file]) => file);
};

const incomplete = (what, missing) =>
  new Error(`${what} is missing ${missing.length} files (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ', …' : ''}).`);

/**
 * Copies the web client into the server's dist. The server answers a chunk it lacks with
 * index.html, so a client missing any file is a page that never starts: the copy is checked.
 */
const copyClient = () => {
  // Emptied rather than removed: a debug build's agent tabs serve from it, and Windows will not
  // remove a directory a running server holds open.
  fs.mkdirSync(clientDir, { recursive: true });
  for (const entry of fs.readdirSync(clientDir)) fs.rmSync(path.join(clientDir, entry), { recursive: true, force: true });
  fs.cpSync(webDist, clientDir, { recursive: true });
  const missing = missingFiles(webDist, clientDir);
  if (missing.length > 0) throw incomplete(`The agents' client copied to ${clientDir}`, missing);
};

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

/**
 * Runs `work` while no other process builds the agents: build.mjs and pack.mjs build them too, and
 * two builds at once empty and fill the same client folder, losing files from both copies.
 */
const withBuildLock = async (work) => {
  fs.mkdirSync(buildDir, { recursive: true });
  const deadline = Date.now() + 30 * 60_000;
  let waitingFor = null;
  for (;;) {
    try {
      fs.writeFileSync(LOCK, `${process.pid}\n`, { flag: 'wx' });
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    let holder = Number.NaN;
    try {
      holder = Number.parseInt(fs.readFileSync(LOCK, 'utf8'), 10);
    } catch {
      continue;
    }
    // A lock whose process is gone was left by a build that was killed.
    if (Number.isInteger(holder) && !alive(holder)) {
      fs.rmSync(LOCK, { force: true });
      continue;
    }
    if (Date.now() > deadline) throw new Error(`Another agents build has held ${LOCK} for 30 minutes.`);
    if (waitingFor !== holder) {
      waitingFor = holder;
      console.log(`[desktop] waiting for the agents build in process ${holder}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  try {
    return await work();
  } finally {
    fs.rmSync(LOCK, { force: true });
  }
};

/** Builds the server and its client unless they are already built from these sources. Resolves to whether it built. */
export const buildAgents = ({ force = false } = {}) =>
  withBuildLock(async () => {
    const parts = fingerprint();
    let stamp = null;
    try {
      stamp = JSON.parse(fs.readFileSync(STAMP, 'utf8'));
    } catch {
      // Not built yet.
    }
    if (!force && stamp?.parts === parts && built()) {
      if (missingFiles(webDist, clientDir).length === 0) return false;
      // The build is current but its copy lost files (a build interrupted while copying).
      copyClient();
      return true;
    }

    if (!fs.existsSync(path.join(agentsDir, 'node_modules'))) {
      await pnpm(['install', '--filter', 't3...', '--filter', '@t3tools/web...', '--config.confirmModulesPurge=false']);
    }
    await pnpm(['--filter', '@t3tools/web', 'build']);
    await pnpm(['--filter', 't3', 'build:bundle']);
    copyClient();

    fs.writeFileSync(STAMP, `${JSON.stringify({ parts, builtAt: new Date().toISOString() }, null, 2)}\n`);
    return true;
  });

/** The directory Node would load `name` from, starting at `from`, with pnpm's links resolved. */
const packageDir = (from, name) => {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', ...name.split('/'));
    if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate);
    if (path.dirname(dir) === dir) return null;
  }
};

/**
 * Copies the server's runtime packages, and everything they require, into `modules` as a plain
 * node_modules. Optional dependencies for other platforms are not installed, so they are skipped.
 */
const stageRuntime = (modules) => {
  const placed = new Map();
  const visit = (from, name, optional) => {
    const dir = packageDir(from, name);
    if (!dir) {
      if (optional) return;
      throw new Error(`The agents' server needs ${name}, which is not installed in vendor/t3code. Run pnpm install there.`);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const existing = placed.get(name);
    if (existing) {
      if (existing.version !== manifest.version) throw new Error(`The agents' server needs ${name} ${existing.version} and ${manifest.version}.`);
      return;
    }
    placed.set(name, manifest);
    const target = path.join(modules, ...name.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(dir, target, { recursive: true, dereference: true, filter: (source) => path.basename(source) !== '.bin' && !source.slice(dir.length).includes(`${path.sep}node_modules`) });
    for (const dependency of Object.keys(manifest.dependencies ?? {})) visit(dir, dependency, false);
    for (const dependency of Object.keys(manifest.optionalDependencies ?? {})) visit(dir, dependency, true);
  };
  for (const name of RUNTIME_EXTERNAL) visit(serverDir, name, false);
  // @cursor/sdk finds its platform package by walking up from the entry script, so it sits beside the SDK.
  for (const name of fs.readdirSync(path.join(agentsDir, 'node_modules', '@cursor')).filter((entry) => entry.startsWith('sdk-'))) {
    visit(agentsDir, `@cursor/${name}`, true);
  }
  // node-pty ships every platform's prebuilt addon; only this one's loads.
  const prebuilds = path.join(modules, 'node-pty', 'prebuilds');
  if (fs.existsSync(prebuilds)) {
    for (const entry of fs.readdirSync(prebuilds)) {
      if (entry !== `${process.platform}-${process.arch}`) fs.rmSync(path.join(prebuilds, entry), { recursive: true, force: true });
    }
  }
  return [...placed.keys()];
};

/** Stages the built server into `out` (the payload's `willow/`), where harness.rs looks for it. */
export const stageAgents = (out) => {
  if (!built()) throw new Error('The agents\' server is not built: run apps/desktop/scripts/agents.mjs.');
  const unstaged = missingFiles(webDist, clientDir);
  if (unstaged.length > 0) throw incomplete('The agents\' client (run apps/desktop/scripts/agents.mjs)', unstaged);
  const target = path.join(out, 'vendor', 't3code', 'apps', 'server');
  fs.mkdirSync(target, { recursive: true });
  const shipped = (file) => !file.endsWith('.map');
  fs.cpSync(path.join(serverDir, 'dist'), path.join(target, 'dist'), { recursive: true, filter: shipped });
  const lost = missingFiles(path.join(serverDir, 'dist'), path.join(target, 'dist'), shipped);
  if (lost.length > 0) throw incomplete(`The agents' server staged in ${target}`, lost);
  fs.copyFileSync(path.join(agentsDir, 'LICENSE'), path.join(target, 'LICENSE'));
  return stageRuntime(path.join(target, 'node_modules'));
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rebuilt = await buildAgents({ force: process.argv.includes('--force') });
  console.log(`[desktop] agents' server ${rebuilt ? 'built' : 'already built from these sources'}`);
}
