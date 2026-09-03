// Pins the stop/send composer button and the "You stopped this response"
// notice to what was measured off the real Gemini app over CDP, so a later
// tidy-up cannot quietly drift them.
//
// Every number and string below came out of a live capture (two recorded stop
// cycles: one before generation began, one mid-stream). Both cycles produced a
// byte-identical stop button, which is why only one set of values is pinned.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const composer = read('features/chat/src/composer/Composer.tsx');
const infoLine = read('features/chat/src/ResponseInfoLine.tsx');
const chatView = read('features/chat/src/ChatView.tsx');
// The turn lifecycle (stream, abort classification, finalisation) moved out of
// ChatView so a response can outlive the component — see chat-turn-store.ts.
// ChatView still owns the stop BUTTON and the rendering of a stopped turn.
const chatTurnRunner = read('features/chat/src/chat-turn-runner.ts');
const chatMessage = read('features/chat/src/chat-message.ts');
const aiChat = read('platform/ai/src/chat.ts');
const chrome = read('features/chat/src/ChatResponseChrome.tsx');

test('send glyph uses the Luminous axes Gemini renders, not the default weight', () => {
  // Gemini: font-family "Luminous Symbols", "FILL" 0, "GRAD" 0, "ROND" 100,
  // "opsz" 24, "wght" 300. The thickness the user flagged is wght + ROND:
  // Willow was rendering weight 400 with no roundness at all.
  assert.match(
    composer,
    /family="luminous" name="arrow_upward" size=\{24\} weight=\{300\} roundness=\{100\} opticalSize=\{24\}/,
  );
});

test('stop glyph is Google Symbols filled, a different family from send', () => {
  // The two glyphs do NOT share a font. Send is Luminous Symbols; stop is
  // Google Symbols with FILL 1 — assuming one family for both is the mistake
  // this test exists to catch.
  assert.match(composer, /family="google-symbols"\s+name="stop"/);
  assert.match(
    composer,
    /variationSettings:\s*'"FILL" 1, "GRAD" 0, "ROND" 100, "opsz" 24, "wght" 300'/,
  );
  assert.match(composer, /STOP_BUTTON_ICON = \{\s*size: 24,/);
});

test('stop reuses the send slot rather than adding a second button', () => {
  // Gemini renders one element: the same 32x32 container swaps class, colour,
  // aria-label and glyph. A separate button would double the composer width.
  assert.match(composer, /if \(isGenerating\) return onStopGenerating\?\.\(\);/);
  assert.match(composer, /aria-label=\{isGenerating \? 'Stop response'/);
  assert.match(composer, /bg-\[#171717\] hover:bg-\[#282828\]/);
});

test('Enter cannot submit while a reply is streaming', () => {
  // The button guard alone is not enough — Enter reaches handleSubmit directly.
  assert.match(composer, /const handleSubmit = \(\) => \{[\s\S]{0,240}?if \(isGenerating\) return;/);
});

test('stopped-response notice text matches Gemini exactly', () => {
  assert.match(infoLine, /stoppedLabel: 'You stopped this response'/);
});

test('notice typography pins the Google Sans Flex axes', () => {
  // 15px / weight 370 / line-height 20px / rgb(196,199,197) = #c4c7c5,
  // font-variation-settings "ROND" 0, "slnt" 0, "wdth" 92, "wght" 370.
  assert.match(infoLine, /fontSize: 15,/);
  assert.match(infoLine, /lineHeight: 20,/);
  assert.match(infoLine, /textColor: '#c4c7c5'/);
  assert.match(infoLine, /'"ROND" 0, "slnt" 0, "wdth" 92, "wght" 370'/);
  assert.match(infoLine, /fontWeight: 370/);
});

test('notice is a flex row with 16px gaps and 1px dividers', () => {
  // div.info-line-container: display flex, align-items center, gap 16px,
  // height 20px. Each div.divider-line: flex 1 1 0%, min-width 24px,
  // height 1px, background rgb(68,71,70) = #444746. The dividers must flex,
  // not be fixed widths, or the label stops being centred.
  assert.match(infoLine, /height: 20,/);
  assert.match(infoLine, /gap: 16,/);
  assert.match(infoLine, /dividerMinWidth: 24,/);
  assert.match(infoLine, /dividerHeight: 1,/);
  assert.match(infoLine, /dividerColor: '#444746'/);
  assert.match(infoLine, /flex: '1 1 0%'/);
});

test('notice has no entry animation', () => {
  // getAnimations() on the live element returned [] — it appears in place, so
  // no motion wrapper belongs here.
  assert.doesNotMatch(infoLine, /framer-motion/);
  assert.doesNotMatch(infoLine, /motion\./);
});

test('stopped turn keeps its notice across reload', () => {
  // Gemini still shows the notice after a refresh, so the flag must not join
  // the runtime-only flags that serializeChatMessage strips.
  assert.match(chatMessage, /wasStopped\?: boolean;/);
  const strip = chatMessage.match(/Omit<ChatMsg,[^>]*>/);
  assert.ok(strip, 'serializeChatMessage return type not found');
  assert.doesNotMatch(strip[0], /wasStopped/);
});

test('stop aborts the live stream rather than just flipping UI state', () => {
  assert.match(chatView, /generationAbortRef\.current\?\.abort\(\)/);
  assert.match(chatView, /onStopGenerating=\{handleStopGenerating\}/);
  // The controller lives on the turn record now, so the stop button reaches a
  // turn it did not start — including one resumed after leaving and returning.
  assert.match(chatTurnRunner, /signal: record\.abort\.signal,/);
});

test('a stop keeps the partial text instead of replacing it with an error', () => {
  // The abort branch keeps whatever streamed as the final content; only real
  // failures get the "Something went wrong" body.
  assert.match(chatTurnRunner, /if \(record\.abort\.signal\.aborted \|\| isAbortError\(error\)\) \{/);
  const abortBranch = chatTurnRunner.match(
    /if \(record\.abort\.signal\.aborted \|\| isAbortError\(error\)\) \{([\s\S]*?)\} else \{/,
  );
  assert.ok(abortBranch, 'abort branch not found');
  assert.match(abortBranch[1], /record\.wasStopped = true;/);
  assert.match(abortBranch[1], /record\.finalContent = record\.content;/);
  assert.doesNotMatch(abortBranch[1], /Something went wrong/);
});

// --- Stopping works on every provider, not just the ones that throw tidily ---
//
// Reported symptom: pressing stop on Gemini rendered
// "Something went wrong: [GoogleGenerativeAI Error]: Error reading from the
// stream". The SDK rewraps the aborted fetch into its own error, so the
// AbortError name and code that isAbortError matches are gone by the time a
// caller sees it. Classifying by error shape is therefore wrong for any
// provider that rewraps — the signal is the only provider-independent test.
//
// These assert on source text because platform/ai/src/chat.ts imports the
// provider SDKs as bare specifiers, which the test-runner's TS loader cannot
// resolve from a data: URL. See test/ts-module.mjs.

test('streamChat turns any provider error into a real AbortError when stopped', () => {
  // The single boundary every provider passes through, so one translation
  // fixes every caller instead of each one special-casing error strings.
  assert.match(aiChat, /const streamChatImpl: any = async \(/);
  assert.match(aiChat, /export const streamChat: any = async \(\.\.\.args: any\[\]\) => \{/);
  // Read off the options argument once, at the boundary, so the translation is
  // shared by every provider. The wrapper also rotates API keys, so it forwards a
  // rebuilt options object per attempt — but the signal is still the caller's.
  assert.match(aiChat, /const options = args\[1\] \?\? \{\};/);
  assert.match(aiChat, /const signal: AbortSignal \| undefined = options\.signal;/);
  assert.match(
    aiChat,
    /if \(signal\?\.aborted && !isAbortError\(error\)\) \{[\s\S]{0,200}?new DOMException\('The AI request was cancelled\.', 'AbortError'\)/,
  );
});

test('the implementation is not exported past the abort wrapper', () => {
  // A second export would let a caller bypass the normalisation and reintroduce
  // the raw provider error this fix exists to remove.
  const exported = aiChat.match(/export const streamChat\w*/g) ?? [];
  assert.deepEqual(exported, ['export const streamChat']);
});

test('a genuine failure racing an abort stays debuggable', () => {
  // DOMException takes no cause in its constructor, so it is attached — losing
  // the provider error would make a real mid-stop failure invisible.
  assert.match(aiChat, /\{ cause: error \}/);
  assert.match(aiChat, /throw error;/);
});

test('ChatView classifies a stop by the signal it owns, not the error shape', () => {
  assert.match(chatTurnRunner, /if \(record\.abort\.signal\.aborted \|\| isAbortError\(error\)\) \{/);
});

test('a swallowed abort still marks the turn stopped', () => {
  // Some SDKs resolve normally after an abort rather than throwing, so a clean
  // return is not proof the turn finished. The success path therefore reads the
  // signal too, rather than assuming completion.
  assert.match(chatTurnRunner, /record\.wasStopped = record\.abort\.signal\.aborted;/);
});

// --- A stopped turn survives the next turn, and a reload -------------------
//
// Reported symptom: the notice appeared, then vanished as soon as the FOLLOWING
// message started generating. Three separate defects could each erase it, so
// each is pinned separately.

test('the load path reads back every flag serializeChatMessage writes', () => {
  // The load path rebuilds messages field by field. It listed `wasInterrupted`
  // but not `wasStopped`, so a stopped turn lost its notice on any reload —
  // including the disk-sync reload that fires once the next turn is saved.
  // This asserts the general rule rather than the one flag, so the next flag
  // added to ChatMsg cannot repeat it.
  const runtimeOnly = new Set(['isGenerating', 'isTranscribing', 'isLive', 'isNew']);
  const persistedFlags = [...chatMessage.matchAll(/^\s*(was[A-Z]\w*)\??:/gm)].map((m) => m[1]);
  assert.ok(persistedFlags.length >= 2, 'expected ChatMsg to declare was* flags');

  const loadBlock = chatView.slice(
    chatView.indexOf('const sanitized: ChatMsg[]'),
    chatView.indexOf('hasSavedMessageContent(m))'),
  );
  assert.ok(loadBlock.length > 0, 'could not locate the load path');
  for (const flag of persistedFlags) {
    if (runtimeOnly.has(flag)) continue;
    assert.match(
      loadBlock,
      new RegExp(`${flag}: m\\.${flag}`),
      `the load path drops ${flag}, so it is lost on reload`,
    );
  }
});

test('a turn stopped before its first token is still persisted', () => {
  // Empty content, but the notice IS the content. hasSavedMessageContent used
  // to drop it, taking the whole turn off disk and leaving the user's question
  // with no response under it.
  assert.match(chatMessage, /!!message\.wasStopped/);
  assert.match(chatMessage, /'content' \| 'attachments' \| 'wasStopped'/);
});

test('a finished turn never falls back to the live streaming buffer', () => {
  // `streaming` is thread-wide and belongs to whichever turn is generating now.
  // `msg.content || streaming` made an empty stopped turn mirror the NEXT
  // turn's text the moment it began streaming.
  assert.match(chatView, /const bodyText = generating \? streaming : msg\.content;/);
  assert.doesNotMatch(chatView, /msg\.content \|\| streaming/);
});

// --- Reduced action row on a stopped turn ----------------------------------

// The stopped-turn branch, sliced out so the assertions below cannot be
// satisfied by the full row further down the file. Markers are newline-free
// on purpose — this repo is CRLF, so a pattern containing "\n" never matches.
const stoppedBranch = chrome.slice(
  chrome.indexOf('if (isStopped)'),
  chrome.indexOf('aria-label="Good response"'),
);

test('a stopped turn shows only Redo and Report legal issue', () => {
  // Measured on two live stopped turns:
  //   stopped + last turn -> refresh ("Redo"), flag ("Report legal issue")
  //   stopped, not last   -> flag only
  // No like, dislike, copy or more_horiz — there is no finished reply to rate
  // or copy.
  assert.ok(stoppedBranch.length > 0, 'could not locate the stopped-turn branch');
  assert.match(stoppedBranch, /name="refresh"/);
  assert.match(stoppedBranch, /aria-label="Report legal issue"/);
  assert.match(stoppedBranch, /name="flag"/);
  for (const absent of ['thumb_up', 'thumb_down', 'more_horiz', 'name="copy"']) {
    assert.ok(
      !stoppedBranch.includes(absent),
      `stopped turns must not render ${absent}`,
    );
  }
});

test('Redo on a stopped turn still follows canRedo', () => {
  // Gemini showed refresh on the last stopped turn and not on the earlier one,
  // matching normal turns — the two rules compose rather than conflict.
  assert.match(stoppedBranch, /\{canRedo && \(/);
});

test('ChatView tells the action row when a turn was stopped', () => {
  assert.match(chatView, /isStopped=\{!!msg\.wasStopped\}/);
});

test('notice sits 8px under the body and 4px above the button row', () => {
  // Measured on a stopped Gemini turn:
  //   body bottom -> 8px -> 20px notice -> 4px -> 32px button row.
  // An earlier pass recorded that last gap as 0 by measuring to
  // `message-actions`, whose own 4px inset sits above the buttons.
  assert.match(chatView, /marginTop: 8, marginBottom: 0/);
  assert.match(chatView, /msg\.wasStopped \? \{ marginTop: 4 \}/);
});
