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
  for (const id of ['gmail', 'calendar', 'youtube', 'tasks', 'spotify', 'github']) {
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

  const { activeSignalConnectors } = await importTs(personalFile('connectors', 'signals.ts'));

  await connectProducts(['drive'], { tokens: grantingTokens() });
  assert.equal(store.isConnected('drive'), true);
  // Connecting Drive is allowed and reading it for the profile is not, and there
  // is no switch in between: `providesSignals` is a property of the product.
  assert.equal(activeSignalConnectors().includes('drive'), false,
    'connecting Drive made it a profile source');

  await connectProducts(['calendar'], { tokens: grantingTokens() });
  assert.equal(activeSignalConnectors().includes('calendar'), true,
    'a connected Calendar does not feed the profile');

  await resetConnections();
});

it('offers no tool for a connected product whose token has gone', async () => {
  const store = await resetConnections();
  const { connectProducts } = await importTs(personalFile('connectors', 'connect.ts'));
  const auth = await importTs(personalFile('connectors', 'authorization.ts'));
  const { geminiReadTools } = await importTs(personalFile('tools', 'read-declarations.ts'));

  /*
   * The bug this pins, in the words the user reported it in: "My YouTube
   * connection has expired, so I can't check what you've been liking right now."
   *
   * Connected is persistent, authorized is not — the token dies with the tab and
   * Google issues browser clients no refresh token. Building the tool surface from
   * `enabled` alone declares a tool, ships a prompt block naming it, has the model
   * call it, and only then discovers there is nothing behind it. The whole point of
   * the second store is that the model is never told about a door it cannot open.
   */
  await connectProducts(['youtube'], { tokens: grantingTokens() });
  assert.equal(store.isConnected('youtube'), true);
  assert.equal(auth.authorizationOf('youtube'), 'authorized',
    'a granted connect did not record authorization');
  assert.deepEqual(auth.usableConnectors(), ['youtube']);
  assert.ok(geminiReadTools(auth.usableConnectors()), 'no read tool for a live YouTube');

  // What a 401 surviving its retry does. The product stays connected — the user
  // did connect it, and the card still shows it — but nothing is declared.
  auth.authLossHandler('youtube')();
  assert.equal(store.isConnected('youtube'), true,
    'losing a token disconnected the product instead of marking it expired');
  assert.deepEqual(auth.usableConnectors(), []);
  assert.deepEqual(auth.expiredConnectors(), ['youtube']);
  assert.equal(geminiReadTools(auth.usableConnectors()), null,
    'an expired YouTube still had its read tools declared');

  // And the prompt block goes with them, or the model is told to call tools it
  // was never given.
  const { connectorReadGuidance } = await importTs(personalFile('tools', 'read-declarations.ts'));
  assert.equal(connectorReadGuidance(auth.usableConnectors()), '');

  // A silent refresh that finds a token puts it back, with no popup and no
  // reconnect. This is the ordinary reload, and it must not cost a click.
  await auth.refreshAuthorizations(grantingTokens());
  assert.deepEqual(auth.usableConnectors(), ['youtube']);

  // A refresh that finds nothing is the expired case, reached without prompting.
  await auth.refreshAuthorizations({
    get: async () => null, request: async () => 'token', invalidate: () => {},
  });
  assert.deepEqual(auth.expiredConnectors(), ['youtube']);

  await resetConnections();
  auth.forgetAuthorization('youtube');
});

it('asks for YouTube separately, because Google refuses it alongside other scopes', async () => {
  await resetConnections();
  const auth = await importTs(personalFile('connectors', 'authorization.ts'));
  const { connectProducts } = await importTs(personalFile('connectors', 'connect.ts'));

  await connectProducts(['youtube', 'calendar', 'tasks'], { tokens: grantingTokens() });

  // One request per batch, and YouTube is always its own batch: a combined
  // request dies on `invalid_request` naming two scopes Willow never meant to
  // pair, which is the error the user hit as "scopes that cannot be requested
  // together: [youtube.readonly, drive.file]".
  const asked = [];
  await auth.refreshAuthorizations({
    get: async (scopes) => { asked.push(scopes); return 'token'; },
    request: async () => 'token',
    invalidate: () => {},
  });

  const youtubeBatches = asked.filter((scopes) => scopes.some((url) => url.includes('youtube')));
  assert.equal(youtubeBatches.length, 1, 'YouTube was asked for in more than one batch');
  assert.deepEqual(
    youtubeBatches[0].filter((url) => !url.includes('youtube')),
    [],
    'a YouTube scope request carried another product along with it',
  );

  await resetConnections();
  for (const id of ['youtube', 'calendar', 'tasks']) auth.forgetAuthorization(id);
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

it('withholds personal tools from a temporary chat and from disabled Memory', async () => {
  const { personalChatTools } = await importTs(
    path.join(repoRoot, 'features', 'chat', 'src', 'personal-tools.ts'),
  );
  const store = await resetProfile();
  await resetConnections();

  // Retrieval reads saved chats as well as the profile, so it is offered from the
  // first run — an unseeded profile is not an empty search.
  assert.ok(personalChatTools({ personalize: true }).length > 0,
    'Memory was on and the retrieval tool was not offered');

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

/*
 * Helpers for the three sections below, kept here rather than at the top of the
 * file because nothing above needs them.
 */

/** Clear the in-memory authorization map, which `resetConnections` does not touch. */
const resetAuthorizations = async () => {
  const auth = await importTs(personalFile('connectors', 'authorization.ts'));
  const { CONNECTORS } = await importTs(personalFile('connectors', 'registry.ts'));
  for (const connector of CONNECTORS) auth.forgetAuthorization(connector.id);
  return auth;
};

/** A TokenSource that grants silently, recording the scope batches `get` was asked for. */
const silentTokens = () => {
  const batches = [];
  return {
    batches,
    get: async (scopes) => {
      batches.push(scopes);
      return 'token';
    },
    request: async () => 'token',
    invalidate: () => {},
  };
};

/**
 * Stand up the browser storage the PKCE flow needs, and take it away again.
 *
 * Node has no `localStorage`, and every persistence branch in the Spotify token
 * source is wrapped in a `catch` that costs persistence rather than correctness —
 * so without a stub the refresh-token test below would pass while exercising
 * nothing at all.
 */
const withBrowserStorage = async (body) => {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'localStorage');
  const previous = globalThis.localStorage;
  const map = new Map();
  const storage = {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
  const install = (value) =>
    Object.defineProperty(globalThis, 'localStorage', { value, configurable: true, writable: true });

  install(storage);
  try {
    return await body(storage);
  } finally {
    if (had) install(previous);
    else delete globalThis.localStorage;
  }
};

/**
 * A stand-in for `accounts.spotify.com/api/token`.
 *
 * Records what was posted and answers with whatever the test last set. A refused
 * refresh and a network failure are deliberately the same path in `postToken`, so
 * the only way to tell the two apart from outside is what the endpoint was asked.
 */
const withTokenEndpoint = async (body) => {
  const previous = globalThis.fetch;
  const calls = [];
  let next = { ok: false, json: { error: 'invalid_grant' } };
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), grant: init?.body?.get?.('grant_type') });
    const reply = next;
    return { ok: reply.ok, json: async () => reply.json };
  };
  try {
    return await body({ calls, reply: (value) => { next = value; } });
  } finally {
    globalThis.fetch = previous;
  }
};

// ── 11. Personalization off means no connected app is callable ────────────────

it('makes a connected app uncallable, not merely undeclared, with personalization off', async () => {
  const { declaredToolNames, personalChatTools } = await importTs(
    path.join(repoRoot, 'features', 'chat', 'src', 'personal-tools.ts'),
  );
  const { RETRIEVE_PERSONAL_DATA } = await importTs(personalFile('tools', 'declarations.ts'));
  const { ACTION_TOOLS, READ_TOOLS } = await importTs(personalFile('tools', 'executor.ts'));
  const { connectProducts } = await importTs(personalFile('connectors', 'connect.ts'));
  const store = await resetProfile();
  await resetConnections();
  await resetAuthorizations();

  const declared = (context) => declaredToolNames(personalChatTools(context));

  assert.deepEqual([...declared({ personalize: true })], [RETRIEVE_PERSONAL_DATA],
    'a fresh install offered something other than retrieval');

  await connectProducts(['youtube'], { tokens: grantingTokens() });
  const on = declared({ personalize: true });
  assert.ok(on.has(READ_TOOLS.listLikedVideos), 'a connected YouTube declared no read tool');
  assert.ok(on.has(ACTION_TOOLS.createPlaylist), 'a connected YouTube declared no action tool');

  /*
   * The requirement, in the words it was given in: no connected app should be
   * callable when personalization is off.
   *
   * Undeclared is not the same as uncallable. A model looking at a transcript where
   * it called `list_liked_videos` three turns ago can emit that call again on a turn
   * where the tool was never offered, so the executor checks this set before it runs
   * anything — and the set is read back out of the declarations rather than
   * re-derived, so the two cannot disagree about what was offered.
   */
  store.setProfileEnabled(false);
  assert.deepEqual([...declared({ personalize: true })], [],
    'Memory was off and a connected app was still callable');

  store.setProfileEnabled(true);
  assert.deepEqual([...declared({ personalize: false })], [],
    'a temporary chat could still call a connected app');

  // The set is built from whatever shape the block happens to be in, because a
  // provider translation layer between here and the model is free to reshape it.
  assert.equal(declaredToolNames(undefined).size, 0);
  assert.equal(declaredToolNames([]).size, 0);
  assert.equal(declaredToolNames([{}, { functionDeclarations: [{}, { name: 'only_this' }] }]).size, 1);

  await resetConnections();
  await resetAuthorizations();
});

it('checks the allow-list before it runs a tool, not after', async () => {
  const runner = codeOnly(read('features', 'chat', 'src', 'chat-turn-runner.ts'));
  const gate = runner.indexOf('declaredToolNames(deps.personalTools)');
  const run = runner.indexOf('runPersonalTool(');

  assert.ok(gate > 0, 'the turn runner no longer consults the declared-tool set');
  assert.ok(run > gate, 'a tool call ran before the allow-list was consulted');

  // Both refusals say the same sentence on purpose: a tool withheld by the gate and
  // a tool the executor does not recognise are the same fact from the model's side,
  // and a model that can tell them apart can try to work out which one it hit.
  assert.equal(runner.split('is not available in this context').length - 1, 2,
    'the two refusal paths stopped saying the same thing');
});

// ── 12. Spotify ──────────────────────────────────────────────────────────────

it('never asks one provider for another provider’s scopes', async () => {
  const { providerOf } = await importTs(personalFile('connectors', 'registry.ts'));
  const { connectProducts } = await importTs(personalFile('connectors', 'connect.ts'));
  const auth = await resetAuthorizations();
  await resetConnections();

  assert.equal(providerOf('spotify'), 'spotify');
  assert.equal(providerOf('youtube'), 'google', 'the unstated default stopped being Google');

  for (const id of ['youtube', 'calendar', 'spotify']) {
    await connectProducts([id], { tokens: grantingTokens() });
  }

  const tokens = silentTokens();
  await auth.refreshAuthorizations(tokens);

  /*
   * Three batches, and the third is the one that matters. Spotify's scopes are bare
   * words (`user-top-read`) where Google's are URLs, so a batch holding both would
   * be a consent screen listing scopes that host has never heard of — and the
   * failure would arrive as a puzzling 400 rather than as anything naming providers.
   */
  const isGoogle = (scope) => scope.startsWith('https://www.googleapis.com/');
  for (const batch of tokens.batches) {
    const mixed = batch.some(isGoogle) && batch.some((scope) => !isGoogle(scope));
    assert.equal(mixed, false, `a scope batch mixed two providers: ${batch.join(' ')}`);
  }

  assert.equal(tokens.batches.length, 3,
    'YouTube must be asked for alone, and Spotify separately from Google entirely');
  assert.equal(tokens.batches.filter((batch) => batch.includes('user-top-read')).length, 1,
    'Spotify’s scopes were requested more than once');
  assert.equal(
    tokens.batches.filter((batch) => batch.includes('https://www.googleapis.com/auth/youtube.readonly')).length,
    1,
  );
  assert.equal(
    tokens.batches.some((batch) =>
      batch.includes('https://www.googleapis.com/auth/youtube.readonly')
      && batch.includes('https://www.googleapis.com/auth/calendar.readonly')),
    false,
    'YouTube shared a batch with another Google API, which Google refuses outright',
  );

  assert.deepEqual(auth.usableConnectors().sort(), ['calendar', 'spotify', 'youtube'],
    'a silent refresh that granted everything left something unusable');

  await resetConnections();
  await resetAuthorizations();
});

it('keeps a Spotify grant across a reload and drops it when refused', async () => {
  const REFRESH_KEY = 'willow:spotify-refresh-token';
  const { createSpotifyTokenSource, clearSpotifyGrant } = await importTs(
    personalFile('connectors', 'spotify', 'pkce-token-source.ts'),
  );

  // No client id, no source. This is the whole of "Spotify is not set up in this
  // build" — there is nothing to install, so the switches stay off rather than
  // opening a consent screen that cannot be redeemed.
  assert.equal(createSpotifyTokenSource(), null);

  await withBrowserStorage(async (storage) => {
    await withTokenEndpoint(async (endpoint) => {
      const source = createSpotifyTokenSource({ clientId: 'test-client' });
      const scopes = ['user-top-read'];

      // Nothing stored: `get` must answer null without a network round trip. A
      // request here would be a request on every load of an app nobody connected.
      assert.equal(await source.get(scopes), null);
      assert.equal(endpoint.calls.length, 0, 'a token was requested with no grant to redeem');

      /*
       * The durable half, and the reason a Spotify connection survives a reload
       * where a Google one cannot: Google issues no refresh token to a browser
       * client, Spotify does, so this mints an access token with no popup and no
       * user present.
       */
      storage.setItem(REFRESH_KEY, 'durable');
      endpoint.reply({ ok: true, json: { access_token: 'fresh', expires_in: 3600, scope: 'user-top-read' } });

      assert.equal(await source.get(scopes), 'fresh');
      assert.equal(endpoint.calls.length, 1);
      assert.equal(endpoint.calls[0].grant, 'refresh_token');
      assert.match(endpoint.calls[0].url, /accounts\.spotify\.com\/api\/token$/);

      // Cached. Two tools reading Spotify in one turn is one token, not two.
      assert.equal(await source.get(scopes), 'fresh');
      assert.equal(endpoint.calls.length, 1, 'the access token was not cached');

      /*
       * A scoped invalidate is the fetch layer reacting to a single 401, where the
       * refresh token is very likely still good. Dropping it there would turn a
       * retryable blip into a reconnect the user has to notice and act on.
       */
      source.invalidate(scopes);
      assert.equal(storage.getItem(REFRESH_KEY), 'durable',
        'one 401 threw away the durable grant');

      // A refused refresh is a revoked grant, not a blip: keeping it would mean
      // retrying a dead credential on every read for the rest of the session.
      endpoint.reply({ ok: false, json: { error: 'invalid_grant' } });
      assert.equal(await source.get(scopes), null);
      assert.equal(endpoint.calls.length, 2);
      assert.equal(storage.getItem(REFRESH_KEY), null, 'a revoked refresh token was kept');

      // Disconnect. `forget` is what makes the switch mean off — an access token
      // dies with the tab, but a refresh token left behind is a live credential
      // sitting in the browser of someone who turned the product off.
      storage.setItem(REFRESH_KEY, 'durable-again');
      endpoint.reply({ ok: true, json: { access_token: 'fresh-2', expires_in: 3600 } });
      assert.equal(await source.get(scopes), 'fresh-2');

      source.forget();
      assert.equal(storage.getItem(REFRESH_KEY), null);
      const before = endpoint.calls.length;
      assert.equal(await source.get(scopes), null, 'a forgotten source still minted tokens');
      assert.equal(endpoint.calls.length, before, 'a forgotten source still held a cached token');

      // The disconnect hook, which runs without a source instance in hand.
      storage.setItem(REFRESH_KEY, 'durable-again');
      clearSpotifyGrant();
      assert.equal(storage.getItem(REFRESH_KEY), null);
    });
  });
});

it('drops a provider’s durable grant only when nothing else is using it', async () => {
  const { connectProducts, disconnectProduct } = await importTs(personalFile('connectors', 'connect.ts'));
  await resetConnections();
  await resetAuthorizations();

  const recording = () => {
    const record = { forgotten: 0, invalidated: [] };
    return {
      record,
      get: async () => 'token',
      request: async () => 'token',
      invalidate: (scopes) => record.invalidated.push(scopes),
      forget: () => { record.forgotten += 1; },
    };
  };

  await connectProducts(['gmail'], { tokens: grantingTokens() });
  await connectProducts(['calendar'], { tokens: grantingTokens() });

  // Gmail and Calendar share one Google grant, so dropping it because Gmail was
  // switched off would silently take Calendar's access with it.
  const shared = recording();
  disconnectProduct('gmail', { tokens: shared });
  assert.equal(shared.record.forgotten, 0, 'disconnecting Gmail dropped the grant Calendar still needs');
  assert.ok(shared.record.invalidated.length > 0, 'the disconnected product’s token was left cached');

  const last = recording();
  disconnectProduct('calendar', { tokens: last });
  assert.equal(last.record.forgotten, 1, 'the last product on a provider left its grant in place');

  // Spotify is one connector, so there is never anything left to share.
  await connectProducts(['spotify'], { tokens: grantingTokens() });
  const solo = recording();
  disconnectProduct('spotify', { tokens: solo });
  assert.equal(solo.record.forgotten, 1);

  await resetConnections();
  await resetAuthorizations();
});

it('declares Spotify’s tools only while a token is actually held', async () => {
  const { declaredToolNames, personalChatTools } = await importTs(
    path.join(repoRoot, 'features', 'chat', 'src', 'personal-tools.ts'),
  );
  const { ACTION_TOOLS, READ_TOOLS } = await importTs(personalFile('tools', 'executor.ts'));
  const { geminiReadTools } = await importTs(personalFile('tools', 'read-declarations.ts'));
  const { connectorForAction, geminiActionTools } = await importTs(
    personalFile('tools', 'action-declarations.ts'),
  );
  const { connectProducts } = await importTs(personalFile('connectors', 'connect.ts'));
  const auth = await resetAuthorizations();
  await resetProfile();
  await resetConnections();

  assert.equal(geminiReadTools([]), null, 'an empty connector list produced an empty tool block');
  assert.equal(geminiActionTools([]), null);

  assert.deepEqual(
    geminiReadTools(['spotify']).functionDeclarations.map((declaration) => declaration.name),
    [READ_TOOLS.listTopMusic, READ_TOOLS.listSavedTracks, READ_TOOLS.listSpotifyPlaylists],
  );
  assert.deepEqual(
    geminiActionTools(['spotify']).functionDeclarations.map((declaration) => declaration.name),
    [ACTION_TOOLS.createSpotifyPlaylist],
  );

  // The two playlist actions are not interchangeable, and the scope request for one
  // must never be made against the other's provider.
  assert.equal(connectorForAction(ACTION_TOOLS.createSpotifyPlaylist), 'spotify');
  assert.equal(connectorForAction(ACTION_TOOLS.createPlaylist), 'youtube');
  assert.equal(connectorForAction('not_a_tool'), undefined);

  await connectProducts(['spotify'], { tokens: grantingTokens() });
  const on = declaredToolNames(personalChatTools({ personalize: true }));
  assert.ok(on.has(READ_TOOLS.listTopMusic), 'a connected Spotify declared no read tool');
  assert.ok(on.has(ACTION_TOOLS.createSpotifyPlaylist), 'a connected Spotify declared no action tool');

  /*
   * The whole point of separating connection from authorization, exercised: a 401
   * that survived its retry marks the product expired, and the *next* turn stops
   * being told the product exists. Before this, the connection list said Spotify,
   * the tool was declared, the model spent a call on it, and the reply was an
   * apology naming a setting.
   */
  auth.authLossHandler('spotify')();
  const after = declaredToolNames(personalChatTools({ personalize: true }));
  assert.equal(after.has(READ_TOOLS.listTopMusic), false,
    'an expired Spotify was still offered as a readable product');
  assert.equal(after.has(ACTION_TOOLS.createSpotifyPlaylist), false);
  assert.equal(after.size, 1, 'only retrieval should survive an expired connection');

  await resetConnections();
  await resetAuthorizations();
});

it('declares every array parameter with an element type', async () => {
  const { CONNECTORS } = await importTs(personalFile('connectors', 'registry.ts'));
  const { anthropicActionTools, geminiActionTools, openaiActionTools } = await importTs(
    personalFile('tools', 'action-declarations.ts'),
  );
  const { geminiReadTools } = await importTs(personalFile('tools', 'read-declarations.ts'));
  const all = CONNECTORS.map((connector) => connector.id);

  /*
   * Gemini rejects an ARRAY parameter with no `items`, and rejects the whole
   * request rather than that one parameter — so a tool declared without it is not a
   * tool with a loose schema, it is a tool the model is never shown and a turn that
   * fails for a reason naming nothing in particular. `create_spotify_playlist` was
   * implemented, routed and never declared for exactly one release because of this.
   */
  const blocks = [geminiActionTools(all), geminiReadTools(all)];
  for (const block of blocks) {
    for (const declaration of block.functionDeclarations) {
      for (const [key, property] of Object.entries(declaration.parameters.properties)) {
        assert.equal(property.type, property.type.toUpperCase(),
          `${declaration.name}.${key} is not in Gemini's uppercase dialect`);
        if (property.type !== 'ARRAY') continue;
        assert.equal(property.items?.type, 'STRING',
          `${declaration.name}.${key} is an ARRAY with no element type`);
      }
    }
  }

  const tracks = geminiActionTools(['spotify']).functionDeclarations[0].parameters.properties.tracks;
  assert.deepEqual(tracks.type, 'ARRAY');
  assert.deepEqual(tracks.items, { type: 'STRING' });

  // The other two providers take JSON Schema, where lowercase is correct and the
  // property table passes through untranslated. Two dialects, one source table.
  const openai = openaiActionTools(['spotify'])[0].function.parameters.properties.tracks;
  const anthropic = anthropicActionTools(['spotify'])[0].input_schema.properties.tracks;
  assert.equal(openai.type, 'array');
  assert.deepEqual(openai.items, { type: 'string' });
  assert.equal(anthropic.type, 'array');
  assert.deepEqual(anthropic.items, { type: 'string' });
});

it('reads a track list however the model spelled it', async () => {
  const { ACTION_TOOLS, READ_TOOLS, executePersonalTool } = await importTs(
    personalFile('tools', 'executor.ts'),
  );

  const seen = [];
  const deps = {
    actions: {
      createSpotifyPlaylist: async (input) => {
        seen.push(input);
        return 'Created it.';
      },
    },
  };

  const run = (args) => executePersonalTool(ACTION_TOOLS.createSpotifyPlaylist, args, deps);

  /*
   * Three shapes, all seen from production models. The comma-separated string is the
   * reason this is not a two-line function: a model asked for a playlist of five
   * songs quite often sends `"a, b, c, d, e"`, and reading that as one track title
   * produces one failed search where five would have succeeded.
   */
  await run({ title: 'Mix', tracks: ['Weird Fishes — Radiohead', 'Nightcall — Kavinsky'] });
  await run({ title: 'Mix', tracks: '["Weird Fishes — Radiohead", "Nightcall — Kavinsky"]' });
  await run({ title: 'Mix', tracks: 'Weird Fishes — Radiohead, Nightcall — Kavinsky' });
  for (const input of seen) {
    assert.deepEqual(input.tracks, ['Weird Fishes — Radiohead', 'Nightcall — Kavinsky'],
      'a track list arrived in a shape the action could not use');
  }

  // No tracks is a real request — "make me a playlist for studying" — and gets an
  // empty playlist plus a sentence saying so, not an error.
  await run({ title: 'Mix' });
  assert.equal(seen[3].tracks, undefined);
  await run({ title: 'Mix', tracks: [] });
  assert.equal(seen[4].tracks, undefined);

  const untitled = await run({ tracks: ['a'] });
  assert.match(untitled.text, /needs a title/);
  assert.equal(seen.length, 5, 'a titleless playlist reached the action layer');

  /*
   * Nothing injected means nothing connected, and both halves have to say so in a
   * sentence. A read that answered with silence would be read as "no saved tracks",
   * and a model that treats silence as data invents the contents of an account.
   */
  const action = await executePersonalTool(ACTION_TOOLS.createSpotifyPlaylist, { title: 'Mix' }, {});
  assert.match(action.text, /Settings → Connected Apps/);
  const list = await executePersonalTool(READ_TOOLS.listSavedTracks, {}, {});
  assert.match(list.text, /not connected/);
  assert.match(list.text, /Do not guess/);

  // A call belonging to another executor must pass through, not be answered on that
  // executor's behalf.
  assert.equal(await executePersonalTool('generate_image', {}, {}), null);
});

it('turns Spotify listening into taste bullets and nothing finer', async () => {
  const { readSpotifySignals } = await importTs(personalFile('connectors', 'spotify', 'spotify.ts'));

  const requests = [];
  const artists = [
    { name: 'Neon Aqueduct', genres: ['synthwave', 'chiptune'] },
    { name: 'Paper Lantern Orchestra', genres: ['synthwave', 'chiptune'] },
    { name: 'Halcyon Drift', genres: ['synthwave'] },
    { name: 'Umber Fields', genres: ['ambient'] },
  ];
  const fetchJson = async (url) => {
    requests.push(url);
    return { items: artists };
  };

  const signals = await readSpotifySignals(fetchJson);

  // One request, for artists over the longest window. A four-week window would
  // rewrite the profile every month on the strength of one album, and the profile is
  // supposed to hold what is stable about someone.
  assert.equal(requests.length, 1);
  assert.match(requests[0], /\/me\/top\/artists\?/);
  assert.match(requests[0], /time_range=long_term/);

  /*
   * Genres survive at three sightings, artists at three names. `chiptune` appears
   * twice here and is dropped — two artists sharing a label is a coincidence, and a
   * profile bullet is a claim about the person that outlives the conversation.
   */
  assert.deepEqual(signals.map((signal) => signal.text), [
    'Listens to synthwave',
    'Listens to Neon Aqueduct',
    'Listens to Paper Lantern Orchestra',
    'Listens to Halcyon Drift',
  ]);
  assert.equal(signals.some((signal) => /chiptune|ambient/.test(signal.text)), false,
    'a genre below the threshold became a stated fact about the user');

  for (const signal of signals) {
    assert.equal(signal.section, 'interests');
    assert.equal(signal.source, 'Spotify');
    assert.ok(signal.evidence, 'a bullet with no evidence cannot be explained to the user');
  }

  // No listening, no claims. An account Willow cannot read contributes nothing
  // rather than an empty-sounding bullet.
  assert.deepEqual(await readSpotifySignals(async () => ({ items: [] })), []);
  assert.deepEqual(await readSpotifySignals(async () => null), []);
});

// ── 13. Card ids, connector ids, and the three lists that must agree ─────────

it('keeps the card map, the registry and the stored-id whitelist in step', async () => {
  const { CARD_CONNECTORS, isCardConnectable, providersForCard } = await importTs(
    path.join(repoRoot, 'apps', 'studio', 'src', 'settings', 'tabs', 'connected-apps', 'connector-map.ts'),
  );
  const { CONNECTORS } = await importTs(personalFile('connectors', 'registry.ts'));

  assert.deepEqual(providersForCard('spotify'), ['spotify']);
  assert.deepEqual(providersForCard('workspace'), ['google'],
    'the Workspace card spans five products and exactly one consent screen');
  assert.deepEqual(providersForCard('canva'), [],
    'a catalogue-only card claimed a provider, which would give it a live switch');
  assert.equal(isCardConnectable('spotify'), true);
  assert.equal(isCardConnectable('canva'), false);

  const registryIds = CONNECTORS.map((connector) => connector.id).sort();
  const mapped = [...new Set(Object.values(CARD_CONNECTORS).flat())].sort();

  /*
   * Asserted in this direction only. The reverse — every key of `CARD_CONNECTORS` is
   * a card id — is false on purpose: `gmail`, `calendar`, `docs`, `drive` and `tasks`
   * are Workspace children, drawn by `ChildCard`, which has no switch. Their entries
   * are there for a future standalone card and reach nothing today.
   */
  assert.deepEqual(mapped, registryIds,
    'a connector exists that no card can reach, or a card maps an id that is not a connector');

  /*
   * `connections-store.ts` spells its whitelist out rather than importing the
   * registry, because the registry reaches every connector module and several reach
   * back — the import would be a cycle. The cost of the duplication is this test: a
   * connector missing from that list connects, works for the session, and is
   * silently dropped on the next load.
   */
  const store = codeOnly(read('platform', 'personal', 'src', 'connectors', 'connections-store.ts'));
  const literal = store.match(/const VALID[^[]*\[([^\]]*)\]/);
  assert.ok(literal, 'the stored-id whitelist is no longer a literal this test can read');
  const valid = [...literal[1].matchAll(/'([^']+)'/g)].map(([, id]) => id).sort();
  assert.deepEqual(valid, registryIds,
    'the stored-connection whitelist and the registry disagree about which ids exist');
});

it('computes a switch’s disabled reason in the hook, and only reads it in the tab', async () => {
  const hook = read('apps', 'studio', 'src', 'settings', 'tabs', 'connected-apps', 'use-connections.ts');
  const tab = codeOnly(settingsTab('connected-apps', 'ConnectedAppsTab.tsx'));

  /*
   * Every input to "why is this switch dead" lives in the hook: which card is busy,
   * whether it has a connector at all, which providers it needs, and whether those
   * are configured. Recomputing that ladder in the tab would mean the tooltip and
   * the `disabled` attribute could disagree, which reads as a switch that refuses to
   * move for no reason.
   */
  assert.match(hook, /const disabledReason\s*=/, 'the disabled reason left the hook');
  assert.equal(tab.split('state.disabledReason').length - 1, 2,
    'both cards should read the reason, and neither should compute it');
  assert.equal(/Getting ready/.test(tab), false, 'the tab restated a reason the hook owns');
  assert.equal(/configured\s*===/.test(tab), false, 'the tab is deciding setup state again');

  // One hint per provider, named by the variable that fixes it. A user sent to set
  // the wrong client id goes looking for a problem that is not there.
  assert.match(tab, /setupHints\.map\(/, 'the tab stopped showing the per-provider setup hints');
  assert.match(hook, /VITE_GOOGLE_OAUTH_CLIENT_ID/);
  assert.match(hook, /VITE_SPOTIFY_CLIENT_ID/);
});

// ── 14. GitHub, the provider with no browser sign-in ─────────────────────────

/**
 * Stand up `sessionStorage`, and take it away again.
 *
 * Node has neither storage object, and `session-store.ts` swallows the failure by
 * design — it keeps an in-memory mirror so a browser with storage disabled still works
 * for the life of the page. Which means a test without this stub would pass entirely on
 * the mirror and prove nothing about where the token is actually kept. `localStorage` is
 * installed alongside it precisely so the test can assert nothing lands there.
 */
const withSessionStorage = async (body) => {
  const fakeStorage = () => {
    const map = new Map();
    return {
      map,
      getItem: (key) => (map.has(key) ? map.get(key) : null),
      setItem: (key, value) => {
        map.set(key, String(value));
      },
      removeItem: (key) => {
        map.delete(key);
      },
    };
  };
  const had = ['sessionStorage', 'localStorage'].map((name) => [
    name,
    Object.prototype.hasOwnProperty.call(globalThis, name),
    globalThis[name],
  ]);
  const session = fakeStorage();
  const local = fakeStorage();
  const install = (name, value) =>
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });

  install('sessionStorage', session);
  install('localStorage', local);
  try {
    return await body({ session, local });
  } finally {
    for (const [name, existed, previous] of had) {
      if (existed) install(name, previous);
      else delete globalThis[name];
    }
  }
};

it('asks GitHub once per read, and keeps “nothing matched” apart from “nothing worked”', async () => {
  const {
    isPullRequestFilter,
    listActiveRepos,
    listAssignedIssues,
    listPullRequests,
  } = await importTs(personalFile('connectors', 'github', 'github.ts'));

  const urls = [];
  const answering = (payload) => async (url) => {
    urls.push(url);
    return payload;
  };

  /*
   * One request, not one per repository.
   *
   * The obvious shape — list the repositories, then list each one's pull requests —
   * costs a request per repository against a rate limit counted per token, and misses
   * everything in a repository the user does not own, which for anyone working with
   * other people is most of what they care about.
   */
  const items = [
    {
      number: 12,
      title: 'Fix the retry loop',
      html_url: 'https://github.com/acme/api/pull/12',
      repository_url: 'https://api.github.com/repos/acme/api',
      user: { login: 'octocat' },
      updated_at: '2026-08-14T10:00:00Z',
      draft: true,
      comments: 3,
    },
    // Junk from the API is dropped rather than turned into a line with `undefined` in
    // it: a model shown "#undefined" reports it to the user as a real pull request.
    { title: 'No number' },
    null,
  ];
  const pulls = await listPullRequests(answering({ items }), { login: 'octocat' });
  assert.equal(urls.length, 1, 'a read fanned out into a request per repository');
  assert.deepEqual(pulls, [
    {
      number: 12,
      title: 'Fix the retry loop',
      url: 'https://github.com/acme/api/pull/12',
      // Pulled out of `repository_url`, because the search API returns the repository
      // as an API URL and `acme/api` is how a person refers to it.
      repo: 'acme/api',
      author: 'octocat',
      updated: '2026-08-14T10:00:00Z',
      draft: true,
      comments: 3,
    },
  ]);

  const q = (url) => decodeURIComponent(new URL(url).searchParams.get('q'));
  assert.equal(q(urls[0]), 'is:pr is:open involves:octocat');
  const params = new URL(urls[0]).searchParams;
  assert.equal(params.get('sort'), 'updated', 'the newest activity has to come first');
  assert.equal(params.get('per_page'), '20');

  /*
   * `involves` is GitHub's union of authored, assigned, mentioned and
   * review-requested, which makes it the right default. `review-requested` is the one
   * that answers the question people actually have, because a pull request waiting on
   * your review is blocking somebody else — so the mapping onto GitHub's own qualifier
   * names is checked rather than assumed. `assigned` is the one that differs.
   */
  urls.length = 0;
  for (const filter of ['involves', 'author', 'assigned', 'review-requested']) {
    await listPullRequests(answering({ items: [] }), { login: 'octocat', filter });
  }
  assert.deepEqual(urls.map(q), [
    'is:pr is:open involves:octocat',
    'is:pr is:open author:octocat',
    'is:pr is:open assignee:octocat',
    'is:pr is:open review-requested:octocat',
  ]);

  // The filter arrives from a model, so an unrecognised one has to be recognisable as
  // such before it reaches the qualifier and quietly becomes `undefined:octocat`.
  assert.equal(isPullRequestFilter('review-requested'), true);
  assert.equal(isPullRequestFilter('reviewRequested'), false);
  assert.equal(isPullRequestFilter(undefined), false);
  assert.equal(isPullRequestFilter('constructor'), false,
    'a prototype property passed for a filter name');

  // Limits come from a model too. Clamped rather than trusted: a per_page of 5000 is a
  // request GitHub rejects outright, and 0 reads nothing while looking like it worked.
  urls.length = 0;
  await listAssignedIssues(answering({ items: [] }), { login: 'octocat', limit: 5000 });
  await listAssignedIssues(answering({ items: [] }), { login: 'octocat', limit: 0 });
  await listAssignedIssues(answering({ items: [] }), { login: 'octocat', limit: -5 });
  await listAssignedIssues(answering({ items: [] }), { login: 'octocat', limit: 7.6 });
  assert.deepEqual(urls.map((url) => new URL(url).searchParams.get('per_page')),
    ['50', '20', '1', '7']);
  assert.equal(q(urls[0]), 'is:issue is:open assignee:octocat');

  /*
   * The distinction the whole connector rests on. An empty list is an answer — "you
   * have nothing waiting" — and a null is a connection that needs attention. A layer
   * that collapses the two tells someone they have no open pull requests because their
   * token expired.
   */
  assert.deepEqual(await listPullRequests(answering({ items: [] }), { login: 'octocat' }), []);
  assert.equal(await listPullRequests(answering(null), { login: 'octocat' }), null);
  assert.equal(await listPullRequests(answering({}), { login: 'octocat' }), null,
    'a response with no items array was read as “nothing waiting”');
  assert.deepEqual(await listActiveRepos(answering([])), []);
  assert.equal(await listActiveRepos(answering(null)), null);

  // Organization membership included, because for most people the repositories that
  // matter are not the ones they own.
  urls.length = 0;
  await listActiveRepos(answering([]));
  assert.match(new URL(urls[0]).searchParams.get('affiliation'), /organization_member/);
  assert.equal(new URL(urls[0]).searchParams.get('sort'), 'pushed');
});

it('turns GitHub into languages, and never into a repository name', async () => {
  const { readGithubSignals } = await importTs(personalFile('connectors', 'github', 'github.ts'));

  const repo = (name, language, isPrivate = false) => ({
    full_name: name,
    language,
    private: isPrivate,
    description: `The ${name} service`,
    pushed_at: '2026-08-01T00:00:00Z',
  });
  const repos = [
    repo('acme/api', 'TypeScript'),
    repo('acme/web', 'TypeScript'),
    repo('octocat/notes', 'TypeScript'),
    repo('acme/project-thunderbird', 'Rust', true),
    repo('acme/tools', 'Rust'),
    repo('octocat/dotfiles', ''),
  ];

  const signals = await readGithubSignals(async () => repos);

  /*
   * Three repositories before a language becomes a claim. Everybody has a stray
   * repository in something they tried for an evening, and a profile bullet claiming
   * they write it is both wrong and hard for the user to trace back to its cause.
   */
  assert.deepEqual(signals.map((signal) => signal.text), ['Writes TypeScript']);
  assert.equal(signals.some((signal) => /Rust/.test(signal.text)), false,
    'a language below the threshold became a stated fact about the user');

  /*
   * The line this connector exists to hold. A fine-grained token usually sees private
   * repositories, and their names are frequently the most sensitive string in the whole
   * account — an unannounced product, a client, an acquisition. A profile bullet is a
   * standing claim that gets resent to a model on later turns, so it carries languages
   * and never a name, a description or a visibility flag.
   */
  const written = JSON.stringify(signals);
  for (const name of ['acme/api', 'acme/web', 'project-thunderbird', 'dotfiles', 'service']) {
    assert.equal(written.includes(name), false,
      `a repository name or description reached the profile: ${name}`);
  }
  for (const signal of signals) {
    assert.equal(signal.section, 'interests');
    assert.equal(signal.source, 'GitHub');
    assert.ok(signal.evidence, 'a bullet with no evidence cannot be explained to the user');
  }

  // Nothing readable, nothing claimed — including the failure case, which must not
  // become "writes nothing".
  assert.deepEqual(await readGithubSignals(async () => []), []);
  assert.deepEqual(await readGithubSignals(async () => null), []);
});

it('keeps a pasted GitHub token in sessionStorage, and verifies it before storing it', async () => {
  await withSessionStorage(async ({ session, local }) => {
    const { createGithubTokenSource, saveGithubToken, verifyGithubToken } = await importTs(
      personalFile('connectors', 'github', 'pat-token-source.ts'),
    );
    const store = await importTs(personalFile('connectors', 'github', 'session-store.ts'));
    store.clearGithubGrant();

    const asked = [];
    const github = (reply) => async (url, init) => {
      asked.push({ url: String(url), auth: init?.headers?.Authorization });
      return reply;
    };
    const ok = { ok: true, json: async () => ({ login: 'octocat', name: 'The Octocat' }) };

    /*
     * Verification is the point; the login is a bonus. A pasted credential has no
     * consent screen to fail against, so this is the only moment anything can tell the
     * user they pasted the wrong thing — and a switch that flips on and then quietly
     * reads nothing is the exact failure this feature keeps working to avoid.
     */
    assert.equal(await saveGithubToken('ghp_wrong', github({ ok: false, status: 401 })), null);
    assert.equal(store.readGithubToken(), null, 'a token GitHub rejected was stored anyway');
    assert.equal(await verifyGithubToken('   ', github(ok)), null);
    assert.equal(asked.length, 1, 'a blank token was sent to GitHub');

    const identity = await saveGithubToken('  ghp_real  ', github(ok));
    assert.deepEqual(identity, { login: 'octocat', name: 'The Octocat' });
    assert.match(asked[1].url, /api\.github\.com\/user$/);
    assert.equal(asked[1].auth, 'Bearer ghp_real', 'the token was sent unwrapped or untrimmed');

    /*
     * sessionStorage, per tab, and this is the assertion that says so. A personal
     * access token is a bearer credential for someone's source code and GitHub will
     * mint one with a year's life; in `localStorage` it would sit in web storage
     * indefinitely, readable by anything that ever runs script on the origin, long
     * after the user stopped using the feature.
     */
    assert.equal(session.getItem('willow:github-token'), 'ghp_real');
    assert.equal(session.getItem('willow:github-login'), 'octocat');
    assert.equal(local.map.size, 0, 'a GitHub token was written to localStorage');

    // The login is cached beside the token because every interesting read is a search
    // naming the user, and looking it up per read doubles the requests against a rate
    // limit counted per token.
    assert.equal(store.readGithubLogin(), 'octocat');

    const source = createGithubTokenSource();
    assert.equal(await source.get([]), 'ghp_real');
    // `get` and `request` are the same function here, which is the honest mapping: the
    // two are split in the interface because asking costs a popup, and there is no
    // popup to open. The asking happens in Settings, before the switch is allowed on.
    assert.equal(await source.request([]), 'ghp_real');

    /*
     * Any invalidation drops it, unlike the other two providers. There is no cache to
     * clear and nothing to renew — a 401 on a personal access token means revoked,
     * expired or mistyped, and each of those is permanent until the user pastes a new
     * one. Keeping it would mean retrying a dead token on every read for the session.
     */
    source.invalidate([]);
    assert.equal(store.readGithubToken(), null);
    assert.equal(session.getItem('willow:github-token'), null);

    await saveGithubToken('ghp_real', github(ok));
    source.forget();
    assert.equal(store.readGithubToken(), null, 'a disconnect left the pasted token behind');
    assert.equal(session.getItem('willow:github-login'), null);
  });
});

it('spends 403 on a rate limit rather than on a dead GitHub token', async () => {
  const { createAuthorizedFetch } = await importTs(personalFile('connectors', 'authorized-fetch.ts'));
  const { authLossStatusesFor, promptsForConsent } = await importTs(
    personalFile('connectors', 'registry.ts'),
  );

  /*
   * A property of the provider, read from the registry by everything that builds a
   * fetch. Google and Spotify both answer an under-scoped request with 403, so taking
   * that as auth loss is what makes a half-granted consent screen visible instead of
   * silent. GitHub spends 403 on rate limiting, both the hourly limit and the abuse
   * one.
   */
  assert.deepEqual(authLossStatusesFor('github'), [401]);
  assert.deepEqual(authLossStatusesFor('gmail'), [401, 403]);
  assert.deepEqual(authLossStatusesFor('spotify'), [401, 403]);

  const run = async (id, status) => {
    const previous = globalThis.fetch;
    let lost = 0;
    let invalidated = 0;
    globalThis.fetch = async () => ({ status, ok: false, json: async () => ({}) });
    try {
      const fetchJson = createAuthorizedFetch({
        tokens: {
          get: async () => 'token',
          request: async () => 'token',
          invalidate: () => { invalidated += 1; },
        },
        scopes: ['scope'],
        authLossStatuses: authLossStatusesFor(id),
        onAuthLost: () => { lost += 1; },
      });
      assert.equal(await fetchJson('https://example.test/x'), null);
    } finally {
      globalThis.fetch = previous;
    }
    return { lost, invalidated };
  };

  // On the default, a burst of reads would come back 403, the connector would be marked
  // expired, and the user would be told to reconnect a token that was never the problem
  // and would have worked again in a minute.
  assert.deepEqual(await run('github', 403), { lost: 0, invalidated: 0 });
  assert.deepEqual(await run('gmail', 403), { lost: 1, invalidated: 1 });

  // 401 is auth loss everywhere, after exactly one retry — the common cause is a token
  // that expired between being cached and being used.
  assert.deepEqual(await run('github', 401), { lost: 1, invalidated: 2 });

  /*
   * And the matching fact about the other end of the flow: a `request` that comes back
   * empty means the user closed the consent screen for Google and Spotify, and means
   * there is no token pasted for GitHub. Telling someone their permission window was
   * blocked when no window exists sends them hunting for a popup blocker.
   */
  assert.equal(promptsForConsent('gmail'), true);
  assert.equal(promptsForConsent('spotify'), true);
  assert.equal(promptsForConsent('github'), false);

  const { connectProduct } = await importTs(personalFile('connectors', 'connect.ts'));
  const empty = { get: async () => null, request: async () => null, invalidate: () => {} };
  assert.deepEqual(await connectProduct('github', { tokens: empty }),
    { ok: false, reason: 'needs-token' });
  assert.deepEqual(await connectProduct('gmail', { tokens: empty }),
    { ok: false, reason: 'declined' });

  const hook = read('apps', 'studio', 'src', 'settings', 'tabs', 'connected-apps', 'use-connections.ts');
  assert.match(hook, /case 'needs-token':/, 'the hook has no sentence for the GitHub refusal');
});

it('gives GitHub read tools and no write tool anywhere', async () => {
  const { SCOPES } = await importTs(personalFile('connectors', 'scopes.ts'));
  const { CONNECTORS, writeScopesFor } = await importTs(personalFile('connectors', 'registry.ts'));
  const { READ_TOOLS } = await importTs(personalFile('tools', 'executor.ts'));
  const { connectorForRead, geminiReadTools } = await importTs(
    personalFile('tools', 'read-declarations.ts'),
  );
  const { geminiActionTools } = await importTs(personalFile('tools', 'action-declarations.ts'));

  /*
   * No writes, and not for lack of endpoints. Creating a pull request or commenting on
   * an issue is a public act in someone else's repository, and a model doing that from
   * a loosely-worded request is a different order of mistake from a wrongly-created
   * calendar event: the user cannot quietly delete it, other people are already
   * notified, and it is attached to their name. It also means the token only ever needs
   * read permission, which is what makes asking them to paste one defensible.
   */
  assert.deepEqual(SCOPES.github.write, []);
  assert.deepEqual(writeScopesFor('github'), []);
  // `null`, not an empty block: Gemini rejects a `functionDeclarations` block with
  // nothing in it, so "no action tools" has to be expressible as no block at all.
  assert.equal(geminiActionTools(['github']), null);

  const declared = geminiReadTools(['github']).functionDeclarations;
  const names = declared.map((declaration) => declaration.name).sort();
  assert.deepEqual(names, [READ_TOOLS.listGithubIssues, READ_TOOLS.listGithubRepos, READ_TOOLS.listPullRequests].sort());
  for (const name of names) assert.equal(connectorForRead(name), 'github');

  /*
   * Every read tool says in its own description that Willow cannot act on GitHub. The
   * model only ever sees the declarations, so a limit stated in a comment or in the
   * settings card is a limit it has no way to know about — and the failure mode is it
   * promising the user it will merge something.
   */
  for (const declaration of declared) {
    assert.match(declaration.description, /never|cannot|only/i,
      `${declaration.name} does not say what Willow cannot do on GitHub`);
  }

  const repos = declared.find((declaration) => declaration.name === READ_TOOLS.listGithubRepos);
  assert.match(repos.description, /no file contents/i,
    'the repository tool does not say it cannot read code');

  // The registry's own caveat is what the Settings card shows, and the token's lifetime
  // is the one surprise worth stating there rather than discovering on the next reload.
  const github = CONNECTORS.find((connector) => connector.id === 'github');
  assert.match(github.caveat, /this tab only/i);
  assert.equal(github.providesSignals, true);
});

it('asks for a GitHub token on the card, with GitHub’s own permission names', async () => {
  const { CONNECTORS } = await importTs(personalFile('connectors', 'registry.ts'));
  const row = settingsTab('connected-apps', 'GithubTokenRow.tsx');
  const data = settingsTab('connected-apps', 'connectedAppsData.ts');

  /*
   * The permissions come from the registry rather than being retyped here, and that is
   * the point of the assertion: they are a checklist the user has to find and tick on
   * GitHub's website, so a list that drifts from the scopes the connector actually
   * needs sends them to grant the wrong three things.
   */
  assert.match(row, /connectorById\('github'\)\?\.readScopes/);
  assert.equal(/repository:pull_requests:read/.test(row), false,
    'a permission name was retyped in the UI instead of read from the registry');
  const scopes = CONNECTORS.find((connector) => connector.id === 'github').readScopes;
  assert.deepEqual(scopes.map((scope) => scope.url),
    ['repository:metadata', 'repository:pull_requests:read', 'repository:issues:read']);

  // The honest weakness of a pasted credential next to a consent screen: the
  // permissions are chosen on GitHub's site, so if the user grants more, Willow can do
  // more than it says — and nothing in the code can prevent that.
  assert.match(row, /you choose them on/i);
  assert.match(row, /github\.com\/settings\/personal-access-tokens\/new/);
  // Not saved to disk, so the field has to be off the browser's own autofill too.
  assert.match(row, /autoComplete="off"/);
  assert.match(row, /type="password"/);

  /*
   * Gemini's GitHub card describes a different product — theirs imports a repository
   * and reads the code in it, and its "cannot" list says in so many words that it
   * cannot retrieve pull requests. Willow's connector is the exact inverse, so keeping
   * the captured copy would have told the user the opposite of the truth twice over.
   */
  const card = data.slice(data.indexOf("id: 'github'"), data.indexOf("id: 'canva'"));
  assert.match(card, /defaultConnected: false/,
    'a card with a live switch was drawn as connected before anything was connected');
  assert.match(card, /pull requests/i);
  assert.match(card, /Read any file, commit or diff/);
  assert.equal(/Import code from/.test(card), false, 'the captured Gemini copy is still there');
  assert.equal(/Suggest code additions/.test(card), false);
});



/* ---------------------------------------------------------------------------
 * 15. Six cards that were removed on purpose.
 * ------------------------------------------------------------------------- */

/*
 * Google Photos, Google Business Profile, KBC, Contacts, Verify AI and Wix were all
 * on this list once and were taken off on request. Five of them were inert — a card
 * and a dead switch, no connector behind them — so the only way to tell "removed" from
 * "never extracted" later is to say so here.
 *
 * Two of the six are worth more than that, because someone will eventually try to put
 * them back and both have a real answer waiting:
 *
 * - **Photos** cannot be built at all. Google withdrew `photoslibrary.readonly` on
 *   31 March 2025; the surviving `…readonly.appcreateddata` sees only what the app
 *   itself uploaded, so a Photos connector would read an empty library and then
 *   describe the user from it. That is the worse of the two failures, because
 *   everything downstream would look like it was working.
 * - **Contacts** worked. It is the one entry that was deleted rather than never
 *   written, and its scope, reader, read tool and card all went together — a card with
 *   no connector is a dead switch, and a connector with no card can never be enabled.
 *   `connectors/types.ts` keeps the description of what its reader read.
 */
const REMOVED_CARDS = ['photos', 'business-profile', 'kbc', 'contacts', 'verify-ai', 'wix'];

it('keeps the six removed apps out of the catalogue and the connectors', async () => {
  const { connectorsForCard, isCardConnectable } = await importTs(
    path.join(repoRoot, 'apps', 'studio', 'src', 'settings', 'tabs', 'connected-apps', 'connector-map.ts'),
  );
  const { CONNECTORS } = await importTs(personalFile('connectors', 'registry.ts'));
  const data = settingsTab('connected-apps', 'connectedAppsData.ts');

  for (const id of REMOVED_CARDS) {
    assert.equal(data.includes(`id: '${id}'`), false, `the ${id} card came back`);
    assert.deepEqual(connectorsForCard(id), [], `${id} is mapped to a connector again`);
    assert.equal(isCardConnectable(id), false, `${id} draws a live switch again`);
    assert.equal(CONNECTORS.some((connector) => connector.id === id), false,
      `a ${id} connector appeared without a card to enable it`);
  }

  // The shorter list is deliberate, and the file says which cards are missing —
  // otherwise the next comparison against Gemini's settings reads as a bad extraction.
  assert.match(data, /Closely, not exactly/);
  for (const name of ['Photos', 'Business Profile', 'KBC', 'Contacts', 'Verify AI', 'Wix']) {
    assert.ok(data.includes(name), `the catalogue no longer records dropping ${name}`);
  }
});

it('leaves no Contacts or Photos machinery behind', async () => {
  const { SCOPES } = await importTs(personalFile('connectors', 'scopes.ts'));
  const { READ_TOOLS } = await importTs(personalFile('tools', 'executor.ts'));

  assert.equal(SCOPES.contacts, undefined, 'the Contacts scope entry survived its connector');
  assert.equal(READ_TOOLS.listRelationships, undefined);
  assert.equal(Object.values(READ_TOOLS).includes('list_contact_relationships'), false,
    'the relationships read tool is still declarable');

  assert.equal(
    fs.existsSync(personalFile('connectors', 'google', 'contacts.ts')), false,
    'the Contacts reader is still on disk with nothing importing it',
  );

  /*
   * No scope for either product anywhere in the package. For Contacts this is what
   * makes the removal real rather than cosmetic: `contacts.readonly` is a sensitive
   * scope, and a consent screen that still asks for it after the feature is gone is
   * asking for someone's address book to feed nothing.
   */
  for (const file of PERSONAL_SOURCES) {
    const source = codeOnly(fs.readFileSync(file, 'utf8'));
    const name = path.basename(file);
    assert.equal(/photoslibrary/.test(source), false, `${name} asks for a Photos scope`);
    assert.equal(/auth\/contacts/.test(source), false, `${name} asks for a Contacts scope`);
    assert.equal(/people\.googleapis\.com/.test(source), false, `${name} still calls the People API`);
  }

  // Both facts are written down where the next person looks, which is the connector
  // types rather than a test they have no reason to open.
  const types = read('platform', 'personal', 'src', 'connectors', 'types.ts');
  assert.match(types, /Google Photos/);
  assert.match(types, /Google Contacts/);
  assert.match(types, /contacts\.readonly/,
    'the record no longer says which scope Contacts spent');
});

