/**
 * The wire format and event vocabulary of the Spark harness.
 *
 * ## Why a text protocol rather than native function calling
 *
 * Two reasons, and the second is the load-bearing one.
 *
 * 1. `platform/ai` only wires `functionDeclarations` for the Gemini adapter.
 *    The OpenAI, Anthropic and compat branches accept search tools and nothing
 *    else, so native calling would pin Spark to one provider.
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
/** Spark-only metadata emitted once before the first work step. */
export const WORK_TITLE_BEGIN = '*** Work Title:';
/** Spark-only metadata emitted for concise, user-safe progress updates. */
export const WORK_LOG_BEGIN = '*** Work Log:';

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

/** A provider-native web search, distinct from private workspace search. */
export interface WebSearchCall extends CallBase {
  kind: 'web_search';
  query?: string;
}

/** A provider-native code-execution step. */
export interface CodeExecutionCall extends CallBase {
  kind: 'code_execution';
  language?: string;
  code?: string;
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

export interface AppCall extends CallBase {
  kind: 'app';
  app: string;
  action: string;
  input?: Record<string, unknown>;
  output?: string;
}

export interface McpCall extends CallBase {
  kind: 'mcp';
  server: string;
  tool: string;
  input?: Record<string, unknown>;
  output?: string;
}

export type ToolCall =
  | EditCall
  | ReadCall
  | ListCall
  | SearchCall
  | WebSearchCall
  | CodeExecutionCall
  | PlanCall
  | DependencyCall
  | CommandCall
  | ComputerUseCall
  | ThinkCall
  | TaskCall
  | AppCall
  | McpCall;

/* ------------------------------------------------------------------------ */
/* Sub-agents                                                                */
/* ------------------------------------------------------------------------ */

export type AgentKind = 'explorer' | 'implementer' | 'reviewer' | 'researcher';

export interface SubAgent {
  id: string;
  name: string;
  kind: AgentKind;
  objective: string;
  status: RunStatus;
  startedAt: number;
  endedAt?: number;
  progress: number;
  calls: ToolCall[];
  activity?: string;
  result?: string;
  model: string;
  tokensUsed: number;
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
/* Streaming events                                                          */
/* ------------------------------------------------------------------------ */

export type HarnessEvent =
  | { type: 'text'; chunk: string }
  | { type: 'thought'; chunk: string }
  | { type: 'work-title'; title: string }
  | { type: 'work-log'; text: string }
  | { type: 'call-start'; call: ToolCall }
  | { type: 'call-progress'; id: string; patch: Partial<ToolCall> }
  | { type: 'call-end'; id: string; patch: Partial<ToolCall> }
  | { type: 'agents-start'; agents: SubAgent[] }
  | { type: 'agent-progress'; id: string; patch: Partial<SubAgent> }
  | { type: 'activity'; label: string | null }
  | { type: 'turn-end'; reason: 'complete' | 'cancelled' | 'error'; error?: string };
