import {
  Children,
  createContext,
  use,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { cn } from "../../lib/utils";

const GroupedRows = createContext(false);

/*
 * An entry opens and closes as Willow's code panel does (platform/ui CodeExecutionPanel): the box
 * grows over 340ms while its content fades and settles 6px into place from 60ms in; closing fades
 * the content first, then shuts the box behind it. Nothing moves on first paint, so an entry the
 * timeline restores or remounts open is simply open.
 */
const EXPAND_HEIGHT_MS = 340;
const EXPAND_FADE_MS = 280;
const EXPAND_FADE_DELAY_MS = 60;
const COLLAPSE_HEIGHT_MS = 260;
const COLLAPSE_HEIGHT_DELAY_MS = 40;
const COLLAPSE_FADE_MS = 160;
const EASE_OUT = "cubic-bezier(0.2, 0, 0, 1)";
const EASE_IN = "cubic-bezier(0.4, 0, 1, 1)";

const animatesReveals = (element: HTMLElement | null): element is HTMLElement =>
  element !== null &&
  typeof element.animate === "function" &&
  !(
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

function WorkLogReveal({ children }: { children: ReactNode }) {
  const open = Children.toArray(children).length > 0;
  const [wasOpen, setWasOpen] = useState(open);
  const [leaving, setLeaving] = useState<ReactNode>(null);
  const lastOpenChildren = useRef<ReactNode>(open ? children : null);
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const running = useRef<Animation[]>([]);
  const mounted = useRef(false);

  if (open !== wasOpen) {
    setWasOpen(open);
    setLeaving(open ? null : lastOpenChildren.current);
  }

  useLayoutEffect(() => {
    if (open) lastOpenChildren.current = children;
  });

  useLayoutEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    for (const animation of running.current) animation.cancel();
    running.current = [];
    const box = boxRef.current;
    const content = contentRef.current;
    if (!animatesReveals(box) || !content) {
      if (!open) setLeaving(null);
      return;
    }
    const clipped = { overflow: "hidden" };
    if (open) {
      const height = box.offsetHeight;
      running.current = [
        box.animate(
          [
            { ...clipped, height: "0px" },
            { ...clipped, height: `${height}px` },
          ],
          { duration: EXPAND_HEIGHT_MS, easing: EASE_OUT },
        ),
        content.animate(
          [
            { opacity: 0, transform: "translateY(-6px)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: EXPAND_FADE_MS, delay: EXPAND_FADE_DELAY_MS, easing: EASE_OUT, fill: "backwards" },
        ),
      ];
      return;
    }
    const height = box.offsetHeight;
    const fade = content.animate(
      [
        { opacity: 1, transform: "none" },
        { opacity: 0, transform: "translateY(-4px)" },
      ],
      { duration: COLLAPSE_FADE_MS, easing: EASE_IN, fill: "forwards" },
    );
    const shut = box.animate(
      [
        { ...clipped, height: `${height}px` },
        { ...clipped, height: "0px" },
      ],
      { duration: COLLAPSE_HEIGHT_MS, delay: COLLAPSE_HEIGHT_DELAY_MS, easing: EASE_IN, fill: "forwards" },
    );
    running.current = [fade, shut];
    Promise.all([fade.finished, shut.finished]).then(
      () => setLeaving(null),
      () => undefined,
    );
  }, [open]);

  const shown = open ? children : leaving;
  if (Children.toArray(shown).length === 0) return null;
  return (
    <div ref={boxRef} data-willow-activity-reveal="">
      <div ref={contentRef}>{shown}</div>
    </div>
  );
}

/**
 * Groups may span virtualized timeline items. Each part owns its trailing space: Codex's 16px
 * between one piece of the timeline and the next (--conversation-item-gap), none between a
 * group's header and its rows.
 */
export function WorkLogBlock({
  layout = "standalone",
  children,
}: {
  layout?: "standalone" | "group-header" | "group-content";
  continues?: boolean | undefined;
  children: ReactNode;
}) {
  return <div className={layout === "group-header" ? "pb-0" : "pb-4"}>{children}</div>;
}

/** Expanded members align with the header and use the same compact row geometry. */
export function WorkLogList({ children }: { children: ReactNode }) {
  return (
    <GroupedRows value>
      <div className="flex min-w-0 flex-col">{children}</div>
    </GroupedRows>
  );
}

type RowContent = {
  icon?: ReactNode;
  label: ReactNode;
  trailing?: ReactNode;
  wrapLabel?: boolean;
};

function WorkLogLine({ icon, label, trailing, wrapLabel }: RowContent) {
  return (
    <div
      data-willow-activity-line=""
      className="flex min-h-6 min-w-0 items-center gap-1.5 text-sm leading-relaxed select-none [&_*]:select-none"
    >
      {icon ? (
        <span
          data-willow-activity-icon=""
          className="relative flex size-6 shrink-0 items-center justify-center"
        >
          {icon}
        </span>
      ) : null}
      <div
        data-willow-activity-label=""
        className={cn(
          "min-w-0 flex-1 text-secondary-label",
          !wrapLabel && "truncate [&_*]:whitespace-nowrap",
        )}
      >
        {label}
      </div>
      {trailing}
    </div>
  );
}

const interactionClassName =
  "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70";

function useRowProps(interactive: boolean) {
  const grouped = use(GroupedRows);
  return {
    className: cn(
      "group/timeline-row relative w-full min-w-0 rounded-md px-0.5 text-left transition-colors",
      grouped ? "py-0" : "py-0.5",
      interactive && interactionClassName,
    ),
    "data-willow-activity-row": grouped ? "nested" : "",
  };
}

// No className/style escape hatch: consumers supply content and behavior, not geometry.
export function WorkLogButton({
  icon,
  label,
  trailing,
  wrapLabel = false,
  ...buttonProps
}: RowContent & Omit<ComponentProps<"button">, "className" | "style" | "children">) {
  const rowProps = useRowProps(true);
  return (
    <button {...buttonProps} type="button" {...rowProps}>
      <WorkLogLine icon={icon} label={label} trailing={trailing} wrapLabel={wrapLabel} />
    </button>
  );
}

/** Div-based disclosure supports selectable detail and nested actions in an entry. */
export function WorkLogRow({
  icon,
  label,
  trailing,
  wrapLabel = false,
  children,
  ...rowProps
}: RowContent & Omit<ComponentProps<"div">, "className" | "style">) {
  const ownProps = useRowProps(rowProps.onClick !== undefined);
  return (
    <div {...rowProps} {...ownProps}>
      <WorkLogLine icon={icon} label={label} trailing={trailing} wrapLabel={wrapLabel} />
      <WorkLogReveal>{children}</WorkLogReveal>
    </div>
  );
}

export function WorkLogDetails({
  children,
  kind = "text",
}: {
  children: ReactNode;
  kind?: "text" | "panel" | "media";
}) {
  return (
    <div
      data-willow-activity-details={kind}
      className={cn(
        "cursor-auto",
        kind === "text"
          ? "ms-7 flex max-h-96 flex-col gap-3 overflow-auto px-0.5 py-1 select-text"
          : kind === "panel"
            ? "mt-0.5 mb-1.5"
            : "mt-1",
      )}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}
