/**
 * Voice focus surface — the expand/collapse wrapper for the voice orb.
 *
 * Transcribed from the shipped `VoiceFloatingOrb`. The surface has two states,
 * named "focus" (large, centred, transcript hidden) and "floating" (small, above
 * the composer, conversation readable). Pressing the orb toggles between them.
 *
 * The mechanism is the counter-intuitive part, and it was established from
 * capture rather than assumed: the canvas never resizes and carries no CSS
 * transform. The positioned wrapper stays at the focus size in both states, and
 * the visual shrink is the shader's `surfaceScale` uniform, which a spring drives
 * toward `visibleOrbSize / focusOrbSize`. See `focus-surface-constants.ts` for
 * the numbers and how each was verified.
 *
 * The class lists on the wrapper, the inner box and the button are transcribed
 * verbatim from the shipped markup, including the arbitrary-value scale
 * utilities. They are written as literals because Tailwind resolves class names
 * statically — building them from the constants by interpolation would emit
 * strings the compiler never sees. `focus-surface-constants.ts` records the same
 * numbers so the correspondence stays checkable.
 */

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { atom } from 'nanostores';
import { useStore } from '@nanostores/react';

import { VoiceOrb, type VoiceOrbProps } from './VoiceOrb';
import {
  FOCUS_SURFACE_ARIA_LABEL,
  FOCUS_SURFACE_ROLE,
  FOCUS_TRANSITION,
  resolveButtonSize,
  resolveFloatingContainerRect,
  resolveOrbRect,
  resolveOrbSize,
  resolveVisibleOrbSize,
  type Rect,
} from './focus-surface-constants';
import './voice-focus-surface.css';

/**
 * Focus state: true = focused (expanded), false = floating (collapsed).
 *
 * Initialises false, as the shipped atom does. The surface then sets it from the
 * session kind on mount: `p1.js:41706` runs `cg.set(isSemiFocusedMode)` whenever
 * the orb surface becomes visible, and since every Willow session is the
 * transcript-visible variant, that resolves to true — so the orb opens expanded
 * and collapses on press, which is the behaviour being reproduced.
 */
export const focusModeAtom = atom<boolean>(false);

export interface VoiceFocusSurfaceProps extends Omit<VoiceOrbProps, 'renderScale'> {
  /**
   * Rect the orb is positioned against, in viewport coordinates.
   *
   * Upstream derives this from its main content region, and both states use it:
   * the focused orb is centred in it, and the floating orb sits in a strip at
   * its bottom edge.
   */
  mainContentRect: Rect;
  /** Shifts the floating orb up while a voice hint is on screen. */
  hasVisibleVoiceHint?: boolean;
  /** Shifts the floating orb up further while the detached text input is open. */
  isTextInputOpen?: boolean;
}

/** Viewport size, tracked because the orb size table switches on width. */
const useViewportSize = () => {
  const [size, setSize] = useState(() => ({
    width: typeof window === 'undefined' ? 1024 : window.innerWidth,
    height: typeof window === 'undefined' ? 800 : window.innerHeight,
  }));

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const measure = () =>
      setSize({ width: window.innerWidth, height: window.innerHeight });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  return size;
};

export const VoiceFocusSurface: React.FC<VoiceFocusSurfaceProps> = ({
  mainContentRect,
  hasVisibleVoiceHint = false,
  isTextInputOpen = false,
  ...orbProps
}) => {
  const isInFocus = useStore(focusModeAtom);
  const { width: viewportWidth } = useViewportSize();

  // Willow has no wingman/video session kind, so every session is the
  // transcript-visible variant, which upstream calls semi-focused. That is the
  // mode the capture was taken in, so its 0.8 size scale applies.
  const isSemiFocusedMode = true;

  // Upstream runs `cg.set(isSemiFocusedMode)` when the orb surface becomes
  // visible (`p1.js:41706`), which opens the orb expanded for transcript-visible
  // sessions. The atom initialises false, so this effect reproduces that on
  // mount.
  //
  // The cleanup restores it for the next session, and the surface's own lifecycle
  // is the only correct clock for that. The atom is module state that outlives
  // this component, so a caller is tempted to reset it when its "show the orb"
  // flag flips — but `AnimatePresence` deliberately keeps this subtree mounted
  // after that flag goes false so the exit can run. Resetting on the flag
  // therefore re-renders a *visible* surface as focused, and an orb collapsed at
  // the time is sent flying back to the centre mid-exit: the wrapper animates
  // `top`/`left` over FOCUS_TRANSITION while the shader's scale springs back to
  // 1, on top of the scale-out. React runs this cleanup only once the element is
  // genuinely removed, which is after the exit has finished.
  useEffect(() => {
    focusModeAtom.set(isSemiFocusedMode);
    return () => focusModeAtom.set(isSemiFocusedMode);
  }, [isSemiFocusedMode]);

  const focusOrbSize = resolveOrbSize({
    isInFocus: true,
    isSemiFocusedMode,
    viewportWidth,
  });
  const floatingOrbSize = resolveOrbSize({
    isInFocus: false,
    isSemiFocusedMode,
    viewportWidth,
  });

  // `forceFocusSizeInFloatingMode` is upstream's still-connecting case, where a
  // floating orb is drawn at focus size. Willow gates the whole surface on the
  // session existing, so it is never in that state.
  const forceFocusSizeInFloatingMode = false;
  const isFloatingMode = !isInFocus;

  const visibleOrbSize = resolveVisibleOrbSize({
    floatingOrbSize,
    focusOrbSize,
    isFloatingMode,
    forceFocusSizeInFloatingMode,
    isInFocus,
  });

  const buttonSize = resolveButtonSize({
    floatingOrbSize,
    focusOrbSize,
    isFloatingMode,
    forceFocusSizeInFloatingMode,
  });

  // Focused: centred in the content rect. Floating: a strip at its bottom edge.
  const containerRect = isInFocus
    ? mainContentRect
    : resolveFloatingContainerRect({
        floatingOrbSize,
        hasVisibleVoiceHint,
        isTextInputOpen,
        mainContentRect,
      });

  // The wrapper is always `focusOrbSize` square; this offsets it so the smaller
  // visible orb still lands centred.
  const orbRect = resolveOrbRect({
    containerRect,
    maxOrbSize: focusOrbSize,
    visibleOrbSize,
  });

  // What the shader shrinks to. The canvas stays at the focus size.
  const renderScale = visibleOrbSize / focusOrbSize;

  // The extracted class is `z-49`. Upstream is on Tailwind v4, where bare
  // numerics resolve; Willow's v3 CDN build has no `z-49` in its scale and would
  // emit no z-index at all, dropping the surface behind the app's `z-50`
  // overlays. `z-[49]` is the same 49 in the syntax v3 resolves — the value is
  // extracted, only the spelling is adapted.
  return (
    <div className="pointer-events-none fixed inset-0 z-[49]" data-testid="voice-focus-surface">
      <motion.div
        animate={{ top: orbRect.top, left: orbRect.left }}
        className="pointer-events-none fixed flex items-center justify-center will-change-[top,left]"
        initial={false}
        transition={FOCUS_TRANSITION}
        style={{ width: focusOrbSize, height: focusOrbSize }}
      >
        <motion.div
          className="flex items-center justify-center"
          initial={false}
          style={{ width: focusOrbSize, height: focusOrbSize }}
          transition={FOCUS_TRANSITION}
        >
          <button
            aria-expanded={isInFocus}
            aria-label={isInFocus ? 'Exit focus mode' : 'Enter focus mode'}
            aria-pressed={isInFocus}
            className="pointer-events-auto flex shrink-0 origin-center items-center justify-center rounded-full outline-none transition-transform duration-300 ease-out focus-visible:scale-[1.02] hover:scale-[1.02] active:scale-[0.99]"
            style={{ width: buttonSize, height: buttonSize }}
            type="button"
            onClick={() => focusModeAtom.set(!isInFocus)}
          >
            <div
              className="pointer-events-none shrink-0"
              style={{ width: focusOrbSize, height: focusOrbSize }}
            >
              <VoiceOrb {...orbProps} renderScale={renderScale} />
            </div>
          </button>
        </motion.div>
      </motion.div>
    </div>
  );
};

export default VoiceFocusSurface;
