/**
 * Voice settings panel, verified against the panel measured over CDP.
 *
 * The capture was taken at a 1536x826 viewport on a 2x display, with voice mode
 * live and the panel open. These rects came off the page's own elements:
 *
 *   panel          512,   226.8   512 x 372
 *   orb box        696,   258.8   144 x 144
 *   voice block    648,   426.8   240 x  80
 *   dot group      684,   474.8   168 x  32
 *   prev arrow     632,   454.8    24 x  24
 *   next arrow     880,   454.8    24 x  24
 *   language row   544,   530.8   448 x  52
 *   trigger       1472,     6      40 x  40
 *
 * and the open dropdown's popper wrapper carried, as inline style, `left:
 * 872.85px; height: 283.2px; min-width: 119.15px` against a trigger at x=880.05
 * y=538.8 w=111.95.
 *
 * The trigger's 1472,6 40x40 is the exception: it is still asserted as the
 * capture, but the component deliberately does not use it — the button was asked
 * to sit on Willow's temporary chat button instead, and that override is checked
 * against the shell rather than against the page.
 *
 * Every number below is recomputed from the constants as they are written in
 * `voice-settings-constants.ts` and required to land on those measurements, so
 * editing a size or an offset in the source makes this test recompute and fail
 * rather than pass against a stale duplicate. The constants are parsed out of the
 * source text because Node cannot import the TypeScript module directly — the
 * same approach the other tests in this directory take.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) =>
  fs.readFileSync(path.resolve(here, '../../../features/chat/src', relative), 'utf8');

const constantsSource = read('voice-settings/voice-settings-constants.ts');
const dialogSource = read('voice-settings/VoiceSettingsDialog.tsx');
const selectSource = read('voice-settings/LanguageSelect.tsx');
const triggerSource = read('voice-settings/VoiceSettingsButton.tsx');
const cssSource = read('voice-settings/voice-settings.css');
const providersSource = read('voice-settings/voice-providers.ts');
const storeSource = read('voice-settings/voice-settings-store.ts');
const chatViewSource = read('ChatView.tsx');
const orbSource = read('voice-orb/VoiceOrb.tsx');
const liveSource = fs.readFileSync(
  path.resolve(here, '../../../platform/ai/src/live.ts'),
  'utf8',
);
// The trigger's placement is Willow's own top-right chrome rather than the
// captured one, so the reference for it is the temporary chat button in the shell.
const layoutSource = fs.readFileSync(path.resolve(here, '../src/shell/StudioLayout.tsx'), 'utf8');

/** Read an exported numeric constant, resolving a product of identifiers. */
const constant = (name, seen = new Set()) => {
  assert.ok(!seen.has(name), `${name} resolves in a cycle`);
  seen.add(name);

  const match = constantsSource.match(new RegExp(`export const ${name}\\s*=\\s*([^;]+);`));
  assert.ok(match, `${name} should be exported from voice-settings-constants.ts`);

  const value = match[1]
    .split('*')
    .map((part) => {
      const factor = part.trim();
      return /^-?[0-9.]+$/.test(factor) ? Number(factor) : constant(factor, seen);
    })
    .reduce((product, factor) => product * factor, 1);

  assert.ok(Number.isFinite(value), `${name} should resolve to a number`);
  return value;
};

/** Read an exported string constant. */
const text = (name) => {
  const match = constantsSource.match(
    new RegExp(`export const ${name}\\s*=\\s*\\n?\\s*'([^']+)'`),
  );
  assert.ok(match, `${name} should be exported as a string literal`);
  return match[1];
};

/** Centre a child of `size` inside a parent starting at `start` of `width`. */
const centred = (start, width, size) => start + (width - size) / 2;

const VIEWPORT_WIDTH = 1536;
const VIEWPORT_HEIGHT = 826;

describe('voice settings panel geometry', () => {
  it('derives the measured panel height from its own rows', () => {
    // 372 is content-driven — nothing sets it — so the padding, the content
    // column, the settings gap and the row height have to add up to it.
    const height =
      constant('PANEL_PADDING') +
      constant('CONTENT_COLUMN_HEIGHT') +
      constant('SETTINGS_LIST_MARGIN_TOP') +
      constant('SETTINGS_ROW_MIN_HEIGHT') +
      constant('PANEL_PADDING_BOTTOM');

    assert.equal(height, constant('PANEL_MEASURED_HEIGHT'));
    assert.equal(height, 372);
  });

  it('derives the content column from the panel and its padding', () => {
    assert.equal(
      constant('PANEL_MAX_WIDTH') - constant('PANEL_PADDING') * 2,
      constant('CONTENT_COLUMN_WIDTH'),
    );

    // orb + gap-6 + name block, which is what `gap-6 flex-col` stacks.
    assert.equal(
      constant('ORB_SLOT_SIZE') + constant('PICKER_GAP') + constant('NAME_BLOCK_HEIGHT'),
      constant('CONTENT_COLUMN_HEIGHT'),
    );
  });

  it('lands every captured row on its measured origin', () => {
    const panelLeft = centred(0, VIEWPORT_WIDTH, constant('PANEL_MAX_WIDTH'));
    assert.equal(panelLeft, 512);

    const panelTop = centred(0, VIEWPORT_HEIGHT, constant('PANEL_MEASURED_HEIGHT'));
    // 227 against 226.8 measured: the half-pixel the capture rounded.
    assert.ok(Math.abs(panelTop - 226.8) <= 0.5, `panel top ${panelTop}`);

    const columnLeft = panelLeft + constant('PANEL_PADDING');
    const orbTop = 226.8 + constant('PANEL_PADDING');
    assert.equal(columnLeft, 544);
    assert.equal(orbTop, 258.8);

    const column = constant('CONTENT_COLUMN_WIDTH');
    assert.equal(centred(columnLeft, column, constant('ORB_SLOT_SIZE')), 696);

    const blockLeft = centred(columnLeft, column, constant('NAME_BLOCK_WIDTH'));
    const blockTop = orbTop + constant('ORB_SLOT_SIZE') + constant('PICKER_GAP');
    assert.equal(blockLeft, 648);
    assert.equal(blockTop, 426.8);

    const rowTop =
      blockTop + constant('NAME_BLOCK_HEIGHT') + constant('SETTINGS_LIST_MARGIN_TOP');
    assert.equal(rowTop, 530.8);
  });
});

describe('voice picker row', () => {
  it('reproduces the nine-dot row from the size and gap alone', () => {
    const dots = 9;
    const width = dots * constant('DOT_SIZE') + (dots - 1) * constant('DOT_GAP');
    assert.equal(width, constant('DOT_ROW_WIDTH_9'));
    assert.equal(width, 168);
  });

  it('places both arrows at the measured overhang', () => {
    const blockLeft = 648;
    const blockWidth = constant('NAME_BLOCK_WIDTH');
    const icon = constant('ARROW_ICON_SIZE');
    const inset = constant('ARROW_INSET');

    // `-start-4` / `-end-4`: the arrow's own edge sits 16px outside the block.
    assert.equal(blockLeft + inset, 632);
    assert.equal(blockLeft + blockWidth - icon - inset, 880);
  });

  it('counts the dots off the provider roster, not the captured nine', () => {
    // The one place the clone is deliberately not upstream: nine dots is nine
    // ChatGPT voices, and Willow's count has to follow the live model.
    assert.match(dialogSource, /const voices = provider\.voices;/);
    assert.match(dialogSource, /windowedVoices\.map\(\(\{ option, index \}\)/);
    assert.doesNotMatch(dialogSource, /\b9\b/);
  });

  it('paints the measured row whatever the roster length', () => {
    // Thirty Gemini voices is 588px of dots and gaps inside a 240px block, so the
    // row draws the captured nine and slides them instead of shrinking anything.
    const size = constant('DOT_WINDOW');
    assert.equal(size, 9);
    assert.equal(
      size * constant('DOT_SIZE') + (size - 1) * constant('DOT_GAP'),
      constant('DOT_ROW_WIDTH_9'),
    );

    // Reimplemented from the source so the clamping is checked, not assumed.
    const windowFor = (count, selected) => {
      const width = Math.min(size, count);
      const start = Math.min(
        Math.max(selected - Math.floor(width / 2), 0),
        Math.max(count - width, 0),
      );
      return { start, width };
    };

    // A nine-voice provider is upstream unchanged: no window, no sliding.
    for (let i = 0; i < 9; i += 1) {
      assert.deepEqual(windowFor(9, i), { start: 0, width: 9 });
    }

    // Thirty voices: clamped at both ends, centred in between, always nine wide.
    assert.deepEqual(windowFor(30, 0), { start: 0, width: 9 });
    assert.deepEqual(windowFor(30, 4), { start: 0, width: 9 });
    assert.deepEqual(windowFor(30, 15), { start: 11, width: 9 });
    assert.deepEqual(windowFor(30, 29), { start: 21, width: 9 });

    // Shorter than the window: every voice, and nothing off the end.
    assert.deepEqual(windowFor(3, 2), { start: 0, width: 3 });

    assert.match(dialogSource, /Math\.min\(DOT_WINDOW, voices\.length\)/);
    assert.match(dialogSource, /Math\.max\(voices\.length - size, 0\)/);
  });

  it('reports the real roster to assistive tech, not the window', () => {
    assert.match(dialogSource, /aria-posinset=\{index \+ 1\}/);
    assert.match(dialogSource, /aria-setsize=\{voices\.length\}/);
  });

  it('keeps the 175ms fade wired but inert in focused mode', () => {
    // From source: `isFading` is gated on `mode !== 'focused'`, and this panel is
    // focused mode — so the branch must exist and must not fire here.
    assert.match(dialogSource, /const isFocusedMode = true;/);
    assert.match(dialogSource, /if \(!isFocusedMode\) \{/);
    assert.match(dialogSource, /setTimeout\(\(\) => setIsFading\(false\), ARROW_FADE_MS\)/);
    assert.equal(constant('ARROW_FADE_MS'), 175);
    assert.equal(constant('ARROW_FADE_OPACITY'), 0.2);
  });
});

describe('language dropdown placement', () => {
  const trigger = { left: 880.05, top: 538.8, width: 111.95, height: 36 };

  it('reproduces the captured left and min-width from one offset', () => {
    const offset = constant('LISTBOX_OFFSET_X');
    assert.equal(offset, -7.2);

    // The same 7.2, mirrored: left shifts back, min-width grows.
    assert.ok(Math.abs(trigger.left + offset - 872.85) < 0.001);
    assert.ok(Math.abs(trigger.width - offset - 119.15) < 0.001);
  });

  it('aligns the selected row on the trigger centre', () => {
    // Auto-detect is option 0, so its centre is py-1.5 + half a row down.
    const selectedCentre = constant('LISTBOX_PADDING_Y') + constant('OPTION_HEIGHT') / 2;
    const listTop = trigger.top + trigger.height / 2 - selectedCentre;

    // 532.8 predicted against 532.4 measured — the trigger rect's sub-pixel
    // rounding, and the reason this is a tolerance rather than an equality.
    assert.ok(Math.abs(listTop - 532.4) <= 0.5, `list top ${listTop}`);
  });

  it('clamps the height to the measured 10px viewport margin', () => {
    const margin = constant('LISTBOX_VIEWPORT_MARGIN');
    const height = VIEWPORT_HEIGHT - margin - 532.4;
    assert.ok(Math.abs(height - 283.2) <= 0.5, `height ${height}`);
    assert.equal(margin, 10);
  });

  it('implements that placement rather than restating the numbers', () => {
    assert.match(selectSource, /LISTBOX_PADDING_Y \+ selectedIndex \* OPTION_HEIGHT/);
    assert.match(selectSource, /trigger\.left \+ LISTBOX_OFFSET_X/);
    assert.match(selectSource, /trigger\.width - LISTBOX_OFFSET_X/);
    assert.match(selectSource, /viewportHeight \* LISTBOX_MAX_HEIGHT_VH\) \/ 100/);
  });
});

describe('trigger placement', () => {
  it('derives the measured 6/24 offsets from the header chain', () => {
    // right: 1536 − 1472 − 40 = 24, which is `pe-6` on the header row.
    assert.equal(
      VIEWPORT_WIDTH - 1472 - constant('TRIGGER_SIZE'),
      constant('TRIGGER_INSET_END'),
    );
    assert.equal(constant('TRIGGER_HEADER_PADDING_END'), constant('TRIGGER_INSET_END'));

    // top: `p-2` (8) on the row, minus 2 from `-mt-0.5` on the flex row.
    assert.equal(constant('TRIGGER_HEADER_PADDING') - 2, constant('TRIGGER_INSET_TOP'));
    assert.equal(constant('TRIGGER_INSET_TOP'), 6);
  });

  it('sits on the temporary chat button rect, which was asked for over the capture', () => {
    // The one placement in this feature that is Willow's rather than upstream's.
    // Read out of StudioLayout rather than written down twice, so moving Willow's
    // top-right chrome fails here instead of silently splitting the two apart.
    const temporaryChat = layoutSource.match(
      /absolute top-\[(\d+)px\] right-\[(\d+)px\][\s\S]*?w-\[(\d+)px\] h-\[(\d+)px\]/,
    );
    assert.ok(temporaryChat, 'the temporary chat button should still be placed with literals');
    const [, top, right, width, height] = temporaryChat.map(Number);

    assert.equal(constant('TRIGGER_WILLOW_INSET_TOP'), top);
    assert.equal(constant('TRIGGER_WILLOW_INSET_END'), right);
    assert.equal(constant('TRIGGER_WILLOW_SIZE'), width);
    assert.equal(constant('TRIGGER_WILLOW_SIZE'), height);

    // Applied, not just recorded — and the captured offsets stay out of the
    // component, so nothing places the button twice.
    assert.match(triggerSource, /top: TRIGGER_WILLOW_INSET_TOP/);
    assert.match(triggerSource, /right: TRIGGER_WILLOW_INSET_END/);
    assert.doesNotMatch(triggerSource, /TRIGGER_INSET_(TOP|END)/);
    assert.doesNotMatch(triggerSource, /TRIGGER_HEADER_PADDING/);
  });

  it('keeps the measured glyph inside the moved box', () => {
    // Only the box moved. The icon keeps its captured size, colours and timing,
    // and stays centred, so it lands on the temporary chat glyph's centre.
    assert.equal(constant('TRIGGER_ICON_SIZE'), 20);
    assert.match(triggerSource, /size=\{TRIGGER_ICON_SIZE\}/);
    assert.match(triggerSource, /items-center justify-center/);
    assert.match(triggerSource, /transitionDuration: `\$\{TRIGGER_TRANSITION_MS\}ms`/);
    assert.match(triggerSource, /transitionTimingFunction: TRIGGER_TRANSITION_EASE/);
    assert.match(triggerSource, /group-hover:text-\[#cdcdcd\]/);
  });

  it('clears the orb surface without disturbing its stacking', () => {
    // The strip is the one adaptation: upstream has no z-index, Willow's orb
    // surface is z-[49] and its overlays z-50, so the strip takes z-50.
    assert.match(triggerSource, /z-50/);
    assert.match(triggerSource, /pointer-events-none fixed/);
    assert.match(triggerSource, /pointer-events-auto/);
  });
});

describe('measured values the CSS carries', () => {
  it('keeps the three shadow layers the panel and dropdown were measured with', () => {
    const shadow = text('SHADOW_LONG');
    assert.match(shadow, /rgba\(0, 0, 0, 0\.32\) 0px 8px 16px 0px/);
    assert.match(shadow, /rgba\(255, 255, 255, 0\.2\) 0px 0px 1px 0px inset/);
    assert.match(shadow, /rgba\(0, 0, 0, 0\.62\) 0px 0px 1px 0px/);

    // Same three layers in the stylesheet, in CSS order.
    assert.match(cssSource, /0 8px 16px 0 rgba\(0, 0, 0, 0\.32\)/);
    assert.match(cssSource, /inset 0 0 1px 0 rgba\(255, 255, 255, 0\.2\)/);
    assert.match(cssSource, /0 0 1px 0 rgba\(0, 0, 0, 0\.62\)/);
  });

  it('matches the menu-item rule to the measured box', () => {
    const rule = cssSource.slice(cssSource.indexOf('.willow-vs-menu-item {'));
    assert.match(rule, new RegExp(`height: ${constant('OPTION_HEIGHT')}px`));
    assert.match(rule, new RegExp(`min-height: ${constant('OPTION_HEIGHT')}px`));
    assert.match(
      rule,
      new RegExp(
        `padding: ${constant('OPTION_PADDING_TOP')}px ${constant('OPTION_PADDING_END')}px ` +
          `${constant('OPTION_PADDING_TOP')}px ${constant('OPTION_PADDING_START')}px`,
      ),
    );
    assert.match(rule, new RegExp(`margin-inline: ${constant('OPTION_MARGIN_X')}px`));
    assert.match(rule, new RegExp(`border-radius: ${constant('OPTION_RADIUS')}px`));
    assert.match(rule, new RegExp(`font-size: ${constant('OPTION_FONT_SIZE')}px`));
  });

  it('leaves the hover instant, as the 0s computed duration has it', () => {
    assert.match(cssSource, /transition-duration: 0s/);
    assert.match(cssSource, new RegExp(`background-color: ${text('OPTION_HOVER_BG')}`));
  });

  it('keeps the resting row transparent, tick as the only selected affordance', () => {
    assert.match(cssSource, /background-color: transparent/);
    assert.match(selectSource, /isSelected && \(/);
    assert.doesNotMatch(selectSource, /data-state="checked".*background/s);
  });
});

describe('panel enter and exit', () => {
  it('animates on the values lifted from the shipped bundle', () => {
    assert.equal(constant('PANEL_SCALE_CLOSED'), 0.96);
    assert.equal(constant('PANEL_TRANSITION_DURATION_REDUCED'), 0);

    const transition = constantsSource.match(
      /export const PANEL_TRANSITION = \{([^}]+)\}/,
    );
    assert.ok(transition, 'PANEL_TRANSITION should be exported');
    assert.match(transition[1], /duration: 0\.22/);
    assert.match(transition[1], /ease: \[0\.4, 0, 0\.2, 1\]/);
  });

  it('runs the same values in both directions, as initial and exit match', () => {
    assert.match(dialogSource, /initial=\{\{ opacity: 0, scale: PANEL_SCALE_CLOSED \}\}/);
    assert.match(dialogSource, /exit=\{\{ opacity: 0, scale: PANEL_SCALE_CLOSED \}\}/);
    assert.match(dialogSource, /animate=\{\{ opacity: 1, scale: 1 \}\}/);
  });

  it('collapses the duration under reduced motion', () => {
    assert.match(
      dialogSource,
      /reduceMotion \? PANEL_TRANSITION_DURATION_REDUCED : PANEL_TRANSITION\.duration/,
    );
  });

  it('defers close() so the scale-out is not cut short', () => {
    // Closing a <dialog> hides it outright, so close() has to wait for the exit.
    assert.match(dialogSource, /onExitComplete=\{handleExitComplete\}/);
    assert.match(dialogSource, /if \(dialog\?\.open\) dialog\.close\(\)/);
  });

  it('toggles display so the scrim cannot outlive the dialog', () => {
    // An author `display: flex` beats the UA's `dialog:not([open])` rule at any
    // specificity, so a permanent flex would leave the scrim on screen.
    assert.match(dialogSource, /isShowing \? 'flex' : 'hidden'/);
  });

  it('uses the top layer rather than inventing a z-index', () => {
    assert.match(dialogSource, /dialog\.showModal\(\)/);
    assert.match(dialogSource, /event\.preventDefault\(\);\s*\n\s*onClose\(\);/);
  });
});

describe('provider registry is plug and play', () => {
  it('routes by the provider matching the model, not by a hardcoded id', () => {
    assert.match(providersSource, /export function findVoiceProvider\(modelId: string\)/);
    assert.match(providersSource, /VOICE_PROVIDERS\.find\(/);
    assert.match(providersSource, /export const VOICE_PROVIDERS: VoiceProvider\[\]/);
  });

  it('keys stored selections per provider so a second one cannot inherit them', () => {
    assert.match(storeSource, /export type VoiceSettingsState = Record<string, VoiceSelection>/);
    assert.match(storeSource, /state\[provider\.id\]/);
    assert.match(storeSource, /\[provider\.id\]: \{/);
  });

  it('resolves stored ids against the live roster on read', () => {
    // A voice retired from the API must fall back to the provider default rather
    // than going out on the wire.
    assert.match(storeSource, /resolveVoice\(provider, stored\?\.voiceId\)/);
    assert.match(storeSource, /resolveLanguage\(provider, stored\?\.languageCode\)/);
  });

  it('sends nothing extra when no provider claims the model', () => {
    // The pre-existing request shape, byte for byte, for an unrecognised model.
    assert.match(storeSource, /if \(!settings\) return \{ systemPrompt \};/);
    assert.match(storeSource, /if \(!provider\) return null;/);
  });

  it('survives a corrupt or unavailable store', () => {
    assert.match(storeSource, /typeof entry\.voiceId !== 'string'/);
    assert.match(storeSource, /catch \{/);
  });
});

describe('Gemini language handling', () => {
  it('steers native audio through the prompt, not an explicit code', () => {
    // Gemini's native-audio Live models pick the language themselves and reject
    // an explicit languageCode, so the provider is on systemInstruction mode.
    const provider = providersSource.slice(
      providersSource.indexOf('export const GEMINI_VOICE_PROVIDER'),
    );
    assert.match(provider, /languageMode: 'systemInstruction'/);
    assert.match(provider, /defaultLanguageCode: AUTO_LANGUAGE/);
  });

  it('never sets languageCode for a systemInstruction provider', () => {
    assert.match(
      storeSource,
      /provider\.languageMode === 'speechConfig' && !isAuto \? language\.code : undefined/,
    );
    assert.match(
      storeSource,
      /provider\.languageMode === 'systemInstruction' \? buildLanguageDirective\(language\) : ''/,
    );
  });

  it('appends nothing at all on Auto-detect', () => {
    assert.match(providersSource, /if \(language\.code === AUTO_LANGUAGE\) return '';/);
    assert.match(storeSource, /directive \? `\$\{systemPrompt\}\\n\\n\$\{directive\}` : systemPrompt/);
  });

  it('leaves a speechConfig provider needing no ChatView change', () => {
    // buildLiveVoiceOptions already returns the field, and live.ts already sends
    // it, so a future provider is a registry entry and nothing more.
    assert.match(liveSource, /voiceName\?: string;/);
    assert.match(liveSource, /languageCode\?: string;/);
    assert.match(liveSource, /prebuiltVoiceConfig: \{ voiceName: this\.opts\.voiceName \}/);
    assert.match(liveSource, /\{ languageCode: this\.opts\.languageCode \}/);
  });

  it('omits speechConfig entirely when neither field is set', () => {
    assert.match(liveSource, /this\.opts\.voiceName \|\| this\.opts\.languageCode/);
  });
});

describe('live session wiring', () => {
  it('reopens the socket on a change, since setup fixes both', () => {
    assert.match(chatViewSource, /const restartLiveSession = useCallback\(/);
    assert.match(chatViewSource, /liveSessionRef\.current\.stop\(\);/);
    assert.match(chatViewSource, /openLiveSession\(apiKey\);/);
  });

  it('guards every callback on the session still being current', () => {
    // stop() always reaches ws.onclose, so an unguarded callback would let the
    // outgoing session null the ref its successor just claimed.
    assert.match(chatViewSource, /const isCurrentSession = \(\) => liveSessionRef\.current === session;/);

    const opener = chatViewSource.slice(
      chatViewSource.indexOf('const openLiveSession = useCallback('),
      chatViewSource.indexOf('const restartLiveSession = useCallback('),
    );
    const handlers = opener.match(/\bon[A-Z]\w*: \(/g) ?? [];
    assert.ok(handlers.length >= 7, `expected the session's handlers, saw ${handlers.length}`);
    // One guard per handler — the declaration above is an arrow, not a call, so
    // it does not count itself.
    const guards = opener.match(/isCurrentSession\(\)/g) ?? [];
    assert.equal(guards.length, handlers.length);
  });

  it('reads the analysers off the session it constructed', () => {
    // Not off the ref, which a restart can swap between construct and open.
    assert.match(chatViewSource, /session\.micAnalyser \?\? null/);
    assert.match(chatViewSource, /session\.outputAnalyser \?\? null/);
  });

  it('reconnects only on an actual model, voice or language change', () => {
    // The model is part of the signature, not just the voice settings: it rides
    // the same setup frame, so picking a different live model from the composer's
    // pill needs the same teardown-and-reopen a voice change does. The signature
    // is read for the selected live model rather than a hardcoded id, which is
    // what lets that pill switch models at all.
    assert.match(
      chatViewSource,
      /liveSettingsSignatureRef\.current = `\$\{liveModelId\}\|\$\{voiceSettingsSignature\(liveModelId\)\}`/,
    );
    assert.match(
      chatViewSource,
      /`\$\{liveModelId\}\|\$\{voiceSettingsSignature\(liveModelId\)\}` === liveSettingsSignatureRef\.current\) return;/,
    );
    // And the effect has to actually watch the model, or a switch never reaches
    // the comparison above.
    assert.match(chatViewSource, /\}, \[isLive, liveModelId, restartLiveSession, voiceSettings\]\);/);
  });

  it('rides the orb experiment and cannot outlive the session', () => {
    assert.match(chatViewSource, /showVoiceOrb && voiceProvider && voiceSelection && \(/);
    assert.match(chatViewSource, /if \(!showVoiceOrb\) setIsVoiceSettingsOpen\(false\);/);
  });
});

describe('the panel orb leaves the session orb alone', () => {
  // Two ways the panel's orb was reaching the one behind it, both fixed here.

  const restart = chatViewSource.slice(
    chatViewSource.indexOf('const restartLiveSession = useCallback('),
    chatViewSource.indexOf('}, [apiKeys, openLiveSession]);'),
  );

  it('keeps the connected flag across a voice change', () => {
    // The flag drives the reveal ramp. Dropping it to false for the swap fades
    // the orb out and replays the connect reveal on every voice change — which
    // reads as the panel disturbing the orb, since the panel is where voice
    // changes come from. The session is continuous, so the flag stays put.
    assert.ok(restart.length > 0, 'restartLiveSession should still exist');
    assert.doesNotMatch(restart, /setIsLiveConnected\(/);

    // The things that genuinely do end with the old socket still go.
    assert.match(restart, /setIsAssistantSpeaking\(false\);/);
    assert.match(restart, /setLiveAnalysers\(\{ mic: null, output: null \}\);/);
  });

  it('still clears the flag on the paths where voice mode really ends', () => {
    // Leaving it set across a restart is only safe because a failed or closed
    // socket clears it, and an explicit stop does too.
    const clears = chatViewSource.match(/setIsLiveConnected\(false\)/g) ?? [];
    assert.equal(clears.length, 3, 'handleStopLive, onError and onClose');
    assert.match(chatViewSource, /setIsLiveConnected\(true\);/);
  });

  it('seeds the reveal from the connection instead of ramping from zero', () => {
    // An orb mounted into an already-connected session has nothing to reveal.
    // Ramping 0 → 1 regardless is the "loading animation" the panel replayed
    // every time it opened.
    assert.match(orbSource, /const initialReveal = connectedRef\.current \? 1 : 0;/);
    assert.match(
      orbSource,
      /new LinearRamp\(REVEAL_RAMP_DURATION_MS, initialReveal\)/,
    );
    assert.match(orbSource, /let revealAmount = initialReveal;/);
  });

  it('skips the scale-in for the orb the panel draws', () => {
    // The panel's orb appears mid-session, so the mount animation would fire on
    // every open. The session's own orb keeps it — that one is a real entrance.
    assert.match(dialogSource, /<VoiceOrb \{\.\.\.orbProps\} animatePresence=\{false\} \/>/);
    assert.match(orbSource, /initial=\{animatePresence \? \{ scale: ORB_SCALE_HIDDEN \} : false\}/);
    assert.match(orbSource, /exit=\{animatePresence \? \{ scale: ORB_SCALE_HIDDEN \} : undefined\}/);
  });
});




