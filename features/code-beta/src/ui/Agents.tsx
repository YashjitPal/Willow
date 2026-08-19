import React from 'react';
import { useStore } from '@nanostores/react';
import { motion } from 'framer-motion';
import {
  ArrowUpRight,
  Bot,
  ChevronRight,
  Compass,
  Hammer,
  ScanEye,
  Telescope,
  type LucideIcon,
} from 'lucide-react';
import {
  Badge,
  Collapsible,
  ShimmerText,
  StatusIcon,
  cn,
  formatDuration,
  formatTimer,
  useElapsed,
  usePrefersReducedMotion,
} from './primitives';
import { ToolCallView } from './ToolCallView';
import { agents as agentsStore, focusAgent, focusedAgentId } from '../code-beta-store';
import type { AgentKind, SubAgent } from '../harness/runtime/protocol';

/**
 * Per-kind identity for sub-agents.
 *
 * Each kind gets a stable glyph and hue so a running fleet is readable at a
 * glance — an implementer is distinguishable from a reviewer without reading
 * the label.
 */
const AGENT_META: Record<AgentKind, { icon: LucideIcon; label: string; tint: string; wash: string }> = {
  explorer: {
    icon: Compass,
    label: 'Explorer',
    tint: 'text-[hsl(199_82%_68%)]',
    wash: 'bg-[hsl(199_82%_68%)]/12',
  },
  implementer: {
    icon: Hammer,
    label: 'Implementer',
    tint: 'text-[hsl(253_88%_76%)]',
    wash: 'bg-[hsl(253_88%_76%)]/12',
  },
  reviewer: {
    icon: ScanEye,
    label: 'Reviewer',
    tint: 'text-[hsl(38_88%_66%)]',
    wash: 'bg-[hsl(38_88%_66%)]/12',
  },
  researcher: {
    icon: Telescope,
    label: 'Researcher',
    tint: 'text-[hsl(285_75%_74%)]',
    wash: 'bg-[hsl(285_75%_74%)]/12',
  },
};

/* ------------------------------------------------------------------------ */
/* Inline chip                                                               */
/* ------------------------------------------------------------------------ */

/**
 * The inline representation of a sub-agent in the transcript.
 *
 * A summary, not a transcript: the agent's own tool calls live in the workspace
 * panel. Nesting full transcripts inline makes the main thread unreadable the
 * moment more than one agent runs.
 */
function AgentChip({ agent }: { agent: SubAgent }) {
  const focused = useStore(focusedAgentId) === agent.id;
  const reduced = usePrefersReducedMotion();

  const meta = AGENT_META[agent.kind];
  const running = agent.status === 'running';

  return (
    <motion.button
      type="button"
      layout={reduced ? false : 'position'}
      initial={reduced ? false : { opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      onClick={() => focusAgent(focused ? null : agent.id)}
      aria-pressed={focused}
      /*
       * A row, not a card. Sub-agents sit in the same stream as the tool calls
       * and read as more of the same work, so they carry the same weight: no
       * panel, no progress bar, no ring, no timer. The activity line shimmers
       * while it runs, which is the whole of the status.
       */
      className={cn(
        'group/chip flex w-full items-baseline gap-2 py-0.5 text-left',
        focused && 'text-[hsl(var(--cb-ink))]',
      )}
    >
      {/* Matches the tool rows' chevron column so the two align. */}
      <span className="flex w-3 shrink-0 justify-center" />

      <span className="shrink-0 self-center text-[hsl(var(--cb-ink-faint))]">
        <meta.icon size={13} strokeWidth={1.9} />
      </span>

      <span className="shrink-0 text-xs font-medium text-[hsl(var(--cb-ink-muted))]">
        {meta.label}
      </span>

      <span className="min-w-0 flex-1 truncate text-xs text-[hsl(var(--cb-ink))]">
        {agent.name}
      </span>

      <span className="min-w-0 shrink truncate text-[11px]">
        {running && agent.activity ? (
          <ShimmerText>{agent.activity}</ShimmerText>
        ) : (
          <span className="text-[hsl(var(--cb-ink-ghost))]">{agent.result ?? agent.objective}</span>
        )}
      </span>

      <ArrowUpRight
        size={12}
        aria-hidden
        className="shrink-0 self-center text-[hsl(var(--cb-ink-ghost))] opacity-0 transition-opacity duration-150 group-hover/chip:opacity-100"
      />
    </motion.button>
  );
}

/** The block that appears when a turn fans out. Reads as one labelled unit. */
export function AgentGroup({ agentIds }: { agentIds: string[] }) {
  const all = useStore(agentsStore);
  const group = agentIds.map((id) => all[id]).filter(Boolean) as SubAgent[];
  if (group.length === 0) return null;

  const running = group.filter((agent) => agent.status === 'running').length;
  const done = group.filter((agent) => agent.status === 'success').length;

  return (
    <div>
      {/* One quiet label, then the rows. The rule and the counter that used to
          bracket this made a section header out of what is a few lines. */}
      <div className="flex w-full items-baseline gap-2 py-0.5">
        <span className="flex w-3 shrink-0 justify-center" />
        <span className="text-xs font-medium text-[hsl(var(--cb-ink-muted))]">
          {running > 0
            ? `${running} sub-${running === 1 ? 'agent' : 'agents'} running`
            : `${group.length} sub-${group.length === 1 ? 'agent' : 'agents'}`}
        </span>
        <span className="cb-tabular text-[11px] text-[hsl(var(--cb-ink-ghost))]">
          {done}/{group.length}
        </span>
      </div>
      {group.map((agent) => (
        <AgentChip key={agent.id} agent={agent} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Workspace panel                                                           */
/* ------------------------------------------------------------------------ */

/**
 * The workspace-side view of the fleet.
 *
 * This is where an agent's actual work lives: its nested tool calls and its
 * final report. The chat only ever shows the summary chip.
 */
export function AgentsPanel({ agents: list }: { agents: SubAgent[] }) {
  const focused = useStore(focusedAgentId);

  if (list.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
        <span className="flex size-10 items-center justify-center rounded-xl bg-[hsl(var(--cb-ink)/0.05)]">
          <Bot size={18} className="text-[hsl(var(--cb-ink-ghost))]" strokeWidth={1.75} />
        </span>
        <p className="text-xs font-medium text-[hsl(var(--cb-ink-muted))]">No sub-agents yet</p>
        <p className="max-w-[32ch] text-[11px] leading-relaxed text-[hsl(var(--cb-ink-ghost))]">
          When a turn fans out into parallel work, each agent appears here with its
          own tool calls and result.
        </p>
      </div>
    );
  }

  const running = list.filter((agent) => agent.status === 'running').length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-10 shrink-0 items-center gap-3 border-b border-[hsl(var(--cb-line))] px-3">
        <h2 className="text-xs font-medium text-[hsl(var(--cb-ink))]">Sub-agents</h2>
        <span className="text-[11px] text-[hsl(var(--cb-ink-faint))]">
          {running > 0 ? `${running} running · ` : ''}
          {list.length} total
        </span>
      </header>

      {/* Capped width: agent rows are text, and full-bleed lines on a wide
          display are hard to track back to the next row. */}
      <div className="cb-scroll mx-auto min-h-0 w-full max-w-3xl flex-1 space-y-2 overflow-y-auto p-3">
        {list.map((agent) => (
          <AgentRow key={agent.id} agent={agent} expanded={focused === agent.id} />
        ))}
      </div>
    </div>
  );
}

function AgentRow({ agent, expanded }: { agent: SubAgent; expanded: boolean }) {
  const meta = AGENT_META[agent.kind];
  const running = agent.status === 'running';
  const elapsed = useElapsed(agent.startedAt, running);
  const duration = agent.endedAt ? agent.endedAt - agent.startedAt : elapsed;
  const reduced = usePrefersReducedMotion();

  return (
    <motion.section
      layout={reduced ? false : 'position'}
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'overflow-hidden rounded-lg border bg-[hsl(var(--cb-surface))] transition-[border-color] duration-200',
        expanded
          ? 'border-[hsl(var(--cb-accent)/0.4)]'
          : running
            ? 'border-[hsl(var(--cb-accent)/0.25)]'
            : 'border-[hsl(var(--cb-line))] hover:border-[hsl(var(--cb-line-strong))]',
      )}
    >
      <button
        type="button"
        onClick={() => focusAgent(expanded ? null : agent.id)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2.5 px-2.5 py-2.5 text-left"
      >
        <ChevronRight
          size={12}
          aria-hidden
          className={cn(
            'shrink-0 text-[hsl(var(--cb-ink-ghost))] transition-transform duration-200',
            expanded && 'rotate-90',
          )}
        />
        <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-md', meta.wash)}>
          <meta.icon size={14} strokeWidth={1.9} className={meta.tint} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-baseline gap-2">
            <span className="truncate text-xs font-medium text-[hsl(var(--cb-ink))]">{agent.name}</span>
            <Badge tone="outline">{meta.label}</Badge>
          </span>
          <span className="block truncate text-[11px]">
            {running && agent.activity ? (
              <ShimmerText>{agent.activity}</ShimmerText>
            ) : (
              <span className="text-[hsl(var(--cb-ink-faint))]">{agent.objective}</span>
            )}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="cb-tabular text-[11px] text-[hsl(var(--cb-ink-ghost))]">
            {running ? formatTimer(elapsed) : formatDuration(duration)}
          </span>
          <StatusIcon status={agent.status} size={13} progress={agent.progress} />
        </span>
      </button>

      <Collapsible open={expanded}>
        <div className="border-t border-[hsl(var(--cb-line-subtle))]">
          <div className="space-y-1.5 p-2.5">
            <p className="px-0.5 text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--cb-ink-ghost))]">
              Objective
            </p>
            <p className="px-0.5 text-xs leading-relaxed text-[hsl(var(--cb-ink-muted))]">
              {agent.objective}
            </p>

            {agent.calls.length > 0 && (
              <>
                <p className="px-0.5 pt-2 text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--cb-ink-ghost))]">
                  Work
                </p>
                <div className="space-y-1.5">
                  {agent.calls.map((call) => (
                    <ToolCallView key={call.id} call={call} />
                  ))}
                </div>
              </>
            )}

            {agent.result && (
              <>
                <p className="px-0.5 pt-2 text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--cb-ink-ghost))]">
                  Result
                </p>
                <p
                  className={cn(
                    'rounded-md px-2.5 py-2 text-xs leading-relaxed text-[hsl(var(--cb-ink-muted))]',
                    agent.status === 'error'
                      ? 'bg-[hsl(var(--cb-negative-soft)/0.45)]'
                      : 'bg-[hsl(var(--cb-positive-soft)/0.45)]',
                  )}
                >
                  {agent.result}
                </p>
              </>
            )}
          </div>
        </div>
      </Collapsible>
    </motion.section>
  );
}
