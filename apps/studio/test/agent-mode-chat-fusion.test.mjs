/**
 * The media-agent harness must not leak into normal chat.
 *
 * WHAT WENT WRONG. `platform/ai/src/chat.ts` is shared by every caller that
 * streams a Gemini turn — chat, code, design, spark, visual-edit and the media
 * agent. It used to push a 20-tool media harness (`generate_image`,
 * `generate_video_from_text`, …) into *every* one of those turns, prefix each
 * caller's system prompt with an instruction to "call tools whenever the user
 * requests image/video generation", and set `functionCallingConfig.mode: AUTO`.
 *
 * Then, when a tool came back with no executor wired up, the loop silently fell
 * through to `mockExecuteTool`, whose `generate_image` branch returns a canned
 * success payload pointing at one hardcoded Unsplash photo.
 *
 * So asking normal chat for a picture made the model call an image generator it
 * did not have, receive a fabricated success, and report a generation that never
 * happened. Only the media agent passes a real `onToolCall`, so only the media
 * agent may opt in.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { it } from 'node:test';

const repoRoot = join(import.meta.dirname, '..', '..', '..');
const read = (...parts) => readFileSync(join(repoRoot, ...parts), 'utf8');

const chatTs = () => read('platform', 'ai', 'src', 'chat.ts');

/** Strip line comments so a rule quoted in prose never satisfies an assertion. */
const codeOnly = (source) =>
  source
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

// ── The gate itself ──────────────────────────────────────────────────────────

it('declares the media-tool opt-in, defaulting to off', () => {
  const source = chatTs();
  assert.match(
    source,
    /enableMediaTools\?:\s*boolean/,
    'AiOptions must carry an explicit opt-in for the generation harness',
  );
  // Optional, so `undefined` — the value every existing caller passes — is off.
  assert.ok(
    !/enableMediaTools:\s*boolean(?!\s*\|)/.test(source),
    'the flag must stay optional so omitting it means off',
  );
});

it('pushes the harness tools only behind that flag', () => {
  const source = codeOnly(chatTs());
  const gate = source.match(
    /const\s+mediaToolsEnabled\s*=\s*options\.enableMediaTools\s*===\s*true/,
  );
  assert.ok(gate, 'the harness must be gated on an explicit === true');

  // The tool block must be guarded, not pushed unconditionally.
  assert.match(
    source,
    /if\s*\(mediaToolsEnabled\)\s*tools\.push\(\{\s*[\r\n]+\s*functionDeclarations:/,
    'functionDeclarations must sit behind the gate',
  );
  assert.ok(
    !/(?<!if \(mediaToolsEnabled\) )tools\.push\(\{\s*[\r\n]+\s*functionDeclarations/.test(source),
    'no unguarded functionDeclarations push may remain',
  );
});

it('keeps the harness instruction out of an ungated system prompt', () => {
  const source = codeOnly(chatTs());
  // With the gate off, the caller's own prompt must pass through untouched —
  // the harness used to override each caller's style rules wholesale.
  assert.match(
    source,
    /const\s+combinedSystemPrompt\s*=\s*mediaToolsEnabled/,
    'the harness instruction must be conditional on the gate',
  );
  assert.match(
    source,
    /:\s*systemPrompt;/,
    'with the gate off, the caller system prompt is used verbatim',
  );
});

// ── The silent fallback that fabricated the result ───────────────────────────

it('never falls back to the mock executor inside the stream loop', () => {
  const source = codeOnly(chatTs());
  // `mockExecuteTool` may still be *exported* — MediaView passes it in on
  // purpose — but the loop must not reach for it on its own.
  assert.ok(
    !/toolResult\s*=\s*mockExecuteTool\(/.test(source),
    'a missing executor must surface as an error, not as a fabricated success',
  );
  assert.match(
    source,
    /is not available in this context/,
    'the no-executor branch must tell the model the tool did not run',
  );
});

it('still exports the mock for the one caller that opts in', () => {
  assert.match(chatTs(), /export const mockExecuteTool/);
});

// ── Who may turn it on ───────────────────────────────────────────────────────

it('enables media tools in the media agent, which has a real executor', () => {
  const source = read('features', 'media', 'src', 'MediaView.tsx');
  assert.match(source, /enableMediaTools:\s*true/, 'the media agent opts in');
  // And it is the opt-in that pairs with a real onToolCall.
  assert.match(source, /mockExecuteTool\(name,\s*args\)/);
});

it('leaves every other streamChat caller without the harness', () => {
  const callers = [
    ['features', 'chat', 'src', 'chat-turn-runner.ts'],
    ['features', 'code', 'src', 'workbench', 'WorkbenchSidebar.tsx'],
    ['features', 'code', 'src', 'visual-editing', 'engine', 'visual-edit-service.ts'],
    ['features', 'design', 'src', 'DesignChat.tsx'],
    ['features', 'spark', 'src', 'SparkWorkspace.tsx'],
  ];
  for (const parts of callers) {
    const source = read(...parts);
    assert.ok(
      !/enableMediaTools/.test(source),
      `${parts.join('/')} must not request the generation harness`,
    );
  }
});

it('drops the dead streamChat import the fusion left in the agent sidebar', () => {
  const source = read('features', 'media', 'src', 'AgentSidebar.tsx');
  assert.ok(
    !/\bstreamChat\b/.test(source),
    'AgentSidebar imported streamChat but never called it',
  );
});
