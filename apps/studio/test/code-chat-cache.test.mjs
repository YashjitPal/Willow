/**
 * Regression test: "the sidebar freezes the app once history gets large".
 *
 * Mechanism. `readCodeChats` answers "is this a Code-mode chat?" by walking
 * EVERY localStorage key, because the canonical record for each chat is its own
 * key. The sidebar asked once per chat while rendering the Recents list, so the
 * cost of one paint was O(chats x keys) — and since each Code chat adds a key,
 * both factors grow together. At a few hundred chats this is tens of thousands
 * of synchronous reads per render, on the thread that draws the UI, which is
 * what made a large history lock up the whole app rather than merely slow it.
 *
 * The fix is a module-level cache: one scan, reused until something invalidates
 * it. These tests pin the property that actually matters (reads do not rescan)
 * plus the correctness conditions that make caching safe — scope isolation and
 * invalidation on write.
 *
 * The module is imported for real; `esbuild` handles the TS and the `@willow/*`
 * aliases, so this exercises the shipped code rather than a restatement of it.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, before, beforeEach, it } from 'node:test';
import { build } from 'esbuild';
import { willowAliasPlugin } from '../scripts/lib/willow-aliases.mjs';

const appDir = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(appDir, '..', '..');

/**
 * localStorage stand-in that counts full scans.
 *
 * `key(i)` is only ever called by the scan loop, so counting calls at index 0
 * counts scans — the exact quantity the fix is about.
 */
const makeStorage = () => {
  const map = new Map();
  let scans = 0;
  return {
    scans: () => scans,
    resetScans: () => { scans = 0; },
    seed: (entries) => { for (const [k, v] of Object.entries(entries)) map.set(k, v); },
    get length() { return map.size; },
    key(i) {
      if (i === 0) scans += 1;
      return [...map.keys()][i] ?? null;
    },
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => { map.clear(); },
  };
};

let bundleDir = '';
let storage;
let mod;

const SCOPE = 'user-1::root-1::My Willow';
const OTHER_SCOPE = 'user-2::root-1::My Willow';
const statePrefix = (scope) => `willow_code_chat_state:v2:${encodeURIComponent(scope)}:`;

before(async () => {
  const cacheDir = path.join(repoRoot, 'node_modules', '.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  bundleDir = fs.mkdtempSync(path.join(cacheDir, 'willow-code-chat-'));
  const outfile = path.join(bundleDir, 'code-chat.mjs');
  await build({
    stdin: {
      resolveDir: appDir,
      sourcefile: 'code-chat-entry.ts',
      loader: 'ts',
      contents: `export * from '@willow/storage/code-chat-storage';`,
    },
    outfile,
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    target: 'node23',
    plugins: [willowAliasPlugin(repoRoot)],
  });

  // The module registers a `storage` listener at import time and gates every
  // read on `typeof window`, so both globals must exist before the import.
  storage = makeStorage();
  globalThis.localStorage = storage;
  globalThis.window = { addEventListener() {}, dispatchEvent() {} };
  globalThis.CustomEvent = class { constructor(type, init) { this.type = type; Object.assign(this, init); } };

  mod = await import(pathToFileURL(outfile).href);
});

after(() => {
  if (bundleDir) fs.rmSync(bundleDir, { recursive: true, force: true });
  delete globalThis.localStorage;
  delete globalThis.window;
  delete globalThis.CustomEvent;
});

beforeEach(() => {
  storage.clear();
  storage.resetScans();
  // Force the cache to belong to a scope no test asserts on, so each test
  // starts from a known-cold state without needing an exported reset.
  mod.isCodeChat('warmup-scope', 'warmup');
  storage.resetScans();
});

/** Seed `count` Code-mode chats, the way the app records them. */
const seedChats = (scope, count) => {
  const entries = {};
  for (let i = 0; i < count; i++) {
    entries[`${statePrefix(scope)}${encodeURIComponent(`chat-${i}`)}`] =
      JSON.stringify({ present: true, updatedAt: 1 });
  }
  storage.seed(entries);
};

it('answers many chats with a single scan, not one per chat', () => {
  seedChats(SCOPE, 50);
  storage.resetScans();

  for (let i = 0; i < 50; i++) {
    assert.equal(mod.isCodeChat(SCOPE, `chat-${i}`), true);
  }

  // Pre-fix this was 50. The whole defect is that this number tracked the size
  // of the list being rendered.
  assert.equal(storage.scans(), 1,
    'reads are rescanning localStorage per chat — the sidebar freeze is back');
});

it('still reports the right answer for chats that are not Code-mode', () => {
  seedChats(SCOPE, 3);
  assert.equal(mod.isCodeChat(SCOPE, 'chat-1'), true);
  assert.equal(mod.isCodeChat(SCOPE, 'chat-99'), false,
    'caching must not turn an unknown chat into a hit');
});

it('does not serve one scope from another scope cache', () => {
  seedChats(SCOPE, 2);
  seedChats(OTHER_SCOPE, 2);
  storage.seed({
    [`${statePrefix(SCOPE)}${encodeURIComponent('only-mine')}`]:
      JSON.stringify({ present: true, updatedAt: 1 }),
  });

  assert.equal(mod.isCodeChat(SCOPE, 'only-mine'), true);
  // A cache keyed only by "is populated" would answer this from the wrong scope,
  // leaking one account's Code markers into another's sidebar.
  assert.equal(mod.isCodeChat(OTHER_SCOPE, 'only-mine'), false,
    'scope isolation is broken — markers are leaking across accounts');
  assert.equal(mod.isCodeChat(SCOPE, 'only-mine'), true,
    'switching back must still be correct');
});

it('reflects a newly marked chat immediately', () => {
  seedChats(SCOPE, 2);
  assert.equal(mod.isCodeChat(SCOPE, 'fresh'), false);

  mod.markCodeChat(SCOPE, 'fresh');

  assert.equal(mod.isCodeChat(SCOPE, 'fresh'), true,
    'a stale cache is hiding a chat that was just marked');
});

it('reflects an unmarked chat immediately', () => {
  seedChats(SCOPE, 2);
  assert.equal(mod.isCodeChat(SCOPE, 'chat-0'), true);

  mod.unmarkCodeChat(SCOPE, 'chat-0');

  assert.equal(mod.isCodeChat(SCOPE, 'chat-0'), false,
    'a stale cache is still reporting an unmarked chat as Code-mode');
});

it('reflects a rename on both the old and new id', () => {
  seedChats(SCOPE, 1);
  assert.equal(mod.isCodeChat(SCOPE, 'chat-0'), true);

  mod.renameCodeChat(SCOPE, 'chat-0', 'chat-renamed');

  assert.equal(mod.isCodeChat(SCOPE, 'chat-renamed'), true,
    'the renamed chat lost its Code-mode marker');
  assert.equal(mod.isCodeChat(SCOPE, 'chat-0'), false,
    'the old id still reads as Code-mode after a rename');
});

/**
 * The consumer side of the same defect.
 *
 * The cache makes a per-row `isCodeChat()` call cheap, but the sidebar should
 * still resolve the map once per render rather than per row — and, more
 * importantly, the lazy migration effect must NOT read through the memo. That
 * effect calls `markCodeChat`, which invalidates the memo; depending on it
 * restarts the scan and cancels an in-flight body read for a chat already
 * recorded in `codeChatScannedRef`, permanently losing that chat's marker.
 *
 * Source assertions, because this lives inline in a React component.
 */
const SIDEBAR_SOURCE = path.join(
  import.meta.dirname, '..', 'src', 'shell', 'sidebar', 'Sidebar.tsx',
);

it('reads the Code-mode map once per render, not once per row', () => {
  const source = fs.readFileSync(SIDEBAR_SOURCE, 'utf8');

  assert.match(source, /const codeChats = useMemo\(/,
    'the per-render memo is gone — the sidebar is rescanning storage per row again');

  // The Recents row must index the resolved map, not call the per-chat helper.
  const rowLookup = source.indexOf('const startedInCode =');
  assert.notEqual(rowLookup, -1, 'could not locate the Recents row Code-mode lookup');
  const rowLine = source.slice(rowLookup, source.indexOf('\n', rowLookup));
  assert.match(rowLine, /codeChats\[/,
    'the Recents row is calling a per-chat helper instead of indexing the memo');
});

it('keeps the migration-scan effect off the memoized map', () => {
  const source = fs.readFileSync(SIDEBAR_SOURCE, 'utf8');

  const pending = source.indexOf('const pending = localChats.filter(');
  assert.notEqual(pending, -1, 'could not locate the migration-scan filter');
  // The whole filter expression, not its first line. The predicate spans four
  // lines, so slicing to the first newline captured only
  // `const pending = localChats.filter((chatId) =>` — which contains neither
  // name this test is about, so the isCodeChat assertion could never pass.
  const filterEnd = source.indexOf(');', pending);
  assert.notEqual(filterEnd, -1, 'could not find the end of the migration-scan filter');
  const filterLine = source.slice(pending, filterEnd);

  assert.match(filterLine, /isCodeChat\(/,
    'the migration scan must call isCodeChat, not read the memo');
  assert.ok(!/codeChats\[/.test(filterLine),
    'the migration scan reads the memo it invalidates — a marked chat will lose its marker');
});

it('does not let a writer mutate a map a caller is already holding', () => {
  seedChats(SCOPE, 2);
  const held = mod.readCodeChats(SCOPE);
  assert.equal(held['added-later'], undefined);

  mod.markCodeChat(SCOPE, 'added-later');

  // Writers must build their new state from a private scan, not by editing the
  // shared cached object. Otherwise a React render holding this reference sees
  // it change underneath it, which is the classic source of a list that renders
  // stale or inconsistent rows without any state change to explain it.
  assert.equal(held['added-later'], undefined,
    'a writer mutated the cached map in place — held references are not stable');
  assert.equal(mod.readCodeChats(SCOPE)['added-later'], true,
    'the write must still be visible to the next read');
});
