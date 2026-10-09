/**
 * The Media agent declares only tools it executes, and nothing leaks into normal chat.
 *
 * WHAT WENT WRONG, TWICE. `platform/ai/src/chat.ts` is shared by every caller that
 * streams a Gemini turn — chat, code, design, spark, visual-edit and the media
 * agent. It used to push a 20-tool media harness (`generate_image`,
 * `generate_video_from_text`, …) into *every* one of those turns, and when a tool
 * came back with no executor the loop fell through to `mockExecuteTool`, whose
 * `generate_image` branch returned a canned success pointing at one Unsplash photo.
 * Normal chat asked for a picture, got a fabricated success, and reported it.
 *
 * Gating the suite on `enableMediaTools` fixed chat but not the Media agent itself:
 * the suite was copied from Google Flow, and the agent ran every call through the
 * same mock. Four video tools dropped a stock "stars in space" clip into the
 * gallery, and a dozen more answered with invented collections, avatars, Street
 * View images and credit balances. The tools now live with their executors in
 * `features/media/src/agent/`, and chat.ts declares none of its own.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { it } from 'node:test';

const repoRoot = join(import.meta.dirname, '..', '..', '..');
const read = (...parts) => readFileSync(join(repoRoot, ...parts), 'utf8');

const chatTs = () => read('platform', 'ai', 'src', 'chat.ts');
const agentTools = () => read('features', 'media', 'src', 'agent', 'agent-tools.ts');
const agentSession = () => read('features', 'media', 'src', 'agent', 'agent-session.ts');

/** Strip line comments so a rule quoted in prose never satisfies an assertion. */
const codeOnly = (source) =>
  source
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

// ── The shared stream client ─────────────────────────────────────────────────

it('keeps the media-turn flag optional, so omitting it means off', () => {
  const source = chatTs();
  assert.match(source, /enableMediaTools\?:\s*boolean/);
  assert.ok(
    !/enableMediaTools:\s*boolean(?!\s*\|)/.test(source),
    'the flag must stay optional so omitting it means off',
  );
});

it('declares no media tools of its own', () => {
  const source = codeOnly(chatTs());
  for (const name of ['generate_image', 'generate_video', 'check_video_generation_status', 'get_geo_grounding_image']) {
    assert.ok(
      !new RegExp(`name:\\s*["']${name}`).test(source),
      `chat.ts must not declare ${name}; the Media agent declares its own tools`,
    );
  }
  assert.ok(!/AGENT HARNESS SYSTEM INSTRUCTIONS/.test(source), 'no harness instruction may be injected into a caller prompt');
});

it('sends the caller system prompt to Gemini verbatim', () => {
  const source = codeOnly(chatTs());
  assert.match(source, /systemInstruction:\s*systemPrompt/);
  assert.ok(!/combinedSystemPrompt/.test(source), 'nothing may rewrite the caller prompt any more');
});

it('has no mock executor left to fall back to', () => {
  assert.ok(!/mockExecuteTool/.test(chatTs()), 'the canned-result executor must stay deleted');
  assert.match(
    codeOnly(chatTs()),
    /is not available in this context/,
    'a tool with no executor must be reported to the model as not having run',
  );
});

// ── The Media agent ──────────────────────────────────────────────────────────

const declaredToolNames = () => {
  const source = codeOnly(agentTools());
  const start = source.indexOf('export function buildMediaAgentToolDeclarations');
  const end = source.indexOf('export function buildMediaAgentSystemPrompt');
  assert.ok(start > 0 && end > start, 'could not find the declaration builder');
  return [...source.slice(start, end).matchAll(/^\s*name:\s*'([a-z_]+)'/gm)].map((m) => m[1]).sort();
};

const executedToolNames = () => {
  const source = codeOnly(agentSession());
  const start = source.indexOf('const executeTool = async');
  assert.ok(start > 0, 'could not find the tool executor');
  const body = source.slice(start, source.indexOf('\n  };', start));
  return [...body.matchAll(/case\s+'([a-z_]+)':/g)].map((m) => m[1]).sort();
};

it('gives every tool the Media agent declares an executor, and declares nothing else', () => {
  const declared = declaredToolNames();
  assert.ok(declared.length >= 4, `expected the agent to declare its tools, found ${declared.join(', ')}`);
  assert.deepEqual(declared, executedToolNames());
  const listed = [...codeOnly(agentTools()).match(/MEDIA_AGENT_TOOL_NAMES[^=]*=\s*\[([^\]]*)\]/)[1].matchAll(/'([a-z_]+)'/g)]
    .map((m) => m[1])
    .sort();
  assert.deepEqual(listed, declared, 'MEDIA_AGENT_TOOL_NAMES must match the declarations');
});

it('opts into the media turn and supplies its own declarations', () => {
  const source = codeOnly(agentSession());
  assert.match(source, /enableMediaTools:\s*true/);
  assert.match(source, /toolDeclarations:\s*buildMediaAgentToolDeclarations\(/);
});

it('ships no canned media for any tool', () => {
  for (const parts of [
    ['features', 'media', 'src', 'agent', 'agent-session.ts'],
    ['features', 'media', 'src', 'agent', 'agent-tools.ts'],
    ['features', 'media', 'src', 'MediaView.tsx'],
  ]) {
    const source = read(...parts);
    assert.ok(!/mixkit\.co|unsplash\.com/.test(source), `${parts.join('/')} must not return stock media as a result`);
  }
});

// ── Who may turn it on ───────────────────────────────────────────────────────

it('leaves every other streamChat caller without the media turn or its tools', () => {
  const callers = [
    ['features', 'chat', 'src', 'chat-turn-runner.ts'],
    ['features', 'code', 'src', 'workbench', 'WorkbenchSidebar.tsx'],
    ['features', 'code', 'src', 'visual-editing', 'engine', 'visual-edit-service.ts'],
    ['features', 'design', 'src', 'DesignChat.tsx'],
    ['features', 'spark', 'src', 'SparkWorkspace.tsx'],
  ];
  for (const parts of callers) {
    const source = read(...parts);
    assert.ok(!/enableMediaTools/.test(source), `${parts.join('/')} must not request the media turn`);
    assert.ok(!/buildMediaAgentToolDeclarations/.test(source), `${parts.join('/')} must not declare the media tools`);
  }
});

it('keeps streamChat out of the agent sidebar, which only renders the session', () => {
  const source = read('features', 'media', 'src', 'AgentSidebar.tsx');
  assert.ok(!/\bstreamChat\b/.test(source), 'turns run in agent-session.ts, not in the sidebar');
});
