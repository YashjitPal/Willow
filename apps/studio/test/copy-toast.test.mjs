/**
 * Gemini's copy snackbars, pinned to what was measured off the live app over
 * CDP so a later tidy-up cannot quietly drift them.
 *
 * There are TWO, raised by two different Copy buttons:
 *
 *   response Copy  ->  "Copied to clipboard",  no button
 *   prompt Copy    ->  "Prompt copied"      +  a "Start new chat" tonal pill
 *
 * They were measured separately and agree on everything else — same 344x60
 * surface at x=24, same tree, same enter, same exit (dwell 2163.4ms vs
 * 2175.2ms, exit 83.7ms vs 84.7ms) — so one component renders both.
 *
 * Capture conditions: gemini.google.com, viewport 1419x826, dpr 1.25, over ten
 * CDP passes. Two findings drove the shape of the implementation and are the
 * reason this file exists:
 *
 *   1. The snackbar is at the bottom LEFT, not the bottom right. Gemini's
 *      `.cdk-global-overlay-wrapper` computed `justify-content: flex-start;
 *      align-items: flex-end`, and the surface measured 24px from the left
 *      edge and 24.4px from the bottom.
 *
 *   2. The Copy button does NOT swap to a tick. Read immediately before and
 *      immediately after the click, it was byte-identical both times:
 *      icon "copy", "Luminous Symbols" 20px, fvs "FILL" 0, "GRAD" 0,
 *      "ROND" 100, "opsz" 20, "wght" 320, colour rgb(230, 230, 230).
 *      The snackbar alone is the feedback, so Willow's 1600ms `check` swap was
 *      removed from both the user-prompt and the response action rows.
 *
 * Timing came from a single uninterrupted page-side rAF clock (an earlier pass
 * measured it across CDP round-trips, which made the number meaningless):
 *
 *   node inserted -> exit animation starts   2163.4ms
 *   exit starts   -> removed from the DOM      83.7ms
 *   total on screen                         2247.1ms
 *
 * 2163.4 - 150 (the enter animation) is the ~2000ms configured dwell. Material
 * only arms its dismiss timer once the enter animation has finished, which is
 * why the component waits for `animationend` rather than starting at mount.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const css = read('platform/ui/src/CopyToast.css');
const toast = read('platform/ui/src/CopyToast.tsx');
const store = read('platform/ui/src/copy-toast-store.ts');
const main = read('apps/studio/src/main.tsx');
const chatView = read('features/chat/src/ChatView.tsx');
const chrome = read('features/chat/src/ChatResponseChrome.tsx');

/** Strip comments so a measured value quoted in prose cannot satisfy a match. */
const codeOnly = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

const cssCode = codeOnly(css);
const toastCode = codeOnly(toast);
const chatViewCode = codeOnly(chatView);
const chromeCode = codeOnly(chrome);

// --- Placement -------------------------------------------------------------

test('the overlay host pins the snackbar to the bottom-left, as Gemini does', () => {
  // .cdk-global-overlay-wrapper: position absolute, inset 0, flex,
  // justify-content flex-start, align-items flex-end.
  const host = cssCode.slice(
    cssCode.indexOf('.willow-copy-toast-container'),
    cssCode.indexOf('.willow-copy-toast {'),
  );
  assert.ok(host.length > 0, 'could not locate the overlay host rule');
  assert.match(host, /position:\s*fixed/);
  assert.match(host, /inset:\s*0/);
  assert.match(host, /justify-content:\s*flex-start/);
  assert.match(host, /align-items:\s*flex-end/);
  // Both CDK layers above the pane measured `pointer-events: none`, so the
  // empty full-viewport layer never eats clicks on the sidebar footer beneath
  // it. `.willow-copy-toast` puts it back for the action button.
  assert.match(host, /pointer-events:\s*none/);
});

test('the 24px offset comes from the padding and margin Gemini measured', () => {
  // Surface sat 24px from the left edge and 24.4px from the bottom. That is
  // MAT-SNACK-BAR-CONTAINER's own 16px padding plus its 8px margin — not a
  // hard-coded inset — so both have to survive.
  const animated = cssCode.slice(
    cssCode.indexOf('.willow-copy-toast {'),
    cssCode.indexOf('.willow-copy-toast--hiding'),
  );
  assert.ok(animated.length > 0, 'could not locate the animated container rule');
  assert.match(animated, /padding:\s*16px/);
  assert.match(animated, /margin:\s*8px/);
  assert.match(animated, /background:\s*transparent/);
});

// --- Surface and label -----------------------------------------------------

test('the surface keeps its measured 344x60 box and chrome', () => {
  const surface = cssCode.slice(
    cssCode.indexOf('.willow-copy-toast__surface'),
    cssCode.indexOf('.willow-copy-toast__row'),
  );
  assert.ok(surface.length > 0, 'could not locate the surface rule');
  assert.match(surface, /min-width:\s*344px/);
  assert.match(surface, /max-width:\s*672px/);
  assert.match(surface, /border-radius:\s*16px/);
  assert.match(surface, /background:\s*rgb\(31,\s*31,\s*31\)/);
  assert.match(surface, /color:\s*rgb\(230,\s*230,\s*230\)/);
  assert.match(surface, /box-shadow:\s*rgba\(0,\s*0,\s*0,\s*0\.28\)\s*0\s*0\s*20px\s*0/);
  assert.match(surface, /padding:\s*0\s+12px\s+0\s+0/);
});

test('the row carries the min-height that holds the surface open at 60px', () => {
  // The label's own padded height is only 44px (12 + 20 + 12). Gemini's
  // DIV.container supplies the remaining 16 with `min-height: 60px`; without
  // it the whole snackbar renders too short.
  const row = cssCode.slice(
    cssCode.indexOf('.willow-copy-toast__row'),
    cssCode.indexOf('.willow-copy-toast__label'),
  );
  assert.ok(row.length > 0, 'could not locate the row rule');
  assert.match(row, /min-height:\s*60px/);
  assert.match(row, /align-items:\s*center/);
});

test('the label uses the type measured on the node that owns the text', () => {
  // 15px/20px weight 400 — NOT the 16px the outer wrappers report. Reading
  // type off any ancestor returns the unstyled Angular wrapper, which measured
  // "Times New Roman".
  const label = cssCode.slice(
    cssCode.indexOf('.willow-copy-toast__label'),
    cssCode.indexOf('.willow-copy-toast__actions'),
  );
  assert.ok(label.length > 0, 'could not locate the label rule');
  assert.match(label, /font-size:\s*15px/);
  assert.match(label, /line-height:\s*20px/);
  assert.match(label, /font-weight:\s*400/);
  assert.match(label, /font-family:\s*"Google Sans Flex"/);
  assert.match(label, /font-variation-settings:\s*"ROND" 0,\s*"slnt" 0,\s*"wdth" 92,\s*"wght" 400/);
  assert.match(label, /padding:\s*12px\s+4px\s+12px\s+24px/);
  assert.match(label, /color:\s*rgb\(230,\s*230,\s*230\)/);
});

// --- Animation -------------------------------------------------------------

test('enter is 150ms cubic-bezier(0, 0, 0.2, 1), scaling 0.8 -> 1 while fading in', () => {
  // Authored keyframes `_mat-snack-bar-enter`, recovered verbatim from
  // Gemini's stylesheets, and confirmed against 11 sampled frames.
  assert.match(
    cssCode,
    /animation:\s*willow-copy-toast-enter\s+150ms\s+cubic-bezier\(0,\s*0,\s*0\.2,\s*1\)\s+forwards/,
  );
  const enter = cssCode.slice(
    cssCode.indexOf('@keyframes willow-copy-toast-enter'),
    cssCode.indexOf('@keyframes willow-copy-toast-exit'),
  );
  assert.match(enter, /transform:\s*scale\(0\.8\)/);
  assert.match(enter, /opacity:\s*0/);
  assert.match(enter, /transform:\s*scale\(1\)/);
});

test('exit is 75ms cubic-bezier(0.4, 0, 1, 1) and fades only — no scale-down', () => {
  // Sampled exit frames held `transform: none` throughout while opacity ran
  // 1 -> 0.92 -> 0.73 -> 0.48 -> 0.17. A symmetric scale-out would be invented.
  assert.match(
    cssCode,
    /animation:\s*willow-copy-toast-exit\s+75ms\s+cubic-bezier\(0\.4,\s*0,\s*1,\s*1\)\s+forwards/,
  );
  const exit = cssCode.slice(cssCode.indexOf('@keyframes willow-copy-toast-exit'));
  assert.ok(exit.length > 0, 'could not locate the exit keyframes');
  assert.ok(
    !/transform/.test(exit.slice(0, exit.indexOf('@media'))),
    'the exit animation must not scale — Gemini only fades',
  );
});

test('the dwell is 2000ms and is armed by the enter animation ending', () => {
  assert.match(toastCode, /const DWELL_MS = 2000;/);
  assert.match(toastCode, /const ENTER_MS = 150;/);
  assert.match(toastCode, /const EXIT_MS = 75;/);
  // Waiting for `animationend` rather than starting at mount is what makes the
  // measured 2163ms insert->exit interval come out right.
  assert.match(toastCode, /addEventListener\('animationend', onEnd\)/);
  assert.match(toastCode, /e\.animationName === ENTER_ANIMATION/);
  assert.match(toastCode, /setTimeout\(\(\) => setHiding\(true\), DWELL_MS\)/);
});

test('teardown happens on the exit animationend, with a timeout only as a net', () => {
  assert.match(toastCode, /setTimeout\(done, EXIT_MS \+ 50\)/);
  assert.match(toastCode, /setTimeout\(arm, ENTER_MS \+ 50\)/);
});

test('reduced motion collapses both animations', () => {
  const reduced = cssCode.slice(cssCode.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.ok(reduced.length > 0, 'missing the reduced-motion block');
  assert.match(reduced, /animation-duration:\s*1ms/);
});

// --- Wiring ----------------------------------------------------------------

test('the overlay host is queried before being created', () => {
  // StrictMode double-invokes effects in dev; creating unconditionally leaves
  // two hosts on <body>. Same guard as Tooltip's getOverlayContainer.
  assert.match(toastCode, /querySelector<HTMLElement>\('\.willow-copy-toast-container'\)/);
  assert.match(toastCode, /if \(existing\) return existing;/);
});

test('the request carries an id so a repeat copy replays the animation', () => {
  // The message text is identical every time, so a plain string atom would
  // `set` the same value twice and nanostores would treat it as no change.
  assert.match(store, /id:\s*number;/);
  assert.match(store, /sequence \+= 1;/);
  assert.match(toastCode, /key=\{request\.id\}/);
});

test('the snackbar host is mounted once at the app root', () => {
  assert.match(main, /import \{ GlobalCopyToast \} from '@willow\/ui\/CopyToast';/);
  assert.match(main, /<GlobalCopyToast \/>/);
});

test('features/chat reaches the overlay through a platform store, not apps/*', () => {
  assert.match(chatView, /import \{ showCopyToast \} from '@willow\/ui\/copy-toast-store';/);
  assert.ok(
    !/from '@willow\/studio\//.test(chatViewCode),
    'features/* must not import from apps/*',
  );
});

// --- The tick is gone ------------------------------------------------------

test('copying raises the snackbar and nothing else', () => {
  const handler = chatViewCode.slice(
    chatViewCode.indexOf('const handleCopy = '),
    chatViewCode.indexOf('const handleCopyPrompt'),
  );
  assert.ok(handler.length > 0, 'could not locate handleCopy');
  assert.match(handler, /showCopyToast\('Copied to clipboard'\)/);
  assert.ok(!/setCopiedId/.test(handler), 'the tick timer must be gone');
});

test('neither action row swaps the copy glyph for a tick', () => {
  // Measured: Gemini's button is unchanged before and after the click.
  assert.ok(!/copiedId/.test(chatViewCode), 'copiedId is dead state and must be removed');
  assert.ok(!/name=\{copied/.test(chromeCode), 'the response row must not render a tick');
  assert.ok(!/\bcopied\b/.test(chromeCode), 'the copied prop is dead and must be removed');
  assert.match(chromeCode, /name="copy"/);
});

// --- The second snackbar: "Prompt copied" + "Start new chat" ---------------
//
// Copying a PROMPT raises a different snackbar from copying a response. Both
// were measured separately and agree on every box and both animations (dwell
// 2163.4ms vs 2175.2ms, exit 83.7ms vs 84.7ms; surface 344x60 at x=24 in both),
// so one component renders both and only the payload differs.

test('the trailing action is optional on the request, not a second component', () => {
  assert.match(store, /export interface CopyToastAction \{/);
  assert.match(store, /label:\s*string;/);
  assert.match(store, /onClick:\s*\(\)\s*=>\s*void;/);
  assert.match(store, /action\?:\s*CopyToastAction;/);
  assert.match(store, /showCopyToast = \(message: string, action\?: CopyToastAction\)/);
});

test('the action reaches the instance and only renders when present', () => {
  assert.match(toastCode, /action=\{request\.action\}/);
  assert.match(toastCode, /\{action && \(/);
  assert.match(toastCode, /\{action\.label\}/);
});

test('clicking the action runs the normal exit, then the callback', () => {
  // Measured (pass 10): the node ran the same `_mat-snack-bar-exit` on
  // dismissal. The 655ms that capture recorded before the exit began was the
  // SPA route change tearing the overlay down, not a designed delay, so no
  // delay is reproduced here.
  const start = toastCode.indexOf('const handleAction');
  assert.ok(start > -1, 'could not locate handleAction');
  const handler = toastCode.slice(start, start + 200);
  assert.match(handler, /setHiding\(true\)/);
  assert.match(handler, /action\?\.onClick\(\)/);
});

test('the action button keeps its measured 121.65x36 box', () => {
  // `.actions` 121.65x36, `height: 36px` AUTHORED — `min-height` measured 0px
  // and the content span is only 20px tall, so the height cannot be derived.
  const actions = cssCode.slice(
    cssCode.indexOf('.willow-copy-toast__actions'),
    cssCode.indexOf('.willow-copy-toast__action {'),
  );
  assert.ok(actions.length > 0, 'could not locate the actions wrapper rule');
  assert.match(actions, /height:\s*36px/);
  assert.match(actions, /flex:\s*0 1 auto/);

  const button = cssCode.slice(
    cssCode.indexOf('.willow-copy-toast__action {'),
    cssCode.indexOf('.willow-copy-toast__action-label'),
  );
  assert.ok(button.length > 0, 'could not locate the action button rule');
  assert.match(button, /height:\s*36px/);
  assert.match(button, /min-width:\s*0/);
  assert.match(button, /padding:\s*0\s+12px/);
  assert.match(button, /border-radius:\s*9999px/);
  assert.match(button, /background:\s*rgb\(23,\s*23,\s*23\)/);
  assert.match(button, /color:\s*rgb\(230,\s*230,\s*230\)/);
  // Measured `default`, not `pointer`.
  assert.match(button, /cursor:\s*default/);
  assert.match(button, /white-space:\s*nowrap/);
  assert.match(button, /text-transform:\s*none/);
});

test('the button and its label span keep their two different type stacks', () => {
  // The BUTTON computes 14px/normal 500 while the SPAN that actually owns the
  // text is 15px/20px 400 in a DIFFERENT family. Both are measured, so both are
  // kept — the button's own type never renders but is what the box was measured
  // against.
  const button = cssCode.slice(
    cssCode.indexOf('.willow-copy-toast__action {'),
    cssCode.indexOf('.willow-copy-toast__action-label'),
  );
  assert.match(button, /font-size:\s*14px/);
  assert.match(button, /line-height:\s*normal/);
  assert.match(button, /font-weight:\s*500/);
  assert.match(button, /font-family:\s*"Google Sans Flex",\s*"Google Sans Text"/);

  const span = cssCode.slice(
    cssCode.indexOf('.willow-copy-toast__action-label'),
    cssCode.indexOf('.willow-copy-toast__action::after'),
  );
  assert.ok(span.length > 0, 'could not locate the action label rule');
  assert.match(span, /font-size:\s*15px/);
  assert.match(span, /line-height:\s*20px/);
  assert.match(span, /font-weight:\s*400/);
  assert.match(span, /font-family:\s*"Google Sans Flex",\s*"Google Sans",/);
  assert.match(span, /font-variation-settings:\s*"ROND" 0,\s*"slnt" 0,\s*"wdth" 92,\s*"wght" 400/);
});

test('the ripple is inset 0 and tints instantly — transition-duration measured 0s', () => {
  const ripple = cssCode.slice(
    cssCode.indexOf('.willow-copy-toast__action::after'),
    cssCode.indexOf('@keyframes willow-copy-toast-enter'),
  );
  assert.ok(ripple.length > 0, 'could not locate the ripple rule');
  assert.match(ripple, /inset:\s*0/);
  assert.match(ripple, /border-radius:\s*9999px/);
  assert.match(ripple, /background:\s*rgb\(230,\s*230,\s*230\)/);
  assert.match(ripple, /opacity:\s*0/);
  assert.match(ripple, /:hover::after\s*\{\s*opacity:\s*0\.08/);
  assert.ok(
    !/transition/.test(ripple),
    'the hover tint measured transition-duration 0s — a fade would be invented',
  );
});

test('the animated node re-enables pointer-events, as the CDK pane does', () => {
  // Measured chain: .cdk-overlay-container and .cdk-global-overlay-wrapper are
  // BOTH `pointer-events: none`, and .cdk-overlay-pane turns it back on. Both
  // halves are required — without the `auto`, the action button is dead.
  const animated = cssCode.slice(
    cssCode.indexOf('.willow-copy-toast {'),
    cssCode.indexOf('.willow-copy-toast--hiding'),
  );
  assert.match(animated, /pointer-events:\s*auto/);
});

test('the prompt Copy button raises the prompt snackbar, not the response one', () => {
  const handler = chatViewCode.slice(
    chatViewCode.indexOf('const handleCopyPrompt'),
    chatViewCode.indexOf('const handleListen'),
  );
  assert.ok(handler.length > 0, 'could not locate handleCopyPrompt');
  assert.match(handler, /showCopyToast\('Prompt copied', \{/);
  assert.match(handler, /label:\s*'Start new chat'/);
  // Resets to an empty chat the same way the sidebar's own New chat does:
  // clear the inbox selection, then App's reset.
  assert.match(handler, /selectLocalFSInboxChat\(null\)/);
  assert.match(handler, /onNewChat\?\.\(\)/);

  const at = chatViewCode.indexOf('handleCopyPrompt(msg)');
  assert.ok(at > -1, 'the prompt Copy button must call handleCopyPrompt');
  assert.match(chatViewCode.slice(at, at + 800), /aria-label="Copy prompt"/);
});

test('App owns the reset and threads it in as a prop', () => {
  const app = read('apps/studio/src/app/App.tsx');
  assert.match(app, /onNewChat=\{handleNewChat\}[\s\S]{0,200}workspaceColor=/);
  assert.match(chatView, /onNewChat\?:\s*\(\)\s*=>\s*void;/);
});
