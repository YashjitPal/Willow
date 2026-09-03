/**
 * The wire format and event vocabulary of the Agent harness.
 *
 * ## Why a text protocol rather than native function calling
 *
 * Two reasons, and the second is the load-bearing one.
 *
 * 1. `platform/ai` only wires `functionDeclarations` for the Gemini adapter.
 *    The OpenAI, Anthropic and compat branches accept search tools and nothing
 *    else, so native calling would pin the harness to one provider.
 *
 * 2. Upstream Codex's own `apply_patch` is a *freeform* tool — the model emits
 *    raw text matching a Lark grammar, not a JSON argument object
 *    (`create_apply_patch_freeform_tool` in codex-rs). Parsing text is
 *    therefore the faithful port, not a workaround.
 *
 * It also streams. A patch arriving as text can be applied and rendered line by
 * line while the model is still writing, which is what makes the diff animate
 * in the transcript instead of appearing all at once at the end.
 *
 * ## The format
 *
 * `apply_patch` uses upstream's envelope verbatim, so the vendored grammar and
 * tool instructions describe it exactly:
 *
 *     *** Begin Patch
 *     *** Update File: /App.tsx
 *     @@
 *     -const a = 1;
 *     +const a = 2;
 *     *** End Patch
 *
 * Every other tool uses one consistent envelope in the same visual family, so
 * the model only has to learn one shape:
 *
 *     *** Call: read_file
 *     {"path": "/App.tsx"}
 *     *** End Call
 */

import type { ToolId } from '../overlay/tool-policy';

export const PATCH_BEGIN = '*** Begin Patch';
export const PATCH_END = '*** End Patch';
export const CALL_BEGIN = '*** Call:';
export const CALL_END = '*** End Call';

/* ------------------------------------------------------------------------ */
/* Session entities                                                          */
/* ------------------------------------------------------------------------ */

export type RunStatus =
  | 'queued'
  | 'running'
  | 'success'
  | 'error'
  | 'cancelled';

export const isTerminalStatus = (status: RunStatus): boolean =>
  status === 'success' || status === 'error' || status === 'cancelled';

export interface DiffLine {
  type: 'add' | 'del' | 'ctx' | 'hunk';
  oldLine?: number;
  newLine?: number;
  content: string;
}

interface CallBase {
  id: string;
  status: RunStatus;
  startedAt: number;
  endedAt?: number;
  error?: string;
}

export interface EditCall extends CallBase {
  kind: 'edit' | 'create' | 'delete';
  path: string;
  movePath?: string;
  added: number;
  removed: number;
  lines: DiffLine[];
  /** How many diff lines are revealed, for the streaming write-in. */
  revealed?: number;
}

export interface ReadCall extends CallBase {
  kind: 'read';
  path: string;
  range?: [number, number];
  totalLines: number;
  preview: string[];
}

export interface ListCall extends CallBase {
  kind: 'list';
  path: string;
  entries: { name: string; type: 'file' | 'dir'; size?: number }[];
}

export interface SearchHit {
  path: string;
  line: number;
  text: string;
  match: [number, number];
}

export interface SearchCall extends CallBase {
  kind: 'search';
  query: string;
  scope: string;
  hits: SearchHit[];
  fileCount: number;
}

export interface PlanStep {
  text: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface PlanCall extends CallBase {
  kind: 'plan';
  steps: PlanStep[];
  explanation?: string;
}

export interface OutputChunk {
  stream: 'stdout' | 'stderr';
  text: string;
}

export interface DependencyCall extends CallBase {
  kind: 'dependency';
  name: string;
  version: string;
  /** Rendered through the command card, since it reads as an install. */
  output: OutputChunk[];
}

/**
 * A command run in the sandbox.
 *
 * The harness has no shell, so these are never arbitrary: they come from an
 * allow-list of sandbox operations (install, typecheck, restart the preview)
 * that Willow implements itself. The card is a terminal because that is what
 * the operation *reads* as — the text is honest about what actually ran.
 */
export interface CommandCall extends CallBase {
  kind: 'command';
  command: string;
  cwd: string;
  /** Appended to progressively while running. */
  output: OutputChunk[];
  exitCode?: number;
}

/* ---------------------------------------------------------------------- */
/* Computer use                                                            */
/* ---------------------------------------------------------------------- */

export interface ComputerAction {
  /** Upstream action name: click_at, type_text_at, scroll_at, navigate, … */
  name: string;
  /** One-line description already rendered for a human. */
  label: string;
  /** Viewport coordinates, when the action has a location. */
  at?: { x: number; y: number };
  status: RunStatus;
  at_ms: number;
}

/**
 * A computer-use run against the preview.
 *
 * The only thing there is to drive here is the app the agent just built, which
 * is why this exists at all: it closes the loop between writing a UI and
 * checking that the UI actually works.
 */
export interface ComputerUseCall extends CallBase {
  kind: 'computer';
  objective: string;
  actions: ComputerAction[];
  /** Latest frame, as a data URI. Replaced rather than accumulated. */
  screenshot?: string;
  /** Where the pointer is, in screenshot pixel space, for the cursor overlay. */
  cursor?: { x: number; y: number };
  /** The model's running commentary. */
  activity?: string;
  result?: string;
  /** Set when the frame navigated somewhere Willow cannot script. */
  limited?: boolean;
}

export interface ThinkCall extends CallBase {
  kind: 'think';
  title: string;
  lines: string[];
}

export interface TaskCall extends CallBase {
  kind: 'task';
  agentId: string;
}

/* ---------------------------------------------------------------------- */
/* Plan mode                                                               */
/* ---------------------------------------------------------------------- */

/**
 * A `<proposed_plan>` block, streaming.
 *
 * Not a tool call — the model writes it as prose — but it is rendered as its own
 * card, which is what the mode document means by "wrap it in a
 * `<proposed_plan>` block so the client can render it specially". `markdown`
 * grows as deltas arrive.
 */
export interface ProposedPlanCall extends CallBase {
  kind: 'proposed-plan';
  markdown: string;
}

/** One `request_user_input` round. Resolved by the user, not by a tool. */
export interface UserInputCall extends CallBase {
  kind: 'user-input';
  questions: {
    id: string;
    header: string;
    question: string;
    options: { label: string; description: string }[];
  }[];
  /** Filled in once answered; absent while the turn is waiting. */
  answers?: { id: string; answer: string }[];
  /** True in Plan mode, where the turn genuinely stops for the answer. */
  blocking: boolean;
}

/* ---------------------------------------------------------------------- */
/* Goal mode                                                               */
/* ---------------------------------------------------------------------- */

/** A `get_goal` / `create_goal` / `update_goal` call. */
export interface GoalCall extends CallBase {
  kind: 'goal';
  action: 'get' | 'create' | 'update';
  objective?: string;
  goalStatus?: string;
  tokenBudget?: number;
  tokensUsed?: number;
}

export type ToolCall =
  | EditCall
  | ReadCall
  | ListCall
  | SearchCall
  | PlanCall
  | DependencyCall
  | CommandCall
  | ComputerUseCall
  | ThinkCall
  | TaskCall
  | ProposedPlanCall
  | UserInputCall
  | GoalCall;

/* ------------------------------------------------------------------------ */
/* Sub-agents                                                                */
/* ------------------------------------------------------------------------ */

/**
 * The roles upstream ships as built-ins.
 *
 * Upstream has two role configs in `core/assets/agent/builtins/` — `explorer`
 * and `awaiter` — and `agent_type` is a free string validated against the
 * configured set. Willow offers `explorer` only: `awaiter` exists to babysit a
 * long-running shell command until it terminates, and there is no shell here.
 *
 * The previous four kinds (`implementer`, `reviewer`, `researcher`) were
 * invented and are gone. They looked harmless but they set the model's
 * expectations about what a role *does*, and none of them corresponded to
 * anything the harness actually varied.
 */
export type AgentKind = 'explorer' | 'agent';

/**
 * `AgentStatus`, from `codex-rs/protocol/src/protocol.rs`.
 *
 * A tagged union rather than a flat enum because two of the variants carry a
 * payload: a completed agent carries its final message and an errored one
 * carries the reason. `list_agents` and `interrupt_agent` both return this
 * shape, so flattening it would lose the thing the model called them for.
 */
export type AgentStatus =
  | { kind: 'pending_init' }
  | { kind: 'running' }
  | { kind: 'interrupted' }
  | { kind: 'completed'; message: string | null }
  | { kind: 'errored'; message: string }
  | { kind: 'shutdown' }
  | { kind: 'not_found' };

/** `agent::status::is_final`. Interrupted is *not* final — it can be resumed. */
export const isFinalAgentStatus = (status: AgentStatus): boolean =>
  !(
    status.kind === 'pending_init' ||
    status.kind === 'running' ||
    status.kind === 'interrupted'
  );

/** How the model addresses and reads an agent's state. */
export interface SubAgent {
  id: string;
  /**
   * Canonical task name, e.g. `/root/explore/deeper`.
   *
   * The address, not a label — every collaboration tool takes one of these.
   * `name` is the display form.
   */
  path: string;
  /** Last path segment, which is what a parent may use as a relative name. */
  name: string;
  /** Whoever spawned it. `/root` for a top-level agent. */
  parentPath: string;
  kind: AgentKind;
  objective: string;
  status: RunStatus;
  /** Upstream's richer status, which carries the final message or the error. */
  agentStatus: AgentStatus;
  startedAt: number;
  endedAt?: number;
  progress: number;
  calls: ToolCall[];
  activity?: string;
  result?: string;
  model: string;
  tokensUsed: number;
  /** How many turns of the parent's conversation it inherited. */
  forkTurns?: string;
}

/* ------------------------------------------------------------------------ */
/* Messages                                                                  */
/* ------------------------------------------------------------------------ */

export type MessageBlock =
  | { type: 'text'; id: string; content: string; streaming?: boolean }
  | { type: 'tool'; id: string; callId: string }
  | { type: 'agents'; id: string; agentIds: string[] };

export interface Attachment {
  id: string;
  name: string;
  kind: 'image' | 'file';
  src?: string;
  size: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  blocks: MessageBlock[];
  createdAt: number;
  attachments?: Attachment[];
  model?: string;
  pending?: boolean;
  duration?: number;
}

/* ------------------------------------------------------------------------ */
/* Tool execution contract                                                   */
/* ------------------------------------------------------------------------ */

/**
 * What a tool receives. Deliberately narrow: a tool may read and write project
 * files and nothing else, which is what makes "no shell" structurally true
 * rather than merely stated in the prompt.
 */
export interface ToolContext {
  readFiles: () => Record<string, string>;
  writeFiles: (files: Record<string, string>) => void;
  signal?: AbortSignal;
  /** Emits a call into the transcript and returns its id. */
  emit: (call: ToolCall) => string;
  /** Updates an already-emitted call. */
  patch: (id: string, patch: Partial<ToolCall>) => void;
}

export interface ToolResult {
  /** Text handed back to the model as the tool's observation. */
  observation: string;
  /** Set when the tool failed; the model is expected to recover. */
  failed?: boolean;
}

export interface ToolHandler {
  id: ToolId;
  /** Parsed from the JSON body of a `*** Call:` envelope. */
  run: (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;
}

/* ------------------------------------------------------------------------ */
/* The seam between the turn loop and the collaboration runtime              */
/* ------------------------------------------------------------------------ */

/**
 * These three live here rather than in `agent.ts` to break an import cycle.
 *
 * `collaboration.ts` needs to *run* an iteration — that is what a sub-agent is —
 * and `agent.ts` needs to register the collaboration tools. If either imported
 * the other, the cycle would resolve at runtime but only by accident of
 * evaluation order. Both importing their shared vocabulary from here is the
 * same pattern `platform/storage` uses for its contributor seam.
 */

/** One streamed model response, after everything it emitted was handled. */
export interface IterationResult {
  /** Everything the model said, envelopes stripped. */
  text: string;
  /** Everything it emitted, envelopes included. This is what goes back as history. */
  raw: string;
  /** Observations to feed back, in order. */
  observations: string[];
  /** True when anything actually ran or changed a file. */
  didWork: boolean;
  /** True when it emitted at least one call needing a result. */
  wantsMore: boolean;
}

/**
 * Where a running agent's output goes.
 *
 * The root turn writes into the transcript; an agent writes into its own card.
 * Both run the identical loop, and this indirection is the only difference.
 */
export interface CallSink {
  onText: (chunk: string) => void;
  onThought: (chunk: string) => void;
  emit: (call: ToolCall) => string;
  patch: (id: string, patch: Partial<ToolCall>) => void;
  activity: (label: string | null) => void;
}

/** What the collaboration mode changes about one iteration. */
export interface TurnGates {
  mode: 'plan' | 'default';
  /** Plan mode: patches and mutating tools are declined. */
  refuseMutation: boolean;
  /** Plan mode, root only: lift `<proposed_plan>` into its own card. */
  streamProposedPlan: boolean;
}

/** Runs one streamed response. Supplied by `agent.ts`. */
export type IterationRunner = (
  conversation: { role: 'user' | 'assistant'; content: string }[],
  systemPrompt: string,
  sink: CallSink,
  registry: Map<string, ToolHandler>,
  gates: TurnGates,
) => Promise<IterationResult>;

/* ------------------------------------------------------------------------ */
/* Streaming events                                                          */
/* ------------------------------------------------------------------------ */

export type HarnessEvent =
  | { type: 'text'; chunk: string }
  | { type: 'thought'; chunk: string }
  | { type: 'call-start'; call: ToolCall }
  | { type: 'call-progress'; id: string; patch: Partial<ToolCall> }
  | { type: 'call-end'; id: string; patch: Partial<ToolCall> }
  | { type: 'agents-start'; agents: SubAgent[] }
  | { type: 'agent-progress'; id: string; patch: Partial<SubAgent> }
  | { type: 'activity'; label: string | null }
  /**
   * Goal state changed. Emitted on every transition so the host can persist it
   * with the session — a goal that does not survive a reload is not a goal.
   */
  | { type: 'goal'; goal: import('./goal').ThreadGoal | null }
  /**
   * One automatic goal-continuation turn is starting.
   *
   * `index` counts from 1. The UI needs this to say "continuing (2 of 12)"
   * rather than appearing to have started a turn the user did not send.
   */
  | { type: 'goal-continuation'; index: number; limit: number }
  | {
      type: 'turn-end';
      reason: 'complete' | 'cancelled' | 'error';
      error?: string;
      /**
       * Why the loop stopped, when it was not simply the model finishing.
       *
       * `'complete'` used to be reported for a turn that hit the iteration
       * budget, which made an interrupted turn indistinguishable from a
       * finished one — the caller could not tell whether to offer "continue".
       */
      stopReason?: 'model-finished' | 'iteration-budget' | 'goal-ended' | 'goal-continuation-budget';
    };
