/**
 * Reasoning effort, on Codex's ladder.
 *
 * Effort is part of the harness rather than the model — upstream carries it as
 * `model_reasoning_effort` — and its scale goes two rungs past Willow's own,
 * ending at Ultra. These pin the ladder itself and the clamping behaviour,
 * because silently delivering a lower effort than the user selected is the
 * failure that would be hardest to notice.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const effort = await importTs(
  path.join(repoRoot, 'features', 'code-beta', 'src', 'harness', 'overlay', 'effort.ts'),
);

const {
  CODEX_EFFORTS,
  EFFORT_LABEL,
  levelToEffort,
  effortToLevel,
  supportedEfforts,
  resolveEffort,
} = effort;

it("matches upstream Codex's ReasoningEffort enum, in order", () => {
  // Verified against codex-rs/protocol/src/openai_models.rs. Ultra is the top
  // rung, above Max — it is a real upstream value, not an invention.
  assert.deepEqual(CODEX_EFFORTS, [
    'none',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
    'ultra',
  ]);
  assert.equal(CODEX_EFFORTS[CODEX_EFFORTS.length - 1], 'ultra');
  assert.equal(EFFORT_LABEL.ultra, 'Ultra');
});

it('round-trips through the numeric level Willow persists', () => {
  for (const name of ['none', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']) {
    assert.equal(levelToEffort(effortToLevel(name)), name, `${name} did not round-trip`);
  }
  // Willow's scale tops out at 6, which is Ultra here.
  assert.equal(levelToEffort(6), 'ultra');
  assert.equal(levelToEffort(99), 'ultra', 'out-of-range should clamp, not throw');
});

it('offers the full ladder only on models that accept it', () => {
  const frontier = supportedEfforts({ providerId: 'openai', modelId: 'gpt-5.5' });
  assert.ok(frontier.includes('ultra'));
  assert.ok(frontier.includes('xhigh'));

  // Gemini Pro cannot turn thinking off, and nothing outside frontier OpenAI
  // takes the top rungs.
  const geminiPro = supportedEfforts({ providerId: 'gemini', modelId: 'gemini-3-pro' });
  assert.ok(!geminiPro.includes('none'));
  assert.ok(!geminiPro.includes('ultra'));
});

it('clamps down to the nearest supported rung rather than failing', () => {
  // Asking for more than a model supports must not silently give *less* than
  // the next level down, and the caller has to be able to say it was clamped.
  const resolved = resolveEffort('ultra', { providerId: 'gemini', modelId: 'gemini-3-pro' });

  assert.equal(resolved.requested, 'ultra');
  assert.equal(resolved.effective, 'high');
  assert.equal(resolved.clamped, true);
  assert.equal(resolved.level, effortToLevel('high'));
});

it('reports no clamp when the model supports the request', () => {
  const resolved = resolveEffort('ultra', { providerId: 'openai', modelId: 'gpt-5.5-codex' });
  assert.equal(resolved.effective, 'ultra');
  assert.equal(resolved.clamped, false);
});

it('tells the model which effort it is running at', () => {
  // Upstream's prompt is written assuming the agent knows — it talks about
  // being thorough or quick without ever saying which it is.
  const agent = fs.readFileSync(
    path.join(repoRoot, 'features', 'code-beta', 'src', 'harness', 'runtime', 'agent.ts'),
    'utf8',
  );
  assert.match(agent, /<effort>/);
  assert.match(agent, /reasoning effort/);
  // And it must say so when the request was lowered.
  assert.match(agent, /does not support it/);
});

it('is a Code Beta control, not a change to the shared model menu', () => {
  // Adding Ultra to `platform/ui`'s ModelsMenu would push it onto the Code tab
  // too, where nothing honours it.
  const shared = fs.readFileSync(
    path.join(repoRoot, 'platform', 'ai', 'src', 'models', 'efforts.ts'),
    'utf8',
  );
  assert.doesNotMatch(shared, /ultra/i, 'Ultra must not leak into the shared effort scale');

  const sidebar = fs.readFileSync(
    path.join(repoRoot, 'features', 'code-beta', 'src', 'workbench', 'WorkbenchSidebar.tsx'),
    'utf8',
  );
  assert.match(sidebar, /CODEX_EFFORTS/);
  assert.match(sidebar, /effort: codexEffort/);
});
