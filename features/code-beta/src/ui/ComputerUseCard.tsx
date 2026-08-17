import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDownUp,
  Globe,
  Keyboard,
  MonitorSmartphone,
  MousePointerClick,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import {
  Badge,
  ShimmerText,
  StatusIcon,
  cn,
  usePrefersReducedMotion,
} from './primitives';
import { ToolCard } from './ToolCard';
import type { ComputerAction, ComputerUseCall } from '../harness/runtime/protocol';

/**
 * Computer use, rendered against the app the agent just built.
 *
 * The card is deliberately screenshot-first. A list of "clicked at (412, 288)"
 * lines is unreadable — the coordinates mean nothing without the pixels they
 * refer to — so the frame is the primary content and the action trail sits
 * beneath it as a timeline.
 *
 * The cursor overlay is the piece that makes it legible: it marks where the
 * agent is about to act, in the screenshot's own coordinate space, so a click
 * that lands on the wrong element is obvious at a glance rather than something
 * you infer three actions later.
 */

const ACTION_ICON: Record<string, LucideIcon> = {
  click_at: MousePointerClick,
  double_click_at: MousePointerClick,
  hover_at: MousePointerClick,
  drag_and_drop: MousePointerClick,
  type_text_at: Keyboard,
  key_combination: Keyboard,
  scroll_at: ArrowDownUp,
  scroll_document: ArrowDownUp,
  navigate: Globe,
  go_back: Globe,
  go_forward: Globe,
};

const iconFor = (name: string): LucideIcon => ACTION_ICON[name] ?? MonitorSmartphone;

export function ComputerUseCard({ call }: { call: ComputerUseCall }) {
  const running = call.status === 'running';
  const reduced = usePrefersReducedMotion();
  const done = call.actions.filter((action) => action.status === 'success').length;

  return (
    <ToolCard
      status={call.status}
      startedAt={call.startedAt}
      endedAt={call.endedAt}
      error={call.error}
      // Always open: the screenshot is the result, and a collapsed header says
      // nothing useful about what the agent saw.
      defaultOpen
      icon={<MonitorSmartphone size={13} strokeWidth={1.9} />}
      title="Tested"
      runningTitle="Testing"
      subject={
        <span className="min-w-0 flex-1 truncate">
          {running && call.activity ? (
            <ShimmerText>{call.activity}</ShimmerText>
          ) : (
            <span className="text-[hsl(var(--cb-ink-muted))]">{call.objective}</span>
          )}
        </span>
      }
      meta={
        call.actions.length > 0 ? (
          <span className="cb-tabular">
            {done}/{call.actions.length}
          </span>
        ) : null
      }
      body={
        <div className="border-t border-[hsl(var(--cb-line-subtle))] bg-[hsl(var(--cb-sunken))]">
          {call.limited && (
            <p
              className={cn(
                'flex items-start gap-2 border-b border-[hsl(var(--cb-warning)/0.25)]',
                'bg-[hsl(var(--cb-warning-soft)/0.5)] px-3 py-2 text-[11px] leading-relaxed',
                'text-[hsl(var(--cb-warning))]',
              )}
            >
              <TriangleAlert size={12} className="mt-px shrink-0" />
              The preview navigated somewhere Willow cannot script. It can still be
              seen, but not driven.
            </p>
          )}

          <Viewport call={call} reduced={reduced} />

          {call.actions.length > 0 && (
            <ol className="divide-y divide-[hsl(var(--cb-line-subtle))]">
              {call.actions.map((action, index) => (
                <ActionRow key={index} action={action} />
              ))}
            </ol>
          )}

          {call.result && (
            <p
              className={cn(
                'border-t border-[hsl(var(--cb-line-subtle))] px-3 py-2 text-xs leading-relaxed',
                call.status === 'error'
                  ? 'text-[hsl(var(--cb-negative))]'
                  : 'text-[hsl(var(--cb-ink-muted))]',
              )}
            >
              {call.result}
            </p>
          )}
        </div>
      }
    />
  );
}

function Viewport({ call, reduced }: { call: ComputerUseCall; reduced: boolean }) {
  if (!call.screenshot) {
    return (
      <div className="flex h-40 items-center justify-center text-[11px] text-[hsl(var(--cb-ink-ghost))]">
        {call.status === 'running' ? 'Capturing the preview…' : 'No screenshot captured'}
      </div>
    );
  }

  return (
    <div className="relative m-2.5 overflow-hidden rounded-md border border-[hsl(var(--cb-line))]">
      {/* Keyed on the frame so a new screenshot cross-fades rather than
          swapping, which otherwise reads as a flicker at this size. */}
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.img
          key={call.screenshot.slice(-64)}
          src={call.screenshot}
          alt={`Preview while ${call.objective}`}
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          className="block w-full bg-white"
        />
      </AnimatePresence>

      {/* The cursor sits in the screenshot's coordinate space, expressed as a
          percentage so it stays correct however the image is scaled. */}
      {call.cursor && (
        <motion.span
          aria-hidden
          initial={false}
          animate={{ left: `${call.cursor.x}%`, top: `${call.cursor.y}%` }}
          transition={
            reduced ? { duration: 0 } : { type: 'spring', stiffness: 210, damping: 24 }
          }
          className="pointer-events-none absolute -ml-3 -mt-3 block size-6"
        >
          <span className="absolute inset-0 rounded-full bg-[hsl(var(--cb-accent))] opacity-25" />
          <span className="cb-pulse-ring absolute inset-0 rounded-full bg-[hsl(var(--cb-accent))]" />
          <span className="absolute inset-[9px] rounded-full bg-[hsl(var(--cb-accent))] shadow-[0_0_0_2px_hsl(var(--cb-canvas))]" />
        </motion.span>
      )}
    </div>
  );
}

function ActionRow({ action }: { action: ComputerAction }) {
  const Icon = iconFor(action.name);
  const running = action.status === 'running';

  return (
    <li className="flex items-center gap-2.5 px-3 py-1.5">
      <span
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded',
          running
            ? 'bg-[hsl(var(--cb-accent)/0.15)] text-[hsl(var(--cb-accent))]'
            : 'bg-[hsl(var(--cb-ink)/0.05)] text-[hsl(var(--cb-ink-faint))]',
        )}
      >
        <Icon size={11} strokeWidth={2} />
      </span>

      <span className="min-w-0 flex-1 truncate text-[11.5px]">
        {running ? (
          <ShimmerText>{action.label}</ShimmerText>
        ) : (
          <span className="text-[hsl(var(--cb-ink-muted))]">{action.label}</span>
        )}
      </span>

      {action.at && (
        <Badge tone="outline" className="cb-tabular font-mono">
          {action.at.x}, {action.at.y}
        </Badge>
      )}

      <StatusIcon status={action.status} size={11} />
    </li>
  );
}
