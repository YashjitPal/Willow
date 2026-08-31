/**
 * The Agent tool's harness contract.
 *
 * Three things are pinned here, in rough order of how badly they would hurt if
 * they broke:
 *
 * 1. **The no-shell guarantee.** The composed prompt must not tell the model it
 *    has a terminal, and the tool policy must refuse one. Both halves are
 *    needed; either alone is not enough.
 * 2. **Upstream integrity.** The vendored files must match the manifest, so a
 *    hand-edit to `upstream/` is caught rather than silently shipped.
 * 3. **Containment.** The harness must run only when the Agent tool is selected,
 *    and the legacy generation loop must survive intact underneath it.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const agentRoot = path.join(repoRoot, 'features', 'code', 'src', 'agent');
const harnessRoot = path.join(agentRoot, 'harness');
const upstreamRoot = path.join(harnessRoot, 'upstream');

const read = (...segments) => fs.readFileSync(path.join(...segments), 'utf8');

const overlay = await importTs(path.join(harnessRoot, 'overlay', 'prompt-overlay.ts'));
const policy = await importTs(path.join(harnessRoot, 'overlay', 'tool-policy.ts'));

const manifest = JSON.parse(read(upstreamRoot, 'MANIFEST.json'));
const upstreamPrompt = read(upstreamRoot, 'prompt_with_apply_patch_instructions.md');
const applyPatchInstructions = read(upstreamRoot, 'apply_patch_tool_instructions.md');

const compose = () =>
  overlay.composePrompt(upstreamPrompt, overlay.buildOverlay({ applyPatchInstructions }));

/* ---------------------------------------------------------------------- */
/* Upstream integrity                                                      */
/* ---------------------------------------------------------------------- */

it('vendored upstream files match the manifest checksums', () => {
  // `upstream/` is byte-for-byte openai/codex. Anything Willow changes belongs
  // in `overlay/`, so a drifting checksum means someone edited the wrong file.
  for (const file of manifest.files) {
    const target = path.join(upstreamRoot, file.local);
    assert.ok(fs.existsSync(target), `missing vendored file ${file.local}`);
    const actual = createHash('sha256').update(fs.readFileSync(target)).digest('hex');
    assert.equal(actual, file.sha256, `${file.local} does not match MANIFEST.json`);
  }
});

it('records provenance required by the upstream licence', () => {
  assert.equal(manifest.license, 'Apache-2.0');
  assert.match(manifest.repository, /github\.com\/openai\/codex/);
  assert.ok(manifest.commit.length >= 40, 'the pin must be a full commit sha');
  assert.ok(fs.existsSync(path.join(upstreamRoot, 'LICENSE')));
  assert.ok(fs.existsSync(path.join(upstreamRoot, 'NOTICE')));
});

/* ---------------------------------------------------------------------- */
/* The no-shell guarantee                                                  */
/* ---------------------------------------------------------------------- */

it('composes a prompt that denies a shell rather than describing one', () => {
  const { prompt } = compose();

  assert.match(prompt, /do not have shell access/i);
  assert.match(prompt, /Never claim to have run anything/i);

  // Upstream's own opening claims the ability to run terminal commands. If this
  // survives composition the overlay has stopped applying.
  assert.doesNotMatch(prompt, /Emit function calls to run terminal commands/);
  assert.doesNotMatch(prompt, /prefer using `rg`/);
});

it('keeps the behavioural middle of the upstream prompt', () => {
  // Upstream puts `# AGENTS.md spec` at level 1, so everything after it —
  // Planning, Task execution, Validating your work — parses as nested under it.
  // Dropping that section with descendants silently removed most of the agent's
  // behaviour while still producing a plausible-looking prompt.
  const { prompt } = compose();

  for (const heading of [
    '## Planning',
    '## Task execution',
    '## Validating your work',
    '## Presenting your work and final message',
    '### Preamble messages',
  ]) {
    assert.ok(prompt.includes(heading), `composed prompt lost ${heading}`);
  }

  // The section actually targeted is gone.
  assert.doesNotMatch(prompt, /# AGENTS\.md spec/);
  assert.doesNotMatch(prompt, /scope of an AGENTS\.md file/);
});

it('keeps upstream apply_patch grammar while replacing its shell invocation', () => {
  const { prompt } = compose();

  // The grammar still comes from the vendored file, so an upstream change flows
  // through without anyone editing the overlay.
  assert.match(prompt, /\*\*\* Begin Patch/);
  assert.match(prompt, /\*\*\* Add File: <path>/);
  assert.match(prompt, /AddFile := /);

  // But the invocation must not be the shell form.
  assert.doesNotMatch(prompt, /shell \{"command":\["apply_patch"/);
  assert.match(prompt, /\*\*\* Call: read_file/);
});

it('states the browser sandbox constraints the runtime actually enforces', () => {
  const { prompt } = compose();
  assert.match(prompt, /Willow sandbox runtime/);
  assert.match(prompt, /entry point is `\/App\.tsx`/);
  assert.match(prompt, /Never use `src\/`/);
  assert.match(prompt, /package\.json/);
});

it('rules out languages the preview cannot run', () => {
  // The preview bundles a React app and nothing else, so a file in another
  // language is something the user has no way to execute.
  const { prompt } = compose();
  assert.match(prompt, /Write the app in this stack only/);
  assert.match(prompt, /Python/);
  assert.match(prompt, /no server/i);
});

it('adds only the two constraints the environment imposes', () => {
  // The overlay exists to describe *this* runtime — no shell, and only what the
  // preview can run. Opinions about how a UI should look are not constraints,
  // and every one of them is a way for the harness to drift from upstream Codex
  // for reasons the environment does not justify.
  const { prompt } = compose();
  for (const opinion of [
    /Build the whole screen/,
    /Make it look deliberate/,
    /restrained palette/,
    /Cover the states/,
    /Keep it accessible/,
  ]) {
    assert.doesNotMatch(prompt, opinion, 'design guidance does not belong in the overlay');
  }
});

it('refuses every spelling of a shell tool with actionable guidance', () => {
  // `run_command` is deliberately NOT in this list: it is a real, allow-listed
  // tool that refuses anything outside its own small set, with a message
  // naming what the agent should have used instead.
  for (const name of ['shell', 'bash', 'exec', 'terminal', 'local_shell']) {
    const refusal = policy.refusalFor(name);
    assert.ok(refusal, `${name} should be explicitly refused`);
    // A bare "unknown tool" leaves the model stuck; naming the alternative is
    // what lets it recover inside the same turn.
    assert.match(refusal, /apply_patch/);
  }

  assert.match(policy.refusalFor('npm install') ?? policy.refusalFor('npm_install'), /package\.json/);
  assert.equal(policy.refusalFor('read_file'), null, 'allowed tools must not be refused');
  assert.equal(policy.refusalFor('run_command'), null, 'run_command is a real tool');
});

it('allows exactly the tools the runtime implements', () => {
  assert.deepEqual(
    [...policy.ALLOWED_TOOLS].sort(),
    [
      'add_dependency',
      'apply_patch',
      'computer_use',
      'list_files',
      'read_file',
      'run_command',
      'search_files',
      'task',
      'update_plan',
    ],
  );
  for (const tool of policy.ALLOWED_TOOLS) {
    assert.equal(policy.isAllowed(tool), true);
  }
  assert.equal(policy.isAllowed('shell'), false);
});

it('describes computer_use as checking the app the agent just built', () => {
  const { prompt } = compose();
  assert.match(prompt, /computer_use/);
  assert.match(prompt, /drives the live preview/i);
  // The point of it: the agent cannot run tests, but it can look.
  assert.match(prompt, /You cannot run tests, but you \*can\* look/);
});

/* ---------------------------------------------------------------------- */
/* Overlay failure mode                                                    */
/* ---------------------------------------------------------------------- */

it('throws rather than degrading when a required anchor disappears upstream', () => {
  // This is the intended behaviour after an upstream reorganisation: without
  // the shell-section replacement the prompt would quietly re-enable shell
  // instructions, which is far worse than a loud startup failure.
  const withoutShellSection = upstreamPrompt.replace('## Shell commands', '## Running things');

  assert.throws(
    () => overlay.composePrompt(withoutShellSection, overlay.buildOverlay({ applyPatchInstructions })),
    (error) => {
      assert.equal(error.name, 'OverlayAnchorError');
      assert.ok(error.missing.includes('Shell commands'));
      assert.match(error.message, /prompt-overlay\.ts/);
      return true;
    },
  );
});

it('tolerates an optional anchor going missing', () => {
  const withoutAgentsSpec = upstreamPrompt.replace('# AGENTS.md spec', '# Something else');
  const result = overlay.composePrompt(
    withoutAgentsSpec,
    overlay.buildOverlay({ applyPatchInstructions }),
  );
  assert.ok(result.skipped.includes('AGENTS.md spec'));
  assert.ok(result.prompt.length > 0);
});

it('reports every applied operation for the harness panel', () => {
  const { applied } = compose();
  assert.ok(applied.some((entry) => entry.startsWith('replace (preamble)')));
  assert.ok(applied.some((entry) => entry.includes('Shell commands')));
  assert.ok(applied.some((entry) => entry.startsWith('append')));
});

it('raises hasUserCode when it writes, or the preview never appears', () => {
  // The harness cannot go through `setFile` — it has to replace the whole map
  // so deletions are expressible — so it has to reproduce `setFile`'s side
  // effects itself. Missing `hasUserCode` is invisible in the transcript and
  // total in the UI: no bundle, no iframe, the empty state still showing, and
  // the workspace never leaving chat mode.
  //
  // Checked as source rather than by calling it, because importing the bridge
  // drags in the computer-use client and the `@models` alias, neither of which
  // resolves outside Vite.
  const bridge = read(agentRoot, 'harness-bridge.ts');
  const body = bridge.slice(bridge.indexOf('export function writeWorkbenchFiles'));

  assert.match(body, /workbench\.hasUserCode\.set\(true\)/, 'the preview is gated on this');
  assert.match(body, /workbench\.activeSnapshotId\.set\(null\)/);

  // And the store it is handed must really expose them.
  const store = read(repoRoot, 'features', 'code', 'src', 'runtime', 'sandpack', 'sandpack-store.ts');
  assert.match(store, /hasUserCode = atom<boolean>/);
  assert.match(store, /activeSnapshotId = atom<string \| null>/);
});

it('asks the provider for no tools of its own', () => {
  /*
   * The harness's tools are a text protocol the provider never sees, and it
   * runs them itself. Leaving provider-native tools on meant the model would
   * reach for one — search, on Gemini — and the provider loop would want a
   * second round to feed the result back.
   *
   * That round was fatal, because the iteration cap was pinned at 1 to stop
   * provider-side looping. A turn that had just finished planning died with
   * "AI tool loop exceeded the 1-iteration safety limit." The cap was the wrong
   * instrument: the harness enforces its own budget, and reports exhausting it
   * as a sentence rather than throwing.
   */
  const binding = read(agentRoot, 'model-binding.ts');
  assert.match(binding, /toolPolicy: 'disabled'/);
  assert.match(binding, /enableSearch: false/);
  assert.doesNotMatch(binding, /maxToolIterations: 1\b/, 'a cap of 1 makes any second round fatal');

  // `disabled` has to still mean that upstream.
  const chat = read(repoRoot, 'platform', 'ai', 'src', 'chat.ts');
  assert.match(chat, /toolPolicy !== 'disabled'/);
});

/* ---------------------------------------------------------------------- */
/* Containment                                                             */
/* ---------------------------------------------------------------------- */

it('is a tool in the Code tab, offered on both composers', () => {
  // The harness is reached by selecting "Agent" in the Tools menu — nothing
  // else. It must be offered in both composers: the landing screen is where the
  // first prompt is usually typed, so an entry only in the workbench would mean
  // the opening turn could never run on the harness.
  for (const surface of [
    ['features', 'code', 'src', 'workbench', 'WorkbenchSidebar.tsx'],
    ['features', 'code', 'src', 'CodeHome.tsx'],
  ]) {
    const source = read(repoRoot, ...surface);
    const where = surface[surface.length - 1];
    assert.match(
      source,
      /\{ id: 'agent', label: 'Agent', icon: AgentIcon \}/,
      `${where} must offer the Agent tool`,
    );
    // The pick is mirrored into the shared store, which is what carries it
    // across the landing-to-workbench handover.
    assert.match(source, /setAgentEngaged\(/, `${where} must mirror the pick into the store`);
  }

  // The store defaults to off, so a profile that has never touched the Tools
  // menu gets the legacy loop.
  const store = read(repoRoot, 'features', 'code', 'src', 'agent', 'agent-store.ts');
  assert.match(store, /export const agentEngaged = atom<boolean>\(readStoredFlag\(AGENT_KEY\)\)/);
  assert.match(store, /return false;/, 'blocked storage must fall back to off');
});

it('runs the harness only when the Agent tool is engaged', () => {
  const sidebar = read(
    repoRoot,
    'features',
    'code',
    'src',
    'workbench',
    'WorkbenchSidebar.tsx',
  );

  // The harness exists...
  assert.match(sidebar, /runCodexTurn\(\{/);
  assert.match(sidebar, /LiveTurnActivity/);
  assert.match(sidebar, /SettledTurnActivity/);

  // ...but only behind the tool. This is the whole safety property: the branch
  // that reaches `startCodexGeneration` must be guarded by `isAgent`, and
  // `isAgent` must come from the store rather than a local default.
  assert.match(
    sidebar,
    /\} else if \(isAgent\) \{[\s\S]{0,600}?await startCodexGeneration\(/,
    'the harness branch must be guarded by isAgent',
  );
  assert.match(sidebar, /const isAgent = useStore\(agentEngaged\)/);

  // The composer affordances that only mean something to the harness are gated
  // on the same flag, so an unselected Tools menu leaves the composer untouched.
  assert.match(sidebar, /isAgent \? matchSlashCommands\(promptValue\) : EMPTY_SLASH_MATCHES/);
  assert.match(sidebar, /extraEfforts=\{isAgent \? \[/);
});

it('routes the opening turn through the tool as well as later ones', () => {
  /*
   * The landing composer's prompt is handed to the workbench and fired from an
   * effect, not through `handleSendMessage` — so the routing there does not
   * cover it. This is the regression worth pinning: the Agent tool reads as
   * selected, and the first prompt, the one that actually builds the project,
   * quietly runs the legacy loop instead. Nothing on screen says so, which is
   * why it survived a full test run and a typecheck.
   */
  const sidebar = read(
    repoRoot,
    'features',
    'code',
    'src',
    'workbench',
    'WorkbenchSidebar.tsx',
  );

  const initial = sidebar.slice(
    sidebar.indexOf('const fireInitialGeneration'),
    sidebar.indexOf('fireInitialGeneration();'),
  );
  assert.ok(initial.length > 0, 'could not find the initial-generation effect');
  assert.match(
    initial,
    /if \(agentEngaged\.get\(\)\)[\s\S]{0,200}?startCodexGeneration\(/,
    'the opening turn must take the harness when the tool is on',
  );
  assert.match(
    initial,
    /\} else \{[\s\S]{0,200}?startAiGeneration\(/,
    'and the legacy loop when it is off',
  );

  // Read from the store, not the `isAgent` render value: this fires from an
  // effect whose deps do not include it, so a closure read could be a render
  // behind and silently pick the wrong path.
  assert.doesNotMatch(
    initial,
    /if \(isAgent\)/,
    'the initial path must read the store, not a possibly-stale render value',
  );
});

it('leaves the legacy generation loop intact and reachable', () => {
  // The point of making this a tool rather than a replacement: with Agent off,
  // the Code tab must behave exactly as it did. So the legacy loop and the two
  // tools the fork had deleted all have to still be here.
  const sidebar = read(
    repoRoot,
    'features',
    'code',
    'src',
    'workbench',
    'WorkbenchSidebar.tsx',
  );

  assert.match(sidebar, /const startAiGeneration = async \(/, 'the legacy loop must survive');
  assert.match(sidebar, /import \{ BOLT_SYSTEM_PROMPT \} from '\.\.\/runtime\/sandpack\/system-prompt'/);
  assert.match(sidebar, /parseAIResponse/, 'the artifact parser must survive');
  assert.match(sidebar, /createMessageParser\(\)/, 'the streaming parser must survive');
  assert.match(sidebar, /const startTestGeneration = async \(/, 'the Test tool must survive');

  // Plan and Test were dropped by the fork as redundant with the harness. They
  // are back, because they are what the tab does when Agent is off.
  assert.match(sidebar, /\{ id: 'plan', label: 'Plan', icon: FileText \}/);
  assert.match(sidebar, /\{ id: 'test', label: 'Test', icon: FlaskConical \}/);

  // The legacy branch is the fallback, i.e. the last arm with no condition.
  assert.match(
    sidebar,
    /\} else \{[\s\S]{0,400}?await startAiGeneration\(text, history, true,/,
    'the legacy loop must be the unconditional fallback',
  );
});

it('leaves no trace of the Code Beta fork it came from', () => {
  // The fork is gone: its feature folder, its Labs experiment, its alias and its
  // fork-drift script. A leftover is a second copy of the Code tab that nothing
  // renders but everything still has to be kept building.
  for (const gone of [
    ['features', 'code-beta'],
    ['tools', 'scripts', 'code-beta-fork-status.mjs'],
  ]) {
    assert.ok(
      !fs.existsSync(path.join(repoRoot, ...gone)),
      `${gone.join('/')} should have been removed`,
    );
  }

  const experiments = read(repoRoot, 'platform', 'core', 'src', 'experiments-store.ts');
  assert.doesNotMatch(experiments, /code-beta/);

  const tsconfig = JSON.parse(read(repoRoot, 'tsconfig.base.json'));
  assert.equal(tsconfig.compilerOptions.paths['@willow/code-beta/*'], undefined);

  const vite = read(repoRoot, 'apps', 'studio', 'vite.config.ts');
  assert.doesNotMatch(vite, /@willow\/code-beta/);

  const app = read(repoRoot, 'apps', 'studio', 'src', 'app', 'App.tsx');
  assert.doesNotMatch(app, /CodeBetaWorkspace|code-beta/);
});
