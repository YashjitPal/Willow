/**
 * The Node.js that runs Willow's server and companion inside the desktop app,
 * placed where Tauri expects a sidecar: `src-tauri/binaries/willow-node-<target>`.
 *
 * It is the official build from nodejs.org for the target, checked against the
 * release's SHASUMS256.txt — the same on a laptop and in CI. Willow bundles the
 * newest LTS release of NODE_LINE unless WILLOW_NODE_VERSION pins one.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildDir, hostTriple, tauriDir } from './lib.mjs';

const NODE_LINE = 'v24';

const TARGETS = {
  'x86_64-pc-windows-msvc': { dist: 'win-x64', archive: 'zip', binary: 'node.exe' },
  'aarch64-pc-windows-msvc': { dist: 'win-arm64', archive: 'zip', binary: 'node.exe' },
  'x86_64-apple-darwin': { dist: 'darwin-x64', archive: 'tar.gz', binary: 'bin/node' },
  'aarch64-apple-darwin': { dist: 'darwin-arm64', archive: 'tar.gz', binary: 'bin/node' },
  'x86_64-unknown-linux-gnu': { dist: 'linux-x64', archive: 'tar.gz', binary: 'bin/node' },
  'aarch64-unknown-linux-gnu': { dist: 'linux-arm64', archive: 'tar.gz', binary: 'bin/node' },
};

const resolveVersion = async () => {
  if (process.env.WILLOW_NODE_VERSION) return `v${process.env.WILLOW_NODE_VERSION.replace(/^v/, '')}`;
  const releases = await (await fetch('https://nodejs.org/dist/index.json')).json();
  const latest = releases.find((release) => release.version.startsWith(`${NODE_LINE}.`) && release.lts);
  if (!latest) throw new Error(`nodejs.org lists no LTS release of ${NODE_LINE}.`);
  return latest.version;
};

const download = async (url, file) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Downloading ${url} failed: ${response.status}`);
  fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
};

// Windows ships bsdtar, which unpacks zip archives; a GNU tar earlier on PATH would not.
const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';

export const prepareNode = async (triple = hostTriple()) => {
  const target = TARGETS[triple];
  if (!target) throw new Error(`Willow has no Node.js build for ${triple}. Known targets: ${Object.keys(TARGETS).join(', ')}.`);
  const output = path.join(tauriDir, 'binaries', `willow-node-${triple}${target.binary.endsWith('.exe') ? '.exe' : ''}`);
  const marker = `${output}.version`;

  let version;
  try {
    version = await resolveVersion();
  } catch (error) {
    if (fs.existsSync(output)) {
      console.warn(`[desktop] could not check for a newer Node.js (${error.message}); keeping ${fs.readFileSync(marker, 'utf8')}.`);
      return output;
    }
    throw error;
  }
  if (fs.existsSync(output) && fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === version) return output;

  const name = `node-${version}-${target.dist}`;
  const file = `${name}.${target.archive}`;
  const cache = path.join(buildDir, 'cache');
  fs.mkdirSync(cache, { recursive: true });
  const archive = path.join(cache, file);
  if (!fs.existsSync(archive)) {
    console.log(`[desktop] downloading Node.js ${version} for ${triple}`);
    await download(`https://nodejs.org/dist/${version}/${file}`, archive);
  }

  const sums = await (await fetch(`https://nodejs.org/dist/${version}/SHASUMS256.txt`)).text();
  const expected = sums.split('\n').find((line) => line.trim().endsWith(`  ${file}`))?.split(/\s+/)[0];
  const actual = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  if (!expected || expected !== actual) {
    fs.rmSync(archive, { force: true });
    throw new Error(`${file} does not match its published checksum; deleted it. Run the build again.`);
  }

  const unpacked = path.join(cache, name);
  fs.rmSync(unpacked, { recursive: true, force: true });
  execFileSync(tar, ['-xf', archive, '-C', cache], { stdio: 'inherit' });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.copyFileSync(path.join(unpacked, target.binary), output);
  if (process.platform !== 'win32') fs.chmodSync(output, 0o755);
  fs.writeFileSync(marker, version);
  fs.rmSync(unpacked, { recursive: true, force: true });
  console.log(`[desktop] bundled Node.js ${version} as ${path.relative(tauriDir, output)}`);
  return output;
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const index = process.argv.indexOf('--target');
  await prepareNode(index === -1 ? undefined : process.argv[index + 1]);
}
