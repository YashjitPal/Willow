import { motion } from "framer-motion";
import { useCallback, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { useReducedMotion } from "../lib/theme-engine";
import { Tooltip } from "./tooltip";

export interface FacepilePerson {
  id: string;
  name: string;
  avatar: ReactNode;
}

export interface FacepileProps {
  people: FacepilePerson[];
  interactive?: boolean;
  /** Which avatar sits on top of the stack. */
  front?: "first" | "last";
}

const maxVisible = 4;
const fadeEase = [0.23, 1, 0.32, 1] as const;

/**
 * Collaborator facepile (`facepile` chunk): up to four overlapping avatars that collapse to fit the width, with a
 * `+N` button whose rich tooltip lists everyone hidden.
 */
export function Facepile({ people, interactive = true, front = "first" }: FacepileProps) {
  const intl = useIntl();
  const reduceMotion = useReducedMotion();
  const candidates = people.slice(0, maxVisible);
  const [visibleCount, setVisibleCount] = useState(candidates.length);
  const [openReason, setOpenReason] = useState<"hover" | "click" | null>(null);
  const hiddenCount = people.length - Math.min(visibleCount, candidates.length);

  const measure = useCallback(
    (container: HTMLSpanElement | null) => {
      const stack = container?.firstElementChild;
      const overflow = container?.lastElementChild;
      if (container == null || !(stack instanceof HTMLElement) || !(overflow instanceof HTMLElement)) return;
      overflow.style.minWidth = "";
      let overflowWidth = 0;
      const layout = () => {
        overflowWidth = Math.max(overflowWidth, overflow.offsetWidth);
        overflow.style.minWidth = `${overflowWidth}px`;
        const overlap = overflowWidth - Number.parseFloat(getComputedStyle(overflow).paddingInlineStart);
        stack.style.paddingInlineEnd = people.length > candidates.length ? `${overlap}px` : "";
        const fitsAll = people.length === candidates.length && stack.clientWidth <= container.clientWidth;
        const available = fitsAll ? container.clientWidth : container.clientWidth - overlap;
        const rtl = getComputedStyle(container).direction === "rtl";
        let count = 0;
        let end = 0;
        for (const avatar of stack.querySelectorAll("[data-page-facepile-avatar]")) {
          if (!(avatar instanceof HTMLElement)) continue;
          const edge = rtl ? stack.clientWidth - avatar.offsetLeft : avatar.offsetLeft + avatar.offsetWidth;
          if (fitsAll || edge <= available) {
            count += 1;
            end = edge;
          }
        }
        overflow.style.insetInlineStart = `${Math.max(0, end - Number.parseFloat(getComputedStyle(overflow).paddingInlineStart))}px`;
        setVisibleCount(count);
      };
      const observer = new ResizeObserver(layout);
      observer.observe(container);
      observer.observe(stack);
      observer.observe(overflow);
      layout();
      return () => observer.disconnect();
    },
    [candidates.length, people.length],
  );

  return (
    <span ref={measure} className="relative inline-flex max-w-32 min-w-0 items-center overflow-hidden select-none" data-page-facepile>
      <span className="pointer-events-none relative isolate z-10 flex shrink-0 items-center -space-x-2">
        {candidates.map((person, index) => (
          <motion.span
            key={person.id}
            className="pointer-events-auto relative inline-flex shrink-0"
            data-page-facepile-avatar
            initial={{ opacity: reduceMotion ? 1 : 0.9 }}
            animate={index === 0 ? "first" : "rest"}
            variants={{ first: { opacity: reduceMotion ? 1 : [0.9, 1] }, rest: { opacity: 1 } }}
            transition={{ type: "tween", duration: reduceMotion ? 0 : 150 / 1000, ease: fadeEase }}
            style={{ visibility: index < visibleCount ? undefined : "hidden", zIndex: front === "first" ? candidates.length - index : index }}
            aria-hidden={index >= visibleCount || undefined}
            inert={index >= visibleCount}
          >
            {person.avatar}
          </motion.span>
        ))}
      </span>
      <Tooltip
        className="pointer-events-auto absolute z-0 inline-flex h-7 min-w-7 cursor-interaction items-center justify-center rounded-full border border-default bg-surface ps-1.5 pe-1 text-xs text-secondary"
        triggerAsChild={!interactive}
        open={hiddenCount > 0 && openReason != null}
        onOpenChange={(open) => setOpenReason(open ? "hover" : null)}
        onClick={
          interactive
            ? (event: MouseEvent<HTMLElement>) => {
                event.stopPropagation();
                setOpenReason((reason) => (reason === "click" ? null : "click"));
              }
            : undefined
        }
        onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
          if (interactive && (event.key === "Enter" || event.key === " ")) event.stopPropagation();
        }}
        interactive={interactive}
        variant="rich"
        side="bottom"
        align="end"
        aria-label={intl.formatMessage(
          {
            id: "collaboratorFacepile.morePeople",
            defaultMessage: "{count, plural, one {# more person} other {# more people}}",
            description: "Accessible label for the collaborator facepile overflow button, which shows the remaining people's names",
          },
          { count: hiddenCount },
        )}
        tooltipContent={
          <div className="flex max-h-64 flex-col gap-2 overflow-y-auto p-2">
            {people.slice(visibleCount).map((person) => (
              <div key={person.id} className="flex items-center gap-2">
                {person.avatar}
                <span className="text-sm text-default">{person.name}</span>
              </div>
            ))}
          </div>
        }
        style={{ visibility: hiddenCount > 0 ? undefined : "hidden" }}
        aria-hidden={hiddenCount === 0 || undefined}
        tabIndex={interactive && hiddenCount > 0 ? 0 : -1}
      >
        <span>
          <FormattedMessage
            id="collaboratorFacepile.overflow"
            defaultMessage="+{count}"
            description="Compact number of additional people with access beyond the visible avatars in a shared file header; count is the number of people not shown"
            values={{ count: hiddenCount || people.length }}
          />
        </span>
      </Tooltip>
    </span>
  );
}
