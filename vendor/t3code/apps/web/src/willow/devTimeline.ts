/**
 * A thread with one of each kind of timeline row, to restyle them without running an agent.
 * Development builds only, and only after `sessionStorage.setItem("willow-agents:fixture",
 * "timeline")`: it then stands in for the open thread's timeline.
 */
import { MessageId, PlanId } from "@t3tools/contracts";

import type { TimelineEntry } from "~/session-logic";

const at = (second: number) => new Date(Date.UTC(2026, 9, 6, 12, 0, second)).toISOString();

const message = (
  id: string,
  role: "user" | "assistant",
  second: number,
  text: string,
): TimelineEntry => ({
  id,
  kind: "message",
  createdAt: at(second),
  message: {
    id: MessageId.make(`fixture-${id}`),
    role,
    text,
    runId: null,
    streaming: false,
    createdAt: at(second),
    updatedAt: at(second),
  },
});

const work = (
  id: string,
  second: number,
  entry: Omit<Extract<TimelineEntry, { kind: "work" }>["entry"], "id" | "createdAt">,
): TimelineEntry => ({
  id,
  kind: "work",
  createdAt: at(second),
  entry: { id, createdAt: at(second), ...entry },
});

const answer = () => [
  "I added a **Usage** section to `README.md` and the tests still pass.",
  "",
  "## What changed",
  "",
  "- Documented `greet(name)` with a short example",
  "- Linked the section from the top of the README",
  "",
  "```ts",
  'import { greet } from "./src/index";',
  "",
  'console.log(greet("Willow")); // Hello, Willow!',
  "```",
  "",
  "> `npm test` ran 1 test: 1 passed, 0 failed.",
  "",
  "See the [Node test runner docs](https://nodejs.org/api/test.html) for more options.",
].join("\n");

const plan = () => [
  "# Publish sample-project to npm",
  "",
  "1. Sign in with `npm login` (the last command had no credentials).",
  "2. Set `name`, `version` and `files` in `package.json`.",
  "3. Run `npm publish --access public` from a clean checkout.",
  "",
  "**Risks:** the package name may already be taken; check with `npm view`.",
].join("\n");

const fixture = (): ReadonlyArray<TimelineEntry> => [
  message("user-1", "user", 0, "Add a Usage section to README.md that shows how to call greet, then run the tests."),
  work("thinking-1", 1, {
    label: "Thinking",
    tone: "thinking",
    itemType: "reasoning",
    detail: "README.md has no usage section yet. I'll look at greet in src/index.ts first.",
  }),
  work("read-1", 2, {
    label: "Read src/index.ts",
    toolTitle: "Read",
    tone: "tool",
    itemType: "dynamic_tool",
    requestKind: "file-read",
    detail: "src/index.ts",
    toolLifecycleStatus: "completed",
  }),
  work("search-1", 3, {
    label: "Searched for greet",
    toolTitle: "Grep",
    tone: "tool",
    itemType: "file_search",
    detail: "greet",
    toolLifecycleStatus: "completed",
  }),
  work("edit-1", 4, {
    label: "Edited README.md",
    tone: "tool",
    itemType: "file_change",
    changedFiles: ["README.md"],
    toolLifecycleStatus: "completed",
  }),
  work("command-1", 5, {
    label: "Ran npm test",
    tone: "tool",
    itemType: "command_execution",
    command: "npm test",
    detail: "> sample-project@1.0.0 test\n> node --test\n\n✔ greet says hello (0.8ms)\nℹ tests 1\nℹ pass 1\nℹ fail 0",
    toolLifecycleStatus: "completed",
  }),
  message("assistant-1", "assistant", 6, answer()),
  message("user-2", "user", 7, "Plan how we would publish this to npm."),
  work("web-1", 8, {
    label: "Searched the web",
    tone: "tool",
    itemType: "web_search",
    detail: "npm publish scoped package public access",
    toolLifecycleStatus: "completed",
  }),
  work("command-2", 9, {
    label: "Ran npm whoami",
    tone: "tool",
    itemType: "command_execution",
    command: "npm whoami",
    detail: "npm ERR! code ENEEDAUTH\nnpm ERR! need auth This command requires you to be logged in.",
    toolLifecycleStatus: "failed",
  }),
  {
    id: "plan-1",
    kind: "proposed-plan",
    createdAt: at(10),
    proposedPlan: {
      id: PlanId.make("fixture-plan-1"),
      runId: null,
      planMarkdown: plan(),
      status: "active",
      createdAt: at(10),
      updatedAt: at(10),
    },
  },
  work("error-1", 11, {
    label: "Provider error",
    tone: "error",
    itemType: "error",
    detail: "The model is overloaded. Retrying in 4s.",
  }),
];

function withFixture<T extends ReadonlyArray<TimelineEntry>>(entries: T): T {
  if (sessionStorage.getItem("willow-agents:fixture") !== "timeline") return entries;
  return fixture() as unknown as T;
}

// Chosen by the build flag, so a production bundle keeps neither the fixture nor the switch.
export const devTimelineFixture: <T extends ReadonlyArray<TimelineEntry>>(entries: T) => T =
  import.meta.env.DEV ? withFixture : (entries) => entries;
