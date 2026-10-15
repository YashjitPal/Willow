import type { OrchestrationV2Subagent } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { agentAvatarIndex } from "./AgentAvatar";
import { AGENT_AVATARS } from "./agentAvatars";
import {
  formatCompactAgo,
  notificationActivityStatus,
  subagentActivityStatus,
  subagentActivityVerb,
  subagentGroupActivityStatus,
  subagentLineNames,
  subagentPanelSections,
  subagentPreview,
  subagentSpawnCountLabel,
  subagentSpawnHeaderVerb,
  subagentSpawnStatus,
} from "./subagents";

const agent = (
  id: string,
  status: OrchestrationV2Subagent["status"],
  updatedSecond: number,
): OrchestrationV2Subagent =>
  ({
    id,
    status,
    prompt: "",
    title: id,
    updatedAt: DateTime.makeUnsafe(Date.UTC(2026, 9, 14, 12, 0, updatedSecond)),
  }) as unknown as OrchestrationV2Subagent;

describe("agentAvatarIndex", () => {
  it("hashes a seed the way the Codex app does, so an agent keeps its design", () => {
    expect(AGENT_AVATARS).toHaveLength(28);
    // n = (n * 31 + code) % 2147483647 over "ab" is 97 * 31 + 98 = 3105; 3105 % 28 = 25.
    expect(agentAvatarIndex("ab")).toBe(25);
    expect(agentAvatarIndex("")).toBe(0);
    expect(agentAvatarIndex("node-1")).toBe(agentAvatarIndex("node-1"));
  });
});

describe("the line after a turn's agents", () => {
  it("names up to three agents, then two and how many more", () => {
    expect(subagentLineNames(["a", "b", "c"])).toEqual({ named: ["a", "b", "c"], hiddenCount: 0 });
    expect(subagentLineNames(["a", "b", "c", "d", "e"])).toEqual({
      named: ["a", "b"],
      hiddenCount: 3,
    });
  });

  it("speaks of the group as Codex does: an interruption first, finished only when all are", () => {
    expect(subagentGroupActivityStatus(["completed", "active"])).toBe("active");
    expect(subagentGroupActivityStatus(["completed", "completed"])).toBe("completed");
    expect(subagentGroupActivityStatus(["completed", "interrupted", "active"])).toBe("interrupted");
    expect(subagentActivityVerb("interrupted", 1)).toBe("was interrupted");
    expect(subagentActivityVerb("interrupted", 2)).toBe("were interrupted");
    expect(subagentActivityVerb("active", 2)).toBe("started working");
  });

  it("reads T3's statuses and a notification's outcome in Codex's words", () => {
    expect(subagentActivityStatus("running")).toBe("active");
    expect(subagentActivityStatus("failed")).toBe("completed");
    expect(subagentActivityStatus("cancelled")).toBe("interrupted");
    expect(notificationActivityStatus("updated")).toBe("updated");
    expect(notificationActivityStatus("cancelled")).toBe("interrupted");
    expect(notificationActivityStatus("failed")).toBe("completed");
  });
});

describe("Created 2 agents", () => {
  it("is still creating while an agent waits to start", () => {
    expect(subagentSpawnStatus([{ status: "pending", startedAt: null }])).toBe("inProgress");
    expect(subagentSpawnStatus([{ status: "failed", startedAt: null }])).toBe("failed");
    expect(subagentSpawnStatus([{ status: "running", startedAt: 1 }])).toBe("completed");
    expect(subagentSpawnHeaderVerb("inProgress")).toBe("Creating");
    expect(`Created${subagentSpawnCountLabel(1)}`).toBe("Created an agent");
    expect(`Created${subagentSpawnCountLabel(3)}`).toBe("Created 3 agents");
  });
});

describe("the Subagents tab", () => {
  it("lists working agents over finished ones, each most recent first", () => {
    const sections = subagentPanelSections([
      agent("old-done", "completed", 1),
      agent("waiting", "waiting", 2),
      agent("running", "running", 3),
      agent("new-done", "failed", 4),
    ]);
    expect(sections.active.map((each) => each.id)).toEqual(["running", "waiting"]);
    expect(sections.done.map((each) => each.id)).toEqual(["new-done", "old-done"]);
    expect(sections.waitingCount).toBe(1);
  });

  it("previews the start of an agent's instructions as plain text", () => {
    expect(subagentPreview("  Find **every** `TODO` in\n the repo  ")).toBe(
      "Find every TODO in the repo",
    );
    expect(subagentPreview("x".repeat(80))).toBe(`${"x".repeat(60)}…`);
    expect(subagentPreview("   ")).toBeNull();
  });

  it("says how long ago an agent finished in Codex's compact units", () => {
    const now = Date.UTC(2026, 9, 14, 12, 0, 0);
    expect(formatCompactAgo(now - 5_000, now)).toBe("1m");
    expect(formatCompactAgo(now - 42 * 60_000, now)).toBe("42m");
    expect(formatCompactAgo(now - 3 * 3_600_000, now)).toBe("3h");
  });
});
