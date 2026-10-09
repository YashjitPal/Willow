/**
 * Spark's vendored Codex files are byte-for-byte upstream.
 *
 * `features/spark/src/harness/upstream/` is never edited: Willow's changes live
 * in `overlay/` and apply at runtime, and `npm run codex:update` replaces this
 * folder wholesale. A checksum that drifts means someone edited the wrong file —
 * and that the next upgrade would silently throw their change away.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const harnessRoot = path.join(repoRoot, 'features', 'spark', 'src', 'harness');
const upstreamRoot = path.join(harnessRoot, 'upstream');
const read = (file) => fs.readFileSync(path.join(upstreamRoot, file), 'utf8');
const manifest = JSON.parse(read('MANIFEST.json'));

const overlay = await importTs(path.join(harnessRoot, 'overlay', 'prompt-overlay.ts'));
const compose = () =>
  overlay.composePrompt(
    read('prompt_with_apply_patch_instructions.md'),
    overlay.buildOverlay({ applyPatchInstructions: read('apply_patch_tool_instructions.md') }),
  );

it('vendored upstream files match the manifest checksums', () => {
  assert.ok(manifest.files.length > 0);
  for (const file of manifest.files) {
    const target = path.join(upstreamRoot, file.local);
    assert.ok(fs.existsSync(target), `${file.local} is listed in MANIFEST.json but missing`);
    const actual = createHash('sha256').update(fs.readFileSync(target)).digest('hex');
    assert.equal(actual, file.sha256, `${file.local} does not match MANIFEST.json — edit overlay/, not upstream/`);
  }
});

it('records the provenance the upstream licence requires', () => {
  assert.equal(manifest.license, 'Apache-2.0');
  assert.match(manifest.repository, /github\.com\/openai\/codex/);
  assert.ok(manifest.commit.length >= 40, 'the pin must be a full commit sha');
  assert.ok(fs.existsSync(path.join(upstreamRoot, 'LICENSE')));
  assert.ok(fs.existsSync(path.join(upstreamRoot, 'NOTICE')));
});

it('finds every required overlay anchor in the vendored prompt', () => {
  // An upgrade that moves a section upstream throws here, by design: a skipped
  // replacement would leave upstream's shell guidance in a browser app.
  assert.doesNotThrow(compose);
});

it('keeps the behavioural middle of the upstream prompt', () => {
  // Upstream puts `# AGENTS.md spec` at level 1, so everything after it parses
  // as nested under it; dropping it with descendants once removed most of the
  // agent's behaviour while still producing a plausible prompt.
  const { prompt } = compose();
  for (const heading of ['## Planning', '## Task execution', '## Validating your work', '### Preamble messages']) {
    assert.ok(prompt.includes(heading), `composed prompt lost ${heading}`);
  }
  assert.doesNotMatch(prompt, /# AGENTS\.md spec/);
});

it('keeps upstream apply_patch grammar while replacing its shell invocation', () => {
  const { prompt } = compose();
  assert.match(prompt, /\*\*\* Begin Patch/);
  assert.match(prompt, /AddFile := /);
  assert.doesNotMatch(prompt, /shell \{"command":\["apply_patch"/);
  assert.doesNotMatch(prompt, /Emit function calls to run terminal commands/);
});
