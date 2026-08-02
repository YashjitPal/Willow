#!/usr/bin/env node
/**
 * Sweep the leftovers of `Front End/Dashboard` after migrate-layout.mjs.
 *
 * Everything that is not application source is one-off UI research: Puppeteer
 * scrapers used to reverse-engineer Gemini's UI, plus the JSON/CSS/PNG dumps
 * they produced. It is archived under tools/ui-research/ rather than deleted,
 * and generated build output is dropped.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DASH = path.join(ROOT, 'Front End', 'Dashboard');
const ARCHIVE = path.join(ROOT, 'tools', 'ui-research');

if (!fs.existsSync(DASH)) {
  console.log('nothing to sweep: Front End/Dashboard is already gone');
  process.exit(0);
}

/** Generated output — safe to drop, reproducible from source. */
const DROP_DIRS = ['.next', 'dist', '.vercel', '.firebase', '.playwright-cli', 'output'];

/** Where each archived file goes, by filename shape. */
function bucketFor(name) {
  const lower = name.toLowerCase();
  if (/^(capture|record|monitor|observe)_/.test(lower)) return 'scrapers/capture';
  if (/^(extract|dump|get|grab|fetch|download|find|search)_/.test(lower)) return 'scrapers/extract';
  if (/^(inspect|measure|analyze|check|sample|test\d|test_)/.test(lower)) return 'scrapers/inspect';
  if (/\.(cjs|mjs|js|py)$/.test(lower)) return 'scrapers/misc';
  if (/\.(png|jpe?g|svg|gif|webp)$/.test(lower)) return 'captures/images';
  if (/\.(json)$/.test(lower)) return 'captures/data';
  if (/\.(css)$/.test(lower)) return 'captures/css';
  if (/\.(html?)$/.test(lower)) return 'captures/html';
  if (/\.(txt|log|csv|patch|diff)$/.test(lower)) return 'captures/logs';
  return 'captures/misc';
}

/** Files that must NOT be archived — real config that still has a home. */
const KEEP = new Set(['eslint.config.cjs', 'eslint.config.mjs', 'tsconfig.json', '.gitignore']);

let archived = 0;
let dropped = 0;

for (const entry of fs.readdirSync(DASH, { withFileTypes: true })) {
  const src = path.join(DASH, entry.name);

  if (entry.isDirectory()) {
    if (DROP_DIRS.includes(entry.name)) {
      try {
        fs.rmSync(src, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        dropped++;
        console.log(`  dropped generated dir: ${entry.name}`);
      } catch (err) {
        console.log(`  ! could not drop ${entry.name} (${err.code}) — remove it manually`);
      }
    } else {
      // Directories emptied by the layout migration; anything left is a surprise.
      const remaining = fs.readdirSync(src);
      if (remaining.length === 0) {
        fs.rmdirSync(src);
        console.log(`  removed empty dir: ${entry.name}`);
      } else {
        console.log(`  ! unexpected dir left behind, keeping: ${entry.name} -> ${remaining.slice(0, 6).join(', ')}`);
      }
    }
    continue;
  }

  if (KEEP.has(entry.name)) {
    console.log(`  ! config left behind, keeping: ${entry.name}`);
    continue;
  }

  const dest = path.join(ARCHIVE, bucketFor(entry.name), entry.name);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) {
    fs.rmSync(src);
  } else {
    fs.renameSync(src, dest);
  }
  archived++;
}

console.log(`\nArchived ${archived} research files, dropped ${dropped} generated dirs.`);
