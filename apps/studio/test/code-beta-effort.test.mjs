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
  selectableEfforts,
  resolveEffort,
  harnessEffort,
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

it('never treats ultra as a wire value', () => {
  /*
   * Upstream is explicit about this. PR #29709: "Ultra is a product-level
   * reasoning selection… without introducing a new backend reasoning token.
   * Lower Ultra to `max` at the Responses API boundary."
   *
   * So no provider list may contain it — `supportedEfforts` answers "what can
   * the API be told", and the answer is never "ultra".
   */
  for (const model of [
    { providerId: 'openai', modelId: 'gpt-5.5-codex' },
    { providerId: 'gemini', modelId: 'gemini-3-pro' },
    { providerId: 'anthropic', modelId: 'claude-opus-5' },
  ]) {
    assert.ok(
      !supportedEfforts(model).includes('ultra'),
      `${model.modelId} must not list ultra as an API value`,
    );
  }
});

it('offers ultra on every model, because it is a mode not a level', () => {
  // What Ultra selects is proactive delegation, which is Willow's own loop.
  // Nothing about it depends on the provider, so it is always selectable.
  for (const model of [
    { providerId: 'openai', modelId: 'gpt-5.5-codex' },
    { providerId: 'gemini', modelId: 'gemini-3-pro' },
    { providerId: 'anthropic', modelId: 'claude-opus-5' },
    { providerId: 'zhipuai', modelId: 'glm-5' },
  ]) {
    assert.ok(
      selectableEfforts(model).includes('ultra'),
      `${model.modelId} should offer ultra`,
    );
  }
});

it('lowers ultra to the model ceiling without calling it a clamp', () => {
  // Lowering is Ultra's designed behaviour, not a downgrade. Reporting it as a
  // clamp would tell the user they lost something they did not lose.
  const onFrontier = resolveEffort('ultra', { providerId: 'openai', modelId: 'gpt-5.5-codex' });
  assert.equal(onFrontier.effective, 'max', 'ultra lowers to max where max exists');
  assert.equal(onFrontier.clamped, false);
  assert.notEqual(onFrontier.effective, 'ultra', 'ultra must never go on the wire');

  const onGeminiPro = resolveEffort('ultra', { providerId: 'gemini', modelId: 'gemini-3-pro' });
  assert.equal(onGeminiPro.effective, 'high', "and to the model's own ceiling elsewhere");
  assert.equal(onGeminiPro.clamped, false);

  // The mode is delivered in full on both.
  assert.equal(onFrontier.harness.delegation, 'proactive');
  assert.equal(onGeminiPro.harness.delegation, 'proactive');
});

it('still clamps ordinary levels, which is a real loss', () => {
  // xhigh *is* a wire value, and Gemini Pro does not take it.
  const resolved = resolveEffort('xhigh', { providerId: 'gemini', modelId: 'gemini-3-pro' });
  assert.equal(resolved.effective, 'high');
  assert.equal(resolved.clamped, true);
  assert.equal(resolved.level, effortToLevel('high'));
});

it('makes proactive delegation exclusive to ultra', () => {
  for (const level of CODEX_EFFORTS) {
    const expected = level === 'ultra' ? 'proactive' : 'on-request';
    assert.equal(
      harnessEffort(level).delegation,
      expected,
      `${level} should be ${expected}`,
    );
  }
});

it('tells the agent to delegate proactively, and the prompt explains both modes', () => {
  const agent = fs.readFileSync(
    path.join(repoRoot, 'features', 'code-beta', 'src', 'harness', 'runtime', 'agent.ts'),
    'utf8',
  );
  assert.match(agent, /<delegation>proactive/);
  assert.match(agent, /without being asked/);

  // The tool description has to cover both modes, since that is what the model
  // reads when deciding whether to fan out.
  const overlay = fs.readFileSync(
    path.join(repoRoot, 'features', 'code-beta', 'src', 'harness', 'overlay', 'prompt-overlay.ts'),
    'utf8',
  );
  // Backticks are escaped inside the template literal, so match the words.
  assert.match(overlay, /on-request/);
  assert.match(overlay, /proactive/);
  assert.match(overlay, /split the work up front/i);
});

it('sends the effort name explicitly, not just the numeric level', () => {
  /*
   * The bug this pins: `chat.ts` reads `options.reasoningEffort || <map>`, and
   * every one of its maps stops below Codex's ladder — OpenAI maps level 6 to
   * "max", and Gemini Pro misses level 6 entirely and falls through to 'low'.
   *
   * Passing only `thinkingLevel` therefore made Ultra decorative: it was never
   * sent, and on Gemini Pro it would have become the *lowest* setting.
   */
  const binding = fs.readFileSync(
    path.join(repoRoot, 'features', 'code-beta', 'src', 'model-binding.ts'),
    'utf8',
  );
  assert.match(binding, /reasoningEffort: resolved\.effective/);
  assert.match(binding, /thinkingLevel: resolved\.level/);

  // And the map that made it necessary is still shaped that way upstream.
  const chat = fs.readFileSync(path.join(repoRoot, 'platform', 'ai', 'src', 'chat.ts'), 'utf8');
  assert.match(chat, /options\.reasoningEffort \|\|/);
});

it('runs the harness at the requested level whatever the wire value', () => {
  /*
   * Effort is two things. The API parameter is model-dependent; the harness
   * half — loop budget, delegation mode, working guidance — is Willow's own and
   * works on any model. That split is what lets Ultra mean the same thing
   * everywhere even though its wire value differs per model.
   */
  const onGeminiPro = resolveEffort('ultra', { providerId: 'gemini', modelId: 'gemini-3-pro' });

  assert.equal(onGeminiPro.effective, 'high', "wire value is the model's ceiling");
  assert.equal(onGeminiPro.harness.maxIterations, harnessEffort('ultra').maxIterations);
  assert.equal(onGeminiPro.harness.delegation, 'proactive');
  assert.match(onGeminiPro.harness.guidance, /proactive delegation mode/i);
});

it('gives higher effort a larger tool-call budget', () => {
  // At low effort a turn that keeps calling tools is usually stuck; at ultra it
  // is usually working. One fixed ceiling cannot serve both.
  const budgets = CODEX_EFFORTS.map((effort) => harnessEffort(effort).maxIterations);
  for (let i = 1; i < budgets.length; i += 1) {
    assert.ok(budgets[i] >= budgets[i - 1], `budget dropped at ${CODEX_EFFORTS[i]}`);
  }
  assert.ok(harnessEffort('ultra').maxIterations > harnessEffort('medium').maxIterations);

  const agent = fs.readFileSync(
    path.join(repoRoot, 'features', 'code-beta', 'src', 'harness', 'runtime', 'agent.ts'),
    'utf8',
  );
  assert.match(agent, /harness\?\.maxIterations/);
  assert.match(agent, /iteration < budget/);
});

it('tells the agent the requested level and how to work at it', () => {
  const agent = fs.readFileSync(
    path.join(repoRoot, 'features', 'code-beta', 'src', 'harness', 'runtime', 'agent.ts'),
    'utf8',
  );
  // The requested level, not the clamped one — this section governs behaviour.
  assert.match(agent, /working at \$\{effort\.requested\} effort/);
  assert.match(agent, /<how-to-work>/);
  // But it must be honest that the API call itself was capped.
  assert.match(agent, /caps reasoning at/);

  // It is standing guidance, so it belongs in the system prompt. On the user's
  // message it read as an instruction attached to whatever they typed, and made
  // a greeting look like a build request.
  assert.match(agent, /\[profile\.systemPrompt, effortSection\(options\.model\)\]/);
  // And it must say plainly that it only governs work the user asked for.
  assert.match(agent, /A greeting, a/);
});

it('sets how much care to take without ordering tools to be used', () => {
  /*
   * The guidance used to say "Plan before acting with `update_plan`" and
   * "Verify the result with `computer_use`", which made both unconditional:
   * every build opened with a plan and closed with a browser session whatever
   * the user asked for.
   *
   * Upstream already decides both, and better than a blanket rule can — its
   * planning section says outright not to plan simple work, and validation is
   * explicitly a judgement call. Naming a tool here overrode all of it.
   */
  for (const level of effort.CODEX_EFFORTS) {
    const { guidance } = effort.harnessEffort(level);
    if (level === 'ultra') continue; // Delegation *is* what Ultra selects.

    assert.doesNotMatch(guidance, /update_plan/, `${level} must not mandate planning`);
    assert.doesNotMatch(guidance, /computer_use/, `${level} must not mandate verification`);
    assert.doesNotMatch(guidance, /\bPlan before\b/i, `${level} must not order a plan`);
  }

  // And upstream's own judgement rules must still be in the composed prompt.
  const upstream = fs.readFileSync(
    path.join(
      repoRoot,
      'features', 'code-beta', 'src', 'harness', 'upstream',
      'prompt_with_apply_patch_instructions.md',
    ),
    'utf8',
  );
  assert.match(upstream, /Do not use plans for simple or single-step queries/);
});

it('offers computer_use rather than expecting it', () => {
  const overlayModule = fs.readFileSync(
    path.join(repoRoot, 'features', 'code-beta', 'src', 'harness', 'overlay', 'prompt-overlay.ts'),
    'utf8',
  );
  assert.match(overlayModule, /available, not expected/);
  assert.match(overlayModule, /Most turns should not use it/);
  // Finishing a feature is not a reason to spend minutes in a browser.
  assert.match(overlayModule, /not by itself a reason/);
});

it('reaches Ultra through the shared model menu without leaking it elsewhere', () => {
  // Ultra is picked where every other effort is picked — the model menu's
  // thinking-effort submenu — but only Code Beta may offer it, because it is
  // the only surface running the harness that acts on it.
  const scale = fs.readFileSync(
    path.join(repoRoot, 'platform', 'ai', 'src', 'models', 'efforts.ts'),
    'utf8',
  );
  assert.doesNotMatch(scale, /ultra/i, 'Ultra must not leak into the shared effort scale');

  const menu = fs.readFileSync(
    path.join(repoRoot, 'platform', 'ui', 'src', 'models', 'ModelsMenu.tsx'),
    'utf8',
  );
  // The menu carries no knowledge of Ultra; it renders whatever rows a caller
  // hands it, and renders none by default. Comments are stripped first — the
  // prop is *documented* in terms of Ultra, but must not branch on it.
  const menuCode = menu.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
  assert.doesNotMatch(menuCode, /ultra/i, 'the shared menu must not name Ultra itself');
  assert.match(menu, /extraEfforts\?:/, 'the extra rows must be an optional prop');
  assert.match(
    menu,
    /\(extraEfforts \?\? \[\]\)\.map/,
    'an absent prop must render nothing',
  );

  // Every other caller must leave the prop off, so their menus are unchanged.
  for (const caller of [
    ['features', 'code', 'src', 'workbench', 'WorkbenchSidebar.tsx'],
    ['features', 'code', 'src', 'CodeHome.tsx'],
  ]) {
    const file = path.join(repoRoot, ...caller);
    if (!fs.existsSync(file)) continue;
    assert.doesNotMatch(
      fs.readFileSync(file, 'utf8'),
      /extraEfforts/,
      `${caller.join('/')} must not add effort rows`,
    );
  }

  // Both Code Beta composers offer it. Missing it on the landing screen would
  // mean the opening prompt — the one most likely to want delegation — could
  // never run at Ultra.
  for (const surface of [
    ['features', 'code-beta', 'src', 'workbench', 'WorkbenchSidebar.tsx'],
    ['features', 'code-beta', 'src', 'CodeHome.tsx'],
  ]) {
    const source = fs.readFileSync(path.join(repoRoot, ...surface), 'utf8');
    const where = surface[surface.length - 1];
    assert.match(source, /extraEfforts=\{\[/, `${where} must supply the Ultra row`);
    assert.match(source, /setUltraEngaged\(true\)/, `${where} must select Ultra`);
    // Picking a numeric level has to clear Ultra, or both would read as active.
    assert.match(source, /setUltraEngaged\(false\)/, `${where} must clear Ultra on a level`);
    // Ultra is not a numeric level, so the pill has to name it separately or it
    // would keep showing whichever level Ultra was chosen over.
    assert.match(source, /EFFORT_LABEL\.ultra/, `${where} must label the pill Ultra`);
  }

  // One flag behind both, so the choice survives the landing screen handing over
  // to the workbench.
  const store = fs.readFileSync(
    path.join(repoRoot, 'features', 'code-beta', 'src', 'code-beta-store.ts'),
    'utf8',
  );
  assert.match(store, /export const ultraEngaged = atom<boolean>/);
  // Only Ultra is stored. Keeping the numeric levels here too would be a second
  // source of truth that could drift from the model the pill is showing.
  assert.doesNotMatch(
    store.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, ''),
    /atom<CodexEffort>/,
    'the numeric levels belong to the selected model, not this store',
  );
  assert.match(store, /export function effectiveEffort/);

  const sidebar = fs.readFileSync(
    path.join(repoRoot, 'features', 'code-beta', 'src', 'workbench', 'WorkbenchSidebar.tsx'),
    'utf8',
  );
  assert.match(sidebar, /effort: codexEffort/, 'the turn must run at the chosen effort');
});
