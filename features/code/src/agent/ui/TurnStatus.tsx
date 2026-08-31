import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, Square } from 'lucide-react';
import {
  ShimmerText,
  cn,
  formatDuration,
  useElapsed,
  usePrefersReducedMotion,
} from './primitives';

/**
 * The turn-level status line: "Working for 12s".
 *
 * Two behaviours make this what it is, and both are easy to get wrong.
 *
 * **It disappears when the answer lands.** While the agent works, this is the
 * only thing telling the user the turn is alive, so it has to be prominent.
 * The moment prose starts arriving, the prose *is* the signal and a live timer
 * beside it becomes noise competing with the thing the user actually wants to
 * read. So it exits rather than settling into a "completed in 12s" row.
 *
 * **The elapsed time is preserved on the way out.** It fades rather than
 * cutting, and it keeps its final value while fading — a timer that resets to
 * 0:00 for the last 200ms of its life reads as a bug.
 *
 * The label rotates through whatever the harness reports as its current
 * activity ("Reading files", "Editing files"), which is what makes a long turn
 * feel like progress rather than a hang.
 */
export function TurnStatus({
  startedAt,
  activity,
  running,
  onStop,
  className,
}: {
  startedAt: number;
  /** Current phase from the harness. Falls back to "Working". */
  activity?: string | null;
  running: boolean;
  onStop?: () => void;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const elapsed = useElapsed(startedAt, running);

  // Frozen at the moment the turn ends, so the exit animation does not show a
  // timer racing back to zero.
  const [finalElapsed, setFinalElapsed] = useState(elapsed);
  useEffect(() => {
    if (running) setFinalElapsed(elapsed);
  }, [running, elapsed]);

  const shown = running ? elapsed : finalElapsed;
  const label = activity?.trim() || 'Working';

  return (
    <AnimatePresence initial={false}>
      {running && (
        <motion.div
          initial={reduced ? false : { opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
          transition={{
            height: { duration: 0.22, ease: [0.22, 1, 0.36, 1] },
            opacity: { duration: 0.16 },
          }}
          className={cn('overflow-hidden', className)}
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2 py-1">
            {/* The activity swaps in place; the elapsed time never re-mounts,
                so it ticks continuously across phase changes. */}
            <span className="min-w-0 flex-1 text-[13px]">
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={label}
                  initial={reduced ? false : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
                  transition={{ duration: 0.16 }}
                  className="inline-block"
                >
                  <ShimmerText className="font-medium">{label}</ShimmerText>
                </motion.span>
              </AnimatePresence>
              <span className="cb-tabular ml-1.5 text-[hsl(var(--cb-ink-ghost))]">
                for {formatDuration(shown)}
              </span>
            </span>

            {onStop && (
              <button
                type="button"
                onClick={onStop}
                aria-label="Stop"
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded',
                  'text-[hsl(var(--cb-ink-ghost))] transition-colors duration-150',
                  'hover:bg-[hsl(var(--cb-ink)/0.08)] hover:text-[hsl(var(--cb-ink))]',
                )}
              >
                <Square size={8} fill="currentColor" />
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * The settled counterpart, shown on a finished turn's footer.
 *
 * Separate from `TurnStatus` on purpose: this is metadata about a completed
 * turn, revealed on hover like the other message actions, not a live indicator.
 */
export function TurnDuration({ duration }: { duration: number }) {
  return (
    <span className="cb-tabular text-[11px] text-[hsl(var(--cb-ink-ghost))]">
      Worked for {formatDuration(duration)}
    </span>
  );
}

/**
 * A collapsed summary of everything a finished turn did.
 *
 * Codex hides the working detail once the answer arrives, but does not throw it
 * away. This is the handle to get it back — one row, closed by default, holding
 * the tool cards that would otherwise dominate the transcript on re-read.
 */
export function CollapsedWork({
  count,
  children,
  defaultOpen = false,
}: {
  count: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const reduced = usePrefersReducedMotion();

  if (count === 0) return null;

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={cn(
          'group/work flex items-center gap-1.5 text-[11px]',
          'text-[hsl(var(--cb-ink-ghost))] transition-colors hover:text-[hsl(var(--cb-ink-muted))]',
        )}
      >
        <ChevronRight
          size={11}
          aria-hidden
          className={cn('transition-transform duration-200', open && 'rotate-90')}
        />
        {open ? 'Hide' : 'Show'} {count} {count === 1 ? 'step' : 'steps'}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              height: { duration: 0.24, ease: [0.22, 1, 0.36, 1] },
              opacity: { duration: 0.15 },
            }}
            className="overflow-hidden"
          >
            <div className="space-y-1.5 pt-1.5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
