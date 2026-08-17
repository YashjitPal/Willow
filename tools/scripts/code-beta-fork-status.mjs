#!/usr/bin/env node
/**
 * Fork status for features/code-beta.
 *
 * Code Beta started as a byte-exact copy of `features/code` and diverges from it
 * deliberately: the harness is replaced, the transcript UI is replaced, and the
 * rest is meant to track upstream Code. Six months from now nobody will remember
 * which files were intentionally changed and which merely drifted, so this
 * reports the difference against the recorded fork point.
 *
 * It is informational, never a gate — divergence is the whole point of the fork.
 * `--json` prints a machine-readable summary for other tooling.
 *
 * Usage:
 *   node tools/scripts/code-beta-fork-status.mjs
 *   node tools/scripts/code-beta-fork-status.mjs --json
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const SOURCE = path.join(REPO_ROOT, 'features', 'code', 'src');
const FORK = path.join(REPO_ROOT, 'features', 'code-beta', 'src');
const MANIFEST = path.join(REPO_ROOT, 'features', 'code-beta', 'FORK.json');

const asJson = process.argv.includes('--json');
const rewrite = process.argv.includes('--record');

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

async function walk(root) {
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path.relative(root, path.join(entry.parentPath ?? entry.path, entry.name)),
    )
    .map((entry) => entry.split(path.sep).join('/'))
    .sort();
}

const hashOf = async (file) => sha256(await readFile(file));

const manifest = existsSync(MANIFEST)
  ? JSON.parse(await readFile(MANIFEST, 'utf8'))
  : null;

const sourceFiles = await walk(SOURCE);
const forkFiles = await walk(FORK);
const forkSet = new Set(forkFiles);

const shared = [];
const removed = [];
const added = [];

for (const file of sourceFiles) {
  if (!forkSet.has(file)) {
    removed.push(file);
    continue;
  }
  const a = await hashOf(path.join(SOURCE, file));
  const b = await hashOf(path.join(FORK, file));
  shared.push({ file, changed: a !== b, forkHash: b });
}

const sourceSet = new Set(sourceFiles);
for (const file of forkFiles) {
  if (!sourceSet.has(file)) added.push(file);
}

if (rewrite) {
  const record = {
    $comment:
      'Records the point features/code-beta forked from features/code. ' +
      'Regenerate with `node tools/scripts/code-beta-fork-status.mjs --record` ' +
      'only when deliberately re-syncing.',
    forkedFrom: 'features/code/src',
    commit: process.env.CODE_BETA_FORK_COMMIT ?? manifest?.commit ?? null,
    recordedAt: new Date().toISOString(),
    files: shared.map(({ file, forkHash }) => ({ file, sha256: forkHash })),
  };
  await writeFile(MANIFEST, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  console.log(`Recorded ${record.files.length} files in ${path.relative(REPO_ROOT, MANIFEST)}`);
  process.exit(0);
}

const changed = shared.filter((entry) => entry.changed);
const untouched = shared.length - changed.length;

if (asJson) {
  console.log(
    JSON.stringify(
      {
        commit: manifest?.commit ?? null,
        untouched,
        changed: changed.map((entry) => entry.file),
        addedInFork: added,
        removedFromFork: removed,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

console.log(`Fork point: ${manifest?.commit?.slice(0, 12) ?? '(not recorded)'}`);
console.log(`Comparing features/code-beta/src against features/code/src\n`);
console.log(`  ${String(untouched).padStart(3)} files still identical to Code`);
console.log(`  ${String(changed.length).padStart(3)} files diverged`);
console.log(`  ${String(added.length).padStart(3)} files exist only in Code Beta`);
console.log(`  ${String(removed.length).padStart(3)} files exist only in Code`);

if (changed.length > 0) {
  console.log('\nDiverged:');
  for (const entry of changed) console.log(`  ${entry.file}`);
}
if (removed.length > 0) {
  console.log('\nIn Code but not Code Beta (new upstream work, or deleted here):');
  for (const file of removed) console.log(`  ${file}`);
}

console.log(
  '\nDivergence is expected — the harness and transcript UI are replaced by design.\n' +
    'Use `git diff --no-index features/code/src/<file> features/code-beta/src/<file>`\n' +
    'to see exactly how one file differs.',
);
