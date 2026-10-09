// A prompt sent to the agent. Past four lines it folds behind a chevron, as a user bubble does in
// Chat (`@willow/chat/UserMessageBubble`): the same measure, toggle and 300ms ease, in Chat's
// typeface, sized for the sidebar.

import React, { useLayoutEffect, useRef, useState } from 'react';
import { FileText, Film } from 'lucide-react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import type { AgentAttachment } from './agent-session';

/** Four lines at the bubble's 24px line height. */
const COLLAPSED_HEIGHT = 4 * 24;
/** Room kept below expanded text so the toggle never overlaps the last line. */
const EXPANDED_CONTROL_RESERVE = 24;
const EASE = 'cubic-bezier(0.2, 0, 0, 1)';

export function AgentUserBubble({ content, attachments }: { content: string; attachments?: AgentAttachment[] }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [naturalHeight, setNaturalHeight] = useState(0);
  const [expanded, setExpanded] = useState(false);

  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element) return;
    const measure = () => {
      const next = Math.ceil(element.getBoundingClientRect().height);
      setNaturalHeight((current) => (current === next ? current : next));
      if (next <= COLLAPSED_HEIGHT) setExpanded(false);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [content]);

  const canToggle = naturalHeight > COLLAPSED_HEIGHT;
  const visibleHeight = canToggle
    ? (expanded ? naturalHeight + EXPANDED_CONTROL_RESERVE : COLLAPSED_HEIGHT)
    : (naturalHeight || undefined);

  return (
    <div className="agent-user-bubble relative min-w-0 max-w-[85%] rounded-[24px] border border-white/[0.04] bg-[#2b2c2e] px-5 py-3 text-[#f4f4f5]">
      {attachments && attachments.length > 0 && (
        <div className={`flex gap-1.5 flex-wrap ${content ? 'mb-2' : ''}`}>
          {attachments.map((att, index) => (
            <div key={index} className="w-10 h-10 rounded-lg overflow-hidden border border-white/10 bg-[#1c1c1e] flex items-center justify-center" title={att.name}>
              {att.thumb ? (
                <img src={att.thumb} alt={att.name || 'attached'} className="w-full h-full object-cover" />
              ) : att.mimeType.startsWith('video/') ? (
                <Film size={16} className="text-zinc-400" />
              ) : (
                <FileText size={16} className="text-zinc-400" />
              )}
            </div>
          ))}
        </div>
      )}

      {content && (
        <div
          className="overflow-hidden"
          style={{
            maxHeight: visibleHeight,
            paddingBottom: canToggle && expanded ? EXPANDED_CONTROL_RESERVE : 0,
            transition: `max-height 300ms ${EASE}, padding-bottom 300ms ${EASE}`,
          }}
        >
          <div
            ref={contentRef}
            className="text-[17px] font-normal leading-6 font-['Google_Sans_Flex','Google_Sans','Helvetica_Neue',sans-serif] whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
            style={{ fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 92, "wght" 400' }}
          >
            {content}
          </div>
        </div>
      )}

      {canToggle && (
        <div className="pointer-events-none absolute bottom-3 right-4 h-6 w-10">
          {!expanded && (
            <div
              aria-hidden="true"
              className="absolute right-0 top-1/2 z-10 h-[22px] w-[92px] -translate-y-1/2 bg-[linear-gradient(to_right,transparent,#2b2c2e_56px,#2b2c2e_100%)]"
            />
          )}
          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            className="pointer-events-auto absolute right-0 top-1/2 z-20 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-transparent p-2 text-[#c4c7c5] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
            aria-label={expanded ? 'Collapse' : 'Expand'}
            aria-expanded={expanded}
            title={expanded ? 'Collapse text' : 'Expand text'}
          >
            <span className="flex h-[22px] w-8 shrink-0 items-center justify-center rounded-[22px] bg-[#38393c]">
              <MaterialSymbol
                family="luminous"
                name={expanded ? 'expand_less' : 'expand_more'}
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
}
