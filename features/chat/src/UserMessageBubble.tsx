// One user turn's text bubble, with the collapse/expand control that appears
// once the text is taller than four lines.
//
// Split out of `ChatView.tsx`. Self-contained: it measures and stores its own
// height, and the two callbacks exist only because collapsing changes the
// thread's scroll height — ChatView pins the scroll position across the
// max-height transition, which is why `onToggleEnd` fires from
// `onTransitionEnd` rather than from the click.

import React, { useLayoutEffect, useRef, useState } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { ChatMsg } from './chat-message';

/** Four lines at the bubble's 24px line-height. */
const USER_MESSAGE_COLLAPSED_HEIGHT = 4 * 24;
/** Room kept below expanded text so the toggle never overlaps the last line. */
const USER_MESSAGE_EXPANDED_CONTROL_RESERVE = 24;

export const UserMessageBubble: React.FC<Pick<ChatMsg, 'content' | 'isTranscribing'> & {
  onToggleStart?: (willExpand: boolean) => void;
  onToggleEnd?: () => void;
}> = ({
  content,
  isTranscribing,
  onToggleStart,
  onToggleEnd,
}) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [naturalHeight, setNaturalHeight] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);

  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element) return;

    const measure = () => {
      const nextHeight = Math.ceil(element.getBoundingClientRect().height);
      setNaturalHeight((currentHeight) => (
        currentHeight === nextHeight ? currentHeight : nextHeight
      ));
      if (nextHeight <= USER_MESSAGE_COLLAPSED_HEIGHT) {
        setIsExpanded(false);
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [content]);

  const canToggle = !isTranscribing && naturalHeight > USER_MESSAGE_COLLAPSED_HEIGHT;
  const expandedControlReserve = canToggle && isExpanded
    ? USER_MESSAGE_EXPANDED_CONTROL_RESERVE
    : 0;
  const visibleHeight = canToggle
    ? (isExpanded
      ? naturalHeight + USER_MESSAGE_EXPANDED_CONTROL_RESERVE
      : USER_MESSAGE_COLLAPSED_HEIGHT)
    : (naturalHeight || undefined);
  const toggleLabel = isExpanded ? 'Collapse text' : 'Expand text';

  return (
    <div
      className="relative min-w-0 max-w-[508px] overflow-visible rounded-[40px] bg-[#171717] px-7 py-5 text-[17px] font-normal leading-6 text-[#e3e3e3] font-['Google_Sans_Flex','Google_Sans','Helvetica_Neue',sans-serif] whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
      style={{ fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 92, "wght" 400' }}
    >
      <div
        className="overflow-hidden"
        style={{
          maxHeight: visibleHeight,
          paddingBottom: expandedControlReserve,
          transition: 'max-height 300ms cubic-bezier(0.2, 0, 0, 1), padding-bottom 300ms cubic-bezier(0.2, 0, 0, 1)',
        }}
        onTransitionEnd={(event) => {
          if (event.propertyName === 'max-height') onToggleEnd?.();
        }}
      >
        <div ref={contentRef}>
          {isTranscribing && !content ? (
            <span className="select-none italic text-gray-500">Transcribing…</span>
          ) : (
            content
          )}
        </div>
      </div>

      {canToggle && (
        <div className="pointer-events-none absolute bottom-5 right-5 h-6 w-10">
          {!isExpanded && (
            <div
              aria-hidden="true"
              className="absolute right-0 top-1/2 z-10 h-[22px] w-[92px] -translate-y-1/2 bg-[linear-gradient(to_right,transparent,#171717_56px,#171717_100%)]"
            />
          )}
          <button
            type="button"
            onClick={() => {
              onToggleStart?.(!isExpanded);
              setIsExpanded((expanded) => !expanded);
            }}
            className="pointer-events-auto absolute right-0 top-1/2 z-20 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-transparent p-2 text-[#c4c7c5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
            aria-expanded={isExpanded}
            title={toggleLabel}
          >
            <span className="flex h-[22px] w-8 shrink-0 items-center justify-center rounded-[22px] bg-[#1e1f20]">
              <MaterialSymbol
                family="luminous"
                name={isExpanded ? 'expand_less' : 'expand_more'}
                size={20}
                weight={320}
                roundness={100}
                opticalSize={20}
              />
            </span>
          </button>
        </div>
      )}
    </div>
  );
};
