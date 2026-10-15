/**
 * Subagents in the Codex app's words (its webview's local conversation): the "Created 2 agents"
 * row, the line that follows the agents ("Ada and Darwin started working"), and the Subagents
 * tab's Active and Done lists. Each piece reads T3's record of the agents.
 */
import type {
  OrchestrationV2Notification,
  OrchestrationV2Subagent,
  OrchestrationV2TurnItemStatus,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

/** An agent's lifecycle on the line about it (Codex's subagent activity status). */
export type SubagentActivityStatus = "active" | "updated" | "interrupted" | "completed";

/** Where the Subagents tab lists an agent (Codex's background agent status). */
export type SubagentPanelStatus = "active" | "waiting" | "done";

export function subagentActivityStatus(
  status: OrchestrationV2TurnItemStatus,
): SubagentActivityStatus {
  switch (status) {
    case "completed":
    case "failed":
      return "completed";
    case "cancelled":
    case "interrupted":
      return "interrupted";
    default:
      return "active";
  }
}

/** What a notification said had happened to the agent, frozen when it arrived. */
export function notificationActivityStatus(
  outcome: OrchestrationV2Notification["outcome"],
): SubagentActivityStatus {
  switch (outcome) {
    case "cancelled":
      return "interrupted";
    case "updated":
      return "updated";
    default:
      return "completed";
  }
}

export function subagentPanelStatus(status: OrchestrationV2TurnItemStatus): SubagentPanelStatus {
  switch (status) {
    case "pending":
    case "running":
      return "active";
    case "waiting":
    case "idle":
      return "waiting";
    default:
      return "done";
  }
}

/** One line for several agents: an interruption wins, then news, then all of them finishing. */
export function subagentGroupActivityStatus(
  statuses: ReadonlyArray<SubagentActivityStatus>,
): SubagentActivityStatus {
  if (statuses.some((status) => status === "interrupted")) return "interrupted";
  if (statuses.some((status) => status === "updated")) return "updated";
  if (statuses.length > 0 && statuses.every((status) => status === "completed")) {
    return "completed";
  }
  return "active";
}

export function subagentActivityVerb(status: SubagentActivityStatus, count: number): string {
  switch (status) {
    case "active":
      return "started working";
    case "updated":
      return "updated";
    case "interrupted":
      return count === 1 ? "was interrupted" : "were interrupted";
    case "completed":
      return "finished";
  }
}

/**
 * Who the line names: every agent up to three, past that the first two and how many more.
 * The rest still show as avatars, up to four.
 */
export function subagentLineNames<T>(agents: ReadonlyArray<T>): {
  readonly named: ReadonlyArray<T>;
  readonly hiddenCount: number;
} {
  const namedCount = agents.length > 3 ? 2 : agents.length;
  return { named: agents.slice(0, namedCount), hiddenCount: agents.length - namedCount };
}

export const SUBAGENT_LINE_AVATAR_LIMIT = 4;

/** How the creating of one turn's agents stands, from their records. */
export type SubagentSpawnStatus = "inProgress" | "failed" | "completed";

export function subagentSpawnStatus(
  agents: ReadonlyArray<{
    readonly status: OrchestrationV2TurnItemStatus;
    readonly startedAt: unknown;
  }>,
): SubagentSpawnStatus {
  if (agents.some((agent) => agent.status === "pending")) return "inProgress";
  if (agents.some((agent) => agent.status === "failed" && agent.startedAt === null)) {
    return "failed";
  }
  return "completed";
}

/** "Created" in the header, before " 2 agents". */
export function subagentSpawnHeaderVerb(status: SubagentSpawnStatus): string {
  switch (status) {
    case "inProgress":
      return "Creating";
    case "failed":
      return "Failed to create";
    case "completed":
      return "Created";
  }
}

export function subagentSpawnCountLabel(count: number): string {
  return count === 1 ? " an agent" : ` ${count} agents`;
}

/** The verb of one agent's row when it has no instructions to quote. */
export function subagentSpawnRowVerb(status: SubagentSpawnStatus): string {
  switch (status) {
    case "inProgress":
      return "Creating";
    case "failed":
      return "Failed creating";
    case "completed":
      return "Created";
  }
}

/** The tab's Active list, then its Done list, each most recent first. */
export function subagentPanelSections(agents: ReadonlyArray<OrchestrationV2Subagent>): {
  readonly active: ReadonlyArray<OrchestrationV2Subagent>;
  readonly done: ReadonlyArray<OrchestrationV2Subagent>;
  readonly waitingCount: number;
} {
  const recent = [...agents].sort(
    (left, right) => recencyOf(right) - recencyOf(left) || left.id.localeCompare(right.id),
  );
  const active = recent.filter((agent) => subagentPanelStatus(agent.status) !== "done");
  return {
    active,
    done: recent.filter((agent) => subagentPanelStatus(agent.status) === "done"),
    waitingCount: active.filter((agent) => subagentPanelStatus(agent.status) === "waiting").length,
  };
}

export const SUBAGENT_PANEL_ACTIVE_LIMIT = 4;
export const SUBAGENT_PANEL_DONE_LIMIT = 10;

function recencyOf(agent: OrchestrationV2Subagent): number {
  return DateTime.toEpochMillis(agent.updatedAt);
}

/** A list row's second line: the start of its instructions as plain text, cut at 60 characters. */
export function subagentPreview(prompt: string): string | null {
  const plain = prompt
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/[`*_~#>]+/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (plain.length === 0) return null;
  return plain.length > 60 ? `${plain.slice(0, 60).trimEnd()}…` : plain;
}

/** Codex's compact time since: "1m" at the least, then hours, days, weeks, months, years. */
export function formatCompactAgo(thenMs: number, nowMs: number): string {
  const minutes = Math.max(1, Math.floor((nowMs - thenMs) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const now = new Date(nowMs);
  const then = new Date(thenMs);
  const days = Math.max(
    1,
    Math.round(
      (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
        new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime()) /
        86_400_000,
    ),
  );
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}
