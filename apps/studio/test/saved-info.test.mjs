/**
 * Regression tests: Saved Info — the instructions the user tells Willow to
 * remember, and the guarantee that they actually reach a turn.
 *
 * The feature existed as a screen long before it existed as a feature: the
 * settings page wrote `localStorage['willow-saved-instructions']` and NOTHING
 * read it back, so every instruction typed there was decoration. That is the
 * central thing pinned here — the settings page and the prompt builder must
 * agree on one store, because they are the two halves that were disconnected.
 *
 * The block's shape is Gemini's, taken off its own prompt: a `# Saved
 * Information` heading, a one-line framing that grants permission rather than
 * issuing an order, and `- [YYYY-MM-DD] text` entries newest first.
 *
 * Where they are stored is the other half. These are the user's own words about
 * themselves, so they go in the folder they chose for their data — a `Personal/`
 * folder beside `Chats/`, `Code/` and `Media/` — rather than being trapped in
 * this browser's storage. localStorage stays as a mirror, because a prompt is
 * built synchronously and a directory handle is not.
 *
 * Behaviour tests where the behaviour runs (the store and the builder are plain
 * modules), source assertions only where the guarantee is about which
 * expression gates what inside a React component.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';

import { importTs } from './ts-module.mjs';

const appDir = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(appDir, '..', '..');

const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
const SAVED_INFO_TAB = () => read('apps', 'studio', 'src', 'settings', 'tabs', 'saved-info', 'SavedInfoTab.tsx');
const CHAT_VIEW = () => read('features', 'chat', 'src', 'ChatView.tsx');

// These files explain in prose what they removed, quoting the very strings the
// absence checks look for. A comment would otherwise fail an assertion that the
// code is clean.
const codeOnly = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/^[^\S\r\n]*\/\/.*$/gm, '');

const storeModule = path.join(repoRoot, 'platform', 'core', 'src', 'saved-info-store.ts');
const chatModelModule = path.join(repoRoot, 'features', 'chat', 'src', 'chat-model.ts');
const diskModule = path.join(repoRoot, 'platform', 'storage', 'src', 'local-fs', 'saved-info-disk.ts');

const entry = (text, createdAt) => ({ id: text, text, ...(createdAt ? { createdAt } : {}) });

// ── 1. No personal data ships ────────────────────────────────────────────────

it('ships no seed instructions at all', async () => {
  const { SAVED_INFO_DEFAULTS } = await importTs(storeModule);

  // A fresh profile that already "remembers" facts about a stranger is worse
  // than one that remembers nothing. This file used to ship thirty entries
  // carrying one real person's name, birthdate and two email addresses.
  assert.deepEqual(SAVED_INFO_DEFAULTS.instructions, [],
    'saved info ships seed entries — a fresh install would start out personalized to someone else');

  const tab = codeOnly(SAVED_INFO_TAB());
  assert.ok(!/DEFAULT_INSTRUCTIONS/.test(tab),
    'the hardcoded instruction list is back in the settings tab');

  // The specific classes of thing that were in it. Not an exhaustive privacy
  // check — a tripwire for the exact array being pasted back.
  for (const leak of [/@gmail\.com/, /@go\.sfcollege\.edu/, /born on \d/i]) {
    assert.ok(!leak.test(tab), `personal data is back in the settings tab: ${leak}`);
  }
});

// ── 2. One store, read by both halves ────────────────────────────────────────

it('reads and writes through the shared store, not component state', () => {
  const tab = codeOnly(SAVED_INFO_TAB());

  // The whole point. A chat turn is nowhere near this component, so anything
  // held in useState here is unreachable from a prompt.
  assert.match(tab, /from '@willow\/core\/saved-info-store'/,
    'the settings tab no longer reads the shared store — its instructions cannot reach a chat turn');
  assert.match(tab, /useStore\(savedInfoStore\)/,
    'the settings tab does not subscribe to the store, so it will not re-render on a change');

  for (const writer of [
    'addSavedInstruction',
    'updateSavedInstruction',
    'removeSavedInstruction',
    'clearSavedInstructions',
    'setSavedInfoEnabled',
  ]) {
    assert.ok(tab.includes(`${writer}(`), `${writer} is not called — that edit path writes nowhere`);
  }

  // The toggle was local useState, so turning saved info off survived exactly
  // until the next reload and never reached the prompt at all.
  assert.ok(!/useState\(true\)/.test(tab),
    'the enable toggle is local state again — it will not persist and the prompt will ignore it');

  // The legacy key must not be written any more, or two sources of truth drift.
  assert.ok(!/'willow-saved-instructions'/.test(tab),
    'the settings tab writes the old standalone key again');
});

it('keys rows by id, because new entries are prepended', () => {
  const tab = codeOnly(SAVED_INFO_TAB());

  // Array index is the wrong key here specifically: adds go to the FRONT, so
  // every existing index shifts and React reuses the wrong row — an open menu
  // or an in-flight edit lands on someone else's instruction.
  assert.ok(!/key=\{index\}/.test(tab), 'rows are keyed by array index again');
  assert.match(tab, /key=\{inst\.id\}/, 'rows are no longer keyed by a stable id');
  assert.match(tab, /activeMenuId === inst\.id/,
    'the row menu is tracked by index again, so it follows position rather than the instruction');
});

// ── 3. The store itself ──────────────────────────────────────────────────────

it('adds newest first and keeps the original date through an edit', async () => {
  const store = await importTs(storeModule);
  store.clearSavedInstructions();

  store.addSavedInstruction('first');
  store.addSavedInstruction('second');
  assert.deepEqual(store.savedInfoStore.get().instructions.map((e) => e.text), ['second', 'first'],
    'adds are appended rather than prepended — the newest instruction sorts last');

  const [newest] = store.savedInfoStore.get().instructions;
  assert.ok(newest.createdAt, 'a new instruction is saved without a date');

  store.updateSavedInstruction(newest.id, 'second, reworded');
  const edited = store.savedInfoStore.get().instructions.find((e) => e.id === newest.id);
  assert.equal(edited.text, 'second, reworded');
  // Re-dating an edit would promote an old preference above instructions the
  // user has genuinely set since.
  assert.equal(edited.createdAt, newest.createdAt,
    'editing re-dates the entry, which silently reorders it against newer instructions');

  store.removeSavedInstruction(newest.id);
  assert.deepEqual(store.savedInfoStore.get().instructions.map((e) => e.text), ['first']);

  store.clearSavedInstructions();
  assert.deepEqual(store.savedInfoStore.get().instructions, []);
});

it('rejects blank instructions on every write path', async () => {
  const store = await importTs(storeModule);
  store.clearSavedInstructions();

  store.addSavedInstruction('   ');
  assert.equal(store.savedInfoStore.get().instructions.length, 0,
    'a whitespace-only instruction was stored — it would render as an empty bullet in the prompt');

  store.addSavedInstruction('  real  ');
  assert.equal(store.savedInfoStore.get().instructions[0].text, 'real', 'the text is not trimmed');

  const { id } = store.savedInfoStore.get().instructions[0];
  store.updateSavedInstruction(id, '  ');
  assert.equal(store.savedInfoStore.get().instructions[0].text, 'real',
    'an edit to blank wiped the instruction text instead of being refused');

  store.clearSavedInstructions();
});

it('formats the date in local time, and tolerates an entry that has none', async () => {
  const { savedInstructionDate } = await importTs(storeModule);

  const at = new Date(2025, 11, 9, 21, 30);
  assert.equal(savedInstructionDate({ id: 'a', text: 'x', createdAt: at.toISOString() }), '2025-12-09',
    'the date is not rendered in the user\'s own timezone — a 9pm entry can read as tomorrow');

  // Entries migrated from the string-only format have no honest date, and
  // stamping them with today would be a made-up one.
  assert.equal(savedInstructionDate({ id: 'b', text: 'x' }), null);
  assert.equal(savedInstructionDate({ id: 'c', text: 'x', createdAt: 'not a date' }), null,
    'a corrupt date throws or renders as Invalid Date instead of being dropped');
});

// ── 4. The prompt block ──────────────────────────────────────────────────────

it('renders Gemini\'s block shape, and nothing at all when there is nothing to say', async () => {
  const { savedInfoBlock, SAVED_INFO_HEADER } = await importTs(chatModelModule);

  const state = {
    enabled: true,
    instructions: [
      entry('Keep your responses 3 sentences long.', '2025-12-09T18:00:00Z'),
      entry('An instruction saved before dates existed.'),
    ],
  };

  const block = savedInfoBlock(state);
  assert.ok(block.startsWith(SAVED_INFO_HEADER), 'the block no longer leads with the Saved Information header');
  assert.match(block, /^- \[\d{4}-\d{2}-\d{2}\] Keep your responses 3 sentences long\.$/m,
    'dated entries no longer render as `- [YYYY-MM-DD] text`');
  assert.match(block, /^- An instruction saved before dates existed\.$/m,
    'an undated entry no longer renders — it would be silently dropped from the prompt');

  // A permission, not a command. Every instruction the user writes is phrased
  // as an order already; the header is what stops the block as a whole reading
  // as one, and without it "I use Apple Music" gets dragged into a Java answer.
  assert.match(SAVED_INFO_HEADER, /You may use it as general context if explicitly relevant/,
    'the framing no longer grants permission — the model will try to apply every entry to every turn');

  // A header with no entries under it invites the model to announce that it
  // knows nothing about you.
  assert.equal(savedInfoBlock({ enabled: true, instructions: [] }), '',
    'an empty list still emits the header');
  assert.equal(savedInfoBlock({ enabled: false, instructions: state.instructions }), '',
    'the master switch does not suppress the block — turning saved info off does nothing');
});

it('appends saved info to both the text and the voice prompt', async () => {
  const { chatSystemPromptFor, liveSystemPrompt, savedInfoBlock, CHAT_SYSTEM_PROMPT } =
    await importTs(chatModelModule);
  const store = await importTs(storeModule);

  store.clearSavedInstructions();
  store.setSavedInfoEnabled(true);
  store.addSavedInstruction('Please avoid using Emojis in your responses.');

  const now = new Date('2026-08-10T12:00:00Z');
  const line = '- ';

  for (const [label, built] of [
    ['text', chatSystemPromptFor('gemini', { now })],
    // Voice too: "no emojis" is moot in speech, but "keep answers short" and
    // "call me Yashjit" matter MOST out loud, where there is no skimming.
    ['live', liveSystemPrompt({ now })],
  ]) {
    assert.match(built, /# Saved Information/, `${label}: saved info never reaches the prompt`);
    assert.ok(built.includes(`${line}[`), `${label}: the entries are missing from the block`);
    assert.match(built, /Please avoid using Emojis/, `${label}: the instruction text is missing`);

    // Order: base prompt, then saved info, then the date. The guardrails have
    // to sit above the user data they govern.
    const savedAt = built.indexOf('# Saved Information');
    const dateAt = built.indexOf('Current date:');
    assert.ok(savedAt > CHAT_SYSTEM_PROMPT.length - 1 || savedAt > 0, `${label}: block position`);
    assert.ok(savedAt < dateAt, `${label}: saved info now sits after the date line`);
  }

  // `personalize: false` is the temporary-chat path.
  for (const built of [
    chatSystemPromptFor('gemini', { now, personalize: false }),
    liveSystemPrompt({ now, personalize: false }),
  ]) {
    assert.ok(!built.includes('# Saved Information'),
      'a de-personalized turn still carries the user\'s saved instructions');
    assert.match(built, /Current date: Monday, August 10, 2026/,
      'suppressing saved info also dropped the date line');
  }

  // The default is on, so no call site can forget to include it.
  assert.equal(savedInfoBlock().includes('Please avoid using Emojis'), true,
    'the block no longer defaults to reading the store');

  store.clearSavedInstructions();
});

// ── 5. Temporary chat carries nothing personal in ────────────────────────────

it('withholds saved info from a temporary chat', () => {
  const source = codeOnly(CHAT_VIEW());

  // A temporary chat saves nothing out; this is the "in" half. The entries
  // outlive the session, so sending them would make a temporary chat quietly
  // personalized while presenting itself as not.
  assert.match(source, /chatSystemPromptFor\(provider, \{ personalize: !isIncognito \}\)/,
    'a temporary text turn is personalized again');
  assert.match(source, /liveSystemPrompt\(\{ personalize: !isIncognito \}\)/,
    'a temporary voice session is personalized again');
});

// ── 6. The prompt no longer claims Willow knows nothing ──────────────────────

it('no longer states that Willow holds no user data for a turn to draw on', () => {
  const source = read('features', 'chat', 'src', 'chat-model.ts');

  // This sentence was true and is now false. It explained why the
  // personalization ladder was dropped; the ladder is still dropped, but for a
  // different reason — it governs INFERRED profile data, which is long-term
  // memory's problem, not Saved Info's.
  assert.ok(!/Willow stores no user profile for a turn to draw on/.test(source),
    'the prompt still documents that Willow has no user data, which saved info contradicts');
});

// ── 7. The user's folder is where these actually live ────────────────────────

/**
 * A stand-in for `Personal/saved-info.json`. `file` is the bytes on disk (null
 * when the file does not exist), and the counters are how a test tells a
 * write-through from a no-op.
 */
const fakeDisk = (file = null) => {
  const state = { file, saves: 0, removes: 0, loads: 0 };
  return {
    state,
    adapter: {
      load: async () => { state.loads += 1; return state.file; },
      save: async (next) => { state.file = JSON.parse(JSON.stringify(next)); state.saves += 1; return true; },
      remove: async () => { state.file = null; state.removes += 1; return true; },
    },
  };
};

// Writes are fire-and-forget so a settings toggle never waits on the filesystem.
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

it('writes to the folder the user chose, not just this browser', async () => {
  const store = await importTs(storeModule);
  const disk = fakeDisk();

  store.clearSavedInstructions();
  await store.attachSavedInfoDisk(disk.adapter);

  store.addSavedInstruction('Call me by my first name.');
  await settled();

  // The point of the whole change: an instruction typed in settings lands in the
  // user's own folder, so clearing site data or reinstalling does not lose it.
  assert.equal(disk.state.saves, 1, 'a new instruction never reached the folder');
  assert.deepEqual(disk.state.file.instructions.map((e) => e.text), ['Call me by my first name.']);

  const { id } = store.savedInfoStore.get().instructions[0];
  store.updateSavedInstruction(id, 'Call me by my first name, please.');
  await settled();
  assert.equal(disk.state.file.instructions[0].text, 'Call me by my first name, please.',
    'an edit stayed in memory and left the folder holding the old wording');

  store.setSavedInfoEnabled(false);
  await settled();
  // The toggle is part of what the user set, so it belongs in the file too —
  // otherwise turning saved info off is forgotten by the next machine.
  assert.equal(disk.state.file.enabled, false, 'the master switch is not persisted to the folder');

  store.setSavedInfoEnabled(true);
  store.removeSavedInstruction(id);
  await settled();

  // Nothing saved any more, so the folder keeps no copy of what was just
  // deleted. A file left holding an empty list would read as "still stored".
  assert.equal(disk.state.file, null, 'deleting the last instruction left a stale file behind');
  assert.equal(disk.state.removes, 1);

  await store.attachSavedInfoDisk(null);
});

it('adopts what is already in the folder, and migrates local-only entries into it', async () => {
  const store = await importTs(storeModule);

  store.clearSavedInstructions();

  // Another machine wrote this file. It is the durable copy, so it wins over
  // whatever this browser happens to have cached.
  const existing = fakeDisk({
    version: 1,
    updatedAt: '2026-08-01T10:00:00Z',
    enabled: false,
    instructions: [{ id: 'a', text: 'I prefer metric units.', createdAt: '2026-07-30T09:00:00Z' }],
  });
  store.addSavedInstruction('typed in this browser');
  await store.attachSavedInfoDisk(existing.adapter);

  assert.deepEqual(store.savedInfoStore.get().instructions.map((e) => e.text), ['I prefer metric units.'],
    'the folder\'s copy was ignored in favour of browser storage');
  assert.equal(store.savedInfoStore.get().enabled, false, 'the toggle in the file was not adopted');
  assert.equal(existing.state.saves, 0,
    'adopting the file wrote it straight back, re-stamping updatedAt for no reason');
  assert.equal(store.savedInfoStore.get().instructions[0].createdAt, '2026-07-30T09:00:00Z',
    'the original date did not survive the round trip');

  await store.attachSavedInfoDisk(null);

  // The other direction: instructions typed before a folder was ever connected
  // must not be stranded in localStorage once one is.
  store.clearSavedInstructions();
  store.setSavedInfoEnabled(true);
  store.addSavedInstruction('Saved before any folder existed.');
  const empty = fakeDisk(null);
  await store.attachSavedInfoDisk(empty.adapter);
  await settled();

  assert.equal(empty.state.saves, 1, 'existing instructions were never migrated into the folder');
  assert.deepEqual(empty.state.file.instructions.map((e) => e.text), ['Saved before any folder existed.']);

  // An empty store must not create the file (and so must not create the folder)
  // just because a folder got connected.
  store.clearSavedInstructions();
  await store.attachSavedInfoDisk(null);
  const untouched = fakeDisk(null);
  await store.attachSavedInfoDisk(untouched.adapter);
  await settled();
  assert.equal(untouched.state.saves, 0,
    'connecting a folder with nothing saved still wrote a file, creating a folder unprompted');

  await store.attachSavedInfoDisk(null);
  store.clearSavedInstructions();
});

it('keeps working with no folder connected', async () => {
  const store = await importTs(storeModule);

  await store.attachSavedInfoDisk(null);
  store.clearSavedInstructions();
  store.addSavedInstruction('No folder, still remembered.');

  // Most users have not connected a folder. Saved info cannot depend on one.
  assert.deepEqual(store.savedInfoStore.get().instructions.map((e) => e.text), ['No folder, still remembered.']);

  store.clearSavedInstructions();
});

it('reads and writes one known path under the workspace', async () => {
  const { PERSONAL_DIR, SAVED_INFO_FILE, SAVED_INFO_DISK_VERSION } = await importTs(diskModule);

  // These name a folder the user sees in their file manager, next to Chats,
  // Code and Media. Renaming either orphans every file already written.
  assert.equal(PERSONAL_DIR, 'Personal');
  assert.equal(SAVED_INFO_FILE, 'saved-info.json');
  assert.equal(SAVED_INFO_DISK_VERSION, 1);

  // Comments stripped first: this module documents the create-on-read rule by
  // quoting the very literal these assertions look for.
  const source = codeOnly(read('platform', 'storage', 'src', 'local-fs', 'saved-info-disk.ts'));
  const body = (name) => {
    const at = source.indexOf(`export const ${name} =`);
    assert.ok(at > 0, `${name} is gone from saved-info-disk`);
    const end = source.indexOf('\nexport const ', at + 1);
    return source.slice(at, end === -1 ? undefined : end);
  };

  // The rule this module exists to hold. Creating a workspace folder on a read
  // path is what made every cached chat look externally deleted once before.
  assert.ok(!/create: true/.test(body('readSavedInfoFromDisk')),
    'the read path creates folders again — a missing file will fabricate a workspace');
  assert.ok(!/create: true/.test(body('deleteSavedInfoFromDisk')),
    'the delete path creates the folder it is about to delete from');

  const write = body('writeSavedInfoToDisk');
  for (const created of ['getSanitizedWorkspaceName(), { create: true }', 'PERSONAL_DIR, { create: true }']) {
    assert.ok(write.includes(created),
      `the write path no longer creates ${created} — the first instruction would have nowhere to go`);
  }
});

it('waits for the real workspace name before it can write a folder', () => {
  const source = codeOnly(read('platform', 'storage', 'src', 'local-fs', 'LocalFSContext.tsx'));

  assert.match(source, /attachSavedInfoDisk\(/,
    'the provider no longer points saved info at the local folder');

  const at = source.indexOf('void attachSavedInfoDisk({');
  assert.ok(at > 0, 'the attach call is gone');
  const effect = source.slice(source.lastIndexOf('useEffect(() => {', at), at);

  // getSanitizedWorkspaceName answers "My Willow" until the profile loads, and
  // attaching runs a migration write. Attaching early names a junk folder after
  // the fallback and then syncs into it.
  assert.match(effect, /if \(isAuthLoading\) return;/,
    'saved info attaches while auth is still loading');
  assert.match(effect, /if \(user && !userProfile\) return;/,
    'saved info attaches before the signed-in profile resolves, so it can write to a fallback-named folder');
  assert.match(effect, /!isLocalFolderConnected \|\| !isLocalFolderAuthorized/,
    'saved info attaches without a connected, authorized folder');
});
