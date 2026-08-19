// The stylesheet for StreamingMarkdown, injected once into document.head.
//
// Kept as a string array rather than a .css file because this component ships as
// a self-contained unit: consumers import the component and get its styles with
// it, without a separate CSS import that a bundler might tree-shake or reorder.
// `useInjectStyles` writes only when the content differs, so multiple mounts
// share one injection while an HMR edit still reaches an already-open tab. It
// deliberately does NOT no-op on "tag exists": that left a long-lived tab running
// new component code against the old stylesheet, which put the source hover pane
// 190px off its chip.
import { useInsertionEffect } from 'react';

const STYLE_ID = 'streaming-markdown-styles';

/**
 * How far a full-bleed block paints outside its column, per side.
 *
 * `.smd-code-block` sets `margin: 16px -16px 0`, so it is intentionally 2× this
 * wider than the text measure. Exported because an ancestor that applies paint
 * containment — `contain: paint`, or anything implying it such as
 * `content-visibility` — clips descendants to its own padding box, a rectangle
 * with no border radius. That slices this much off both sides of the block,
 * straight through the widest part of its 40px corner curve. An ancestor doing
 * that must widen its padding box by this amount per side to keep the bleed
 * inside the clip. Kept here so the number cannot drift from the rule below.
 */
export const MARKDOWN_BLOCK_BLEED_PX = 16;

const STYLE_CSS = [
  '@keyframes smd-fade-in-text {',
  '  from { opacity: 0; }',
  '  to { opacity: 1; }',
  '}',
  '@keyframes smd-media-drift {',
  '  0%, 100% { transform: translate3d(-8%, -5%, 0) scale(1); }',
  '  50% { transform: translate3d(8%, 7%, 0) scale(1.08); }',
  '}',
  '.smd-root {',
  '  display: flex;',
  '  min-width: 0;',
  '  max-width: 100%;',
  '  flex-direction: column;',
  '  gap: 16px;',
  '  color: rgb(227, 227, 227);',
  '  font-family: "Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif;',
  '  font-size: 17px;',
  '  font-weight: 400;',
  '  line-height: 24px;',
  '  overflow-wrap: break-word;',
  '  text-rendering: auto;',
  '  white-space: pre-wrap;',
  '  word-break: auto-phrase;',
  '}',
  '.smd-root > :first-child { margin-top: 0 !important; }',
  '.smd-root > :last-child { margin-bottom: 0 !important; }',
  '.smd-root p { margin: 0; white-space: pre-wrap; }',
  '.smd-streaming {',
  '  --animation-duration: 400ms;',
  '  --fade-animation-function: ease-out;',
  '}',
  '.smd-streaming .smd-w,',
  '.smd-streaming .smd-h,',
  '.smd-streaming .smd-list > li.smd-reveal-block:not(.smd-settled)::before,',
  '.smd-streaming .smd-code-block,',
  '.smd-streaming .smd-svg-preview-block,',
  '.smd-streaming .smd-table-block,',
  '.smd-streaming .smd-media-gallery,',
  '.smd-streaming .smd-rich-resource-group,',
  '.smd-streaming .smd-math-display {',
  '  animation-duration: var(--animation-duration);',
  '  animation-delay: var(--smd-inner-delay, 0ms);',
  '  animation-fill-mode: both;',
  '  animation-iteration-count: 1;',
  '  animation-name: smd-fade-in-text;',
  '  animation-timing-function: var(--fade-animation-function);',
  '}',
  // Each paragraph or list item owns one reveal slot. Words and the item's
  // marker inherit the same delay, so no nested opacity layer can overtake an
  // earlier block or make a marker appear ahead of its text.
  '.smd-streaming .smd-list > li.smd-reveal-block:not(.smd-settled)::before,',
  '.smd-streaming .smd-reveal-block:not(.smd-settled) .smd-w,',
  '.smd-streaming .smd-reveal-block:not(.smd-settled) .smd-h {',
  '  opacity: 0;',
  '}',
  '.smd-streaming .smd-settled { animation: none; }',
  '.smd-heading {',
  '  color: rgb(227, 227, 227);',
  '  padding: 0;',
  '  white-space: pre-wrap;',
  '}',
  '.smd-heading-1 { font-size: 28px; font-weight: 350; line-height: 36px; margin: 24px 0 0; }',
  '.smd-heading-2 { font-size: 24px; font-weight: 380; line-height: 28px; margin: 24px 0 0; }',
  '.smd-heading-3, .smd-heading-4, .smd-heading-5, .smd-heading-6 { font-size: 20px; font-weight: 470; line-height: 24px; margin: 24px 0 -8px; }',
  '.smd-heading-1 + .smd-heading-2 { margin-top: 8px; }',
  '.smd-heading-2 + .smd-heading-3,',
  '.smd-heading-3 + .smd-heading-4,',
  '.smd-heading-4 + .smd-heading-5,',
  '.smd-heading-5 + .smd-heading-6 { margin-top: 0; }',
  '.smd-link {',
  '  color: rgb(230, 230, 230);',
  '  text-decoration-line: underline;',
  '  text-decoration-style: dotted;',
  '  text-decoration-thickness: 1.36px;',
  '  text-decoration-color: rgb(230, 230, 230);',
  '  text-underline-offset: 3.91px;',
  '}',
  '.smd-link:hover { color: #ffffff; text-decoration-color: #ffffff; }',
  '.smd-rich-resource-group { margin: 32px 0; white-space: normal; }',
  /*
   * The query container is the card's TEXT COLUMN, and deliberately not the group
   * or the card, because both of those contain the YouTube iframe.
   *
   * `container-type` implies `contain: layout style inline-size`. That embed is an
   * out-of-process frame, so the browser has to re-stitch it into this page's
   * rendering whenever anything about its box changes, and a frame where it has
   * not yet produced its picture paints as flat card background. Exactly that
   * blanking was reported (captures/canvas/flicker/playing-1-35a607af.png is one
   * of the blank frames) shortly after this query was first written with the
   * container on the group. It could not be pinned on the containment — the DOM
   * was provably still, the element was never recreated, its rect never moved and
   * it never reloaded — but it could not be cleared either, because the symptom
   * went dormant before an A/B could settle it. Containing only the text keeps the
   * iframe out of the question entirely.
   *
   * The text column tracks the same widths the group does, so the behaviour is
   * unchanged: measured 320px in a normal thread and 171px once the immersive
   * panel opens and the chat column shrinks. 240 sits between them. (In group
   * terms that is a 544px card, against 520 when the container was the group —
   * a range no real layout lands in; the real values are 704 and 405.)
   */
  '.smd-rich-resource-text { container-type: inline-size; }',
  // Only while the card is side by side with its video. Below 768px it stacks and
  // the description gets the full width underneath, where it still reads.
  '@media (min-width: 768px) {',
  '  @container (max-width: 240px) {',
  '    .smd-rich-resource-description { display: none; }',
  '  }',
  '}',
  '.smd-inline-code {',
  '  display: inline;',
  '  border-radius: 9999px;',
  '  background: rgb(23, 23, 23);',
  '  color: rgba(255, 255, 255, 0.55);',
  '  font-family: "Google Sans Code", ui-monospace, SFMono-Regular, Consolas, monospace;',
  '  font-size: 15px;',
  '  font-weight: 400;',
  '  line-height: 20px;',
  '  padding: 4px 6px;',
  '  white-space: break-spaces;',
  '}',
  '.smd-list {',
  '  display: block;',
  '  margin: 0;',
  '  padding: 0 0 0 3.36px;',
  '  list-style: none;',
  '}',
  '.smd-list-ordered { padding-left: 4px; }',
  '.smd-list > li {',
  '  position: relative;',
  '  margin: 0;',
  '  padding: 0 0 0 36px;',
  '  list-style: none;',
  '}',
  '.smd-list > li + li { margin-top: 12px; }',
  '.smd-list-unordered > li::before {',
  '  position: absolute;',
  '  top: 7.5px;',
  '  left: 0;',
  '  width: 9px;',
  '  height: 9px;',
  '  background: currentColor;',
  '  content: "";',
  '  -webkit-mask-image: url("data:image/svg+xml,%3Csvg width=%229%22 height=%229%22 viewBox=%220 0 9 9%22 fill=%22none%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Ccircle cx=%224.2998%22 cy=%224.30005%22 r=%223.65%22 stroke=%22currentColor%22 stroke-width=%221.3%22/%3E%3C/svg%3E");',
  '  mask-image: url("data:image/svg+xml,%3Csvg width=%229%22 height=%229%22 viewBox=%220 0 9 9%22 fill=%22none%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Ccircle cx=%224.2998%22 cy=%224.30005%22 r=%223.65%22 stroke=%22currentColor%22 stroke-width=%221.3%22/%3E%3C/svg%3E");',
  '  -webkit-mask-repeat: no-repeat;',
  '  mask-repeat: no-repeat;',
  '  -webkit-mask-size: contain;',
  '  mask-size: contain;',
  '}',
  '.smd-list-ordered > li { counter-increment: smd-list-item; }',
  '.smd-list-ordered > li::before {',
  '  position: absolute;',
  '  top: 0;',
  '  left: 0;',
  '  width: 24px;',
  '  height: 24px;',
  '  content: counter(smd-list-item) ".";',
  '}',
  '.smd-list .smd-list-ordered > li::before { content: counter(smd-list-item, lower-alpha) "."; }',
  '.smd-list .smd-list-ordered .smd-list-ordered > li::before { content: counter(smd-list-item, lower-roman) "."; }',
  '.smd-list-content {',
  '  display: flex;',
  '  min-width: 0;',
  '  flex-direction: column;',
  '  gap: 0;',
  '}',
  '.smd-list-content > .smd-paragraph { padding-left: 4px; }',
  '.smd-list-content > .smd-list { margin-top: 12px; }',
  '.smd-task-item::before { display: none !important; }',
  '.smd-task-box {',
  '  position: absolute;',
  '  top: 3px;',
  '  left: 0;',
  '  display: inline-flex;',
  '  width: 18px;',
  '  height: 18px;',
  '  align-items: center;',
  '  justify-content: center;',
  '  border: 1px solid rgba(227, 227, 227, 0.55);',
  '  border-radius: 4px;',
  '  color: rgb(23, 23, 23);',
  '}',
  '.smd-task-box[data-checked="true"] { background: rgb(227, 227, 227); }',
  // ── Blockquote ────────────────────────────────────────────────────────────
  // Gemini sets a quote in *italic Google Sans Code* against a dotted vertical
  // rail — not the conventional solid left border on body text. Three details
  // are each easy to get wrong on their own:
  //
  //  • The rail is a repeating radial-gradient, not `border-left`: a 1.3px dot
  //    every 4px, inset 6px from each end so it stops short of the first and
  //    last line. A solid 1px border reads as a different component entirely.
  //  • The italic must be a real face. Google Sans Code ships a separate italic
  //    at MONO 0 (proportional), which index.html now requests; before that
  //    Chrome synthesised an oblique from the monospaced upright.
  //  • The 40px end margin is Chrome's UA default for <blockquote>, which
  //    Gemini overrides only on the start side. It is restated here because
  //    this rule replaces the UA margin wholesale, and dropping it lets quoted
  //    lines run ~40px wider than Gemini's and wrap at different words.
  '.smd-blockquote {',
  '  position: relative;',
  '  display: block;',
  '  margin: 0 40px 0 7.5px;',
  '  padding: 0 0 0 32.5px;',
  '  border: 0;',
  '  color: inherit;',
  '  font-family: "Google Sans Code", monospace;',
  '  font-size: 17px;',
  '  font-style: italic;',
  '  font-weight: 400;',
  '  font-variation-settings: "MONO" 0, "wght" 400;',
  '  letter-spacing: 0;',
  '  line-height: 24px;',
  '}',
  '.smd-blockquote::before {',
  '  position: absolute;',
  '  top: 6px;',
  '  bottom: 6px;',
  '  left: 3px;',
  '  width: 1.3px;',
  '  background-image: radial-gradient(circle closest-side, rgb(230, 230, 230) 100%, transparent 100%);',
  '  background-position: 0 0;',
  '  background-repeat: repeat-y;',
  '  background-size: 1.3px 4px;',
  '  content: "";',
  '}',
  // A **label** inside a quote drops back to the upright sans body face, so the
  // bold run contrasts with the italic around it. `font-variation-settings` is
  // inherited and would otherwise pin this text to "wght" 400 — which silently
  // beats `font-weight: 700` on a variable font and un-bolds the label.
  '.smd-blockquote :is(b, strong) {',
  '  font-family: "Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif;',
  '  font-size: 17px;',
  '  font-style: normal;',
  '  font-variation-settings: "ROND" 0, "slnt" 0, "wdth" 92, "wght" 540;',
  '  line-height: 24px;',
  '}',
  // A list inside a quote reverts to *native* markers — filled discs and plain
  // decimals, tight against their text — rather than the ring bullet and
  // 36px-offset counter used at the top level.
  //
  // This is not a special case invented here; it falls out of how Gemini scopes
  // those markers. Every custom-marker rule requires the list chain to begin at
  // a direct child of the markdown root (`& > ul > li::before`, `& > ol li`).
  // A list inside a quote is `root > blockquote > ul`, matches none of them, and
  // so lands on the plain `ul { list-style-type: disc; padding-inline-start:
  // 27px }` base. Willow's markers are unconditional, hence this override.
  //
  // Item spacing follows from the same base rules: `ul, ol { margin: 8px 0 }`
  // plus `li { margin: 8px 0 }`, whose adjacent margins collapse to a single
  // 8px — not the 12px used between top-level items.
  '.smd-blockquote .smd-list {',
  '  margin: 8px 0;',
  '  padding-left: 27px;',
  '  list-style-position: outside;',
  '}',
  '.smd-blockquote .smd-list-ordered { padding-left: 28px; }',
  '.smd-blockquote .smd-list-unordered,',
  '.smd-blockquote .smd-list-unordered > li { list-style-type: disc; }',
  '.smd-blockquote .smd-list-ordered,',
  '.smd-blockquote .smd-list-ordered > li { list-style-type: decimal; }',
  '.smd-blockquote .smd-list > li { margin: 8px 0; padding-left: 4px; }',
  // Three depths, because the counter rules above are written for three and each
  // selector here has to outweigh its counterpart to suppress the marker that
  // would otherwise paint on top of the native one.
  '.smd-blockquote .smd-list > li::before,',
  '.smd-blockquote .smd-list .smd-list > li::before,',
  '.smd-blockquote .smd-list .smd-list .smd-list > li::before { content: none; }',
  '.smd-hr {',
  '  width: 100%;',
  '  height: 1px;',
  '  margin: 8px 0;',
  '  border: 0;',
  '  background: rgba(255, 255, 255, 0.12);',
  '}',
  '.smd-math-inline {',
  '  display: inline;',
  '  vertical-align: baseline;',
  '}',
  '.smd-math-display {',
  '  width: 100%;',
  '  max-width: 100%;',
  '  overflow: auto;',
  '  padding: 0;',
  '  text-align: start;',
  '}',
  '.smd-math-display .katex-display { margin: 24px 0; text-align: center; }',
  '.smd-math-display .katex { font-size: 24px; line-height: 1.2; }',
  '.smd-math-error {',
  '  color: #ffb4ab;',
  '  font-family: "Google Sans Code", ui-monospace, monospace;',
  '  font-size: 15px;',
  '}',
  '.smd-code-block {',
  '  position: relative;',
  '  min-width: 0;',
  // Full bleed: 2x MARKDOWN_BLOCK_BLEED_PX wider than the column. Any ancestor
  // applying paint containment has to account for it — see that constant.
  '  margin: 16px -16px 0;',
  '  overflow: clip;',
  '  border-radius: 40px;',
  '  background: rgb(23, 23, 23);',
  '  padding: 26px 0 32px 32px;',
  '}',
  '.smd-code-header {',
  '  position: sticky;',
  '  top: 0;',
  '  z-index: 2;',
  '  display: flex;',
  '  width: 100%;',
  '  height: 36px;',
  '  align-items: center;',
  '  justify-content: space-between;',
  '  background: rgb(23, 23, 23);',
  '  padding: 0 11px 0 0;',
  '  color: rgb(255, 255, 255);',
  '}',
  '.smd-code-language {',
  '  font-family: "Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif;',
  '  font-size: 15px;',
  '  font-weight: 540;',
  '  line-height: 20px;',
  '}',
  '.smd-code-buttons { display: flex; width: 72px; height: 36px; }',
  '.smd-icon-button {',
  '  display: inline-flex;',
  '  width: 36px;',
  '  height: 36px;',
  '  flex: 0 0 36px;',
  '  align-items: center;',
  '  justify-content: center;',
  '  border: 0;',
  '  border-radius: 9999px;',
  '  background: transparent;',
  '  color: rgb(255, 255, 255);',
  '  cursor: pointer;',
  '  padding: 6px;',
  '}',
  '.smd-icon-button:hover { background: rgba(255, 255, 255, 0.08); }',
  '.smd-icon-button:focus-visible { outline: 2px solid rgba(138, 180, 248, 0.9); outline-offset: 1px; }',
  '.smd-code-scroll { width: 100%; overflow: auto; }',
  '.smd-code-pre {',
  '  width: 100%;',
  '  margin: 0;',
  '  padding: 0;',
  '  overflow: visible;',
  '  background: transparent;',
  '  white-space: pre;',
  '}',
  '.smd-code-pre code {',
  '  display: block;',
  '  min-width: max-content;',
  '  padding: 16px 32px 0 0;',
  '  background: transparent;',
  '  color: rgb(255, 255, 255);',
  '  font-family: "Google Sans Code", ui-monospace, SFMono-Regular, Consolas, monospace;',
  '  font-size: 14px;',
  '  font-weight: 400;',
  '  line-height: 21px;',
  '  tab-size: 4;',
  '}',
  '.smd-code-block .hljs { color: rgb(255, 255, 255); background: transparent; }',
  '.smd-code-block .hljs-comment, .smd-code-block .hljs-quote { color: rgb(128, 128, 128); }',
  '.smd-code-block .hljs-keyword, .smd-code-block .hljs-selector-id, .smd-code-block .hljs-selector-class { color: rgb(150, 157, 255); }',
  '.smd-code-block .hljs-string, .smd-code-block .hljs-regexp, .smd-code-block .hljs-addition, .smd-code-block .hljs-template-tag { color: rgb(96, 214, 115); }',
  '.smd-code-block .hljs-number, .smd-code-block .hljs-literal, .smd-code-block .hljs-attr, .smd-code-block .hljs-variable, .smd-code-block .hljs-template-variable { color: rgb(255, 150, 218); }',
  '.smd-code-block .hljs-title, .smd-code-block .hljs-title.function_, .smd-code-block .hljs-section { color: rgb(255, 219, 15); }',
  '.smd-code-block .hljs-name, .smd-code-block .hljs-selector-tag { color: rgb(79, 160, 255); }',
  '.smd-code-block .hljs-meta, .smd-code-block .hljs-built_in, .smd-code-block .hljs-builtin-name, .smd-code-block .hljs-deletion { color: rgb(255, 90, 89); }',
  '.smd-code-block .hljs-meta .hljs-keyword { color: rgb(255, 90, 89); font-weight: 700; }',
  // ── Code-execution panel ──────────────────────────────────────────────────
  // Shares the code-block chrome above, but splits it across two elements the
  // markdown block keeps as one: the reveal wrapper owns the full-bleed negative
  // margin (which animates) while the panel owns the background and radius. The
  // wrapper cannot own both, because animating the margin on the element that
  // paints the background would slide the background as it grows.
  '.smd-code-exec-reveal {',
  '  display: none;',
  // Bleed only — no vertical margin. Spacing above the panel is owned by the
  // toggle row (a fixed 20px, measured off the live app) and below it by the
  // turn's own rhythm. Keeping vertical margin off this element means the reveal
  // animates height alone: nothing shifts the box's width or its neighbours
  // mid-flight, so the measured target height stays exact.
  '  margin: 0 -16px;',
  // Radius matches the panel inside, so clipping the growing content costs
  // nothing at the corners. At rest the height is auto and nothing is clipped.
  '  border-radius: 40px;',
  '  overflow: hidden;',
  '}',
  '.smd-code-exec-reveal.is-open { display: block; }',
  '.smd-code-exec-panel {',
  '  min-width: 0;',
  '  overflow: clip;',
  '  border-radius: 40px;',
  '  background: rgb(23, 23, 23);',
  // Bottom padding is 0 here, unlike `.smd-code-block`: whichever section ends
  // the panel supplies its own 32px, so the panel closes correctly whether or
  // not the output section is present.
  '  padding: 26px 0 0 32px;',
  '}',
  '.smd-code-exec-code .smd-code-pre code { padding: 16px 0 32px 0; }',
  '.smd-code-exec-output-header {',
  '  display: flex;',
  '  width: 100%;',
  '  min-height: 24px;',
  '  align-items: center;',
  '  justify-content: space-between;',
  '  background: rgb(23, 23, 23);',
  '  padding: 0 0 16px 0;',
  '  color: rgb(255, 255, 255);',
  '  font-family: "Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif;',
  '  font-size: 15px;',
  '  font-weight: 400;',
  '  line-height: 20px;',
  '}',
  '.smd-code-exec-divider {',
  '  height: 0;',
  '  border: 0;',
  '  border-top: 0.8px solid rgb(68, 71, 70);',
  '  margin: 0;',
  '}',
  // The output uses a different mono face and leading to the code above it —
  // Google Sans Mono 14/18 against Google Sans Code 14/21. Measured, not assumed.
  '.smd-code-exec-output code {',
  '  display: block;',
  '  min-width: max-content;',
  '  padding: 16px 0 32px 0;',
  '  background: transparent;',
  '  color: rgb(255, 255, 255);',
  '  font-family: "Google Sans Mono", "Google Sans Code", ui-monospace, SFMono-Regular, Consolas, monospace;',
  '  font-size: 14px;',
  '  font-weight: 400;',
  '  line-height: 18px;',
  '  tab-size: 4;',
  '}',
  '.smd-code-exec-fade { opacity: 1; }',
  '.smd-svg-preview-block {',
  '  width: 100%;',
  '  min-width: 0;',
  '  overflow: hidden;',
  '  box-sizing: border-box;',
  '  border: 0.8px solid rgb(68, 71, 70);',
  '  border-radius: 12px;',
  '  background: transparent;',
  '  color: rgb(196, 199, 197);',
  '}',
  '.smd-svg-preview-toolbar {',
  '  display: flex;',
  '  width: 100%;',
  '  height: 56px;',
  '  box-sizing: border-box;',
  '  align-items: center;',
  '  justify-content: space-between;',
  '  background: rgb(30, 31, 32);',
  '  padding: 8px 8px 8px 16px;',
  '}',
  '.smd-svg-preview-label {',
  '  color: rgb(196, 199, 197);',
  '  font-family: "Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif;',
  '  font-size: 14px;',
  '  font-weight: 500;',
  '  line-height: 24px;',
  '}',
  '.smd-svg-preview-actions { display: flex; height: 40px; gap: 4px; }',
  '.smd-svg-preview-button {',
  '  display: inline-flex;',
  '  width: 40px;',
  '  height: 40px;',
  '  flex: 0 0 40px;',
  '  align-items: center;',
  '  justify-content: center;',
  '  border: 0;',
  '  border-radius: 9999px;',
  '  background: transparent;',
  '  color: rgb(196, 199, 197);',
  '  cursor: pointer;',
  '  padding: 8px;',
  '}',
  '.smd-svg-preview-button:hover { background: rgba(255, 255, 255, 0.08); }',
  '.smd-svg-preview-button:focus-visible { outline: 2px solid rgba(138, 180, 248, 0.9); outline-offset: 1px; }',
  '.smd-svg-preview-canvas { width: 100%; height: 400px; background: rgb(19, 19, 20); }',
  '.smd-svg-preview-frame { display: block; width: 100%; height: 100%; border: 0; background: transparent; }',
  '.smd-table-block { position: relative; width: 100%; min-width: 0; }',
  '.smd-table-content { overflow: auto; padding: 8px 0; }',
  '.smd-table-block.has-scrollbar .smd-table-content {',
  '  -webkit-mask-image: linear-gradient(90deg, rgba(0, 0, 0, 0.2), #000 48px, #000 calc(100% - 48px), rgba(0, 0, 0, 0.2));',
  '  mask-image: linear-gradient(90deg, rgba(0, 0, 0, 0.2), #000 48px, #000 calc(100% - 48px), rgba(0, 0, 0, 0.2));',
  '}',
  '.smd-table-block.has-scrollbar.is-at-scroll-start .smd-table-content {',
  '  -webkit-mask-image: linear-gradient(90deg, #000, #000 calc(100% - 48px), rgba(0, 0, 0, 0.2));',
  '  mask-image: linear-gradient(90deg, #000, #000 calc(100% - 48px), rgba(0, 0, 0, 0.2));',
  '}',
  '.smd-table-block.has-scrollbar.is-at-scroll-end .smd-table-content {',
  '  -webkit-mask-image: linear-gradient(90deg, rgba(0, 0, 0, 0.2), #000 48px, #000);',
  '  mask-image: linear-gradient(90deg, rgba(0, 0, 0, 0.2), #000 48px, #000);',
  '}',
  '.smd-table { width: 100%; min-width: max-content; border-collapse: separate; border-spacing: 0; }',
  '.smd-table th, .smd-table td {',
  '  position: relative;',
  '  width: 173px;',
  '  min-width: 173px;',
  '  max-width: 320px;',
  '  vertical-align: top;',
  '  color: rgb(227, 227, 227);',
  '  font: inherit;',
  '  font-weight: 400;',
  '  text-align: left;',
  '  white-space: normal;',
  '}',
  '.smd-table th { padding: 12px 12px 16px; }',
  '.smd-table td { padding: 16px 12px; }',
  '.smd-table th:first-child { padding-left: 0; }',
  '.smd-table th:last-child { padding-right: 0; }',
  '.smd-table td:first-child { padding-left: 0; }',
  '.smd-table td:last-child { padding-right: 0; }',
  '.smd-table thead th::after,',
  '.smd-table tbody tr:not(:last-child) > td::after {',
  '  position: absolute;',
  '  right: 12px;',
  '  bottom: 0;',
  '  left: 12px;',
  '  height: 1px;',
  '  background: rgba(255, 255, 255, 0.12);',
  '  content: "";',
  '}',
  '.smd-table tr > :first-child::after { left: 0; }',
  '.smd-table tr > :last-child::after { right: 0; }',
  '.smd-table-footer {',
  '  position: relative;',
  '  display: flex;',
  '  height: 20px;',
  '  align-items: center;',
  '  justify-content: flex-start;',
  '  margin-top: 10px;',
  '}',
  '.smd-table-menu-trigger {',
  '  display: inline-flex;',
  '  width: 32px;',
  '  height: 20px;',
  '  align-items: center;',
  '  justify-content: center;',
  '  border: 0;',
  '  border-radius: 9999px;',
  '  background: rgb(23, 23, 23);',
  '  color: rgb(230, 230, 230);',
  '  cursor: pointer;',
  '  padding: 0;',
  '}',
  '.smd-table-menu-trigger:hover { background: rgb(42, 42, 42); }',
  '.smd-table-menu {',
  '  position: absolute;',
  '  top: 28px;',
  '  left: 0;',
  '  z-index: 20;',
  '  width: 188px;',
  '  height: 96px;',
  '  box-sizing: border-box;',
  '  overflow: hidden;',
  '  border: 0;',
  '  border-radius: 20px;',
  '  background: rgb(31, 31, 31);',
  '  box-shadow: none;',
  '  padding: 8px;',
  '}',
  '.smd-table-menu button {',
  '  display: flex;',
  '  width: 100%;',
  '  height: 40px;',
  '  align-items: center;',
  '  gap: 8px;',
  '  border: 0;',
  '  border-radius: 12px;',
  '  background: transparent;',
  '  color: rgb(230, 230, 230);',
  '  cursor: pointer;',
  '  font: inherit;',
  '  font-size: 13px;',
  '  line-height: 17px;',
  '  padding: 0 8px;',
  '  text-align: left;',
  '}',
  '.smd-table-menu button:hover { background: rgba(255, 255, 255, 0.08); }',
  '.smd-media-gallery {',
  '  display: grid;',
  '  width: 100%;',
  '  grid-template-columns: repeat(2, minmax(0, 1fr));',
  '  gap: 8px;',
  '}',
  '.smd-media-gallery[data-count="1"] { grid-template-columns: minmax(0, 1fr); }',
  '.smd-media-card {',
  '  display: block;',
  '  width: 100%;',
  '  min-width: 0;',
  '  border: 0;',
  '  background: transparent;',
  '  color: inherit;',
  '  cursor: pointer;',
  '  padding: 0;',
  '  text-align: left;',
  '}',
  '.smd-media-frame {',
  '  position: relative;',
  '  width: 100%;',
  '  aspect-ratio: var(--smd-media-ratio, 4 / 3);',
  '  min-height: 148px;',
  '  overflow: hidden;',
  '  border: 1px solid rgba(255, 255, 255, 0.07);',
  '  border-radius: 16px;',
  '  background: rgb(23, 23, 23);',
  '}',
  '.smd-media-card:hover .smd-media-frame { border-color: rgba(255, 255, 255, 0.18); }',
  '.smd-media-frame img, .smd-media-frame video {',
  '  position: absolute;',
  '  inset: 0;',
  '  width: 100%;',
  '  height: 100%;',
  '  object-fit: cover;',
  '}',
  '.smd-media-loading {',
  '  position: absolute;',
  '  inset: 0;',
  '  overflow: hidden;',
  '  background: radial-gradient(circle at 28% 25%, #b4bac7 0, #767d8c 30%, #1b1e25 67%, #0d0f14 100%);',
  '}',
  '.smd-media-loading::before, .smd-media-loading::after {',
  '  position: absolute;',
  '  width: 72%;',
  '  height: 72%;',
  '  border-radius: 50%;',
  '  filter: blur(18px);',
  '  content: "";',
  '  animation: smd-media-drift 8s ease-in-out infinite;',
  '}',
  '.smd-media-loading::before { top: -25%; left: -15%; background: rgba(235, 239, 247, 0.5); }',
  '.smd-media-loading::after { right: -18%; bottom: -25%; background: rgba(10, 12, 17, 0.88); animation-delay: -4s; }',
  '.smd-media-error {',
  '  position: absolute;',
  '  inset: 0;',
  '  display: flex;',
  '  flex-direction: column;',
  '  align-items: flex-start;',
  '  justify-content: flex-start;',
  '  gap: 8px;',
  '  background: linear-gradient(180deg, #232323, #171717);',
  '  color: rgb(227, 227, 227);',
  '  padding: 18px;',
  '}',
  '.smd-media-error-title { font-size: 15px; font-weight: 540; }',
  '.smd-media-error-detail { color: rgb(196, 199, 197); font-size: 13px; line-height: 18px; }',
  '.smd-inline-image {',
  '  display: inline-block;',
  '  max-width: 100%;',
  '  max-height: 360px;',
  '  border-radius: 12px;',
  '  object-fit: cover;',
  '  vertical-align: middle;',
  '}',
  // ── Gemini's bento-card ────────────────────────────────────────────────────
  // Transcribed from the live `ng-c4026281530` sheet. Token values resolved:
  // --gem-sys-shape--corner-extra-large-max 40px, --lumi-sys-color--surface-dim
  // #171717, spacing xs/s/l/xl = 4/8/16/20px, on-surface rgb(227,227,227).
  // The root hugs its content — it is NOT `width: 100%`. Measured live: a group
  // of four sat at 708px in a 708px column, but squeezing the containing block to
  // 420px and then 300px left every card at its declared 350/171. Cards are rigid;
  // the container never stretches or shrinks them.
  '.smd-bento-root { display: flex; flex-direction: row; width: fit-content; max-width: 100%; }',
  '.smd-bento-column { display: flex; flex-direction: column; flex: 0 0 auto; }',
  '.smd-bento-row { display: flex; flex-direction: row; flex-grow: 1; }',
  '.smd-bento-slot { flex: 0 0 auto; }',
  '.smd-bento-card {',
  '  position: relative;',
  '  box-sizing: border-box;',
  '  display: flex;',
  '  flex-direction: column;',
  '  align-items: center;',
  '  justify-content: center;',
  '  background-color: rgb(23, 23, 23);',
  '  background-position: 50%;',
  '  background-repeat: no-repeat;',
  '  background-size: cover;',
  '  border-radius: 40px;',
  '  overflow: hidden;',
  '  text-align: center;',
  '  color: rgb(227, 227, 227);',
  '  padding: 16px;',
  '}',
  // The picture. Gemini paints it as this host's own `background-image`; we paint
  // an `<img>` instead, for a reason recorded in `GeminiBentoCard.tsx` — CSS has
  // no error event and no per-element referrer policy, and we need both.
  //
  // These four declarations reproduce the used box of the background exactly.
  // `background-size: cover` + `background-position: 50%` against the padding box
  // is the same fit as `object-fit: cover` + `object-position: 50%` against a
  // layer stretched to `inset: 0`; both scale the source by
  // max(boxW/srcW, boxH/srcH) and centre the overflow. `inset` is used rather
  // than `width/height: 100%` so the box is the host's, not the content box the
  // host's 16-32px padding would otherwise impose.
  //
  // `z-index: 0` is what keeps it a background. The scrim (`::after`) is also
  // `z-index: 0` but comes later in paint order, so it lands on top; the text is
  // `z-index: 1` via `.smd-bento-card > *` and lands above both. Written
  // explicitly because that selector would otherwise catch this layer too and
  // lift the picture over its own scrim.
  //
  // `border-radius: inherit` because `overflow: hidden` on the host clips a
  // background to the border box automatically but only clips a child's box —
  // the corners have to be asked for.
  '.smd-bento-image {',
  '  position: absolute;',
  '  inset: 0;',
  '  z-index: 0;',
  '  width: 100%;',
  '  height: 100%;',
  '  object-fit: cover;',
  '  object-position: 50%;',
  '  border-radius: inherit;',
  '  pointer-events: none;',
  '  user-select: none;',
  '}',
  // A card whose background image failed and which has no text would otherwise
  // be an empty box — the blank card in the report. It gets the same
  // `--bard-color-image-placeholder-background` (#35383b) fill the hero
  // placeholder uses, so the two failure states read alike. Absolute inset
  // rather than a background on the host, because the host's own
  // `background-color` is the card surface and stays visible behind the text
  // when a card does have text to show.
  '.smd-bento-broken {',
  '  position: absolute;',
  '  inset: 0;',
  '  background-color: #35383b;',
  '}',
  // Size and padding together, one rule per size, mirroring how the live sheet
  // authors them: `.large{padding:…;justify-content:flex-end;height:350px;min-width:350px}`.
  // `min-width` is a floor, and because nothing grows the card its resolved width
  // equals that floor — verified at container widths 708/420/300px and at emulated
  // viewports 1536/1100/900/760/700/600/480px, with every box unchanged.
  '.smd-bento-small { min-width: 171px; width: 171px; height: 171px; }',
  '.smd-bento-medium { min-width: 350px; width: 350px; height: 171px; padding: 16px 32px; }',
  '.smd-bento-large {',
  '  min-width: 350px;',
  '  width: 350px;',
  '  height: 350px;',
  '  padding: 20px;',
  '  justify-content: flex-end;',
  '}',
  '.smd-bento-card[role="button"] { cursor: pointer; }',
  '.smd-bento-card > * { z-index: 1; }',
  '.smd-bento-has-image { color: #fff; }',
  // The scrim, and it is gated on `has-text` as well as on the image:
  // `.has-background-image.has-text:after`. An image-only card gets no gradient,
  // because the gradient exists to make text legible.
  '.smd-bento-has-image.smd-bento-has-text::after {',
  '  content: "";',
  '  position: absolute;',
  '  inset: 0;',
  '  z-index: 0;',
  '  background: linear-gradient(0deg in oklab, rgba(0, 0, 0, 0.82) 3%, transparent 60%);',
  '  border-radius: inherit;',
  '  pointer-events: none;',
  '}',
  '.smd-bento-small.smd-bento-has-image { justify-content: flex-end; }',
  '.smd-bento-large.smd-bento-has-image.smd-bento-has-text::after {',
  '  background: linear-gradient(0deg in oklab, rgba(0, 0, 0, 0.82) 3%, transparent 50%);',
  '}',
  '.smd-bento-text { display: flex; flex-direction: column; gap: 4px; }',
  '.smd-bento-attribution {',
  '  box-sizing: border-box;',
  '  position: absolute;',
  '  top: 0;',
  '  inset-inline-end: 0;',
  '  z-index: 1;',
  '  max-width: max(70%, 120px);',
  '  background-color: rgba(0, 0, 0, 0.5);',
  '  backdrop-filter: blur(17px);',
  '  color: #fff;',
  '  padding: 4px 21px 4px 8px;',
  '  border-start-start-radius: 0;',
  '  border-start-end-radius: 14px;',
  '  border-end-start-radius: 14px;',
  '  border-end-end-radius: 0;',
  '  cursor: default;',
  '  overflow: hidden;',
  '  text-overflow: ellipsis;',
  '  white-space: nowrap;',
  '  font-size: 13px;',
  '  line-height: 17px;',
  '  font-weight: 400;',
  '  font-variation-settings: "ROND" 0, "slnt" 0, "wdth" 92, "wght" 400;',
  '}',
  // The five `gds-*` type scales the card's own bindings select between.
  '.smd-bento-card .gds-emphasized-headline-l {',
  '  font-size: 28px; line-height: 36px; font-weight: 350;',
  '  font-variation-settings: "ROND" 20, "slnt" 0, "wdth" 100, "wght" 350;',
  '}',
  '.smd-bento-card .gds-headline-s {',
  '  font-size: 20px; line-height: 24px; font-weight: 470;',
  '  font-variation-settings: "ROND" 20, "slnt" 0, "wdth" 94, "wght" 470;',
  '}',
  '.smd-bento-card .gds-body-l {',
  '  font-size: 17px; line-height: 24px; font-weight: 400;',
  '  font-variation-settings: "ROND" 0, "slnt" 0, "wdth" 92, "wght" 400;',
  '}',
  '.smd-bento-card .gds-body-m {',
  '  font-size: 15px; line-height: 20px; font-weight: 400;',
  '  font-variation-settings: "ROND" 0, "slnt" 0, "wdth" 92, "wght" 400;',
  '}',
  '.smd-bento-card .gds-body-s {',
  '  font-size: 13px; line-height: 17px; font-weight: 400;',
  '  font-variation-settings: "ROND" 0, "slnt" 0, "wdth" 92, "wght" 400;',
  '}',
  // ── Gemini's markdown inline image ─────────────────────────────────────────
  // From the markdown component's own sheet (`ng-c3833238931`). rem values are
  // resolved at the measured 16px root: 1.75rem = 28px, 1.5rem = 24px.
  '.smd-inline-image-container { overflow: hidden; }',
  // The float sits HERE, before the orientation caps, because that is where the
  // authored sheet puts it — and the order decides the width. `max-width: 40%`
  // would be 283px in a 708px panel, but `.landscape` comes later and wins, so
  // the box measures 362px. Probed live: rect [688, 688, 362, 567].
  '@media only screen and (min-width: 768px) {',
  '  .smd-inline-image-container { float: right; margin-inline-start: 16px; max-width: 40%; }',
  '}',
  '.smd-inline-landscape { max-width: 362px; }',
  '.smd-inline-portrait { max-width: 300px; }',
  '.smd-inline-image-wrapper {',
  '  position: relative;',
  '  overflow: hidden;',
  '  border-radius: 28px;',
  '  margin-block-start: 24px;',
  '  cursor: pointer;',
  '}',
  '.smd-inline-img { display: block; width: 100%; height: auto; }',
  '.smd-inline-image-caption {',
  '  display: block;',
  '  padding-block: 8px 24px;',
  '  padding-inline-start: 16px;',
  '  color: rgb(227, 227, 227);',
  '  overflow: hidden;',
  '  text-overflow: ellipsis;',
  '  white-space: nowrap;',
  // .gds-extended-caption, read live off the class itself.
  '  font-family: "Google Sans Code", monospace;',
  '  font-size: 13px;',
  '  line-height: 20px;',
  '  font-style: italic;',
  '  font-weight: 400;',
  '  letter-spacing: 0;',
  '  font-variation-settings: "MONO" 0, "wght" 400;',
  '}',
  // ── Gemini's `single-image`, the centred hero host ─────────────────────────
  // A different component from `.inline-image-container` above: Gemini emits
  // this one for an image *attachment*, which is what an "images of …" answer
  // returns. Rules transcribed from the captured component sheet; the geometry
  // comments cite the live capture that confirmed each one.
  //
  // Live tree, viewport 1536x826: container 263x432 -> overlay 263x432 ->
  // button 263x384 -> img 263x380, caption row 263x40. 384 + 8 + 40 = 432.
  '.smd-single-image { display: block; }',
  // `.spark-licensed-center`. The sheet declares margin-block: 12px, but the
  // live node computed 0px top and bottom — the measurement wins.
  '.smd-image-container {',
  '  display: flex;',
  '  flex-direction: column;',
  '  align-items: center;',
  '  text-align: center;',
  '}',
  // `.hero-overlay-container` — hugs the image and caps against the declared
  // width, which is the image's own intrinsic width (263px measured = the
  // `width` attribute = naturalWidth).
  '.smd-hero-overlay-container {',
  '  position: relative;',
  '  width: fit-content;',
  '  max-width: min(var(--hero-declared-width, 100%), 25rem);',
  '  align-self: stretch;',
  '}',
  '@media screen and (min-width: 600px) {',
  '  .smd-hero-overlay-container { max-width: min(var(--hero-declared-width, 100%), 36.25rem); }',
  '}',
  '@media screen and (max-width: 959.98px) {',
  '  .smd-hero-overlay-container { max-width: 100%; }',
  '}',
  // Portrait and square cap at 25rem even on a wide viewport; only landscape
  // gets the 36.25rem cap. Straight from the `:has()` rules in the sheet.
  '.smd-hero-overlay-container:has(.smd-spark-licensed-portrait),',
  '.smd-hero-overlay-container:has(.smd-spark-licensed-square) {',
  '  max-width: min(var(--hero-declared-width, 100%), 25rem);',
  '}',
  // `.image-button` — a real button, so it is focusable; the underline is the
  // sheet's own and is why `text-decoration: underline` appears on a wrapper
  // that shows no text.
  '.smd-image-button {',
  '  background: none;',
  '  border: none;',
  '  margin: 0;',
  '  padding: 0;',
  '  display: block;',
  '  width: fit-content;',
  '  max-width: 100%;',
  '  overflow: hidden;',
  '  cursor: pointer;',
  '  color: inherit;',
  '}',
  // The img stays `display: inline` on purpose. Measured live: the button is
  // 384px around a 380px image because an inline image sits on a baseline and
  // leaves a 4px descender gap. `display: block` would remove those 4px.
  '.smd-hero-image {',
  '  width: auto;',
  '  height: auto;',
  '  max-width: min(var(--hero-declared-width, 100%), 25rem);',
  '  border-radius: 40px;',
  '}',
  '@media screen and (min-width: 600px) {',
  '  .smd-hero-image:not(.smd-spark-licensed-portrait):not(.smd-spark-licensed-square) {',
  '    max-width: min(var(--hero-declared-width, 100%), 36.25rem);',
  '  }',
  '}',
  '@media screen and (max-width: 959.98px) {',
  '  .smd-hero-image { max-width: 100%; }',
  '}',
  // 2.5rem = the 40px radius measured on the live hero image.
  '.smd-spark-licensed-portrait, .smd-spark-licensed-landscape, .smd-spark-licensed-square {',
  '  width: 100%;',
  '  height: auto;',
  '  border-radius: 2.5rem;',
  '}',
  // `.image.animate.loaded` — a 200ms zoom-in on the curve the sheet names.
  '.smd-hero-image.loaded {',
  '  animation: smd-hero-zoom-load 0.2s cubic-bezier(0.2, 0, 0, 1) forwards;',
  '}',
  '@keyframes smd-hero-zoom-load {',
  '  0% { opacity: 0; transform: scale(1.15); }',
  '  to { opacity: 1; transform: scale(1); }',
  '}',
  // `.hero-caption-row`, measured 263x40 with margin-top 8px.
  '.smd-hero-caption-row {',
  '  display: flex;',
  '  align-items: flex-start;',
  '  justify-content: space-between;',
  '  position: relative;',
  '  margin-top: 8px;',
  '  flex-wrap: wrap;',
  '}',
  // `.caption.hero-caption`, read live: 13px/20px Google Sans Code, MONO 0 /
  // wght 400, colour rgb(227,227,227), margin-inline 16px, flex 1 1 0, and
  // `white-space: normal` — it wraps, unlike the inline-image caption above.
  '.smd-hero-caption {',
  '  flex: 1 1 0%;',
  '  min-width: 0;',
  '  margin-top: 0;',
  '  margin-bottom: 0;',
  '  margin-inline: 16px;',
  '  text-align: start;',
  '  color: rgb(227, 227, 227);',
  '  font-family: "Google Sans Code", monospace;',
  '  font-size: 13px;',
  '  line-height: 20px;',
  '  font-weight: 400;',
  '  font-variation-settings: "MONO" 0, "wght" 400;',
  '  white-space: normal;',
  '  overflow: visible;',
  '  text-overflow: unset;',
  '}',
  // The failed-image state. Gemini's `.placeholder` is a 200px flex row with a
  // centred message; this is the hole the report showed as a blank card.
  // Values below are resolved from the live page, not from the raw sheet: the
  // base rule says `border-radius: 16px`, but `.luminous-layout:host
  // .placeholder` overrides it with `--gem-sys-shape--corner-extra-large-max`,
  // which computes to 40px — matching the hero image it stands in for. The
  // background is `--bard-color-image-placeholder-background` = #35383b, a
  // lighter grey than the surface, so a failed image reads as a distinct slot
  // rather than a hole in the page.
  '.smd-hero-placeholder {',
  '  display: flex;',
  '  align-items: center;',
  '  justify-content: center;',
  '  height: 200px;',
  '  width: 100%;',
  '  max-width: 100%;',
  '  border-radius: 40px;',
  '  background-color: #35383b;',
  '  color: rgb(196, 199, 197);',
  '}',
  '.smd-hero-message { flex: 1; text-align: center; padding: 10%; }',
  '.smd-hero-icon { width: 24px; height: 24px; margin-bottom: 8px; opacity: 0.8; }',
  '.smd-hero-message-text { font-size: 13px; line-height: 20px; }',
  // Gemini pulses a still-loading placeholder: `.placeholder.loading` runs
  // `pulse 1.5s linear infinite`, captured from the live keyframes.
  '.smd-hero-placeholder.smd-hero-loading {',
  '  animation: smd-hero-pulse 1.5s linear infinite;',
  '}',
  '@keyframes smd-hero-pulse {',
  '  0% { opacity: 1; }',
  '  33% { opacity: 0.65; }',
  '  100% { opacity: 1; }',
  '}',
  '.smd-footnotes {',
  '  display: flex;',
  '  flex-direction: column;',
  '  gap: 12px;',
  '  border-top: 1px solid rgba(255, 255, 255, 0.12);',
  '  color: rgb(196, 199, 197);',
  '  font-size: 14px;',
  '  line-height: 20px;',
  '  padding-top: 16px;',
  '}',
  '.smd-footnotes ol { margin: 0; padding-left: 24px; }',
  '.smd-footnote-ref { font-size: 12px; line-height: 1; vertical-align: super; }',
  '.smd-scroll { scrollbar-width: auto; scrollbar-color: auto; }',
  '.smd-scroll::-webkit-scrollbar, .smd-scroll::-webkit-scrollbar-corner { width: 12px; height: 12px; background: transparent; }',
  '.smd-scroll::-webkit-scrollbar-track { background: transparent; }',
  '.smd-scroll::-webkit-scrollbar-thumb { min-width: 48px; min-height: 48px; border: 2px solid transparent; border-radius: 9999px; background: transparent; background-clip: content-box; }',
  '.smd-scroll:hover::-webkit-scrollbar-thumb { background-color: #333537; background-clip: content-box; }',
  '.smd-scroll::-webkit-scrollbar-thumb:hover, .smd-scroll::-webkit-scrollbar-thumb:active { background-color: #444746; background-clip: content-box; }',
  '.smd-scroll::-webkit-scrollbar-button { width: 0; height: 0; }',
  // No responsive reflow, and this is measured rather than assumed: emulating
  // viewports of 1536, 1100, 900, 760, 700, 600 and 480px left `flex-wrap` at
  // `nowrap` and every card at its declared 350/171 in all seven cases. Gemini
  // lets the tiling overflow a narrow panel; it does not wrap or shrink it.
  '@media (max-width: 640px) {',
  '  .smd-code-block { margin: 8px 0 0; border-radius: 28px; padding: 20px 0 24px 20px; }',
  '  .smd-code-pre code { padding-right: 20px; }',
  '  .smd-media-gallery { grid-template-columns: minmax(0, 1fr); }',
  '  .smd-table-block { width: 100%; }',
  '  .smd-table th, .smd-table td { min-width: 132px; }',
  '}',
  '@media (prefers-reduced-motion: reduce) {',
  '  .smd-streaming .smd-w, .smd-streaming .smd-h, .smd-streaming .smd-list > li.smd-reveal-block:not(.smd-settled)::before, .smd-streaming .smd-code-block,',
  '  .smd-streaming .smd-table-block, .smd-streaming .smd-media-gallery, .smd-streaming .smd-math-display { animation: none !important; }',
  '  .smd-media-loading::before, .smd-media-loading::after { animation: none !important; }',
  // `animation: none` also drops the fill mode, so the chip returns to its
  // default opacity 1 rather than being stranded at the keyframe's 0.
  '  .smd-src-chip-enter { animation: none !important; }',
  '}',

  // ── Inline source chips ────────────────────────────────────────────────────
  // Transcribed from Gemini's `.source-inline-chip-container.luminous-sources`
  // rules with its design tokens resolved to the values measured live:
  //   --gem-sys-spacing--xs 4px  --s 8px  --m 12px  --xl 20px
  //   --gem-sys-shape--corner-small 8px  --medium 12px  --large 16px  --full 9999px
  //   --lumi-sys-color--surface-dim #171717  --surface-bright #1f1f1f
  //   --lumi-sys-color--on-surface-variant rgba(255,255,255,0.55)
  //   --lumi-sys-color--on-surface-low rgba(255,255,255,0.12)
  //   --gem-sys-color--on-surface #e3e3e3  --on-surface-variant #c4c7c5
  // Body-s is 13px/17px, body-m 15px/20px.
  '.smd-src { white-space: pre-wrap; user-select: none; -webkit-user-select: none; }',
  // Staggered entrance. NOT extracted from Gemini -- Gemini shows its chips with
  // no entrance animation at all (getAnimations() returned [] on a live capture).
  // This is a deliberate local divergence, requested to be tried.
  //
  // The numbers are anchored to the text fade rather than picked freely: one chip
  // takes 180ms, and each subsequent chip starts 70ms after the one before, so a
  // four-chip answer finishes in 180 + 3x70 = 390ms -- about the same 400ms a
  // single word fade already takes. The cascade therefore reads as quick relative
  // to everything else on screen instead of as a new, slower thing.
  '@keyframes smd-src-chip-in {',
  '  from { opacity: 0; }',
  '  to { opacity: 1; }',
  '}',
  // Scoped to `.smd-streaming` for the same reason every text reveal above is:
  // a chat loaded from disk renders `.smd-static`, and an unscoped rule replayed
  // this entrance there. It was visible rather than theoretical -- assistant
  // turns carry `content-visibility: auto`, so a skipped turn does not start its
  // animations until it scrolls into view, and scrolling up through an old chat
  // dealt out the whole cascade turn by turn.
  //
  // A live turn keeps its entrance. Chips are only built once
  // `effectiveStreaming` goes false, and that same transition arms the
  // `keepTailAnimation` timeout rather than clearing it, so the root is still
  // `.smd-streaming` when they mount. The window outlasts the cascade at every
  // length: the tail is 760ms + 120ms per extra reveal unit, the cascade
  // 180ms + 70ms per extra chip, and there are never more chips than units.
  '.smd-streaming .smd-src-chip-enter {',
  '  animation-name: smd-src-chip-in;',
  '  animation-duration: 180ms;',
  '  animation-timing-function: var(--fade-animation-function);',
  '  animation-fill-mode: both;',
  '  animation-iteration-count: 1;',
  '}',
  // inline-flex + the -8px block margin is Gemini's trick to keep a 21px chip
  // inside a 24px line box: 21 - 8 - 8 = 5px of contributed height.
  '.smd-src-chip {',
  '  position: relative;',
  '  display: inline-flex;',
  '  flex-direction: column;',
  '  white-space: nowrap;',
  '  vertical-align: baseline;',
  '  margin-block: -8px;',
  '  margin-inline-start: 0;',
  '  user-select: none;',
  '  -webkit-user-select: none;',
  '}',
  '.smd-src-btn {',
  '  display: flex;',
  '  align-items: baseline;',
  '  justify-content: center;',
  '  width: fit-content;',
  '  height: auto;',
  '  margin: 0;',
  '  padding-block: 2px;',   // calc(--xs * .5)
  '  padding-inline: 6px;',  // calc(--xs * 1.5)
  '  border: 0;',
  '  border-radius: 9999px;',
  '  background: #171717;',
  '  color: rgba(255, 255, 255, 0.55);',
  '  cursor: pointer;',
  '  box-sizing: border-box;',
  '  font: inherit;',
  '  -webkit-appearance: none;',
  '  appearance: none;',
  '  user-select: none;',
  '  -webkit-user-select: none;',
  '}',
  // Measured: the button has no hover, no active and no open state. Only
  // aria-expanded changes. Focus-visible is ours — Gemini relies on the UA ring.
  '.smd-src-btn:focus-visible { outline: 2px solid rgba(255, 255, 255, 0.55); outline-offset: 2px; }',
  '.smd-src-label {',
  '  display: flex;',
  '  align-items: baseline;',
  '  font-family: "Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif;',
  '  font-size: 13px;',
  '  font-weight: 400;',
  '  line-height: 17px;',
  '  font-variation-settings: "ROND" 0, "slnt" 0, "wdth" 92, "wght" 400;',
  '  user-select: none;',
  '  -webkit-user-select: none;',
  '}',
  // max-width is an inline style on Gemini's span; 20ch measured to 168.61px.
  '.smd-src-title {',
  '  display: inline-block;',
  '  max-width: 20ch;',
  '  overflow: hidden;',
  '  text-overflow: ellipsis;',
  '  white-space: nowrap;',
  '  vertical-align: middle;',
  '}',
  '.smd-src-count { margin-inline-start: 0.25em; flex-shrink: 0; white-space: nowrap; }',

  // ── Hover card ─────────────────────────────────────────────────────────────
  // Pane top is flush with the chip's bottom (measured anchorBottomToPaneTop: 0)
  // and the 12px padding is a live hover bridge, so the pointer can cross the
  // visual gap without closing the card.
  '.smd-src-pane {',
  // Fixed, and portalled to <body>, because the pane must escape the chat
  // scroller's stacking context: `main` is z-10 and the composer inside it is
  // z-20, so ANY z-index here loses -- the pane is trapped in an ancestor
  // context and paints under the composer.
  //
  // There is deliberately no `left`/`top`/`transform` here. SourceChip computes
  // the final viewport coordinates itself and writes them inline; a `left: 50%`
  // or `translateX(-50%)` in this rule would be applied ON TOP of an already
  // absolute left edge and put the pane half its own width off-target.
  '  position: fixed;',
  '  z-index: 1000;',
  '  padding: 12px 0;',
  '  filter: drop-shadow(0 0 28px rgba(255, 255, 255, 0.12));',
  '  cursor: default;',
  '  white-space: normal;',
  '}',
  '.smd-src-card-shell {',
  '  position: relative;',
  '  display: flex;',
  '  flex-direction: column;',
  '  width: 23.75rem;',  // 380px
  '  max-width: calc(100vw - 20px);',
  '  box-sizing: border-box;',
  '  border-radius: 16px;',
  '  background-color: #1f1f1f;',
  '}',
  // 28x12 notch, offset by half its width, mirrored when the card flips above.
  '.smd-src-pointer {',
  '  position: absolute;',
  '  top: -12px;',
  '  left: 50%;',
  '  width: 28px;',
  '  height: 12px;',
  '  transform: translateX(-50%) translateX(calc(var(--smd-src-shift, 0px) * -1));',
  '  fill: #1f1f1f;',
  '  overflow: visible;',
  '}',
  '.smd-src-pane-above .smd-src-pointer {',
  '  top: auto;',
  '  bottom: -12px;',
  '  transform: translateX(-50%) translateX(calc(var(--smd-src-shift, 0px) * -1)) scaleY(-1);',
  '}',
  '.smd-src-stack {',
  '  position: relative;',
  '  z-index: 1;',
  '  display: flex;',
  '  flex-direction: column;',
  '  margin: 8px;',
  '  gap: 8px;',
  '  border-radius: 12px;',
  '  overflow-y: auto;',
  '  max-height: 18.75rem;',  // 300px
  '}',
  '.smd-src-card { text-decoration: none; color: inherit; display: block; }',
  '.smd-src-card-inner {',
  '  display: flex;',
  '  flex-direction: column;',
  '  align-items: flex-start;',
  '  padding: 8px;',
  '  border-radius: 8px;',
  // The font stack lives here, not on each row, because the card renders in two
  // places and one of them inherits from the wrong ancestor. `.smd-src-pane` is
  // portalled to <body>, so it is OUTSIDE `.smd-root` and never sees the
  // font-family that rule sets -- measured on Willow, a probe element carrying
  // `.smd-src-card-title` in <body> computed `Inter, sans-serif` at 16/24, the
  // page default. Gemini's own rows measured "Google Sans Flex" with
  // `wdth` 92 / `wght` 400 and `word-break: auto-phrase`. Declaring it on the
  // shared container fixes both mount points at once and mirrors Gemini, where
  // every row inherits these from an ancestor rather than restating them.
  '  font-family: "Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif;',
  '  font-weight: 400;',
  '  font-variation-settings: "ROND" 0, "slnt" 0, "wdth" 92, "wght" 400;',
  '  word-break: auto-phrase;',
  '}',
  // Measured hover: background #171717 and the radius grows 8px -> 12px.
  '.smd-src-card:hover .smd-src-card-inner { background-color: #171717; border-radius: 12px; }',
  '.smd-src-card-header { display: inline-flex; align-items: center; justify-content: flex-start; gap: 4px; }',
  '.smd-src-card-icon { display: inline-flex; align-items: center; justify-content: center; height: 24px; }',
  // 9x9 image inside 1.5px padding = a 12x12 box, from a 32px source.
  '.smd-src-card-img { height: 9px; width: 9px; padding: 1.5px; box-sizing: content-box; border-radius: 50%; }',
  '.smd-src-card-img-fallback { background: rgba(255, 255, 255, 0.24); }',
  '.smd-src-card-path {',
  '  font-size: 13px;',
  '  line-height: 17px;',
  '  color: #c4c7c5;',
  '  overflow: hidden;',
  '  text-overflow: ellipsis;',
  '  white-space: nowrap;',
  '}',
  '.smd-src-card-title {',
  '  display: -webkit-box;',
  '  -webkit-box-orient: vertical;',
  '  -webkit-line-clamp: 1;',
  '  overflow: hidden;',
  '  text-overflow: ellipsis;',
  '  overflow-wrap: anywhere;',
  '  padding-top: 2px;',
  '  font-size: 15px;',
  '  line-height: 20px;',
  '  color: #e3e3e3;',
  '}',
  // Row 3, measured off Gemini's live `div.snippet.gds-body-s` with the card
  // mounted -- the values could not be read before, because Angular injects
  // `inline-source-card`'s stylesheet on first mount and nothing had mounted one
  // (4,657 rules walked, zero card rules). Hovering a source chip mounts it.
  //
  // Measured: padding `8px 0 0`, 13/17, #c4c7c5, clamp 2, `overflow-wrap:
  // anywhere`. The 8px padding-top IS the gap between the title and the snippet;
  // there is no `gap` or `margin` involved, so it is expressed the same way here.
  //
  // No width or `align-self`: the measured 348px is simply the container's content
  // box (364 - 8 - 8), which a flex item with long text fills on its own. The
  // title above it measured 209.25px from the same rules because its text is
  // short. Declaring a width would break that.
  //
  // `display: -webkit-box` is authored; Chrome reports `flow-root` back for a
  // clamped box, which is its readout and not a dropped declaration.
  '.smd-src-card-snippet {',
  '  display: -webkit-box;',
  '  -webkit-box-orient: vertical;',
  '  -webkit-line-clamp: 2;',
  '  overflow: hidden;',
  '  text-overflow: ellipsis;',
  '  overflow-wrap: anywhere;',
  '  padding-top: 8px;',
  '  font-size: 13px;',
  '  line-height: 17px;',
  '  color: #c4c7c5;',
  '}',
].join('\n');

function useInjectStyles() {
  useInsertionEffect(() => {
    if (typeof document === 'undefined') return;
    const existing = document.getElementById(STYLE_ID);
    if (existing) {
      // Refresh when the content differs instead of no-oping unconditionally.
      // Multiple mounts still write nothing (the string is identical), but an
      // HMR edit to this file used to leave a long-lived tab running the NEW
      // component against the OLD stylesheet. That combination is not merely
      // stale, it is incoherent: the pane's position moved from CSS
      // (`left: 50%` + `translateX(-50%)`) into JS, so old CSS plus new JS
      // applied the -50% twice and put the pane 190px to the left of its chip.
      if (existing.textContent !== STYLE_CSS) existing.textContent = STYLE_CSS;
      return;
    }
    const element = document.createElement('style');
    element.id = STYLE_ID;
    element.textContent = STYLE_CSS;
    document.head.appendChild(element);
  }, []);
}

export { useInjectStyles };
