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

import { useEffect, useRef, type RefObject } from 'react';
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
  const textareaResizeRafRef = useRef<number | null>(null);

  // Auto-expand textarea - throttled with RAF to prevent lag
  useEffect(() => {
    if (textareaRef.current) {
      // Cancel any pending resize to avoid stacking
      if (textareaResizeRafRef.current) {
        cancelAnimationFrame(textareaResizeRafRef.current);
      }

      // Throttle resize to once per frame
      textareaResizeRafRef.current = requestAnimationFrame(() => {
        if (textareaRef.current) {
          if (isDictationActive) {
            textareaRef.current.style.transition = 'none';
            textareaRef.current.style.height = '24px';
            textareaRef.current.style.overflowY = 'hidden';
            textareaRef.current.style.scrollbarGutter = 'stable';
            setIsSolidExpanded(false);
            setCanMaximizeComposer(false);
            textareaResizeRafRef.current = null;
            return;
          }

          const isSolid = chatVariant || effectiveBackground === 'solid';
          const baseHeight = isSolid ? 24 : 48;
          
          if (isSolid) {
            // Disable padding transition during measurement so scrollHeight reads are exact
            textareaRef.current.style.transition = 'none';
            // Never let the temporary one-row measurement create a scrollbar.
            // A scrollbar narrows the editor, which can make scrollHeight report
            // one more wrapped line than the final, scrollbar-free textarea uses.
            textareaRef.current.style.overflowY = 'hidden';

            // Must match the collapsed `pl-` class on the textarea exactly, per
            // variant — the chat one is 46px to align with the dictation
            // waveform's `left-[46px]`. Measuring 6px wider than the box really
            // is hides a genuine wrap: `shouldExpand` stays false, the editor
            // stays one row with `overflowY: hidden`, and the wrapped line is
            // clipped until the next keystroke pushes past the gap.
            const collapsedPaddingLeftVal = chatVariant ? '46px' : '40px';
            const collapsedPaddingRightVal = chatVariant ? `${collapsedChatPaddingRight}px` : '76px';
            // Gemini's multiline editor begins 24px inside the prompt shell.
            // Willow's shell already contributes 14px left / 15px right, so
            // only the remaining inset belongs on the expanded textarea.
            const expandedPaddingLeftVal = chatVariant ? '10px' : '0px';
            // Gemini permanently reserves the same compact right-side inset,
            // including before its fullscreen control becomes visible. This
            // prevents the editor width (and therefore wrapping) from jumping
            // when the third line reveals the control.
            const expandedPaddingRightVal = chatVariant ? '24px' : '0px';
            // Force narrow padding for measurement to see if it wraps inline
            textareaRef.current.style.scrollbarGutter = 'stable';
            textareaRef.current.style.paddingLeft = collapsedPaddingLeftVal;
            textareaRef.current.style.paddingRight = collapsedPaddingRightVal;
            textareaRef.current.style.height = `${baseHeight}px`;
            
            const hypotheticalScrollHeight = textareaRef.current.scrollHeight;
            // `scrollHeight` includes wrapped placeholder text. During Spark's
            // task-detail entrance the left pane changes width, so an empty
            // "Describe a task" placeholder can briefly wrap and otherwise
            // leave the composer stuck in its multiline state after it widens.
            const hasPromptText = promptText.length > 0;
            // An attachment expands the box for the same reason a tool chip does.
            // Gemini's composer puts the editor on its own grid row and the controls on
            // the row below whenever anything is attached — its `text-input` and
            // `leading-actions`/`trailing-actions` areas are separate rows, measured
            // 112px / 40px / 38px with 8px row gaps against a 12px padding. Willow already
            // had that two-row arrangement; it simply was not reachable from an attachment.
            const shouldExpand = (chatVariant && isComposerMaximized)
              || (hasPromptText && hypotheticalScrollHeight > baseHeight)
              || !!selectedTool
              || hasAttachments;
            
            setIsSolidExpanded(shouldExpand);
            textareaRef.current.style.scrollbarGutter = shouldExpand ? 'auto' : 'stable';
            
            // To prevent height glitch before React re-renders, 
            // force the target padding before calculating final height
            textareaRef.current.style.paddingLeft = shouldExpand
              ? expandedPaddingLeftVal
              : collapsedPaddingLeftVal;
            textareaRef.current.style.paddingRight = shouldExpand
              ? expandedPaddingRightVal
              : collapsedPaddingRightVal;

            textareaRef.current.style.height = `${baseHeight}px`;
            const naturalExpandedScrollHeight = textareaRef.current.scrollHeight;
            const nextCanMaximizeComposer = chatVariant
              && hasPromptText
              && shouldExpand
              && naturalExpandedScrollHeight >= baseHeight * 3;
            setCanMaximizeComposer(nextCanMaximizeComposer);

            textareaRef.current.style.paddingRight = shouldExpand
              ? expandedPaddingRightVal
              : collapsedPaddingRightVal;
            textareaRef.current.style.height = `${baseHeight}px`;
            const scrollHeight = textareaRef.current.scrollHeight;
            const maxTextareaHeight = chatVariant ? 168 : 300;

            if (chatVariant && isComposerMaximized) {
              textareaRef.current.style.height = '100%';
              textareaRef.current.style.overflowY = 'auto';
            } else if (hasPromptText && scrollHeight > baseHeight) {
              const newHeight = Math.min(scrollHeight, maxTextareaHeight);
              textareaRef.current.style.height = `${newHeight}px`;
              textareaRef.current.style.overflowY = scrollHeight > maxTextareaHeight ? 'auto' : 'hidden';
            } else {
              textareaRef.current.style.overflowY = 'hidden';
            }
            
            // Clean up inline styles so Tailwind classes take over smoothly
            textareaRef.current.style.paddingLeft = '';
            textareaRef.current.style.paddingRight = '';
            // Re-enable transition (reflow first so the class padding is the "from"
            // frame). Effectively a no-op in the chat variant, which carries no
            // size transition to restore — see the header.
            void textareaRef.current.offsetHeight;
            textareaRef.current.style.transition = '';
          } else {
            textareaRef.current.style.height = `${baseHeight}px`;
            const scrollHeight = textareaRef.current.scrollHeight;
            if (scrollHeight > baseHeight) {
              const newHeight = Math.min(scrollHeight, 300);
              textareaRef.current.style.height = `${newHeight}px`;
            }
          }
        }
        textareaResizeRafRef.current = null;
      });
    }

    return () => {
      if (textareaResizeRafRef.current) {
        cancelAnimationFrame(textareaResizeRafRef.current);
      }
    };
  }, [promptText, selectedTool, hasAttachments, chatVariant, effectiveBackground, isComposerMaximized, collapsedChatPaddingRight, isDictationActive]);
};
