import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import {
  Collapsible,
  ShimmerText,
  cn,
  usePrefersReducedMotion,
  type RunStatus,
} from './primitives';

/**
 * The shared shell for every tool call: one line in the transcript.
 *
 * Codex writes its work as plain lines in the narration — "Editing App.tsx" —
 * not as cards. This used to draw a bordered, filled box per call, with a
 * progress stripe, a running timer and a status glyph, which turned three file
 * edits into three competing panels stacked between two paragraphs of prose.
 *
 * What is left is what a reader actually needs: what happened, to what, and
 * whether it is still happening. Detail lives behind the disclosure. The status
 * shows in the verb itself — it shimmers while running — so no separate glyph
 * is needed to say the same thing a second time.
 */
export function ToolCard({
  status,
  icon,
  title,
  runningTitle,
  subject,
  meta,
  body,
  defaultOpen = false,
  followStatus = false,
  error,
  actions,
  className,
}: {
  status: RunStatus;
  icon: React.ReactNode;
  /** Primary label, usually a past-tense verb. */
  title: React.ReactNode;
  /** Used in place of `title` while running. */
  runningTitle?: React.ReactNode;
  /** Secondary label: a path, a query, a package name. */
  subject?: React.ReactNode;
  meta?: React.ReactNode;
  body?: React.ReactNode;
  defaultOpen?: boolean;
  /** Opens while running, closes on success — until the user intervenes. */
  followStatus?: boolean;
  error?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  const running = status === 'running' || status === 'queued';
  const [open, setOpen] = useState(defaultOpen || (followStatus && running));
  const [touched, setTouched] = useState(false);
  const reduced = usePrefersReducedMotion();

  // Follow the run automatically until the user expresses a preference, then
  // never fight them again.
  useEffect(() => {
    if (!followStatus || touched) return;
    if (running) setOpen(true);
    else if (status === 'success') setOpen(false);
  }, [followStatus, touched, running, status]);

  // A failure always surfaces its body; a collapsed error is a dead end.
  useEffect(() => {
    if (status === 'error') setOpen(true);
  }, [status]);

  const heading = running && runningTitle ? runningTitle : title;

  return (
    <motion.div
      layout={reduced ? false : 'position'}
      initial={reduced ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className={cn('group/tool', className)}
    >
      <div className="flex w-full items-center gap-2">
        <button
          type="button"
          onClick={() => {
            if (!body) return;
            setTouched(true);
            setOpen((value) => !value);
          }}
          aria-expanded={body ? open : undefined}
          disabled={!body}
          className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-left disabled:cursor-default"
        >
          {/* The chevron keeps its column whether or not there is a body, so a
              run of rows stays aligned down the left edge. */}
          <span className="flex w-3 shrink-0 justify-center">
            {body && (
              <ChevronRight
                size={12}
                aria-hidden
                className={cn(
                  'text-[hsl(var(--cb-ink-ghost))]',
                  'transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
                  open && 'rotate-90',
                )}
              />
            )}
          </span>

          <span className="shrink-0 text-[hsl(var(--cb-ink-faint))]">{icon}</span>

          {/* The verb never shrinks; the subject absorbs the remaining width. */}
          <span className="shrink-0 text-xs">
            {running ? (
              <ShimmerText className="font-medium">{heading}</ShimmerText>
            ) : (
              <span className="font-medium text-[hsl(var(--cb-ink-muted))]">{heading}</span>
            )}
          </span>

          {subject && (
            <span className="flex min-w-0 flex-1 overflow-hidden text-xs text-[hsl(var(--cb-ink))]">
              {subject}
            </span>
          )}

          {meta && (
            <span className="shrink-0 text-[11px] text-[hsl(var(--cb-ink-ghost))]">{meta}</span>
          )}
        </button>

        {actions && (
          <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/tool:opacity-100">
            {actions}
          </span>
        )}
      </div>

      {/* Detail is indented under the row it belongs to, held by a hairline
          rather than boxed — the line is enough to show what it hangs off. */}
      {body && (
        <Collapsible open={open}>
          <div className="ml-[9px] border-l border-[hsl(var(--cb-line))] pl-3 pt-1">{body}</div>
        </Collapsible>
      )}

      {error && (
        <p className="ml-[9px] border-l border-[hsl(var(--cb-negative)/0.4)] pl-3 pt-1 text-[11px] text-[hsl(var(--cb-negative))]">
          {error}
        </p>
      )}
    </motion.div>
  );
}

/**
 * A path rendered filename-first.
 *
 * Written `dir/file`, the filename is what gets clipped when space runs out —
 * removing the only part that identifies the file. Leading with the name and
 * letting the directory truncate keeps the row scannable at any width.
 */
export function PathLabel({ path }: { path: string }) {
  const parts = path.split('/');
  const name = parts.pop() ?? path;
  const dir = parts.join('/');

  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <span className="flex-none font-mono text-[hsl(var(--cb-ink))]">{name}</span>
      {dir && dir !== '' && (
        <span className="min-w-0 flex-1 truncate font-mono text-[hsl(var(--cb-ink-ghost))]">{dir}</span>
      )}
    </span>
  );
}
