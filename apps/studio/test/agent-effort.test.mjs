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
  path.join(repoRoot, 'features', 'code', 'src', 'agent', 'harness', 'overlay', 'effort.ts'),
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
  assert.equal(onFrontier.harness.multiAgentMode.kind, 'proactive');
  assert.equal(onGeminiPro.harness.multiAgentMode.kind, 'proactive');
});

it('lowers ultra to max wherever max is a real token, as client.rs does', () => {
  /*
   * Upstream is unconditional:
   *
   *     ReasoningEffortConfig::Ultra => ReasoningEffortConfig::Max
   *
   * It can be, because it talks to one backend. Willow talks to six and
   * `chat.ts` forwards `reasoningEffort` verbatim to Gemini as
   * `thinking_level`, where `max` is not a valid value — so the lowering
   * targets the model's real ceiling instead. Everywhere `max` exists, the two
   * agree exactly.
   */
  for (const model of [
    { providerId: 'openai', modelId: 'gpt-5.5-codex' },
    { providerId: 'anthropic', modelId: 'claude-opus-5' },
  ]) {
    assert.equal(
      resolveEffort('ultra', model).effective,
      'max',
      `${model.modelId} should match upstream's Ultra -> Max exactly`,
    );
  }
});

it('never offers Gemini an effort its thinking_level vocabulary rejects', () => {
  /*
   * `chat.ts` passes `options.reasoningEffort` straight through:
   *
   *     geminiThinkingLevel = options.reasoningEffort.trim();
   *
   * So an effort name that is not in Gemini's vocabulary is not a silent
   * downgrade — it is an invalid enum value and the request fails. Gemini's
   * scale is minimal/low/medium/high, and `chat.ts`'s own numeric table agrees
   * (`flashMap = { 0: 'minimal', … }`), so `none` must never be offered.
   */
  for (const model of [
    { providerId: 'gemini', modelId: 'gemini-3-pro' },
    { providerId: 'gemini', modelId: 'gemini-3-flash' },
  ]) {
    const allowed = new Set(['minimal', 'low', 'medium', 'high']);
    for (const level of supportedEfforts(model)) {
      assert.ok(
        allowed.has(level),
        `${model.modelId} must not be sent ${level}; Gemini has no such thinking_level`,
      );
    }
    // And resolution never produces one either, at any request.
    for (const requested of CODEX_EFFORTS) {
      assert.ok(
        allowed.has(resolveEffort(requested, model).effective),
        `${requested} on ${model.modelId} resolved outside Gemini's vocabulary`,
      );
    }
  }
});

it('still clamps ordinary levels, which is a real loss', () => {
  // xhigh *is* a wire value, and Gemini Pro does not take it.
  const resolved = resolveEffort('xhigh', { providerId: 'gemini', modelId: 'gemini-3-pro' });
  assert.equal(resolved.effective, 'high');
  assert.equal(resolved.clamped, true);
  assert.equal(resolved.level, effortToLevel('high'));
});

it('makes proactive delegation exclusive to ultra', () => {
  // `session/multi_agents.rs`:
  //   Some(ReasoningEffort::Ultra) => MultiAgentMode::Proactive,
  //   _ => MultiAgentMode::ExplicitRequestOnly,
  for (const level of CODEX_EFFORTS) {
    const expected = level === 'ultra' ? 'proactive' : 'explicit-request-only';
    assert.equal(
      harnessEffort(level).multiAgentMode.kind,
      expected,
      `${level} should be ${expected}`,
    );
  }
});

it("uses upstream's own multi-agent mode wording, not a local paraphrase", async () => {
  /*
   * These two strings are `PROACTIVE_MULTI_AGENT_MODE_TEXT` and
   * `EXPLICIT_REQUEST_ONLY_MULTI_AGENT_MODE_TEXT` from
   * `codex-rs/core/src/context/multi_agent_mode_instructions.rs`.
   *
   * The "no longer applies" clause in each is the part worth pinning. Upstream
   * re-sends this fragment whenever the mode changes, so each text has to
   * revoke the other — rewriting them into something that reads better
   * standalone is what would break switching modes mid-session.
   */
  const multiAgent = await importTs(
    path.join(
      repoRoot, 'features', 'code', 'src', 'agent', 'harness', 'overlay', 'multi-agent-mode.ts',
    ),
  );

  assert.equal(
    multiAgent.PROACTIVE_TEXT,
    'Proactive multi-agent delegation is active. Any earlier instruction requiring an ' +
      'explicit user request before spawning sub-agents no longer applies. Use sub-agents ' +
      'when parallel work would materially improve speed or quality. This mode remains ' +
      'active until a later multi-agent mode developer message changes it.',
  );
  assert.equal(
    multiAgent.EXPLICIT_REQUEST_ONLY_TEXT,
    'Any earlier instruction enabling proactive multi-agent delegation no longer applies. ' +
      'Do not spawn sub-agents unless the user or applicable AGENTS.md/skill instructions ' +
      'explicitly ask for sub-agents, delegation, or parallel agent work.',
  );

  // Delivered in upstream's tags, so the mode document's claim that the mode
  // changes only on a later such message is true.
  const proactive = multiAgent.multiAgentModeSection(multiAgent.PROACTIVE);
  assert.ok(proactive.startsWith('<multi_agent_mode>'));
  assert.ok(proactive.trimEnd().endsWith('</multi_agent_mode>'));

  // An empty custom hint means "send no fragment", not "send the default one".
  assert.equal(multiAgent.multiAgentModeSection({ kind: 'custom', hintText: '' }), '');
});

it('defers delegation eagerness to the multi_agent_mode message', () => {
  const overlay = fs.readFileSync(
    path.join(repoRoot, 'features', 'code', 'src', 'agent', 'harness', 'overlay', 'prompt-overlay.ts'),
    'utf8',
  );
  // The prompt used to describe the two modes itself, which duplicated — and
  // could contradict — the fragment that actually sets them.
  assert.match(overlay, /multi_agent_mode/);
  assert.match(overlay, /authoritative and supersede/i);
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
    path.join(repoRoot, 'features', 'code', 'src', 'agent', 'model-binding.ts'),
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
   * half — the loop bound and the multi-agent mode — is derived from what was
   * *requested* and works on any model. That split is what lets Ultra mean the
   * same thing everywhere even though its wire value differs per model.
   */
  const onGeminiPro = resolveEffort('ultra', { providerId: 'gemini', modelId: 'gemini-3-pro' });

  assert.equal(onGeminiPro.effective, 'high', "wire value is the model's ceiling");
  assert.equal(onGeminiPro.harness.maxIterations, harnessEffort('ultra').maxIterations);
  assert.equal(onGeminiPro.harness.multiAgentMode.kind, 'proactive');
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
    path.join(repoRoot, 'features', 'code', 'src', 'agent', 'harness', 'runtime', 'agent.ts'),
    'utf8',
  );
  assert.match(agent, /harness\?\.maxIterations/);
  assert.match(agent, /iteration < budget/);
});

it('derives nothing from effort but the loop bound and the multi-agent mode', () => {
  /*
   * Upstream derives exactly one prompt-visible thing from reasoning effort:
   * the `<multi_agent_mode>` fragment. It never tells the model its effort and
   * has no per-rung guidance text.
   *
   * This harness used to invent both — an `<effort>` line, a `<delegation>`
   * line, and a `<how-to-work>` block from a table in `effort.ts`. That was not
   * harmless: the guidance named tools ("verify the result with computer_use",
   * "plan before acting"), which made both unconditional at the higher rungs
   * and overrode upstream's own rules for when to plan and when to validate —
   * rules that say outright not to plan single-step work. Raising effort
   * therefore changed behaviour the user had not asked for.
   */
  for (const level of CODEX_EFFORTS) {
    assert.deepEqual(
      Object.keys(harnessEffort(level)).sort(),
      ['maxConcurrentAgents', 'maxIterations', 'multiAgentMode'],
      `${level} must derive nothing else from effort`,
    );
  }

  const agent = fs.readFileSync(
    path.join(repoRoot, 'features', 'code', 'src', 'agent', 'harness', 'runtime', 'agent.ts'),
    'utf8',
  );
  const code = agent.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
  assert.doesNotMatch(code, /<how-to-work>/, 'invented guidance must not return');
  assert.doesNotMatch(code, /<delegation>/, 'delegation is a multi_agent_mode fragment now');
  assert.doesNotMatch(code, /effortSection/, 'the effort section is gone');

  // And upstream's own judgement rules must still be in the composed prompt,
  // since they are what now governs planning and validation.
  const upstream = fs.readFileSync(
    path.join(
      repoRoot,
      'features', 'code', 'src', 'agent', 'harness', 'upstream',
      'prompt_with_apply_patch_instructions.md',
    ),
    'utf8',
  );
  assert.match(upstream, /Do not use plans for simple or single-step queries/);
});

it("uses upstream's one concurrency limit, unscaled by effort", () => {
  /*
   * `DEFAULT_MULTI_AGENT_V2_MAX_CONCURRENT_THREADS_PER_SESSION` is 4, and it is
   * a single session config value — effort does not touch it. Ultra changes the
   * *mode*, not the ceiling.
   *
   * This used to scale from 1 at `none` to 4 at `ultra`, which was invented and
   * made low effort quietly worse at a job the user had explicitly delegated.
   */
  for (const level of CODEX_EFFORTS) {
    assert.equal(
      harnessEffort(level).maxConcurrentAgents,
      4,
      `${level} must use upstream's single limit`,
    );
  }

  // And the limit has to be enforced by the runtime, not merely reported.
  const collaboration = fs.readFileSync(
    path.join(
      repoRoot, 'features', 'code', 'src', 'agent', 'harness', 'runtime', 'collaboration.ts',
    ),
    'utf8',
  );
  assert.match(collaboration, /running >= this\.maxConcurrent/);
  assert.match(collaboration, /DEFAULT_MAX_CONCURRENT_AGENTS/);
});

it('offers computer_use rather than expecting it', () => {
  const overlayModule = fs.readFileSync(
    path.join(repoRoot, 'features', 'code', 'src', 'agent', 'harness', 'overlay', 'prompt-overlay.ts'),
    'utf8',
  );
  assert.match(overlayModule, /available, not expected/);
  assert.match(overlayModule, /Most turns should not use it/);
  // Finishing a feature is not a reason to spend minutes in a browser.
  assert.match(overlayModule, /not by itself a reason/);
});

it('reaches Ultra through the shared model menu without leaking it elsewhere', () => {
  // Ultra is picked where every other effort is picked — the model menu's
  // thinking-effort submenu — but only the Agent tool may offer it, because it
  // is the only thing running the harness that acts on it.
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

  // The composers that merely forward the prop must never construct an Ultra
  // row themselves. They are generic — Chat and Design hand `extraEfforts`
  // straight through from whatever hosts them — so the leak to guard against is
  // one of them authoring Ultra, not one of them accepting the prop.
  //
  // Comments are stripped first, as above: both document the prop in terms of
  // Ultra, which is fine. Branching on it is not.
  for (const caller of [
    ['features', 'chat', 'src', 'composer', 'Composer.tsx'],
    ['features', 'design', 'src', 'composer', 'Composer.tsx'],
  ]) {
    const file = path.join(repoRoot, ...caller);
    if (!fs.existsSync(file)) continue;
    const code = fs
      .readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*/g, '');
    assert.doesNotMatch(
      code,
      /ultra/i,
      `${caller.join('/')} must forward effort rows, not author them`,
    );
  }

  // Both Code composers offer it. Missing it on the landing screen would mean
  // the opening prompt — the one most likely to want delegation — could never
  // run at Ultra.
  for (const surface of [
    ['features', 'code', 'src', 'workbench', 'WorkbenchSidebar.tsx'],
    ['features', 'code', 'src', 'CodeHome.tsx'],
  ]) {
    const source = fs.readFileSync(path.join(repoRoot, ...surface), 'utf8');
    const where = surface[surface.length - 1];
    assert.match(source, /extraEfforts=\{isAgent \? \[/, `${where} must supply the Ultra row`);
    assert.match(source, /setUltraEngaged\(true\)/, `${where} must select Ultra`);
    // Picking a numeric level has to clear Ultra, or both would read as active.
    assert.match(source, /setUltraEngaged\(false\)/, `${where} must clear Ultra on a level`);
    // Ultra is not a numeric level, so the pill has to name it separately or it
    // would keep showing whichever level Ultra was chosen over.
    assert.match(source, /EFFORT_LABEL\.ultra/, `${where} must label the pill Ultra`);
    // ...and the whole row is gated on the Agent tool, so the legacy loop's
    // model menu is exactly what it always was.
    assert.match(
      source,
      /useStore\(ultraEngaged\) && isAgent/,
      `${where} must gate Ultra on the Agent tool`,
    );
  }

  // One flag behind both, so the choice survives the landing screen handing over
  // to the workbench.
  const store = fs.readFileSync(
    path.join(repoRoot, 'features', 'code', 'src', 'agent', 'agent-store.ts'),
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
    path.join(repoRoot, 'features', 'code', 'src', 'workbench', 'WorkbenchSidebar.tsx'),
    'utf8',
  );
  assert.match(sidebar, /effort: codexEffort/, 'the turn must run at the chosen effort');
});
