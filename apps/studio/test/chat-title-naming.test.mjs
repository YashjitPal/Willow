// Chat naming must not depend on a finished assistant reply.
//
// Reported symptom: stopping the very first response left the chat unnamed and
// the sidebar skeleton shimmering forever. The naming effect gated on
// `firstReplyFinished`, a condition a stopped first turn never satisfies, and
// the sidebar shimmers for exactly as long as the chat keeps its temp id — so
// one unmet condition produced both halves of the bug.
//
// These assert on source text: ChatView pulls in the whole app shell, and the
// test runner's TS loader cannot resolve the workspace aliases from a data: URL
// (see test/ts-module.mjs). Patterns must stay newline-free or use [\s\S] —
// this repo is CRLF, so a literal "\n" in a pattern never matches.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const chatView = read('features/chat/src/ChatView.tsx');
const chatTitle = read('platform/storage/src/local-fs/chat-title.ts');
const localFs = read('platform/storage/src/local-fs/LocalFSContext.tsx');
const workbench = read('features/code/src/workbench/WorkbenchSidebar.tsx');
const sidebar = read('apps/studio/src/shell/sidebar/Sidebar.tsx');

// The naming effect, sliced from its in-flight guard to its dependency array so
// assertions cannot be satisfied by unrelated code elsewhere in the file.
const titleEffect = chatView.slice(
  chatView.indexOf('const titleGenInFlightRef'),
  chatView.indexOf('const [streaming, setStreaming]'),
);

// Comments stripped, for "this code does not do X" assertions only. The effect
// carries a NOTE explaining why it deliberately does NOT call
// setChatSessionId(uniqueTitle), and prose describing a mistake would otherwise
// read as the mistake itself.
const codeOnly = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[^\S\r\n]*\/\/.*$/gm, '');

const titleEffectCode = codeOnly(titleEffect);

test('the naming effect is located', () => {
  assert.ok(titleEffect.length > 0, 'could not locate the title-generation effect');
});

test('naming does not wait for a finished assistant reply', () => {
  // The whole point: a stopped, errored or still-streaming first turn must not
  // block naming. No reference to the first assistant message should survive.
  for (const absent of ['firstReplyFinished', 'firstAssistant', 'assistantMsg']) {
    assert.ok(
      !titleEffectCode.includes(absent),
      `naming still depends on the assistant reply via ${absent}`,
    );
  }
});

test('the gate is the first user prompt existing, nothing more', () => {
  assert.match(titleEffect, /const firstUser = messages\.find\(\(message\) => message\.role === 'user'\)/);
  assert.match(
    titleEffect,
    /isLocalFolderConnected[\s\S]{0,60}&& firstUser[\s\S]{0,60}&& !chatTitle[\s\S]{0,80}&& !titleGenInFlightRef\.current/,
  );
});

test('the naming model is asked with the prompt alone', () => {
  assert.match(titleEffect, /await generateChatTitle\(userMsg\)/);
});

test('the prompt-only fallback still applies when the naming model fails', () => {
  // generateChatTitleWith returns '' rather than throwing, so this branch — not
  // the catch — is what actually names the chat when there is no API key.
  // See naming-fallback.test.mjs for the shared helper this now delegates to.
  assert.match(titleEffect, /if \(!title\) \{/);
  assert.match(titleEffect, /title = deriveFallbackTitle\(userMsg, FALLBACK_CHAT_TITLE\)/);
});

test('an attachment-only first message still yields a name', () => {
  // Sending a file with no text must not fall through to an empty prompt.
  assert.match(titleEffect, /firstUser\.attachments\?\.map\(\(attachment\) => attachment\.name\)\.join\(', '\)/);
  assert.match(titleEffect, /\|\| 'Attached file'/);
});

test('the assistant half is optional the whole way down', () => {
  // WorkbenchSidebar still passes two arguments; widening rather than changing
  // the signature is what keeps those call sites working untouched.
  assert.match(chatTitle, /const buildTitlePrompt = \(userMessage: string, assistantMessage\?: string\)/);
  assert.match(chatTitle, /assistantMessage\?: string,\s*\): Promise<string> =>/);
  assert.match(localFs, /generateChatTitle: \(userMessage: string, assistantMessage\?: string\) => Promise<string>;/);
  assert.match(localFs, /\(userMessage: string, assistantMessage\?: string\): Promise<string> =>/);
});

test('the Code workbench call sites are unaffected', () => {
  const calls = workbench.match(/generateChatTitle\(userMsg, assistantMsg\)/g) ?? [];
  assert.equal(calls.length, 2, 'expected both Code chat naming call sites to keep passing a reply');
});

test('the prompt omits the Assistant line entirely when there is no reply', () => {
  // A dangling "Assistant:" with nothing after it reads to the naming model as
  // a reply that exists and said nothing, which is worse than not mentioning one.
  assert.match(chatTitle, /assistantMessage\?\.trim\(\)[\s\S]{0,120}?`User: \$\{userMessage\}`/);
  assert.doesNotMatch(
    chatTitle,
    /Return ONLY the rephrased name[\s\S]{0,200}?Assistant: \$\{assistantMessage\}/,
  );
});

test('the sidebar skeleton ends exactly when the temp id does', () => {
  // Pins the link between the two halves of the bug: the shimmer is rendered
  // for a temp-id chat, so a chat that never gets named never stops shimmering.
  assert.match(sidebar, /const isTemp = isTempChatId\(chat\);/);
  assert.match(sidebar, /if \(isTemp && activeChatId === chat\) \{/);
  assert.match(sidebar, /return <SidebarSkeleton key=\{chat\} isCollapsed=\{isCollapsed\} \/>;/);
});

test('a chat loaded on a temp id can still be named later', () => {
  // Self-heals chats already stranded unnamed by the old gate: the load path
  // must leave chatTitle null for a temp id, or the `!chatTitle` gate closes
  // permanently and the skeleton shimmers for the rest of the session.
  //
  // Both load branches (disk had messages / disk had nothing) now go through the
  // one commit helper, so there is a single site rather than two — and the
  // empty branch must still route through it, since a chat whose first turn is
  // generating in the background has nothing on disk yet.
  const commits = chatView.match(/setChatTitle\(isTempChatId\(chatId\) \? null : chatId\)/g) ?? [];
  assert.equal(commits.length, 1, 'the load commit must leave a temp id unnamed');
  const branches = chatView.match(/commitLoadedChat\(activeChatId, /g) ?? [];
  assert.equal(branches.length, 2, 'both load branches must go through the commit helper');
});

test('the title save credits the exact array it wrote', () => {
  // Naming now overlaps the first response by design, so the reply routinely
  // finalizes mid-save. Re-reading messagesRef after the await would mark that
  // newer array as saved and the autosave effect would dedup away the write
  // carrying the reply.
  assert.match(titleEffect, /const snapshot = messagesRef\.current;/);
  // `encodeCanvasHistory` wraps this now — canvas revisions are written as reverse
  // patches — but what it wraps still has to be `source`, not a re-read of the ref.
  assert.match(titleEffect, /const latest = (encodeCanvasHistory\()?source[\s\S]{0,80}?\.map\(serializeChatMessage\)/);
  assert.match(titleEffect, /if \(!runningTurn\) lastSavedMessagesRef\.current = snapshot;/);
  assert.ok(
    !titleEffectCode.includes('lastSavedMessagesRef.current = messagesRef.current'),
    'the dedup marker must not be re-read from the live ref after the await',
  );
});

test('the title save prefers the live turn over a frozen messagesRef', () => {
  // Naming has no cancellation, so it outlives unmount — and messagesRef is
  // frozen at whatever the dead component last saw, which for a backgrounded
  // turn is the empty placeholder. hasSavedMessageContent drops that, so the
  // save would be the user message ALONE; landing after the runner's save, it
  // erases the reply.
  assert.match(titleEffect, /const runningTurn = getChatTurnByChatId\(/);
  assert.match(
    titleEffect,
    /runningTurn\?\.status === 'running'[\s\S]{0,120}?runningTurn\.historyBefore, runningTurn\.userMessage/,
  );
});

test('a failed rename releases the in-flight guard so naming retries', () => {
  assert.match(titleEffect, /setChatTitle\(null\);[\s\S]{0,60}?titleGenInFlightRef\.current = false;/);
});

test('naming still never flips chatSessionId mid-rename', () => {
  // Firing earlier makes this guard matter more, not less: it is what keeps the
  // load effect from reloading over a live stream during the temp -> title flip.
  assert.ok(
    !titleEffectCode.includes('setChatSessionId(uniqueTitle)'),
    'flipping chatSessionId here lets the load effect wipe the live thread',
  );
  assert.match(titleEffect, /setChatTitle\(uniqueTitle\);/);
});

test('a forced disk-sync reload cannot land mid-generation', () => {
  // The other half of why naming is safe to start before the reply finishes.
  assert.match(chatView, /if \(isGeneratingRef\.current \|\| isLiveRef\.current\) return;/);
});

test('incognito chats are never named', () => {
  assert.match(titleEffect, /if \(isIncognito\) return;/);
});
