/**
 * The Spark turn loop.
 *
 * This is the harness proper: it owns the conversation with the model, the
 * segmentation of its output, the execution of tools, and the events the UI
 * renders. `platform/ai` is used only to move bytes to and from a provider —
 * every decision about *what* the agent does is made here.
 *
 * ## Shape of a turn
 *
 * A turn is an open-ended loop. Each iteration streams one model response; patches
 * apply the instant their envelope closes, so the preview updates while the
 * model is still writing. Calls that need a result are collected after the
 * stream ends. The loop stops when the model completes, the turn is cancelled,
 * or its explicit goal lifecycle ends. Spark imposes no artificial round cap.
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

import type { AiOptions, StreamPhase, TokenUsage } from '@willow/ai/chat';
import { getHarnessProfile, type HarnessProfile } from '../overlay/profile';
import { isAllowed, refusalFor } from '../overlay/tool-policy';
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
import { resolveEffort, type CodexEffort } from '../overlay/effort';
import type { SparkGoalRuntime } from './goal';
import type {
  AgentKind,
  EditCall,
  HarnessEvent,
  Message,
  SubAgent,
  SubAgentTimelineEntry,
  ToolCall,
  WebSearchCall,
  CodeExecutionCall,
  ToolContext,
  ToolHandler,
  ToolResult,
} from './protocol';

const FINAL_RESPONSE_OBSERVATION =
  'The work batch is complete, but the user-facing answer has not been emitted yet. ' +
  'Write `*** Final Response` on its own line now, followed by the complete answer. ' +
  'Do not call another tool or add another progress update unless the work is genuinely incomplete.';
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
    /** Numeric Willow request level for the effective wire effort. */
    level: number;
    clamped: boolean;
    /** Working guidance derived from the requested effort level. */
    harness?: {
      guidance: string;
      /**
       * Upstream derives this from effort: `ultra` → proactive, everything
       * else → on request. It is what Ultra actually *is* — the reasoning
       * parameter is already at the model's ceiling by then.
       */
      delegation?: 'proactive' | 'on-request';
      multiAgentVersion?: 'v1' | 'v2' | null;
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
  onPhase?: (phase: StreamPhase) => void,
  onToolCall?: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  onThought?: (thought: string) => void,
  onUsage?: (usage: TokenUsage) => void,
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
  /** Spark supplies its own capability-aware profile; Code Beta-style callers may omit it. */
  profile?: Pick<HarnessProfile, 'systemPrompt'>;
  /** Shared persisted goal state for this Spark task/thread. */
  goalRuntime?: SparkGoalRuntime;
  /** Spark thread key used to preserve native collaboration state across turns. */
  collaborationThreadId?: string;
  /** Native Gemini declarations; text-protocol providers use the same handlers. */
  toolDeclarations?: { functionDeclarations: Record<string, unknown>[] }[];
}

const isUsageLimitError = (error: unknown): boolean => {
  const value = error as any;
  const text = [value?.name, value?.code, value?.message, value?.error?.code, value?.error?.message]
    .filter((part) => part !== undefined && part !== null)
    .join(' ')
    .toLowerCase();
  return /\b429\b|rate.?limit|resource.?exhausted|token.?limit|context.?length|max.?output|quota|usage.?limit|budget.?limit|too many tokens/.test(text);
};

/**
 * The default transport: `platform/ai`'s `streamChat`.
 *
 * Imported lazily rather than at module scope. `chat.ts` pulls in the Google,
 * OpenAI and Anthropic SDKs, and a static import would drag all three into the
   * Spark chunk — and into any test that touches this module — even when a
 * caller supplies its own transport.
 */
const defaultTransport: Transport = async (...args) => {
  const { streamChat } = await import('@willow/ai/chat');
  const [messages, options, onToken, onStart, systemPrompt, onPhase, onToolCall, onThought, onUsage] = args;
  return streamChat(
    messages,
    options,
    onToken,
    onStart,
    systemPrompt,
    onPhase,
    onToolCall,
    onThought,
    undefined,
    undefined,
    onUsage,
  );
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

const isWorkRequest = (prompt: string): boolean =>
  /\b(file|files|folder|workspace|patch|edit|修改|write|create file|delete file|rename file|move file|run command|shell|terminal|script|build|debug|code|source|repository|repo|package\.json|typescript|javascript|css|html)\b/i.test(prompt);

const isCasualConversation = (prompt: string): boolean => {
  const normalized = prompt.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!normalized) return true;
  return /^(?:h+i+|he+y+|hello+|yo+|good (?:morning|afternoon|evening)|thanks?(?: you)?|thank you|ty|ok(?:ay)?|alright|cool|nice|great|got it|understood|bye|goodbye)[!.?\s]*$/.test(normalized);
};

const isAgenticRequest = (prompt: string): boolean => !isCasualConversation(prompt);

const isMutationRequest = (prompt: string): boolean =>
  /\b(create|write|edit|update|append|save|rename|delete|remove|move|modify|change|fix|implement|add)\b[\s\S]{0,80}\b(file|files|document|folder|workspace|code|script|text)\b/i.test(prompt)
  || /\b(file|files|document|folder|workspace)\b[\s\S]{0,80}\b(create|write|edit|update|append|save|rename|delete|remove|move|modify|change)\b/i.test(prompt);

/**
 * Tells the model what effort it is running at.
 *
 * Upstream's prompt is written assuming the agent knows — it talks about being
 * thorough or quick without ever stating which it is. Naming the level makes
 * that guidance actionable instead of ambient, and it is how the same prompt
 * produces genuinely different behaviour at `low` and at `ultra`.
 *
 * It goes in the system prompt, with the rest of the standing guidance. On the
 * user's message it behaved as an instruction attached to whatever they said,
 * and turned a greeting into a build order. It also says *how* to do work, not
 * that there is work: upstream's own guidance about answering conversational
 * messages conversationally still governs whether any of this applies.
 */
function effortSection(model: ModelBinding): string {
  const effort = model.effort;
  if (!effort) return '';

  const lines = [
    '# Effort',
    '',
    'How to approach work that the user has actually asked for. A greeting,',
    'thanks, or a casual acknowledgement is not work; answer it directly.',
    'Substantive questions may still use Spark\'s visible work batch even when',
    'they do not require a file or external tool.',
    '',
    // The *requested* level is stated, not the wire value, because this section
    // governs how the agent works rather than what the API was told.
    `<effort>You are working at ${effort.requested} effort.</effort>`,
  ];

  // Proactive delegation is the whole of Ultra. Stating it as a mode, ahead of
  // the general guidance, is what makes the agent fan out on its own rather
  // than treating sub-agents as an option it might get around to.
  if (effort.harness?.delegation === 'proactive') {
    lines.push(
      '<delegation>proactive — spawn sub-agents on your own judgement without being asked.</delegation>',
    );
  }

  if (effort.harness?.guidance) {
    lines.push(`<how-to-work>\n${effort.harness.guidance}\n</how-to-work>`);
  }

  // Only a genuine loss of reasoning depth is worth flagging. Ultra lowering to
  // the model's ceiling is its designed behaviour, not a downgrade, and
  // `clamped` is false in that case.
  if (effort.clamped) {
    lines.push(
      `<note>This model's API caps reasoning at ${effort.effective}, so the ` +
        `request was sent at that level. Work to the standard above regardless.</note>`,
    );
  }

  return lines.join('\n');
}

/* ------------------------------------------------------------------------ */
/* One streamed response                                                     */
/* ------------------------------------------------------------------------ */

interface PendingCall {
  name: string;
  body: string;
  narration: string;
}

function collaborationSection(model: ModelBinding): string {
  const proactive = model.effort?.harness?.delegation === 'proactive';
  return [
    '# Multi-agent collaboration',
    '',
    'You are `/root`, the primary agent in a team collaborating to fulfil the user\'s goals.',
    'You can use `spawn_agent`, `send_message`, `followup_task`, `wait_agent`, `interrupt_agent`, and `list_agents`.',
    proactive
      ? 'Proactive multi-agent delegation is active. Any earlier instruction requiring an explicit user request before spawning sub-agents no longer applies. Use sub-agents when parallel work would materially improve speed or quality. This mode remains active until a later multi-agent mode message changes it.'
      : 'Any earlier instruction enabling proactive multi-agent delegation no longer applies. Do not spawn sub-agents unless the user or applicable AGENTS.md/skill instructions explicitly ask for sub-agents, delegation, or parallel agent work.',
  ].join('\n');
}

interface IterationResult {
  /** Everything the model said, envelopes stripped. */
  text: string;
  /**
   * Everything the model emitted, envelopes included.
   *
   * This, not `text`, is what goes back as the assistant turn. Feeding back the
   * stripped prose hid the model's own tool calls from it: the transcript then
   * showed it narrating, followed by an observation with nothing that could
   * have produced it. Models reconcile that by trying to close an envelope they
   * cannot see, and the transcript fills with orphan `*** End Call` markers.
   */
  raw: string;
  /** Observations to feed back, in order. */
  observations: string[];
  /** True when anything actually ran or changed a file this iteration. */
  didWork: boolean;
  /** True when this iteration produced a successful workspace mutation. */
  didMutate: boolean;
  /** True when the model emitted at least one call needing a result. */
  wantsMore: boolean;
  /** The work batch ended without the explicit final-answer boundary. */
  needsFinalResponse: boolean;
  /** A real tool, Patch, or provider operation ran in this iteration. */
  performedAction: boolean;
}

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
): Promise<IterationResult> {
  throwIfAborted(options.signal);

  const pending: PendingCall[] = [];
  let nativeMutated = false;
  let nativeToolUsed = false;
  let goalControlUsed = false;
  let workBatchStarted = false;
  let finalResponseStarted = false;
  let finalText = '';
  let reportedProviderTokens = 0;
  const finalResponseBoundaryEnabled = systemPrompt.includes('*** Final Response');
  /** Prose only — what the user reads. */
  let text = '';
  /** Prose *and* envelopes — what the model is shown of its own turn. */
  let raw = '';
  let workLogOffset = 0;
  let callTextOffset = 0;
  const fallbackWorkTitle = (): string => {
    const prompt = options.prompt.replace(/\s+/g, ' ').trim();
    if (!prompt) return 'Working through your request';
    const phrase = prompt.length > 72 ? `${prompt.slice(0, 69)}...` : prompt;
    return `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}`;
  };
  const flushWorkLog = () => {
    const narration = text.slice(workLogOffset).trim();
    workLogOffset = text.length;
    if (narration) sink.workLog(narration);
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
      text += chunk;
      if (finalResponseStarted) finalText += chunk;
    },
    onWorkTitle: (title) => {
      workBatchStarted = true;
      sink.workTitle(title);
    },
    onFinalResponse: () => {
      if (finalResponseStarted) return;
      flushWorkLog();
      callTextOffset = text.length;
      finalResponseStarted = true;
      sink.activity(null);
    },
    onPatchOpen: () => {
      workBatchStarted = true;
      sink.workTitle(fallbackWorkTitle());
      flushWorkLog();
      callTextOffset = text.length;
      sink.activity('Editing files');
    },

    onPatchLine: (line) => {
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
      const observation = applyPatchEnvelope(envelope, options, sink, liveEdits);
      patchObservations.push(observation);
      liveEdits = [];
      sink.activity(null);
    },

    onCall: (name, body) => {
      workBatchStarted = true;
      sink.workTitle(fallbackWorkTitle());
      pending.push({ name, body, narration: text.slice(callTextOffset) });
      callTextOffset = text.length;
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
      toolDeclarations: [
        ...(options.model.options.toolDeclarations ?? []),
        ...(options.toolDeclarations ?? []),
      ],
      // Native server-side tools are surfaced through the same sink as
      // patch/file calls, so Spark can render them in its work timeline.
      enableSearch: options.model.options.enableSearch,
      enableCodeExecution: options.model.options.enableCodeExecution,
      onToolCallStart: (name, args) => {
        nativeToolUsed = true;
        workBatchStarted = true;
        if (!finalResponseStarted) flushWorkLog();
        callTextOffset = text.length;
        sink.activity('Working on it…');
        sink.workTitle(fallbackWorkTitle());
        const normalized = name.trim().toLowerCase();
        if (normalized === 'web_search' || normalized === 'google_search') {
          sink.emit({
            id: nextId('call'),
            kind: 'web_search',
            status: 'success',
            startedAt: Date.now(),
            query: typeof args?.query === 'string' ? args.query : undefined,
          } as WebSearchCall);
        } else if (normalized === 'code_execution') {
          sink.emit({
            id: nextId('call'),
            kind: 'code_execution',
            status: 'success',
            startedAt: Date.now(),
            language: typeof args?.language === 'string' ? args.language : undefined,
            code: typeof args?.code === 'string' ? args.code : undefined,
          } as CodeExecutionCall);
        }
      },
      signal: options.signal,
    },
    (token: string) => {
      raw += token;
      parser.push(token);
    },
    () => sink.activity('Thinking it through…'),
    systemPrompt,
    (phase) => {
      if (phase === 'thinking') sink.activity('Thinking it through…');
      else if (phase !== 'responding') sink.activity('Working on it…');
    },
    async (name, args) => {
      nativeToolUsed = true;
      goalControlUsed ||= name === 'create_goal' || name === 'update_goal';
      workBatchStarted = true;
      sink.activity('Working on it…');
      sink.workTitle(fallbackWorkTitle());
      if (!finalResponseStarted) flushWorkLog();
      const observation = await runCall(
        { name, body: JSON.stringify(args ?? {}), narration: '' },
        registry,
        options,
        sink,
      );
      return observation.startsWith('ERROR ')
        ? { status: 'error', error: observation }
        : { status: 'success', result: observation };
    },
    (thought: string) => sink.onThought(thought),
    (usage: TokenUsage) => {
      const total = usage.totalTokens
        ?? ((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0));
      const normalized = Math.floor(total);
      const delta = Math.max(0, normalized - reportedProviderTokens);
      reportedProviderTokens = Math.max(reportedProviderTokens, normalized);
      if (delta > 0) options.goalRuntime?.accountProgress(delta);
    },
  );

  parser.end();
  throwIfAborted(options.signal);

  const observations = [...patchObservations];
  for (const call of pending) {
    throwIfAborted(options.signal);
    const narration = call.narration.trim();
    sink.workTitle(fallbackWorkTitle());
    if (narration) sink.workLog(narration);
    observations.push(await runCall(call, registry, options, sink));
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

  const didWork = workBatchStarted || nativeToolUsed || pending.length > 0 || patchObservations.length > 0;
  const finalResponseNeeded = finalResponseBoundaryEnabled
    && workBatchStarted
    && !goalControlUsed
    && !finalResponseStarted
    && pending.length === 0
    && patchObservations.length === 0;
  if (finalResponseNeeded) observations.push(FINAL_RESPONSE_OBSERVATION);
  const patchNeedsResponse =
    patchObservations.some((observation) => observation.startsWith('Patch applied:')) &&
    text.slice(workLogOffset).trim() === '';
  if (pending.length > 0) {
    const trailing = text.slice(callTextOffset).trim();
    if (trailing && !finalResponseStarted) sink.workLog(trailing);
  } else if (finalResponseStarted) {
    if (finalText.trim()) sink.onText(finalText);
  } else if (patchObservations.length > 0) {
    const finalText = text.slice(workLogOffset);
    if (finalText.trim()) sink.onText(finalText);
  } else if (goalControlUsed) {
    sink.onText(text.slice(workLogOffset));
  } else if (nativeToolUsed || (finalResponseBoundaryEnabled && workBatchStarted)) {
    // Without the explicit boundary this prose is ambiguous: it may be a
    // checkpoint or it may be the answer. Hold it for one corrective round
    // instead of leaking it into either surface.
  } else {
    sink.onText(text);
  }

  return {
    text,
    raw,
    observations,
    didWork,
    needsFinalResponse: finalResponseNeeded,
    performedAction: nativeToolUsed || pending.length > 0 || patchObservations.length > 0,
    didMutate: nativeMutated || patchObservations.some((observation) => observation.startsWith('Patch applied:')),
    wantsMore:
      pending.length > 0 ||
      loose.length > 0 ||
      finalResponseNeeded ||
      patchNeedsResponse ||
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
      if (change.kind === 'add') {
        const name = (change.path.split('/').filter(Boolean).at(-1) || change.path).trim();
        const mimeType = name.endsWith('.html') ? 'text/html'
          : name.endsWith('.css') ? 'text/css'
            : name.endsWith('.js') || name.endsWith('.ts') ? 'text/javascript'
              : name.endsWith('.json') ? 'application/json' : 'text/plain';
        sink.generatedFile({
          id: `generated-${nextId('file')}`,
          name,
          path: change.path,
          mimeType,
          createdAt: new Date().toISOString(),
        });
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
): Promise<string> {
  const name = call.name.trim();

  const refusal = refusalFor(name);
  if (refusal) return `ERROR ${name}: ${refusal}`;

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

  if (name !== 'wait_agent') sink.activity(ACTIVITY[name] ?? 'Working');

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
    if (name !== 'wait_agent') sink.activity(null);
    finish(result.failed ? new Error(result.observation) : undefined);
    if (name !== 'update_goal') options.goalRuntime?.accountProgress();
    return result.failed ? `ERROR ${name}: ${result.observation}` : result.observation;
  } catch (error) {
    if (name !== 'wait_agent') sink.activity(null);
    finish(error);
    if (name !== 'update_goal') options.goalRuntime?.accountProgress();
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
  spawn_agent: 'Starting sub-agents',
  send_message: 'Messaging sub-agents',
  followup_task: 'Starting sub-agent follow-up',
  wait_agent: 'Waiting for sub-agents',
  interrupt_agent: 'Interrupting sub-agent',
  list_agents: 'Checking sub-agents',
};

/* ------------------------------------------------------------------------ */
/* Call sinks                                                                */
/* ------------------------------------------------------------------------ */

/**
 * Where a running agent's output goes.
 *
 * The main turn writes into the transcript; a sub-agent writes into its own
 * card. Both run the identical loop, and this indirection is the only
 * difference between them.
 */
interface CallSink {
  onText: (chunk: string) => void;
  onThought: (chunk: string) => void;
  workTitle: (title: string) => void;
  workLog: (text: string) => void;
  emit: (call: ToolCall) => string;
  patch: (id: string, patch: Partial<ToolCall>) => void;
  activity: (label: string | null) => void;
  generatedFile: (file: { id: string; name: string; path: string; mimeType: string; createdAt: string }) => void;
}

function mainSink(onEvent: (event: HarnessEvent) => void): CallSink {
  return {
    onText: (chunk) => onEvent({ type: 'text', chunk }),
    onThought: () => {},
    workTitle: (title) => onEvent({ type: 'work-title', title }),
    workLog: (text) => onEvent({ type: 'work-log', text }),
    emit: (call) => {
      onEvent({ type: 'call-start', call });
      return call.id;
    },
    patch: (id, patch) => onEvent({ type: 'call-progress', id, patch }),
    activity: (label) => onEvent({ type: 'activity', label }),
    generatedFile: (file) => onEvent({ type: 'generated-file', file }),
  };
}

function agentSink(
  agentId: string,
  onEvent: (event: HarnessEvent) => void,
  state: { calls: ToolCall[]; timeline: SubAgentTimelineEntry[] },
): CallSink {
  const flush = (patch: Partial<SubAgent>) =>
    onEvent({ type: 'agent-progress', id: agentId, patch });

  return {
    // A sub-agent's prose is its reasoning, not the user's answer. It drives
    // the activity line instead of being spliced into the main transcript.
    onText: () => {},
    onThought: () => {},
    workTitle: () => {},
    workLog: (text) => {
      const value = text.trim();
      if (!value) return;
      const entry: SubAgentTimelineEntry = { id: nextId('agent-log'), kind: 'narration', text: value };
      state.timeline = [...state.timeline, entry];
      flush({ timeline: state.timeline });
    },
    emit: (call) => {
      state.calls = [...state.calls, call];
      state.timeline = [...state.timeline, { id: nextId('agent-tool'), kind: 'tool', callId: call.id }];
      flush({ calls: state.calls, timeline: state.timeline });
      return call.id;
    },
    patch: (id, patch) => {
      state.calls = state.calls.map((call) =>
        call.id === id ? ({ ...call, ...patch } as ToolCall) : call,
      );
      flush({ calls: state.calls, timeline: state.timeline });
    },
    activity: (label) => flush({ activity: label ?? undefined }),
    generatedFile: () => {},
  };
}

/* ------------------------------------------------------------------------ */
/* Sub-agents                                                                */
/* ------------------------------------------------------------------------ */

const AGENT_KINDS: AgentKind[] = ['explorer', 'implementer', 'reviewer', 'researcher'];

type CollaborationAgentStatus = 'queued' | 'running' | 'success' | 'error' | 'cancelled';

interface CollaborationAgentState {
  agent: SubAgent;
  taskName: string;
  path: string;
  controller: AbortController;
  inbox: { sender: string; message: string }[];
  conversation: { role: 'user' | 'assistant'; content: string }[];
  lastTaskMessage: string;
  model: ModelBinding;
  run?: Promise<void>;
}

class CollaborationRuntime {
  private readonly agents = new Map<string, CollaborationAgentState>();
  private readonly mailboxes = new Map<string, string[]>();
  private readonly waiters = new Set<() => void>();

  constructor(
    private options: TurnOptions,
    private systemPrompt: string,
  ) {}

  rebind(options: TurnOptions, systemPrompt: string): void {
    this.options = options;
    this.systemPrompt = systemPrompt;
  }

  tools(
    callerPath = '/root',
    forkSource: readonly { role: 'user' | 'assistant'; content: string }[] = [],
    parentModel: ModelBinding = this.options.model,
  ): ToolHandler[] {
    return [
      this.spawnTool(callerPath, forkSource, parentModel),
      this.sendMessageTool(callerPath),
      this.followupTool(callerPath),
      this.waitTool(callerPath),
      this.interruptTool(),
      this.listTool(),
    ];
  }

  declarations(): { functionDeclarations: Record<string, unknown>[] } {
    return { functionDeclarations: [
      {
        name: 'spawn_agent',
        description: 'Spawn a named sub-agent and return immediately. Use this for a concrete bounded subtask that can run independently.',
        parameters: {
          type: 'OBJECT',
          properties: {
            task_name: { type: 'STRING' },
            message: { type: 'STRING' },
            agent_type: { type: 'STRING', enum: AGENT_KINDS },
            model: { type: 'STRING' },
            reasoning_effort: { type: 'STRING' },
            fork_turns: { type: 'STRING' },
          },
          required: ['task_name', 'message'],
        },
      },
      {
        name: 'send_message',
        description: 'Queue a message for an existing agent without starting a new turn.',
        parameters: { type: 'OBJECT', properties: { target: { type: 'STRING' }, message: { type: 'STRING' } }, required: ['target', 'message'] },
      },
      {
        name: 'followup_task',
        description: 'Give an existing non-root agent a follow-up task and start a turn if it is idle.',
        parameters: { type: 'OBJECT', properties: { target: { type: 'STRING' }, message: { type: 'STRING' } }, required: ['target', 'message'] },
      },
      {
        name: 'wait_agent',
        description: 'Wait for a mailbox update from any live agent.',
        parameters: { type: 'OBJECT', properties: { timeout_ms: { type: 'INTEGER' } } },
      },
      {
        name: 'interrupt_agent',
        description: 'Interrupt an agent active turn without deleting its context.',
        parameters: { type: 'OBJECT', properties: { target: { type: 'STRING' } }, required: ['target'] },
      },
      {
        name: 'list_agents',
        description: 'List the live agent tree and statuses.',
        parameters: { type: 'OBJECT', properties: { path_prefix: { type: 'STRING' } } },
      },
    ] };
  }

  cancelAll(): void {
    for (const state of this.agents.values()) {
      if (state.agent.status === 'queued' || state.agent.status === 'running') state.controller.abort();
    }
  }

  private spawnTool(
    parentPath: string,
    forkSource: readonly { role: 'user' | 'assistant'; content: string }[],
    parentModel: ModelBinding,
  ): ToolHandler {
    return {
      id: 'spawn_agent',
      run: async (args): Promise<ToolResult> => {
        const rawName = typeof args.task_name === 'string'
          ? String(args.task_name).trim()
          : '';
        const taskName = this.uniqueTaskName(parentPath, rawName || 'agent');
        const displayName = this.displayTaskName(rawName || taskName);
        const objective = typeof args.message === 'string'
          ? String(args.message).trim()
          : '';
        if (!objective) return { observation: 'spawn_agent requires a task message.', failed: true };

        const kindRaw = String(args.agent_type ?? 'researcher');
        const kind = (AGENT_KINDS as string[]).includes(kindRaw) ? kindRaw as AgentKind : 'researcher';
        const path = `${parentPath}/${taskName}`;
        const childModel = this.resolveChildModel(parentModel, args.model, args.reasoning_effort);
        const agent: SubAgent = {
          id: nextId('agent'),
          name: displayName,
          kind,
          objective,
          status: 'running',
          startedAt: Date.now(),
          progress: 0,
          calls: [],
          timeline: [],
          model: childModel.label,
          tokensUsed: 0,
        };
        const controller = new AbortController();
        const state: CollaborationAgentState = {
          agent,
          taskName,
          path,
          controller,
          inbox: [],
          conversation: this.forkConversation(forkSource, args.fork_turns),
          lastTaskMessage: objective,
          model: childModel,
        };
        this.agents.set(path, state);
        this.options.onEvent({ type: 'agents-start', agents: [agent] });
        state.run = this.runAgent(state, objective);
        return { observation: JSON.stringify({ agent_id: agent.id, task_name: path, status: 'running' }) };
      },
    };
  }

  private sendMessageTool(senderPath: string): ToolHandler {
    return {
      id: 'send_message',
      run: async (args): Promise<ToolResult> => {
        const state = this.find(String(args.target ?? ''));
        const message = typeof args.message === 'string' ? args.message.trim() : '';
        if (!state || !message) return { observation: 'send_message requires a valid target and message.', failed: true };
        state.inbox.push({ sender: senderPath, message });
        return { observation: JSON.stringify({ delivered: true, target: state.path }) };
      },
    };
  }

  private followupTool(senderPath: string): ToolHandler {
    return {
      id: 'followup_task',
      run: async (args): Promise<ToolResult> => {
        const state = this.find(String(args.target ?? ''));
        const message = typeof args.message === 'string' ? args.message.trim() : '';
        if (!state || !message) return { observation: 'followup_task requires a valid target and message.', failed: true };
        if (state.agent.status === 'running') {
          state.inbox.push({ sender: senderPath, message });
          return { observation: JSON.stringify({ target: state.path, queued: true, status: 'running' }) };
        }
        state.controller = new AbortController();
        state.lastTaskMessage = message;
        state.agent = {
          ...state.agent,
          status: 'running',
          endedAt: undefined,
          activity: undefined,
          result: undefined,
          progress: 0,
          calls: [],
          timeline: [],
        };
        this.options.onEvent({ type: 'agent-progress', id: state.agent.id, patch: state.agent });
        state.run = this.runAgent(state, message, senderPath);
        return { observation: JSON.stringify({ target: state.path, status: 'running' }) };
      },
    };
  }

  private waitTool(callerPath: string): ToolHandler {
    return {
      id: 'wait_agent',
      run: async (args): Promise<ToolResult> => {
        const immediate = this.drainMailbox(callerPath);
        if (immediate.length) return { observation: JSON.stringify({ updates: immediate }) };
        if (![...this.agents.values()].some((state) => state.agent.status === 'running')) {
          return { observation: JSON.stringify({ updates: [], live_agents: false }) };
        }
        const timeout = Math.max(0, Math.min(60_000, Number(args.timeout_ms ?? 30_000)));
        await new Promise<void>((resolve) => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const done = () => {
            this.waiters.delete(done);
            if (timer !== undefined) clearTimeout(timer);
            resolve();
          };
          this.waiters.add(done);
          timer = setTimeout(done, timeout);
        });
        return { observation: JSON.stringify({
          updates: this.drainMailbox(callerPath),
          live_agents: [...this.agents.values()].some((state) => state.agent.status === 'running'),
        }) };
      },
    };
  }

  private interruptTool(): ToolHandler {
    return {
      id: 'interrupt_agent',
      run: async (args): Promise<ToolResult> => {
        const state = this.find(String(args.target ?? ''));
        if (!state) return { observation: 'interrupt_agent target was not found.', failed: true };
        const previous = state.agent.status;
        state.controller.abort();
        return { observation: JSON.stringify({ target: state.path, previous_status: previous }) };
      },
    };
  }

  private listTool(): ToolHandler {
    return {
      id: 'list_agents',
      run: async (args): Promise<ToolResult> => {
        const prefix = typeof args.path_prefix === 'string' ? args.path_prefix.trim() : '';
        return { observation: JSON.stringify({
          agents: [...this.agents.values()]
            .filter((state) => !prefix || state.path.startsWith(prefix))
            .map((state) => ({
              task_name: state.path,
              status: state.agent.status,
              last_task_message: state.lastTaskMessage,
            })),
        }) };
      },
    };
  }

  private async runAgent(state: CollaborationAgentState, objective: string, senderPath = '/root'): Promise<void> {
    const activityState = {
      calls: [] as ToolCall[],
      timeline: [] as SubAgentTimelineEntry[],
    };
    const sink = agentSink(state.agent.id, this.options.onEvent, activityState);
    const registry = toolRegistry([
      ...this.tools(state.path, state.conversation, state.model),
      ...(this.options.goalRuntime?.tools() ?? []),
      ...(this.options.extraTools ?? []),
    ]);
    const subPrompt = [
      this.systemPrompt,
      '# Multi-agent identity',
      `You are ${state.path}, an agent in a team collaborating to complete a task.`,
      'You may use the same collaboration tools as the root agent.',
      'When your turn is done, give a concise final report; it will be delivered to your parent.',
    ].join('\n\n');
    const conversation = state.conversation;
    conversation.push({
      role: 'user',
      content: `${projectContext(this.options.files())}\n\nTask name: ${state.path}\n\nMessage from ${senderPath}:\n${objective}`,
    });
    let report = '';
    try {
      for (;;) {
        if (state.controller.signal.aborted || this.options.signal?.aborted) throw new Cancelled();
        this.options.onEvent({ type: 'agent-progress', id: state.agent.id, patch: { progress: 0 } });
        if (state.inbox.length) {
          conversation.push({
            role: 'user',
            content: state.inbox.splice(0)
              .map(({ sender, message }) => `Message from ${sender}:\n${message}`)
              .join('\n\n'),
          });
        }
        const iteration = await runIteration(
          conversation,
          subPrompt,
          {
            ...this.options,
            model: state.model,
            signal: state.controller.signal,
            toolDeclarations: [
              ...(this.options.toolDeclarations ?? []),
              this.declarations(),
            ],
          },
          sink,
          registry,
        );
        report = iteration.text.trim() || report;
        conversation.push({ role: 'assistant', content: compactForHistory(iteration.raw) });
        if (!iteration.wantsMore) break;
        conversation.push({ role: 'user', content: iteration.observations.join('\n\n---\n\n') });
      }
      state.agent = {
        ...state.agent,
        calls: activityState.calls,
        timeline: activityState.timeline,
      };
      this.complete(state, 'success', report.slice(0, 1200));
    } catch (error) {
      state.agent = {
        ...state.agent,
        calls: activityState.calls,
        timeline: activityState.timeline,
      };
      if (error instanceof Cancelled || state.controller.signal.aborted) {
        this.complete(state, 'cancelled', 'The agent turn was interrupted.');
      } else {
        this.complete(state, 'error', (error as Error).message);
      }
    }
  }

  private complete(state: CollaborationAgentState, status: CollaborationAgentStatus, result: string): void {
    state.agent = {
      ...state.agent,
      status,
      endedAt: Date.now(),
      progress: 1,
      activity: undefined,
      result,
    };
    this.options.onEvent({ type: 'agent-progress', id: state.agent.id, patch: state.agent });
    const parentPath = state.path.slice(0, state.path.lastIndexOf('/')) || '/root';
    const mailbox = this.mailboxes.get(parentPath) ?? [];
    mailbox.push(JSON.stringify({
      message_type: status === 'success' ? 'FINAL_ANSWER' : 'MESSAGE',
      task_name: state.path,
      sender: state.path,
      payload: result,
    }));
    this.mailboxes.set(parentPath, mailbox);
    for (const wake of this.waiters) wake();
    this.waiters.clear();
  }

  private drainMailbox(path: string): string[] {
    const messages = this.mailboxes.get(path) ?? [];
    this.mailboxes.set(path, []);
    return messages;
  }

  private find(target: string): CollaborationAgentState | undefined {
    const clean = target.trim();
    return this.agents.get(clean) ?? [...this.agents.values()].find((state) => state.taskName === clean || state.agent.id === clean);
  }

  private uniqueTaskName(parentPath: string, raw: string): string {
    const base = raw.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'agent';
    let candidate = base;
    let suffix = 2;
    while (this.agents.has(`${parentPath}/${candidate}`)) candidate = `${base}_${suffix++}`;
    return candidate;
  }

  /** Agent paths need stable identifier-safe segments, but those identifiers are
   * implementation detail. Present a natural title in Spark's sub-agent UI. */
  private displayTaskName(taskName: string): string {
    const clean = taskName.replace(/\s+/g, ' ').trim();
    if (!clean) return 'Agent';
    // Preserve a natural label exactly as supplied. Only prettify an identifier
    // when the model itself returned one rather than a human-facing name.
    if (/^[a-z0-9_-]+$/.test(clean) && /[_-]/.test(clean)) {
      return clean
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
    }
    return clean;
  }

  private forkConversation(
    source: readonly { role: 'user' | 'assistant'; content: string }[],
    rawMode: unknown,
  ): { role: 'user' | 'assistant'; content: string }[] {
    const mode = typeof rawMode === 'string' && rawMode.trim() ? rawMode.trim().toLowerCase() : 'all';
    if (mode === 'none') return [];
    if (mode === 'all') return source.map((message) => ({ ...message }));
    const turns = Number(mode);
    if (!Number.isInteger(turns) || turns <= 0) return source.map((message) => ({ ...message }));
    return source.slice(-turns * 2).map((message) => ({ ...message }));
  }

  private resolveChildModel(parent: ModelBinding, rawModel: unknown, rawEffort: unknown): ModelBinding {
    const requestedModel = typeof rawModel === 'string' ? rawModel.trim() : '';
    const requestedEffort = typeof rawEffort === 'string' ? rawEffort.trim().toLowerCase() : '';
    const validEfforts = new Set<CodexEffort>(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
    const modelId = requestedModel || String(parent.options.model ?? '');
    const effort = validEfforts.has(requestedEffort as CodexEffort)
      ? resolveEffort(requestedEffort as CodexEffort, {
          providerId: parent.options.provider,
          modelId,
          name: requestedModel || parent.label,
          multiAgentVersion: parent.effort?.harness?.multiAgentVersion,
        })
      : parent.effort;
    return {
      ...parent,
      label: requestedModel || parent.label,
      options: {
        ...parent.options,
        model: modelId || parent.options.model,
        thinkingLevel: effort?.level ?? parent.options.thinkingLevel,
        reasoningEffort: effort?.effective ?? parent.options.reasoningEffort,
      },
      effort,
    };
  }
}

const collaborationRuntimes = new Map<string, CollaborationRuntime>();

const collaborationRuntimeFor = (
  threadId: string | undefined,
  options: TurnOptions,
  systemPrompt: string,
): CollaborationRuntime => {
  if (!threadId) return new CollaborationRuntime(options, systemPrompt);
  const existing = collaborationRuntimes.get(threadId);
  if (existing) {
    existing.rebind(options, systemPrompt);
    return existing;
  }
  const runtime = new CollaborationRuntime(options, systemPrompt);
  collaborationRuntimes.set(threadId, runtime);
  return runtime;
};

/* ------------------------------------------------------------------------ */
/* Public entry point                                                        */
/* ------------------------------------------------------------------------ */

/**
 * Runs one user turn to completion.
 *
 * Resolves normally on cancellation — a cancelled turn is a user action, not an
 * error — and reports everything else through a `turn-end` event so the UI has
 * exactly one place to handle failure.
 */
export async function runTurn(options: TurnOptions): Promise<void> {
  const profile = options.profile ?? getHarnessProfile();
  const baseSink = mainSink(options.onEvent);
  let workTitlePublished = false;
  const sink: CallSink = {
    ...baseSink,
    workTitle: (title) => {
      const cleanTitle = title.replace(/\s+/g, ' ').trim().slice(0, 160);
      if (!cleanTitle || workTitlePublished) return;
      workTitlePublished = true;
      baseSink.workTitle(cleanTitle);
    },
  };

  /*
   * The user's message carries the file listing and nothing else.
   *
   * How-to-work guidance used to be prepended there too, which meant "heyaa"
   * reached the model as a manifest, an effort level, and "Plan before acting"
   * wrapped around one word. That reads as a work order however the greeting is
   * phrased, and the model duly planned and built an app. Standing guidance
   * belongs in the system prompt beside upstream's own — which already says to
   * answer a greeting conversationally — not stapled to whatever was typed.
   */
  const systemPrompt = [
    profile.systemPrompt,
    collaborationSection(options.model),
    effortSection(options.model),
    options.goalRuntime?.contextSection(),
  ]
    .filter(Boolean)
    .join('\n\n');

  const conversation: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const message of options.history) {
    const text = messageText(message);
    if (text) conversation.push({ role: message.role, content: text });
  }

  const context = isWorkRequest(options.prompt) ? projectContext(options.files()) : '';
  const intent = isAgenticRequest(options.prompt)
    ? '<intent>execution</intent>'
    : '<intent>conversation</intent>';
  conversation.push({
    role: 'user',
    content: [intent, context, options.prompt].filter(Boolean).join('\n\n'),
  });

  const collaboration = collaborationRuntimeFor(options.collaborationThreadId, options, systemPrompt);
  const goalTools = options.goalRuntime?.tools() ?? [];
  const runtimeOptions: TurnOptions = {
    ...options,
    toolDeclarations: [
      ...(options.toolDeclarations ?? []),
      collaboration.declarations(),
    ],
  };
  const registry = toolRegistry([
    ...collaboration.tools('/root', conversation),
    ...goalTools,
    ...(options.extraTools ?? []),
  ]);

  /** Whether the "you announced but did not act" nudge has been spent. */
  let nudged = false;
  const mutationRequired = isMutationRequest(options.prompt);
  let mutationCompleted = false;
  let mutationNudged = false;
  let finalResponseNudged = false;

  try {
    options.goalRuntime?.beginTurn();
    for (;;) {
      const result = await runIteration(
        conversation,
        systemPrompt,
        runtimeOptions,
        sink,
        registry,
      );
      mutationCompleted ||= result.didMutate;

      const goalState = options.goalRuntime?.current();
      if (goalState && goalState.status !== 'active' && goalState.status !== 'complete') {
        options.goalRuntime.finishTurn();
        options.onEvent({ type: 'turn-end', reason: 'complete' });
        return;
      }

      if (result.needsFinalResponse) {
        if (options.goalRuntime && !options.goalRuntime.isActive() && result.text.trim()) {
          // Goal completion is itself a terminal tool result. Older goal-aware
          // model profiles may not emit Spark's final-response marker, so let
          // the completion report finish this turn without another round.
          options.onEvent({ type: 'text', chunk: result.text.trim() });
          options.goalRuntime.finishTurn();
          options.onEvent({ type: 'turn-end', reason: 'complete' });
          return;
        }
        if (result.performedAction) {
          finalResponseNudged = false;
        } else if (finalResponseNudged && result.text.trim()) {
          // One recovery attempt is enough. If a provider/model still ignores
          // the boundary, prefer a complete answer over an exhausted loop.
          options.onEvent({ type: 'text', chunk: result.text.trim() });
          options.goalRuntime?.finishTurn();
          options.onEvent({ type: 'turn-end', reason: 'complete' });
          return;
        } else {
          finalResponseNudged = true;
        }
      }

      if (!result.wantsMore) {
        if (mutationRequired && !mutationCompleted && !mutationNudged) {
          mutationNudged = true;
          options.onEvent({ type: 'text', chunk: '\n\n' });
          conversation.push({ role: 'assistant', content: compactForHistory(result.raw) });
          conversation.push({
            role: 'user',
            content:
              'The requested file or workspace mutation is not complete yet. ' +
              'Do not summarize or stop after reading. Use apply_patch or the appropriate write-capable tool now, then report the actual result.',
          });
          continue;
        }
        if (mutationRequired && !mutationCompleted && mutationNudged) {
          options.goalRuntime?.stopForError('blocked');
          options.onEvent({
            type: 'turn-end',
            reason: 'error',
            error: 'The requested workspace mutation did not produce a file change.',
          });
          return;
        }
        /*
         * A response with no tool call is normally the answer. But a model on a
         * text protocol can describe the envelope instead of emitting one, and
         * end its message mid-flow — "Let's start by creating the project
         * plan." — which ends the turn looking successful with nothing written.
         *
         * One nudge, and only when nothing ran this iteration. If it still
         * emits nothing it has nothing to emit, and asking twice would spend
         * the user's budget on it.
         */
        if (!nudged && !result.didWork && announcedWithoutActing(result.text)) {
          nudged = true;
          options.onEvent({ type: 'text', chunk: '\n\n' });
          conversation.push({ role: 'assistant', content: compactForHistory(result.raw) });
          conversation.push({ role: 'user', content: CONTINUE_OBSERVATION });
          continue;
        }

        options.goalRuntime?.finishTurn();
        options.onEvent({ type: 'turn-end', reason: 'complete' });
        return;
      }

      // The next iteration's prose streams straight onto the end of this one's.
      // Without a break the two run together mid-sentence — "…before scaffolding
      // the application.I will now set up…" — because each iteration is a
      // separate completion but one continuous transcript.
      if (result.text.trim() !== '' && !result.didWork) {
        options.onEvent({ type: 'text', chunk: '\n\n' });
      }

      // `raw`, not `text`: the model must see the envelopes it emitted, or it
      // cannot tell what produced the observation that follows.
      conversation.push({ role: 'assistant', content: compactForHistory(result.raw) });
      conversation.push({
        role: 'user',
        content: result.observations.join('\n\n---\n\n'),
      });
    }

  } catch (error) {
    collaboration.cancelAll();
    if (error instanceof Cancelled || options.signal?.aborted) {
      options.goalRuntime?.finishTurn();
      options.onEvent({ type: 'turn-end', reason: 'cancelled' });
      return;
    }
    options.goalRuntime?.stopForError(isUsageLimitError(error) ? 'usage_limited' : 'blocked');
    options.onEvent({
      type: 'turn-end',
      reason: 'error',
      error: (error as Error).message,
    });
  }
}
