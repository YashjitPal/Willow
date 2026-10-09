/**
 * The remote browser on phones and tablets (960px and below), measured off Gemini Spark at
 * 390×844 and 800×1280 while its VM was up (tools/ui-research/captures/spark/134-remote-browser/
 * narrow-takeover/, with Gemini's own component CSS in css/). Gemini changed its narrow pane
 * since the first clone: it fills the screen, its buttons sit under the viewer, and "Take over
 * task" brings a toolbar with a keyboard for the page.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (css, selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\})\\s*${escaped} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';
};

const pane = read('features/spark/src/remote-browser/SparkRemoteBrowserPane.tsx');
const css = stripComments(read('features/spark/src/remote-browser/SparkRemoteBrowserPane.css'));
const store = read('features/spark/src/remote-browser/remote-browser-store.ts');
const detail = read('features/spark/src/SparkTaskDetail.tsx');

describe('the narrow pane fills the screen', () => {
  it('opens full-screen, and drops into the card once a take-over is handed back', () => {
    assert.match(store, /fullscreen: boolean;/);
    assert.match(store, /updateRemoteBrowserSession\(taskId, \{ paneOpen: true, fullscreen: true \}\);/);
    assert.match(store, /updateRemoteBrowserSession\(taskId, inControl \? \{ inControl \} : \{ inControl, fullscreen: false \}\);/);
    assert.match(read('features/spark/src/remote-browser/run-remote-browser.ts'), /paneOpen: true,\s*inControl: false,\s*fullscreen: true,/,
      'a run that opens the pane opens it full-screen too');
    assert.match(detail, /const useRemoteBrowserFullscreen = \(taskId: string\): boolean =>\s*useSyncExternalStore\(subscribeRemoteBrowsers, \(\) => remoteBrowserSessions\.get\(\)\[taskId\]\?\.fullscreen \?\? true\);/);
  });

  it('heads it like Gemini’s `.header.full-screen`: "Remote computer" and a 40px close', () => {
    assert.match(pane, /<span className="spark-remote-browser__title">\{filling \? 'Remote computer' : 'Remote browser'\}<\/span>/);
    assert.match(pane, /aria-label="Close panel" onClick=\{onClose\}>\s*<NarrowGlyph name="close" size=\{20\} \/>/);
    assert.match(rule(css, '.spark-remote-browser.is-fullscreen'), /padding-bottom: 24px;\s*background: #030303;/);
    assert.match(rule(css, '.spark-remote-browser.is-fullscreen .spark-remote-browser__header'), /height: auto;[^}]*padding: 16px;/);
    assert.match(rule(css, '.spark-remote-browser.is-fullscreen .spark-remote-browser__title-wrapper'), /gap: 12px;\s*padding: 0;\s*color: #c4c7c5;/);
    assert.match(rule(css, '.spark-remote-browser.is-fullscreen .spark-remote-browser__close'), /width: 40px;\s*height: 40px;\s*padding: 8px;/);
  });

  it('draws the controls on Google Symbols at the face’s own axes, the filled ones with FILL 1', () => {
    assert.match(pane, /variationSettings=\{filled \? '"FILL" 1, "ROND" 0, "slnt" 0, "wght" 400' : undefined\}/);
    for (const name of ['monitor', 'close', 'web_traffic', 'history', 'keyboard', 'keyboard_hide']) {
      assert.match(pane, new RegExp(`<NarrowGlyph name="${name}" size=\\{\\d+\\} \\/>`), name);
    }
    for (const name of ['youtube_live', 'backspace', 'send']) {
      assert.match(pane, new RegExp(`<NarrowGlyph name="${name}" size=\\{\\d+\\} filled \\/>`), name);
    }
  });
});

describe('the buttons go under the viewer', () => {
  it('keeps only previous, next and the dots in the scrim, and only on a step of the history', () => {
    assert.match(pane, /const hasShots = shots\.length > 0 && !interactive && \(!narrow \|\| viewing !== null\);/);
    assert.match(pane, /\{narrow \? null : viewing \? \(/, 'no Take over or View Live in a narrow scrim');
    assert.match(pane, /\{\.\.\.\(compact \? \{ narrow: true, history: \{ index: historyIndex, set: setHistoryIndex \} \} : \{\}\)\}/);
  });

  it('offers Take over and View history live, and View Live on a step', () => {
    const actions = /const RemoteBrowserActions[\s\S]*?\r?\n\);\r?\n/.exec(pane)?.[0] ?? '';
    assert.match(actions, /historyIndex !== null \? \([\s\S]*?<span>View Live<\/span>/);
    assert.match(actions, /session\.phase !== 'preparing' && \([\s\S]*?<span>Take over task<\/span>/);
    assert.match(actions, /session\.shots\.length > 0 && \([\s\S]*?onClick=\{\(\) => setHistoryIndex\(session\.shots\.length - 1\)\}[\s\S]*?<span>View history<\/span>/);
    assert.match(pane, /\{compact && !session\.inControl && \(\s*<RemoteBrowserActions /);
  });

  it('measures them as Gemini’s `.bottom-container` and `.mobile-*-button`', () => {
    assert.match(rule(css, '.spark-remote-browser__actions'), /flex-wrap: wrap;[^}]*justify-content: center;\s*gap: 12px;\s*padding: 12px 12px 0;/);
    assert.match(rule(css, '.spark-remote-browser__actions.is-in-control'), /padding: 12px 0 0;/);
    const button = rule(css, '.spark-remote-browser .spark-remote-browser__action');
    for (const value of ['width: 100%;', 'min-width: 100px;', 'max-width: 320px;', 'height: 48px;', 'gap: 8px;', 'padding: 8px 16px 8px 12px;', 'background: #131314;', 'color: #e3e3e3;', 'font-size: 14px;', 'font-weight: 500;']) {
      assert.ok(button.includes(value), value);
    }
    assert.match(rule(css, '.spark-remote-browser .spark-remote-browser__action.is-tonal'), /background: var\(--spark-tonal-bg, #004a77\);\s*color: var\(--spark-tonal-text, #c2e7ff\);/);
  });
});

describe('taken over on a phone or tablet', () => {
  const takeover = /const RemoteBrowserNarrowTakeover[\s\S]*?\r?\n\};\r?\n/.exec(pane)?.[0] ?? '';

  it('is its own view, so the bot computer’s compact take-over keeps its layout', () => {
    assert.match(pane, /compact\s*\? <RemoteBrowserNarrowTakeover taskId=\{taskId\} session=\{session\} \/>\s*: <RemoteBrowserTakeover/);
    assert.match(takeover, /className="spark-remote-browser-takeover is-compact is-narrow" style=\{accent\}/,
      'the portal is outside Spark’s pages, so it declares the accent itself');
  });

  it('leaves the header its title and puts the switches and Go back under the viewer', () => {
    assert.doesNotMatch(/<div className="spark-remote-browser-takeover__header">[\s\S]*?<\/div>\s*<\/div>/.exec(takeover)?.[0] ?? '', /give-back/);
    assert.match(takeover, /\{!keyboardOpen && \(\s*<div className="spark-remote-browser__control-bar">/);
    assert.match(takeover, /aria-label="Keyboard"[\s\S]*?onClick=\{toggleKeyboard\}[\s\S]*?aria-label="Click"[\s\S]*?onClick=\{toggleKeyboard\}/,
      'as in Gemini, both switches flip the keyboard bar');
    assert.match(takeover, /className=\{`spark-remote-browser__control\$\{keyboardOpen \? '' : ' is-selected'\}`\}/, 'the click switch is lit at rest');
    assert.match(takeover, /\{keyboardOpen && <RemoteBrowserKeyboardBar taskId=\{taskId\} onHide=\{toggleKeyboard\} \/>\}/);
    assert.match(rule(css, '.spark-remote-browser-takeover.is-narrow .spark-remote-browser-takeover__header-left'), /height: 20px;/, '52px header');
  });

  it('measures the bar as Gemini’s `.in-control-container`', () => {
    const bar = rule(css, '.spark-remote-browser__control-bar');
    for (const value of ['width: 100%;', 'max-width: 390px;', 'box-sizing: content-box;', 'justify-content: space-between;', 'gap: 12px;', 'padding: 16px;', 'border-radius: 16px 16px 0 0;', 'background: #0e0e0e;']) {
      assert.ok(bar.includes(value), value);
    }
    assert.match(css, /@media \(min-width: 423px\) \{\s*\.spark-remote-browser__control-bar \{\s*border-radius: 16px;/);
    assert.match(rule(css, '.spark-remote-browser__control'), /width: 40px;[^}]*padding: 8px;[^}]*background: #1b1b1b;\s*color: #c4c7c5;/);
    assert.match(rule(css, '.spark-remote-browser__control.is-selected'), /background: var\(--sync-1f3760, #1f3760\);\s*color: var\(--sync-d3e3fd, #d3e3fd\);/);
  });
});

describe('the keyboard bar', () => {
  const bar = /const RemoteBrowserKeyboardBar[\s\S]*?\r?\n\};\r?\n/.exec(pane)?.[0] ?? '';
  const bridge = read('api/_browse-bridge.js');

  it('sends what is typed, by Enter or the send key, to the field the page last had focused', () => {
    assert.match(bar, /callRemoteFrame\(taskId, 'keyboard', \{ text \}\)/);
    assert.match(bar, /callRemoteFrame\(taskId, 'keyboard', \{ backspace: true \}\)/);
    assert.match(bar, /if \(event\.key !== 'Enter' \|\| event\.nativeEvent\.isComposing\) return;/);
    assert.match(bar, /<input\s*autoFocus/);
    assert.match(bridge, /document\.addEventListener\('focusin', function \(event\) \{\s*if \(isEditable\(event\.target\)\) lastField = event\.target;\s*\}, true\);/);
    assert.match(bridge, /var target = isEditable\(document\.activeElement\) \? document\.activeElement : lastField;/);
    assert.match(bridge, /setNativeValue\(target, value\.slice\(0, start\) \+ text \+ value\.slice\(end\)\);/, 'at the field’s own caret, without taking the focus back');
    assert.match(bridge, /keyboard: sendKeyboard,/);
  });

  it('measures as Gemini’s `keyboard-input-bar`', () => {
    const tray = rule(css, '.spark-remote-browser__keyboard');
    for (const value of ['bottom: 0;', 'padding-bottom: 10px;', 'border-radius: 16px 16px 0 0;', 'background: #f0f0f0;', 'box-shadow: 0 -2px 5px rgba(0, 0, 0, 0.1);', 'animation: spark-remote-browser-keyboard-in 0.3s ease-out;']) {
      assert.ok(tray.includes(value), value);
    }
    assert.match(rule(css, '.spark-remote-browser__keyboard-field'), /height: 56px;[^}]*margin: 16px 16px 8px;\s*border: 1px solid #444746;\s*border-radius: 9999px;\s*background: #1e1f20;/);
    assert.match(rule(css, '.spark-remote-browser__keyboard-input'), /margin: 0 4px;[^}]*color: #e0e0e0;\s*caret-color: var\(--sync-a8c7fa, #a8c7fa\);\s*font: 400 16px\/24px/);
    assert.match(rule(css, '.spark-remote-browser__keyboard-input::placeholder'), /color: rgba\(255, 255, 255, 0\.55\);/);
  });
});
