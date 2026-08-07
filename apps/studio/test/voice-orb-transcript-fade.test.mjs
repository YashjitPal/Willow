/**
 * The transcript fade, checked against the stylesheet it was transcribed from.
 *
 * The defect this covers: the conversation stayed readable behind the expanded
 * orb. Upstream hides it, and does so by writing attributes onto the transcript
 * scroll root that a stylesheet keys on -- so the behaviour lives in two places
 * that can drift apart. `voice-focus-surface.css` holds literals because CSS
 * cannot read a module, and `focus-surface-constants.ts` holds the same numbers
 * for the code. This test is what keeps the two honest: it parses the CSS and
 * requires every value in it to equal the constant it came from.
 *
 * The attribute resolver is executed rather than read, against the transitions a
 * live session's mutation record showed:
 *
 *   surface mounts        surface="" and state="floating" appear together
 *   floating -> expanded  state="expanded", plus aria-hidden, inert and
 *                         data-voice-focus-mode appearing
 *   expanded -> floating  state="floating", and those three removed outright
 *
 * That last one is the subtle case and the reason removal is asserted rather
 * than a falsy value: `inert=""` and `inert="false"` are both inert, so an
 * implementation that wrote "false" would leave the transcript permanently
 * unfocusable while looking correct in a snapshot.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { importTs } from './ts-module.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const orbDir = path.resolve(here, '../../../features/chat/src/voice-orb');

const css = fs.readFileSync(path.join(orbDir, 'voice-focus-surface.css'), 'utf8');
const chatView = fs.readFileSync(
  path.resolve(here, '../../../features/chat/src/ChatView.tsx'),
  'utf8',
);
const focusSurface = fs.readFileSync(path.join(orbDir, 'VoiceFocusSurface.tsx'), 'utf8');

const {
  FOCUS_SURFACE_ATTR,
  FOCUS_SURFACE_STATE_ATTR,
  FOCUS_MODE_ATTR,
  FOCUS_SURFACE_STATE_EXPANDED,
  FOCUS_SURFACE_STATE_FLOATING,
  FOCUS_FADE_TRANSITION,
  FOCUS_TRANSITION,
  MAIN_CONTENT_EXPANDED_OFFSET_Y,
  resolveFocusSurfaceAttributes,
} = await importTs(path.join(orbDir, 'focus-surface-constants.ts'));

/** Body of the rule whose selector contains every one of `parts`. */
const ruleBody = (...parts) => {
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)];
  const match = rules.find(([, selector]) =>
    parts.every((part) => selector.includes(part)),
  );
  assert.ok(match, `no rule selecting ${parts.join(' + ')}`);
  return match[2];
};

const declaration = (body, property) => {
  const match = body.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`));
  assert.ok(match, `no ${property} declaration in "${body.trim()}"`);
  return match[1].trim().replace(/\s+/g, ' ');
};

/** Serialise an ease array the way the stylesheet spells it. */
const cubicBezier = (ease) => `cubic-bezier(${ease.join(', ')})`;

describe('transcript fade stylesheet', () => {
  it('keys on the attribute names the resolver writes', () => {
    // A rename on either side silently disables the fade, since a selector that
    // matches nothing is not an error.
    assert.ok(css.includes(`[${FOCUS_SURFACE_ATTR}]`), 'surface attribute selector');
    assert.ok(css.includes(`[${FOCUS_SURFACE_STATE_ATTR}=`), 'state attribute selector');
    assert.ok(css.includes(`[${FOCUS_MODE_ATTR}]`), 'focus-mode attribute selector');
  });

  it('transitions opacity and transform on the captured curves', () => {
    const transition = declaration(ruleBody(`[${FOCUS_SURFACE_ATTR}]`), 'transition');

    assert.ok(
      transition.includes(
        `opacity ${FOCUS_FADE_TRANSITION.duration}s ${cubicBezier(FOCUS_FADE_TRANSITION.ease)}`,
      ),
      `opacity leg of "${transition}"`,
    );
    assert.ok(
      transition.includes(
        `transform ${FOCUS_TRANSITION.duration}s ${cubicBezier(FOCUS_TRANSITION.ease)}`,
      ),
      `transform leg of "${transition}"`,
    );

    // The two legs run at different durations upstream, which is visible: the
    // fade finishes while the lift is still travelling.
    assert.notEqual(FOCUS_FADE_TRANSITION.duration, FOCUS_TRANSITION.duration);
  });

  it('hides and lifts the transcript in the expanded state', () => {
    const body = ruleBody(
      `[${FOCUS_SURFACE_STATE_ATTR}='${FOCUS_SURFACE_STATE_EXPANDED}']`,
    );
    assert.equal(declaration(body, 'opacity'), '0');
    assert.equal(
      declaration(body, 'transform'),
      `translateY(${MAIN_CONTENT_EXPANDED_OFFSET_Y}px)`,
    );
  });

  it('restores the transcript in the floating state', () => {
    const body = ruleBody(
      `[${FOCUS_SURFACE_STATE_ATTR}='${FOCUS_SURFACE_STATE_FLOATING}']`,
    );
    assert.equal(declaration(body, 'opacity'), '1');
  });

  it('locks scrolling while expanded, overriding the scroll root', () => {
    // Upstream spells this as a Tailwind variant ending in `!`. The important
    // half is the `!important`: the scroll root's own overflow-y-auto is equally
    // specific and would otherwise win by source order.
    const body = ruleBody(`[${FOCUS_MODE_ATTR}]`);
    assert.match(declaration(body, 'overflow-y'), /^hidden\s*!important$/);
  });
});

describe('focus surface attributes', () => {
  it('marks the floating state without hiding anything', () => {
    const attributes = resolveFocusSurfaceAttributes(false);

    assert.equal(attributes[FOCUS_SURFACE_ATTR], '');
    assert.equal(attributes[FOCUS_SURFACE_STATE_ATTR], FOCUS_SURFACE_STATE_FLOATING);
    assert.equal(attributes[FOCUS_MODE_ATTR], undefined);
    assert.equal(attributes['aria-hidden'], undefined);
    assert.equal(attributes.inert, undefined);
  });

  it('hides the transcript from assistive tech while expanded', () => {
    const attributes = resolveFocusSurfaceAttributes(true);

    assert.equal(attributes[FOCUS_SURFACE_ATTR], '');
    assert.equal(attributes[FOCUS_SURFACE_STATE_ATTR], FOCUS_SURFACE_STATE_EXPANDED);
    assert.equal(attributes[FOCUS_MODE_ATTR], '');
    assert.equal(attributes['aria-hidden'], true);
    assert.equal(attributes.inert, true);
  });

  it('removes the three expanded-only attributes rather than falsifying them', () => {
    // React removes an attribute for `undefined` and renders it for `false`,
    // and `inert="false"` is still inert. Only `undefined` matches the capture.
    const floating = resolveFocusSurfaceAttributes(false);

    for (const key of [FOCUS_MODE_ATTR, 'aria-hidden', 'inert']) {
      assert.equal(floating[key], undefined, `${key} should be removed, not falsified`);
      assert.notEqual(floating[key], false, `${key} must not be rendered as "false"`);
    }
  });

  it('keeps the surface attribute present in both states', () => {
    // It is the anchor half of every selector; dropping it in either state would
    // leave the state attribute matching nothing.
    assert.equal(resolveFocusSurfaceAttributes(true)[FOCUS_SURFACE_ATTR], '');
    assert.equal(resolveFocusSurfaceAttributes(false)[FOCUS_SURFACE_ATTR], '');
  });
});

describe('transcript fade wiring', () => {
  it('spreads the resolved attributes onto the scroll root', () => {
    // The fade is inert unless something applies it, and the capture settled
    // which element that is: `main` never faded across all 4175 recorded frames
    // while the scroll wrapper reached opacity 0.
    assert.match(
      chatView,
      /resolveFocusSurfaceAttributes/,
      'ChatView should resolve the attributes rather than inline them',
    );
    assert.match(
      chatView,
      /\{\s*\.\.\.voiceFocusSurfaceAttributes\s*\}/,
      'the resolved attributes should be spread onto an element',
    );
  });

  it('drops the attributes entirely when the orb is not on screen', () => {
    // Upstream's resolver returns undefined with the surface hidden, so a chat
    // with the experiment off carries no attributes and cannot inherit the
    // transition. Spreading an unconditional object would fade every chat.
    assert.match(
      chatView,
      /showVoiceOrb\s*\n?\s*\?\s*resolveFocusSurfaceAttributes\([^)]*\)\s*\n?\s*:\s*undefined/,
      'attributes should be conditional on the surface being shown',
    );
  });

  it('loads the stylesheet from the component that owns the surface', () => {
    // Co-located CSS imported by its consumer, which is the convention in this
    // feature (see composer/Composer.tsx). Nothing applies the fade otherwise.
    assert.match(focusSurface, /import\s+['"]\.\/voice-focus-surface\.css['"]/);
  });
});

describe('focus state reset', () => {
  // The atom is module state that outlives the surface, so something has to put
  // it back to expanded for the next session. Where that happens is load-bearing:
  // AnimatePresence keeps the surface mounted after the caller's flag goes false
  // so the exit can run, so resetting on the flag re-renders a still-visible
  // surface as focused. An orb collapsed at the time then animates back to the
  // centre and springs its shader scale to 1 on top of the scale-out.

  it('resets on the surface unmounting, not on a render flag', () => {
    const effect = focusSurface.match(
      /useEffect\(\(\) => \{\s*focusModeAtom\.set\([^)]*\);\s*return \(\) => focusModeAtom\.set\([^)]*\);\s*\}, \[[^\]]*\]\);/,
    );
    assert.ok(
      effect,
      'the surface should set the atom on mount and restore it in the cleanup',
    );
  });

  it('keeps the reset out of the consumer, which unmounts on a delay', () => {
    // The specific shape that caused the defect: a ChatView effect keyed on
    // showVoiceOrb writing the atom while the exit animation was still running.
    assert.ok(
      !/focusModeAtom\.set/.test(chatView),
      'ChatView should read the atom, never write it — its flag flips before the exit ends',
    );
    assert.match(
      chatView,
      /useStore\(focusModeAtom\)/,
      'ChatView should still subscribe for the transcript attributes',
    );
  });

  it('lets the exit run from either state', () => {
    // Both directions unmount through the same AnimatePresence, so neither may
    // depend on the atom being reset first.
    assert.match(
      chatView,
      /<AnimatePresence>\s*\{showVoiceOrb && \(/,
      'the surface should unmount through AnimatePresence',
    );
  });
});
