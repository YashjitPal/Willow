/**
 * Regression tests: Personal Intelligence — the profile Willow keeps about the
 * user, how it is bounded, and how it reaches a turn.
 *
 * Three things here were expensive to get right and would break silently.
 *
 * There is no memory-writing tool. Gemini's own prompt exposes exactly one
 * personal method, `retrieve_personal_data`, and writing happens offline in
 * `builder/` from conversations that have already finished. A
 * `store_personal_data` counterpart appearing anywhere would mean the model
 * decides what to remember mid-sentence, which is the design that was rejected.
 *
 * The profile is bounded by the section table, not by history length. Four fixed
 * headings with caps of 8/14/6/10 mean someone who has used Willow for a year
 * has the same size profile as someone who has used it for a week. Rebuild, not
 * append, is what keeps that true, so the cap arithmetic is pinned here rather
 * than left to be noticed when a prompt stops fitting.
 *
 * Connecting a product and letting it describe you are separate decisions. Drive
 * and Docs are connectable but never feed the profile, and the Workspace card's
 * five products must be asked for in ONE consent screen — a loop opens five
 * popups and the browser blocks four.
 *
 * Behaviour tests where the behaviour runs (the store, the builder, the prompt
 * builder and the connectors are plain modules), source assertions only where
 * the guarantee is about which expression gates what inside a React component.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';

import { importTs } from './ts-module.mjs';

const appDir = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(appDir, '..', '..');

const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
const personalFile = (...parts) => path.join(repoRoot, 'platform', 'personal', 'src', ...parts);
const settingsTab = (...parts) => read('apps', 'studio', 'src', 'settings', 'tabs', ...parts);

// These files explain in prose what they deliberately do NOT do, quoting the very
// strings the absence checks look for.
const codeOnly = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/^[^\S\r\n]*\/\/.*$/gm, '');

/** Every `.ts` under a directory, so a new file cannot dodge a whole-package check. */
const sourcesUnder = (dir) => {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourcesUnder(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
};

const PERSONAL_SOURCES = sourcesUnder(personalFile());

const autoBullet = (over = {}) => ({
  id: 'auto-1',
  section: 'interests',
  text: 'Prefers short answers',
  source: 'chat history',
  evidence: 'asked for brevity across three conversations',
  origin: 'auto',
  createdAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

/**
 * Reset the two singletons this file shares.
 *
 * `importTs` content-addresses its data URLs, so every test in this file holds
 * the same store instance — which is what makes a mutation test meaningful and
 * also what makes leaking state between tests possible.
 */
const resetProfile = async () => {
  const store = await importTs(personalFile('profile', 'profile-store.ts'));
  store.clearProfile();
  store.setProfileEnabled(true);
  return store;
};

const resetConnections = async () => {
  const store = await importTs(personalFile('connectors', 'connections-store.ts'));
  const { CONNECTORS } = await importTs(personalFile('connectors', 'registry.ts'));
  for (const connector of CONNECTORS) store.disconnect(connector.id);
  return store;
};

/** A TokenSource that always grants, counting how many times it was asked. */
const grantingTokens = () => {
  const calls = [];
  return {
    calls,
    get: async () => 'token',
    request: async (scopes) => {
      calls.push(scopes);
      return 'token';
    },
    invalidate: () => {},
  };
};

// ── 1. No personal data ships ────────────────────────────────────────────────

it('ships an empty profile and no seeded bullets', async () => {
  const { PROFILE_DEFAULTS } = await importTs(personalFile('profile', 'types.ts'));

  // A fresh install that already "remembers" facts about a stranger is worse than
  // one that remembers nothing. The structure of this feature was taken from a
  // real Gemini debug dump; none of its content was.
  assert.deepEqual(PROFILE_DEFAULTS.bullets, [], 'the profile must start empty');
  assert.deepEqual(PROFILE_DEFAULTS.suppressed, []);
  assert.deepEqual(PROFILE_DEFAULTS.digested, {});
});

it('carries no real person’s details in any personal source file', async () => {
  const tripwires = [/@gmail\.com/i, /@go\.sfcollege\.edu/i, /born on \d/i, /\b\d{4}-\d{2}-\d{2}\b.*birth/i];
  const offenders = [];
  for (const file of PERSONAL_SOURCES) {
    const source = fs.readFileSync(file, 'utf8');
    if (tripwires.some((pattern) => pattern.test(source))) offenders.push(path.basename(file));
  }
  assert.deepEqual(offenders, [], 'a source file quotes personal data from the debug dump');
});

// ── 2. The profile is bounded by the section table ───────────────────────────

it('bounds the profile with four fixed headings and a 38-bullet ceiling', async () => {
  const { PROFILE_SECTIONS, PROFILE_BULLET_CAP } = await importTs(personalFile('profile', 'sections.ts'));

  assert.deepEqual(
    PROFILE_SECTIONS.map((section) => [section.id, section.cap]),
    [['demographics', 8], ['interests', 14], ['relationships', 6], ['events', 10]],
    'the cap table is what keeps a year of use the same size as a week of use',
  );
  assert.equal(PROFILE_BULLET_CAP, 38, 'the ceiling is the sum of the caps, never a separate number');
});

it('expires dated events only, and leaves undated bullets alone forever', async () => {
  const { PROFILE_SECTIONS } = await importTs(personalFile('profile', 'sections.ts'));
  const { isExpired } = await importTs(personalFile('builder', 'merge.ts'));

  const expiring = PROFILE_SECTIONS.filter((section) => section.expiresAfterDays);
  assert.deepEqual(
    expiring.map((section) => [section.id, section.expiresAfterDays]),
    [['events', 60]],
    'only the dated section ages out; an interest does not stop being true',
  );

  const now = new Date('2026-08-11T00:00:00Z');
  assert.equal(isExpired({ section: 'events', date: '2026-01-02' }, now), true);
  assert.equal(isExpired({ section: 'events', date: '2026-08-01' }, now), false);
  // No date means no expiry, which is why the extractor is told to date only
  // time-bound facts.
  assert.equal(isExpired({ section: 'events' }, now), false);
  assert.equal(isExpired({ section: 'interests', date: '2019-01-01' }, now), false);
});

it('coerces a model’s near-miss headings and rejects junk outright', async () => {
  const { normalizeSectionId } = await importTs(personalFile('profile', 'sections.ts'));

  // The extractor is a language model writing headings from a prompt, so it will
  // pluralize, re-word and re-punctuate. Anything that is recognisably one of the
  // four is kept; anything else is dropped rather than filed under a guess.
  assert.equal(normalizeSectionId('Demographics Information'), 'demographics');
  assert.equal(normalizeSectionId('demographic'), 'demographics');
  assert.equal(normalizeSectionId('Interests & Preferences'), 'interests');
  assert.equal(normalizeSectionId('preferences'), 'interests');
  assert.equal(normalizeSectionId('Relationships'), 'relationships');
  assert.equal(normalizeSectionId('People'), 'relationships');
  assert.equal(normalizeSectionId('Dated Events, Projects & Plans'), 'events');
  assert.equal(normalizeSectionId('plans'), 'events');
  assert.equal(normalizeSectionId('Health'), null, 'an unknown heading must not be filed anywhere');
  assert.equal(normalizeSectionId(''), null);
  assert.equal(normalizeSectionId(undefined), null);
  assert.equal(normalizeSectionId(42), null);
});

// ── 3. A build is a merge, never an append ───────────────────────────────────

it('drops duplicates, deleted fingerprints, sensitive claims, malformed bullets and stale events — one run at a time', async () => {
  const { mergeCandidates } = await importTs(personalFile('builder', 'merge.ts'));
  let n = 0;
  const newId = () => `id-${++n}`;
  const now = new Date('2026-08-11T00:00:00Z');

  const result = mergeCandidates({
    candidates: [
      { section: 'demographics', text: 'Lives in Gainesville, Florida and studies computer science', evidence: 'said so across three conversations' },
      // The same claim as the line above, re-opened with a stock phrase and
      // trailing a detail. The fingerprint lowercases, strips punctuation, drops
      // the handful of leading words a model opens a bullet with, and keeps 48
      // characters — so these two collapse into one bullet rather than stacking.
      { section: 'demographics', text: 'The user lives in Gainesville, Florida and studies computer science at UF', evidence: 'also said' },
      // The user deleted this in Settings; the next build must not resurrect it.
      { section: 'interests', text: 'Likes lo-fi', evidence: 'mentioned once' },
      // The prompt asked the extractor not to infer health data; this is what
      // happens when it does anyway.
      { section: 'demographics', text: 'Dealing with a chronic illness', evidence: 'said so' },
      { section: 'nonsense-heading', text: 'Real claim, wrong label', evidence: 'no place to render' },
      { section: 'events', text: '', evidence: 'nothing to store' },
      { section: 'events', text: 'Flying to Delhi on the 14th', evidence: 'trip planning', date: '2026-01-02' },
    ],
    existing: [],
    suppressed: ['lofi'],
    source: 'chat history',
    now,
    newId,
  });

  assert.deepEqual(result.stats, {
    accepted: 1,
    duplicate: 1,
    suppressed: 1,
    sensitive: 1,
    expired: 1,
    overCap: 0,
    malformed: 2,
  });
  assert.deepEqual(
    result.bullets.map((bullet) => bullet.text),
    ['Lives in Gainesville, Florida and studies computer science'],
    'the first phrasing wins; the rephrasing must not stack beside it',
  );

  // The merge is where the feature is actually bounded: a model that returns
  // forty candidates cannot make the profile grow, because each section stops at
  // its cap.
  const flood = mergeCandidates({
    candidates: Array.from({ length: 30 }, (_, i) => ({
      section: 'interests', text: `Interest number ${i}`, evidence: `grounding for ${i}`,
    })),
    existing: [],
    suppressed: [],
    source: 'chat history',
    now,
    newId,
  });
  assert.equal(flood.bullets.length, 14, 'the interests cap did not hold');
  assert.equal(flood.stats.overCap, 16, 'the overflow was not counted as dropped');
});

it('carries existing bullets forward and never lets a candidate displace one', async () => {
  const { mergeCandidates } = await importTs(personalFile('builder', 'merge.ts'));
  let n = 0;
  const newId = () => `id-${++n}`;
  const now = new Date('2026-08-11T00:00:00Z');

  const kept = autoBullet({ id: 'kept' });
  const stale = autoBullet({
    id: 'stale', section: 'events', text: 'Flying to Delhi on the 14th', date: '2026-01-02',
  });

  const result = mergeCandidates({
    candidates: [{ section: 'interests', text: 'Prefers short answers', evidence: 'asked for brevity across three conversations' }],
    existing: [kept, stale],
    suppressed: [],
    source: 'chat history',
    now,
    newId,
  });

  assert.deepEqual(
    result.bullets.map((bullet) => bullet.id),
    ['kept'],
    'an existing bullet that survived must not be dropped',
  );
  assert.deepEqual(
    result.bullets.map((bullet) => bullet.text),
    ['Prefers short answers'],
    'the candidate collided with a stored bullet and displaced it',
  );
  assert.equal(result.bullets[0].createdAt, kept.createdAt, 'replacing a bullet reset its created date');
});

it('trims a bullet that turns into a paragraph', async () => {
  const { mergeCandidates } = await importTs(personalFile('builder', 'merge.ts'));
  let n = 0;
  const newId = () => `id-${++n}`;

  const result = mergeCandidates({
    candidates: [{
      section: 'interests',
      text: 'x'.repeat(500),
      evidence: 'grounding for the claim',
    }],
    existing: [],
    suppressed: [],
    source: 'chat history',
    now: new Date('2026-08-11T00:00:00Z'),
    newId,
  });

  assert.equal(result.bullets[0].text.length, 221, 'the bullet was not clamped to the 220-character limit');
  assert.ok(result.bullets[0].text.endsWith('…'), 'the clamped bullet is not visibly truncated');
});

// ── 4. The store owns persistence and the user's edits ───────────────────────

it('promotes an edited auto bullet to user so a build cannot overwrite the correction', async () => {
  const store = await resetProfile();

  store.commitBuildResult({
    bullets: [autoBullet({ id: 'b1' })],
    digested: {},
    builtAt: '2026-08-01T00:00:00.000Z',
  });
  const { id, createdAt } = store.profileStore.get().bullets[0];

  store.updateBullet(id, { text: 'Prefers very short answers' });
  const edited = store.profileStore.get().bullets[0];
  assert.equal(edited.text, 'Prefers very short answers');
  assert.equal(edited.origin, 'user', 'an edited auto bullet stays auto — the next build overwrites the correction');
  assert.equal(edited.createdAt, createdAt, 'editing re-dates the bullet, promoting an old observation');

  // The point of the promotion: a later build replaces auto bullets wholesale,
  // so an un-promoted correction would silently revert.
  store.commitBuildResult({
    bullets: [autoBullet({ id: 'fresh', text: 'Prefers short answers' })],
    digested: {},
    builtAt: '2026-08-02T00:00:00.000Z',
  });
  assert.deepEqual(
    store.profileStore.get().bullets.map((bullet) => bullet.text),
    ['Prefers very short answers', 'Prefers short answers'],
    'the build overwrote the corrected bullet',
  );

  await store.clearProfile();
});

it('suppresses only auto fingerprints, so deletion survives the next build', async () => {
  const store = await resetProfile();

  store.commitBuildResult({
    bullets: [
      autoBullet({ id: 'a1', text: 'Likes lo-fi' }),
      autoBullet({ id: 'a2', text: 'Prefers short answers' }),
    ],
    digested: {},
    builtAt: '2026-08-01T00:00:00.000Z',
  });

  store.removeBullet('a1');
  assert.deepEqual(store.profileStore.get().bullets.map((b) => b.text), ['Prefers short answers']);
  assert.deepEqual(store.profileStore.get().suppressed, ['lofi'], 'the fingerprint was not recorded');

  // Deletion survives the next build through two halves that have to agree: the
  // store records the fingerprint, and the merge is what refuses it. Neither one
  // is the guarantee on its own — `commitBuildResult` stores whatever it is
  // handed, so a merge that ignored `suppressed` would resurrect the bullet.
  const { mergeCandidates } = await importTs(personalFile('builder', 'merge.ts'));
  const rebuilt = mergeCandidates({
    candidates: [{ section: 'interests', text: 'Likes lo-fi', evidence: 'mentioned again' }],
    existing: [],
    suppressed: store.profileStore.get().suppressed,
    source: 'chat history',
    now: new Date('2026-08-02T00:00:00Z'),
    newId: () => 'a3',
  });
  assert.equal(rebuilt.stats.suppressed, 1, 'the next build re-derived the deleted bullet');
  assert.deepEqual(rebuilt.bullets, [], 'the suppressed claim came back as a bullet');

  // A user-written bullet was never derived, so nothing will re-derive it and
  // suppressing it would pollute the list with a fingerprint that can never hit.
  store.addUserBullet({ section: 'relationships', text: 'Works with a study group' });
  const userId = store.profileStore.get().bullets.find((b) => b.origin === 'user').id;
  store.removeBullet(userId);
  assert.deepEqual(store.profileStore.get().suppressed, ['lofi'], 'a user bullet is suppressed like an auto one');

  await store.clearProfile();
});

it('refuses blank user bullets and clears suppression along with the profile', async () => {
  const store = await resetProfile();

  store.addUserBullet({ section: 'interests', text: '   ' });
  assert.equal(store.profileStore.get().bullets.length, 0, 'a whitespace-only bullet was stored');

  store.commitBuildResult({
    bullets: [autoBullet({ id: 'x1', text: 'Likes lo-fi' })],
    digested: {},
    builtAt: '2026-08-01T00:00:00.000Z',
  });
  store.removeBullet('x1');
  assert.deepEqual(store.profileStore.get().suppressed, ['lofi']);

  // Delete everything, including the memory that anything was ever deleted: a
  // rebuild after "Delete all" must read the chats fresh.
  store.clearProfile();
  const state = store.profileStore.get();
  assert.deepEqual(state.bullets, []);
  assert.deepEqual(state.suppressed, [], '"Delete all" left the suppression list behind');
  assert.deepEqual(state.digested, {}, '"Delete all" left the digested map behind');
  assert.equal(state.lastBuiltAt, undefined, '"Delete all" left the last build time behind');
});

it('merges digested maps so an incremental build does not forget the past', async () => {
  const store = await resetProfile();

  store.commitBuildResult({
    bullets: [autoBullet({ id: 'd1' })],
    digested: { 'chat-1': 100, 'chat-2': 200 },
    builtAt: '2026-08-01T00:00:00.000Z',
  });
  store.commitBuildResult({
    bullets: [autoBullet({ id: 'd2', text: 'Likes lo-fi' })],
    digested: { 'chat-2': 250, 'chat-3': 300 },
    builtAt: '2026-08-02T00:00:00.000Z',
  });

  assert.deepEqual(
    store.profileStore.get().digested,
    { 'chat-1': 100, 'chat-2': 250, 'chat-3': 300 },
    'the second build replaced the whole digested map, forgetting the older chats',
  );

  await store.clearProfile();
});

// ── 5. The sensitive screen and the prompt's list are the same list ──────────

it('blocks storage of sensitive categories in code, not just in a prompt instruction', async () => {
  const { findSensitiveFamily, isStorableClaim } = await importTs(personalFile('profile', 'sensitive.ts'));
  const { SENSITIVE_CATEGORY_LINES } = await importTs(personalFile('profile', 'sensitive.ts'));

  const families = SENSITIVE_CATEGORY_LINES.length;
  assert.ok(families >= 15, 'the sensitive-category list has been trimmed');

  // The families of the source prompt's own list, with a plausible example each.
  const probes = [
    ['health', 'Has been seeing a therapist for anxiety'],
    ['national origin', 'Is an emigrated person'],
    ['religious beliefs', 'Practises Islam'],
    ['sexual orientation', 'Identifies as gay'],
    ['gender identity', 'Is a transgender woman'],
    ['criminal history', 'Is on probation'],
    ['government ID', 'SSN is 123-45-6789'],
    ['authentication details', 'Uses the password willow-2026'],
    ['financial or legal records', 'Earns a salary of 90000'],
    ['political affiliation', 'Votes democratic'],
  ];
  for (const [label, text] of probes) {
    assert.deepEqual(findSensitiveFamily(text), { label }, `the ${label} screen no longer trips on an example`);
  }

  // Plurals, in the health family specifically, because these are the forms
  // people actually write and a bare `antidepressant` in the alternation misses
  // every one of them — the `\b` closing the group will not match before an `s`.
  for (const text of ['Takes antidepressants', 'Has had two surgeries', 'Manages several medications']) {
    assert.deepEqual(findSensitiveFamily(text), { label: 'health' }, `the screen misses the plural in "${text}"`);
  }

  // The evidence field is a quote from the user and can carry the fact as easily
  // as the claim.
  assert.equal(isStorableClaim({ text: 'Moved to a new city', evidence: 'mentioned taking antidepressants' }), false,
    'a sensitive fact in the evidence passed the screen');
  assert.equal(isStorableClaim({ text: 'Prefers short answers', evidence: 'asked for brevity' }), true);
});

it('shows the user the same list the screen enforces', async () => {
  const { SENSITIVE_CATEGORY_LINES } = await importTs(personalFile('profile', 'sensitive.ts'));
  const { PERSONAL_DATA_LADDER } = await importTs(personalFile('profile', 'profile-prompt.ts'));

  // The ladder is interpolated from the same array that blocks storage, so the
  // categories the model is told to avoid and the ones the code refuses are the
  // same list by construction. A copy that drifts is exactly the failure this
  // prevents.
  for (const label of SENSITIVE_CATEGORY_LINES) {
    assert.ok(PERSONAL_DATA_LADDER.includes(label), `the ladder no longer names ${label}`);
  }
});

// ── 6. Connecting a product and letting it describe you are separate ─────────

it('asks for every Workspace scope in ONE consent request', async () => {
  await resetConnections();
  const { connectProducts } = await importTs(personalFile('connectors', 'connect.ts'));
  const { WORKSPACE_CONNECTORS } = await importTs(
    path.join(appDir, 'src', 'settings', 'tabs', 'connected-apps', 'connector-map.ts'),
  );
  const tokens = grantingTokens();

  const outcome = await connectProducts(WORKSPACE_CONNECTORS, { tokens });

  assert.equal(outcome.ok, true);
  assert.equal(tokens.calls.length, 1,
    'five products means five popups, and the browser blocks four of them');

  // One request carrying every product's read scope. Docs is the exception and
  // contributes none: it is connectable only to be written to, and that write
  // scope is asked for when a tool first needs it rather than here — so a user
  // who connects Workspace to read their week is not also handed the ability to
  // create documents.
  assert.deepEqual(tokens.calls[0].sort(), [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/gmail.metadata',
    'https://www.googleapis.com/auth/tasks.readonly',
  ], 'the combined request no longer covers exactly the readable Workspace products');
  assert.equal(
    tokens.calls[0].some((scope) => scope.includes('documents')),
    false,
    'connecting Workspace now asks for document write access up front',
  );
  // Gmail is metadata-only by scope, not by convention in the reader.
  assert.equal(
    tokens.calls[0].some((scope) => scope === 'https://www.googleapis.com/auth/gmail.readonly'),
    false,
    'Gmail asked for full read access instead of metadata',
  );

  const store = await importTs(personalFile('connectors', 'connections-store.ts'));
  for (const id of WORKSPACE_CONNECTORS) {
    assert.equal(store.isConnected(id), true, `${id} was requested but not recorded`);
  }

  await resetConnections();
});

it('records nothing when the consent screen is declined', async () => {
  const store = await resetConnections();
  const { connectProducts } = await importTs(personalFile('connectors', 'connect.ts'));

  const outcome = await connectProducts(['gmail'], {
    tokens: { get: async () => null, request: async () => null, invalidate: () => {} },
  });

  assert.deepEqual(outcome, { ok: false, reason: 'declined' });
  assert.equal(store.isConnected('gmail'), false,
    'a declined consent screen still flipped the switch on');
});

it('keeps Drive and Docs out of the profile even when connected', async () => {
  await resetConnections();
  const { canProvideSignals, READERS, CONNECTORS } = await importTs(
    personalFile('connectors', 'registry.ts'),
  );
  const { connectProducts } = await importTs(personalFile('connectors', 'connect.ts'));
  const store = await importTs(personalFile('connectors', 'connections-store.ts'));

  // Connectable, and deliberately never read for personalization. "Not a profile
  // source" is a different statement from "not implemented yet", which is why
  // this is asserted rather than left to the absence of a reader.
  for (const id of ['drive', 'docs']) {
    assert.equal(canProvideSignals(id), false, `${id} may now describe the user`);
    assert.equal(READERS[id], undefined, `${id} gained a reader`);
  }
  for (const id of ['gmail', 'calendar', 'youtube', 'contacts', 'tasks']) {
    assert.equal(canProvideSignals(id), true, `${id} can no longer feed the profile`);
    assert.ok(READERS[id], `${id} claims to provide signals but has no reader`);
  }

  // A connector that claims signals without a reader would silently contribute
  // nothing while showing the user a "Use for personalization" switch.
  for (const connector of CONNECTORS) {
    if (connector.providesSignals) {
      assert.ok(READERS[connector.id], `${connector.id} promises signals it cannot collect`);
    }
  }

  await connectProducts(['drive'], { tokens: grantingTokens() });
  assert.equal(store.isConnected('drive'), true);
  assert.equal(store.isSignalSource('drive'), false,
    'connecting Drive made it a profile source');

  await resetConnections();
});

it('needs both lists before a product may describe the user', async () => {
  const store = await resetConnections();
  const { connectProducts } = await importTs(personalFile('connectors', 'connect.ts'));

  await connectProducts(['calendar'], { tokens: grantingTokens() });
  assert.equal(store.isSignalSource('calendar'), true, 'a connected Calendar defaults to feeding');

  // Turning personalization off leaves the connection intact: Willow can still
  // see the user's week without their meeting titles becoming stored facts.
  store.setFeedsProfile('calendar', false);
  assert.equal(store.isConnected('calendar'), true, 'declining personalization disconnected the app');
  assert.equal(store.isSignalSource('calendar'), false);

  // And the reverse: a product that is not connected cannot be a signal source
  // by leftover state.
  store.setFeedsProfile('calendar', true);
  store.disconnect('calendar');
  assert.equal(store.isSignalSource('calendar'), false,
    'a disconnected product is still listed as feeding the profile');

  await resetConnections();
});

// ── 7. There is one personal method, and it only reads ───────────────────────

it('exposes no memory-writing tool anywhere in the package', async () => {
  const offenders = [];
  for (const file of PERSONAL_SOURCES) {
    const source = codeOnly(fs.readFileSync(file, 'utf8'));
    if (/store_personal_data|save_personal_data|remember_this|store_memory/.test(source)) {
      offenders.push(path.basename(file));
    }
  }
  // A write tool would mean the model decides mid-sentence what to remember about
  // the user, and announces it. Writing happens in `builder/`, from conversations
  // that have already finished, which is why there is exactly one method here.
  assert.deepEqual(offenders, [], 'a memory-writing tool appeared; writing belongs to builder/');
});

it('declares the same one method in all three provider dialects', async () => {
  const {
    RETRIEVE_PERSONAL_DATA, geminiPersonalTool, openaiPersonalTool, anthropicPersonalTool,
    isPersonalToolCall,
  } = await importTs(personalFile('tools', 'declarations.ts'));

  assert.equal(RETRIEVE_PERSONAL_DATA, 'retrieve_personal_data');

  // Three shapes, one contract. A provider whose name drifts silently stops the
  // model from ever reaching the profile, and nothing errors.
  const gemini = geminiPersonalTool();
  const geminiName = gemini.functionDeclarations?.[0]?.name ?? gemini.name;
  assert.equal(geminiName, RETRIEVE_PERSONAL_DATA);
  assert.equal(openaiPersonalTool().function?.name ?? openaiPersonalTool().name, RETRIEVE_PERSONAL_DATA);
  assert.equal(anthropicPersonalTool().name, RETRIEVE_PERSONAL_DATA);

  assert.equal(isPersonalToolCall(RETRIEVE_PERSONAL_DATA), true);
  assert.equal(isPersonalToolCall('store_personal_data'), false);
  assert.equal(isPersonalToolCall(undefined), false);
});

it('reads the query out of whichever shape a provider sends', async () => {
  const { readQueryArgument } = await importTs(personalFile('tools', 'declarations.ts'));

  // Each of these is a real shape one of the three providers produces: an object,
  // a JSON string, and a bare string. Guessing wrong turns a retrieval into an
  // empty query, which reads as "nothing known about you".
  assert.equal(readQueryArgument({ query: 'what do you know about me' }), 'what do you know about me');
  assert.equal(readQueryArgument('{"query":"my hobbies"}'), 'my hobbies');
  assert.equal(readQueryArgument('my hobbies'), 'my hobbies');
  assert.equal(readQueryArgument(undefined), '');
  assert.equal(readQueryArgument(42), '');
});

it('answers an action call with readable text when the app is not connected', async () => {
  const { executePersonalTool, ACTION_TOOLS, isPersonalActionCall } = await importTs(
    personalFile('tools', 'executor.ts'),
  );

  assert.equal(isPersonalActionCall(ACTION_TOOLS.createCalendarEvent), true);
  assert.equal(isPersonalActionCall('some_other_tool'), false);

  // A tool that is not ours must pass through as null rather than be answered on
  // another executor's behalf.
  assert.equal(await executePersonalTool('web_search', {}, {}), null);

  // Missing `actions` means the connectors were never configured. Text, not a
  // throw: a thrown error breaks the turn, a sentence lets the model explain.
  const unconnected = await executePersonalTool(
    ACTION_TOOLS.createTask, { title: 'Buy milk' }, {},
  );
  assert.match(unconnected.text, /not connected/i);
  assert.match(unconnected.text, /Connected Apps/);

  const calls = [];
  const actions = {
    createTask: async (input) => { calls.push(['task', input]); return 'Added “Buy milk”.'; },
    createCalendarEvent: async () => 'Added the event.',
    createDocument: async () => 'Created the doc.',
    createPlaylist: async () => 'Created the playlist.',
  };

  const created = await executePersonalTool(
    ACTION_TOOLS.createTask, '{"title":"Buy milk","notes":"oat"}', { actions },
  );
  assert.equal(created.text, 'Added “Buy milk”.');
  assert.deepEqual(calls[0][1], { title: 'Buy milk', notes: 'oat', due: undefined });

  // A missing required field is asked for, not sent to Google as a blank event.
  const incomplete = await executePersonalTool(
    ACTION_TOOLS.createCalendarEvent, { title: 'Standup' }, { actions },
  );
  assert.match(incomplete.text, /needs a title and a start time/);

  // An unexpected throw from the action layer still returns a sentence.
  const thrown = await executePersonalTool(ACTION_TOOLS.createDocument, { title: 'Notes' }, {
    actions: { ...actions, createDocument: async () => { throw new Error('network'); } },
  });
  assert.match(thrown.text, /could not be completed/i);
});

it('offers an action tool only once its product is connected', async () => {
  const { geminiActionTools, connectorForAction } = await importTs(
    personalFile('tools', 'action-declarations.ts'),
  );
  const { ACTION_TOOLS } = await importTs(personalFile('tools', 'executor.ts'));

  const names = (connected) => {
    const declared = geminiActionTools(connected);
    const list = declared?.functionDeclarations ?? declared ?? [];
    return list.map((tool) => tool.name).sort();
  };

  // Offering a tool for a product with no token means the model promises the user
  // an action that cannot happen.
  assert.deepEqual(names([]), [], 'action tools were offered with nothing connected');
  assert.deepEqual(names(['tasks']), [ACTION_TOOLS.createTask]);
  assert.deepEqual(
    names(['calendar', 'tasks']).sort(),
    [ACTION_TOOLS.createCalendarEvent, ACTION_TOOLS.createTask].sort(),
  );

  assert.equal(connectorForAction(ACTION_TOOLS.createCalendarEvent), 'calendar');
  assert.equal(connectorForAction(ACTION_TOOLS.createPlaylist), 'youtube');
  assert.equal(connectorForAction('web_search'), undefined);
});

// ── 8. Retrieval answers in sentences, never in silence ──────────────────────

/** A ChatSource over in-memory conversations. */
const fakeChats = (chats) => ({
  list: async () => chats.map(({ chatId, updatedAt }) => ({ chatId, updatedAt })),
  load: async (chatId) => chats.find((chat) => chat.chatId === chatId)?.messages ?? null,
});

const CHATS = [
  {
    chatId: 'chat-1',
    updatedAt: Date.parse('2026-08-01T00:00:00Z'),
    messages: [
      { role: 'user', content: 'I am training for a half marathon in November' },
      { role: 'assistant', content: 'That is a solid target. How far are you running now?' },
    ],
  },
];

it('always answers a retrieval, and says so plainly when it knows nothing', async () => {
  const { retrievePersonalData, invalidatePersonalIndex } = await importTs(
    personalFile('retrieval', 'personal-context.ts'),
  );
  const deps = {
    chats: fakeChats(CHATS),
    getProfile: () => ({ enabled: true, bullets: [autoBullet({ text: 'Prefers short answers' })] }),
    now: () => Date.parse('2026-08-11T00:00:00Z'),
  };
  invalidatePersonalIndex();

  // An empty tool result reads to a model as a malfunction, which it apologises
  // for. Every branch here returns a sentence instead.
  const found = await retrievePersonalData('marathon training', deps);
  assert.match(found.text, /marathon/i, 'the matching conversation was not quoted back');
  assert.ok(found.matches >= 1, 'a matching conversation was not counted for the tool chip');

  invalidatePersonalIndex();
  const missing = await retrievePersonalData('sourdough starter', {
    ...deps,
    getProfile: () => ({ enabled: true, bullets: [] }),
  });
  assert.equal(missing.matches, 0);
  assert.match(missing.text, /No stored information about "sourdough starter"/,
    '"nothing found" must be a sentence, not an empty string');

  invalidatePersonalIndex();
  const blank = await retrievePersonalData('   ', deps);
  assert.equal(blank.text, 'No search query was provided.');

  // Memory off is not "nothing found" — the difference matters, because one means
  // ask the user and the other means do not go looking again.
  invalidatePersonalIndex();
  const off = await retrievePersonalData('marathon', {
    ...deps,
    getProfile: () => ({ enabled: false, bullets: [autoBullet()] }),
  });
  assert.match(off.text, /Personalization is turned off/);
  assert.equal(off.matches, 0);

  // A chat store that throws leaves the profile half rather than failing the turn.
  invalidatePersonalIndex();
  const degraded = await retrievePersonalData('short answers', {
    ...deps,
    chats: { list: async () => { throw new Error('disk gone'); }, load: async () => null },
  });
  assert.match(degraded.text, /Prefers short answers/,
    'an unreadable chat store took the profile down with it');
  assert.equal(degraded.matches, 0);

  invalidatePersonalIndex();
});

// ── 9. Nothing reaches a turn that the user did not turn on ──────────────────

it('gates the profile block, the ladder and the retrieval guidance separately', async () => {
  const model = await importTs(path.join(repoRoot, 'features', 'chat', 'src', 'chat-model.ts'));
  const { PERSONAL_DATA_LADDER, PERSONAL_RETRIEVAL_GUIDANCE } = await importTs(
    personalFile('profile', 'profile-prompt.ts'),
  );
  const store = await resetProfile();

  store.commitBuildResult({
    bullets: [autoBullet({ id: 'p1', text: 'Prefers short answers' })],
    digested: {},
    builtAt: '2026-08-01T00:00:00.000Z',
  });

  const firstLine = (block) => block.split('\n').find((line) => line.trim().length > 0);
  const ladderLine = firstLine(PERSONAL_DATA_LADDER);
  // The guidance's own heading, not the bare tool name: the ladder names the tool
  // too (its priority rule says Saved Info outranks whatever the tool returns), so
  // matching on `retrieve_personal_data` alone would pass whichever block shipped.
  const guidanceLine = firstLine(PERSONAL_RETRIEVAL_GUIDANCE);

  const on = model.chatSystemPromptFor('gemini', { personalize: true, personalTool: true });
  assert.match(on, /Prefers short answers/, 'the profile never reached the prompt');
  assert.ok(on.includes(ladderLine), 'the ladder never reached the prompt');
  assert.ok(on.includes(guidanceLine),
    'the tool was offered without telling the model when to reach for it');

  // Three separate switches, because they fail differently: no profile is a
  // privacy setting, no ladder is a safety one, and no guidance means a declared
  // tool the model never calls.
  const noTool = model.chatSystemPromptFor('gemini', { personalize: true, personalTool: false });
  assert.match(noTool, /Prefers short answers/);
  assert.ok(noTool.includes(ladderLine), 'the ladder is not gated on the tool and must still ship');
  assert.equal(noTool.includes(guidanceLine), false,
    'the model was told to call a tool that was never declared');

  const off = model.chatSystemPromptFor('gemini', { personalize: false, personalTool: true });
  assert.equal(off.includes('Prefers short answers'), false,
    'a turn with personalization off still carried the profile');
  assert.equal(off.includes(ladderLine), false);

  // Memory switched off in Settings is the same as personalization off for a turn,
  // even though the bullets are still on disk waiting to be turned back on.
  store.setProfileEnabled(false);
  const disabled = model.chatSystemPromptFor('gemini', { personalize: true, personalTool: true });
  assert.equal(disabled.includes('Prefers short answers'), false,
    'Memory was off in Settings and the profile still reached the model');

  store.setProfileEnabled(true);
  await store.clearProfile();

  // An empty profile must not ship the heading — a summary header followed by no
  // bullets invites the model to open an answer by announcing it knows nothing
  // about you. The ladder still ships: it governs how personal data is handled at
  // all, including the Saved Info and connected products that exist independently
  // of whether a profile has been built yet.
  const { PROFILE_HEADER } = await importTs(personalFile('profile', 'profile-prompt.ts'));
  const empty = model.chatSystemPromptFor('gemini', { personalize: true, personalTool: false });
  assert.equal(empty.includes(PROFILE_HEADER), false,
    'an empty profile still shipped the summary heading');
  assert.ok(empty.includes(ladderLine),
    'the ladder is guidance about personal data generally and must not depend on a built profile');
});

it('withholds personal tools from a temporary chat and from an empty profile', async () => {
  const { personalChatTools } = await importTs(
    path.join(repoRoot, 'features', 'chat', 'src', 'personal-tools.ts'),
  );
  const store = await resetProfile();
  await resetConnections();

  // Nothing to retrieve and nothing connected: declaring the tool would invite a
  // call that can only answer "nothing found".
  assert.deepEqual(personalChatTools({ personalize: true }), [],
    'tools were offered with an empty profile and no connections');

  store.commitBuildResult({
    bullets: [autoBullet({ id: 't1' })],
    digested: {},
    builtAt: '2026-08-01T00:00:00.000Z',
  });
  assert.ok(personalChatTools({ personalize: true }).length > 0,
    'a populated profile did not make the retrieval tool available');

  // A temporary chat is the one place the profile must not be reachable at all.
  assert.deepEqual(personalChatTools({ personalize: false }), [],
    'a temporary chat could still reach the profile');

  store.setProfileEnabled(false);
  assert.deepEqual(personalChatTools({ personalize: true }), [],
    'Memory was off and the tool was still declared');

  store.setProfileEnabled(true);
  await store.clearProfile();
  await resetConnections();
});

// ── 10. The UI reads live state, never the captured catalogue ────────────────

it('leaves Keep unmapped and never treats defaultConnected as connected', async () => {
  const map = read('apps', 'studio', 'src', 'settings', 'tabs', 'connected-apps', 'connector-map.ts');
  const data = read('apps', 'studio', 'src', 'settings', 'tabs', 'connected-apps', 'connectedAppsData.ts');
  const tab = codeOnly(settingsTab('connected-apps', 'ConnectedAppsTab.tsx'));
  // `codeOnly` matters here: this file's closing comment explains at length why
  // the seeded-connections export was removed, naming it, so a raw match finds
  // the prose rather than the export.
  const dataCode = codeOnly(data);

  // Keep is a Workspace child like the other five, but Google publishes no OAuth
  // scope a public client can use for it. Mapping it would give the card a switch
  // that grants nothing.
  assert.equal(/^\s*keep:/m.test(codeOnly(map)), false, 'keep gained a connector mapping');
  assert.match(data, /keep/, 'Keep vanished from the catalogue instead of staying inert');

  // `defaultConnected` is captured data about Gemini's page, not state. Reading it
  // as connection state is what once opened the tab with every app shown as
  // connected while Willow held no token for any of them.
  assert.equal(/DEFAULT_CONNECTIONS/.test(dataCode), false, 'the seeded-connections export came back');
  assert.equal(/defaultConnected/.test(tab), false,
    'the tab reads captured catalogue data as live connection state');
  assert.match(tab, /useConnections\(\)/, 'the tab no longer reads live connection state');
});

it('drives the Memory toggle and the profile list from the store', async () => {
  const personal = codeOnly(settingsTab('personal-intelligence', 'PersonalIntelligenceTab.tsx'));
  const memory = codeOnly(settingsTab('memory', 'MemoryTab.tsx'));

  // A local useState here would let the switch show "on" while the profile stayed
  // off, which is the kind of drift that reads as data loss.
  assert.match(personal, /useStore\(\s*profileStore\s*\)/,
    'the Memory switch is not reading the profile store');
  assert.match(memory, /useStore\(\s*profileStore\s*\)/,
    'the Memory page is not reading the profile store');
});

