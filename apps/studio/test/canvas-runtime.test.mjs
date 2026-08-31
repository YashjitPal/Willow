/**
 * The Canvas executor and the fold, run rather than read.
 *
 * `canvas-runtime.ts` is where a tool call becomes a document: it resolves which
 * document is meant, applies the targeted edits, decides what is a new version
 * and what is an error, and hands the model back the sentence it reads next.
 * None of that is visible to a source-text assertion, and all of it is the part
 * that produces "the second edit silently reverted the first" if the this-turn
 * and prior-turn states are read in the wrong order.
 *
 * The documents here are folded out of the message log by `buildCanvasDocs`,
 * exactly as ChatView does it, so the prior-turn half of every scenario is real
 * rather than hand-built.
 */
import { it } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importTs } from './ts-module.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const canvasDir = path.resolve(here, '..', '..', '..', 'features', 'chat', 'src', 'canvas');

const { createCanvasToolExecutor } = await importTs(path.join(canvasDir, 'canvas-runtime.ts'));
const { buildCanvasDocs, canvasDocId, currentCanvasDoc } = await importTs(path.join(canvasDir, 'canvas-store.ts'));
const { CANVAS_INSTRUCTIONS, applyCanvasUpdates } = await importTs(path.join(canvasDir, 'canvas-tools.ts'));
const { chatSystemPromptFor } = await importTs(path.join(canvasDir, '..', 'chat-model.ts'));

/**
 * An executor plus the refs it published.
 *
 * `contentLength` is a live counter the test can move, because the offset a ref
 * records is read at call time — that is what puts a card mid-message instead of
 * at the end of the reply.
 */
const harness = ({ priorDocs = new Map(), chatKey = 'Rainy day' } = {}) => {
  const refs = [];
  const state = { length: 0 };
  const run = createCanvasToolExecutor({
    chatKey,
    priorDocs,
    contentLength: () => state.length,
    publish: (ref) => { refs.push(ref); },
  });
  return { run, refs, state };
};

/** The message log a settled turn leaves behind, ready for `buildCanvasDocs`. */
const logOf = (...turns) => turns.map((refs, index) => ({
  id: `msg-${index}`,
  role: 'assistant',
  content: 'here you go',
  canvasRefs: refs,
}));

/* ----------------------------------------------------------------- creating */

it('publishes one full snapshot at the offset the reply had reached', async () => {
  const { run, refs, state } = harness();
  state.length = 42;
  const result = await run('create_canvas', {
    type: 'text',
    title: 'Rain',
    content: '# Rain\n\nSoft rain on the window.',
  });

  assert.equal(result.status, 'ok');
  assert.equal(refs.length, 1);
  assert.equal(refs[0].index, 42, 'the offset is read at call time — that is where the card renders');
  assert.equal(refs[0].kind, 'text');
  assert.equal(refs[0].title, 'Rain');
  assert.equal(refs[0].content, '# Rain\n\nSoft rain on the window.');
  assert.match(result.result, /Do not repeat the document in your reply/);
});

/*
 * The exact rejection the model quoted back in its thoughts. It is the correct
 * response to an empty call — an empty canvas is a bug the user has to look at —
 * so it stays, and the adapter is what has to stop producing empty calls.
 */
it('refuses a call with no content, in the words the model reads', async () => {
  const { run, refs } = harness();
  const result = await run('create_canvas', { type: 'text', title: 'Rain' });
  assert.deepEqual(result, {
    status: 'error',
    error: 'No content was provided. Call again with the complete document in `content`.',
  });
  assert.equal(refs.length, 0, 'a refused call is not a revision');
});

/*
 * Models fence code by reflex. A leading ```` ```html ```` inside a code canvas
 * is not a formatting nit: it reaches the Preview iframe as literal text and
 * breaks the running page.
 */
it('peels a wrapping fence off a code document', async () => {
  const { run, refs } = harness();
  await run('create_canvas', {
    type: 'code',
    language: 'HTML',
    title: 'Page',
    content: '```html\n<h1>hi</h1>\n```',
  });
  assert.equal(refs[0].kind, 'code');
  assert.equal(refs[0].language, 'html');
  assert.equal(refs[0].content, '<h1>hi</h1>');
});

it('infers a code document from a language alone', async () => {
  const { run, refs } = harness();
  await run('create_canvas', { language: 'python', content: 'print(1)' });
  assert.equal(refs[0].kind, 'code');
  assert.equal(refs[0].title, 'Untitled code', 'a missing title is defaulted, not refused');
});

/* ------------------------------------------------------------------ editing */

/*
 * Two edits in one turn, which is the case with no second source of truth: the
 * first revision exists only in the executor's own `turnRefs`, because a ref does
 * not reach the message log until the turn is saved. Reading the fold first here
 * is the bug that makes the second edit silently revert the first.
 */
it('edits what this same turn just wrote', async () => {
  const { run, refs } = harness();
  await run('create_canvas', { type: 'text', title: 'Rain', content: 'one\ntwo\nthree\n' });
  const result = await run('update_canvas', {
    updates: [{ find: 'two', replace: 'TWO' }],
  });

  assert.equal(result.status, 'ok', result.error);
  assert.equal(refs.length, 2, 'an edit is a new version, not a mutation');
  assert.equal(refs[1].docId, refs[0].docId, 'and it belongs to the same document');
  assert.equal(refs[1].content, 'one\nTWO\nthree\n');
  assert.equal(refs[0].content, 'one\ntwo\nthree\n', 'the earlier snapshot must stay steppable-back-to');
});

it('edits a document that only exists in the message log', async () => {
  const first = harness();
  await first.run('create_canvas', { type: 'text', title: 'Rain', content: 'one\ntwo\n' });
  const priorDocs = buildCanvasDocs(logOf(first.refs));

  const next = harness({ priorDocs });
  const result = await next.run('update_canvas', {
    doc_id: first.refs[0].docId,
    updates: [{ find: 'two', replace: 'second' }],
  });
  assert.equal(result.status, 'ok', result.error);
  assert.equal(next.refs[0].content, 'one\nsecond\n');
});

/*
 * An ambiguous anchor is a failure, not a first-match. Editing whichever
 * occurrence came first would change the document in the wrong place with no
 * error anywhere — the user's only evidence would be the wrong text.
 */
it('refuses an ambiguous anchor and publishes nothing', async () => {
  const { run, refs } = harness();
  await run('create_canvas', { type: 'code', language: 'js', title: 'Util', content: 'return null;\nreturn null;\n' });
  const result = await run('update_canvas', { updates: [{ find: 'return null;', replace: 'return 0;' }] });

  assert.equal(result.status, 'error');
  assert.match(result.error, /occurs 2 times/);
  assert.match(result.error, /"all": true/, 'the model must be told the way through');
  assert.equal(refs.length, 1, 'a failed edit must not become a version');
});

it('changes every occurrence when told to', async () => {
  const { run, refs } = harness();
  await run('create_canvas', { type: 'code', language: 'js', title: 'Util', content: 'a;\na;\n' });
  const result = await run('update_canvas', { updates: [{ find: 'a;', replace: 'b;', all: true }] });
  assert.equal(result.status, 'ok', result.error);
  assert.equal(refs[1].content, 'b;\nb;\n');
});

/*
 * `$&`, `$1` and `` $` `` keep their replacement meanings in `String.replace`
 * even with a string pattern, so a document containing them — a shell script, a
 * jQuery snippet, a price table — would be corrupted by its own contents.
 */
it('splices edits by index, so a $ in the text is just a $', () => {
  const applied = applyCanvasUpdates('echo "$@" and $& done', [
    { find: 'and $& done', replace: 'plus $& $1 $` end' },
  ]);
  assert.equal(applied.applied, 1);
  assert.equal(applied.content, 'echo "$@" plus $& $1 $` end');
});

it('applies the good edits and reports only the bad anchor', () => {
  const applied = applyCanvasUpdates('alpha beta gamma', [
    { find: 'alpha', replace: 'ALPHA' },
    { find: 'delta', replace: 'DELTA' },
  ]);
  assert.equal(applied.content, 'ALPHA beta gamma', 'partial success is deliberate');
  assert.equal(applied.applied, 1);
  assert.deepEqual(applied.failures, [{ find: 'delta', reason: 'not-found' }]);
});

/*
 * A call that changes nothing is refused rather than saved. Saved, it appends an
 * identical version, which the user meets as a Previous/Next step that does
 * nothing on screen.
 */
it('refuses an edit that produces an identical document', async () => {
  const { run, refs } = harness();
  await run('create_canvas', { type: 'text', title: 'Rain', content: 'one\n' });
  const result = await run('update_canvas', { updates: [{ find: 'one', replace: 'one' }] });
  assert.equal(result.status, 'error');
  assert.match(result.error, /identical document/);
  assert.equal(refs.length, 1);
});

it('renames without touching the text', async () => {
  const { run, refs } = harness();
  await run('create_canvas', { type: 'text', title: 'Rain', content: 'one\n' });
  const result = await run('update_canvas', { title: 'Rain, revised' });
  assert.equal(result.status, 'ok', result.error);
  assert.equal(refs[1].title, 'Rain, revised');
  assert.equal(refs[1].content, 'one\n', 'a rename is not a rewrite');
  assert.equal(refs[1].docId, refs[0].docId, 'the id is stable across a rename');
});

it('refuses a full rewrite sent alongside targeted edits', async () => {
  const { run } = harness();
  await run('create_canvas', { type: 'text', title: 'Rain', content: 'one\n' });
  const result = await run('update_canvas', {
    content: 'everything, again',
    updates: [{ find: 'one', replace: 'two' }],
  });
  assert.equal(result.status, 'error');
  assert.match(result.error, /either `updates` or `content`, not both/);
});

it('tells the model which document to use when the id is wrong', async () => {
  const { run, refs } = harness();
  await run('create_canvas', { type: 'text', title: 'Rain', content: 'one\n' });
  const result = await run('update_canvas', { doc_id: 'no-such-doc', updates: [{ find: 'one', replace: 'two' }] });
  assert.equal(result.status, 'error');
  assert.match(result.error, /No document with id "no-such-doc"/);
  assert.ok(result.error.includes(refs[0].docId), 'the ids that do exist are listed');
});

it('refuses an unknown tool without claiming it ran', async () => {
  const { run } = harness();
  const result = await run('delete_canvas', {});
  assert.equal(result.status, 'error');
  assert.match(result.error, /not available in this context/);
  assert.match(result.error, /Do not claim it ran/);
});

/* ----------------------------------------------------- which document is meant */

/*
 * A, then B, then A again. The Map is keyed in first-seen order, so its LAST key
 * is B while the document the user is working on is A. A bare `update_canvas`
 * has to mean A — insertion order would edit the wrong document, and the model
 * has no way to tell it did.
 */
it('reads "the current document" as the last one touched, not the last one created', async () => {
  const a = harness({ chatKey: 'Two docs' });
  await a.run('create_canvas', { type: 'text', title: 'Alpha', content: 'alpha one\n' });

  const b = harness({ chatKey: 'Two docs' });
  await b.run('create_canvas', { type: 'text', title: 'Beta', content: 'beta one\n' });

  const c = harness({ chatKey: 'Two docs', priorDocs: buildCanvasDocs(logOf(a.refs, b.refs)) });
  await c.run('update_canvas', { doc_id: a.refs[0].docId, updates: [{ find: 'alpha one', replace: 'alpha two' }] });

  const docs = buildCanvasDocs(logOf(a.refs, b.refs, c.refs));
  assert.equal([...docs.keys()].at(-1), b.refs[0].docId, 'insertion order still ends at Beta');
  assert.equal(currentCanvasDoc(docs).docId, a.refs[0].docId, 'but Alpha is what was last written to');

  const bare = harness({ chatKey: 'Two docs', priorDocs: docs });
  const result = await bare.run('update_canvas', { updates: [{ find: 'alpha two', replace: 'alpha three' }] });
  assert.equal(result.status, 'ok', result.error);
  assert.equal(bare.refs[0].docId, a.refs[0].docId);
});

/*
 * One title, called twice: the id is derived from the title, so this lands on one
 * document with two versions. That is what makes "write me a guide" followed by
 * "make it longer" revise the guide even when the model reaches for `create`
 * instead of `update` — and the result string says so, so its next turn is not
 * surprised.
 */
it('folds a second create of the same title into one document', async () => {
  const first = harness();
  await first.run('create_canvas', { type: 'text', title: 'Rain', content: 'one\n' });
  const second = harness({ priorDocs: buildCanvasDocs(logOf(first.refs)) });
  const result = await second.run('create_canvas', { type: 'text', title: 'Rain', content: 'one\ntwo\n' });

  assert.equal(second.refs[0].docId, first.refs[0].docId);
  assert.match(result.result, /already existed/);
  assert.match(result.result, /step back to the previous one/);

  const docs = buildCanvasDocs(logOf(first.refs, second.refs));
  assert.equal(docs.size, 1);
  assert.deepEqual(docs.get(first.refs[0].docId).versions.map((v) => v.content), ['one\n', 'one\ntwo\n']);
});

it('gives a renamed document its new name and keeps every version', async () => {
  const first = harness();
  await first.run('create_canvas', { type: 'text', title: 'Rain', content: 'one\n' });
  const second = harness({ priorDocs: buildCanvasDocs(logOf(first.refs)) });
  await second.run('update_canvas', { title: 'Rain, revised', updates: [{ find: 'one', replace: 'two' }] });

  const doc = buildCanvasDocs(logOf(first.refs, second.refs)).get(first.refs[0].docId);
  assert.equal(doc.title, 'Rain, revised', 'the newest title wins');
  assert.equal(doc.versions.length, 2);
  assert.deepEqual(doc.versions.map((v) => v.messageId), ['msg-0', 'msg-1'], 'each version names its turn');
  assert.equal(doc.lastTouchedIndex, 1);
});

it('keeps two different titles as two documents', async () => {
  const { run, refs } = harness({ chatKey: 'Two docs' });
  await run('create_canvas', { type: 'text', title: 'Alpha', content: 'a\n' });
  await run('create_canvas', { type: 'text', title: 'Beta', content: 'b\n' });
  assert.notEqual(refs[0].docId, refs[1].docId);
  assert.equal(buildCanvasDocs(logOf(refs)).size, 2, 'one turn can hold two documents');
});

it('derives an id that survives a chat rename in the same words', () => {
  assert.equal(
    canvasDocId('Rainy day', 'Rain', 'text'),
    canvasDocId('Rainy day', 'Rain', 'text'),
    'the id must be a pure function of what names it',
  );
  assert.notEqual(canvasDocId('Rainy day', 'Rain', 'text'), canvasDocId('Rainy day', 'Rain', 'code'));
});

/* ------------------------------------------------------------- the prompting */

/*
 * The instruction block is the only lever for two failures that are the model's
 * judgement rather than Willow's code, so the rules that address them are asserted
 * — a prompt regression is invisible until someone runs a turn on a small model.
 *
 * Both were reported. A claim with no call: "it says 'I have written…' i mean it
 * says it has done it but the canvas doesnt appear at all", on Flash Lite and not
 * on larger models. And edit scope: "i asked it to make the bird red instead of
 * yellow, it would change the background, the pillars, and also the bird".
 */
it('tells the model that saying it wrote a document is not writing one', () => {
  assert.match(CANVAS_INSTRUCTIONS, /Non-negotiable: step 2 is a real tool call/);
  assert.match(
    CANVAS_INSTRUCTIONS,
    /MUST be part of this same turn/,
    'the rule has to be imperative — a smaller model does not infer it from the descriptions',
  );
  assert.match(CANVAS_INSTRUCTIONS, /I've written/, 'naming the exact phrases is what makes it checkable mid-turn');
  assert.match(
    CANVAS_INSTRUCTIONS,
    /Never put the document in a fenced code block in the reply as a substitute/,
    'the other half of the same failure — the document arrives, just not as a document',
  );
});

it('tells the model to change only what was asked for', () => {
  assert.match(CANVAS_INSTRUCTIONS, /CHANGE ONLY WHAT WAS ASKED FOR/);
  assert.match(
    CANVAS_INSTRUCTIONS,
    /one value, colour, label, string, function or line is one or two `updates` entries/,
    'the rule is over the general case — a prompt carrying one reporter\'s example teaches the model that example',
  );
  assert.match(CANVAS_INSTRUCTIONS, /stays byte-identical/);
  assert.match(
    CANVAS_INSTRUCTIONS,
    /Reach for `content` only when the change genuinely is the whole document/,
    'a model handed both `updates` and `content` reaches for `content` unless told not to',
  );
});

/*
 * Composition. ChatGPT's `canmore` is a tool namespace injected into the prompt
 * alongside the base one, which is the shape Willow already had — but Willow also
 * carried `CARD_SYSTEM_PROMPT` into a canvas turn, and that section answers the same
 * question the canvas rules answer, differently: it invites a reply made of
 * `bento-cards` tiles. ~1.8k of text arguing for the wrong shape, using the word
 * "card" for a different thing than the canvas rules use it for.
 */
it('leaves the bento-cards section out of a canvas turn', () => {
  const plain = chatSystemPromptFor('gemini', {});
  const canvas = chatSystemPromptFor('gemini', { canvas: true });
  assert.match(plain, /bento-cards/, 'an ordinary turn keeps them');
  assert.ok(!/bento-cards/.test(canvas), 'a canvas turn must not be told to answer in tiles');
  assert.ok(
    canvas.length < plain.length - 1000,
    `the section is what should be missing, not a word of it (${plain.length - canvas.length} chars)`,
  );
});

it('keeps everything else about the turn identical', () => {
  const canvas = chatSystemPromptFor('gemini', { canvas: true });
  const noCardProvider = chatSystemPromptFor('moonshot', {});
  assert.equal(
    canvas,
    noCardProvider,
    'dropping cards must be exactly that — a provider without them already reads this prompt',
  );
});

/*
 * The block covers the DOCUMENT, not only the call. Tool descriptions can say what
 * a parameter means; they cannot say what a good document is, and a model with no
 * instruction there writes chat habits into a file the user is meant to keep —
 * placeholders, elided regions, a title that changes on every revision.
 */
it('says what a finished document looks like', () => {
  assert.match(CANVAS_INSTRUCTIONS, /keep that title stable across revisions/, 'the title is the export filename');
  assert.match(CANVAS_INSTRUCTIONS, /Write the whole thing/);
  assert.match(CANVAS_INSTRUCTIONS, /rest unchanged/, 'the elision habit has to be named to be refused');
  assert.match(CANVAS_INSTRUCTIONS, /ONE complete file that runs exactly as sent/);
});

/*
 * And the runtime, because none of it is inferable: only HTML previews, and the
 * frame withholds `allow-same-origin`, so storage is a stand-in that does not
 * survive a reload. A document that resumes from a saved value works on its second
 * run and looks broken on its first.
 */
it('describes the preview the document will actually run in', () => {
  assert.match(CANVAS_INSTRUCTIONS, /written as HTML runs live in the panel/, 'anything else is unrunnable code');
  assert.match(CANVAS_INSTRUCTIONS, /does not survive a reload/);
  assert.match(
    CANVAS_INSTRUCTIONS,
    /must work on a first run with none of it present/,
    'this is the difference between a game that starts and one that dies on line one',
  );
});

it('tells the model when NOT to reach for a canvas', () => {
  assert.match(CANVAS_INSTRUCTIONS, /What belongs in a canvas:/);
  assert.match(CANVAS_INSTRUCTIONS, /What does not:/);
  assert.match(
    CANVAS_INSTRUCTIONS,
    /When you are unsure, answer in the conversation\./,
    'a needless document changes the screen for nothing',
  );
});

/* ----------------------------------------------- grounded citation markers */

/*
 * After a search, Gemini's models write chunk ids into their own output —
 * `[1.1.9]`, `[1.1.2, 1.1.9, 1.3.4]`. The reply can handle them: the chat renderer
 * has the grounding offsets and draws source chips. A document cannot — it is a
 * plain string in a Markdown renderer, so they land in the user's essay as debris.
 * Reported with a screenshot of six of them in two paragraphs.
 */
it('strips citation markers out of a document', async () => {
  const { run, refs } = harness();
  await run('create_canvas', {
    type: 'text',
    title: 'TS13',
    content: 'Fans decoded the clues [1.1.2, 1.1.9, 1.3.4]. The earrings had 13 stones [1.1.9].\n',
  });
  assert.equal(refs[0].content, 'Fans decoded the clues. The earrings had 13 stones.\n');
});

it('leaves every bracket that is not one alone', async () => {
  const { run, refs } = harness();
  const content = [
    'A footnote marker [1] and a range [1.5] stay.',
    'A [labelled link](https://example.com) stays.',
    'A TODO [TODO] stays, and so does arr[1].',
    '',
    '## [1.1.9] - 2026-01-01',
    'A changelog heading is the one line where a version in brackets is the point.',
    '',
  ].join('\n');
  await run('create_canvas', { type: 'text', title: 'Notes', content });
  assert.equal(refs[0].content, content, 'nothing here is a citation marker');
});

it('strips them out of an edit too, but never out of its anchor', async () => {
  const { run, refs } = harness();
  await run('create_canvas', { type: 'text', title: 'TS13', content: 'one\ntwo\n' });
  const result = await run('update_canvas', {
    updates: [{ find: 'two', replace: 'the second line [1.2.3] of it' }],
  });
  assert.equal(result.status, 'ok', result.error);
  assert.equal(refs[1].content, 'one\nthe second line of it\n');
});

it('strips them from a full rewrite', async () => {
  const { run, refs } = harness();
  await run('create_canvas', { type: 'text', title: 'TS13', content: 'draft\n' });
  await run('update_canvas', { content: 'A rewritten draft [1.1.1].\n' });
  assert.equal(refs[1].content, 'A rewritten draft.\n');
});

it('tells the model not to write them in the first place', () => {
  assert.match(CANVAS_INSTRUCTIONS, /No inline citation markers in the document/);
});
