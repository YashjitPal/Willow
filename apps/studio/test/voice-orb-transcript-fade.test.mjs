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
    //
    // `mainContentRect` is in the condition because the rect starts null and the
    // surface must not paint before it has been measured — see the rect suite
    // below. It does not weaken this: the rect is never cleared, so once the orb
    // has been shown, only `showVoiceOrb` decides the exit.
    assert.match(
      chatView,
      /<AnimatePresence>\s*\{showVoiceOrb && mainContentRect && \(/,
      'the surface should unmount through AnimatePresence',
    );
  });
});

describe('surface rect measurement', () => {
  // The rect handed to the surface is measured off the scroll root — the same
  // element this stylesheet lifts. getBoundingClientRect is post-transform, so
  // the lift lands in the measurement unless it is taken back out.
  //
  // It normally hides: with a message on screen the scroller already exists, the
  // lift transitions up from 0, and the measurement taken right after paint reads
  // ~0. Starting voice mode on an empty chat mounts the whole active tree with
  // the expanded attribute already set — nothing transitions, and the first
  // measurement is fully lifted, putting the orb 56px too high in both states.

  it('subtracts the live translation so the layout box is what is measured', () => {
    const measure = chatView.match(
      /const measure = \(\) => \{[\s\S]*?setMainContentRect\(\{[\s\S]*?\}\);/,
    );
    assert.ok(measure, 'ChatView should measure the scroll root for the surface');
    const body = measure[0];

    assert.match(
      body,
      /new DOMMatrix\(\s*getComputedStyle\(container\)\.transform,?\s*\)/,
      'the compensation should read the element’s own computed transform',
    );
    assert.match(body, /top: rect\.top - translateY/);
    assert.match(body, /left: rect\.left - translateX/);
  });

  it('compensates the exact offset the stylesheet applies', () => {
    // What the arithmetic is worth: an uncompensated read of a scroller sitting
    // at its expanded transform reports a top 56px above the layout box, which
    // is the whole of the reported "appears a bit upwards". The stylesheet side
    // of the same number is asserted above, in "hides and lifts the transcript".
    const layoutTop = 100;
    const measuredWhileLifted = layoutTop + MAIN_CONTENT_EXPANDED_OFFSET_Y;
    assert.equal(measuredWhileLifted, 44);
    assert.equal(measuredWhileLifted - MAIN_CONTENT_EXPANDED_OFFSET_Y, layoutTop);
  });

  it('re-measures when the scroll root settles rather than keeping the first frame', () => {
    // The empty-state tree swaps for the active one as voice mode starts, and the
    // composer's shared-layout move settles after this effect runs. A resize
    // listener alone never fires for that.
    const effect = chatView.match(
      /if \(!showVoiceOrb\) return;[\s\S]*?\}, \[showVoiceOrb\]\);/,
    );
    assert.ok(effect, 'the measurement should live in an effect gated on the orb');
    assert.match(effect[0], /new ResizeObserver\(measure\)/);
    assert.match(effect[0], /observer\.observe\(chatScrollRef\.current\)/);
    assert.match(effect[0], /observer\.disconnect\(\)/, 'and be torn down with the effect');
  });

  it('measures before paint, so the first frame is never the wrong position', () => {
    // A plain effect runs after the browser has painted, which is one visible
    // frame at whatever the previous session left behind — the orb appears, then
    // corrects. The correction is what read as the north-east slide.
    assert.match(chatView, /useLayoutEffect\(\(\) => \{\s*if \(!showVoiceOrb\) return;/);
  });

  it('renders nothing until there is a real rect to render against', () => {
    // The state used to initialise to a viewport-sized guess, so the orb mounted
    // against the guess and framer-motion animated `top`/`left` to the correction:
    // right by half the container's left inset, up by half the header/composer
    // difference. North-east. Null plus a render guard removes the wrong position
    // instead of hiding it.
    assert.match(chatView, /\}\s*\| null>\(null\);/);
  });
});

/**
 * The one-frame placement snap, and the guard that must not skip more than that.
 *
 * `mainContentRect` survives the orb closing on purpose — AnimatePresence replays
 * the last rendered surface on the way out, so clearing it would clear a rect the
 * exit is still using. The cost is that a *reopen* renders once against the
 * previous session's rect before the layout effect corrects it. `hasPlaced`
 * suppresses the transition for that single frame so the correction snaps.
 *
 * This suite exists because the first attempt at that guard broke the collapse.
 */
describe('placement snap', () => {
  it('arms the transition a frame after mount and not before', () => {
    assert.match(
      focusSurface,
      /transition=\{hasPlaced \? FOCUS_TRANSITION : \{ duration: 0 \}\}/,
      'the positioned wrapper is what carries the placement',
    );
    assert.match(
      focusSurface,
      /requestAnimationFrame\(\(\) => setHasPlaced\(true\)\)/,
      'a frame later, so the initial position is painted before the transition arms',
    );
  });

  it('schedules the frame unconditionally, so StrictMode cannot strand it', () => {
    // The regression this file is here for. The guard was a ref set *before* the
    // frame was requested:
    //
    //   if (hasPlacedRef.current) return;
    //   hasPlacedRef.current = true;
    //   const id = requestAnimationFrame(() => setHasPlaced(true));
    //   return () => cancelAnimationFrame(id);
    //
    // Under StrictMode's double-invoke the cleanup cancels the frame and the
    // rerun returns early, so nothing reschedules and `hasPlaced` stays false for
    // the life of the orb. That pins the wrapper at `duration: 0` permanently:
    // pressing the orb snapped `top`/`left` straight to the composer strip while
    // the shader's scale still sprang over FOCUS_TRANSITION, and the two halves
    // of the collapse came apart. Scheduling unconditionally is correct under the
    // double-invoke — the cleanup cancels, the rerun schedules again.
    const effect = focusSurface.match(
      /const \[hasPlaced, setHasPlaced\] = useState\(false\);\s*useEffect\(\(\) => \{[\s\S]*?\}, \[\]\);/,
    );
    assert.ok(effect, 'hasPlaced should be plain state driven by a mount effect');
    assert.doesNotMatch(
      effect[0],
      /hasPlacedRef/,
      'a ref guard here strands the frame on the StrictMode rerun',
    );
    assert.doesNotMatch(
      effect[0],
      /\breturn;/,
      'no early exit before requestAnimationFrame',
    );
    assert.match(effect[0], /return \(\) => cancelAnimationFrame\(id\);/);
  });

  it('leaves every later move animated', () => {
    // Only the first frame is skipped. Pressing the orb, resizing the window and
    // the composer growing all still animate, because by then the position being
    // moved from is one the user actually saw. The inner wrapper never had a
    // reason to skip anything.
    const inner = focusSurface.slice(focusSurface.indexOf('<motion.div', focusSurface.indexOf('hasPlaced ? FOCUS_TRANSITION')));
    assert.match(inner, /transition=\{FOCUS_TRANSITION\}/);
  });
});
