/**
 * The four pure helpers behind "edit the document" and "put the card where the AI
 * put it", executed rather than read.
 *
 * All four are pure functions over data the rest of the feature already has, which
 * is the whole reason they exist as functions: editing is a message-log rewrite and
 * placement is a string split, so neither needs a store, a save path or a browser.
 * What they do need is to be exactly right, because each one has a failure mode that
 * is silent:
 *
 *  - `applyCanvasEdit` writes to the WRONG revision and the user's typing lands on a
 *    version they are not looking at.
 *  - `canvasSplitOffset` cuts inside a fenced code block and the two halves of the
 *    fence render as literal backticks in two separate markdown instances.
 *  - `canvasSliceCitations` forgets to re-base and every chip in the second half of
 *    a turn points at the wrong sentence.
 *  - `collapseCanvasCardsFor` misses a key and the document renders twice — once in
 *    the panel, once as a full expanded card mid-reply.
 */
import { it } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importTs } from './ts-module.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const chatSrc = (...parts) => path.join(here, '..', '..', '..', 'features', 'chat', 'src', ...parts);

const {
  $expandedCanvasCards,
  applyCanvasEdit,
  buildCanvasDocs,
  canvasCardKey,
  canvasSliceCitations,
  canvasSplitOffset,
  collapseCanvasCardsFor,
  formatCanvasTimestamp,
  toggleCanvasCard,
} = await importTs(chatSrc('canvas', 'canvas-store.ts'));

const ref = (extra) => ({
  docId: 'doc-rain',
  kind: 'text',
  title: 'Rain',
  index: 0,
  content: 'v1',
  ...extra,
});

const thread = (...refsPerMessage) => refsPerMessage.map((refs, index) => ({
  id: `msg-${index}`,
  role: 'assistant',
  content: 'Here you go.',
  canvasRefs: refs,
}));

/* ------------------------------------------------------------- applyCanvasEdit */

/*
 * The edit goes to the LAST ref naming the document, across the whole thread. That
 * is the newest revision, which is what the panel and the newest card both show —
 * writing to the first would silently rewrite history and then be immediately
 * overwritten by the fold.
 */
it('writes an edit into the newest ref for the document', () => {
  const messages = thread([ref({ content: 'v1' })], [ref({ content: 'v2' })]);
  const next = applyCanvasEdit(messages, 'doc-rain', 'edited');

  assert.equal(next[0].canvasRefs[0].content, 'v1', 'the older revision is history');
  assert.equal(next[1].canvasRefs[0].content, 'edited');
  const docs = buildCanvasDocs(next);
  const doc = docs.get('doc-rain');
  assert.equal(doc.versions.length, 3, 'a hand edit is its own version, on top of the model\'s');
  assert.equal(doc.versions[1].content, 'v2', 'the model\'s text is still reachable by Undo');
  assert.equal(doc.versions[1].origin, 'model');
  assert.equal(doc.versions[2].content, 'edited');
  assert.equal(doc.versions[2].origin, 'user');
});

/*
 * The reported bug: "if I make some changes in the codebase and then press undo, it
 * wouldn't revert my manual changes rather it would make the version same as the
 * previous version before the last version the ai gave." Undo walks the version
 * list, so the fix is that the hand edit has a version of its own — and typing must
 * not mint one per keystroke, which is what the SECOND edit here checks.
 */
it('coalesces every later keystroke into that one version', () => {
  const messages = thread([ref({ content: 'v1' })]);
  const once = applyCanvasEdit(messages, 'doc-rain', 'edit one');
  const twice = applyCanvasEdit(once, 'doc-rain', 'edit two');
  const thrice = applyCanvasEdit(twice, 'doc-rain', 'edit three');
  const doc = buildCanvasDocs(thrice).get('doc-rain');
  assert.equal(doc.versions.length, 2, 'one model version and one user version, however long the typing');
  assert.equal(doc.versions[0].content, 'v1');
  assert.equal(doc.versions[1].content, 'edit three');
  assert.equal(thrice[0].canvasRefs[0].originalContent, 'v1', 'the model\'s text is what is held aside');
});

it('drops the extra version when the edit is typed back to the original', () => {
  const messages = thread([ref({ content: 'v1' })]);
  const edited = applyCanvasEdit(messages, 'doc-rain', 'oops');
  const undone = applyCanvasEdit(edited, 'doc-rain', 'v1');
  assert.equal(undone[0].canvasRefs[0].originalContent, undefined, 'nothing is held aside any more');
  assert.equal(undone[0].canvasRefs[0].editedAt, undefined);
  const doc = buildCanvasDocs(undone).get('doc-rain');
  assert.equal(doc.versions.length, 1, 'two identical versions would be worse than none');
});

/*
 * A model revision that lands ON a hand-edited one starts a fresh pair: its ref is
 * new, so its own `originalContent` is empty until the user types again.
 */
it('starts a new pair when the model writes over a hand edit', () => {
  const edited = applyCanvasEdit(thread([ref({ content: 'v1' })]), 'doc-rain', 'mine');
  const withModelTurn = [...edited, {
    id: 'msg-late', role: 'assistant', content: 'Updated.', canvasRefs: [ref({ content: 'v2' })],
  }];
  const doc = buildCanvasDocs(withModelTurn).get('doc-rain');
  assert.deepEqual(doc.versions.map((v) => v.content), ['v1', 'mine', 'v2']);
  const again = applyCanvasEdit(withModelTurn, 'doc-rain', 'mine again');
  const after = buildCanvasDocs(again).get('doc-rain');
  assert.deepEqual(after.versions.map((v) => v.content), ['v1', 'mine', 'v2', 'mine again']);
});

/*
 * Each version names the ref that produced it, which is how a card finds its own:
 * counting hits per message cannot tell a hand-edited ref's two versions apart.
 */
it('stamps every version with the ref that produced it', () => {
  const messages = thread([
    ref({ docId: 'doc-a', content: 'a1' }),
    ref({ docId: 'doc-b', content: 'b1' }),
  ]);
  const edited = applyCanvasEdit(messages, 'doc-b', 'b2');
  const doc = buildCanvasDocs(edited).get('doc-b');
  assert.deepEqual(doc.versions.map((v) => v.refIndex), [1, 1], 'both halves belong to ref 1');
  assert.deepEqual(doc.versions.map((v) => v.messageId), ['msg-0', 'msg-0']);
  assert.equal(buildCanvasDocs(edited).get('doc-a').versions[0].refIndex, 0);
});

it('leaves every other field of the ref alone', () => {
  const messages = thread([ref({ createdAt: 1234, index: 40, title: 'Rain' })]);
  const next = applyCanvasEdit(messages, 'doc-rain', 'edited');
  const written = next[0].canvasRefs[0];
  assert.equal(written.createdAt, 1234, 'the chip\'s timestamp is the revision\'s, not the edit\'s');
  assert.equal(written.index, 40, 'and the card does not move because the text changed');
  assert.equal(written.title, 'Rain');
});

it('picks the right ref when one turn wrote two documents', () => {
  const messages = thread([
    ref({ docId: 'doc-a', content: 'a1' }),
    ref({ docId: 'doc-b', content: 'b1' }),
  ]);
  const next = applyCanvasEdit(messages, 'doc-b', 'b2');
  assert.equal(next[0].canvasRefs[0].content, 'a1');
  assert.equal(next[0].canvasRefs[1].content, 'b2');
});

/*
 * Identity matters, not just equality: the autosave effect and every memo in
 * ChatView are keyed on the array, so returning a fresh one for a no-op edit would
 * write the file again on every debounce tick of a document nobody changed.
 */
it('returns the same array when nothing changed', () => {
  const messages = thread([ref({ content: 'v1' })]);
  assert.equal(applyCanvasEdit(messages, 'doc-rain', 'v1'), messages, 'an identical edit is not a change');
  assert.equal(applyCanvasEdit(messages, 'doc-missing', 'x'), messages, 'and an unknown document is not one either');
});

it('does not mutate the message it rewrites', () => {
  const messages = thread([ref({ content: 'v1' })]);
  const before = messages[0].canvasRefs;
  applyCanvasEdit(messages, 'doc-rain', 'edited');
  assert.equal(before[0].content, 'v1', 'React needs the previous tree intact');
});

/* ----------------------------------------------------------- canvasSplitOffset */

it('snaps a mid-sentence offset forward to the end of its line', () => {
  const text = 'First line.\nSecond line.\nThird line.\n';
  const at = canvasSplitOffset(text, 3);
  assert.equal(text.slice(0, at), 'First line.\n', 'a card cannot land inside a paragraph');
});

it('leaves an offset that is already on a boundary where it is', () => {
  const text = 'One.\n\nTwo.\n';
  assert.equal(canvasSplitOffset(text, 0), 0, 'a card the model put first stays first');
});

/*
 * The fence case. A cut between ``` and ``` produces two markdown instances, each
 * holding half a code block — which renders as literal backticks in both halves.
 */
it('moves a cut inside a fenced code block past the closing fence', () => {
  const text = 'Intro.\n\n```js\nconst a = 1;\nconst b = 2;\n```\n\nOutro.\n';
  const inside = text.indexOf('const b');
  const at = canvasSplitOffset(text, inside);
  const head = text.slice(0, at);
  assert.equal((head.match(/```/g) || []).length, 2, 'both fences end up on the same side');
  assert.ok(head.includes('const b = 2;'), 'and the whole block goes with them');
  assert.ok(!text.slice(at).includes('```'), 'nothing fenced is left behind');
});

it('clamps past the end of the text', () => {
  const text = 'Short.\n';
  assert.ok(canvasSplitOffset(text, 9999) <= text.length, 'a stale offset cannot slice past the string');
});

/* -------------------------------------------------------- canvasSliceCitations */

const CITATIONS = {
  sources: [
    { uri: 'https://a.example', title: 'A', domain: 'a.example' },
    { uri: 'https://b.example', title: 'B', domain: 'b.example' },
  ],
  citations: [
    { startIndex: 0, endIndex: 10, sourceIndices: [0] },
    { startIndex: 40, endIndex: 55, sourceIndices: [1] },
  ],
};

it('keeps only the chips that overlap the slice, re-based onto it', () => {
  const tail = canvasSliceCitations(CITATIONS, 30, 80);
  assert.equal(tail.citations.length, 1, 'the first chip belongs to the other half');
  assert.deepEqual(tail.citations[0], { startIndex: 10, endIndex: 25, sourceIndices: [1] });
});

/*
 * `sourceIndices` index into `sources`, so trimming that array to the sources a
 * slice happens to use would repoint every chip in the turn at the wrong card.
 */
it('carries the whole source list onto every slice', () => {
  const head = canvasSliceCitations(CITATIONS, 0, 20);
  assert.equal(head.sources.length, 2, 'trimming sources renumbers them');
  assert.deepEqual(head.citations[0].sourceIndices, [0], 'and the surviving chip still resolves');
});

it('clamps a chip that straddles the cut', () => {
  const head = canvasSliceCitations(CITATIONS, 0, 45);
  const straddler = head.citations[1];
  assert.equal(straddler.startIndex, 40);
  assert.equal(straddler.endIndex, 45, 'a chip cannot end past the text it is indexed against');
});

it('passes an unsliced turn straight through', () => {
  assert.equal(
    canvasSliceCitations(CITATIONS, 0, Number.MAX_SAFE_INTEGER),
    CITATIONS,
    'the un-split case must not allocate',
  );
  assert.equal(canvasSliceCitations(undefined, 0, 10), undefined);
});

/* ---------------------------------------------------- collapseCanvasCardsFor */

/*
 * The duplicate-render bug: collapsing the panel marks a card expanded, and opening
 * the panel again never unmarked it — so the same document rendered twice at once.
 */
it('clears every expanded card for one document and no others', () => {
  $expandedCanvasCards.set(new Set());
  toggleCanvasCard('msg-0', 'doc-rain');
  toggleCanvasCard('msg-3', 'doc-rain');
  toggleCanvasCard('msg-3', 'doc-other');
  assert.equal($expandedCanvasCards.get().size, 3);

  collapseCanvasCardsFor('doc-rain');
  const left = [...$expandedCanvasCards.get()];
  assert.deepEqual(left, [canvasCardKey('msg-3', 'doc-other')], 'a second document keeps its card');
});

it('leaves the set alone when there is nothing to clear', () => {
  $expandedCanvasCards.set(new Set());
  toggleCanvasCard('msg-0', 'doc-rain');
  const before = $expandedCanvasCards.get();
  collapseCanvasCardsFor('doc-nothing');
  assert.equal($expandedCanvasCards.get(), before, 'an unrelated open must not re-render the thread');
});

/* ------------------------------------------------------ formatCanvasTimestamp */

/*
 * The chip's second line, measured as "Aug 29, 6:39 PM" — no year in the current
 * year, a 12-hour clock, and a 2-digit minute.
 */
it('formats a same-year stamp the way the measured chip reads', () => {
  const at = new Date(2026, 7, 29, 18, 39).getTime();
  const now = new Date(2026, 11, 1).getTime();
  assert.equal(formatCanvasTimestamp(at, now), 'Aug 29, 6:39 PM');
});

it('adds the year once the stamp is not this year', () => {
  const at = new Date(2025, 0, 2, 9, 5).getTime();
  const now = new Date(2026, 0, 2).getTime();
  assert.equal(formatCanvasTimestamp(at, now), 'Jan 2, 2025, 9:05 AM');
});

it('reads midnight and noon as 12, not 0', () => {
  const now = new Date(2026, 0, 2).getTime();
  assert.match(formatCanvasTimestamp(new Date(2026, 0, 1, 0, 7).getTime(), now), /12:07 AM$/);
  assert.match(formatCanvasTimestamp(new Date(2026, 0, 1, 12, 7).getTime(), now), /12:07 PM$/);
});

it('returns nothing for a stamp it cannot read', () => {
  assert.equal(formatCanvasTimestamp(Number.NaN), '', 'the card falls back to its kind-and-version line');
});

/* -------------------------------------------- the cut, while the text arrives */

/*
 * The card is interleaved DURING the stream now, which is only safe if the cut
 * stops moving. `ref.index` is fixed when the tool call runs; what can move is
 * where the snap lands. These two tests are the evidence for that claim, replayed
 * one character at a time the way the reply actually arrives.
 */
it('holds one cut position once the line break after the call has arrived', () => {
  const full = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n';
  const index = 'First paragraph.'.length;
  const resolved = full.indexOf('\n', index);
  const seen = new Set();
  for (let n = index; n <= full.length; n += 1) {
    const text = full.slice(0, n);
    if (text.length <= resolved) continue;
    seen.add(canvasSplitOffset(text, index));
  }
  assert.equal(seen.size, 1, 'a cut that moves re-keys every slice, and the reveal restarts with it');
  assert.equal([...seen][0], resolved + 1, 'and it is the end of the line the call was made on');
});

/*
 * An unclosed fence is the case the live guard exists for: the snap has nowhere
 * safe to land, so it clamps to the end — no text under the cut, no split, and the
 * card stays after the body until the fence closes.
 */
it('keeps the cut at the end of the text while a fence is still open', () => {
  const opening = 'Here is the code.\n\n```js\nconst a = 1;\nconst b = 2;\n';
  /* The call landed INSIDE the block — which is where a fence can be split in half,
     and the only case the fence rule is about. */
  const index = opening.indexOf('const b');
  assert.equal(canvasSplitOffset(opening, index), opening.length, 'nothing may split inside a live fence');

  const closed = `${opening}\`\`\`\n\nAnd that is it.\n`;
  const at = canvasSplitOffset(closed, index);
  assert.ok(at < closed.length, 'once it closes there is somewhere to cut');
  assert.equal((closed.slice(0, at).match(/```/g) || []).length, 2, 'and both fences are above the card');
});
