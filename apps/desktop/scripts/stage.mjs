/**
 * Assembles what the desktop app runs into `build/willow/`, which Tauri bundles
 * as the `willow/` resource. The layout mirrors the repository, so
 * `bin/willow.js` finds the built app and the browse proxy exactly where it
 * does in a checkout:
 *
 *   willow/package.json                    type: module, and the version bin/willow.js reports
 *   willow/bin/willow.js                   Willow's production server
 *   willow/api/                            the browse proxy, /llm-proxy and /api/fetch-source
 *   willow/node_modules/html2canvas/       the one package the proxy loads
 *   willow/apps/studio/dist/               the built app
 *   willow/services/local-companion/       the companion, with its node_modules
 *   willow/features/spark/src/pets/hatch-pet/   the Hatch Pet skill a pet is created with
 *   willow/vendor/t3code/apps/server/      the agent tabs' server, with its node_modules (agents.mjs)
 *
 * `--dev` leaves a placeholder: development runs these from the repository.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { stageAgents } from './agents.mjs';
import { buildDir, repoRoot } from './lib.mjs';

export const stage = ({ dev = false } = {}) => {
  const out = path.join(buildDir, 'willow');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  if (dev) {
    fs.writeFileSync(path.join(out, 'README.txt'), 'Development builds run Willow from the repository. Release builds stage the app here.\n');
    return out;
  }

  const copy = (from, to = from, { optional = false } = {}) => {
    const source = path.join(repoRoot, from);
    if (!fs.existsSync(source)) {
      if (optional) return;
      throw new Error(`${from} is missing.`);
    }
    fs.mkdirSync(path.dirname(path.join(out, to)), { recursive: true });
    fs.cpSync(source, path.join(out, to), { recursive: true });
  };

  if (!fs.existsSync(path.join(repoRoot, 'apps', 'studio', 'dist', 'index.html'))) {
    throw new Error('apps/studio/dist is missing: build Willow first (scripts/build.mjs does).');
  }
  copy('apps/studio/dist');
  copy('bin/willow.js');
  for (const file of ['_browse-proxy.js', '_browse-bridge.js', '_private-host.js', '_llm-proxy.js', 'fetch-source.js']) copy(`api/${file}`);
  copy('node_modules/html2canvas/package.json');
  copy('node_modules/html2canvas/dist/html2canvas.min.js');
  copy('node_modules/html2canvas/LICENSE', undefined, { optional: true });
  copy('services/local-companion/package.json');
  copy('services/local-companion/src');
  copy('services/local-companion/node_modules');
  copy('features/spark/src/pets/hatch-pet');
  stageAgents(out);

  const { version } = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  fs.writeFileSync(path.join(out, 'package.json'), `${JSON.stringify({ name: 'willow-studio', version, private: true, type: 'module' }, null, 2)}\n`);
  return out;
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`[desktop] staged ${stage({ dev: process.argv.includes('--dev') })}`);
}
