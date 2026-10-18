/**
 * Gemini's "Scroll to bottom" arrow (`back-to-bottom-fab`), in Chat and in Spark's task view.
 * The rule is Gemini's own service, read out of its bundle; the looks were measured at
 * 1536×826, 900×826, 800×1280 and 390×844 (tools/ui-research/captures/gemini/scroll-to-bottom/).
 * Gemini's Spark tasks use the same chat window and input container, so they get the same arrow.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { importTs } from './ts-module.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (css, selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\})\\s*${escaped} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';
};

const hook = read('features/chat/src/scroll-to-bottom.ts');
const fab = read('features/chat/src/ScrollToBottomFab.tsx');
const css = stripComments(read('features/chat/src/ScrollToBottomFab.css'));
const chat = read('features/chat/src/ChatView.tsx');
const spark = read('features/spark/src/SparkTaskDetail.tsx');
const sparkCss = stripComments(read('features/spark/src/SparkTaskDetail.css'));
const { contentBelowView, SCROLL_TO_BOTTOM_THRESHOLD } = await importTs(path.join(ROOT, 'features/chat/src/scroll-to-bottom.ts'));

describe('when the arrow shows', () => {
  const at = (overrides) => contentBelowView({
    scrollHeight: 3000,
    clientHeight: 800,
    scrollTop: 1000,
    contentBottom: 1400,
    viewBottom: 800,
    ...overrides,
  });

  it('is Gemini’s 200px, measured to the newest content rather than to the scroller’s end', () => {
    assert.equal(SCROLL_TO_BOTTOM_THRESHOLD, 200);
    assert.equal(at({}), 600);
    // 1200px from the end, but only 50px of content below: the rest is the space held open under a turn.
    assert.equal(at({ contentBottom: 850 }), 50);
    assert.equal(at({ contentBottom: 600 }), 0, 'content above the view’s edge is not below it');
  });

  it('is never shown within 200px of the scroller’s end', () => {
    assert.equal(at({ scrollTop: 2001, contentBottom: 5000 }), 0);
    assert.equal(at({ scrollTop: 2000, contentBottom: 5000 }), 4200);
  });

  it('falls back to the distance from the end when there is no content to measure', () => {
    assert.equal(at({ contentBottom: null }), 1200);
  });

  it('stays away while a reply comes in, until the user scrolls up, and after a press until the view is back', () => {
    assert.match(hook, /visible: !empty && !pressed && !following && below >= SCROLL_TO_BOTTOM_THRESHOLD,/);
    assert.match(hook, /useEffect\(\(\) => \{\s*replyingRef\.current = replying;\s*setFollowing\(replying\);\s*\}, \[replying\]\);/);
    assert.match(hook, /if \(replyingRef\.current && top < lastTopRef\.current - 1\) setFollowing\(false\);/);
    assert.match(hook, /if \(next < SCROLL_TO_BOTTOM_THRESHOLD\) setPressed\(false\);/);
    assert.match(hook, /viewBottom: scroller\.getBoundingClientRect\(\)\.bottom - \(bottomInsetRef\.current\?\.\(\) \?\? 0\),/);
  });

  it('glides to the end when pressed, and follows growth and resizes without a scroll', () => {
    assert.match(hook, /setPressed\(true\);\s*scroller\.scrollTo\(\{ top: scroller\.scrollHeight - scroller\.clientHeight, behavior: 'smooth' \}\);/);
    assert.match(hook, /scroller\.addEventListener\('scroll', onScroll, \{ passive: true \}\);/);
    assert.match(hook, /const observer = new ResizeObserver\(schedule\);\s*observer\.observe\(scroller\);\s*if \(scroller\.firstElementChild\) observer\.observe\(scroller\.firstElementChild\);/);
  });
});

describe('the button', () => {
  it('is labelled, and out of the tab order and the accessibility tree while hidden', () => {
    assert.match(fab, /aria-label="Scroll to bottom"/);
    assert.match(fab, /aria-hidden=\{shown \? undefined : true\}/);
    assert.match(fab, /tabIndex=\{shown \? 0 : -1\}/);
    assert.match(fab, /className=\{`gm-back-to-bottom__button\$\{shown \? ' is-visible' : ''\}\$\{pressed \? ' is-leaving' : ''\}`\}/);
  });

  it('draws Google Symbols’ arrow_downward at 20px, weight 320, rounded', () => {
    assert.match(fab, /family="google-symbols"\s*name="arrow_downward"\s*size=\{20\}\s*weight=\{320\}\s*variationSettings=\{'"FILL" 0, "GRAD" 0, "ROND" 100, "opsz" 20, "wght" 320'\}/);
  });

  it('sits centred, 36px above the composer, on Gemini’s surfaces', () => {
    const host = rule(css, '.gm-back-to-bottom');
    assert.match(host, /--gm-back-to-bottom-surface: #1f1f1f;\s*--gm-back-to-bottom-on-surface: #e3e3e3;\s*--gm-back-to-bottom-hover-ink: #e6e6e6;/);
    assert.match(host, /position: absolute;\s*bottom: calc\(100% \+ 36px\);\s*left: 0;\s*right: 0;\s*z-index: 2;\s*width: fit-content;\s*margin-inline: auto;\s*pointer-events: none;/);
    assert.match(css, /@media \(max-width: 959\.98px\) \{\s*\.gm-back-to-bottom \{\s*--gm-back-to-bottom-surface: #1c1c1c;\s*--gm-back-to-bottom-hover-ink: #e0e0e0;\s*\}/,
      'below 960px: #1c1c1c, and a hover of color(srgb 0.171294) as measured at 900px');
  });

  it('is a 40px circle that rises and fades in on Gemini’s curve, and leaves faster when pressed', () => {
    const button = rule(css, '.gm-back-to-bottom__button');
    assert.match(button, /width: 40px;\s*height: 40px;/);
    assert.match(button, /border-radius: 9999px;\s*background-color: var\(--gm-back-to-bottom-surface\);\s*color: var\(--gm-back-to-bottom-on-surface\);/);
    assert.match(button, /opacity: 0;\s*transform: scale\(0\.8\) translateY\(8px\);\s*pointer-events: none;/);
    assert.match(button, /transition:\s*opacity 0\.2s cubic-bezier\(0\.2, 0, 0, 1\),\s*transform 0\.2s cubic-bezier\(0\.2, 0, 0, 1\),\s*background-color 0\.15s cubic-bezier\(0\.2, 0, 0, 1\);/);
    assert.match(button, /box-shadow: 0 0 20px 0 rgba\(0, 0, 0, 0\.4\);/);
    assert.match(rule(css, '.gm-back-to-bottom__button.is-visible'), /opacity: 1;\s*transform: scale\(1\) translateY\(0\);\s*pointer-events: auto;/);
    assert.match(rule(css, '.gm-back-to-bottom__button.is-leaving'), /opacity: 0;\s*transform: scale\(0\.8\) translateY\(8px\);\s*pointer-events: none;\s*transition-duration: 0\.1s;/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.gm-back-to-bottom__button \{\s*transition: none;/);
  });

  it('hovers 8% of the ink into the surface, and rings focus in Gemini’s primary', () => {
    assert.match(rule(css, '.gm-back-to-bottom__button:hover'), /background-color: color-mix\(in srgb, var\(--gm-back-to-bottom-hover-ink\) 8%, var\(--gm-back-to-bottom-surface\)\);/);
    assert.match(rule(css, '.gm-back-to-bottom__button:focus-visible'), /outline: 2px solid var\(--sync-a8c7fa, #a8c7fa\);\s*outline-offset: 2px;/);
  });
});

describe('where it is used', () => {
  it('is in Chat’s docked composer, measured to the newest message’s content', () => {
    assert.match(chat, /import \{ ScrollToBottomFab \} from '\.\/ScrollToBottomFab';\s*import \{ useScrollToBottom \} from '\.\/scroll-to-bottom';/);
    assert.match(chat, /const el = \(last\.role === 'assistant' \? lastAssistantContentRef\.current : null\) \?\? messageRefs\.current\[last\.id\];/);
    assert.match(chat, /useScrollToBottom\(\{\s*scrollerRef: chatScrollRef,\s*contentBottom: threadContentBottom,\s*empty: !hasStarted,\s*replying: isGenerating \|\| isResponseRevealing \|\| isLive,\s*\}\);/);
    assert.match(chat, /\{isThreadDocked && !imagesPage && \(\s*<ScrollToBottomFab visible=\{backToBottom\.visible\} onClick=\{backToBottom\.scrollToBottom\} \/>\s*\)\}\s*<InputBar/);
  });

  it('is in Spark’s follow-up composer, ahead of the box so Shift+Tab reaches it', () => {
    assert.match(spark, /import \{ ScrollToBottomFab \} from '@willow\/chat\/ScrollToBottomFab';\s*import \{ useScrollToBottom \} from '@willow\/chat\/scroll-to-bottom';/);
    assert.match(spark, /<div className="spark-task-detail__followup-composer">\s*<ScrollToBottomFab visible=\{backToBottom\.visible\} onClick=\{backToBottom\.scrollToBottom\} \/>/);
    assert.match(rule(sparkCss, '.spark-task-detail__followup-composer'), /position: relative;/);
  });

  it('in Spark, measures to the newest turn’s content and to the composer’s edge', () => {
    assert.match(spark, /scroller\.querySelectorAll<HTMLElement>\('\.spark-task-detail__conversation > article'\)/);
    assert.match(spark, /if \(position === 'absolute' \|\| position === 'fixed'\) continue;/,
      'the screen-reader announcement sits away from the thread and is not content');
    assert.match(spark, /return bottom \?\? newest\.previousElementSibling\?\.getBoundingClientRect\(\)\.bottom \?\? null;/);
    assert.match(spark, /bottomInset: \(\) => \{\s*const scroller = conversationRef\.current;\s*return scroller \? parseFloat\(getComputedStyle\(scroller\)\.paddingBottom\) \|\| 0 : 0;\s*\},/);
    assert.match(spark, /replying: isTaskActive\(currentTask\)\s*\|\| \(Boolean\(newestResponse\) && !responseActionsReady\(newestRevealKey, newestResponse\)\),/);
  });
});
