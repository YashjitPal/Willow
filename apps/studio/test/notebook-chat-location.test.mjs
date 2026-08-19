/**
 * Regression tests: a chat file now has a *location*, and moving it must never
 * destroy the conversation.
 *
 * Before notebooks were on disk, `Chats/<chatId>.json` was the only place a chat
 * could be, and `reconcileChatsWithDisk` treated "in the chat index, not in that
 * one directory" as an external delete — it tombstoned the chat and reaped its
 * body from IndexedDB. Filing a chat into a notebook moves its file out of that
 * directory, so with the old reconciler every filing was a data-loss bug on a
 * 3-second timer.
 *
 * Three decisions carry the whole scheme, and each has exactly one failure mode:
 *
 *   1. The location tie-break (`locationDirty` = complete the move, clean = adopt
 *      what disk says). Get it wrong and a file ping-pongs between two folders on
 *      every poll, or the user's own Explorer move is silently undone.
 *   2. The external-delete pass, which must now disbelieve an absence until every
 *      scanned folder has been probed, and must skip entirely while a notebook
 *      rename is copying files (invariants 5 and 13).
 *   3. Folder naming, which must be stable — a name that re-derives differently
 *      after an unrelated edit points the reconciler at a folder that holds
 *      another notebook's chats.
 *
 * Two layers, following `chat-reconcile-race.test.mjs`: faithful models of
 * decisions that live inline in React callbacks and cannot be imported, plus
 * source assertions that keep the fix from being refactored away. The folder-name
 * models are fed the illegal-character class, the reserved-name list and the
 * length cap **read out of the shipped source**, so those three cannot drift
 * without this file noticing.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');

const LOCAL_FS = () => read('platform', 'storage', 'src', 'local-fs', 'LocalFSContext.tsx');
const BACKEND = () => read('features', 'notebooks', 'src', 'notebooks-backend.ts');
const NOTEBOOKS_DISK = () => read('platform', 'storage', 'src', 'local-fs', 'notebooks-disk.ts');

// Ordering assertions must run against code only: these files document the
// hazards they guard in prose, so a comment naming a call reads as the call.
const codeOnly = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[^\S\r\n]*\/\/.*$/gm, '');

// ── 1. The location tie-break ────────────────────────────────────────────────

/**
 * Where a chat's file should be, and what to do when it isn't there — the
 * decision at the top of the per-chat reconcile pass, as a pure function.
 *
 * One outcome per branch in the real code, so a name here maps to one place in
 * the source:
 *
 *   'noop'          disk and the record already agree
 *   'moved'         `locationDirty`: the move was completed, the flag cleared
 *   'move-failed'   the move failed; the flag stays set for the next poll
 *   'flag-cleared'  the file was already where the record wanted it
 *   'adopted'       nobody in the app asked, so disk wins and the registry follows
 *
 * `registryOwner` is only consulted when there is **no record**: a record's own
 * `notebookId` is the app's intent and outranks the registry, which is what stops
 * an adoption from being re-fought by the registry on the very next poll.
 */
const decideLocation = ({
  diskNotebookId,
  record,
  registryOwner = '',
  moveSucceeds = true,
}) => {
  const wanted = record ? record.notebookId : (registryOwner || '');
  if (diskNotebookId !== wanted) {
    if (record?.locationDirty) {
      return moveSucceeds ? 'moved' : 'move-failed';
    }
    return 'adopted';
  }
  if (record?.locationDirty) return 'flag-cleared';
  return 'noop';
};

const clean = (notebookId = '') => ({ notebookId, locationDirty: false, tombstone: false });
const dirty = (notebookId = '') => ({ notebookId, locationDirty: true, tombstone: false });

it('adopts a clean chat found in a notebook folder, rather than dragging it back', () => {
  // The user dragged `Chats/foo.json` into `Notebooks/Physics/Chats/` in
  // Explorer. Nothing in the app asked for that, so disk is authoritative for
  // where a file is (invariant 3) and the registry follows the file.
  assert.equal(
    decideLocation({ diskNotebookId: 'nb-physics', record: clean('') }),
    'adopted',
  );

  // And the reverse: dragged back out to the global folder.
  assert.equal(
    decideLocation({ diskNotebookId: '', record: clean('nb-physics') }),
    'adopted',
  );
});

it('completes a pending move without reverting the registry', () => {
  // "Add to notebook" set `notebookId` + `locationDirty` and its own move did not
  // land (no folder connected at the time, or a failed write). The file is still
  // in the global folder. Adopting here would silently unfile the chat the user
  // just filed — the flag is what makes this branch a move instead.
  assert.equal(
    decideLocation({ diskNotebookId: '', record: dirty('nb-physics') }),
    'moved',
  );
});

it('leaves a failed move dirty so the next poll retries it', () => {
  // Same durable-dirty contract content writes have (invariant 11): the intent
  // survives, so an interrupted filing converges instead of being lost.
  assert.equal(
    decideLocation({ diskNotebookId: '', record: dirty('nb-physics'), moveSucceeds: false }),
    'move-failed',
  );
});

it('clears a pending move that some other write already satisfied', () => {
  // `saveLocalFSChat` writes straight into the target folder, so a chat filed and
  // then edited arrives here already moved. Without this branch the flag would
  // stay set forever, and a permanently dirty location is treated as "where this
  // file is, is unknown" by the delete pass — suppressing real deletions.
  assert.equal(
    decideLocation({ diskNotebookId: 'nb-physics', record: dirty('nb-physics') }),
    'flag-cleared',
  );
});

it('files a chat with no record at all from the registry', () => {
  // A chat filed while its file had never been written: there is no record to
  // read an intent from, so the registry is the only thing that knows, and the
  // first write must land in the notebook's folder.
  assert.equal(
    decideLocation({ diskNotebookId: 'nb-physics', record: null, registryOwner: 'nb-physics' }),
    'noop',
  );
  assert.equal(
    decideLocation({ diskNotebookId: '', record: null, registryOwner: 'nb-physics' }),
    'adopted',
  );
});

it('settles in one poll: no location decision ever oscillates', () => {
  /*
   * The property that matters more than any single branch. Feed each outcome's
   * resulting state back in and it must reach 'noop' and stay there — an
   * arrangement that never reaches 'noop' is a file rewritten on every 3-second
   * poll forever (invariant 7), which is exactly what a naive
   * "registry-wins"/"disk-wins" pair produces.
   */
  const cases = [
    { diskNotebookId: 'nb-a', record: clean('') },
    { diskNotebookId: '', record: clean('nb-a') },
    { diskNotebookId: '', record: dirty('nb-a') },
    { diskNotebookId: 'nb-a', record: dirty('nb-a') },
    { diskNotebookId: 'nb-b', record: dirty('nb-a') },
  ];

  for (const start of cases) {
    let { diskNotebookId, record } = start;
    let outcome = '';
    let steps = 0;
    do {
      outcome = decideLocation({ diskNotebookId, record });
      // Apply the outcome exactly as the reconciler does.
      if (outcome === 'moved') {
        diskNotebookId = record.notebookId;
        record = { ...record, locationDirty: false };
      } else if (outcome === 'adopted') {
        record = { ...record, notebookId: diskNotebookId, locationDirty: false };
      } else if (outcome === 'flag-cleared') {
        record = { ...record, locationDirty: false };
      }
      steps += 1;
      assert.ok(steps <= 3,
        `${JSON.stringify(start)} does not settle — the file will be moved on every poll`);
    } while (outcome !== 'noop');
  }
});

// ── 2. The external-delete pass ──────────────────────────────────────────────

/**
 * "This chat is not in the snapshot" → delete, or not.
 *
 * Extends the model in `chat-reconcile-race.test.mjs` with the three things
 * notebooks added. Outcomes:
 *
 *   'noop'            snapshot hit, or already tombstoned
 *   'unaccounted'     the chat's notebook was never enumerated — not evidence
 *   'kept'            found in one of the scanned folders after all
 *   'kept-transient'  a probe failed for a reason other than NotFoundError
 *   'flushed-to-disk' dirty or location-dirty with a readable body
 *   'retry-later'     dirty/location-dirty, body unreadable or write failed
 *   'tombstoned'      destroyed: list entry, timestamp and body all removed
 */
const decideExternalDelete = ({
  chatId,
  snapshot,
  record,
  registryOwner = '',
  /** notebookId -> 'present' | 'absent' | 'error'. `''` is the global folder. */
  probe = {},
  /** Notebook ids whose folder could not be opened this pass. */
  unreadableNotebooks = new Set(),
  /** notebookId -> folderName, i.e. the notebooks the registry can name. */
  folderByNotebookId = {},
  loadBody = () => null,
  writeSucceeds = true,
}) => {
  if (snapshot.has(chatId)) return 'noop';
  if (record?.tombstone) return 'noop';

  const wanted = record ? record.notebookId : (registryOwner || '');
  if (wanted && (unreadableNotebooks.has(wanted) || !folderByNotebookId[wanted])) {
    return 'unaccounted';
  }

  // Every scanned folder, not just the expected one.
  for (const result of Object.values(probe)) {
    if (result === 'present') return 'kept';
    // A failure says nothing about the folders not yet probed either, so the
    // whole decision is abandoned rather than the sweep continued.
    if (result !== 'absent') return 'kept-transient';
  }

  if (record?.dirty || record?.locationDirty) {
    if (!loadBody(chatId)) return 'retry-later';
    return writeSucceeds ? 'flushed-to-disk' : 'retry-later';
  }

  return 'tombstoned';
};

it('tombstones only when the chat is absent from every scanned folder', () => {
  const base = {
    chatId: 'Photosynthesis Notes',
    snapshot: new Set(),
    record: { ...clean(''), dirty: false },
    folderByNotebookId: { 'nb-physics': 'Physics' },
  };

  // Present in a notebook's folder while the record says global: a move to
  // adopt on the next scan, never a delete. Probing only `Chats/` — the old
  // single-directory behaviour — reaches 'tombstoned' here instead.
  assert.equal(
    decideExternalDelete({ ...base, probe: { '': 'absent', 'nb-physics': 'present' } }),
    'kept',
  );

  // Genuinely gone from all of them: the behaviour the pass exists for.
  assert.equal(
    decideExternalDelete({ ...base, probe: { '': 'absent', 'nb-physics': 'absent' } }),
    'tombstoned',
  );
});

it('keeps a chat absent from the snapshot but present at re-probe', () => {
  // The snapshot is taken once at the top of the reconcile and the decision is
  // reached seconds later. A chat written in that window — the AI title rename
  // is exactly one — is present on disk and absent from the snapshot.
  assert.equal(
    decideExternalDelete({
      chatId: 'Freshly Renamed',
      snapshot: new Set(['Some Older Chat']),
      record: { ...clean(''), dirty: false },
      probe: { '': 'present' },
    }),
    'kept',
  );
});

it('does not read an unreadable or unnamed notebook as a deletion', () => {
  const base = {
    chatId: 'Inside A Notebook',
    snapshot: new Set(),
    record: { ...clean('nb-physics'), dirty: false },
    probe: { '': 'absent' },
  };

  // The folder was renamed by hand in a file manager, so it could not be opened
  // and its files were never looked at.
  assert.equal(
    decideExternalDelete({
      ...base,
      unreadableNotebooks: new Set(['nb-physics']),
      folderByNotebookId: { 'nb-physics': 'Physics' },
    }),
    'unaccounted',
  );

  // Or the registry entry vanished without its chats being unfiled first — a
  // notebook deleted while no folder was connected. Unaccounted for is not
  // deleted; treating either as one erases every chat in the notebook.
  assert.equal(
    decideExternalDelete({ ...base, folderByNotebookId: {} }),
    'unaccounted',
  );
});

it('flushes a location-dirty chat to disk instead of erasing it', () => {
  // A pending move means where the file is right now is unknown *by
  // construction*, so absence from the folders this pass could read is not
  // evidence. Writing the cached body to the wanted folder saves the
  // conversation and converges the state in one step.
  const base = {
    chatId: 'Move Never Landed',
    snapshot: new Set(),
    record: { ...dirty('nb-physics'), dirty: false },
    folderByNotebookId: { 'nb-physics': 'Physics' },
    probe: { '': 'absent', 'nb-physics': 'absent' },
  };

  assert.equal(
    decideExternalDelete({ ...base, loadBody: () => [{ role: 'user', content: 'hi' }] }),
    'flushed-to-disk',
  );

  // An unreadable body or a failed write is a retry, never a tombstone.
  assert.equal(decideExternalDelete({ ...base, loadBody: () => null }), 'retry-later');
  assert.equal(
    decideExternalDelete({
      ...base,
      loadBody: () => [{ role: 'user', content: 'hi' }],
      writeSucceeds: false,
    }),
    'retry-later',
  );
});

/**
 * The rename guard, as the pass's own early return.
 *
 * A notebook rename is a recursive copy followed by a recursive delete, so for
 * its whole duration every chat inside is in two places or in neither. The
 * settle window covers the observer events that arrive just after the last write.
 */
const runDeletePass = ({ renameOps, settleUntil, now, missingChats }) => {
  if (renameOps > 0 || now < settleUntil) return { deletions: 0, skipped: true };
  return { deletions: missingChats.length, skipped: false };
};

it('performs zero deletions while a notebook rename is in flight', () => {
  const missingChats = ['a', 'b', 'c'];

  // Mid-copy: the source folder's files are half-gone from where the scan looked.
  assert.deepEqual(
    runDeletePass({ renameOps: 1, settleUntil: 0, now: 1_000, missingChats }),
    { deletions: 0, skipped: true },
  );

  // And after it returns, for the settle window — the last observer events have
  // not arrived yet.
  assert.deepEqual(
    runDeletePass({ renameOps: 0, settleUntil: 1_800, now: 1_000, missingChats }),
    { deletions: 0, skipped: true },
  );

  // Once both are clear the pass runs normally: the guard suppresses deletions,
  // it does not disable them.
  assert.deepEqual(
    runDeletePass({ renameOps: 0, settleUntil: 1_800, now: 1_800, missingChats }),
    { deletions: 3, skipped: false },
  );
});

// ── 3. Folder names ──────────────────────────────────────────────────────────

/*
 * The rules are pure functions in `notebooks-backend.ts`, but the test runner is
 * plain `node --test` over `.mjs` with no TypeScript loader, so they cannot be
 * imported. The three pieces of DATA they turn on are read out of the source
 * instead, so the models below cannot pass against a source that changed them.
 */
const folderNameRules = () => {
  const source = BACKEND();

  const illegal = source.match(/const ILLEGAL_FOLDER_CHARS = \/(.+?)\/g;/);
  assert.ok(illegal, 'could not locate ILLEGAL_FOLDER_CHARS');

  const reservedBlock = source.match(/const RESERVED_DEVICE_NAMES = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(reservedBlock, 'could not locate RESERVED_DEVICE_NAMES');

  const maxLength = source.match(/const MAX_FOLDER_NAME_LENGTH = (\d+);/);
  assert.ok(maxLength, 'could not locate MAX_FOLDER_NAME_LENGTH');

  return {
    illegalChars: new RegExp(illegal[1], 'g'),
    reserved: new Set([...reservedBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1])),
    maxLength: Number(maxLength[1]),
  };
};

const RULES = folderNameRules();
const UNTITLED = 'Untitled notebook';

/** A model of `sanitizeFolderSegment`, driven by the rules read above. */
const sanitizeFolderSegment = (title) => {
  const cleaned = (title || '')
    .replace(RULES.illegalChars, '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim()
    .slice(0, RULES.maxLength)
    .replace(/[. ]+$/, '')
    .trim();
  if (!cleaned) return UNTITLED;
  const stem = cleaned.split('.')[0].toUpperCase();
  return RULES.reserved.has(stem) ? `${cleaned}_` : cleaned;
};

/** A model of `deriveNotebookFolderName`. */
const deriveNotebookFolderName = (notebook, notebooks) => {
  const taken = new Set();
  for (const other of notebooks) {
    if (other.id === notebook.id || !other.fsFolder) continue;
    taken.add(other.fsFolder.toLowerCase());
  }
  const base = sanitizeFolderSegment(notebook.title);
  let name = base;
  let suffix = 2;
  while (taken.has(name.toLowerCase())) {
    name = `${base} (${suffix})`;
    suffix += 1;
  }
  return name;
};

/** A model of `ensureNotebookFolderName`: assign once, then never re-derive. */
const ensureNotebookFolderName = (notebookId, notebooks) => {
  const notebook = notebooks.find((entry) => entry.id === notebookId);
  if (!notebook) return '';
  if (notebook.fsFolder) return notebook.fsFolder;
  notebook.fsFolder = deriveNotebookFolderName(notebook, notebooks);
  return notebook.fsFolder;
};

it('turns an illegal title into one legal path segment', () => {
  // A path separator is the dangerous one: left in, the "folder name" becomes two
  // directories and every lookup by the stored name misses.
  assert.equal(sanitizeFolderSegment('Physics/Chem: notes?'), 'PhysicsChem notes');
  assert.equal(sanitizeFolderSegment('a\\b*c"d<e>f|g'), 'abcdefg');

  // Windows silently DROPS a trailing dot or space when creating a directory, so
  // a folder asked for as "Notes." comes back as "Notes" and the mirror
  // re-creates it on every poll.
  assert.equal(sanitizeFolderSegment('Notes.'), 'Notes');
  assert.equal(sanitizeFolderSegment('Notes   '), 'Notes');

  // Truncation can itself leave a trailing space, so the strip must run after it.
  const long = `${'a'.repeat(RULES.maxLength - 1)} bcdef`;
  const truncated = sanitizeFolderSegment(long);
  assert.ok(truncated.length <= RULES.maxLength, 'the length cap is not applied');
  assert.ok(!/[. ]$/.test(truncated),
    'truncation left a trailing space — Windows will drop it and the name will never match');

  // Nothing legal left, and a title that is only whitespace.
  assert.equal(sanitizeFolderSegment('///'), UNTITLED);
  assert.equal(sanitizeFolderSegment('   '), UNTITLED);
  assert.equal(sanitizeFolderSegment(''), UNTITLED);
});

it('escapes a reserved device name, in any casing and with an extension', () => {
  // A notebook titled "NUL" cannot be created on Windows at all, and would fail
  // every write silently and forever.
  for (const title of ['NUL', 'nul', 'CON', 'com1', 'LPT9']) {
    const name = sanitizeFolderSegment(title);
    assert.notEqual(name.toUpperCase(), title.toUpperCase(),
      `"${title}" is a reserved device name and was left unescaped`);
    assert.ok(name.startsWith(title), `"${title}" should be suffixed, not rewritten`);
  }
  // Reserved even with an extension, so the stem is what gets tested.
  assert.equal(sanitizeFolderSegment('nul.txt'), 'nul.txt_');
  // And a name that merely starts with one is fine.
  assert.equal(sanitizeFolderSegment('Console'), 'Console');
});

it('gives two identically titled notebooks two different folders', () => {
  // `createNotebook` deliberately mints two "Untitled notebook"s, matching
  // Gemini. Both resolving to one folder means one notebook collecting the
  // other's sources and chats.
  const notebooks = [
    { id: 'nb-1', title: 'Physics' },
    { id: 'nb-2', title: 'Physics' },
    { id: 'nb-3', title: 'physics' },
  ];

  assert.equal(ensureNotebookFolderName('nb-1', notebooks), 'Physics');
  assert.equal(ensureNotebookFolderName('nb-2', notebooks), 'Physics (2)');
  // The COMPARISON is case-insensitive, because the target filesystems are:
  // "physics" and "Physics" are one directory on Windows and on a default macOS,
  // so the third notebook must still be suffixed. The name itself keeps the
  // title's own casing — the folder is the user's to look at.
  assert.equal(ensureNotebookFolderName('nb-3', notebooks), 'physics (3)');

  const assigned = notebooks.map((n) => n.fsFolder.toLowerCase());
  assert.equal(new Set(assigned).size, notebooks.length,
    'two notebooks were assigned the same folder, case-insensitively');
});

it('never re-derives a folder name once assigned', () => {
  /*
   * The load-bearing property, and the reason `fsFolder` is stored at all.
   * Dedup runs against names already handed out, so a name derived from the whole
   * list every time is not stable: rename the first of two "Physics" notebooks
   * and the second's derived name silently changes from `Physics (2)` to
   * `Physics`, while its folder — and every chat inside it — is still where it
   * was.
   */
  const notebooks = [
    { id: 'nb-1', title: 'Physics', updatedAt: 1 },
    { id: 'nb-2', title: 'Physics', updatedAt: 2 },
  ];
  ensureNotebookFolderName('nb-1', notebooks);
  ensureNotebookFolderName('nb-2', notebooks);

  // An unrelated edit: a message sent, a source added, a pin toggled.
  notebooks[0].updatedAt = 999;
  notebooks[1].updatedAt = 1000;
  assert.equal(ensureNotebookFolderName('nb-1', notebooks), 'Physics');
  assert.equal(ensureNotebookFolderName('nb-2', notebooks), 'Physics (2)');

  // And the hard case: the first notebook is renamed away entirely. The second
  // must keep `Physics (2)` even though `Physics` is now free.
  notebooks[0].title = 'Chemistry';
  assert.equal(ensureNotebookFolderName('nb-2', notebooks), 'Physics (2)',
    'the second notebook re-derived its name and now points at the wrong folder');
});

// ---------------------------------------------------------------------------
// The models above are only worth anything if they still match shipped code.
// ---------------------------------------------------------------------------

/** The per-chat reconcile body, where the location decision lives. */
const reconcileEntryBlock = () => {
  const source = LOCAL_FS();
  const start = source.indexOf('const reconcileEntry = async (');
  assert.notEqual(start, -1, 'could not locate the per-chat reconcile body');
  const end = source.indexOf('for (const chatId of [...localChatsRef.current]) {', start);
  assert.notEqual(end, -1, 'could not locate the end of the per-chat pass');
  return source.slice(start, end);
};

it('settles location before content, in the shipped source', () => {
  const block = codeOnly(reconcileEntryBlock());

  // Which folder the file is in decides which folder the content work writes to,
  // so a content write that ran first would land in the old folder and be moved
  // out from under itself.
  const location = block.indexOf('const wantedNotebookId =');
  const contentWrite = block.indexOf('writeFileRecursively(');
  assert.notEqual(location, -1, 'the location tie-break is gone from the reconcile');
  assert.notEqual(contentWrite, -1, 'could not locate the content write');
  assert.ok(location < contentWrite,
    'content is reconciled before location — a write will land in the folder being left');
});

it('reads the wanted location from the record, not the registry, in the shipped source', () => {
  const block = codeOnly(reconcileEntryBlock());

  /*
   * `record ? record.notebookId : chatOwner[chatId]` — the record outranks the
   * registry whenever there is one. Reading the registry first would re-fight
   * every adoption: the reconciler adopts disk's location, and then the next poll
   * would read the registry (not yet updated, or updated by another tab) and move
   * the file straight back.
   */
  assert.match(block, /record \? record\.notebookId : \(notebookIndex\.chatOwner\[chatId\] \|\| ''\)/,
    'the wanted location no longer prefers the record — adoptions will oscillate');
});

it('completes a dirty move and adopts a clean one, in the shipped source', () => {
  const block = codeOnly(reconcileEntryBlock());

  const dirtyBranch = block.indexOf('if (record?.locationDirty) {');
  const adopt = block.indexOf('adoptChatIntoNotebook(chatId, disk.notebookId');
  assert.notEqual(dirtyBranch, -1,
    'the locationDirty branch is gone — a pending move will unfile the chat instead');
  assert.notEqual(adopt, -1,
    'the adopt path is gone — a chat moved in Explorer will be dragged back');
  assert.ok(dirtyBranch < adopt,
    'adopt runs before the locationDirty check, so the app\'s own move reverts the registry');

  // A copy-then-delete move strands the old handle and gives the file a new
  // mtime; without both re-reads the content pass reads nothing and every later
  // poll sees an external edit (invariant 7).
  const moveBlock = block.slice(dirtyBranch, adopt);
  assert.match(moveBlock, /getFileHandle\(`\$\{chatId\}\.json`\)/,
    'the moved file\'s handle is not re-resolved — the content pass will read a deleted file');
  assert.match(moveBlock, /lastModified/,
    'the moved file\'s mtime is not re-read — every poll will read the move as an edit');
  assert.match(moveBlock, /locationDirty: false/,
    'a completed move does not clear its flag, so it will be retried forever');
});

/** The external-delete loop, from its first line to its tombstone write. */
const deletePassBlock = () => {
  const source = LOCAL_FS();
  const start = source.indexOf('for (const chatId of [...localChatsRef.current]) {');
  assert.notEqual(start, -1, 'could not locate the external-delete loop');
  const end = source.indexOf('tombstone: true', start);
  assert.notEqual(end, -1, 'could not locate the tombstone write');
  return source.slice(start, end);
};

it('guards the delete pass with the notebook rename counter, in the shipped source', () => {
  const source = codeOnly(LOCAL_FS());

  // The guard must sit BEFORE the loop, not inside it: a rename that starts
  // mid-loop is still covered by the settle window on the next pass, but a check
  // per iteration would let the iterations before it delete.
  const guard = source.indexOf('notebookRenameOpsRef.current > 0 || Date.now() < notebookRenameSettleUntilRef.current');
  const loop = source.indexOf('for (const chatId of [...localChatsRef.current]) {');
  assert.notEqual(guard, -1,
    'the notebook-rename guard is gone — a rename will tombstone every chat in the notebook');
  assert.ok(guard < loop,
    'the rename guard sits after the delete loop, so it cannot suppress the deletions');

  // It must return, not `break` out of a half-updated state, and it must still
  // persist what the passes above it changed.
  const guardBody = source.slice(guard, guard + 200);
  assert.match(guardBody, /persistChatMetadata\(\);\s*\r?\n\s*return;/,
    'the rename guard no longer persists the work already done before returning');
});

it('treats an unaccounted-for notebook as not-deleted, in the shipped source', () => {
  const block = codeOnly(deletePassBlock());

  const unaccounted = block.indexOf('unreadableNotebooks.has(wanted)');
  assert.notEqual(unaccounted, -1,
    'the unaccounted-for-notebook guard is gone — an unreadable folder will erase its chats');
  assert.match(block.slice(unaccounted, unaccounted + 160), /!notebookIndex\.folderByNotebookId\[wanted\]/,
    'a notebook the registry can no longer name is treated as a deletion');
});

it('protects locationDirty exactly as it protects dirty, in the shipped source', () => {
  const block = codeOnly(deletePassBlock());

  // The flush covers both flags: a pending move means the file's whereabouts are
  // unknown by construction, so an absence proves nothing.
  assert.match(block, /if \(record\?\.dirty \|\| record\?\.locationDirty\) \{/,
    'locationDirty no longer earns the dirty flag\'s protection — an unlanded move can be tombstoned');

  // And the flush must go to the WANTED folder, creating it — otherwise the
  // rescue writes the body back into the folder the chat is leaving.
  assert.match(block, /resolveChatDir\(workspaceDir, wanted, \{ create: true \}\)/,
    'the rescue flush no longer targets the wanted folder');
});

// ── 4. The backfill ─────────────────────────────────────────────────────────

/** The `backfillNotebooksToDisk` body. */
const backfillBlock = () => {
  const source = LOCAL_FS();
  const start = source.indexOf('const backfillNotebooksToDisk = useCallback(');
  assert.notEqual(start, -1, 'could not locate backfillNotebooksToDisk');
  const end = source.indexOf('const moveLocalFSChatToNotebook = useCallback(', start);
  assert.notEqual(end, -1, 'could not locate the end of the backfill');
  return source.slice(start, end);
};

it('runs the backfill after the chat reconcile, never before it', () => {
  const source = codeOnly(LOCAL_FS());
  const poll = source.indexOf('const pollDiskNow = useCallback(');
  assert.notEqual(poll, -1, 'could not locate pollDiskNow');
  const body = source.slice(poll, poll + 1200);

  const reconcile = body.indexOf('await refreshLocalChats();');
  const backfill = body.indexOf('await backfillNotebooksToDisk(workspaceDir);');
  assert.notEqual(reconcile, -1, 'the poll no longer reconciles chats');
  assert.notEqual(backfill, -1, 'the poll no longer runs the notebook backfill');
  assert.ok(reconcile < backfill,
    'the backfill runs before the reconcile, so it will fight the reconcile\'s adoptions');
});

it('backfills only in the registry -> record direction', () => {
  const block = codeOnly(backfillBlock());

  /*
   * It files chats the registry says are filed. It must never unfile one because
   * the registry does not mention it: a registry that reads as empty — a scope
   * switch mid-poll, a cleared localStorage — would then move every notebook
   * chat back to the global folder (invariant 5 applied to moves). The reverse
   * direction belongs to the reconciler, which acts on files it actually found.
   */
  assert.match(block, /readNotebookChatIndex\(\)/,
    'the backfill no longer reads the chat index');
  assert.ok(!/adoptChatIntoNotebook|notebookId: ''/.test(block),
    'the backfill can now unfile a chat — a transiently empty registry will unfile everything');

  // It records the intent and lets the reconciler move the file, because
  // `record.notebookId` is the field this pass exists to correct and so cannot
  // also be trusted as the move's source folder.
  assert.match(block, /locationDirty: true/,
    'the backfill no longer marks a pending move');
  assert.ok(!/moveFileBetweenDirs|moveLocalFSChatToNotebook/.test(block),
    'the backfill moves files itself, using the very location field it is correcting');
});

it('keeps the backfill change-only, since it runs on every poll', () => {
  const block = codeOnly(backfillBlock());

  // Each half is guarded by the absence of the thing it writes, so a workspace
  // already in the target shape performs no writes, fires no events and
  // re-renders nothing (invariant 7). This runs every 3 seconds.
  assert.match(block, /if \(notebook\.fsFolder\) continue;/,
    'the backfill re-ensures every notebook folder on every poll');
  assert.match(block, /if \(source\.fsName\) continue;/,
    'the backfill rewrites every source file on every poll');
  assert.match(block, /if \(record\.notebookId === notebookId \|\| record\.locationDirty\) continue;/,
    'the backfill restates a pending move on every poll, resetting updatedAt each time');

  // A source with nothing to write is skipped rather than written as an empty
  // file named after someone's document.
  assert.match(block, /if \(!blob && !source\.content\?\.trim\(\) && !source\.url\) continue;/,
    'a bodyless source is now written as a 0-byte file named after a real document');

  // And it stands down while folder names are in motion.
  assert.match(block, /notebookRenameOpsRef\.current > 0 \|\| Date\.now\(\) < notebookRenameSettleUntilRef\.current/,
    'the backfill can now write into a folder a rename is deleting');
});

// ── 5. Paths are spelled once ───────────────────────────────────────────────

it('resolves every chat directory through one function', () => {
  const source = codeOnly(LOCAL_FS());

  // A chat written to a folder nobody scans is unrecoverable, and that is what
  // two modules spelling a path separately eventually produces.
  assert.match(source, /const resolveChatDir = useCallback\(/,
    'resolveChatDir is gone — chat directories are being spelled inline again');
  const hardcoded = [...source.matchAll(/getDirectoryHandle\(\s*'Chats'/g)];
  assert.equal(hardcoded.length, 0,
    `${hardcoded.length} call sites still hardcode the 'Chats' folder instead of resolveChatDir`);
});

it('imports the directory names rather than re-spelling them', () => {
  const disk = NOTEBOOKS_DISK();
  assert.match(disk, /import \{[\s\S]*?NOTEBOOKS_DIR_NAME[\s\S]*?\} from '@willow\/notebooks\/notebooks-backend'/,
    'notebooks-disk spells the Notebooks folder itself instead of importing the name');

  for (const name of ['NOTEBOOK_SOURCES_DIR_NAME', 'NOTEBOOK_CHATS_DIR_NAME']) {
    assert.match(disk, new RegExp(name),
      `${name} is no longer used — a sub-folder name is being spelled inline`);
  }
});

it('refuses a notebook folder whose manifest claims a different notebook', () => {
  const disk = NOTEBOOKS_DISK();

  // A hand-renamed folder that happens to land on another notebook's name would
  // otherwise quietly collect that notebook's sources and chats alongside the
  // ones already inside. The id in the manifest is the evidence; the derived
  // name is a guess.
  const ensure = disk.match(/export const ensureNotebookDirIn = async \([\s\S]*?\n\};/);
  assert.ok(ensure, 'could not locate ensureNotebookDirIn');
  assert.match(ensure[0], /existing\.id !== notebookId\) return null/,
    'a folder claiming a different notebook id is written into instead of refused');
});

it('never deletes a notebook folder that still holds chats', () => {
  const disk = NOTEBOOKS_DISK();

  // Deleting a notebook is a grouping decision, not a decision to delete
  // conversations. Refusing here is what keeps a mistake in the caller from
  // being unrecoverable.
  const del = disk.match(/export const deleteNotebookFolder = async \([\s\S]*?\n\};/);
  assert.ok(del, 'could not locate deleteNotebookFolder');
  const chatsProbe = del[0].indexOf('NOTEBOOK_CHATS_DIR_NAME');
  const remove = del[0].indexOf('removeEntry(folderName');
  assert.notEqual(chatsProbe, -1,
    'deleteNotebookFolder no longer checks Chats/ — deleting a notebook will delete conversations');
  assert.ok(chatsProbe < remove,
    'the Chats/ check runs after the removal, so it cannot prevent anything');
  assert.match(del[0].slice(chatsProbe, remove), /return false/,
    'a non-empty Chats/ no longer aborts the delete');
});

it('copies a chat file before removing the original', () => {
  const disk = NOTEBOOKS_DISK();

  // The ordering is the whole point: an interruption leaves the file readable in
  // its old home and the reconciler finishes the job on the next poll.
  const move = disk.match(/export const moveFileBetweenDirs = async \([\s\S]*?\n\};/);
  assert.ok(move, 'could not locate moveFileBetweenDirs');
  const copy = move[0].indexOf('pipeTo(writable)');
  const remove = move[0].indexOf('fromDir.removeEntry(fileName)');
  assert.notEqual(copy, -1, 'the copy fallback is gone');
  assert.ok(copy < remove,
    'the original is removed before the copy completes — an interrupted move loses the chat');

  // A failed copy must clean up its own partial file and leave the original.
  assert.match(move[0], /toDir\.removeEntry\(fileName\)/,
    'a failed copy leaves a truncated file behind in the target folder');
});
