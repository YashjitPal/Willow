/**
 * Regression tests: "the app lags with a lot of chats under Recents".
 *
 * Three separate mechanisms, all of which scale with total history size and all
 * of which had to be bounded together for the symptom to go away:
 *
 *   1. Recents mounted one row per chat, unconditionally. Bounded by a window
 *      that grows on scroll.
 *   2. Opening a chat left the previous conversation painted through a Web Lock,
 *      an IndexedDB read, a File System Access read, a JSON parse and one
 *      IndexedDB read per attachment — then swapped the whole thread in one
 *      commit. Bounded by a blank-thread state plus a chunked reveal.
 *   3. Overlapping chat loads were last-writer-wins, and because autosave keys
 *      on `chatTitle || chatSessionId` a stale winner could persist one chat's
 *      messages under another chat's id. Bounded by a generation counter.
 *
 * Source assertions, because all three live inline in React components and the
 * behaviour depends on ordering that only the source expresses.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';

const appDir = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(appDir, '..', '..');

const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
const SIDEBAR = () => read('apps', 'studio', 'src', 'shell', 'sidebar', 'Sidebar.tsx');
const CHAT_VIEW = () => read('features', 'chat', 'src', 'ChatView.tsx');
const LOCAL_FS = () => read('platform', 'storage', 'src', 'local-fs', 'LocalFSContext.tsx');

// Ordering assertions must run against code only. These files document the
// hazards they guard in prose, so a comment naming a call would otherwise read
// as the call itself and the position check would pass or fail on the comment.
const codeOnly = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[^\S\r\n]*\/\/.*$/gm, '');

// ── 1. Recents windowing ─────────────────────────────────────────────────────

it('renders a window over Recents rather than every chat', () => {
  const source = SIDEBAR();

  assert.match(source, /const RECENTS_INITIAL_COUNT = \d+;/,
    'the initial Recents window size is gone — the list is unbounded again');
  assert.match(source, /index < effectiveRecentsLimit/,
    'the Recents list no longer slices to a window');
  // The window must be measured against the pinned partition, or a user with
  // many pins sees a first page made entirely of pins and no actual recents.
  assert.match(source, /effectiveRecentsLimit = recentsLimit \+ pinnedChatSet\.size/,
    'the window ignores pinned chats, which are all hoisted ahead of the recents');
});

it('never windows away a row that owns live interaction state', () => {
  const source = SIDEBAR();

  const forced = source.match(/const forced = new Set\(\s*\[([^\]]*)\]/);
  assert.ok(forced, 'could not locate the forced-visible set');

  // editingChatId: the rename <input> lives inside the row, and React does not
  // fire blur on unmount — windowing it away silently discards the rename.
  // menuActiveChat: the menu renders outside the map, so it would survive as a
  // menu floating next to nothing.
  // activeChatId: otherwise the open chat loses its active highlight.
  for (const name of ['editingChatId', 'menuActiveChat', 'activeChatId']) {
    assert.ok(forced[1].includes(name),
      `${name} is not forced visible — its row can be unmounted mid-interaction`);
  }
});

it('does not reset the window on every chat-list change', () => {
  const source = SIDEBAR();
  const reset = source.match(/setRecentsLimit\(RECENTS_INITIAL_COUNT\);\s*\n\s*\}, \[([^\]]*)\]\)/);
  assert.ok(reset, 'could not locate the window reset effect');
  assert.ok(!/localChats/.test(reset[1]),
    'the window resets on localChats — a rename or a new chat would collapse a scrolled list');
});

// ── 2. The background body scanner ───────────────────────────────────────────

it('scopes the Code-mode body backfill to the visible window', () => {
  const source = SIDEBAR();

  // This reads FULL chat bodies on the same per-chat operation queue that the
  // user's own chat open waits on. Walking all of localChats meant a large
  // workspace spent minutes on reads nobody asked for, and every click queued
  // behind them — the direct cause of the startup lag.
  assert.match(source, /const pending = scanCandidates\.filter\(/,
    'the backfill walks the whole chat list again instead of the visible window');
  assert.ok(!/const pending = localChats\.filter\(/.test(source),
    'the backfill is unbounded again');

  // A cancelled read must roll its own bookkeeping back, or a restart filters
  // the chat out as "already scanned" while localStorage never recorded it and
  // its marker is lost for the session. The effect now restarts legitimately
  // whenever the window grows, so this is load-bearing.
  assert.match(source, /codeChatScannedRef\.current\.delete\(inFlight\)/,
    'a cancelled body read no longer rolls back its scanned marker');
});

// ── 3. Chat open: blank thread, not stale content ────────────────────────────

it('blanks the thread while a selected chat loads, without moving the composer', () => {
  const source = CHAT_VIEW();

  assert.match(source, /const showBlankThread = isChatLoading;/,
    'the blank-thread state is gone — the previous chat stays painted during a load');
  // Both render branches must be suppressed, or a loading chat falls through to
  // the "new chat" greeting.
  assert.match(source, /\{!hasStarted && !showBlankThread && \(/,
    'the zero state is not suppressed during a load — a loading chat shows the greeting');
  assert.match(source, /\{hasStarted && !showBlankThread && \(/,
    'the thread is not suppressed during a load');

  // hasStarted must NOT be forced false to achieve this: it also drives the
  // composer's docked-vs-centred layout, and the docked->zero direction is a
  // 0-duration snap, so flipping it teleports the composer to screen centre.
  assert.match(source, /const isThreadDocked = hasStarted \|\| showBlankThread;/,
    'the composer no longer has a docked signal independent of hasStarted');
  // These two must stay paired or the composer squashes.
  assert.match(source, /layoutDependency=\{isThreadDocked\}/,
    'layoutDependency drifted off isThreadDocked');
  assert.match(source, /layout: isThreadDocked/,
    'the layout transition drifted off isThreadDocked');
});

it('does not blank the thread for anything but a user selection', () => {
  const source = CHAT_VIEW();

  const guard = source.match(/if \(isUserSelection && ([^)]*)\) \{/);
  assert.ok(guard, 'could not locate the blank-thread raise condition');

  // forceReload means "same chat, background disk sync" — the body-update
  // listener already filters to the active chat. Blanking there wipes a live
  // conversation every time the 3s disk poll finds a change.
  assert.ok(/!forceReload/.test(guard[1]),
    'a background disk sync would blank the conversation being read');
  assert.ok(/!isGeneratingRef\.current/.test(guard[1]) && /!isLiveRef\.current/.test(guard[1]),
    'switching chats mid-generation or mid-live-session would blank the thread');

  // The epoch must be consumed before the identity guard's early return, or a
  // bump goes unclaimed and the NEXT internal id move (rename, temp-id
  // adoption) reads as a user selection and blanks a chat nobody navigated away
  // from.
  const code = codeOnly(source);
  const consume = code.indexOf('consumedSelectionEpochRef.current = selectionEpoch');
  const identityGuard = code.indexOf('activeChatId === chatTitle || activeChatId === chatSessionId');
  assert.notEqual(consume, -1, 'could not locate the epoch consume');
  assert.notEqual(identityGuard, -1, 'could not locate the identity guard');
  assert.ok(consume < identityGuard,
    'the selection epoch is consumed after the identity guard, so bumps go unclaimed');
});

it('bumps the selection epoch only for a real user selection', () => {
  const source = LOCAL_FS();

  const select = source.match(/const selectLocalFSInboxChat = useCallback\([\s\S]*?\}, \[\]\);/);
  assert.ok(select, 'could not locate selectLocalFSInboxChat');
  assert.match(select[0], /bumpChatSelectionEpoch\(\)/,
    'the user-selection path no longer bumps the epoch, so no chat open will blank');

  // Rename, temp-id adoption and delete all call setActiveChatId directly and
  // must NOT bump — a rename of the chat you are reading would blank it.
  const bumps = source.match(/bumpChatSelectionEpoch\(\)/g) ?? [];
  assert.equal(bumps.length, 1,
    'something other than selectLocalFSInboxChat bumps the epoch — internal id moves will blank the thread');
});

// ── 4. Stale-load guard ──────────────────────────────────────────────────────

it('discards a superseded chat load instead of letting it win', () => {
  const source = CHAT_VIEW();

  assert.match(source, /const generation = \+\+loadGenerationRef\.current;/,
    'the load generation counter is gone — overlapping chat loads are last-writer-wins again');

  const loadChat = source.match(/const loadChat = async \(\) => \{[\s\S]*?\n {6}\};/);
  assert.ok(loadChat, 'could not locate loadChat');
  const body = codeOnly(loadChat[0]);

  const firstCheck = body.indexOf('if (!isCurrent()) return;');
  assert.notEqual(firstCheck, -1, 'loadChat has no staleness check at all');

  // Check 1 must precede the revoke: a superseded load reaching it revokes the
  // WINNER's object URLs and every image in the fresh thread goes blank.
  const revoke = body.indexOf('revokeAllAttachmentObjectUrls()');
  assert.ok(firstCheck < revoke,
    'a stale load can revoke the winning load\'s attachment object URLs');

  // Two checks: one per await. Attachment hydration awaits one IndexedDB read
  // per attachment, so a faster chat can overtake between them.
  const checks = body.match(/if \(!isCurrent\(\)\) return;/g) ?? [];
  assert.ok(checks.length >= 2,
    'only one staleness check — a chat that overtakes during attachment hydration still wins');

  // The id setters are what autosave persists under, so every commit must sit
  // behind a check with no await between it and the commit. The setters live in
  // `commitLoadedChat` now, so the property to pin is that each call to it is
  // await-free from the nearest preceding check.
  const commits = [...body.matchAll(/commitLoadedChat\(activeChatId, /g)].map((m) => m.index);
  assert.ok(commits.length >= 2, 'expected a commit in both load branches');
  for (const commit of commits) {
    const preceding = body.lastIndexOf('if (!isCurrent()) return;', commit);
    assert.notEqual(preceding, -1,
      'a chat commit is not guarded — a stale load can make autosave write to the wrong chat file');
    assert.ok(!/await/.test(body.slice(preceding, commit)),
      'an await sits between the staleness check and the commit, reopening the race');
  }

  // And the commit itself must stay synchronous, or the guard above proves
  // nothing: an await inside it would reopen the same window it closes.
  const commitFn = CHAT_VIEW().match(
    /const commitLoadedChat = useEventCallback\([\s\S]*?\n {2}\}\);/,
  );
  assert.ok(commitFn, 'could not locate commitLoadedChat');
  assert.ok(!/\bawait\b/.test(codeOnly(commitFn[0])),
    'commitLoadedChat awaits — the staleness check no longer covers the commit');

  // The release must be unconditional, or one corrupt blob leaves the thread
  // permanently blank and the progress bar spinning.
  assert.match(body, /\} finally \{[\s\S]*releaseChatLoading\(\)/,
    'the loading state is not released in a finally — a throw leaves the thread blank forever');
});

// ── 5. Chunked reveal ────────────────────────────────────────────────────────

it('reveals a loaded thread in chunks without shifting the scroll position', () => {
  const source = CHAT_VIEW();

  assert.match(source, /const REVEAL_INITIAL_COUNT = (\d+);/,
    'the chunked reveal is gone — a long thread lands as one synchronous commit');

  // The open-scroll jump targets messages[length - 1 - 4]. If that element is
  // not mounted the jump silently no-ops and the chat opens scrolled to the TOP.
  const initial = Number(source.match(/const REVEAL_INITIAL_COUNT = (\d+);/)[1]);
  assert.ok(initial >= 8,
    `the first chunk is ${initial}: too small for the open-scroll jump, which needs the 5th-from-last message mounted`);

  // gapBefore must be derived from the full array, or slice-index 0 takes the
  // `messageIndex === 0` branch and every chunk shifts the thread by 52px.
  assert.match(source, /const messageIndex = revealOffset \+ visibleIndex;/,
    'the message index is derived from the slice, so revealed chunks will shift the thread');

  // Mounting older messages above the viewport grows scrollHeight at the top.
  // Measure, commit synchronously, correct — a batched setState paints the
  // taller content before the correction lands.
  const reveal = source.match(/revealRafRef\.current = requestAnimationFrame\(\(\) => \{[\s\S]*?\n {4}\}\);/);
  assert.ok(reveal, 'could not locate the reveal frame');
  assert.match(reveal[0], /flushSync\(\(\) => setRevealCount/,
    'the reveal is not flushed synchronously — each chunk will visibly shove the thread down');
  assert.match(reveal[0], /container\.scrollTop \+= container\.scrollHeight - before;/,
    'the reveal does not compensate scroll for the prepended height');
});

it('materialises the whole thread before a send', () => {
  const source = CHAT_VIEW();

  // A send lands at the bottom; a mid-flight reveal would leave the thread
  // visibly missing its older half while the reply streams in.
  assert.match(source, /setRevealCount\(Number\.MAX_SAFE_INTEGER\);/,
    'handleSend no longer materialises the thread, so a send mid-reveal renders a partial history');

  // messages shrinks on regenerate and on editing an earlier turn.
  assert.match(source, /Math\.min\(revealCount, messages\.length\)/,
    'the reveal window is not clamped to the message count');
});
