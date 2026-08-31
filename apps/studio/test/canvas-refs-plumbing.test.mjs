/**
 * The Canvas ref pipeline, end to end, asserted over source text.
 *
 * This file exists because of a bug the user hit four times in a row: a turn
 * that wrote a document rendered ONE sentence of preamble and nothing else. No
 * card, no panel, no error. The saved chats on disk had no `canvasRefs` key at
 * all, which made it look like the tool never ran.
 *
 * It ran. Two independent links in the chain dropped the ref:
 *
 *  1. `ChatView.finalizeAssistant` assigned a FIXED field list that omitted
 *     `canvasRefs`, and `buildTurnListener.onPhase` mirrored only
 *     `codeExecutions`. So the runner published a ref, checkpointed it, and even
 *     put it on its own `buildAssistantMessage` — and React state never saw it.
 *     ChatView's autosave then serialised `messages` over the runner's
 *     checkpoint, which is why the field is absent from all four saved files.
 *  2. `streamGeminiInteractions` read call arguments only from `arguments_delta`
 *     and `break`ed out whenever the terminal status was not `requires_action`,
 *     so a coalesced stream either invoked the tool with `{}` or lost the call.
 *
 * Both are invisible to the type checker (every field is optional) and invisible
 * to a render test (there is no DOM harness here). Source assertions are what is
 * left, and each one below names the failure it protects against.
 */
import { it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const read = (...p) => fs.readFileSync(path.join(repoRoot, ...p), 'utf8');

const CHAT_VIEW = () => read('features', 'chat', 'src', 'ChatView.tsx');
const RUNNER = () => read('features', 'chat', 'src', 'chat-turn-runner.ts');
const MESSAGE = () => read('features', 'chat', 'src', 'chat-message.ts');
const PANEL = () => read('features', 'chat', 'src', 'canvas', 'CanvasPanel.tsx');
const RESOURCE_PANEL = () => read('platform', 'ui', 'src', 'RichResourcePreview.tsx');
const ADAPTER = () => read('platform', 'ai', 'src', 'chat.ts');

/* ---------------------------------------------------------------- the runner */

it('publishes a ref the instant the tool call executes', () => {
  const runner = RUNNER();
  const publish = runner.match(/publish: \(ref\) => \{([\s\S]{0,420}?)\n {6}\},/);
  assert.ok(publish, 'could not locate the canvas executor publish callback');
  assert.match(
    publish[1],
    /record\.canvasRefs = \[\.\.\.\(record\.canvasRefs \?\? \[\]\), ref\];/,
    'publish must REPLACE the array — a push mutates in place, so identity stops being a change test',
  );
  assert.match(
    publish[1],
    /record\.listener\?\.onPhase\(record\);/,
    'without the phase ping the card cannot appear mid-stream',
  );
  assert.match(publish[1], /checkpoint\(record, deps\)/, 'the ref must survive a reload mid-turn');
});

it('keeps the ref on the runner\'s own assistant message', () => {
  assert.match(
    RUNNER(),
    /canvasRefs: record\.canvasRefs\?\.length \? record\.canvasRefs : undefined,/,
    'buildAssistantMessage is what background turns hand back; omitting the field loses the document',
  );
});

/* -------------------------------------------------------- ChatView -> React */

it('forwards canvasRefs through finalizeAssistant', () => {
  const view = CHAT_VIEW();
  assert.match(
    view,
    /canvasRefs\?: CanvasRef\[\],\r?\n {2}\) => \{/,
    'finalizeAssistant must take the refs as a parameter',
  );
  const assign = view.match(/\? \{ \.\.\.m, content, thinkingTime, isError, isGenerating: false[^}]*\}/);
  assert.ok(assign, 'could not locate the finalizeAssistant assignment');
  assert.match(
    assign[0],
    /codeExecutions, canvasRefs \}/,
    'the field list is assigned unconditionally, so an omitted key means `canvasRefs: undefined`',
  );
  assert.match(
    view,
    /record\.codeExecutions,\r?\n {10}record\.canvasRefs,\r?\n {8}\);/,
    'onSettled must pass record.canvasRefs, or the refs are wiped the moment the turn settles',
  );
});

it('mirrors canvasRefs onto the live message from onPhase', () => {
  const view = CHAT_VIEW();
  const phase = view.match(/const refs = record\.canvasRefs;([\s\S]{0,420}?)\n {4}\}/);
  assert.ok(phase, 'onPhase does not mirror record.canvasRefs — the card cannot appear until settle');
  assert.match(
    phase[1],
    /m\.canvasRefs !== refs/,
    'the guard must compare identity; a truthiness check re-renders on every phase tick',
  );
  assert.match(
    phase[1],
    /\{ \.\.\.m, canvasRefs: refs \}/,
    'the mirror must put the array on the message, not merely detect it',
  );
});

it('persists the refs it just mirrored', () => {
  const message = MESSAGE();
  const serialize = message.match(/export const serializeChatMessage[\s\S]{0,900}?\n\};/);
  assert.ok(serialize, 'could not locate serializeChatMessage');
  assert.ok(
    !/canvasRefs/.test(serialize[0]) || /\.\.\.rest|\.\.\.message/.test(serialize[0]),
    'serializeChatMessage must carry canvasRefs through by spread, never by an allow-list',
  );
  assert.match(
    message,
    /\|\| !!message\.canvasRefs\?\.length;/,
    'hasSavedMessageContent must count a document as content, or a card-only turn is dropped on save',
  );
});

/* ------------------------------------------------------------- the renderer */

it('renders one card per ref, not one per document', () => {
  const view = CHAT_VIEW();
  assert.match(
    view,
    /\.map\(\(ref, refIndex\) => \(\{ ref, refIndex \}\)\)/,
    'Gemini appends a chip per TURN frozen at that turn\'s version — mapping documents collapses them',
  );
  assert.match(view, /const cardKey = canvasCardKey\(msg\.id, ref\.docId\);/);
  assert.match(
    view,
    /expanded=\{expandedCanvasCards\.has\(cardKey\)\}/,
    'expansion is per card, so it must key on the message AND the document',
  );
});

/*
 * The duplicate render: the panel and a card are two views of one document, and the
 * user filed seeing both at once ("the preview appears in the sidebar and also within
 * the response… this is a serious bug"). Two halves fix it, and both are needed —
 * this is the render half.
 */
it('hides the card for the document that is open in the panel', () => {
  assert.match(
    CHAT_VIEW(),
    /\.filter\(\(entry\) => !openCanvas \|\| entry\.ref\.docId !== openCanvas\.docId\)/,
    'the open document must have exactly one view on screen',
  );
});

/* And the state half: a stale expanded flag left by a previous collapse. */
it('clears a stale expanded card when the panel opens', () => {
  const view = CHAT_VIEW();
  const handler = view.match(/const handleOpenCanvas = useCallback\(\(docId: string, version\?: number\) => \{([\s\S]{0,1400}?)\n {2}\}, \[/);
  assert.ok(handler, 'could not locate handleOpenCanvas');
  assert.match(
    handler[1],
    /collapseCanvasCardsFor\(docId\);/,
    'collapsing the panel marks a card expanded, and nothing else ever unmarks it',
  );
});

/*
 * ONE CARD PER DOCUMENT, showing the document's CURRENT text.
 *
 * Gemini appends a chip per turn; copying that is what the user filed — "every time
 * it makes the code changes, I notice that the document reappears, but it should
 * not… it should just change in the first place where it appeared". So a revision
 * has no card of its own, and the one card that exists is a live view.
 */
it('renders one card per document, at the turn that first wrote it', () => {
  const view = CHAT_VIEW();
  assert.match(
    view,
    /const home = canvasCardHomes\.get\(ref\.docId\);\r?\n\s*return !!home && home\.messageId === msg\.id && home\.refIndex === refIndex;/,
    'a revision must not add a second card',
  );
  assert.match(
    view,
    /const canvasCardHomes = useMemo\(\(\) => \{/,
    'the first appearance has to be computed across the whole thread, not per message',
  );
  assert.match(
    view,
    /if \(!homes\.has\(ref\.docId\)\) homes\.set\(ref\.docId, \{ messageId: message\.id, refIndex \}\);/,
    'FIRST appearance — a later ref must not move the card, or its expanded key changes and it collapses',
  );
  assert.match(
    view,
    /const version = doc\.versions\.length - 1;/,
    'the card shows the current text, so an edit changes it in place',
  );
  assert.match(
    view,
    /onOpen=\{\(\) => handleOpenCanvas\(ref\.docId, version\)\}/,
    'and Open lands on exactly what the card is showing',
  );
});

/*
 * Two things insert a version under an open panel: a follow-up turn, and the first
 * hand edit of a revision. Both would leave the panel's index pointing one entry
 * behind, which mid-typing reads as the editor scrubbing back to the AI's text.
 *
 * The user's OWN edit follows unconditionally — they were looking at whatever they
 * typed, and after the commit that text is the newest version, wherever they were
 * parked before. A model revision only follows a panel that sat at the end, so a
 * version deliberately opened from an old chip stays put.
 */
it('follows a version inserted under an open panel', () => {
  const view = CHAT_VIEW();
  const effect = view.match(/const canvasVersionCountsRef = useRef<Record<string, number>>\(\{\}\);([\s\S]{0,1600}?)\n {2}\}, \[canvasDocsInChat\]\);/);
  assert.ok(effect, 'could not locate the stick-to-the-end effect');
  assert.match(
    effect[1],
    /if \(edited === open\.docId\) \{/,
    'a hand edit wins over the parked-at-the-end rule',
  );
  assert.match(
    effect[1],
    /if \(!was \|\| now <= was \|\| open\.version !== was - 1\) return;/,
    'a panel opened at an old version on purpose must not follow a MODEL revision',
  );
  assert.match(effect[1], /\$openCanvas\.set\(\{ docId: open\.docId, version: now - 1 \}\);/);
  assert.match(
    view,
    /canvasEditedDocRef\.current = docId;/,
    'the edit handler is what flags the follow — the effect cannot tell who caused the change',
  );
});

/*
 * History on disk is one full document plus reverse patches, so the order of the
 * two conversions is load bearing in both directions.
 */
it('encodes the canvas history last, and decodes it first', () => {
  const view = CHAT_VIEW();
  assert.match(
    view,
    /const toSave = encodeCanvasHistory\(messages\.map\(serializeChatMessage\)\.filter\(hasSavedMessageContent\)\);/,
    'encoding before the empty-turn filter would chain a ref that never lands',
  );
  assert.match(
    view,
    /const withCanvasHistory = decodeCanvasHistory\(msgs\);/,
    'decoding after sanitize is decoding nothing — sanitize drops a ref with no content',
  );
  const load = view.indexOf('const withCanvasHistory = decodeCanvasHistory(msgs);');
  const sanitize = view.indexOf('canvasRefs: sanitizeSavedCanvasRefs(');
  assert.ok(load > 0 && sanitize > load, 'and it has to come first in the file, not just in intent');
});

/*
 * Placement, DURING the stream as well as after it.
 *
 * The offset is captured when the tool call runs and never moves, so the only thing
 * that shifts mid-stream is where `canvasSplitOffset` snaps it to — and that
 * resolves as soon as the line break or closing fence it is looking for arrives.
 * Deferring the split to a settled turn was visible as the card jumping: "for the
 * last paragraph it would start appearing above the canvas shifting it down and once
 * response generation is done, the third paragraph moves below the canvas".
 *
 * Two invariants keep the reveal intact: exactly one slice streams (the tail, which
 * is the text still being written), and a live cut with nothing under it does not
 * split at all — `onRevealComplete` lives on the streaming instance, and it is what
 * lets `actionsReady` ever become true.
 */
it('splits the body at the card offset while the turn is still writing', () => {
  const view = CHAT_VIEW();
  assert.match(
    view,
    /const cuts = bodyText\r?\n/,
    'the split must not wait for the turn to settle — that is the card jumping at the end',
  );
  assert.match(
    view,
    /\.filter\(\(\{ at \}\) => actionsReady \|\| bodyText\.slice\(at\)\.trim\(\)\.length > 0\)/,
    'a live split with an empty tail strands the reveal callback, and `actionsReady` never comes',
  );
  assert.match(view, /canvasSplitOffset\(bodyText, entry\.ref\.index\)/);
  assert.match(
    view,
    /const slice = \(start: number, end: number, live: boolean\) => \{/,
    'the slices must be distinguishable — only one of them is still being written',
  );
  assert.match(
    view,
    /const streaming = live && generating;/,
    'a head slice that re-animates is text the user already read being written twice',
  );
  assert.match(
    view,
    /citations=\{canvasSliceCitations\(msg\.citations, start, end\)\}/,
    'citation indices are offsets into the turn, so a slice starting at 400 moves every chip back 400',
  );
  /* A card held back by the guard above must still be somewhere. */
  assert.match(
    view,
    /const split = new Set\(cuts\.map\(\(\{ entry \}\) => entry\)\);/,
    'cards are rendered from `cuts`, so one filtered out of it would vanish from the thread',
  );
});

it('keeps the 949px bleed out of a panelled thread', () => {
  assert.match(
    CHAT_VIEW(),
    /bleed=\{!immersiveOpen\}/,
    'with a panel open the column is 476px; a bleeding card switches on horizontal scrolling across the shell',
  );
});

/*
 * A new document opens ITSELF — inline when nothing is open, and IN THE PANEL when
 * the panel is already the surface the user is working in: "if the user is viewing
 * the canvas in the right sidebar fixed mode… it should show the new one in place of
 * the old one… and it should open". Only a NEW document does either; a revision of
 * the one on screen needs neither, because the card is a live view and the panel
 * follows the version.
 */
it('expands a new card inline, or swaps the panel when one is open', () => {
  const view = CHAT_VIEW();
  const effect = view.match(/const canvasRefCountRef = useRef<number \| null>\(null\);([\s\S]{0,1400}?)\n {2}\}, \[messages, isGenerating, canvasCardHomes, handleOpenCanvas\]\);/);
  assert.ok(effect, 'could not locate the canvas auto-expand effect');
  assert.match(
    effect[1],
    /const home = canvasCardHomes\.get\(newest\.docId\);/,
    'the card lives at the document\'s first turn, so that is the key to expand',
  );
  assert.match(
    effect[1],
    /setCanvasCardExpanded\(home \? home\.messageId : newest\.messageId, newest\.docId, true\);/,
    'the card in the reply is what opens when no panel is up',
  );
  assert.match(
    effect[1],
    /if \(open\.docId !== newest\.docId\) handleOpenCanvas\(newest\.docId\);/,
    'with the panel open, a NEW document replaces the one in it',
  );
  assert.match(
    effect[1],
    /if \(seen === null \|\| count <= seen \|\| !newest\) return;/,
    'the first pass after a chat switch must adopt the count silently — loading a chat also grows it from zero',
  );
  assert.match(
    effect[1],
    /if \(!isGenerating\) return;/,
    'without the live gate, opening a saved chat expands a card in an old thread',
  );
  /*
   * And it runs BEFORE paint. A card's first commit is its collapsed chip, because
   * expansion lives in a store and a store cannot be written during render — so a
   * passive effect lets the chip paint once first, reported as "it still flashes the
   * card before showing the opened view for a bit".
   */
  assert.match(
    view,
    /const canvasRefCountRef = useRef<number \| null>\(null\);\r?\n {2}useLayoutEffect\(\(\) => \{/,
    'a passive effect paints the chip before the expanded card replaces it',
  );
  const calls = view.match(/(?<!const )handleOpenCanvas\(/g) || [];
  const presses = view.match(/onOpen=\{\(\) => handleOpenCanvas\(/g) || [];
  const swaps = view.match(/if \(open\.docId !== newest\.docId\) handleOpenCanvas\(newest\.docId\);/g) || [];
  assert.ok(presses.length > 0, 'the opener must still be reachable by a press');
  assert.equal(
    calls.length,
    presses.length + swaps.length,
    'the panel opens on a press, or swaps to a NEW document when it is already open — nothing else',
  );
  const handler = view.match(/const handleOpenCanvas = useCallback\(\(docId: string, version\?: number\) => \{[\s\S]{0,1400}?\n {2}\}, \[/);
  assert.ok(handler, 'and it is still the press-driven one');
});

it('shares the right-hand slot with the other three panels', () => {
  const view = CHAT_VIEW();
  const presence = /<AnimatePresence mode="wait">([\s\S]*?)<\/AnimatePresence>/.exec(view);
  assert.ok(presence, 'the right-hand panels must share one presence, in wait mode');
  assert.ok(presence[1].includes('<CanvasPanel'), 'CanvasPanel must sit inside the shared presence');
  assert.match(view, /key=\{`canvas-\$\{openCanvasDoc\.docId\}`\}/, 'a prefixed key, like the other panels');
});

/*
 * Measured off Gemini's immersive panel: scale 0.6 -> 1 over 500ms on
 * cubic-bezier(0.2,0,0,1), opacity 0 -> 1 over 200ms linear, origin-center, and
 * NO width animates.
 */
it('carries the measured immersive transition', () => {
  const panel = PANEL();
  assert.match(panel, /initial=\{\{ opacity: 0, scale: 0\.6 \}\}/, 'measured scale start');
  assert.match(panel, /animate=\{\{ opacity: 1, scale: 1 \}\}/);
  assert.match(panel, /scale: \{ duration: 0\.5, ease: \[0\.2, 0, 0, 1\] \}/, 'measured 500ms / cubic-bezier(0.2,0,0,1)');
  assert.match(panel, /opacity: \{ duration: 0\.2, ease: 'linear' \}/, 'measured 200ms linear');
  assert.match(panel, /origin-center/, 'the measured transform origin');
  assert.ok(
    !/animate=\{\{[^}]*width/.test(panel),
    'no width animates in the measured transition — animating one re-layouts the whole thread per frame',
  );
});

/*
 * And no leave animation, for BOTH panels that share the immersive slot — Gemini
 * removes its node in 47ms, and here an exit is worse than cosmetic. The grid snaps
 * to `minmax(0,1fr) 0fr` in the same commit the exit begins, and the exiting panel
 * is still the item in that collapsed track: with `min-w-0` and `overflow-hidden`
 * its automatic minimum is 0, so a fading panel is re-laid-out at zero width for
 * the whole fade, embedded document included, and then unmounts 200ms into a 500ms
 * slide. That was the reported "little lag while closing" — on the way out only,
 * because on the way in the panel is at its final width from frame one.
 */
it('takes the immersive panels out in one frame, with no leave animation', () => {
  for (const [name, source] of [['canvas', PANEL()], ['resource', RESOURCE_PANEL()]]) {
    assert.ok(
      !/\bexit=\{/.test(source),
      `the ${name} panel must not animate out — it is being crushed into a 0fr track while it does`,
    );
  }
});

/* ------------------------------------------- the Interactions tool handshake */

it('absorbs call arguments from whichever field carries them', () => {
  const adapter = ADAPTER();
  assert.match(
    adapter,
    /const absorbCallArguments = \(index: number, step: any\): void => \{/,
    'reading only `arguments_delta` is how a tool gets invoked with `{}`',
  );
  assert.match(
    adapter,
    /const raw = step\.arguments \?\? step\.args \?\? step\.input;/,
    'all three spellings have been seen on this API',
  );
  assert.match(
    adapter,
    /if \(text\.length > call\.whole\.length\) call\.whole = text;/,
    'absorb must only ever WIDEN, or a repeated terminal event truncates a completed call',
  );
});

/*
 * The buffer split, and why it is not tidiness.
 *
 * A `function_call` step opens with a placeholder `arguments: {}`. Absorbing that
 * into the same string the `arguments_delta` fragments append to leaves
 * `{}{"content":"…"}`, which does not parse — so the call reached the Canvas
 * executor with `{}` and came back "No content was provided. Call again with the
 * complete document in `content`." The model, reading that, could only conclude
 * it had sent the field it had in fact sent.
 */
it('keeps streamed fragments and whole values in separate buffers', () => {
  const adapter = ADAPTER();
  assert.match(
    adapter,
    /deltas: string; whole: string/,
    'one buffer cannot hold both a fragment run and a complete value',
  );
  assert.match(
    adapter,
    /if \(call && typeof delta\.arguments === 'string'\) call\.deltas \+= delta\.arguments;/,
    'fragments concatenate, and only ever into `deltas`',
  );
  assert.ok(
    !/call\.arguments \+=/.test(adapter),
    'appending to a buffer an absorbed `{}` may have landed in is the corruption itself',
  );
});

it('parses whichever argument buffer is the richer one', () => {
  const adapter = ADAPTER();
  assert.match(adapter, /const callArguments = \(call: \{ deltas: string; whole: string \}\): any => \{/);
  assert.match(
    adapter,
    /Object\.keys\(fromDeltas\)\.length >= Object\.keys\(fromWhole\)\.length \? fromDeltas : fromWhole;/,
    'a coalesced stream sends no deltas at all, so neither buffer can be preferred unconditionally',
  );
  assert.ok(
    !/JSON\.parse\(call\.arguments/.test(adapter),
    'parsing one merged buffer is what produced the `{}` the executor rejected',
  );
});

it('reunites a call whose name and arguments arrived under different indices', () => {
  const adapter = ADAPTER();
  const rescue = adapter.match(/const starved = calls\.filter[\s\S]{0,420}?\n {4}\}/);
  assert.ok(rescue, 'the index-mismatch rescue is gone');
  assert.match(
    rescue[0],
    /if \(starved\.length === 1 && orphans\.length === 1\)/,
    'only the unambiguous case may be repaired — two of either and a guess writes one document into another call',
  );
});

/*
 * `executing` is the code sandbox, and the UI says "Running code" for it. A
 * Canvas write is not code execution, so it gets its own phase rather than
 * borrowing a label that is false.
 */
it('separates a declared tool call from code execution', () => {
  const adapter = ADAPTER();
  assert.match(
    adapter,
    /export type StreamPhase = 'thinking' \| 'searching' \| 'executing' \| 'tooling' \| 'responding';/,
    'the phases must distinguish the sandbox from a declared function',
  );
  assert.match(
    adapter,
    /\} else if \(isFunctionCallStep\(step\)\) \{\r?\n {8}onPhase\?\.\('tooling'\);/,
    'a function-call step must not report the code-execution phase',
  );
  assert.match(
    adapter,
    /step\?\.type === 'code_execution_call'\) \{\r?\n {8}onPhase\?\.\('executing'\);/,
    'the sandbox keeps `executing` — that is what the label belongs to',
  );
  assert.match(
    adapter,
    /if \(pendingFunctionCalls\.length > 0\) \{\r?\n[^\n]*\r?\n {8}setPhase\('tooling'\);/,
    'the legacy Gemini path runs the same tools and must report the same phase',
  );
});

it('labels "Running code" for the sandbox only', () => {
  const view = CHAT_VIEW();
  assert.match(
    view,
    /thinkingPhase === 'executing' \? 'Running code'/,
    'the label must stay bound to the executing phase',
  );
  assert.ok(
    !/thinkingPhase === 'tooling' \? 'Running code'/.test(view),
    'a Canvas write must never claim to be running code',
  );
  assert.match(
    view,
    /\(thinkingPhase === 'thinking' \|\| thinkingPhase === 'tooling'\)/,
    'the row should hold its last thought heading while a tool runs, not drop to bare dots',
  );
});

it('registers a call from the opening, the delta and the done event', () => {
  const adapter = ADAPTER();
  assert.match(
    adapter,
    /step\.type === 'function_call' \|\| step\.type === 'tool_call'/,
    'a rename upstream must degrade into "the tool ran", not "the turn stopped"',
  );
  assert.match(adapter, /const registerCall = \(index: number, step: any\): void => \{/);
  assert.match(
    adapter,
    /if \(type === 'step\.done' \|\| type === 'content\.done'\) \{\r?\n {6}if \(isFunctionCallStep\(step\)\) registerCall\(Number\(event\.index\) \|\| 0, step\);/,
    'a coalesced stream carries the arguments ONLY on step.done',
  );
  assert.match(
    adapter,
    /if \(!functionCalls\.has\(index\)\) registerCall\(index, \{ id: '', name: '' \}\);/,
    'an arguments_delta for a call we never saw open must still be collected',
  );
});

it('reads the calls the interaction object lists', () => {
  const adapter = ADAPTER();
  assert.match(
    adapter,
    /const sweepInteractionCalls = \(interaction: any\): void => \{/,
    '`requires_action` lists the calls it is blocked on; a coalesced deployment sends them nowhere else',
  );
  assert.match(
    adapter,
    /if \(event\.interaction\) sweepInteractionCalls\(event\.interaction\);/,
    'the sweep must run on every event carrying an interaction, not only the terminal one',
  );
  assert.match(
    adapter,
    /const slot = 1000 \+ position;/,
    'a stable slot means a repeated terminal event absorbs into the same call instead of duplicating it',
  );
  assert.match(
    adapter,
    /const held = Math\.max\(seen\.deltas\.length, seen\.whole\.length\);\r?\n {10}if \(seen\.name === call\.name && held >= length\) return;/,
    'a call the step events already gave us in full must not be run twice — and "in full" is whichever of its two buffers is longer',
  );
});

it('runs a seen call even when the handshake is incomplete', () => {
  const adapter = ADAPTER();
  assert.match(
    adapter,
    /const canFeedResultsBack = interactionStatus === 'requires_action' && !!interactionId;/,
    'feeding results back and running the tool are separate decisions',
  );
  const branch = adapter.match(/if \(!canFeedResultsBack\) \{([\s\S]{0,320}?)\n {4}\}/);
  assert.ok(branch, 'the incomplete-handshake branch is gone — the call is being dropped again');
  assert.match(branch[1], /await onFunctionCall\(call\.name, args\);/, 'the call must still execute');
  assert.match(branch[1], /onToolCallStart\?\.\(call\.name, args\);/, 'and still report into the UI');
  assert.ok(
    !/if \(interactionStatus !== 'requires_action'/.test(adapter),
    'the old unconditional break is back; a Canvas turn will show one sentence and no document',
  );
});
