/**
 * Regression test: "new chat vanishes a few seconds after its title arrives".
 *
 * Mechanism. `reconcileChatsWithDisk` enumerates the Chats directory ONCE at the
 * top of the pass, then reaches its external-deletion decision only after every
 * per-chat `await` above it — seconds later on a real workspace. A chat written
 * during that window is present on disk and absent from the snapshot, so the
 * loop read it as an external delete and tombstoned it: sidebar entry removed,
 * `activeChatId` nulled, and the live conversation wiped by ChatView's
 * clear-effect. Renaming a brand-new chat to its AI-generated title is exactly
 * such a write, which is why this reproduced on the first message every time.
 *
 * Two layers, because the decision lives inline in a React callback and cannot
 * be imported: a faithful model of the loop that proves old-vs-new behaviour,
 * and source assertions that keep the fix from being refactored away.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const CONTEXT_SRC = path.join(repoRoot, 'platform', 'storage', 'src', 'local-fs', 'LocalFSContext.tsx');

/**
 * The external-deletion decision as a pure function of what the pass knows.
 *
 * One branch per branch in the real loop, so an outcome name here maps to one
 * place in the source:
 *
 *   'noop'            snapshot hit (`continue`) or tombstone (`return`)
 *   'kept'            re-check found the file; re-added to the list
 *   'kept-transient'  re-check failed for a non-NotFoundError reason
 *   'retry-later'     dirty, body unreadable or flush failed — left dirty
 *   'flushed-to-disk' dirty with a readable body, rewritten to disk
 *   'tombstoned'      destroyed: list entry, timestamp and body all removed
 *
 * `recheckDisk` is `null` to model pre-fix behaviour (trust the snapshot) and a
 * lookup to model the fix (absence must still hold at decision time).
 */
const decideExternalDelete = ({
  chatId,
  snapshot,
  record,
  recheckDisk,
  loadBody = () => null,
  writeSucceeds = true,
}) => {
  if (snapshot.has(chatId)) return 'noop';
  if (record?.tombstone) return 'noop';

  if (recheckDisk) {
    const found = recheckDisk(chatId);
    if (found === 'present') return 'kept';
    // Only a genuine "not there" is evidence of a delete. A permission or
    // transient failure must not be.
    if (found !== 'absent') return 'kept-transient';
  }

  if (record?.dirty) {
    if (!loadBody(chatId)) return 'retry-later';
    return writeSucceeds ? 'flushed-to-disk' : 'retry-later';
  }

  return 'tombstoned';
};

/**
 * The observed timeline, as traced in the browser.
 *
 * The chat is saved under its generated title *after* the snapshot is taken,
 * and `dirty` has already flipped false because the disk write succeeded — so
 * the dirty-guard cannot save it either.
 */
const titleRenameTimeline = () => ({
  chatId: 'Multimedia Project Assistance',
  // Snapshot predates the rename write.
  snapshot: new Set(['Some Older Chat']),
  record: { dirty: false, tombstone: false },
  // Disk, consulted at decision time, does have the file.
  recheckDisk: () => 'present',
});

it('reproduces the bug: trusting the stale snapshot tombstones a live chat', () => {
  const { recheckDisk, ...timeline } = titleRenameTimeline();
  assert.equal(
    decideExternalDelete({ ...timeline, recheckDisk: null }),
    'tombstoned',
    'pre-fix behaviour should destroy the freshly renamed chat — if this stops '
      + 'reproducing, the model no longer matches the code it stands in for',
  );
});

it('keeps a chat that reached disk after the snapshot was taken', () => {
  assert.equal(decideExternalDelete(titleRenameTimeline()), 'kept');
});

it('still deletes a chat genuinely removed from disk', () => {
  // The behaviour the loop exists for: user deletes the file in Explorer,
  // possibly while the app was closed. Absence is true at decision time.
  assert.equal(
    decideExternalDelete({
      chatId: 'Deleted Outside The App',
      snapshot: new Set(),
      record: { dirty: false, tombstone: false },
      recheckDisk: () => 'absent',
    }),
    'tombstoned',
  );
});

it('does not treat a permission or transient error as a deletion', () => {
  for (const outcome of ['error', 'denied']) {
    assert.equal(
      decideExternalDelete({
        chatId: 'Unreadable Right Now',
        snapshot: new Set(),
        record: { dirty: false, tombstone: false },
        recheckDisk: () => outcome,
      }),
      'kept-transient',
      `a "${outcome}" re-check must not be read as an external delete`,
    );
  }
});

it('retries rather than erasing when a dirty flush to disk fails', () => {
  assert.equal(
    decideExternalDelete({
      chatId: 'Flush Failed',
      snapshot: new Set(),
      record: { dirty: true, tombstone: false },
      recheckDisk: () => 'absent',
      loadBody: () => [{ role: 'user', content: 'hi' }],
      writeSucceeds: false,
    }),
    'retry-later',
  );
});

it('retries a dirty chat whose body cannot be read, instead of erasing it', () => {
  // A save registers the chat before writing its body, so a reconcile landing
  // mid-save sees dirty-with-no-body. That is a read to retry, not a delete.
  assert.equal(
    decideExternalDelete({
      chatId: 'Save In Flight',
      snapshot: new Set(),
      record: { dirty: true, tombstone: false },
      recheckDisk: () => 'absent',
      loadBody: () => null,
    }),
    'retry-later',
  );
});

it('flushes a dirty chat back to disk when its body is readable', () => {
  assert.equal(
    decideExternalDelete({
      chatId: 'Local Work Disk Never Saw',
      snapshot: new Set(),
      record: { dirty: true, tombstone: false },
      recheckDisk: () => 'absent',
      loadBody: () => [{ role: 'user', content: 'hi' }],
    }),
    'flushed-to-disk',
  );
});

it('leaves an already-tombstoned chat alone', () => {
  assert.equal(
    decideExternalDelete({
      chatId: 'Already Gone',
      snapshot: new Set(),
      record: { dirty: false, tombstone: true },
      recheckDisk: () => { throw new Error('must not re-check a tombstone'); },
    }),
    'noop',
  );
});

it('skips the whole decision for a chat present in the snapshot', () => {
  assert.equal(
    decideExternalDelete({
      chatId: 'Some Older Chat',
      snapshot: new Set(['Some Older Chat']),
      record: { dirty: false, tombstone: false },
      recheckDisk: () => { throw new Error('no re-check needed'); },
    }),
    'noop',
  );
});

// ---------------------------------------------------------------------------
// The model above is only worth anything if it still matches the shipped code.
// These assertions read LocalFSContext.tsx directly and fail if the live
// re-check is removed, or moved after the tombstone it exists to prevent.
// ---------------------------------------------------------------------------

const CONTEXT_SOURCE = path.join(
  import.meta.dirname, '..', '..', '..',
  'platform', 'storage', 'src', 'local-fs', 'LocalFSContext.tsx',
);

/** The external-delete loop: from its comment to the end of its tombstone write. */
const externalDeleteBlock = () => {
  const source = fs.readFileSync(CONTEXT_SOURCE, 'utf8');
  const start = source.indexOf('for (const chatId of [...localChatsRef.current]) {');
  assert.notEqual(start, -1, 'could not locate the external-delete loop');
  const end = source.indexOf("willow_chat_body_updated', { detail: { chatId, deleted: true }", start);
  assert.notEqual(end, -1, 'could not locate the end of the external-delete loop');
  return source.slice(start, end);
};

it('re-checks disk before tombstoning, in the shipped source', () => {
  const block = externalDeleteBlock();

  const recheck = block.indexOf('await chatsDir.getFileHandle(');
  const tombstone = block.indexOf('tombstone: true');

  assert.notEqual(recheck, -1,
    'the live disk re-check is gone — a chat saved during a reconcile will be erased again');
  assert.notEqual(tombstone, -1, 'could not find the tombstone write');
  assert.ok(recheck < tombstone,
    'the re-check must come BEFORE the tombstone, or it cannot prevent the deletion');
});

it('only accepts NotFoundError as proof of deletion, in the shipped source', () => {
  const block = externalDeleteBlock();
  assert.match(block, /NotFoundError/,
    'without the NotFoundError guard, a permission error reads as a deletion');
});

it('still guards the dirty-with-unreadable-body case, in the shipped source', () => {
  const block = externalDeleteBlock();
  const dirtyGuard = block.indexOf('if (!body) {');
  const tombstone = block.indexOf('tombstone: true');
  assert.notEqual(dirtyGuard, -1, 'the unreadable-body guard is gone');
  assert.ok(dirtyGuard < tombstone, 'the unreadable-body guard must precede the tombstone');
});
