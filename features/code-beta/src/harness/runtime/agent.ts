/**
 * The Code Beta turn loop.
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
import { getHarnessProfile } from '../overlay/profile';
import { isAllowed, refusalFor } from '../overlay/tool-policy';
import {
  applyPatch,
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
import { nextId, toolRegistry } from './tools';
import type {
  AgentKind,
  EditCall,
  HarnessEvent,
  Message,
  SubAgent,
  ToolCall,
  ToolContext,
  ToolHandler,
  ToolResult,
} from './protocol';

const MAX_ITERATIONS = 12;
const MAX_SUBAGENT_ITERATIONS = 6;

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
}

/**
 * The default transport: `platform/ai`'s `streamChat`.
 *
 * Imported lazily rather than at module scope. `chat.ts` pulls in the Google,
 * OpenAI and Anthropic SDKs, and a static import would drag all three into the
 * Code Beta chunk — and into any test that touches this module — even when a
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
 */
function projectContext(files: FileMap): string {
  const paths = Object.keys(files).sort();
  if (paths.length === 0) {
    return '<project>\nThe project is empty. Create /App.tsx to begin.\n</project>';
  }
  const listing = paths
    .map((path) => `  ${path} (${files[path]!.split('\n').length} lines)`)
    .join('\n');
  return `<project>\nFiles currently in the project:\n${listing}\n</project>`;
}

/**
 * Tells the model what effort it is running at.
 *
 * Upstream's prompt is written assuming the agent knows — it talks about being
 * thorough or quick without ever stating which it is. Naming the level makes
 * that guidance actionable instead of ambient, and it is how the same prompt
 * produces genuinely different behaviour at `low` and at `ultra`.
 */
function effortContext(model: ModelBinding): string {
  const effort = model.effort;
  if (!effort) return '';

  const line = `<effort>You are running at ${effort.effective} reasoning effort.</effort>`;

  // A clamp is worth saying out loud: the user asked for more than this model
  // can deliver, and the agent should not behave as though it got it.
  return effort.clamped
    ? `${line}\n<note>${effort.requested} was requested but this model does not support it.</note>`
    : line;
}

/* ------------------------------------------------------------------------ */
/* One streamed response                                                     */
/* ------------------------------------------------------------------------ */

interface PendingCall {
  name: string;
  body: string;
}

interface IterationResult {
  /** Everything the model said, envelopes stripped. */
  text: string;
  /** Observations to feed back, in order. */
  observations: string[];
  /** True when the model emitted at least one call needing a result. */
  wantsMore: boolean;
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
  let text = '';

  // The edit card currently being written into, so patch lines can stream in.
  let liveEdit: { id: string; lines: number } | null = null;
  const patchObservations: string[] = [];

  const parser = new ResponseStreamParser({
    onText: (chunk) => {
      text += chunk;
      sink.onText(chunk);
    },

    onPatchOpen: () => {
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
        liveEdit = { id: sink.emit(call), lines: 0 };
        return;
      }

      if (!liveEdit) return;
      if (/^[+\- ]/.test(line)) {
        liveEdit.lines += 1;
        sink.patch(liveEdit.id, { revealed: liveEdit.lines } as Partial<ToolCall>);
      }
    },

    onPatchClose: (envelope) => {
      const observation = applyPatchEnvelope(envelope, options, sink, liveEdit?.id);
      patchObservations.push(observation);
      liveEdit = null;
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

  const transport = options.transport ?? defaultTransport;

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
    (token: string) => parser.push(token),
    () => sink.activity('Responding'),
    systemPrompt,
    undefined,
    undefined,
    (thought: string) => sink.onThought(thought),
  );

  parser.end();
  throwIfAborted(options.signal);

  const observations = [...patchObservations];

  for (const call of pending) {
    throwIfAborted(options.signal);
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

  return {
    text,
    observations,
    wantsMore:
      pending.length > 0 ||
      loose.length > 0 ||
      patchObservations.some((observation) => observation.startsWith('ERROR')),
  };
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
  liveEditId: string | undefined,
): string {
  try {
    const ops = parsePatch(envelope);
    const before = options.files();
    const { files, changes } = applyPatch(before, ops);
    options.writeFiles(files);

    // The first change reuses the card the stream already opened; the rest get
    // their own, so a multi-file envelope reads as several edits.
    changes.forEach((change, index) => {
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

      if (index === 0 && liveEditId) {
        sink.patch(liveEditId, patch as Partial<ToolCall>);
      } else {
        const id = sink.emit({
          id: nextId('call'),
          kind: patch.kind!,
          status: 'success',
          startedAt: Date.now(),
          endedAt: Date.now(),
          path: patch.path!,
          added: change.added,
          removed: change.removed,
          lines,
          revealed: lines.length,
        } as EditCall);
        void id;
      }
    });

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

    if (liveEditId) {
      sink.patch(liveEditId, {
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

  sink.activity(ACTIVITY[name] ?? 'Working');

  const context: ToolContext = {
    readFiles: options.files,
    writeFiles: options.writeFiles,
    signal: options.signal,
    emit: sink.emit,
    patch: sink.patch,
  };

  try {
    const result: ToolResult = await registry.get(name)!.run(args, context);
    sink.activity(null);
    return result.failed ? `ERROR ${name}: ${result.observation}` : result.observation;
  } catch (error) {
    sink.activity(null);
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
  task: 'Starting sub-agents',
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
  emit: (call: ToolCall) => string;
  patch: (id: string, patch: Partial<ToolCall>) => void;
  activity: (label: string | null) => void;
}

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

function agentSink(
  agentId: string,
  onEvent: (event: HarnessEvent) => void,
  state: { calls: ToolCall[] },
): CallSink {
  const flush = (patch: Partial<SubAgent>) =>
    onEvent({ type: 'agent-progress', id: agentId, patch });

  return {
    // A sub-agent's prose is its reasoning, not the user's answer. It drives
    // the activity line instead of being spliced into the main transcript.
    onText: () => {},
    onThought: () => {},
    emit: (call) => {
      state.calls = [...state.calls, call];
      flush({ calls: state.calls });
      return call.id;
    },
    patch: (id, patch) => {
      state.calls = state.calls.map((call) =>
        call.id === id ? ({ ...call, ...patch } as ToolCall) : call,
      );
      flush({ calls: state.calls });
    },
    activity: (label) => flush({ activity: label ?? undefined }),
  };
}

/* ------------------------------------------------------------------------ */
/* Sub-agents                                                                */
/* ------------------------------------------------------------------------ */

const AGENT_KINDS: AgentKind[] = ['explorer', 'implementer', 'reviewer', 'researcher'];

/**
 * The `task` tool.
 *
 * Built per turn rather than declared statically because it closes over the
 * turn's options and event sink. Sub-agents get every tool except `task`
 * itself — unbounded recursion in a browser tab is not a feature.
 */
function makeTaskTool(options: TurnOptions, systemPrompt: string): ToolHandler {
  return {
    id: 'task',
    async run(args): Promise<ToolResult> {
      const name = typeof args.name === 'string' ? args.name.trim() : 'Sub-agent';
      const objective = typeof args.objective === 'string' ? args.objective.trim() : '';
      const kindRaw = typeof args.kind === 'string' ? args.kind : 'implementer';
      const kind = (AGENT_KINDS as string[]).includes(kindRaw)
        ? (kindRaw as AgentKind)
        : 'implementer';

      if (!objective) {
        return {
          observation: 'task requires an "objective" describing what the sub-agent should do.',
          failed: true,
        };
      }

      const agent: SubAgent = {
        id: nextId('agent'),
        name,
        kind,
        objective,
        status: 'running',
        startedAt: Date.now(),
        progress: 0,
        calls: [],
        model: options.model.label,
        tokensUsed: 0,
      };

      options.onEvent({ type: 'agents-start', agents: [agent] });

      const state = { calls: [] as ToolCall[] };
      const sink = agentSink(agent.id, options.onEvent, state);
      // Sub-agents get the host tools too — a reviewer that cannot look at the
      // preview is not much of a reviewer — but never `task`, because
      // unbounded recursion in a browser tab is not a feature.
      const registry = toolRegistry(options.extraTools ?? []);

      const subPrompt =
        `${systemPrompt}\n\n# You are a sub-agent\n\n` +
        'You have been delegated one specific piece of a larger task. Do only ' +
        'that piece. You cannot ask questions and you cannot delegate further. ' +
        'When finished, write a two-sentence report of what you changed — that ' +
        'report is all the main agent will see.';

      const conversation: { role: 'user' | 'assistant'; content: string }[] = [
        {
          role: 'user',
          content: `${projectContext(options.files())}\n\nYour objective: ${objective}`,
        },
      ];

      let report = '';

      try {
        for (let step = 0; step < MAX_SUBAGENT_ITERATIONS; step += 1) {
          options.onEvent({
            type: 'agent-progress',
            id: agent.id,
            patch: { progress: step / MAX_SUBAGENT_ITERATIONS },
          });

          const iteration = await runIteration(
            conversation,
            subPrompt,
            options,
            sink,
            registry,
          );
          report = iteration.text.trim() || report;

          if (!iteration.wantsMore) break;

          conversation.push({ role: 'assistant', content: iteration.text });
          conversation.push({
            role: 'user',
            content: iteration.observations.join('\n\n---\n\n'),
          });
        }

        options.onEvent({
          type: 'agent-progress',
          id: agent.id,
          patch: {
            status: 'success',
            endedAt: Date.now(),
            progress: 1,
            activity: undefined,
            result: report.slice(0, 400),
            tokensUsed: state.calls.length * 1200,
          },
        });

        return {
          observation:
            `Sub-agent "${name}" finished.\n\n${report.slice(0, 1200)}\n\n` +
            `It made ${state.calls.length} tool call(s). The project files now ` +
            'reflect its work; read anything you need before building on it.',
        };
      } catch (error) {
        if (error instanceof Cancelled) {
          options.onEvent({
            type: 'agent-progress',
            id: agent.id,
            patch: { status: 'cancelled', endedAt: Date.now(), activity: undefined },
          });
          throw error;
        }

        const message = (error as Error).message;
        options.onEvent({
          type: 'agent-progress',
          id: agent.id,
          patch: {
            status: 'error',
            endedAt: Date.now(),
            activity: undefined,
            result: message,
          },
        });
        return { observation: `Sub-agent "${name}" failed: ${message}`, failed: true };
      }
    },
  };
}

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
  const profile = getHarnessProfile();
  const sink = mainSink(options.onEvent);

  const registry = toolRegistry([
    makeTaskTool(options, profile.systemPrompt),
    ...(options.extraTools ?? []),
  ]);

  const conversation: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const message of options.history) {
    const text = messageText(message);
    if (text) conversation.push({ role: message.role, content: text });
  }

  conversation.push({
    role: 'user',
    content: [
      projectContext(options.files()),
      effortContext(options.model),
      options.prompt,
    ]
      .filter(Boolean)
      .join('\n\n'),
  });

  try {
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
      const result = await runIteration(
        conversation,
        profile.systemPrompt,
        options,
        sink,
        registry,
      );

      if (!result.wantsMore) {
        options.onEvent({ type: 'turn-end', reason: 'complete' });
        return;
      }

      conversation.push({ role: 'assistant', content: result.text });
      conversation.push({
        role: 'user',
        content: result.observations.join('\n\n---\n\n'),
      });
    }

    // Budget exhausted. Tell the model's audience, not just the console.
    options.onEvent({
      type: 'text',
      chunk:
        '\n\nI stopped after reaching the tool-call limit for one turn. ' +
        'The work so far is applied — send another message to continue.',
    });
    options.onEvent({ type: 'turn-end', reason: 'complete' });
  } catch (error) {
    if (error instanceof Cancelled || options.signal?.aborted) {
      options.onEvent({ type: 'turn-end', reason: 'cancelled' });
      return;
    }
    options.onEvent({
      type: 'turn-end',
      reason: 'error',
      error: (error as Error).message,
    });
  }
}
