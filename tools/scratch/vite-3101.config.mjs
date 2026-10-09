// apps/studio's Vite config with a dependency cache of its own, for the :3101 test server: two
// dev servers optimizing into one `node_modules/.vite` rewrite each other's files.
//   cd apps/studio; npx vite --port 3101 --strictPort --config ../../tools/scratch/vite-3101.config.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import base from '../../apps/studio/vite.config.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

export default async (env) => {
  const config = typeof base === 'function' ? await base(env) : base;
  return {
    ...config,
    root: config.root ?? path.resolve(here, '../../apps/studio'),
    cacheDir: path.resolve(here, '../../apps/studio/node_modules/.vite-3101'),
    // No pushed reloads: a page under test must not reload because another agent saved a file
    // (a reload without a project id falls back to the studio home). Each new page load still
    // gets the latest code.
    server: { ...config.server, hmr: false },
  };
};
