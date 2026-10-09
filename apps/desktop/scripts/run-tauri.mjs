/** `npm run tauri -- <args>`: the Tauri CLI with the toolchain environment Willow's builds need. */
import { runTauri } from './lib.mjs';

await runTauri(process.argv.slice(2));
