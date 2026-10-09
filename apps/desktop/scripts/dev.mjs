/**
 * Runs the desktop app against a Vite dev server, with Rust rebuilt on change.
 * Vite uses its own port (WILLOW_DESKTOP_DEV_PORT, default 3417), so it never
 * competes with a dev server already on 3000, and the window keeps that origin
 * — and so its data — between runs.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { hostTriple, repoRoot, runTauri } from './lib.mjs';
import { prepareNode } from './node-runtime.mjs';
import { stage } from './stage.mjs';

const port = Number(process.env.WILLOW_DESKTOP_DEV_PORT || 3417);
stage({ dev: true });
await prepareNode(hostTriple());

const studio = path.join(repoRoot, 'apps', 'studio');
const vite = createRequire(path.join(studio, 'package.json')).resolve('vite/bin/vite.js');
const server = spawn(process.execPath, [vite, '--port', String(port), '--strictPort'], { cwd: studio, stdio: 'inherit' });
const stop = () => server.kill();
process.once('exit', stop);
process.once('SIGINT', () => process.exit(130));

try {
  await runTauri(['dev'], { WILLOW_DESKTOP_DEV_URL: `http://localhost:${port}/` });
} finally {
  stop();
}
