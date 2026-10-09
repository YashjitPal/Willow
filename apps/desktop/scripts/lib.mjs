/**
 * What the desktop build scripts share: where things are, how to run a step,
 * and the toolchain environment Tauri builds need.
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const repoRoot = path.resolve(desktopDir, '..', '..');
export const tauriDir = path.join(desktopDir, 'src-tauri');
export const buildDir = path.join(desktopDir, 'build');

/**
 * On Windows, Rust links with the newest Visual Studio it finds. A preview
 * install without the x64 C runtime libraries then fails with LNK1104
 * (msvcrt.lib), so when no developer environment is active, load one from an
 * install whose MSVC toolset is complete.
 */
const findVcvars = () => {
  const vswhere = path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  if (!fs.existsSync(vswhere)) return null;
  const installs = JSON.parse(execFileSync(vswhere, ['-products', '*', '-prerelease', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-format', 'json'], { encoding: 'utf8' }));
  for (const install of installs) {
    const toolsets = path.join(install.installationPath, 'VC', 'Tools', 'MSVC');
    const vcvars = path.join(install.installationPath, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
    const complete = fs.existsSync(toolsets) && fs.readdirSync(toolsets).some((version) => fs.existsSync(path.join(toolsets, version, 'lib', 'x64', 'msvcrt.lib')));
    if (complete && fs.existsSync(vcvars)) return vcvars;
  }
  return null;
};

let msvc;
const msvcEnvironment = () => {
  if (process.platform !== 'win32' || process.env.VCINSTALLDIR) return {};
  if (msvc) return msvc;
  const vcvars = findVcvars();
  msvc = {};
  if (!vcvars) return msvc;
  const output = execFileSync('cmd.exe', ['/d', '/s', '/c', `""${vcvars}" >nul && set"`], { encoding: 'utf8', windowsVerbatimArguments: true, maxBuffer: 16 * 1024 * 1024 });
  for (const line of output.split(/\r?\n/)) {
    const match = /^([^=]+)=(.*)$/.exec(line);
    if (match) msvc[match[1]] = match[2];
  }
  return msvc;
};

/** The environment for toolchain steps: the MSVC developer environment where needed, and Cargo on PATH. */
export const toolEnv = (extra = {}) => {
  // Windows variable names are case-insensitive; keep one entry per name.
  const merged = new Map();
  for (const source of [process.env, msvcEnvironment(), extra]) {
    for (const [key, value] of Object.entries(source)) {
      if (value === undefined) continue;
      const id = process.platform === 'win32' ? key.toUpperCase() : key;
      merged.set(id, [merged.get(id)?.[0] ?? key, value]);
    }
  }
  const env = Object.fromEntries(merged.values());
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
  const cargoBin = path.join(os.homedir(), '.cargo', 'bin');
  const entries = (env[pathKey] ?? '').split(path.delimiter);
  if (fs.existsSync(cargoBin) && !entries.includes(cargoBin)) env[pathKey] = [cargoBin, ...entries].join(path.delimiter);
  return env;
};

/** Runs a step with its output shown, rejecting if it fails. */
export const run = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: 'inherit', ...options });
  child.once('error', reject);
  child.once('exit', (code, signal) => {
    if (code === 0) resolve();
    else reject(new Error(`${path.basename(command)} ${args[0] ?? ''} failed (${signal ?? `exit ${code}`})`));
  });
});

/** The Rust host triple, e.g. x86_64-pc-windows-msvc. */
export const hostTriple = () => {
  const output = execFileSync('rustc', ['-vV'], { encoding: 'utf8', env: toolEnv() });
  const host = /^host: (\S+)$/m.exec(output)?.[1];
  if (!host) throw new Error('rustc -vV did not report a host triple. Is Rust installed?');
  return host;
};

/** Runs the Tauri CLI installed in apps/desktop, installing it on first use. */
export const runTauri = async (args, extraEnv = {}) => {
  const cli = path.join(desktopDir, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
  if (!fs.existsSync(cli)) {
    // Under `npm run`, npm_execpath is npm's own script, so no shell is needed to run it.
    if (!process.env.npm_execpath) throw new Error('The Tauri CLI is not installed. Run `npm --prefix apps/desktop install` first.');
    await run(process.execPath, [process.env.npm_execpath, 'install', '--no-audit', '--no-fund'], { cwd: desktopDir });
  }
  return run(process.execPath, [cli, ...args], { cwd: desktopDir, env: toolEnv(extraEnv) });
};
