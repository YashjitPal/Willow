/**
 * The Agent tool's turn loop.
 *
 * This is the harness proper: it owns the conversation with the model, the
 * segmentation of its output, the execution of tools, and the events the UI
 * renders. `platform/ai` is used only to move bytes to and from a provider —
 * every decision about *what* the agent does is made here.
 *
 * ## Shape of a turn
 *
 * A turn is a bounded loop. Each iteration streams one model response; patches
 * apply the instant their envelope closes, so the preview updates while the
 * model is still writing. Calls that need a result are collected, run after the
 * stream ends, and their observations are fed back as the next user message. The
 * loop stops when a response contains no calls, or when the iteration budget is
 * spent.
 *
 * ## Why patches apply mid-stream but calls do not
 *
 * A patch is fire-and-forget — the model does not need its result to keep
 * writing, and applying it immediately is what makes the preview feel live. A
 * call *is* a question, so continuing to generate past one would mean the model
 * inventing an answer it has not received. The prompt tells it to stop after a
 * call; this loop enforces that by discarding nothing and simply re-prompting
 * with the real observation.
 */

import type { AiOptions } from '@willow/ai/chat';
import { composeSystemPrompt, getHarnessProfile } from '../overlay/profile';
import {
  COLLABORATION_TOOLS,
  GOAL_TOOLS,
  isAllowed,
  refusalFor,
  toolsForTurn,
  type ToolId,
} from '../overlay/tool-policy';
import {
  ROOT_USAGE_HINT,
  SHARED_USAGE_HINT,
  SUBAGENT_USAGE_HINT,
  WAIT_AGENT_USAGE_HINT,
} from '../overlay/collaboration-tools';
import { CollaborationRuntime, renderEnvelope } from './collaboration';
import { ROOT_PATH as ROOT_AGENT_PATH } from './agent-path';
import { makeSkillTools, skillsMentionedIn } from './skills';
import { renderSkillsSection } from '../overlay/skills-prompt';
import type { LibrarySkill } from '@willow/core/skill-library';
import { makeMcpToolHandlers, renderMcpSection } from '../../mcp/mcp-harness-tools';
import type { McpBoundTool } from '@willow/ai/mcp/mcp-store';
import {
  isMutatingTool,
  planModeMutationRefusal,
  requestUserInputUnavailableMessage,
  PLAN_MODE_PATCH_REFUSAL,
  UPDATE_PLAN_IN_PLAN_MODE_ERROR,
  type ModeKind,
} from '../overlay/collaboration-mode';
import {
  EXPLICIT_REQUEST_ONLY,
  type MultiAgentMode,
} from '../overlay/multi-agent-mode';
import {
  applyPatch,
  normalizePath,
  parsePatch,
  renderDiff,
  PatchApplyError,
  PatchParseError,
  type FileMap,
} from './apply-patch';
import {
  ResponseStreamParser,
  parseCallBody,
} from './stream-parser';
import { findLooseCode, looseCodeObservation, stripLooseCode } from './loose-code';
import { CONTINUE_OBSERVATION, announcedWithoutActing } from './stalled';
import { beginToolLog, instrumentTransport } from './request-log';
import { compactForHistory } from './history';
import { nextId, toolRegistry } from './tools';
import { ProposedPlanParser } from './proposed-plan';
import { GoalRuntime, isGoalFinished } from './goal';
import { makeRequestUserInputTool, type RequestUserInputSink } from './request-user-input';
import type {
  CallSink,
  EditCall,
  GoalCall,
  HarnessEvent,
  IterationResult,
  Message,
  ProposedPlanCall,
  ToolCall,
  ToolContext,
  ToolHandler,
  ToolResult,
  TurnGates,
  UserInputCall,
} from './protocol';

const MAX_ITERATIONS = 12;
const MAX_SUBAGENT_ITERATIONS = 6;

/**
 * How many automatic goal-continuation turns one `runTurn` will start.
 *
 * Upstream has no such limit: `continue_if_idle` fires for as long as the goal
 * is `Active`, and the user stops it from a terminal. A browser tab has no
 * terminal and no bill it can see, so an unbounded loop there is a way to spend
 * someone's API budget while they are on another page. The cap is generous
 * enough that reaching it is itself informative — a goal that has not converged
 * in this many turns is not going to — and hitting it leaves the goal `active`,
 * so the user can resume rather than start over.
 */
const MAX_GOAL_CONTINUATIONS = 12;

/*
 * `TurnGates` now lives in `protocol.ts`, beside `CallSink`, for the same
 * reason: `collaboration.ts` has to pass one when it runs an agent.
 *
 * It is carried as a value rather than read off `options` so an agent can
 * inherit its parent's mutation boundary without inheriting its plan card —
 * those two are the same setting upstream and different here, because the
 * `<proposed_plan>` block belongs to the root.
 */

const DEFAULT_GATES: TurnGates = {
  mode: 'default',
  refuseMutation: false,
  streamProposedPlan: false,
};

const gatesFor = (mode: ModeKind, isRootThread = true): TurnGates => ({
  mode,
  refuseMutation: mode === 'plan',
  streamProposedPlan: mode === 'plan' && isRootThread,
});

export interface ModelBinding {
  /** Passed through to `streamChat`. */
  options: Omit<AiOptions, 'signal'>;
  /** Display name for the transcript footer. */
  label: string;
  /**
   * Reasoning effort on Codex's ladder, already clamped to what the model
   * accepts. The turn loop tells the model which level it is running at, since
   * upstream's prompt assumes the agent knows.
   */
  effort?: {
    requested: string;
    effective: string;
    clamped: boolean;
    /**
     * The half of effort that is not a wire parameter, derived from the
     * *requested* level rather than the clamped one. This half is
     * model-agnostic, which is what lets Ultra mean something on a model whose
     * API tops out lower.
     */
    harness?: {
      /** Willow's own loop bound. Upstream has no counterpart; see `effort.ts`. */
      maxIterations: number;
      /**
       * Upstream's `MultiAgentMode`, derived from effort exactly as
       * `session/multi_agents.rs` derives it: `ultra` → Proactive, everything
       * else → ExplicitRequestOnly. This is what Ultra actually *is* — the
       * reasoning parameter is already at the model's ceiling by then.
       */
      multiAgentMode?: MultiAgentMode;
      maxConcurrentAgents?: number;
    };
  };
}

/**
 * The only thing the harness needs from a model provider: stream a response.
 *
 * Injectable so the turn loop can be driven by a scripted model in tests, and
 * so the claim that `platform/ai` is used "only to move bytes" is structural
 * rather than a comment. Defaults to `streamChat`.
 */
export type Transport = (
  messages: { role: 'user' | 'assistant'; content: string }[],
  options: AiOptions,
  onToken: (token: string) => void,
  onStart: () => void,
  systemPrompt: string,
  onPhase: undefined,
  onToolCall: undefined,
  onThought: (thought: string) => void,
) => Promise<unknown>;

export interface TurnOptions {
  /** The user's message for this turn. */
  prompt: string;
  /** Prior conversation, oldest first. */
  history: Message[];
  files: () => FileMap;
  writeFiles: (files: FileMap) => void;
  model: ModelBinding;
  onEvent: (event: HarnessEvent) => void;
  signal?: AbortSignal;
  /** Defaults to `platform/ai`'s `streamChat`. Overridden in tests. */
  transport?: Transport;
  /**
   * Tools supplied by the host rather than the harness — `run_command` and
   * `computer_use`, both of which need the workbench and the preview iframe.
   * Kept out of `tools.ts` so the harness stays independent of Willow.
   */
  extraTools?: ToolHandler[];
  /**
   * Collaboration mode for this turn. Defaults to `'default'`, which is
   * upstream's default too.
   *
   * The mode governs the developer message, whether `update_plan` and mutating
   * tools are refused, and whether `request_user_input` exists. See
   * `../overlay/collaboration-mode.ts`.
   */
  mode?: ModeKind;
  /**
   * The live goal, when Goal mode is running.
   *
   * Passing one turns on the three goal tools *and* the automatic continuation
   * loop — a goal that is still `active` when the model stops starts another
   * turn. The caller owns the object so it can persist across turns; the
   * harness only advances it.
   */
  goal?: GoalRuntime;
  /** Overrides `MAX_GOAL_CONTINUATIONS`, for tests and for a host with its own cap. */
  maxGoalContinuations?: number;
  /**
   * How `request_user_input` reaches the user. Required for the tool to work in
   * Plan mode; without it the tool reports itself unavailable rather than
   * fabricating an answer.
   */
  requestUserInput?: RequestUserInputSink;
  /**
   * Tokens the last request consumed, if the provider reported a number.
   *
   * Only ever used to advance a goal's budget, and only when it is a real
   * figure — see `goal.ts` on why an estimate is not acceptable there.
   */
  reportedTokens?: () => number | undefined;
  /**
   * The skills this turn may use, already filtered to the enabled ones.
   *
   * A snapshot, taken once per turn: the catalog is baked into the system
   * prompt, so a skill appearing or vanishing mid-turn would make
   * `skills.read` disagree with what the model was told it had.
   */
  skills?: LibrarySkill[];
  /**
   * Tools from connected MCP servers, already flattened.
   *
   * A snapshot for the same reason as `skills`: the tool list goes into the
   * system prompt, so a server dropping mid-turn would leave the model holding
   * names it can no longer call.
   */
  mcpTools?: McpBoundTool[];
}

/**
 * The default transport: `platform/ai`'s `streamChat`.
 *
 * Imported lazily rather than at module scope. `chat.ts` pulls in the Google,
 * OpenAI and Anthropic SDKs, and a static import would drag all three into the
 * Code chunk — and into any test that touches this module — even when a
 * caller supplies its own transport.
 */
const defaultTransport: Transport = async (...args) => {
  const { streamChat } = await import('@willow/ai/chat');
  return (streamChat as Transport)(...args);
};

class Cancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'Cancelled';
  }
}

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new Cancelled();
};

/* ------------------------------------------------------------------------ */
/* Conversation assembly                                                     */
/* ------------------------------------------------------------------------ */

/** Flattens a stored message back into the plain text the model sees. */
function messageText(message: Message): string {
  return message.blocks
    .map((block) => (block.type === 'text' ? block.content : ''))
    .join('')
    .trim();
}

/**
 * A compact inventory of the project, prepended to the first user message.
 *
 * The model cannot list files without spending a round trip, and it needs to
 * know what exists before it can patch anything. Contents are deliberately
 * excluded — a manifest is cheap, and `read_file` is one call away.
 *
 * It states facts and nothing else. An earlier version ended the empty case with
 * "Create /App.tsx to begin", which rode along on *every* first message — so
 * "hey" arrived carrying a direct instruction to scaffold, and the model
 * dutifully built a starter app nobody asked for. Context describes the world;
 * only the user's message says what to do about it.
 */
function projectContext(files: FileMap): string {
  const paths = Object.keys(files).sort();
  if (paths.length === 0) {
    return '<project>\nThe project has no files yet.\n</project>';
  }
  const listing = paths
    .map((path) => `  ${path} (${files[path]!.split('\n').length} lines)`)
    .join('\n');
  return `<project>\nFiles currently in the project:\n${listing}\n</project>`;
}

/*
 * There is deliberately no `effortSection` any more.
 *
 * This file used to build one: `<effort>You are working at max effort</effort>`,
 * a `<delegation>` line, and a `<how-to-work>` block whose text came from a
 * per-rung table in `effort.ts`. None of it exists upstream. Codex tells the
 * model nothing about its reasoning effort — the effort is a request parameter,
 * and the only thing derived from it in the prompt is the `<multi_agent_mode>`
 * fragment, which `composeSystemPrompt` now appends with upstream's own wording.
 *
 * It was not harmless. The guidance strings named tools ("verify with
 * computer_use", "plan before acting"), which made both unconditional at the
 * higher rungs and overrode upstream's own rules for when to plan and when to
 * validate — rules that say outright not to plan single-step work. Raising
 * effort therefore changed behaviour in ways the user had not asked for and
 * could not see.
 */

/* ------------------------------------------------------------------------ */
/* One streamed response                                                     */
/* ------------------------------------------------------------------------ */

interface PendingCall {
  name: string;
  body: string;
}

/*
 * `IterationResult` now lives in `protocol.ts` — see `CallSink` above.
 *
 * One field is worth restating here because it is easy to "simplify": `raw`,
 * not `text`, is what goes back as the assistant turn. Feeding back the
 * stripped prose hid the model's own tool calls from it, so the transcript
 * showed it narrating followed by an observation with nothing that could have
 * produced it. Models reconcile that by trying to close an envelope they cannot
 * see, and the transcript fills with orphan `*** End Call` markers.
 */

/**
 * Streams one model response and handles everything it emits.
 *
 * `sink` decides where calls land — the main transcript or a sub-agent's own
 * list — which is what lets sub-agents reuse this whole path unchanged.
 */
async function runIteration(
  conversation: { role: 'user' | 'assistant'; content: string }[],
  systemPrompt: string,
  options: TurnOptions,
  sink: CallSink,
  registry: Map<string, ToolHandler>,
  planMode: TurnGates = DEFAULT_GATES,
): Promise<IterationResult> {
  throwIfAborted(options.signal);

  const pending: PendingCall[] = [];
  /** Prose only — what the user reads. */
  let text = '';
  /** Prose *and* envelopes — what the model is shown of its own turn. */
  let raw = '';

  /*
   * `<proposed_plan>` handling, in Plan mode only.
   *
   * Upstream gates this the same way — `stream_events_utils.rs` computes
   * `let plan_mode = ctx.turn_context.mode() == Plan` before emitting plan
   * deltas — and the gate matters in both directions. Outside Plan mode the
   * block has no meaning and a model that mentions the tag in prose would open
   * a card for it; inside Plan mode the block is the deliverable and has to be
   * lifted out of the prose rather than read as part of it.
   */
  const planParser = planMode.streamProposedPlan ? new ProposedPlanParser() : null;
  let planCardId: string | null = null;
  let planMarkdown = '';

  const emitPlanSegments = (chunk: ReturnType<ProposedPlanParser['push']>): void => {
    for (const segment of chunk.extracted) {
      if (segment.kind === 'normal') {
        text += segment.text;
        sink.onText(segment.text);
      } else if (segment.kind === 'start') {
        planMarkdown = '';
        const call: ProposedPlanCall = {
          id: nextId('call'),
          kind: 'proposed-plan',
          status: 'running',
          startedAt: Date.now(),
          markdown: '',
        };
        planCardId = sink.emit(call);
        sink.activity('Writing the plan');
      } else if (segment.kind === 'delta') {
        planMarkdown += segment.text;
        if (planCardId) sink.patch(planCardId, { markdown: planMarkdown } as Partial<ToolCall>);
      } else if (planCardId) {
        sink.patch(planCardId, {
          markdown: planMarkdown,
          status: 'success',
          endedAt: Date.now(),
        } as Partial<ToolCall>);
        planCardId = null;
        sink.activity(null);
      }
    }
  };

  /*
   * One card per file in the envelope, in the order their headers arrived.
   *
   * A list rather than a single card: an envelope may touch several files, and
   * keeping only the latest orphaned every earlier card — it stayed "Creating…"
   * with a running timer forever, while the surviving card was filled in with a
   * *different* file's result. A two-file patch showed three cards, one of them
   * stuck and one mislabelled.
   */
  let liveEdits: LiveEdit[] = [];
  const patchObservations: string[] = [];

  const parser = new ResponseStreamParser({
    onText: (chunk) => {
      if (planParser) {
        emitPlanSegments(planParser.push(chunk));
        return;
      }
      text += chunk;
      sink.onText(chunk);
    },

    onPatchOpen: () => {
      sink.activity(planMode.refuseMutation ? 'Responding' : 'Editing files');
    },

    onPatchLine: (line) => {
      // In Plan mode nothing will be written, so no edit card is opened. A card
      // that appeared and then failed would read as a broken patch rather than
      // as the mode declining it.
      if (planMode.refuseMutation) return;

      // Surface the target file as soon as its header arrives, so the card
      // appears with a real name rather than "writing…".
      const header = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line.trim());
      if (header) {
        const kind =
          header[1] === 'Add' ? 'create' : header[1] === 'Delete' ? 'delete' : 'edit';
        const call: EditCall = {
          id: nextId('call'),
          kind,
          status: 'running',
          startedAt: Date.now(),
          path: header[2]!.trim(),
          added: 0,
          removed: 0,
          lines: [],
          revealed: 0,
        };
        liveEdits.push({
          id: sink.emit(call),
          path: safeNormalize(call.path),
          lines: 0,
        });
        return;
      }

      const current = liveEdits.at(-1);
      if (!current) return;
      if (/^[+\- ]/.test(line)) {
        current.lines += 1;
        sink.patch(current.id, { revealed: current.lines } as Partial<ToolCall>);
      }
    },

    onPatchClose: (envelope) => {
      /*
       * The half of the Plan mode boundary that instructions cannot cover.
       *
       * Upstream can leave "do not perform mutating actions" to the mode
       * document, because its `apply_patch` is a tool call it can refuse before
       * running. Willow's patches apply the instant the envelope closes,
       * mid-stream, to make the preview feel live — so by the time anything
       * could refuse, the files would already be written. Declining here is the
       * same outcome upstream gets from its read-only sandbox policy, and the
       * model is told plainly that nothing was written.
       */
      if (planMode.refuseMutation) {
        patchObservations.push(PLAN_MODE_PATCH_REFUSAL);
        liveEdits = [];
        return;
      }

      const observation = applyPatchEnvelope(envelope, options, sink, liveEdits);
      patchObservations.push(observation);
      liveEdits = [];
      sink.activity(null);
    },

    onCall: (name, body) => {
      pending.push({ name, body });
    },
  });

  const messages = conversation.map((entry) => ({
    role: entry.role,
    content: entry.content,
  })) as { role: 'user' | 'assistant'; content: string }[];

  // Instrumented here rather than in the turn loop, because the loop is not the
  // only caller — sub-agents run their own requests through this same path.
  const transport = instrumentTransport(options.transport ?? defaultTransport);

  await transport(
    messages,
    {
      ...options.model.options,
      // The harness owns tool use entirely. Provider-side search or code
      // execution would produce results this loop has no way to render.
      enableSearch: false,
      enableCodeExecution: false,
      signal: options.signal,
    },
    (token: string) => {
      raw += token;
      parser.push(token);
    },
    () => sink.activity('Responding'),
    systemPrompt,
    undefined,
    undefined,
    (thought: string) => sink.onThought(thought),
  );

  parser.end();
  // Resolves a half-buffered final line and closes an unterminated plan block,
  // so a stream that dies mid-plan still leaves a complete, rendered card.
  if (planParser) emitPlanSegments(planParser.finish());
  throwIfAborted(options.signal);

  const observations = [...patchObservations];

  /*
   * Calls run in the order the model emitted them, one at a time.
   *
   * This used to batch consecutive `task` calls into a `Promise.all`, because
   * `task` blocked and batching was the only way to get two helpers running at
   * once. `spawn_agent` returns immediately, so parallelism now comes from the
   * tool itself rather than from the dispatcher — which is both upstream's
   * design and strictly better: the model gets its agents running *and* keeps
   * its remaining calls in the order it wrote them.
   *
   * Order matters for the rest: two `read_file` calls the model emitted in
   * sequence may well be sequenced on purpose, and a `run_command` reordered
   * against a patch would be a different program.
   */
  for (const call of pending) {
    throwIfAborted(options.signal);
    observations.push(await runCall(call, registry, options, sink, planMode));
  }

  /*
   * The single worst failure this harness has: the model writes a file's
   * contents into its reply instead of applying them. The user sees code and
   * assumes it landed; nothing did.
   *
   * Prompting reduces it but cannot remove it — fenced code is the most
   * reinforced habit these models have. So it is detected and fed back as an
   * error, which sends the turn round again and the code lands as a real patch.
   */
  const loose = findLooseCode(text);
  if (loose.length > 0) {
    observations.push(looseCodeObservation(loose));
  }

  return {
    text,
    raw,
    observations,
    didWork: pending.length > 0 || patchObservations.length > 0,
    wantsMore:
      pending.length > 0 ||
      loose.length > 0 ||
      patchObservations.some((observation) => observation.startsWith('ERROR')),
  };
}

/** An edit card opened from a header line, waiting for its file's result. */
interface LiveEdit {
  id: string;
  /** Normalised, so it matches the path the applier reports back. */
  path: string;
  lines: number;
}

/**
 * The header path in the applier's own terms.
 *
 * A header can be malformed — that is what the parser is for — so a rejection
 * here is not fatal: the card simply will not match a change, and the envelope
 * fails as a whole a moment later.
 */
function safeNormalize(raw: string): string {
  try {
    return normalizePath(raw);
  } catch {
    return raw.trim();
  }
}

/**
 * Applies a completed patch envelope and reports the result to the model.
 *
 * Errors are returned as observations rather than thrown: a malformed patch is
 * a normal, recoverable event, and the model fixes it far more reliably when it
 * gets the parser's actual complaint back.
 */
function applyPatchEnvelope(
  envelope: string,
  options: TurnOptions,
  sink: CallSink,
  liveEdits: LiveEdit[],
): string {
  try {
    const ops = parsePatch(envelope);
    const before = options.files();
    const { files, changes } = applyPatch(before, ops);
    options.writeFiles(files);

    // Each change completes the card opened for that same file. Matching on the
    // path rather than on position keeps a card with its own file even if the
    // applier reorders or coalesces operations.
    const unclaimed = [...liveEdits];
    const claim = (path: string): LiveEdit | undefined => {
      const index = unclaimed.findIndex((edit) => edit.path === path);
      return index === -1 ? undefined : unclaimed.splice(index, 1)[0];
    };

    changes.forEach((change) => {
      const lines = renderDiff(change);
      const patch: Partial<EditCall> = {
        kind: change.kind === 'add' ? 'create' : change.kind === 'delete' ? 'delete' : 'edit',
        path: change.movePath ?? change.path,
        movePath: change.movePath,
        added: change.added,
        removed: change.removed,
        lines,
        revealed: lines.length,
        status: 'success',
        endedAt: Date.now(),
      };

      const opened = claim(change.path);
      if (opened) {
        sink.patch(opened.id, patch as Partial<ToolCall>);
      } else {
        sink.emit({
          id: nextId('call'),
          kind: patch.kind!,
          status: 'success',
          startedAt: Date.now(),
          endedAt: Date.now(),
          path: patch.path!,
          movePath: change.movePath,
          added: change.added,
          removed: change.removed,
          lines,
          revealed: lines.length,
        } as EditCall);
      }
    });

    // A card whose file produced no change would otherwise spin forever.
    for (const orphan of unclaimed) {
      sink.patch(orphan.id, {
        status: 'success',
        endedAt: Date.now(),
      } as Partial<ToolCall>);
    }

    const summary = changes
      .map(
        (change) =>
          `${change.kind} ${change.movePath ?? change.path} (+${change.added} -${change.removed})` +
          (change.fuzz > 0 ? ` [matched with fuzz level ${change.fuzz}]` : ''),
      )
      .join('\n');

    return `Patch applied:\n${summary}\n\nThe preview has reloaded.`;
  } catch (error) {
    const message =
      error instanceof PatchParseError
        ? `The patch could not be parsed (line ${error.line}): ${error.message}`
        : error instanceof PatchApplyError
          ? `The patch could not be applied to ${error.path}: ${error.message}`
          : `The patch failed: ${(error as Error).message}`;

    // Every card opened for this envelope fails with it — the envelope is
    // applied as one unit, so none of the files were written. Failing only the
    // last one would leave the others spinning.
    for (const edit of liveEdits) {
      sink.patch(edit.id, {
        status: 'error',
        endedAt: Date.now(),
        error: message,
      } as Partial<ToolCall>);
    }

    return `ERROR ${message}`;
  }
}

/** Executes one `*** Call:` envelope. */
async function runCall(
  call: PendingCall,
  registry: Map<string, ToolHandler>,
  options: TurnOptions,
  sink: CallSink,
  planMode: TurnGates = DEFAULT_GATES,
): Promise<string> {
  const name = call.name.trim();

  const refusal = refusalFor(name);
  if (refusal) return `ERROR ${name}: ${refusal}`;

  /*
   * `apply_patch` is allowed, has no call handler, and never did.
   *
   * It is applied from the patch envelope mid-stream, so `registry` has no
   * entry for it — and a model that wrapped a patch in `*** Call: apply_patch`
   * used to get "Unknown tool "apply_patch". Available tools: read_file, …",
   * which lists `apply_patch` nowhere and reads as though patching were
   * impossible. Models responded by giving up on the edit or by pasting the
   * file into their reply. Naming the actual mistake costs one branch.
   */
  if (name === 'apply_patch') {
    return (
      'ERROR apply_patch is not invoked through a call envelope. Emit the patch ' +
      'directly, starting with `*** Begin Patch` on its own line and ending with ' +
      '`*** End Patch`, with no `*** Call:` wrapper and no code fence around it.'
    );
  }

  // Plan mode's tool half. `update_plan` gets its own message because upstream
  // gives it one and the mode document promises that exact error.
  if (planMode.refuseMutation) {
    if (name === 'update_plan') return `ERROR ${UPDATE_PLAN_IN_PLAN_MODE_ERROR}`;
    if (isMutatingTool(name)) return `ERROR ${planModeMutationRefusal(name)}`;
  }

  /*
   * A tool that exists but is not available this turn.
   *
   * The distinction is the whole reason `ALLOWED_TOOLS` is a superset of what
   * `toolsForTurn` registers. `request_user_input` in Default mode used to come
   * back as `Unknown tool "request_user_input". Available tools: read_file, …`
   * — a list that does not contain it, from a harness that plainly does. A
   * model reading that concludes the capability does not exist; a model told
   * "unavailable in Default mode" knows to carry on without it, which is
   * exactly what upstream's message is for.
   */
  if (isAllowed(name) && !registry.has(name)) {
    const unavailable = requestUserInputUnavailableMessage(planMode.mode);
    if (name === 'request_user_input' && unavailable) {
      return `ERROR ${unavailable}`;
    }
    if (GOAL_TOOLS.includes(name as ToolId)) {
      return (
        `ERROR ${name} is unavailable because this thread has no goal session. ` +
        'Goal mode is started by the user, not from here.'
      );
    }
  }

  if (!isAllowed(name) || !registry.has(name)) {
    return (
      `ERROR Unknown tool ${JSON.stringify(name)}. Available tools: ` +
      `${[...registry.keys()].join(', ')}.`
    );
  }

  let args: Record<string, unknown>;
  try {
    args = parseCallBody(call.body);
  } catch (error) {
    return `ERROR ${name}: ${(error as Error).message}`;
  }

  sink.activity(ACTIVITY[name] ?? 'Working');

  const context: ToolContext = {
    readFiles: options.files,
    writeFiles: options.writeFiles,
    signal: options.signal,
    emit: sink.emit,
    patch: sink.patch,
  };

  // Timed, because this is where a turn spends the time that is not a model
  // request — `computer_use` runs its own model session, which never passes
  // through the instrumented transport and would otherwise be an unexplained
  // gap between two rounds.
  const finish = beginToolLog(name);

  try {
    const result: ToolResult = await registry.get(name)!.run(args, context);
    sink.activity(null);
    finish(result.failed ? new Error(result.observation) : undefined);
    return result.failed ? `ERROR ${name}: ${result.observation}` : result.observation;
  } catch (error) {
    sink.activity(null);
    finish(error);
    if (error instanceof Cancelled) throw error;
    return `ERROR ${name} threw: ${(error as Error).message}`;
  }
}

const ACTIVITY: Record<string, string> = {
  read_file: 'Reading files',
  list_files: 'Listing files',
  search_files: 'Searching',
  update_plan: 'Planning',
  add_dependency: 'Adding a dependency',
  'skills.list': 'Listing skills',
  'skills.read': 'Reading a skill',
  request_user_input: 'Waiting for you',
  get_goal: 'Checking the goal',
  create_goal: 'Setting the goal',
  update_goal: 'Updating the goal',
  spawn_agent: 'Starting an agent',
  send_message: 'Messaging an agent',
  followup_task: 'Re-tasking an agent',
  interrupt_agent: 'Interrupting an agent',
  list_agents: 'Checking on agents',
  /*
   * `wait_agent` deliberately has no label.
   *
   * It is the one tool whose whole job is to do nothing for a while, and an
   * activity line saying so would sit there for up to an hour looking stuck.
   * Spark's runtime doc records the same rule for the same reason.
   */
};

/* ------------------------------------------------------------------------ */
/* Call sinks                                                                */
/* ------------------------------------------------------------------------ */

/*
 * `CallSink` now lives in `protocol.ts`.
 *
 * It is the seam `collaboration.ts` runs agents through, and both modules
 * importing it from the protocol is what keeps them from importing each other.
 */

function mainSink(onEvent: (event: HarnessEvent) => void): CallSink {
  return {
    onText: (chunk) => onEvent({ type: 'text', chunk }),
    onThought: (chunk) => onEvent({ type: 'thought', chunk }),
    emit: (call) => {
      onEvent({ type: 'call-start', call });
      return call.id;
    },
    patch: (id, patch) => onEvent({ type: 'call-progress', id, patch }),
    activity: (label) => onEvent({ type: 'activity', label }),
  };
}

/*
 * `agentSink` used to live here. It is now `CollaborationRuntime`'s own private
 * method, because an agent's card is the runtime's business — it owns the
 * record, so it owns the writes to it.
 */

/* ------------------------------------------------------------------------ */
/* Sub-agents                                                                */
/* ------------------------------------------------------------------------ */

/**
 * Builds the collaboration runtime for one turn.
 *
 * This replaced a single `task` tool that blocked until its helper finished.
 * See `collaboration.ts` for why that could not stand — briefly: `task` exists
 * nowhere in codex-rs, and a blocking helper cannot deliver the one thing
 * delegation is for, which is that the parent keeps working.
 *
 * Every agent, at every depth, gets the same six tools. That is upstream's rule
 * and it is what makes the tree deeper than one level.
 */
function makeCollaboration(
  options: TurnOptions,
  baseSystemPrompt: string,
  allowed: ReadonlySet<string>,
): CollaborationRuntime {
  const runtime: CollaborationRuntime = new CollaborationRuntime({
    runIteration: (conversation, systemPrompt, sink, registry, gates) =>
      runIteration(conversation, systemPrompt, options, sink, registry, gates),

    buildRegistry: (collaborationTools, agentPath) =>
      toolRegistry(
        [
          ...collaborationTools,
          // Host tools travel down too: an agent that cannot look at the
          // preview cannot check its own work.
          ...(options.extraTools ?? []),
        ].filter((tool) => allowed.has(tool.id)),
        // `request_user_input` is withheld from every non-root agent, exactly
        // as upstream withholds it: `session_source.is_non_root_agent()` gets
        // "can only be used by the root thread". A delegated agent has no user.
        new Set([...allowed].filter((id) => id !== 'request_user_input')),
      ),

    systemPromptFor: (agentPath) =>
      [
        baseSystemPrompt,
        '# Multi-agent collaboration',
        '',
        `<multi_agent_identity>You are \`${agentPath}\`.</multi_agent_identity>`,
        '',
        SUBAGENT_USAGE_HINT,
        '',
        WAIT_AGENT_USAGE_HINT,
        '',
        SHARED_USAGE_HINT,
      ].join('\n'),

    projectContext: () => projectContext(options.files()),
    compactForHistory,
    onEvent: options.onEvent,
    modelLabel: options.model.label,
    maxConcurrent: options.model.effort?.harness?.maxConcurrentAgents,
    maxIterations: MAX_SUBAGENT_ITERATIONS,
    gates: gatesFor(options.mode ?? 'default', /* isRootThread */ false),
    signal: options.signal,
  });

  return runtime;
}

/* ------------------------------------------------------------------------ */
/* Public entry point                                                        */
/* ------------------------------------------------------------------------ */

/** Why one bounded iteration loop stopped. */
type StopReason = 'model-finished' | 'iteration-budget';

/**
 * Runs the bounded iteration loop until the model stops calling tools.
 *
 * Extracted from `runTurn` because Goal mode needs to run it more than once:
 * the user's turn is one pass, and each automatic continuation is another. The
 * conversation array is shared across passes, which is what makes a
 * continuation a continuation rather than a fresh session.
 */
async function runIterations(
  conversation: { role: 'user' | 'assistant'; content: string }[],
  systemPrompt: string,
  options: TurnOptions,
  sink: CallSink,
  registry: Map<string, ToolHandler>,
  planMode: TurnGates,
  /**
   * The collaboration tree, so the root's mailbox can be drained between
   * iterations. Without this an agent's final answer would never reach the
   * agent that spawned it.
   */
  collaboration: CollaborationRuntime | undefined,
  /** Stops early once the model has ended the goal, so a `complete` call is final. */
  shouldStop: () => boolean = () => false,
): Promise<StopReason> {
  // Effort buys tool-call rounds, not just a bigger reasoning parameter. At
  // `low` a turn that keeps calling tools is usually stuck; at `ultra` it is
  // usually working. One fixed ceiling cannot serve both.
  const budget = options.model.effort?.harness?.maxIterations ?? MAX_ITERATIONS;

  /** Whether the "you announced but did not act" nudge has been spent. */
  let nudged = false;

  for (let iteration = 0; iteration < budget; iteration += 1) {
    const result = await runIteration(
      conversation,
      systemPrompt,
      options,
      sink,
      registry,
      planMode,
    );

    /*
     * The root's mailbox.
     *
     * Agents post here when they finish, and `send_message` posts here when one
     * agent writes to another. Draining it into this iteration's observations
     * is how a delegated result actually reaches the agent that asked for it —
     * `wait_agent` only ever reports *that* there is news.
     */
    const inbound = collaboration?.takeMailbox(ROOT_AGENT_PATH) ?? [];

    if (!result.wantsMore && inbound.length === 0) {
      /*
       * A response with no tool call is normally the answer. But a model on a
       * text protocol can describe the envelope instead of emitting one, and
       * end its message mid-flow — "Let's start by creating the project
       * plan." — which ends the turn looking successful with nothing written.
       *
       * One nudge, and only when nothing ran this iteration. If it still
       * emits nothing it has nothing to emit, and asking twice would spend
       * the user's budget on it.
       *
       * Not in Plan mode: there, announcing without acting is the *correct*
       * behaviour. The mode forbids acting.
       */
      if (
        !nudged &&
        !planMode.refuseMutation &&
        !result.didWork &&
        announcedWithoutActing(result.text)
      ) {
        nudged = true;
        options.onEvent({ type: 'text', chunk: '\n\n' });
        conversation.push({ role: 'assistant', content: compactForHistory(result.raw) });
        conversation.push({ role: 'user', content: CONTINUE_OBSERVATION });
        continue;
      }

      /*
       * The model is done, but its agents may not be.
       *
       * Upstream would end the turn here and let them run on, because its
       * session outlives the turn and the user can watch them. Willow has
       * nowhere to watch: resolving now unlocks the composer and reports the
       * turn finished, and the agents would then rewrite the user's files
       * afterwards. So the turn stays open until the tree is quiet, and the
       * results come back as one more iteration.
       */
      if (collaboration?.hasLiveAgents()) {
        options.onEvent({ type: 'activity', label: 'Waiting for agents' });
        await collaboration.drain();
        const settled = collaboration.takeMailbox(ROOT_AGENT_PATH);
        if (settled.length > 0) {
          conversation.push({
            role: 'assistant',
            content: compactForHistory(result.raw),
          });
          conversation.push({
            role: 'user',
            content: settled.map(renderEnvelope).join('\n\n---\n\n'),
          });
          options.onEvent({ type: 'activity', label: null });
          continue;
        }
        options.onEvent({ type: 'activity', label: null });
      }

      return 'model-finished';
    }

    // The next iteration's prose streams straight onto the end of this one's.
    // Without a break the two run together mid-sentence — "…before scaffolding
    // the application.I will now set up…" — because each iteration is a
    // separate completion but one continuous transcript.
    if (result.text.trim() !== '') {
      options.onEvent({ type: 'text', chunk: '\n\n' });
    }

    // `raw`, not `text`: the model must see the envelopes it emitted, or it
    // cannot tell what produced the observation that follows.
    conversation.push({ role: 'assistant', content: compactForHistory(result.raw) });
    conversation.push({
      role: 'user',
      content: [...result.observations, ...inbound.map(renderEnvelope)].join('\n\n---\n\n'),
    });

    // A `update_goal` call that landed ends the turn now rather than after
    // another round of the model narrating what it just did.
    if (shouldStop()) return 'model-finished';
  }

  return 'iteration-budget';
}

/**
 * Runs one user turn to completion.
 *
 * Resolves normally on cancellation — a cancelled turn is a user action, not an
 * error — and reports everything else through a `turn-end` event so the UI has
 * exactly one place to handle failure.
 *
 * ## In Goal mode this is more than one turn
 *
 * With `options.goal` set, the loop below is upstream's `continue_if_idle`: the
 * model stops, the goal is still `active`, so another turn begins whose only
 * input is the rendered `continuation.md`. It ends when the model marks the goal
 * `complete` or `blocked`, when the budget runs out, or when the continuation
 * cap is reached.
 */
export async function runTurn(options: TurnOptions): Promise<void> {
  const sink = mainSink(options.onEvent);
  const mode: ModeKind = options.mode ?? 'default';
  const goal = options.goal;
  /**
   * Declared out here so the `catch` can abort the tree.
   *
   * A failed or cancelled root turn must not leave agents running: they hold
   * the file map and would keep writing into a project whose turn already
   * ended.
   */
  let collaboration: CollaborationRuntime | undefined;

  try {
    /*
     * Inside the `try`, and this is the fix for a real hang.
     *
     * `getHarnessProfile()` throws `OverlayAnchorError` when an upstream
     * upgrade moves a section the overlay depends on — which is by design, it
     * is the loud failure the overlay exists to produce. But it used to be
     * called *above* the try, so the rejection escaped `runTurn` entirely: no
     * `turn-end` event was ever emitted, the caller's `onDone` never ran, and
     * the composer sat spinning on a turn that had already failed. The error
     * belongs in the transcript like any other.
     */
    const goalContext = goal?.contextSection();
    const skills = options.skills ?? [];
    const skillsCatalog = renderSkillsSection(skills);
    const mcpTools = options.mcpTools ?? [];
    const mcpCatalog = renderMcpSection(mcpTools);

    const systemPrompt = composeSystemPrompt({
      mode,
      multiAgentMode: options.model.effort?.harness?.multiAgentMode ?? EXPLICIT_REQUEST_ONLY,
      skillsCatalog,
      mcpCatalog,
      goalContext,
    });

    /*
     * The root's identity, and its own usage hint.
     *
     * Upstream sends `ROOT_AGENT_USAGE_HINT` to the root and
     * `SUBAGENT_USAGE_HINT` to everyone else. They differ in more than tone:
     * the root's says "At the start of your turn, you are the active agent" and
     * lists two message types, while an agent's says its final channel is
     * delivered to its parent and lists three. Sending the wrong one leaves the
     * model wrong about who it is talking to.
     */
    const rootPrompt = [
      systemPrompt,
      '# Multi-agent collaboration',
      '',
      ROOT_USAGE_HINT,
      '',
      WAIT_AGENT_USAGE_HINT,
      '',
      SHARED_USAGE_HINT,
    ].join('\n');

    const planMode = gatesFor(mode);

    /*
     * Only the tools this turn is entitled to.
     *
     * `toolsForTurn` is the gate; everything it excludes still resolves to a
     * mode-aware refusal in `runCall`, because "unavailable in Default mode" is
     * a recoverable answer and "unknown tool" is not.
     */
    const allowed = new Set([
      ...(toolsForTurn({
        mode,
        goalActive: Boolean(goal),
        skillsAvailable: skills.length > 0,
      }) as string[]),
      // MCP tools are whatever the user connected, so they join the allow-set
      // for this turn rather than being listed at build time.
      ...mcpTools.map((tool) => tool.qualifiedName),
    ]);

    /*
     * The collaboration tree for this turn.
     *
     * Created before the registry because the root's own six tools come out of
     * it, bound to `/root` — which is what makes a relative target like
     * `explore` resolve to `/root/explore` for the root and to
     * `/root/explore/x` for an agent one level down.
     */
    collaboration = makeCollaboration(options, systemPrompt, allowed);

    /*
     * Declared before the registry, and read through a thunk.
     *
     * `spawn_agent`'s `fork_turns` slices whatever the root's conversation is
     * *at the moment of the call*, so the tool cannot be handed a snapshot
     * taken when the registry was built — that array is still empty here.
     */
    const conversation: { role: 'user' | 'assistant'; content: string }[] = [];

    const registry = toolRegistry(
      [
        ...collaboration.tools(ROOT_AGENT_PATH, () => conversation),
        makeRequestUserInputTool(mode, options.requestUserInput),
        ...(goal ? goalTools(goal, sink) : []),
        ...makeSkillTools(skills),
        ...makeMcpToolHandlers(mcpTools),
        ...(options.extraTools ?? []),
      ].filter((tool) => allowed.has(tool.id)),
      allowed,
    );

    for (const message of options.history) {
      const text = messageText(message);
      if (text) conversation.push({ role: message.role, content: text });
    }

    /*
     * Skills the user named with `$name`.
     *
     * The catalog's trigger rules already say a named skill "must" be used this
     * turn, but a mention is a stronger signal than a description match and
     * upstream treats it as one — so the resolved names are restated with the
     * locator the model needs to fetch them. Without the locator it has to
     * scan the catalog to turn `$BrandVoice` back into `skill://brand-voice`,
     * which it sometimes gets wrong when two skills share a word.
     */
    const mentioned = skills.length > 0 ? skillsMentionedIn(options.prompt, skills) : [];
    const mentionNote =
      mentioned.length > 0
        ? `<mentioned_skills>\nThe user named ${mentioned.length === 1 ? 'this skill' : 'these skills'}. Read ${mentioned.length === 1 ? 'it' : 'them'} with \`skills.read\` before acting:\n` +
          mentioned.map((skill) => `- ${skill.name} — package: skill://${skill.id}`).join('\n') +
          '\n</mentioned_skills>'
        : '';

    conversation.push({
      role: 'user',
      content: [projectContext(options.files()), mentionNote, options.prompt]
        .filter(Boolean)
        .join('\n\n'),
    });

    goal?.beginTurn();

    const stopped = await runIterations(
      conversation,
      rootPrompt,
      options,
      sink,
      registry,
      planMode,
      collaboration,
      () => Boolean(goal?.wasEndedByModel()),
    );

    if (!goal) {
      finishTurn(options, stopped);
      return;
    }

    /* ------------------------------------------------------------------ */
    /* Goal mode: automatic continuations                                  */
    /* ------------------------------------------------------------------ */

    goal.finishTurn(options.reportedTokens?.());
    if (!goal.wasEndedByModel()) goal.noteTurnWithoutBlockedClaim();
    options.onEvent({ type: 'goal', goal: goal.current() });

    const limit = options.maxGoalContinuations ?? MAX_GOAL_CONTINUATIONS;

    for (let index = 1; index <= limit; index += 1) {
      throwIfAborted(options.signal);
      if (goal.wasEndedByModel() || isGoalFinished(goal.current())) break;

      const steering = goal.nextSteeringPrompt();
      if (!steering) break;

      // `budget_limited` gets exactly one wrap-up turn. Noting it before the
      // turn runs means the loop stops after it rather than steering again on
      // a status that has not changed.
      const wasBudgetLimited = goal.current()?.status === 'budget_limited';

      options.onEvent({ type: 'goal-continuation', index, limit });
      options.onEvent({ type: 'text', chunk: '\n\n' });

      conversation.push({ role: 'user', content: steering });

      goal.beginTurn();
      /*
       * The pass's own stop reason is deliberately discarded.
       *
       * A continuation that exhausts its iteration budget is not the end of the
       * goal — the goal decides that, and the next pass picks up where this one
       * stopped. What ends the loop is the goal's status or the cap below.
       */
      await runIterations(
        conversation,
        // Re-composed each pass: the goal's budget has moved, and the
        // continuation document quotes it. The collaboration hints are
        // re-appended for the same reason the mode is — every turn carries them.
        [
          composeSystemPrompt({
            mode,
            multiAgentMode:
              options.model.effort?.harness?.multiAgentMode ?? EXPLICIT_REQUEST_ONLY,
            skillsCatalog,
            goalContext: goal.contextSection(),
          }),
          '# Multi-agent collaboration',
          '',
          ROOT_USAGE_HINT,
          '',
          WAIT_AGENT_USAGE_HINT,
          '',
          SHARED_USAGE_HINT,
        ].join('\n'),
        options,
        sink,
        registry,
        planMode,
        collaboration,
        () => goal.wasEndedByModel(),
      );
      goal.finishTurn(options.reportedTokens?.());
      if (!goal.wasEndedByModel()) goal.noteTurnWithoutBlockedClaim();
      options.onEvent({ type: 'goal', goal: goal.current() });

      if (wasBudgetLimited) break;
    }

    const finalGoal = goal.current();
    if (finalGoal && !isGoalFinished(finalGoal) && finalGoal.status === 'active') {
      // The cap, not the goal, ended this. Say so — the goal is still live and
      // the user can resume it, which is different from it having failed.
      options.onEvent({
        type: 'text',
        chunk:
          `\n\nI stopped after ${limit} automatic turns on this goal. The goal is ` +
          'still active and the work so far is applied — send a message to continue it.',
      });
      options.onEvent({
        type: 'turn-end',
        reason: 'complete',
        stopReason: 'goal-continuation-budget',
      });
      return;
    }

    options.onEvent({ type: 'turn-end', reason: 'complete', stopReason: 'goal-ended' });
  } catch (error) {
    // Agents outlive the statement that started them, so they have to be
    // stopped explicitly. Left running they would keep writing into a project
    // whose turn has already ended.
    collaboration?.cancelAll();

    if (error instanceof Cancelled || options.signal?.aborted) {
      options.goal?.stopForError('blocked');
      options.onEvent({ type: 'goal', goal: options.goal?.current() ?? null });
      options.onEvent({ type: 'turn-end', reason: 'cancelled' });
      return;
    }
    // A goal that keeps steering into the same failing request would spend the
    // user's budget on it, so a hard error stops the goal too.
    options.goal?.stopForError('blocked');
    if (options.goal) options.onEvent({ type: 'goal', goal: options.goal.current() });
    options.onEvent({
      type: 'turn-end',
      reason: 'error',
      error: (error as Error).message,
    });
  }
}

/** The non-goal ending, with the stop reason the caller could not infer before. */
function finishTurn(options: TurnOptions, stopped: StopReason): void {
  if (stopped === 'iteration-budget') {
    // Budget exhausted. Tell the model's audience, not just the console.
    options.onEvent({
      type: 'text',
      chunk:
        '\n\nI stopped after reaching the tool-call limit for one turn. ' +
        'The work so far is applied — send another message to continue.',
    });
    options.onEvent({
      type: 'turn-end',
      reason: 'complete',
      stopReason: 'iteration-budget',
    });
    return;
  }
  options.onEvent({ type: 'turn-end', reason: 'complete', stopReason: 'model-finished' });
}

/**
 * Wraps the goal tools so each call also leaves a card in the transcript.
 *
 * A goal that changed state invisibly would be the worst version of this
 * feature: the harness would keep starting turns the user did not send, with
 * nothing in the transcript explaining why.
 */
function goalTools(goal: GoalRuntime, sink: CallSink): ToolHandler[] {
  const ACTIONS = { get_goal: 'get', create_goal: 'create', update_goal: 'update' } as const;

  return goal.tools().map((tool) => ({
    id: tool.id,
    async run(args, context) {
      const result = await tool.run(args, context);
      const snapshot = goal.current();

      const card: GoalCall = {
        id: nextId('call'),
        kind: 'goal',
        action: ACTIONS[tool.id as keyof typeof ACTIONS] ?? 'get',
        status: result.failed ? 'error' : 'success',
        startedAt: Date.now(),
        endedAt: Date.now(),
        error: result.failed ? result.observation : undefined,
        objective: snapshot?.objective,
        goalStatus: snapshot?.status,
        tokenBudget: snapshot?.tokenBudget,
        tokensUsed: snapshot?.tokensUsed,
      };
      sink.emit(card);

      return result;
    },
  }));
}
