import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import {
  Collapsible,
  ShimmerText,
  StatusIcon,
  cn,
  formatDuration,
  formatTimer,
  useElapsed,
  usePrefersReducedMotion,
  type RunStatus,
} from './primitives';

/**
 * The shared chrome for every tool call.
 *
 * One shell for all kinds is what makes a long transcript scannable: the status
 * glyph, timer, and disclosure always sit in the same place, whether the row is
 * a file edit or a dependency install.
 */
export function ToolCard({
  status,
  icon,
  title,
  runningTitle,
  subject,
  meta,
  startedAt,
  endedAt,
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
  startedAt: number;
  endedAt?: number;
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

  const elapsed = useElapsed(startedAt, running);
  const duration = endedAt ? endedAt - startedAt : elapsed;

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
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'group/tool relative overflow-hidden rounded-lg border bg-[hsl(var(--cb-surface))]',
        'transition-[border-color] duration-200',
        status === 'error'
          ? 'border-[hsl(var(--cb-negative)/0.35)]'
          : running
            ? 'border-[hsl(var(--cb-accent)/0.3)]'
            : 'border-[hsl(var(--cb-line))] hover:border-[hsl(var(--cb-line-strong))]',
        className,
      )}
    >
      {/* Busy hairline along the top edge. Indeterminate on purpose — the model
          does not report progress, and a fake bar would be a lie. */}
      {running && (
        <span aria-hidden className="absolute inset-x-0 top-0 h-px overflow-hidden">
          <span className="cb-stripes absolute inset-0" />
        </span>
      )}

      <div className="flex h-9 w-full items-center gap-2 pl-2.5 pr-2">
        <button
          type="button"
          onClick={() => {
            if (!body) return;
            setTouched(true);
            setOpen((value) => !value);
          }}
          aria-expanded={body ? open : undefined}
          disabled={!body}
          className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
        >
          {body && (
            <ChevronRight
              size={12}
              aria-hidden
              className={cn(
                '-ml-0.5 shrink-0 text-[hsl(var(--cb-ink-ghost))]',
                'transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
                open && 'rotate-90',
              )}
            />
          )}

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
        </button>

        <div className="flex shrink-0 items-center gap-2">
          {actions && (
            <span className="flex items-center gap-0.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/tool:opacity-100">
              {actions}
            </span>
          )}

          {meta && <span className="text-[11px] text-[hsl(var(--cb-ink-faint))]">{meta}</span>}

          <span
            className={cn(
              'cb-tabular w-9 text-right text-[11px] text-[hsl(var(--cb-ink-ghost))]',
              // The timer only earns its space once the work is non-trivial.
              duration < 400 && !running && 'opacity-0',
            )}
          >
            {running ? formatTimer(elapsed) : formatDuration(duration)}
          </span>

          <StatusIcon status={status} size={13} />
        </div>
      </div>

      {body && <Collapsible open={open}>{body}</Collapsible>}

      {error && (
        <p
          className={cn(
            'border-t border-[hsl(var(--cb-negative)/0.25)] bg-[hsl(var(--cb-negative-soft)/0.5)]',
            'px-3 py-1.5 text-[11px] text-[hsl(var(--cb-negative))]',
          )}
        >
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
