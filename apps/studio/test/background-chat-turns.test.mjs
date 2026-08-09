/**
 * Regression tests: "leaving a chat mid-response destroys the response".
 *
 * The stream kept running, but every write it made landed nowhere. `onThought`
 * and `finalizeAssistant` both located their target with
 * `prev.map(m => m.id === assistantId ? ... : m)` against a `messages` array the
 * load effect had already replaced — no match, no error, tokens silently
 * dropped. Worse, the `finally` then cleared `isGenerating`, unblocking an
 * autosave that wrote under `chatTitle || chatSessionId`: the chat the user had
 * moved TO.
 *
 * A turn now lives on a module-level record that outlives the component, which
 * it has to: the Code/Media tabs, New Chat and Incognito all unmount ChatView
 * outright. Leaving detaches a listener; it does not stop a turn.
 *
 * Source assertions, because the behaviour is ordering that only the source
 * expresses — and several of these guard races that no unit test can provoke
 * deterministically.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';

const appDir = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(appDir, '..', '..');

const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
const STORE = () => read('features', 'chat', 'src', 'chat-turn-store.ts');
const RUNNER = () => read('features', 'chat', 'src', 'chat-turn-runner.ts');
const CHAT_VIEW = () => read('features', 'chat', 'src', 'ChatView.tsx');
const LOCAL_FS = () => read('platform', 'storage', 'src', 'local-fs', 'LocalFSContext.tsx');

// Ordering assertions run against code only: these files document the hazards
// they guard in prose, so a comment naming a call would read as the call.
const codeOnly = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[^\S\r\n]*\/\/.*$/gm, '');

// ── The turn outlives the component ──────────────────────────────────────────

it('keys turns by a stable id, not by chat id', () => {
  const store = codeOnly(STORE());
  // A chat is renamed out from under a running turn (temp id -> real title)
  // mid-stream, so a chat-id key would go stale while the turn is still running.
  assert.match(store, /turnId: string;/);
  assert.match(store, /chatIdHistory: string\[\];/);
  // The history fallback is what makes a missed rebind event degrade to
  // stale-but-findable rather than a lost turn.
  assert.match(
    store,
    /record\.chatId === chatId \|\| record\.chatIdHistory\.includes\(chatId\)/,
  );
});

it('survives an HMR re-evaluation of the store module', () => {
  const store = codeOnly(STORE());
  // A plain module-level Map is rebuilt on every hot reload, orphaning the
  // AbortController of anything running and dangling its listener.
  assert.match(store, /Symbol\.for\('willow\.chatTurns'\)/);
  assert.match(store, /globalScope\[TURNS_KEY\] \?\? \(globalScope\[TURNS_KEY\] = new Map\(\)\)/);
});

it('does not bump the store atom per token', () => {
  const store = codeOnly(STORE());
  // Streamed text reaches the UI through record.listener. Routing it through a
  // nanostore instead would re-render every subscriber on every token.
  const bumpSites = store.match(/^\s*bump\(\);?$/gm) ?? [];
  assert.ok(bumpSites.length > 0, 'the coarse signal is gone entirely');
  assert.ok(!/onText[\s\S]{0,200}bump\(\)/.test(store),
    'the store atom is bumped on the token path');
});

// ── Exactly one writer ───────────────────────────────────────────────────────

it('claims settlement synchronously so a turn is never saved twice or not at all', () => {
  const store = codeOnly(STORE());
  const claim = store.match(/export const claimChatTurnSettlement[\s\S]*?\n\};/);
  assert.ok(claim, 'could not locate claimChatTurnSettlement');
  // saveLocalFSChat is a whole-file replace, so two writers means the loser's
  // array wins outright. An await inside the claim would let a detach land
  // between the check and the decision.
  assert.ok(!/\bawait\b/.test(claim[0]), 'the settlement claim awaits — the race is reopened');
  assert.match(claim[0], /record\.settledBy = record\.listener \? 'view' : 'runner';/);

  const runner = codeOnly(RUNNER());
  assert.match(runner, /const owner = claimChatTurnSettlement\(record\.turnId\);/);
  assert.match(runner, /if \(owner === null\) return;/);
});

it('detaches on unmount so an orphaned turn still saves itself', () => {
  const view = codeOnly(CHAT_VIEW());
  // This is the whole data-loss path: leave a dead listener attached and the
  // runner claims 'view', calls into an unmounted tree, and drops the record
  // WITHOUT saving.
  assert.match(view, /useEffect\(\(\) => \(\) => \{ detachTurn\(\); \}, \[detachTurn\]\);/);
  // Compare-and-clear, because StrictMode double-invokes effects and a blind
  // clear would drop the listener a later attach installed.
  const store = codeOnly(STORE());
  assert.match(store, /if \(record && record\.listener === listener\) record\.listener = null;/);
});

it('only the attached view pushes into React', () => {
  const runner = codeOnly(RUNNER());
  // `streaming` is a single component-wide value. An unwatched turn writing to
  // it would let a background chat paint over the displayed one.
  assert.match(runner, /record\.listener\?\.onText\(record\.content\);/);
  const view = codeOnly(CHAT_VIEW());
  const listener = view.match(/const buildTurnListener = useCallback[\s\S]*?\n {2}\}\), \[/);
  assert.ok(listener, 'could not locate buildTurnListener');
  // Every callback re-checks it is still the displayed turn.
  const guards = listener[0].match(/if \(attachedTurnIdRef\.current !== turnId\) return;/g) ?? [];
  assert.ok(guards.length >= 4,
    'a listener callback is missing its displayed-turn guard');
});

it('compare-and-clears the shared singletons at settle', () => {
  const view = codeOnly(CHAT_VIEW());
  // A turn settling in ANOTHER chat must not null the controller behind the
  // displayed chat's stop button, nor rAF-clear its streaming buffer.
  assert.match(view, /if \(generationAbortRef\.current === record\.abort\) generationAbortRef\.current = null;/);
});

// ── Identity follows the chat ────────────────────────────────────────────────

it('announces every chat id move and deletion from the storage layer', () => {
  const localFs = codeOnly(LOCAL_FS());
  // Module-scope subscription, because the point is that it works while
  // ChatView is unmounted. setActiveChatId is NOT a usable signal: it declines
  // when the user is viewing another chat, which is exactly this case.
  const moves = localFs.match(/willow_chat_id_moved/g) ?? [];
  assert.equal(moves.length, 2, 'both the temp-id adoption and the rename must announce');
  assert.match(localFs, /willow_chat_deleted/);
  assert.match(localFs, /willow_chat_scope_changing/);

  const store = codeOnly(STORE());
  assert.match(store, /rebindChatTurnChatId\(detail\.from, detail\.to\)/);
  assert.match(store, /abortChatTurnsForChat\(chatId\)/);
  assert.match(store, /abortAllChatTurns\(\)/);
});

it('aborts and forgets a deleted chat rather than saving it', () => {
  const localFs = codeOnly(LOCAL_FS());
  const del = localFs.match(/const deleteLocalFSChat[\s\S]*?\n {2}\}, \[/);
  assert.ok(del, 'could not locate deleteLocalFSChat');
  // Announced BEFORE the body is removed. saveLocalFSChat clears the tombstone
  // and re-adds the id, so a completion landing after a delete resurrects the
  // chat in IndexedDB, in Recents and on disk — and it survives the reconciler.
  const announce = del[0].indexOf('willow_chat_deleted');
  const removeBody = del[0].indexOf('deleteChatBody');
  assert.notEqual(announce, -1, 'delete does not announce, so a turn can resurrect the chat');
  assert.ok(announce < removeBody, 'the delete announcement lands after the body is removed');

  const store = codeOnly(STORE());
  const abortForChat = store.match(/export const abortChatTurnsForChat[\s\S]*?\n\};/);
  assert.ok(abortForChat, 'could not locate abortChatTurnsForChat');
  assert.match(abortForChat[0], /record\.abort\.abort\(\)/);
  assert.match(abortForChat[0], /turnsById\.delete\(record\.turnId\)/);
});

it('refuses to write after its scope changed', () => {
  const runner = codeOnly(RUNNER());
  // chatStorageScopeRef is reassigned on a scope switch, so a late write lands
  // in the next account's namespace under this one's chat name.
  assert.match(runner, /deps\.currentScopeId\(\) === record\.scopeId/);
  // Re-validated on every callback, Spark-style — not once at the top.
  const checks = runner.match(/isCurrent\(record, deps\)/g) ?? [];
  assert.ok(checks.length >= 5, 'the identity guard is not re-checked per callback');
});

it('re-reads the chat id at write time', () => {
  const runner = codeOnly(RUNNER());
  // A rename may have landed mid-stream, so a captured id would write to the
  // pre-rename file.
  assert.match(runner, /deps\.saveChat\(record\.chatId,/);
  assert.ok(!/const\s+chatId\s*=\s*record\.chatId/.test(runner),
    'the chat id is captured rather than re-read at write time');
});

// ── Persistence ──────────────────────────────────────────────────────────────

it('retries a declined save instead of dropping the turn', () => {
  const runner = codeOnly(RUNNER());
  // saveLocalFSChat returns undefined during a scope switch and false on a
  // collision. Unlike the autosave effect, the runner has no next save to
  // subsume a failed one.
  assert.match(runner, /if \(saved\) \{/);
  assert.match(runner, /SAVE_RETRY_DELAYS_MS/);
  // On exhaustion the record survives, so the next view to open the chat can
  // commit it and let the normal autosave path write it.
  assert.match(runner, /record\.persisted = true;[\s\S]{0,80}?removeChatTurn\(record\.turnId\);/);
});

it('checkpoints a partial response as a stopped turn', () => {
  const runner = codeOnly(RUNNER());
  // Nothing survives a tab close mid-request, so the partial text has to
  // already be on disk. `wasStopped` is the existing shape for "ended early but
  // keep it": hasSavedMessageContent retains such a turn even when empty, the
  // load path reads the flag back, and the thread renders the divider.
  assert.match(runner, /buildAssistantMessage\(record, record\.content, true\)/);
  assert.match(runner, /CHECKPOINT_INTERVAL_MS/);
  // Incognito never persists.
  assert.match(runner, /if \(record\.isIncognito\) return;/);
  // Not attempted from beforeunload/pagehide: an IndexedDB transaction started
  // during unload routinely never commits, so it would only appear to work.
  assert.ok(!/beforeunload|pagehide/.test(runner),
    'the runner tries to save during unload, which silently fails under real conditions');
});

// ── Resume ───────────────────────────────────────────────────────────────────

it('resumes a running turn in the same commit as the loaded thread', () => {
  const view = codeOnly(CHAT_VIEW());
  const commit = view.match(/const commitLoadedChat = useEventCallback[\s\S]*?\n {2}\}\);/);
  assert.ok(commit, 'could not locate commitLoadedChat');
  const body = commit[0];

  // Split across two effects, React would paint the saved thread with no
  // generating row, and a turn settling in between would land its result into a
  // listener that had not attached yet.
  assert.ok(!/\bawait\b/.test(body), 'the resume commit awaits');
  assert.match(body, /setIsGenerating\(true\);/);
  assert.match(body, /setStreaming\(record\.content\);/);
  assert.match(body, /generationAbortRef\.current = record\.abort;/);
  assert.match(body, /attachTurn\(record\.turnId\);/);

  // The reveal effect force-collapses its window the instant isGenerating is
  // true, and THAT path has no scroll compensation — a small window here would
  // mount the whole history above the viewport in one uncompensated commit.
  const revealAt = body.indexOf('setRevealCount(Number.MAX_SAFE_INTEGER)');
  assert.notEqual(revealAt, -1, 'a resumed thread uses the chunked reveal window');
  assert.ok(revealAt < body.indexOf('setIsGenerating(true)'),
    'the reveal window is widened after generation is flagged');
});

it('reconstructs the turn messages that are not on disk', () => {
  const view = codeOnly(CHAT_VIEW());
  const commit = view.match(/const commitLoadedChat = useEventCallback[\s\S]*?\n {2}\}\);/);
  assert.ok(commit, 'could not locate commitLoadedChat');
  // The placeholder is filtered out of every save by hasSavedMessageContent
  // (empty content), and the user message may predate the first save, so the
  // loaded thread cannot contain either.
  assert.match(commit[0], /\[record\.userMessage, assistant\]\.filter\(/);
  assert.match(commit[0], /!saved\.some\(\(savedMessage\) => savedMessage\.id === message\.id\)/);
});

it('strips blob URLs from anything stored on a record', () => {
  const view = codeOnly(CHAT_VIEW());
  // Object URLs are revoked by the creating ChatView's unmount, so a record
  // outliving it would carry URLs that render as broken images.
  assert.match(view, /historyBefore: prevMessages\.map\(stripAttachmentObjectUrls\)/);
  assert.match(view, /userMessage: stripAttachmentObjectUrls\(userMsg\)/);
});

// ── Re-entrancy ──────────────────────────────────────────────────────────────

it('gates sending on the chat, not on component state', () => {
  const view = codeOnly(CHAT_VIEW());
  // A turn may still be running in ANOTHER chat; blocking the foreground on it
  // would make "background" pointless.
  assert.match(view, /if \(hasRunningTurnForChat\(chatTitle \|\| chatSessionId\) \|\| sendInFlightRef\.current\) return;/);
  assert.match(view, /countRunningChatTurns\(\) >= MAX_CONCURRENT_CHAT_TURNS/);
  // The old component-state guard would be false in a chat with no turn of its
  // own, so it must not linger as the primary gate.
  assert.ok(!/\|\| isGenerating \|\| sendInFlightRef\.current\) return;/.test(view),
    'the send guard still reads component isGenerating');
});
