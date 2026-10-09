/**
 * Packs this checkout into the Willow app on this PC (Windows): checks the code, then
 * either updates Willow's pages in place (about a minute) or, when the app's own parts
 * changed, builds the release app and its installer (scripts/build.mjs) and runs it
 * silently. Either way Willow closes and opens again; its data is not touched.
 *
 *   node apps/desktop/scripts/pack.mjs [--full] [--no-check] [--keep-agents]
 *
 * `--keep-agents` packs the agent tabs' server as it was last built (build.mjs
 * `--skip-agents-build`), for when its source is in the middle of someone's edit; when
 * only the pages are updated, the installed one is left as it is.
 *
 * The app's own parts are what is built into the program or staged beside the pages:
 * the Rust side, the strip and its window, the server, the companion, the packages of the
 * agent tabs' server (whose bundle is updated in place like the pages). After a full pack
 * their fingerprint is kept in build/pack-stamp.json with the installed program's size
 * and time; while both still match, only the pages need packing. `--full` packs it all.
 *
 * Several people and agents edit this checkout at once, and a build takes whatever is on
 * disk at that moment, so the typecheck goes first (incremental, so a repeat is quick): a
 * half-finished edit stops the pack instead of landing in the app. One pack runs at a
 * time; a second waits for the first, then builds from the newer files, so the last pack
 * carries everyone's work. `Pack in app.cmd` at the repository root runs this.
 */
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { agentsDir, buildAgents } from './agents.mjs';
import { buildDir, desktopDir, repoRoot, run, tauriDir } from './lib.mjs';

const LOCK = path.join(buildDir, 'pack.lock');
const STAMP = path.join(buildDir, 'pack-stamp.json');
/** Everything the program is built from or that is staged beside the pages (stage.mjs). */
const APP_PARTS = [
  'apps/desktop/src-tauri/src',
  'apps/desktop/src-tauri/Cargo.toml',
  'apps/desktop/src-tauri/Cargo.lock',
  'apps/desktop/src-tauri/tauri.conf.json',
  'apps/desktop/src-tauri/build.rs',
  'apps/desktop/src-tauri/app.manifest',
  'apps/desktop/src-tauri/capabilities',
  'apps/desktop/src-tauri/icons',
  'apps/desktop/shell',
  'apps/desktop/scripts/stage.mjs',
  'apps/desktop/scripts/agents.mjs',
  'apps/desktop/scripts/node-runtime.mjs',
  // The agents' server packages; its bundle and client are packed like the pages.
  'vendor/t3code/pnpm-lock.yaml',
  'vendor/t3code/patches',
  'bin/willow.js',
  'api',
  'services/local-companion/src',
  'services/local-companion/package.json',
  'services/local-companion/package-lock.json',
  'features/spark/src/pets/hatch-pet',
];
const startedAt = Date.now();
const say = (text) => console.log(`\n[pack] ${text}`);
const clock = (at) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A test build's settings must not reach the app: another identifier, another target folder.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !['TAURI_CONFIG', 'CARGO_TARGET_DIR', 'CARGO_BUILD_TARGET_DIR'].includes(key.toUpperCase())));

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

const takeLock = async () => {
  fs.mkdirSync(buildDir, { recursive: true });
  let told = false;
  for (;;) {
    try {
      fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), { flag: 'wx' });
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    let holder = null;
    try {
      holder = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
    } catch {
      // Still being written.
    }
    if (holder && !alive(holder.pid)) {
      fs.rmSync(LOCK, { force: true });
      continue;
    }
    if (!told) {
      say(`Another pack is running${holder ? ` (since ${clock(holder.startedAt)})` : ''}. This one starts when it is done.`);
      told = true;
    }
    await sleep(5000);
  }
};

const releaseLock = () => {
  try {
    if (JSON.parse(fs.readFileSync(LOCK, 'utf8')).pid === process.pid) fs.rmSync(LOCK, { force: true });
  } catch {
    // Already gone.
  }
};

const ask = async (question) => {
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question(question);
  prompt.close();
  return /^y(es)?$/i.test(answer.trim());
};

const fingerprint = () => {
  const hash = crypto.createHash('sha256');
  const add = (relative) => {
    const full = path.join(repoRoot, relative);
    if (!fs.existsSync(full)) return;
    if (fs.statSync(full).isDirectory()) {
      for (const name of fs.readdirSync(full).sort()) add(path.join(relative, name));
      return;
    }
    hash.update(relative.replaceAll('\\', '/')).update('\0').update(fs.readFileSync(full)).update('\0');
  };
  for (const part of APP_PARTS) add(part);
  return hash.digest('hex');
};

/** Where the installer put Willow: it keeps the folder under HKCU\Software\<maker>\<product>. */
const installDir = () => {
  const { productName, identifier } = JSON.parse(fs.readFileSync(path.join(tauriDir, 'tauri.conf.json'), 'utf8'));
  try {
    const answer = execFileSync('reg', ['query', `HKCU\\Software\\${identifier.split('.')[1]}\\${productName}`, '/ve'], { encoding: 'utf8' });
    const dir = /REG_SZ\s+(.+?)\s*$/m.exec(answer)?.[1];
    if (dir && fs.existsSync(path.join(dir, 'willow-desktop.exe'))) return dir;
  } catch {
    // Not installed yet.
  }
  return null;
};

const programStamp = (dir) => {
  const { size, mtimeMs } = fs.statSync(path.join(dir, 'willow-desktop.exe'));
  return { size, mtimeMs };
};

/** Closes Willow and what it started (its job object takes the server and companion along). */
const closeWillow = (dir) => {
  const prefix = `${dir}\\`.replaceAll("'", "''");
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
    $own = { Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith('${prefix}', [StringComparison]::OrdinalIgnoreCase) } }
    & $own | Stop-Process -Force -ErrorAction SilentlyContinue
    for ($i = 0; $i -lt 40 -and (& $own); $i++) { Start-Sleep -Milliseconds 250 }`]);
};

/** Opens Willow through Explorer, so it starts as the signed-in user does, not with this build's environment. */
const openWillow = (dir) => {
  spawn('explorer.exe', [path.join(dir, 'willow-desktop.exe')], { detached: true, stdio: 'ignore' }).unref();
};

/** Makes `to` hold exactly what `from` does, or the part of it `keep` accepts. */
const mirror = (from, to, keep = () => true) => {
  fs.mkdirSync(to, { recursive: true });
  fs.cpSync(from, to, { recursive: true, force: true, filter: keep });
  const prune = (relative) => {
    const target = path.join(to, relative);
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
      const inner = path.join(relative, entry.name);
      if (!fs.existsSync(path.join(from, inner)) || !keep(path.join(from, inner))) fs.rmSync(path.join(to, inner), { recursive: true, force: true });
      else if (entry.isDirectory()) prune(inner);
    }
  };
  prune('');
};

const willowRunning = () => {
  try {
    return execFileSync('tasklist', ['/FI', 'IMAGENAME eq willow-desktop.exe', '/NH'], { encoding: 'utf8' }).includes('willow-desktop.exe');
  } catch {
    return false;
  }
};

let installing = false;

const pack = async () => {
  await takeLock();

  if (!process.argv.includes('--no-check')) {
    say('Checking the code...');
    const tsc = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
    const args = [tsc, '-p', 'tsconfig.json', '--noEmit', '--incremental', '--tsBuildInfoFile', path.join(buildDir, 'typecheck.tsbuildinfo')];
    const clean = await run(process.execPath, args, { cwd: repoRoot, env }).then(() => true, () => false);
    if (!clean) {
      say('The code has the errors above, most likely an edit someone is still in the middle of.');
      if (!process.stdin.isTTY || !(await ask('Pack it anyway? (y/N) '))) throw new Error('the code did not pass the check');
    }
  }

  const parts = fingerprint();
  const dir = installDir();
  let stamp = null;
  try {
    stamp = JSON.parse(fs.readFileSync(STAMP, 'utf8'));
  } catch {
    // No full pack yet.
  }
  const program = dir ? programStamp(dir) : null;
  const pagesOnly = !process.argv.includes('--full') && stamp?.parts === parts && program?.size === stamp.program?.size && Math.abs(program.mtimeMs - stamp.program.mtimeMs) < 2000;
  const keepAgents = process.argv.includes('--keep-agents');

  if (pagesOnly) {
    say('Only Willow\'s pages changed since the app was last packed: updating them in place...');
    await run(process.execPath, [path.join(repoRoot, 'apps', 'studio', 'scripts', 'build-production.mjs')], { cwd: repoRoot, env });
    if (!keepAgents) await buildAgents();
    installing = true;
    closeWillow(dir);
    mirror(path.join(repoRoot, 'apps', 'studio', 'dist'), path.join(dir, 'willow', 'apps', 'studio', 'dist'));
    if (!keepAgents) {
      mirror(path.join(agentsDir, 'apps', 'server', 'dist'), path.join(dir, 'willow', 'vendor', 't3code', 'apps', 'server', 'dist'), (file) => !file.endsWith('.map'));
    }
    openWillow(dir);
  } else {
    say(stamp ? 'The app itself changed: building Willow and its installer...' : 'Building Willow and its installer...');
    await run(process.execPath, [path.join(desktopDir, 'scripts', 'build.mjs'), '--bundles', 'nsis', ...(keepAgents ? ['--skip-agents-build'] : [])], { cwd: repoRoot, env });

    const bundle = path.join(tauriDir, 'target', 'release', 'bundle', 'nsis');
    const installer = fs
      .readdirSync(bundle)
      .filter((name) => name.endsWith('-setup.exe'))
      .map((name) => path.join(bundle, name))
      .filter((file) => fs.statSync(file).mtimeMs >= startedAt)
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
    if (!installer) throw new Error(`the build made no new installer in ${bundle}`);

    say('Installing: Willow closes, updates and opens again...');
    installing = true;
    // /S: silently, closing Willow if it is open. Willow opens again through the shell rather than
    // the installer's /R, which hands it this script's environment: the packing shell's variables
    // (a dev server's PORT, T3CODE_PORT, build switches) would reach Willow and its agents.
    await run(installer, ['/S'], { env });
    const installed = installDir();
    if (installed) {
      fs.writeFileSync(STAMP, `${JSON.stringify({ parts, program: programStamp(installed), packedAt: new Date().toISOString() }, null, 2)}\n`);
      openWillow(installed);
    }
  }
  for (let waited = 0; waited < 30 && !willowRunning(); waited++) await sleep(1000);

  const minutes = Math.max(1, Math.round((Date.now() - startedAt) / 60_000));
  return `Done in ${minutes} min. Willow now has this folder as it was at ${clock(startedAt)}${willowRunning() ? '' : ' (open it from the Start menu)'}.`;
};

if (process.platform !== 'win32') {
  say('Packing into the app is for Windows; elsewhere, build with scripts/build.mjs.');
  process.exit(1);
}
process.on('exit', releaseLock);
for (const signal of ['SIGINT', 'SIGHUP', 'SIGBREAK']) process.on(signal, () => process.exit(130));

try {
  say(await pack());
} catch (error) {
  say(installing
    ? `The update stopped (${error.message}). Open Willow to see whether it went in.`
    : `Stopped: ${error.message}. Nothing new was installed.`);
  process.exitCode = 1;
}
