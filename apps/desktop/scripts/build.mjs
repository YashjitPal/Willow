/**
 * Builds the desktop app: Willow itself (without reading any .env), the agent
 * tabs' server, the staged resources, the bundled Node.js, then `tauri build`.
 *
 *   node scripts/build.mjs [--target <rust triple>] [--bundles nsis,msi,...] [--skip-app-build] [--skip-agents-build]
 *
 * `--skip-agents-build` stages the agent tabs' server as it was last built, for when its source
 * is in the middle of an edit.
 */
import path from 'node:path';
import { buildAgents } from './agents.mjs';
import { hostTriple, repoRoot, run, runTauri } from './lib.mjs';
import { prepareNode } from './node-runtime.mjs';
import { stage } from './stage.mjs';

const option = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};
const target = option('--target');
const bundles = option('--bundles');

if (!process.argv.includes('--skip-app-build')) {
  await run(process.execPath, [path.join(repoRoot, 'apps', 'studio', 'scripts', 'build-production.mjs')], { cwd: repoRoot });
}
if (!process.argv.includes('--skip-agents-build')) await buildAgents();
stage();
await prepareNode(target ?? hostTriple());
await runTauri(['build', ...(target ? ['--target', target] : []), ...(bundles ? ['--bundles', bundles] : [])]);
