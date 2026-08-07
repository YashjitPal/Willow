/**
 * Layout and transition constants for the voice focus surface.
 *
 * Transcribed from the shipped `VoiceFloatingOrb` module. Every number was read
 * out of that module's own constant table, then cross-checked against measured
 * element rects and screenshot pixel bounds from a live session. Nothing here is
 * estimated.
 *
 * The surface has two states, and the shipped code names them "focus" (the large,
 * centred orb with the transcript hidden) and "floating" (the small orb sitting
 * above the composer with the conversation readable). Pressing the orb toggles
 * between them.
 *
 * Two facts about the collapse are worth stating plainly, because both are
 * counter-intuitive and both were established from capture rather than assumed:
 *
 *  1. The canvas does not resize and carries no CSS transform. It stays at the
 *     focus size in both states. The visual shrink is `uSurfaceScale`, a shader
 *     uniform fed the ratio below, which a spring drives toward its target.
 *  2. The positioned wrapper is always the focus size. The smaller floating orb
 *     is centred inside that larger box, which is why the wrapper's `top`/`left`
 *     are offset by half the size difference.
 */

/** Orb size in CSS pixels when focused, by viewport width breakpoint. */
export const FOCUS_ORB_SIZE_LG = 256;
export const FOCUS_ORB_SIZE_MD = 224;
export const FOCUS_ORB_SIZE_SM = 192;

/** Orb size in CSS pixels when floating, by viewport width breakpoint. */
export const FLOATING_ORB_SIZE_MD = 112;
export const FLOATING_ORB_SIZE_SM = 96;

/**
 * Multiplier applied to both sizes in semi-focused sessions.
 *
 * A semi-focused session keeps the transcript on screen behind the orb, so every
 * size shrinks by this factor. 256 * 0.8 = 204.8 and 106 * 0.8 = 84.8, which are
 * the two sizes the measured button rects show.
 */
export const SEMI_FOCUS_SIZE_SCALE = 0.8;

/** Floating size in semi-focused sessions, pre-multiplied as upstream has it. */
export const SEMI_FOCUS_FLOATING_SIZE_MD = 106 * SEMI_FOCUS_SIZE_SCALE;
export const SEMI_FOCUS_FLOATING_SIZE_SM = 96 * SEMI_FOCUS_SIZE_SCALE;

/** Viewport width breakpoints the size table switches on. */
export const BREAKPOINT_MD = 640;
export const BREAKPOINT_LG = 1024;

/** Gap in CSS pixels between the floating orb and the bottom of its container. */
export const FLOATING_ORB_BOTTOM_GAP = 24;

/** Vertical shift applied while a voice hint is visible. */
export const VOICE_HINT_OFFSET = -24;

/** Vertical shift applied while the detached text input is open. */
export const TEXT_INPUT_OPEN_OFFSET = -90;

/** Composer-anchored fallback rect: height, and the offsets that place it. */
export const COMPOSER_ANCHOR_HEIGHT = 152;
export const COMPOSER_ANCHOR_GAP = 32;
export const COMPOSER_ANCHOR_LIFT = 36;
export const COMPOSER_ANCHOR_MIN_TOP = 24;

/**
 * Position and scale transition for the state change.
 *
 * A measured fit confirms this: sampling the wrapper's `top` per frame across a
 * real collapse and expand, this curve tracks the samples to within 4e-4 over the
 * settle, and both transitions land at exactly 0.36s.
 */
export const FOCUS_TRANSITION = {
  duration: 0.36,
  ease: [0.22, 1, 0.36, 1],
} as const;

/** Opacity transition for the transcript and header fade. */
export const FOCUS_FADE_TRANSITION = {
  duration: 0.24,
  ease: [0.32, 0.72, 0, 1],
} as const;

/** Applied while a launch animation owns the position, so it is not fought. */
export const LAUNCH_TRANSITION = { duration: 0 } as const;

/** Vertical offset of the main content while the orb is expanded. */
export const MAIN_CONTENT_EXPANDED_OFFSET_Y = -56;

/** Button hover, press and focus scales, as authored in the class list. */
export const ORB_BUTTON_HOVER_SCALE = 1.02;
export const ORB_BUTTON_ACTIVE_SCALE = 0.99;
export const ORB_BUTTON_TRANSITION_MS = 300;

/**
 * Attribute names the shipped surface writes onto the transcript scroll root.
 *
 * Recovered un-minified from the bundle, where the same identifiers are also
 * interpolated into the stylesheet that `voice-focus-surface.css` transcribes.
 * The scroll root is found with `closest('[data-scroll-root]')`.
 */
export const FOCUS_SURFACE_ATTR = 'data-voice-floating-orb-focus-surface';
export const FOCUS_SURFACE_STATE_ATTR = 'data-voice-floating-orb-focus-surface-state';
export const FOCUS_MODE_ATTR = 'data-voice-focus-mode';

/** The two values of the state attribute, spelled as the stylesheet matches them. */
export const FOCUS_SURFACE_STATE_EXPANDED = 'expanded';
export const FOCUS_SURFACE_STATE_FLOATING = 'floating';

/**
 * `role` and `aria-label` for the focus-mode region.
 *
 * These do not belong to the scroll root. Upstream puts them on an overlay
 * inside the orb container, sized to the main content rect, which holds the
 * controls that only exist in focus mode:
 *
 *   role: isInFocus ? 'region' : undefined,
 *   'aria-label': isInFocus ? f(messages.focusModeRegion) : undefined,
 *   className: 'pointer-events-none fixed overflow-hidden',
 *
 * with `defaultMessage: 'Voice focus mode'` under the id
 * `voiceFloatingOrb.focusModeRegion`. Willow renders no focus-mode-only
 * children, so that overlay would be an empty box; the names are recorded here
 * for whenever it gains some.
 */
export const FOCUS_SURFACE_ROLE = 'region';
export const FOCUS_SURFACE_ARIA_LABEL = 'Voice focus mode';

/**
 * Attributes to put on the transcript scroll root for a given state.
 *
 * Transcribed from the mutation record of a live session, which shows all three
 * transitions distinctly and is the reason this is a resolver rather than a
 * ternary at the call site:
 *
 *  - surface mounts:      `surface=""`, `state="floating"` appear together
 *  - floating -> expanded: `state="expanded"`, plus `aria-hidden="true"`,
 *                          `inert=""` and `data-voice-focus-mode=""` appearing
 *  - expanded -> floating: `state="floating"`, and those three *removed*, not
 *                          set to "false" — which matters, because `inert=""`
 *                          and `inert="false"` are both inert
 *  - surface unmounts:    every one of them removed in a single batch
 *
 * `undefined` marks an absent attribute, which is how React spells removal.
 */
export function resolveFocusSurfaceAttributes(isInFocus: boolean): {
  [FOCUS_SURFACE_ATTR]: string;
  [FOCUS_SURFACE_STATE_ATTR]: string;
  [FOCUS_MODE_ATTR]: string | undefined;
  'aria-hidden': boolean | undefined;
  inert: boolean | undefined;
} {
  return {
    [FOCUS_SURFACE_ATTR]: '',
    [FOCUS_SURFACE_STATE_ATTR]: isInFocus
      ? FOCUS_SURFACE_STATE_EXPANDED
      : FOCUS_SURFACE_STATE_FLOATING,
    [FOCUS_MODE_ATTR]: isInFocus ? '' : undefined,
    'aria-hidden': isInFocus ? true : undefined,
    inert: isInFocus ? true : undefined,
  };
}

/**
 * Resolve the orb size for a state.
 *
 * Mirrors the shipped size table exactly, including the early return that gives
 * semi-focused floating orbs their own pre-multiplied sizes rather than scaling
 * the regular floating size.
 */
export function resolveOrbSize({
  isInFocus,
  isSemiFocusedMode,
  viewportWidth,
}: {
  isInFocus: boolean;
  isSemiFocusedMode: boolean;
  viewportWidth: number;
}): number {
  if (isSemiFocusedMode && !isInFocus) {
    return viewportWidth < BREAKPOINT_MD
      ? SEMI_FOCUS_FLOATING_SIZE_SM
      : SEMI_FOCUS_FLOATING_SIZE_MD;
  }

  const size = isInFocus
    ? viewportWidth >= BREAKPOINT_LG
      ? FOCUS_ORB_SIZE_LG
      : viewportWidth >= BREAKPOINT_MD
        ? FOCUS_ORB_SIZE_MD
        : FOCUS_ORB_SIZE_SM
    : viewportWidth >= BREAKPOINT_MD
      ? FLOATING_ORB_SIZE_MD
      : FLOATING_ORB_SIZE_SM;

  return isSemiFocusedMode ? size * SEMI_FOCUS_SIZE_SCALE : size;
}

/** Size the visible orb should occupy, which drives the shader's scale. */
export function resolveVisibleOrbSize({
  floatingOrbSize,
  focusOrbSize,
  isFloatingMode,
  forceFocusSizeInFloatingMode,
  isInFocus,
}: {
  floatingOrbSize: number;
  focusOrbSize: number;
  isFloatingMode: boolean;
  forceFocusSizeInFloatingMode: boolean;
  isInFocus: boolean;
}): number {
  return isInFocus || (isFloatingMode && forceFocusSizeInFloatingMode)
    ? focusOrbSize
    : floatingOrbSize;
}

/** Size of the pressable button, which is the hit target rather than the visual. */
export function resolveButtonSize({
  floatingOrbSize,
  focusOrbSize,
  isFloatingMode,
  forceFocusSizeInFloatingMode,
}: {
  floatingOrbSize: number;
  focusOrbSize: number;
  isFloatingMode: boolean;
  forceFocusSizeInFloatingMode: boolean;
}): number {
  if (isFloatingMode && forceFocusSizeInFloatingMode) {
    return focusOrbSize * FORCE_FOCUS_BUTTON_SCALE;
  }
  return isFloatingMode ? floatingOrbSize : focusOrbSize;
}

/** Button scale while a floating orb is forced to focus size (still connecting). */
export const FORCE_FOCUS_BUTTON_SCALE = (2 / 3) * 0.2;

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Centre a rect inside a container. */
export function centerRect({
  containerRect,
  innerRect,
}: {
  containerRect: Rect;
  innerRect: { width: number; height: number };
}): Rect {
  return {
    top: containerRect.top + (containerRect.height - innerRect.height) / 2,
    left: containerRect.left + (containerRect.width - innerRect.width) / 2,
    width: innerRect.width,
    height: innerRect.height,
  };
}

/** Centre a square inside a container. */
export function centerSquare({
  containerRect,
  innerSquareSize,
}: {
  containerRect: Rect;
  innerSquareSize: number;
}): Rect {
  return centerRect({
    containerRect,
    innerRect: { width: innerSquareSize, height: innerSquareSize },
  });
}

/**
 * Position the wrapper so a `visibleOrbSize` square lands centred in the
 * container, while the wrapper itself stays `maxOrbSize` square.
 */
export function resolveOrbRect({
  containerRect,
  maxOrbSize,
  visibleOrbSize = maxOrbSize,
}: {
  containerRect: Rect;
  maxOrbSize: number;
  visibleOrbSize?: number;
}): Rect {
  const centred = centerSquare({ containerRect, innerSquareSize: visibleOrbSize });
  const inset = (maxOrbSize - visibleOrbSize) / 2;
  return {
    top: centred.top - inset,
    left: centred.left - inset,
    width: maxOrbSize,
    height: maxOrbSize,
  };
}

/** Container rect for the floating state: a strip at the bottom of the content. */
export function resolveFloatingContainerRect({
  floatingOrbSize,
  hasVisibleVoiceHint,
  isTextInputOpen,
  mainContentRect,
}: {
  floatingOrbSize: number;
  hasVisibleVoiceHint: boolean;
  isTextInputOpen: boolean;
  mainContentRect: Rect;
}): Rect {
  return {
    left: mainContentRect.left,
    top:
      mainContentRect.top +
      mainContentRect.height -
      floatingOrbSize -
      FLOATING_ORB_BOTTOM_GAP +
      (hasVisibleVoiceHint ? VOICE_HINT_OFFSET : 0) +
      (isTextInputOpen ? TEXT_INPUT_OPEN_OFFSET : 0),
    width: mainContentRect.width,
    height: floatingOrbSize,
  };
}

/** Composer-anchored container rect, used when no main content rect is known. */
export function resolveComposerAnchoredRect({
  composerAnchorRect,
  shouldLiftForHint,
  yOffset = 0,
}: {
  composerAnchorRect: Rect | null;
  shouldLiftForHint: boolean;
  yOffset?: number;
}): Rect | null {
  if (composerAnchorRect == null) return null;
  return {
    left: composerAnchorRect.left,
    top: Math.max(
      COMPOSER_ANCHOR_MIN_TOP,
      composerAnchorRect.top -
        COMPOSER_ANCHOR_HEIGHT -
        COMPOSER_ANCHOR_GAP +
        COMPOSER_ANCHOR_LIFT +
        (shouldLiftForHint ? VOICE_HINT_OFFSET : 0) +
        yOffset,
    ),
    width: composerAnchorRect.width,
    height: COMPOSER_ANCHOR_HEIGHT,
  };
}
