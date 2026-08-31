// Every surface that asks a model to name something must still produce a name
// when that call fails.
//
// Reported symptom: a quota error from the naming model left Code chats on
// their session id with the sidebar skeleton shimmering, and Code sessions
// called "New Chat" forever. Chat's own effect already had a prompt fallback;
// the four Workbench sites had none, and the two project sites jumped straight
// to "New Project" without trying the prompt.
//
// The behaviour tests below run the shared helper for real. The source
// assertions exist because the call sites cannot be executed here — they sit
// inside 4000-line components — and a fallback that is silently deleted looks
// exactly like one that was never there.
//
// Patterns must stay newline-free or use [\s\S]: WorkbenchSidebar.tsx is CRLF
// while CodeHome.tsx and WorkbenchView.tsx are LF, so a literal "\n" matches
// only some of them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importTs } from './ts-module.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const { deriveFallbackTitle, FALLBACK_CHAT_TITLE, FALLBACK_TITLE_MAX_CHARS } =
  await importTs(join(root, 'platform', 'core', 'src', 'fallback-title.ts'));

const CHAT = FALLBACK_CHAT_TITLE;

test('a short prompt becomes the title verbatim', () => {
  assert.equal(deriveFallbackTitle('Add a dark mode toggle', CHAT), 'Add a dark mode toggle');
});

test('a prompt longer than the cap falls through to the last resort', () => {
  const atCap = 'a'.repeat(FALLBACK_TITLE_MAX_CHARS);
  assert.equal(deriveFallbackTitle(atCap, CHAT), atCap);
  assert.equal(deriveFallbackTitle(`${atCap}b`, CHAT), CHAT);
});

test('the last resort is per surface, so a project never reads "New Conversation"', () => {
  const essay = 'x'.repeat(200);
  assert.equal(deriveFallbackTitle(essay, CHAT), 'New Conversation');
  assert.equal(deriveFallbackTitle(essay, 'New Project'), 'New Project');
});

test('nothing usable in the prompt falls through too', () => {
  for (const empty of ['', '   ', '\n\n', null, undefined, '///:::', '...']) {
    assert.equal(deriveFallbackTitle(empty, CHAT), CHAT, `expected the last resort for ${JSON.stringify(empty)}`);
  }
});

test('the title is safe to use as a folder name', () => {
  // It becomes Code/<name> or the chat's own directory on disk, and ':' makes
  // every folder operation throw "Name is not allowed" on Windows.
  assert.equal(deriveFallbackTitle('Fix: the <table> layout?', CHAT), 'Fix the table layout');
  // Windows drops trailing dots and spaces from a directory name, so a title
  // ending in one stops matching the folder it created.
  assert.equal(deriveFallbackTitle('Ship it.', CHAT), 'Ship it');
  // A leading dot hides the entry on POSIX and collides with the dot-files the
  // storage layer owns.
  assert.equal(deriveFallbackTitle('.env handling', CHAT), 'env handling');
});

test('a multi-line prompt collapses to one line', () => {
  assert.equal(deriveFallbackTitle('Fix the\n\nnav   bar', CHAT), 'Fix the nav bar');
});

test('collapsing happens before the length check', () => {
  // A prompt padded out past the cap by whitespace alone is still a short label.
  const padded = `Add a toggle${' '.repeat(80)}`;
  assert.equal(deriveFallbackTitle(padded, CHAT), 'Add a toggle');
});

test('the naming call still reports failure as an empty string', () => {
  // Callers apply the fallback themselves, because the last resort differs by
  // surface. If this ever started returning a title of its own, every call site
  // below would silently stop using its own.
  const chatTitle = read('platform/storage/src/local-fs/chat-title.ts');
  assert.match(chatTitle, /Returns a short title for a chat, or '' when it cannot produce one/);
  assert.match(chatTitle, /return '';\s*\};?\s*$/);
});

for (const fork of ['code']) {
  const sidebar = read(`features/${fork}/src/workbench/WorkbenchSidebar.tsx`);
  const home = read(`features/${fork}/src/CodeHome.tsx`);
  const workbench = read(`features/${fork}/src/WorkbenchView.tsx`);

  test(`${fork}: both Workbench chat titles fall back to the prompt`, () => {
    const calls = sidebar.match(/if \(!title\) title = deriveFallbackTitle\(userMsg, FALLBACK_CHAT_TITLE\);/g) ?? [];
    assert.equal(calls.length, 2, 'expected the code-chat and design-chat effects to each have a fallback');
    // The old shape wrapped the whole rename in `if (title)`, so a failed call
    // renamed nothing at all.
    assert.ok(
      !sidebar.includes('const title = await generateChatTitle('),
      'the rename is conditional on the model succeeding again',
    );
  });

  test(`${fork}: the session name is committed outside the try`, () => {
    const fallback = sidebar.indexOf("if (!summaryTitle) summaryTitle = deriveFallbackTitle(userPrompt, FALLBACK_CHAT_TITLE);");
    assert.ok(fallback > 0, 'the session-naming fallback is missing');
    const caught = sidebar.indexOf("console.error('[Sessions] Failed to auto-name session:', error);");
    const commit = sidebar.indexOf('setSessions(prev => {', fallback);
    assert.ok(caught > 0 && caught < fallback, 'the fallback must run after the catch, not inside the try');
    assert.ok(commit > fallback, 'the rename must run after the fallback has resolved a name');
  });

  test(`${fork}: an over-long model title takes the fallback too`, () => {
    // This used to be `length > 0 && length < 40`, which dropped a paragraph
    // reply on the floor and left the session called "New Chat".
    assert.match(sidebar, /if \(summaryTitle\.length >= 40\) summaryTitle = '';/);
  });

  test(`${fork}: session naming is not gated on a Gemini key`, () => {
    // The provider comes from System defaults, so requiring a Gemini key meant
    // a user naming with Claude or GPT never got a session named at all.
    assert.doesNotMatch(sidebar, /if \(!currentSessionId \|\| !apiKeys\.gemini/);
    assert.match(sidebar, /apiKeys\.gemini\?\.\[0\] \|\| apiKeys\.openai\?\.\[0\] \|\| apiKeys\.anthropic\?\.\[0\]/);
  });

  test(`${fork}: naming starts once per session, not once per token`, () => {
    // The effect depends on `messages`, which changes on every streamed token,
    // and `hasDefaultName` stays true until the rename commits.
    assert.match(sidebar, /if \(!currentSessionId \|\| namingStartedRef\.current\.has\(currentSessionId\)\) return;/);
    assert.match(sidebar, /namingStartedRef\.current\.add\(currentSessionId\);/);
  });

  test(`${fork}: both project-naming sites try the prompt before "New Project"`, () => {
    const homeCalls = home.match(/deriveFallbackTitle\(initialPrompt, 'New Project'\)/g) ?? [];
    assert.equal(homeCalls.length, 2, 'CodeHome needs the fallback on both the empty and thrown paths');
    const workbenchCalls = workbench.match(/deriveFallbackTitle\(prompt, 'New Project'\)/g) ?? [];
    assert.equal(workbenchCalls.length, 2, 'WorkbenchView needs the fallback on both the empty and thrown paths');
    assert.ok(
      !home.includes("setProjectName('New Project')"),
      'CodeHome still jumps straight to "New Project" without trying the prompt',
    );
    assert.ok(
      !workbench.includes("const fallbackName = 'New Project';"),
      'WorkbenchView still jumps straight to "New Project" without trying the prompt',
    );
  });

  test(`${fork}: a generated project name cannot break its own folder`, () => {
    // CodeHome only stripped surrounding quotes, so a name containing ':' made
    // every folder operation throw on Windows and the project never synced.
    assert.match(home, /\.replace\(\/\^\["'\]\|\["'\]\$\/g, ''\)\.replace\(\/\[\\\/:\*\?"<>\|\]\/g, ''\)/);
  });
}
