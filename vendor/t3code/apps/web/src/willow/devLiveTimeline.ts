/**
 * A turn that plays itself, to watch rows arrive, text stream and the turn fold without running
 * an agent. Development builds only, after `sessionStorage.setItem("willow-agents:fixture",
 * "live")`: it stands in for the open thread's timeline and replays on every reload.
 */
import { MessageId, RunId } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import type { TimelineLatestRun } from "~/components/chat/MessagesTimeline.logic";
import type { TimelineEntry } from "~/session-logic";

type WorkEntry = Extract<TimelineEntry, { kind: "work" }>["entry"];

const RUN = "fixture-live-run";
const TICK_MS = 50;

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
  tool(THINKING);
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
    isWorking: working,
    latestRun,
    runningRunId: working ? run : null,
    startedAt: working ? iso(0) : null,
  };
}

export type DevLiveTimeline = ReturnType<typeof frameAt>;

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
  return live ? frameAt(elapsed, base) : null;
}

// Chosen by the build flag, so a production bundle keeps neither the script nor the switch.
export const useDevLiveTimeline: () => DevLiveTimeline | null = import.meta.env.DEV
  ? useLiveTimeline
  : () => null;
