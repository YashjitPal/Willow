/**
 * The two layout measurements the chat composer performs against its own
 * rendered DOM. Both effects below are byte-identical to the ones that ran
 * inside `InputBar`, dependency arrays included, and they are called in the
 * same order from the same slot.
 *
 * The refs stay in the component: the JSX attaches them, so they cannot move.
 * Each hook only reads them.
 *
 * Both are `useLayoutEffect` on purpose. They write layout the same frame the
 * flags change, so the reserved padding and the fullscreen centering are never
 * visible in a wrong intermediate position.
 */

import { useLayoutEffect, type Dispatch, type RefObject, type SetStateAction } from 'react';

export interface UseCollapsedChatPaddingRightOptions {
  chatVariant: boolean;
  /** Measuring is pointless once expanded or dictating — the effect bails. */
  solidExpanded: boolean;
  isDictationActive: boolean;
  rightControlsRef: RefObject<HTMLDivElement | null>;
  modelButtonRef: RefObject<HTMLButtonElement | null>;
  micButtonRef: RefObject<HTMLButtonElement | null>;
  /** Re-measure trigger: a longer model/effort label occupies more width. */
  activeModelAndEffortLabel: string;
  setCollapsedChatPaddingRight: Dispatch<SetStateAction<number>>;
}

export const useCollapsedChatPaddingRight = ({
  chatVariant,
  solidExpanded,
  isDictationActive,
  rightControlsRef,
  modelButtonRef,
  micButtonRef,
  activeModelAndEffortLabel,
  setCollapsedChatPaddingRight,
}: UseCollapsedChatPaddingRightOptions): void => {
  // The single-line editor must end before the model pill, regardless of how
  // long the selected model/effort label becomes. Measure the rendered control
  // group instead of relying on the previous fixed 204px reservation.
  useLayoutEffect(() => {
    if (!chatVariant || solidExpanded || isDictationActive) return;

    const controls = rightControlsRef.current;
    const modelButton = modelButtonRef.current;
    const micButton = micButtonRef.current;
    if (!controls || !modelButton || !micButton) return;

    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      const controlsRect = controls.getBoundingClientRect();
      const modelRect = modelButton.getBoundingClientRect();
      const micRect = micButton.getBoundingClientRect();

      const occupiedWidthFromModelPill = controlsRect.right - modelRect.left;
      const modelToMicControlGap = Math.max(0, micRect.left - modelRect.right);
      // Account for the mic glyph's side bearing so this is an optical gap,
      // matching the visible pill-to-mic distance rather than button boxes.
      const opticalGap = Math.max(12, modelToMicControlGap + (micRect.width - 24) / 2);
      const nextPadding = Math.ceil(occupiedWidthFromModelPill + opticalGap);

      setCollapsedChatPaddingRight((current) => current === nextPadding ? current : nextPadding);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(controls);
    observer.observe(modelButton);
    observer.observe(micButton);
    void document.fonts?.ready.then(measure);

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [chatVariant, solidExpanded, isDictationActive, activeModelAndEffortLabel]);
};

export interface UseFullscreenShellCenteringOptions {
  composerShellRef: RefObject<HTMLDivElement | null>;
  chatVariant: boolean;
  isComposerMaximized: boolean;
  showDisclaimer: boolean;
}

export const useFullscreenShellCentering = ({
  composerShellRef,
  chatVariant,
  isComposerMaximized,
  showDisclaimer,
}: UseFullscreenShellCenteringOptions): void => {
  // The empty-state composer intentionally sits slightly above the viewport's
  // vertical center while collapsed. Once fullscreen is opened, Gemini centers
  // the enlarged shell itself instead, leaving equal space above and below it.
  // Translate only that one state so closing fullscreen restores the existing
  // elevated empty-state position and the active-chat footer is unaffected.
  useLayoutEffect(() => {
    const shell = composerShellRef.current;
    if (!shell) return;

    if (!chatVariant || !isComposerMaximized || showDisclaimer) {
      shell.style.translate = '';
      return;
    }

    const centerFullscreenShell = () => {
      // Measure from the shell's unshifted flow position on every pass so a
      // viewport resize cannot compound the previous centering offset.
      shell.style.translate = '0 0';
      const shellRect = shell.getBoundingClientRect();
      const centeredTop = (window.innerHeight - shellRect.height) / 2;
      shell.style.translate = `0 ${Math.round(centeredTop - shellRect.top)}px`;
    };

    centerFullscreenShell();
    window.addEventListener('resize', centerFullscreenShell);

    return () => {
      window.removeEventListener('resize', centerFullscreenShell);
      shell.style.translate = '';
    };
  }, [chatVariant, isComposerMaximized, showDisclaimer]);
};
