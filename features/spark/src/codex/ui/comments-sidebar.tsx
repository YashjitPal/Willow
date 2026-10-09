import clsx from "clsx";
import type { HTMLAttributes, ReactNode, Ref } from "react";

export interface CommentsSidebarLabels {
  sidebar: string;
  heading: ReactNode;
  close: string;
}

export interface CommentsSidebarLayoutProps {
  children?: ReactNode;
  labels: CommentsSidebarLabels;
  /** Fills its container instead of floating as a card. */
  embedded?: boolean;
  controls?: ReactNode;
  closeButton?: ReactNode;
  header?: ReactNode;
  testId?: string;
}

/** Comments sidebar shell (`n` in `PopcornCommentsSidebarLayout`). */
export function CommentsSidebarLayout({ children, labels, embedded = false, controls, closeButton, header, testId }: CommentsSidebarLayoutProps) {
  return (
    <aside
      aria-label={labels.sidebar}
      className={clsx("flex h-full min-h-0 max-w-full shrink-0 flex-col overflow-hidden text-default", embedded ? "w-full" : "w-74 rounded-2xl bg-surface shadow-card ring-1 ring-border ring-inset")}
      data-testid={testId}
    >
      {header ?? (
        <header className="flex h-11 shrink-0 items-center justify-between gap-2 py-1 ps-4 pe-2">
          <h2 className="text-base leading-5 font-medium text-secondary select-none">{labels.heading}</h2>
          <div className="flex items-center gap-2">
            {controls}
            {closeButton}
          </div>
        </header>
      )}
      {children}
    </aside>
  );
}

export interface CommentMessageLayoutProps extends HTMLAttributes<HTMLDivElement> {
  ref?: Ref<HTMLDivElement>;
  avatar: ReactNode;
  header: ReactNode;
  /** Draws the thread line down to the next message. */
  hasConnector?: boolean;
  /** Draws the thread line up to the previous message. */
  hasPrevious?: boolean;
}

/** One message of a comment thread: avatar rail plus header and body (`t` in `PopcornCommentMessageLayout`). */
export function CommentMessageLayout({ avatar, header, children, hasConnector, hasPrevious = false, ...rest }: CommentMessageLayoutProps) {
  return (
    <div {...rest} className="group/message relative flex items-start gap-2.5 ps-4 pe-2 outline-none">
      <div className="relative shrink-0 self-stretch pt-4">
        {hasPrevious && <span aria-hidden className="pointer-events-none absolute start-1/2 top-0 h-2.5 w-px -translate-x-1/2 bg-border-subtle" />}
        {avatar}
        {hasConnector && <span aria-hidden className="pointer-events-none absolute start-1/2 top-11.5 bottom-0 w-px -translate-x-1/2 bg-border-subtle" />}
      </div>
      <div className="flex min-w-0 flex-1 flex-col py-3">
        {header}
        {children}
      </div>
    </div>
  );
}
