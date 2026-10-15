/**
 * A turn's subagents as the Codex app's local conversation draws them (its MultiAgentAction and
 * SubagentActivity rows): "Created 2 agents", which opens to each agent and its instructions, then
 * the line their lives write ("Ada and Darwin started working", later "finished"), their avatars
 * before it. Naming an agent opens it beside the chat, in the Subagents tab.
 */
import { useAtomValue } from "@effect/atom-react";
import {
  formatSubagentDisplayTitle,
  resolveSubagentMetadata,
} from "@t3tools/client-runtime/state/subagent-display";
import type {
  NodeId,
  OrchestrationV2Notification,
  OrchestrationV2TurnItem,
  OrchestrationV2TurnItemStatus,
  ScopedThreadRef,
  ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import {
  createContext,
  Fragment,
  use,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { WorkLogBlock, WorkLogDetails, WorkLogRow } from "~/components/chat/WorkLog";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { environmentThreadDetails } from "~/state/threads";

import { CodexChevron, CodexIcon } from "./activity";
import { AgentAvatar } from "./AgentAvatar";
import { useDevSubagents } from "./devLiveTimeline";
import {
  notificationActivityStatus,
  SUBAGENT_LINE_AVATAR_LIMIT,
  subagentActivityStatus,
  subagentActivityVerb,
  subagentGroupActivityStatus,
  subagentLineNames,
  subagentSpawnCountLabel,
  subagentSpawnHeaderVerb,
  subagentSpawnRowVerb,
  subagentSpawnStatus,
  type SubagentActivityStatus,
} from "./subagents";

/** Which agent to open: where it was started, and its id there. */
export interface SubagentTarget {
  readonly parentThreadId: ThreadId;
  readonly subagentId: NodeId;
  readonly name: string;
}

/** Opens an agent beside the chat (Codex's background agent opener); absent, agents stay shut. */
export const SubagentOpenerCtx = createContext<((target: SubagentTarget) => void) | null>(null);

interface RowAgent extends SubagentTarget {
  readonly prompt: string;
  /** Shown as "Uses …" over the agent's name, when the provider reported it. */
  readonly model: string | null;
  readonly status: OrchestrationV2TurnItemStatus;
  readonly startedAt: unknown;
}

type SubagentItem = Extract<OrchestrationV2TurnItem, { type: "subagent" }>;

/** A thread's subagents as its projection has them (the live fixture's while it plays). */
export function useThreadSubagents(ref: ScopedThreadRef) {
  const projected = useAtomValue(
    environmentThreadDetails.threadAtom(ref),
    (thread) => thread?.projection.subagents,
  );
  return useDevSubagents() ?? projected;
}

function modelLabelOf(model: string | null, provider: ServerProvider | undefined): string | null {
  if (model === null || model.trim().length === 0) return null;
  return resolveSubagentMetadata({ model, provider }).modelLabel;
}

/** The rows for one turn's agents: what created them, then how they are doing. */
export function WillowSubagentRows(props: {
  /** The thread that started them. */
  readonly parentRef: ScopedThreadRef;
  readonly items: ReadonlyArray<SubagentItem>;
  readonly providerStatuses: ReadonlyArray<ServerProvider>;
  readonly expanded: boolean;
  readonly onExpandedChange: (expanded: boolean) => void;
  /** The turn is live, so its agents' avatars slide in as they join (Codex's chip entrance). */
  readonly animateEntrance: boolean;
}) {
  const live = useThreadSubagents(props.parentRef);
  const agents: RowAgent[] = props.items.map((item) => {
    const agent = live?.find((candidate) => candidate.id === item.subagentId);
    return {
      parentThreadId: item.threadId,
      subagentId: item.subagentId,
      name: formatSubagentDisplayTitle(agent?.title ?? item.title ?? "Subagent"),
      prompt: agent?.prompt ?? item.prompt,
      model: modelLabelOf(
        agent?.model ?? null,
        props.providerStatuses.find(
          (provider) =>
            provider.instanceId === (agent?.providerInstanceId ?? item.providerInstanceId),
        ),
      ),
      status: agent?.status ?? item.status,
      startedAt: agent?.startedAt ?? item.startedAt,
    };
  });
  return (
    <>
      <WorkLogBlock>
        <SubagentSpawnRow
          agents={agents}
          expanded={props.expanded}
          onExpandedChange={props.onExpandedChange}
        />
      </WorkLogBlock>
      <WorkLogBlock>
        <SubagentActivityLine
          agents={agents}
          status={subagentGroupActivityStatus(
            agents.map((agent) => subagentActivityStatus(agent.status)),
          )}
          animateEntrance={props.animateEntrance}
        />
      </WorkLogBlock>
    </>
  );
}

/** A notification about one agent: its line, as the news it brought left it. */
export function WillowSubagentNotificationLine(props: {
  readonly parentRef: ScopedThreadRef;
  readonly childThreadId: ThreadId;
  readonly outcome: OrchestrationV2Notification["outcome"];
  readonly fallback: ReactNode;
}) {
  const live = useThreadSubagents(props.parentRef);
  const agent = live?.find((candidate) => candidate.childThreadId === props.childThreadId);
  if (agent === undefined) return props.fallback;
  return (
    <SubagentActivityLine
      agents={[
        {
          parentThreadId: props.parentRef.threadId,
          subagentId: agent.id,
          name: formatSubagentDisplayTitle(agent.title ?? "Subagent"),
        },
      ]}
      status={notificationActivityStatus(props.outcome)}
      animateEntrance={false}
    />
  );
}

/** "Created 2 agents", shimmering while they are being created; opens to one row an agent. */
function SubagentSpawnRow({
  agents,
  expanded,
  onExpandedChange,
}: {
  readonly agents: ReadonlyArray<RowAgent>;
  readonly expanded: boolean;
  readonly onExpandedChange: (expanded: boolean) => void;
}) {
  const status = subagentSpawnStatus(agents);
  const toggle = () => onExpandedChange(!expanded);
  return (
    <WorkLogRow
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={toggle}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggle();
        }
      }}
      data-willow-activity-kind="subagents"
      icon={
        <span className="flex size-4 items-center justify-center">
          <CodexIcon name="subagents" className="block size-4 shrink-0" />
        </span>
      }
      label={
        <span data-subagent-spawn-summary="" className="block truncate">
          <span
            data-subagent-spawn-verb=""
            className={cn(status === "inProgress" && "live-tool-shine")}
          >
            {subagentSpawnHeaderVerb(status)}
          </span>
          {subagentSpawnCountLabel(agents.length)}
        </span>
      }
      trailing={<CodexChevron expanded={expanded} />}
    >
      {expanded ? (
        <WorkLogDetails kind="panel">
          <div data-subagent-spawn-rows="">
            {agents.map((agent) => (
              <SubagentSpawnAgentRow key={agent.subagentId} agent={agent} status={status} />
            ))}
          </div>
        </WorkLogDetails>
      ) : null}
    </WorkLogRow>
  );
}

/** "Created Ada with the instructions: …", the instructions cut to the row. */
function SubagentSpawnAgentRow({
  agent,
  status,
}: {
  readonly agent: RowAgent;
  readonly status: ReturnType<typeof subagentSpawnStatus>;
}) {
  const instructions = agent.prompt.trim();
  const name = <SubagentName agent={agent} withModel />;
  return (
    <div data-subagent-spawn-row="">
      {status === "completed" && instructions.length > 0 ? (
        <>
          <span>Created</span>
          {name}
          <span>with the instructions:</span>
          <SubagentInstructions text={instructions} />
        </>
      ) : (
        <>
          <span>{subagentSpawnRowVerb(status)}</span>
          {name}
        </>
      )}
    </div>
  );
}

function SubagentInstructions({ text }: { readonly text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [overflows, setOverflows] = useState(false);
  return (
    <Tooltip>
      <TooltipTrigger
        delay={200}
        disabled={!overflows}
        render={
          <span
            ref={ref}
            data-subagent-instructions=""
            onPointerEnter={() => {
              const element = ref.current;
              setOverflows(element !== null && element.scrollWidth > element.clientWidth);
            }}
          >
            {text}
          </span>
        }
      />
      <TooltipPopup className="max-w-96 whitespace-pre-wrap">{text}</TooltipPopup>
    </Tooltip>
  );
}

/** An agent's name, opening it when the chat can; "Uses <model>" over it when that is known. */
function SubagentName({
  agent,
  withModel = false,
  className,
}: {
  readonly agent: SubagentTarget & { readonly model?: string | null };
  readonly withModel?: boolean;
  readonly className?: string;
}) {
  const open = use(SubagentOpenerCtx);
  const name =
    open === null ? (
      <span data-subagent-name="" className={className}>
        {agent.name}
      </span>
    ) : (
      <span
        role="button"
        tabIndex={0}
        data-subagent-name=""
        data-opens=""
        className={className}
        onClick={(event) => {
          event.stopPropagation();
          open(agent);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          open(agent);
        }}
      >
        {agent.name}
      </span>
    );
  const model = withModel ? agent.model : null;
  if (!model) return name;
  return (
    <Tooltip>
      <TooltipTrigger delay={200} render={name} />
      <TooltipPopup>Uses {model}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * "Ada, Darwin and 2 more started working", after up to four of their avatars. In a live turn
 * an avatar slides in as its agent joins; a turn drawn from history shows them in place.
 */
function SubagentActivityLine({
  agents,
  status,
  animateEntrance,
}: {
  readonly agents: ReadonlyArray<SubagentTarget>;
  readonly status: SubagentActivityStatus;
  readonly animateEntrance: boolean;
}) {
  const [settled] = useState(
    () => new Set(animateEntrance ? [] : agents.map((agent) => agent.subagentId)),
  );
  const { named, hiddenCount } = subagentLineNames(agents);
  const names: Array<{ readonly key: string; readonly node: ReactNode }> = named.map((agent) => ({
    key: agent.subagentId,
    node: <SubagentName agent={agent} />,
  }));
  if (hiddenCount > 0) names.push({ key: "more", node: <span>{hiddenCount} more</span> });
  return (
    <section
      data-subagent-activity=""
      aria-label={`${agents.map((agent) => agent.name).join(", ")} ${subagentActivityVerb(status, agents.length)}`}
    >
      <span data-subagent-avatars="">
        {agents.slice(0, SUBAGENT_LINE_AVATAR_LIMIT).map((agent) => (
          <span
            key={agent.subagentId}
            data-subagent-chip=""
            data-animate-entrance={settled.has(agent.subagentId) ? undefined : ""}
            onAnimationEnd={() => settled.add(agent.subagentId)}
          >
            <AgentAvatar seed={agent.subagentId} />
          </span>
        ))}
      </span>
      <span data-subagent-sentence="" aria-live="polite">
        {names.map((name, index) => (
          <Fragment key={name.key}>
            {index === 0 ? null : index === names.length - 1 ? " and " : ", "}
            {name.node}
          </Fragment>
        ))}{" "}
        {subagentActivityVerb(status, agents.length)}
      </span>
    </section>
  );
}
