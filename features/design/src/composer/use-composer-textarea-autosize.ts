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

          const baseHeight = 24;
          textareaRef.current.style.transition = 'none';
          textareaRef.current.style.overflowY = 'hidden';

          const expandedPaddingLeftVal = '10px';
          const expandedPaddingRightVal = '24px';

          textareaRef.current.style.scrollbarGutter = 'auto';
          textareaRef.current.style.paddingLeft = expandedPaddingLeftVal;
          textareaRef.current.style.paddingRight = expandedPaddingRightVal;
          textareaRef.current.style.height = `${baseHeight}px`;

          setIsSolidExpanded(true);

          const scrollHeight = textareaRef.current.scrollHeight;
          const hasPromptText = promptText.length > 0;
          const nextCanMaximizeComposer = chatVariant
            && hasPromptText
            && scrollHeight >= baseHeight * 3;
          setCanMaximizeComposer(nextCanMaximizeComposer);

          const maxTextareaHeight = 168;

          if (isComposerMaximized) {
            textareaRef.current.style.height = '100%';
            textareaRef.current.style.overflowY = 'auto';
          } else if (hasPromptText && scrollHeight > baseHeight) {
            const newHeight = Math.min(scrollHeight, maxTextareaHeight);
            textareaRef.current.style.height = `${newHeight}px`;
            textareaRef.current.style.overflowY = scrollHeight > maxTextareaHeight ? 'auto' : 'hidden';
          } else {
            textareaRef.current.style.height = `${baseHeight}px`;
            textareaRef.current.style.overflowY = 'hidden';
          }

          textareaRef.current.style.paddingLeft = '';
          textareaRef.current.style.paddingRight = '';
          void textareaRef.current.offsetHeight;
          textareaRef.current.style.transition = '';
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
