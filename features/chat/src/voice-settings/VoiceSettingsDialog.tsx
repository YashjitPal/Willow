/**
 * Voice settings panel.
 *
 * A transcription of the shipped panel's markup: the element tree, the order of
 * the nodes, the aria wiring and the class lists are the captured ones, with the
 * token utilities respelled as the v3 arbitrary values carrying the same measured
 * literals (`bg-token-bg-primary` → `bg-[#212121]`, and so on — the mapping is
 * written out in `voice-settings-constants.ts`).
 *
 * Two things are Willow's rather than upstream's, both because the source has no
 * equivalent to copy:
 *
 *   - the voice roster comes from the active provider, so the dot count follows
 *     the model instead of being nine
 *   - the orb is Willow's `VoiceOrb`, driven by the live session's analysers, in
 *     the captured 144px slot
 *
 * Everything else is measured. The enter/exit values came out of the bundle
 * because Framer Motion is invisible to CSS-event recorders, then were confirmed
 * against a live style-attribute sample.
 */

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

import { VoiceOrb, type VoiceOrbProps } from '../voice-orb/VoiceOrb';
import { LanguageSelect } from './LanguageSelect';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  GlobeIcon,
} from './voice-settings-icons';
import type { LanguageOption, VoiceOption, VoiceProvider } from './voice-providers';
import {
  ARROW_FADE_MS,
  BACKDROP_BG,
  BACKDROP_BLUR,
  DOT_WINDOW,
  ORB_SLOT_SIZE,
  PANEL_MAX_WIDTH,
  PANEL_SCALE_CLOSED,
  PANEL_TEXT_COLOR,
  PANEL_TRANSITION,
  PANEL_TRANSITION_DURATION_REDUCED,
  SETTINGS_ROW_ICON_SIZE,
} from './voice-settings-constants';
import './voice-settings.css';

export type VoiceSettingsDialogProps = {
  open: boolean;
  onClose: () => void;
  provider: VoiceProvider;
  voice: VoiceOption;
  language: LanguageOption;
  onVoiceChange: (voiceId: string) => void;
  onLanguageChange: (code: string) => void;
  /** Passed straight through to the orb, so it lives in the panel too. */
  orbProps: Omit<VoiceOrbProps, 'renderScale' | 'className'>;
};

export const VoiceSettingsDialog: React.FC<VoiceSettingsDialogProps> = ({
  open,
  onClose,
  provider,
  voice,
  language,
  onVoiceChange,
  onLanguageChange,
  orbProps,
}) => {
  const titleId = useId();
  const reduceMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement | null>(null);

  const voices = provider.voices;
  const voiceIndex = Math.max(
    voices.findIndex((v) => v.id === voice.id),
    0,
  );

  /**
   * The nine dots the row paints, and which voices they stand for.
   *
   * Upstream draws one dot per voice because it has nine of them and nine fit the
   * measured `w-60` block. Gemini has thirty, which does not fit at the measured
   * size and gap — see DOT_WINDOW. So the row keeps the captured geometry and
   * slides a window over the roster instead, clamped at both ends so it never
   * renders fewer than the measured count once the roster is long enough. A
   * provider with nine or fewer voices takes the whole list and this is a no-op.
   */
  const windowedVoices = useMemo(() => {
    const size = Math.min(DOT_WINDOW, voices.length);
    const start = Math.min(
      Math.max(voiceIndex - Math.floor(size / 2), 0),
      Math.max(voices.length - size, 0),
    );
    return voices
      .slice(start, start + size)
      .map((option, offset) => ({ option, index: start + offset }));
  }, [voiceIndex, voices]);

  /**
   * The arrows' 175ms opacity dip.
   *
   * From source: `isFading` is set on an arrow-initiated change and cleared by a
   * `setTimeout(…, 175)`, gated on `mode !== 'focused'`. The settings panel *is*
   * focused mode, so upstream's arrows never actually dip — which is why the
   * hover probe recorded no change on them, and why this stays false here. The
   * timer is kept wired so the branch is real rather than dead if a
   * non-focused surface ever mounts this panel.
   */
  const [isFading, setIsFading] = useState(false);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFocusedMode = true;

  useEffect(
    () => () => {
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
    },
    [],
  );

  const step = useCallback(
    (delta: number) => {
      if (voices.length === 0) return;
      const next = (voiceIndex + delta + voices.length) % voices.length;
      onVoiceChange(voices[next].id);
      if (!isFocusedMode) {
        setIsFading(true);
        if (fadeTimer.current) clearTimeout(fadeTimer.current);
        fadeTimer.current = setTimeout(() => setIsFading(false), ARROW_FADE_MS);
      }
    },
    [onVoiceChange, voiceIndex, voices],
  );

  /**
   * The capture is a real `<dialog>` driven by `showModal()`, so this is too.
   *
   * That matters beyond fidelity: `showModal()` puts the panel in the top layer,
   * which is the only way to sit above the orb surface without inventing a
   * z-index — the top layer has none, so there is no number here to get wrong,
   * and Willow's own `z-[49]` / `z-50` stacking is left alone. Escape and the
   * focus trap come from the platform for the same reason.
   *
   * `close()` is deferred to `onExitComplete` because closing hides the element
   * outright, which would cut the 0.22s scale-out short.
   */
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  /**
   * Tracks the element's own `open`, which outlives the `open` prop by one exit.
   *
   * It also decides `flex` vs `hidden`. The UA hides a closed dialog with
   * `dialog:not([open]) { display: none }`, but that is user-agent origin, so an
   * author `display: flex` beats it whatever the specificity — a permanent `flex`
   * would leave the scrim on screen for good. The captured class list ends in
   * `flex`, appended, which is upstream toggling the same way.
   */
  const [isShowing, setIsShowing] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open || dialog.open) return;
    dialog.showModal();
    setIsShowing(true);
  }, [open]);

  const handleExitComplete = useCallback(() => {
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
    setIsShowing(false);
  }, []);

  const transition = useMemo(
    () => ({
      duration: reduceMotion ? PANEL_TRANSITION_DURATION_REDUCED : PANEL_TRANSITION.duration,
      ease: PANEL_TRANSITION.ease,
    }),
    [reduceMotion],
  );

  // Captured: `group/dialog @container inset-0 min-h-full min-w-full
  // cursor-default whitespace-normal items-center justify-center overflow-auto
  // overscroll-y-contain backdrop-blur-[1px] bg-[rgba(0,0,0,0.5)] flex`.
  // The scrim and the 1px blur are on this element, not on `::backdrop`.
  return (
    <dialog
      ref={dialogRef}
      className={`inset-0 min-h-full min-w-full cursor-default items-center justify-center overflow-auto overscroll-y-contain whitespace-normal bg-[rgba(0,0,0,0.5)] backdrop-blur-[1px] ${
        isShowing ? 'flex' : 'hidden'
      }`}
      style={{
        backgroundColor: BACKDROP_BG,
        backdropFilter: `blur(${BACKDROP_BLUR}px)`,
        // Restores the inherited --text-primary the captured markup assumes; see
        // PANEL_TEXT_COLOR. Without it the UA's `color: CanvasText` on <dialog>
        // paints the voice name and the globe glyph black.
        color: PANEL_TEXT_COLOR,
      }}
      onCancel={(event) => {
        // Native Escape would close immediately and skip the scale-out.
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // Not a measured property — the capture is static markup and computed
        // styles, which say nothing about scrim clicks. Kept because a modal
        // `<dialog>` whose scrim swallows clicks is a trap, and the close button
        // and Escape are both captured behaviours pointing the same way.
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <AnimatePresence onExitComplete={handleExitComplete}>
        {open && (
          <motion.div
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: PANEL_SCALE_CLOSED }}
            initial={{ opacity: 0, scale: PANEL_SCALE_CLOSED }}
            transition={transition}
          >
            <div className="willow-vs-shadow-long w-auto overflow-hidden rounded-2xl bg-[#212121] focus:outline-none">
              {/*
                Upstream is `w-[100cqw] … max-w-lg` against the viewport-sized
                dialog container. Willow's v3 build has no container queries, and
                the container here *is* the viewport, so `min(100vw, 32rem)` is
                the same width by a route v3 resolves.
              */}
              <div
                className="flex shrink-0 flex-col overflow-hidden focus:outline-none"
                style={{ width: `min(100vw, ${PANEL_MAX_WIDTH}px)` }}
              >
                <div
                  ref={panelRef}
                  className="relative flex w-full flex-col items-center overflow-y-auto bg-[#212121] p-8 pb-4"
                >
                  <span id={titleId} className="sr-only">
                    Voice settings
                  </span>

                  {/* `class="contents"` — the fieldset groups for a11y without
                      taking part in layout. It measured as a zero-size box. */}
                  <fieldset data-testid="voice-settings-controls" aria-busy="false" className="contents">
                    <button
                      type="button"
                      aria-label="Close voice settings"
                      className="absolute right-5 top-5 flex h-8 w-8 items-center justify-center rounded-lg text-[#cdcdcd] hover:bg-[#414141] focus-visible:bg-[#414141] active:bg-[#414141]"
                      onClick={onClose}
                    >
                      <CloseIcon />
                    </button>

                    <div className="flex w-full flex-col items-center gap-6">
                      <div className="flex h-36 min-h-[144px] w-full items-center justify-center">
                        <div
                          className="flex h-36 min-h-[144px] w-36 min-w-[144px] items-center justify-center"
                          style={{ width: ORB_SLOT_SIZE, height: ORB_SLOT_SIZE }}
                        >
                          <VoiceOrb {...orbProps} animatePresence={false} />
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-center">
                        <div className="relative flex h-20 w-60">
                          <div className="flex w-full flex-col items-center justify-center gap-0">
                            {/* aria-hidden because the radios below carry the
                                name and description for assistive tech. */}
                            <div aria-hidden="true">
                              {/* Upstream renders a motion.div here whose
                                  carousel variants are gated to the immersive
                                  branch; in this compact/focused branch it sits
                                  at its settled values, which is why the capture
                                  reads `opacity: 1; transform: none`. A plain div
                                  computes to exactly that. */}
                              <div className="relative flex w-48 select-none flex-col items-center justify-center">
                                <p className="text-xl font-semibold">{voice.name}</p>
                                <p className="text-sm text-[#cdcdcd]">{voice.description}</p>
                              </div>
                            </div>

                            <div
                              role="radiogroup"
                              aria-required="false"
                              aria-labelledby={titleId}
                              dir="ltr"
                              className="flex h-10 items-center justify-center gap-3"
                              tabIndex={0}
                              style={{ outline: 'none' }}
                            >
                              {windowedVoices.map(({ option, index }) => {
                                const isChecked = index === voiceIndex;
                                const describedBy = `${titleId}-voice-${option.id}`;
                                return (
                                  <button
                                    key={option.id}
                                    type="button"
                                    role="radio"
                                    aria-checked={isChecked}
                                    aria-describedby={describedBy}
                                    aria-label={option.name}
                                    // The row draws a window, so the position and
                                    // the size have to be stated or assistive tech
                                    // would report the window as the whole roster.
                                    aria-posinset={index + 1}
                                    aria-setsize={voices.length}
                                    data-state={isChecked ? 'checked' : 'unchecked'}
                                    value={option.id}
                                    tabIndex={isChecked ? 0 : -1}
                                    className={`h-2 w-2 shrink-0 rounded-full transition-colors ${
                                      isChecked ? 'bg-white' : 'bg-[rgba(175,175,175,0.3)]'
                                    }`}
                                    onClick={() => onVoiceChange(option.id)}
                                  >
                                    <span id={describedBy} className="sr-only">
                                      {option.description}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          <button
                            type="button"
                            aria-label="Previous voice"
                            className={`absolute -left-4 top-1/2 z-50 -translate-y-1/2 transition-opacity duration-[175ms] ${
                              isFading ? 'opacity-20' : 'opacity-100'
                            }`}
                            onClick={() => step(-1)}
                          >
                            <ChevronLeftIcon
                              size={24}
                              className="text-[#ffffff69] hover:text-[#cdcdcd]"
                            />
                          </button>
                          <button
                            type="button"
                            aria-label="Next voice"
                            className={`absolute -right-4 top-1/2 z-50 -translate-y-1/2 transition-opacity duration-[175ms] ${
                              isFading ? 'opacity-20' : 'opacity-100'
                            }`}
                            onClick={() => step(1)}
                          >
                            <ChevronRightIcon
                              size={24}
                              className="text-[#ffffff69] hover:text-[#cdcdcd]"
                            />
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="mt-6 w-full">
                      {/* `border-b last:border-b-0` — the only row today is the
                          last, so nothing is painted. Kept as captured so a
                          second row would draw the #ffffff0d divider. */}
                      <div className="flex min-h-[52px] items-center justify-between gap-4 border-b border-[#ffffff0d] last:border-b-0">
                        <div className="flex min-w-0 items-center gap-3">
                          <GlobeIcon size={SETTINGS_ROW_ICON_SIZE} className="shrink-0" />
                          <span id={`${titleId}-language`} className="truncate text-white">
                            Language
                          </span>
                        </div>
                        <LanguageSelect
                          labelId={`${titleId}-language`}
                          onChange={onLanguageChange}
                          options={provider.languages}
                          value={language.code}
                        />
                      </div>
                    </div>
                  </fieldset>

                  <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </dialog>
  );
};

export default VoiceSettingsDialog;

