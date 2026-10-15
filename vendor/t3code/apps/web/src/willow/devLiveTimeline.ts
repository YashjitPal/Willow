/**
 * A turn that plays itself, to watch rows arrive, text stream and the turn fold without running
 * an agent. Development builds only, after `sessionStorage.setItem("willow-agents:fixture",
 * "live")`: it stands in for the open thread's timeline and replays on every reload. Its two
 * subagents stand in for the thread's too; `sessionStorage` "willow-agents:fixture-child" names a
 * thread to show as their conversation in the Subagents tab.
 */
import {
  MessageId,
  NodeId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2Subagent,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import type { TimelineLatestRun } from "~/components/chat/MessagesTimeline.logic";
import type { TimelineEntry } from "~/session-logic";

type WorkEntry = Extract<TimelineEntry, { kind: "work" }>["entry"];

const RUN = "fixture-live-run";
const TICK_MS = 50;
const FIXTURE_THREAD = ThreadId.make("fixture-live-thread");

interface Agent {
  readonly id: string;
  readonly title: string;
  readonly prompt: string;
  readonly start: number;
  readonly end: number;
}

/** Created together after the thinking; the first is back before the second. */
const AGENTS: ReadonlyArray<Agent> = [
  {
    id: "live-agent-ada",
    title: "Ada",
    prompt: "List the files in this project and say which ones hold the greeting and its test.",
    start: 1750,
    end: 4300,
  },
  {
    id: "live-agent-darwin",
    title: "Darwin",
    prompt: "Read README.md and sum up how the project runs its tests.",
    start: 1750,
    end: 5100,
  },
];

/** How long an agent waits to start, so its row says "Creating" first. */
const AGENT_PENDING_MS = 400;

interface Tool {
  readonly id: string;
  readonly start: number;
  readonly end: number;
  readonly entry: Omit<WorkEntry, "id" | "createdAt" | "runId" | "toolLifecycleStatus">;
}

interface Streamed {
  readonly id: string;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

const USER_TEXT = "The greet test fails now and then. Find out why, fix it, and run the tests.";

const THINKING: Tool = {
  id: "live-thinking",
  start: 400,
  end: 1700,
  entry: {
    label: "Thinking",
    tone: "thinking",
    itemType: "reasoning",
    detail: "A test that passes and fails at random is usually timing. I'll read it first.",
  },
};

const TOOLS: ReadonlyArray<Tool> = [
  {
    id: "live-read-test",
    start: 1800,
    end: 2400,
    entry: {
      label: "Read src/greet.test.ts",
      toolTitle: "Read",
      tone: "tool",
      itemType: "dynamic_tool",
      requestKind: "file-read",
      detail: "src/greet.test.ts",
    },
  },
  {
    id: "live-read-source",
    start: 2500,
    end: 3000,
    entry: {
      label: "Read src/index.ts",
      toolTitle: "Read",
      tone: "tool",
      itemType: "dynamic_tool",
      requestKind: "file-read",
      detail: "src/index.ts",
    },
  },
  {
    id: "live-edit",
    start: 4700,
    end: 5300,
    entry: {
      label: "Edited src/greet.test.ts",
      tone: "tool",
      itemType: "file_change",
      changedFiles: ["src/greet.test.ts"],
    },
  },
  {
    id: "live-test",
    start: 5500,
    end: 6900,
    entry: {
      label: "Ran npm test",
      tone: "tool",
      itemType: "command_execution",
      command: "npm test",
      detail:
        "> sample-project@1.0.0 test\n> node --test\n\n✔ greet says hello (0.6ms)\nℹ pass 1\nℹ fail 0",
    },
  },
];

const COMMENTARY: Streamed = {
  id: "live-commentary",
  start: 3200,
  end: 4500,
  text: "The test checks the time a greeting was made, so it fails whenever the clock ticks between two lines. I'll pin the clock.",
};

const ANSWER: Streamed = {
  id: "live-answer",
  start: 7100,
  end: 10600,
  text: [
    "The test was reading the clock twice, so a tick between the two reads failed it.",
    "",
    "## What changed",
    "",
    "- `greet.test.ts` now passes a fixed time to `greet`",
    "- The assertion compares against that time instead of `Date.now()`",
    "- Nothing in `src/index.ts` had to change",
    "",
    "The [Node test runner docs](https://nodejs.org/api/test.html) cover the clock mocks.",
    "",
    "```ts",
    'greet("Willow", new Date(0));',
    "```",
    "",
    "`npm test` passes: 1 test, 0 failures.",
  ].join("\n"),
};

const END = 10800;

/** The first `fraction` of a text's words, as a provider streams them. */
function wordsOf(text: string, fraction: number): string {
  if (fraction >= 1) return text;
  const words = text.split(/(?<=\s)/);
  return words.slice(0, Math.max(1, Math.ceil(words.length * fraction))).join("");
}

function frameAt(elapsed: number, base: number) {
  const iso = (offset: number) => new Date(base + offset).toISOString();
  // Each play is a new turn, so a replay's rows arrive afresh.
  const idOf = (id: string) => `${id}:${base}`;
  const run = RunId.make(idOf(RUN));
  const entries: TimelineEntry[] = [
    {
      id: idOf("live-user"),
      kind: "message",
      createdAt: iso(0),
      message: {
        id: MessageId.make(idOf("fixture-live-user")),
        role: "user",
        text: USER_TEXT,
        runId: run,
        streaming: false,
        createdAt: iso(0),
        updatedAt: iso(0),
      },
    },
  ];
  const tool = (step: Tool) => {
    if (elapsed < step.start) return;
    entries.push({
      id: idOf(step.id),
      kind: "work",
      createdAt: iso(step.start),
      entry: {
        ...step.entry,
        id: idOf(step.id),
        createdAt: iso(step.start),
        runId: run,
        toolLifecycleStatus: elapsed < step.end ? "inProgress" : "completed",
      },
    });
  };
  const streamed = (step: Streamed) => {
    if (elapsed < step.start) return;
    const fraction = (elapsed - step.start) / (step.end - step.start);
    entries.push({
      id: idOf(step.id),
      kind: "message",
      createdAt: iso(step.start),
      message: {
        id: MessageId.make(idOf(`fixture-${step.id}`)),
        role: "assistant",
        text: wordsOf(step.text, fraction),
        runId: run,
        streaming: fraction < 1,
        createdAt: iso(step.start),
        updatedAt: iso(Math.min(elapsed, step.end)),
      },
    });
  };
  const at = (offset: number) => DateTime.makeUnsafe(base + offset);
  const childThreadId = sessionStorage.getItem("willow-agents:fixture-child");
  const subagents: OrchestrationV2Subagent[] = [];
  const agent = (step: Agent) => {
    if (elapsed < step.start) return;
    const status =
      elapsed < step.start + AGENT_PENDING_MS
        ? "pending"
        : elapsed < step.end
          ? "running"
          : "completed";
    const startedAt = status === "pending" ? null : at(step.start + AGENT_PENDING_MS);
    const completedAt = status === "completed" ? at(step.end) : null;
    const updatedAt = at(Math.min(elapsed, step.end));
    const shared = {
      threadId: FIXTURE_THREAD,
      runId: run,
      status,
      title: step.title,
      startedAt,
      completedAt,
      updatedAt,
      driver: ProviderDriverKind.make("claudeAgent"),
      providerInstanceId: ProviderInstanceId.make("claudeAgent"),
      providerThreadId: null,
      childThreadId: childThreadId ? ThreadId.make(childThreadId) : null,
      origin: "provider_native",
      prompt: step.prompt,
      result: status === "completed" ? "Done." : null,
    } as const;
    subagents.push({
      ...shared,
      id: NodeId.make(step.id),
      parentNodeId: NodeId.make(idOf("live-root")),
      createdBy: "agent",
      nativeTaskRef: null,
      model: "claude-fable-5-1",
    });
    const itemId = TurnItemId.make(idOf(step.id));
    entries.push({
      id: idOf(step.id),
      kind: "event",
      createdAt: iso(step.start),
      projectedItem: {
        position: 0,
        visibility: "local",
        sourceThreadId: FIXTURE_THREAD,
        sourceItemId: itemId,
        item: {
          ...shared,
          type: "subagent",
          id: itemId,
          nodeId: null,
          providerTurnId: null,
          nativeItemRef: null,
          parentItemId: null,
          ordinal: 0,
          subagentId: NodeId.make(step.id),
        },
      },
    });
  };
  tool(THINKING);
  for (const step of AGENTS) agent(step);
  for (const step of TOOLS.slice(0, 2)) tool(step);
  streamed(COMMENTARY);
  for (const step of TOOLS.slice(2)) tool(step);
  streamed(ANSWER);
  const working = elapsed < END;
  const latestRun: TimelineLatestRun = {
    runId: run,
    status: working ? "running" : "completed",
    startedAt: iso(0),
    completedAt: working ? null : iso(END),
  };
  return {
    entries,
    subagents,
    isWorking: working,
    latestRun,
    runningRunId: working ? run : null,
    startedAt: working ? iso(0) : null,
  };
}

export type DevLiveTimeline = ReturnType<typeof frameAt>;

/** The playing frame's subagents, for the rows and the Subagents tab beside the chat. */
let playingSubagents: ReadonlyArray<OrchestrationV2Subagent> | null = null;
const subagentListeners = new Set<() => void>();
const subscribeSubagents = (listener: () => void) => {
  subagentListeners.add(listener);
  return () => subagentListeners.delete(listener);
};
const readSubagents = () => playingSubagents;

declare global {
  interface Window {
    /** Plays the live fixture's turn again from its first step. */
    __replayLiveTimeline?: () => void;
  }
}

function useLiveTimeline(): DevLiveTimeline | null {
  const [live] = useState(() => sessionStorage.getItem("willow-agents:fixture") === "live");
  const [base, setBase] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!live) return;
    window.__replayLiveTimeline = () => {
      setBase(Date.now());
      setElapsed(0);
    };
    const timer = setInterval(() => {
      const next = Date.now() - base;
      setElapsed(next);
      if (next > END + TICK_MS) clearInterval(timer);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [base, live]);
  const frame = useMemo(() => (live ? frameAt(elapsed, base) : null), [base, elapsed, live]);
  useEffect(() => {
    playingSubagents = frame?.subagents ?? null;
    for (const listener of subagentListeners) listener();
  }, [frame]);
  return frame;
}

function usePlayingSubagents(): ReadonlyArray<OrchestrationV2Subagent> | null {
  return useSyncExternalStore(subscribeSubagents, readSubagents);
}

// Chosen by the build flag, so a production bundle keeps neither the script nor the switch.
export const useDevLiveTimeline: () => DevLiveTimeline | null = import.meta.env.DEV
  ? useLiveTimeline
  : () => null;

/** The live fixture's subagents while it plays, standing in for any thread's. */
export const useDevSubagents: () => ReadonlyArray<OrchestrationV2Subagent> | null = import.meta.env
  .DEV
  ? usePlayingSubagents
  : () => null;
