/**
 * The Code Beta harness contract.
 *
 * Three things are pinned here, in rough order of how badly they would hurt if
 * they broke:
 *
 * 1. **The no-shell guarantee.** The composed prompt must not tell the model it
 *    has a terminal, and the tool policy must refuse one. Both halves are
 *    needed; either alone is not enough.
 * 2. **Upstream integrity.** The vendored files must match the manifest, so a
 *    hand-edit to `upstream/` is caught rather than silently shipped.
 * 3. **Isolation.** Code Beta must not import from `features/code`, and the
 *    experiment must default to off.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const featureRoot = path.join(repoRoot, 'features', 'code-beta');
const harnessRoot = path.join(featureRoot, 'src', 'harness');
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

/* ---------------------------------------------------------------------- */
/* Isolation                                                               */
/* ---------------------------------------------------------------------- */

const sourceFiles = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name));

it('never imports from features/code', () => {
  // Code Beta is a Labs experiment. Reaching into the shipped Code tab would
  // mean an experiment could break it, which is the one outcome this feature
  // must not be able to cause.
  for (const file of sourceFiles(path.join(featureRoot, 'src'))) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(
      source,
      /from ['"]@willow\/code\//,
      `${path.relative(repoRoot, file)} imports from features/code`,
    );
  }
});

it('is reachable only behind the Labs flag, which defaults to off', () => {
  const experiments = read(repoRoot, 'platform', 'core', 'src', 'experiments-store.ts');
  assert.match(experiments, /'code-beta': false/);

  const sidebar = read(repoRoot, 'apps', 'studio', 'src', 'shell', 'sidebar', 'Sidebar.tsx');
  assert.match(sidebar, /experiments\['code-beta'\] && \(/);
  assert.match(sidebar, /label="Code Beta"/);

  const labs = read(repoRoot, 'apps', 'studio', 'src', 'settings', 'tabs', 'LabsTab.tsx');
  assert.match(labs, /id="code-beta"/);
});

it('is lazy-loaded so its chunk never ships to users who have not opted in', () => {
  // The whole fork — workbench, harness, vendored prompt — is behind this one
  // dynamic import. A static import would put all of it in the initial bundle
  // for every user, including those who never open Labs.
  const app = read(repoRoot, 'apps', 'studio', 'src', 'app', 'App.tsx');
  assert.match(app, /React\.lazy\(\s*\(\)\s*=>\s*[\s\S]{0,80}import\('@willow\/code-beta\/CodeHome'\)/);
});

it('forked from features/code and records where', () => {
  // Code Beta is a copy of the Code tab, diverging deliberately. FORK.json is
  // what lets `code-beta-fork-status` tell intentional divergence from drift.
  const fork = JSON.parse(read(repoRoot, 'features', 'code-beta', 'FORK.json'));
  assert.equal(fork.forkedFrom, 'features/code/src');
  assert.ok(fork.commit && fork.commit.length >= 40, 'fork point must be a full sha');
  assert.ok(fork.files.length > 30, 'expected the whole Code tree to be recorded');

  // The pieces that make it a real workbench rather than a stub.
  for (const file of [
    'CodeHome.tsx',
    'WorkbenchView.tsx',
    'workbench/WorkbenchSidebar.tsx',
    'workbench/WorkbenchPreview.tsx',
    'visual-editing/VisualEditingOverlay.tsx',
  ]) {
    assert.ok(
      fs.existsSync(path.join(repoRoot, 'features', 'code-beta', 'src', ...file.split('/'))),
      `missing ${file}`,
    );
  }
});

it('runs the Codex harness instead of the legacy generation loop', () => {
  const sidebar = read(
    repoRoot,
    'features',
    'code-beta',
    'src',
    'workbench',
    'WorkbenchSidebar.tsx',
  );

  assert.match(sidebar, /runCodexTurn\(\{/);
  assert.match(sidebar, /LiveTurnActivity/);
  assert.match(sidebar, /SettledTurnActivity/);

  // Code's own harness — the bolt prompt and the whole-file artifact parser —
  // must be gone, or both loops are running. Matched against imports and call
  // sites rather than any mention, so a comment explaining the removal does
  // not trip the assertion.
  assert.doesNotMatch(sidebar, /import .*from '\.\.\/runtime\/sandpack\/system-prompt'/);
  assert.doesNotMatch(sidebar, /\bparseAIResponse\(/);
  assert.doesNotMatch(sidebar, /createMessageParser\(\)/);
});

it('declares its alias in both places, with code-beta ahead of code in Vite', () => {
  const tsconfig = JSON.parse(read(repoRoot, 'tsconfig.base.json'));
  assert.deepEqual(tsconfig.compilerOptions.paths['@willow/code-beta/*'], ['features/code-beta/src/*']);

  // Vite takes the first matching prefix, so the shorter alias would otherwise
  // swallow every code-beta import. Matched against the `find:` entries rather
  // than bare strings, since the comment above them names both aliases too.
  const vite = read(repoRoot, 'apps', 'studio', 'vite.config.ts');
  const betaAt = vite.indexOf('find: "@willow/code-beta"');
  const codeAt = vite.indexOf('find: "@willow/code"');
  assert.ok(betaAt !== -1, 'no Vite alias for @willow/code-beta');
  assert.ok(codeAt !== -1, 'no Vite alias for @willow/code');
  assert.ok(betaAt < codeAt, '@willow/code-beta must precede @willow/code');
});
