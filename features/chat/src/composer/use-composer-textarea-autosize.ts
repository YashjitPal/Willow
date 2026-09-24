/**
 * Sizes the composer textarea, and reports back the two flags the surrounding
 * layout derives from that measurement.
 *
 * The effect below is byte-identical to the one that ran inside `InputBar`,
 * dependency array included. Only the `useRef` holding the pending frame moved
 * in with it — nothing outside the effect ever read that ref.
 *
 * Why the measurement is this convoluted, so nobody "simplifies" it:
 *
 *  - Height is first measured under FORCED collapsed padding, then the target
 *    padding is written before the final height read. Measuring at the wrong
 *    padding reports a different wrap point and the editor jumps a line.
 *  - `overflowY` is pinned to hidden for the measurement: a scrollbar narrows
 *    the editor, which can make `scrollHeight` claim one more wrapped line than
 *    the final, scrollbar-free textarea actually needs.
 *  - `transition` is disabled for the whole measurement and restored only after
 *    a forced reflow (`void offsetHeight`), so the Tailwind padding class — not
 *    the inline padding this effect writes — is the "from" frame. That only has
 *    anything left to animate in the NON-chat solid composer. The chat variant
 *    has no size transition at all, because Gemini's composer has none: every
 *    element in its size chain computes to `transition-duration: 0s`, so its box
 *    snaps on wrap, unwrap, send and paste. Disabling is still load-bearing
 *    wherever a transition does exist — a live padding transition would make the
 *    `scrollHeight` reads land mid-animation and report the wrong wrap point.
 *  - Everything is throttled into a single `requestAnimationFrame`, and the
 *    cleanup cancels a pending frame, so fast typing cannot stack measurements.
 *
 * Base row height is 24px in the chat/solid composer and 48px otherwise; the
 * ceiling is 168px in chat and 300px elsewhere. Fullscreen chat opts out of the
 * height maths entirely and uses 100% with its own scroll.
 */

import { useLayoutEffect, type RefObject } from 'react';
import type { BackgroundType } from '@willow/studio/shell/BackgroundContext';
import type { ToolId } from './composer-options';

export interface UseComposerTextareaAutosizeOptions {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** Re-measure triggers, in the effect's original dependency order. */
  promptText: string;
  selectedTool: ToolId | null;
  /** Attachments expand the box exactly as a tool chip does — see `shouldExpand`. */
  hasAttachments: boolean;
  chatVariant: boolean;
  effectiveBackground: BackgroundType;
  isComposerMaximized: boolean;
  /** Right-side reservation for the collapsed chat editor, in px. */
  collapsedChatPaddingRight: number;
  /** While dictating the editor is pinned to one row and both flags clear. */
  isDictationActive: boolean;
  /** Set once the content wraps past one row (or a tool chip forces it). */
  setIsSolidExpanded: (value: boolean) => void;
  /** Set once the chat editor reaches three rows, which is what reveals the
   *  fullscreen control. */
  setCanMaximizeComposer: (value: boolean) => void;
}

export const useComposerTextareaAutosize = ({
  textareaRef,
  promptText,
  selectedTool,
  hasAttachments,
  chatVariant,
  effectiveBackground,
  isComposerMaximized,
  collapsedChatPaddingRight,
  isDictationActive,
  setIsSolidExpanded,
  setCanMaximizeComposer,
}: UseComposerTextareaAutosizeOptions): void => {
  // Synchronous layout effect - eliminates the 1-frame RAF lag and visual jerk on newlines
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    if (isDictationActive) {
      textarea.style.transition = 'none';
      textarea.style.height = '24px';
      textarea.style.overflowY = 'hidden';
      textarea.style.scrollbarGutter = 'stable';
      setIsSolidExpanded(false);
      setCanMaximizeComposer(false);
      return;
    }

    const isSolid = chatVariant || effectiveBackground === 'solid';
    const baseHeight = isSolid ? 24 : 48;

    if (isSolid) {
      textarea.style.transition = 'none';
      textarea.style.overflowY = 'hidden';

      const collapsedPaddingLeftVal = chatVariant ? '46px' : '40px';
      const collapsedPaddingRightVal = chatVariant ? `${collapsedChatPaddingRight}px` : '76px';
      const expandedPaddingLeftVal = chatVariant ? '10px' : '0px';
      const expandedPaddingRightVal = chatVariant ? '24px' : '0px';

      // Force narrow padding for measurement to see if it wraps inline
      textarea.style.scrollbarGutter = 'stable';
      textarea.style.paddingLeft = collapsedPaddingLeftVal;
      textarea.style.paddingRight = collapsedPaddingRightVal;
      textarea.style.height = `${baseHeight}px`;

      const hypotheticalScrollHeight = textarea.scrollHeight;
      const hasPromptText = promptText.length > 0;
      const hasNewline = promptText.includes('\n');

      const shouldExpand = (chatVariant && isComposerMaximized)
        || hasNewline
        || (hasPromptText && hypotheticalScrollHeight > baseHeight)
        || !!selectedTool
        || hasAttachments;

      setIsSolidExpanded(shouldExpand);
      textarea.style.scrollbarGutter = shouldExpand ? 'auto' : 'stable';

      textarea.style.paddingLeft = shouldExpand
        ? expandedPaddingLeftVal
        : collapsedPaddingLeftVal;
      textarea.style.paddingRight = shouldExpand
        ? expandedPaddingRightVal
        : collapsedPaddingRightVal;

      textarea.style.height = `${baseHeight}px`;
      const naturalExpandedScrollHeight = textarea.scrollHeight;

      const nextCanMaximizeComposer = chatVariant
        && hasPromptText
        && shouldExpand
        && naturalExpandedScrollHeight >= baseHeight * 3;
      setCanMaximizeComposer(nextCanMaximizeComposer);

      textarea.style.paddingRight = shouldExpand
        ? expandedPaddingRightVal
        : collapsedPaddingRightVal;
      textarea.style.height = `${baseHeight}px`;
      const scrollHeight = textarea.scrollHeight;
      const maxTextareaHeight = chatVariant ? 168 : 300;

      if (chatVariant && isComposerMaximized) {
        textarea.style.height = '100%';
        textarea.style.overflowY = 'auto';
      } else if (hasPromptText && scrollHeight > baseHeight) {
        const newHeight = Math.min(scrollHeight, maxTextareaHeight);
        textarea.style.height = `${newHeight}px`;
        textarea.style.overflowY = scrollHeight > maxTextareaHeight ? 'auto' : 'hidden';
      } else {
        textarea.style.height = `${baseHeight}px`;
        textarea.style.overflowY = 'hidden';
      }

      textarea.style.paddingLeft = '';
      textarea.style.paddingRight = '';
      void textarea.offsetHeight;
      textarea.style.transition = '';
    } else {
      textarea.style.height = `${baseHeight}px`;
      const scrollHeight = textarea.scrollHeight;
      if (scrollHeight > baseHeight) {
        const newHeight = Math.min(scrollHeight, 300);
        textarea.style.height = `${newHeight}px`;
      }
    }
  }, [promptText, selectedTool, hasAttachments, chatVariant, effectiveBackground, isComposerMaximized, collapsedChatPaddingRight, isDictationActive]);
};
