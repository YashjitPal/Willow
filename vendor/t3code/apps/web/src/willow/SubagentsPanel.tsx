/**
 * The Subagents tab beside the chat, as the Codex app's side panel has it (its
 * local-conversation-subagents-panel-tab): the thread's agents under "Active · 2" and "Done · 1",
 * most recent first, each with its avatar, the start of its instructions and how it is doing.
 * Picking one shows its own conversation under a header that leads back to the list; an agent it
 * started opens in its place.
 */
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  formatSubagentDisplayTitle,
  resolveSubagentMetadata,
} from "@t3tools/client-runtime/state/subagent-display";
import {
  deriveLatestThreadRun,
  deriveRunlessWorkStartedAt,
  deriveThreadActivityRun,
  deriveThreadRuntime,
} from "@t3tools/client-runtime/state/thread-execution";
import {
  ThreadId,
  type OrchestrationV2Subagent,
  type ScopedThreadRef,
  type ServerProvider,
} from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import type { LegendListRef } from "@legendapp/list/react";
import * as DateTime from "effect/DateTime";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { MessagesTimeline } from "~/components/chat/MessagesTimeline";
import { Spinner } from "~/components/ui/spinner";
import type { ExpandedImagePreview } from "~/components/chat/ExpandedImagePreview";
import type { SubagentPanelSelection } from "~/rightPanelStore";
import {
  derivePhase,
  deriveActiveWorkStartedAt,
  deriveTimelineEntriesFromVisibleTurnItemsWithState,
  isLatestRunSettled,
  type TimelineEntriesProjection,
} from "~/session-logic";
import { useThreadProjection, useThreadVisibleTurnItems } from "~/state/entities";

import { CodexIcon, formatCodexElapsed } from "./activity";
import { AgentAvatar } from "./AgentAvatar";
import { SubagentOpenerCtx, useThreadSubagents, type SubagentTarget } from "./SubagentRows";
import {
  formatCompactAgo,
  SUBAGENT_PANEL_ACTIVE_LIMIT,
  SUBAGENT_PANEL_DONE_LIMIT,
  subagentPanelSections,
  subagentPanelStatus,
  subagentPreview,
} from "./subagents";

export interface SubagentsPanelProps {
  /** The chat the panel sits beside, whose agents it lists. */
  readonly threadRef: ScopedThreadRef;
  readonly selection: SubagentPanelSelection | null;
  readonly onSelect: (selection: SubagentPanelSelection | null) => void;
  readonly providerStatuses: ReadonlyArray<ServerProvider>;
  readonly markdownCwd: string | undefined;
  readonly workspaceRoot: string | undefined;
  readonly resolvedTheme: "light" | "dark";
  readonly timestampFormat: TimestampFormat;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly onImageExpand: (preview: ExpandedImagePreview) => void;
}

export function SubagentsPanel(props: SubagentsPanelProps) {
  const { onSelect } = props;
  const open = useMemo(
    () => (target: SubagentTarget) =>
      onSelect({
        parentThreadId: target.parentThreadId,
        subagentId: target.subagentId,
        title: target.name,
      }),
    [onSelect],
  );
  return (
    <SubagentOpenerCtx value={open}>
      <div data-subagents-panel="" className="flex h-full min-h-0 flex-col">
        {props.selection === null ? (
          <SubagentList threadRef={props.threadRef} onSelect={props.onSelect} />
        ) : (
          <SubagentDetail {...props} selection={props.selection} />
        )}
      </div>
    </SubagentOpenerCtx>
  );
}

function SubagentList({
  threadRef,
  onSelect,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly onSelect: SubagentsPanelProps["onSelect"];
}) {
  const agents = useThreadSubagents(threadRef);
  const { active, done, waitingCount } = subagentPanelSections(agents ?? []);
  const select = (agent: OrchestrationV2Subagent) =>
    onSelect({
      parentThreadId: agent.threadId,
      subagentId: agent.id,
      title: formatSubagentDisplayTitle(agent.title ?? "Subagent"),
    });
  return (
    <div data-subagents-list="">
      <div data-subagents-list-content="">
        <SubagentListSection
          title={`Active · ${active.length}`}
          trailing={waitingCount > 0 ? `${waitingCount} waiting` : null}
          agents={active}
          limit={SUBAGENT_PANEL_ACTIVE_LIMIT}
          emptyState="No active subagents"
          onSelect={select}
        />
        {done.length > 0 ? (
          <SubagentListSection
            title={`Done · ${done.length}`}
            trailing={null}
            agents={done}
            limit={SUBAGENT_PANEL_DONE_LIMIT}
            emptyState={null}
            onSelect={select}
            later
          />
        ) : null}
      </div>
    </div>
  );
}

function SubagentListSection(props: {
  readonly title: string;
  readonly trailing: string | null;
  readonly agents: ReadonlyArray<OrchestrationV2Subagent>;
  readonly limit: number;
  readonly emptyState: string | null;
  readonly onSelect: (agent: OrchestrationV2Subagent) => void;
  readonly later?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? props.agents : props.agents.slice(0, props.limit);
  return (
    <section data-subagents-section="" data-later={props.later ? "" : undefined}>
      <h2 data-subagents-section-title="">
        <span>{props.title}</span>
        {props.trailing ? <span data-subagents-section-trailing="">{props.trailing}</span> : null}
      </h2>
      {props.agents.length === 0 ? (
        <div data-subagents-empty="">{props.emptyState}</div>
      ) : (
        <div data-subagents-rows="">
          {shown.map((agent) => (
            <SubagentListRow key={agent.id} agent={agent} onSelect={props.onSelect} />
          ))}
        </div>
      )}
      {props.agents.length > props.limit ? (
        <button type="button" data-subagents-more="" onClick={() => setShowAll((all) => !all)}>
          {showAll ? "Show less" : "Show more"}
        </button>
      ) : null}
    </section>
  );
}

function SubagentListRow({
  agent,
  onSelect,
}: {
  readonly agent: OrchestrationV2Subagent;
  readonly onSelect: (agent: OrchestrationV2Subagent) => void;
}) {
  const status = subagentPanelStatus(agent.status);
  const progress = agent.progress?.trim();
  const preview =
    subagentPreview(agent.prompt) || progress || (status === "done" ? null : "Working");
  return (
    <button
      type="button"
      data-subagents-row=""
      data-with-preview={preview ? "" : undefined}
      onClick={() => onSelect(agent)}
    >
      <AgentAvatar seed={agent.id} className="size-6" />
      <span data-subagents-row-text="">
        <span data-subagents-row-heading="">
          <span data-subagents-row-name="">
            {formatSubagentDisplayTitle(agent.title ?? "Subagent")}
          </span>
          <SubagentRowTrailing agent={agent} />
        </span>
        {preview ? <span data-subagents-row-preview="">{preview}</span> : null}
      </span>
    </button>
  );
}

/** "Waiting", the time it has worked so far, or how long ago it finished. */
function SubagentRowTrailing({ agent }: { readonly agent: OrchestrationV2Subagent }) {
  const status = subagentPanelStatus(agent.status);
  const startedAtMs = agent.startedAt ? DateTime.toEpochMillis(agent.startedAt) : null;
  const finishedAtMs = DateTime.toEpochMillis(agent.completedAt ?? agent.updatedAt);
  const nowMs = useSecondTicker(status !== "done" && startedAtMs !== null);
  const parts: ReactNode[] = [];
  if (status === "waiting") parts.push(<span key="waiting">Waiting</span>);
  if (status !== "done" && startedAtMs !== null) {
    parts.push(<span key="elapsed">{formatCodexElapsed(Math.max(nowMs - startedAtMs, 0))}</span>);
  }
  if (status === "done") {
    parts.push(
      <time key="ago" dateTime={new Date(finishedAtMs).toISOString()}>
        {formatCompactAgo(finishedAtMs, nowMs)} ago
      </time>,
    );
  }
  if (parts.length === 0) return null;
  return <span data-subagents-row-trailing="">{parts}</span>;
}

function useSecondTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function SubagentDetail(
  props: SubagentsPanelProps & { readonly selection: SubagentPanelSelection },
) {
  const { selection } = props;
  const parentRef = scopeThreadRef(
    props.threadRef.environmentId,
    ThreadId.make(selection.parentThreadId),
  );
  const agent =
    useThreadSubagents(parentRef)?.find((candidate) => candidate.id === selection.subagentId) ??
    null;
  const name = agent ? formatSubagentDisplayTitle(agent.title ?? "Subagent") : selection.title;
  const model =
    agent?.model && agent.model.trim().length > 0
      ? resolveSubagentMetadata({
          model: agent.model,
          provider: props.providerStatuses.find(
            (provider) => provider.instanceId === agent.providerInstanceId,
          ),
        }).modelLabel
      : null;
  return (
    <>
      <div data-subagent-header="">
        <button
          type="button"
          data-subagent-back=""
          aria-label="Back to subagents"
          onClick={() => props.onSelect(null)}
        >
          <CodexIcon name="arrow-left" className="size-4" />
        </button>
        <AgentAvatar seed={selection.subagentId} className="size-6" />
        <span data-subagent-header-name="">{name}</span>
        {model ? <span data-subagent-header-model="">{model}</span> : null}
      </div>
      {agent?.childThreadId ? (
        <SubagentTranscript
          key={agent.childThreadId}
          {...props}
          childRef={scopeThreadRef(props.threadRef.environmentId, agent.childThreadId)}
          live={agent !== null && subagentPanelStatus(agent.status) === "active"}
        />
      ) : (
        <SubagentTranscriptLoading />
      )}
    </>
  );
}

function SubagentTranscriptLoading() {
  return (
    <div data-subagent-transcript-loading="" aria-label="Subagent transcript">
      <Spinner size="lg" />
    </div>
  );
}

const NO_MESSAGES: never[] = [];
const NO_ATTACHMENT_URLS = new Map<string, string>();
const NO_DIFFS: never[] = [];
const noop = () => {};
const noopAsync = async () => {};

/** The agent's own conversation, read only, as the chat draws one. */
function SubagentTranscript(
  props: SubagentsPanelProps & { readonly childRef: ScopedThreadRef; readonly live: boolean },
) {
  const projection = useThreadProjection(props.childRef)?.projection ?? null;
  const visibleTurnItems = useThreadVisibleTurnItems(props.childRef);
  const listRef = useRef<LegendListRef | null>(null);
  const previousEntriesRef = useRef<TimelineEntriesProjection | null>(null);
  const entries = useMemo(() => {
    const next = deriveTimelineEntriesFromVisibleTurnItemsWithState(
      {
        visibleTurnItems,
        optimisticMessages: NO_MESSAGES,
        attachmentUrlById: NO_ATTACHMENT_URLS,
        ...(projection === null
          ? {}
          : { attempts: projection.attempts, nodes: projection.nodes, plans: projection.plans }),
      },
      previousEntriesRef.current,
    );
    previousEntriesRef.current = next;
    return next.entries;
  }, [projection, visibleTurnItems]);
  const activityRun = useMemo(
    () => (projection === null ? null : deriveThreadActivityRun(projection)),
    [projection],
  );
  const runtime = useMemo(
    () => (projection === null ? null : deriveThreadRuntime(projection)),
    [projection],
  );
  const runlessWorkStartedAt = useMemo(
    () => (projection === null ? null : deriveRunlessWorkStartedAt(projection)),
    [projection],
  );
  const latestRun = useMemo(
    () => (projection === null ? null : deriveLatestThreadRun(projection)),
    [projection],
  );
  if (projection === null && entries.length === 0) return <SubagentTranscriptLoading />;
  const isWorking = derivePhase(runtime) === "running" || runlessWorkStartedAt !== null;
  const workStartedAt =
    deriveActiveWorkStartedAt(activityRun, runtime, null) ?? runlessWorkStartedAt;
  return (
    <div data-subagent-transcript="" className="relative flex min-h-0 flex-1 flex-col">
      <MessagesTimeline
        isWorking={isWorking}
        runlessWorkActive={runlessWorkStartedAt !== null}
        activeTurnInProgress={isWorking || !isLatestRunSettled(latestRun, runtime)}
        activeTurnStartedAt={workStartedAt}
        turnStarted={workStartedAt !== null}
        listRef={listRef}
        timelineEntries={entries}
        latestRun={activityRun}
        runningRunId={runtime?.activeRunId ?? null}
        turnDiffSummaries={NO_DIFFS}
        routeThreadKey={scopedThreadKey(props.childRef)}
        onOpenTurnDiff={noop}
        onOpenThread={props.onOpenThread}
        onForkFromRun={noopAsync}
        onRollbackCheckpoint={noop}
        supportsConversationRollback={false}
        onRevertToTurnCount={noop}
        isRevertingCheckpoint={false}
        onImageExpand={props.onImageExpand}
        activeThreadEnvironmentId={props.childRef.environmentId}
        markdownCwd={props.markdownCwd}
        resolvedTheme={props.resolvedTheme}
        timestampFormat={props.timestampFormat}
        workspaceRoot={props.workspaceRoot}
        providerStatuses={props.providerStatuses}
        runs={projection?.runs ?? NO_DIFFS}
        anchorMessageId={null}
        onAnchorReady={noop}
        onAnchorSizeChanged={noop}
        contentInsetEndAdjustment={0}
        onIsAtEndChange={noop}
        liveFollowEnabled={props.live || isWorking}
        onManualNavigation={noop}
      />
    </div>
  );
}
