/**
 * The shared UI vocabulary for the Agent tool.
 *
 * Deliberately local rather than drawn from `@willow/ui`: this surface has its
 * own token scale (`--cb-*`) and its own density, and reusing the shell's
 * components would drag in the shell's palette. Isolation is the point of the
 * experiment.
 *
 * Colour never appears as a literal here. Every value resolves through a token
 * declared in `agent.css`.
 */

import React, { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Minus, X } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));

export type RunStatus = 'queued' | 'running' | 'success' | 'error' | 'cancelled';

/* ------------------------------------------------------------------------ */
/* Motion preference                                                         */
/* ------------------------------------------------------------------------ */

let motionQuery: MediaQueryList | null = null;

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined') return false;
    motionQuery ??= window.matchMedia('(prefers-reduced-motion: reduce)');
    return motionQuery.matches;
  });

  useEffect(() => {
    motionQuery ??= window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(motionQuery!.matches);
    motionQuery.addEventListener('change', update);
    return () => motionQuery?.removeEventListener('change', update);
  }, []);

  return reduced;
}

/* ------------------------------------------------------------------------ */
/* Formatting                                                                */
/* ------------------------------------------------------------------------ */

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) {
    const seconds = ms / 1000;
    return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
  }
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}m ${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}s`;
}

export function formatTimer(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const fileName = (path: string): string => path.split('/').pop() ?? path;

export const dirName = (path: string): string => {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/');
};

/** Ticks while `active`, so running work shows a moving clock. */
export function useElapsed(startedAt: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [active]);

  return Math.max(0, now - startedAt);
}

/** Copy-to-clipboard with a self-resetting "copied" flag. */
export function useCopy(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);

  const copy = useCallback((text: string) => {
    void navigator.clipboard?.writeText(text).then(() => setCopied(true));
  }, []);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(id);
  }, [copied]);

  return [copied, copy];
}

/* ------------------------------------------------------------------------ */
/* Spinner and status                                                        */
/* ------------------------------------------------------------------------ */

/**
 * The single loading glyph.
 *
 * Indeterminate mode rotates a fixed 30% arc; determinate holds still and grows
 * it. Both share a track, so a call that starts indeterminate and later reports
 * progress transitions without a visual jump.
 */
export function Spinner({
  size = 14,
  progress,
  className,
  strokeWidth = 1.75,
}: {
  size?: number;
  progress?: number;
  className?: string;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const determinate = progress !== undefined;
  const dash = determinate
    ? Math.max(0.02, Math.min(1, progress)) * circumference
    : circumference * 0.3;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      fill="none"
      role="status"
      aria-label={determinate ? `${Math.round((progress ?? 0) * 100)}% complete` : 'Working'}
      className={cn(!determinate && 'cb-spin', className)}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="opacity-20"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circumference}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={determinate ? { transition: 'stroke-dasharray 420ms cubic-bezier(0.22,1,0.36,1)' } : undefined}
      />
    </svg>
  );
}

export function PendingDots({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-[3px]', className)} role="status" aria-label="Queued">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="cb-breathe size-[3px] rounded-full bg-current"
          style={{ animationDelay: `${index * 160}ms` }}
        />
      ))}
    </span>
  );
}

const STATUS_TONE: Record<RunStatus, string> = {
  queued: 'text-[hsl(var(--cb-ink-ghost))]',
  running: 'text-[hsl(var(--cb-accent))]',
  success: 'text-[hsl(var(--cb-positive))]',
  error: 'text-[hsl(var(--cb-negative))]',
  cancelled: 'text-[hsl(var(--cb-ink-faint))]',
};

/**
 * Status glyph for a tool call or agent.
 *
 * Swaps cross-fade with a slight scale so landing on `success` settles rather
 * than pops — completion is the moment the eye should catch, and an abrupt swap
 * reads as a glitch at this size.
 */
export function StatusIcon({
  status,
  size = 13,
  progress,
  className,
}: {
  status: RunStatus;
  size?: number;
  progress?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center transition-colors duration-200',
        STATUS_TONE[status],
        className,
      )}
      style={{ width: size, height: size }}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={status}
          initial={{ opacity: 0, scale: 0.55 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.55 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className="absolute inset-0 flex items-center justify-center"
        >
          {status === 'running' ? (
            <Spinner size={size} progress={progress} />
          ) : status === 'queued' ? (
            <PendingDots />
          ) : status === 'success' ? (
            <Check size={size} strokeWidth={2.75} />
          ) : status === 'error' ? (
            <X size={size} strokeWidth={2.75} />
          ) : (
            <Minus size={size} strokeWidth={2.5} />
          )}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export function StatusDot({ status, className }: { status: RunStatus; className?: string }) {
  const active = status === 'running';
  return (
    <span className={cn('relative inline-flex size-2 shrink-0', className)}>
      {active && <span className="cb-pulse-ring absolute inset-0 rounded-full bg-[hsl(var(--cb-accent))]" />}
      <span
        className={cn(
          'relative size-2 rounded-full transition-colors duration-300',
          status === 'running' && 'bg-[hsl(var(--cb-accent))]',
          status === 'queued' && 'bg-[hsl(var(--cb-ink-ghost))]',
          status === 'success' && 'bg-[hsl(var(--cb-positive))]',
          status === 'error' && 'bg-[hsl(var(--cb-negative))]',
          status === 'cancelled' && 'bg-[hsl(var(--cb-ink-ghost))]',
        )}
      />
    </span>
  );
}

/* ------------------------------------------------------------------------ */
/* Text                                                                      */
/* ------------------------------------------------------------------------ */

export function ShimmerText({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('cb-shimmer', className)}>{children}</span>;
}

export function Caret({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'cb-caret ml-px inline-block h-[1em] w-[2px] translate-y-[0.15em] rounded-[1px] bg-[hsl(var(--cb-accent))] align-baseline',
        className,
      )}
    />
  );
}

/* ------------------------------------------------------------------------ */
/* Buttons                                                                   */
/* ------------------------------------------------------------------------ */

type Variant = 'primary' | 'secondary' | 'ghost' | 'subtle';

const VARIANT: Record<Variant, string> = {
  primary:
    'bg-[hsl(var(--cb-accent))] text-[hsl(var(--cb-canvas))] font-medium hover:brightness-110 active:brightness-95',
  secondary:
    'bg-[hsl(var(--cb-raised))] text-[hsl(var(--cb-ink))] border border-[hsl(var(--cb-line))] hover:border-[hsl(var(--cb-line-strong))]',
  ghost:
    'text-[hsl(var(--cb-ink-muted))] hover:text-[hsl(var(--cb-ink))] hover:bg-[hsl(var(--cb-ink)/0.06)]',
  subtle:
    'bg-[hsl(var(--cb-ink)/0.06)] text-[hsl(var(--cb-ink-muted))] hover:bg-[hsl(var(--cb-ink)/0.1)] hover:text-[hsl(var(--cb-ink))]',
};

const SIZE = {
  xs: 'h-6 gap-1 px-2 text-[11px] rounded-md',
  sm: 'h-7 gap-1.5 px-2.5 text-xs rounded-md',
  md: 'h-8 gap-2 px-3.5 text-[13px] rounded-lg',
} as const;

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: keyof typeof SIZE;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', size = 'sm', className, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap',
        'transition-[background-color,color,border-color,filter,transform] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]',
        'active:scale-[0.975] disabled:pointer-events-none disabled:opacity-40',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = 'AgentButton';

const ICON_SIZE = { xs: 'size-6 rounded-md', sm: 'size-7 rounded-md', md: 'size-8 rounded-lg' } as const;

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: keyof typeof ICON_SIZE;
  /** Required: these buttons never carry a visible label. */
  label: string;
  active?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ variant = 'ghost', size = 'sm', className, label, active, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      data-active={active || undefined}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center',
        'transition-[background-color,color,transform] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]',
        'active:scale-90 disabled:pointer-events-none disabled:opacity-35',
        'data-[active]:bg-[hsl(var(--cb-ink)/0.09)] data-[active]:text-[hsl(var(--cb-ink))]',
        VARIANT[variant],
        ICON_SIZE[size],
        className,
      )}
      {...props}
    />
  ),
);
IconButton.displayName = 'AgentIconButton';

/* ------------------------------------------------------------------------ */
/* Badges                                                                    */
/* ------------------------------------------------------------------------ */

type Tone = 'neutral' | 'accent' | 'positive' | 'negative' | 'warning' | 'outline';

const TONE: Record<Tone, string> = {
  neutral: 'bg-[hsl(var(--cb-ink)/0.07)] text-[hsl(var(--cb-ink-muted))]',
  accent: 'bg-[hsl(var(--cb-accent-soft))] text-[hsl(var(--cb-accent))]',
  positive: 'bg-[hsl(var(--cb-positive-soft))] text-[hsl(var(--cb-positive))]',
  negative: 'bg-[hsl(var(--cb-negative-soft))] text-[hsl(var(--cb-negative))]',
  warning: 'bg-[hsl(var(--cb-warning-soft))] text-[hsl(var(--cb-warning))]',
  outline: 'border border-[hsl(var(--cb-line))] text-[hsl(var(--cb-ink-faint))]',
};

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-[18px] shrink-0 items-center gap-1 rounded-[5px] px-1.5',
        'text-[11px] font-medium leading-none tracking-tight',
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** The "+12 −3" pair. Zero counts are dropped; "+0" reads as noise. */
export function DiffStat({
  added,
  removed,
  className,
}: {
  added: number;
  removed: number;
  className?: string;
}) {
  if (added === 0 && removed === 0) return null;
  return (
    <span
      className={cn('cb-tabular inline-flex items-center gap-1.5 text-[11px] font-medium', className)}
      aria-label={`${added} added, ${removed} removed`}
    >
      {added > 0 && <span className="text-[hsl(var(--cb-positive))]">+{added}</span>}
      {removed > 0 && <span className="text-[hsl(var(--cb-negative))]">−{removed}</span>}
    </span>
  );
}

/** A proportional add/remove bar: edit shape at a glance, without opening it. */
export function DiffBar({ added, removed }: { added: number; removed: number }) {
  const total = added + removed;
  if (total === 0) return null;
  const addPct = (added / total) * 100;

  return (
    <span className="flex h-1 w-8 overflow-hidden rounded-full bg-[hsl(var(--cb-line))]" aria-hidden>
      <span
        className="h-full bg-[hsl(var(--cb-positive))] transition-[width] duration-500"
        style={{ width: `${addPct}%` }}
      />
      <span
        className="h-full bg-[hsl(var(--cb-negative))] transition-[width] duration-500"
        style={{ width: `${100 - addPct}%` }}
      />
    </span>
  );
}

/* ------------------------------------------------------------------------ */
/* Collapsible                                                               */
/* ------------------------------------------------------------------------ */

/**
 * Height-animated disclosure.
 *
 * `height: auto` is animatable in Framer Motion, which matters because tool
 * bodies keep growing while they stream — a measured fixed height would lag the
 * content. Opacity runs faster than height so text does not appear to slide out
 * from behind the header edge.
 */
export function Collapsible({ open, children }: { open: boolean; children: React.ReactNode }) {
  const reduced = usePrefersReducedMotion();

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="body"
          initial={reduced ? false : { height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{
            height: { duration: reduced ? 0 : 0.26, ease: [0.22, 1, 0.36, 1] },
            opacity: { duration: reduced ? 0 : 0.16, ease: 'linear' },
          }}
          className="overflow-hidden"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------------ */
/* Tooltip                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * A CSS-positioned tooltip.
 *
 * Radix's tooltip is not in this repo's dependency set, and adding a package
 * for one affordance is not worth the bundle. This covers the whole need:
 * hover and focus both open it, Escape closes it, and it never traps focus
 * because it is never focusable.
 */
export function Tooltip({
  content,
  children,
  side = 'top',
  className,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const show = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), 420);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
  };

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const position =
    side === 'top'
      ? 'bottom-full left-1/2 -translate-x-1/2 mb-1.5'
      : side === 'bottom'
        ? 'top-full left-1/2 -translate-x-1/2 mt-1.5'
        : side === 'left'
          ? 'right-full top-1/2 -translate-y-1/2 mr-1.5'
          : 'left-full top-1/2 -translate-y-1/2 ml-1.5';

  return (
    <span
      className={cn('relative inline-flex', className)}
      onPointerEnter={show}
      onPointerLeave={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
      onKeyDown={(event) => {
        if (event.key === 'Escape') hide();
      }}
    >
      {children}
      <AnimatePresence>
        {open && (
          <motion.span
            role="tooltip"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.12 }}
            className={cn(
              'pointer-events-none absolute z-50 whitespace-nowrap rounded-md px-2 py-1',
              'border border-[hsl(var(--cb-line))] bg-[hsl(var(--cb-overlay))]',
              'text-[11px] font-medium text-[hsl(var(--cb-ink))]',
              'shadow-[0_6px_20px_-6px_hsl(var(--cb-shadow)/0.6)]',
              position,
            )}
          >
            {content}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/** Renders a shortcut like "⌘K" as discrete keycaps. */
export function Kbd({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {children.split(/\s+/).map((key, index) => (
        <kbd
          key={`${key}-${index}`}
          className={cn(
            'inline-flex h-4 min-w-4 items-center justify-center rounded-[3px] px-1',
            'border border-[hsl(var(--cb-line))] bg-[hsl(var(--cb-raised))]',
            'text-[10px] font-medium leading-none text-[hsl(var(--cb-ink-faint))]',
          )}
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}
