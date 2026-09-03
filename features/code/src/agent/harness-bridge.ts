/**
 * The seam between the Codex harness and the copied workbench.
 *
 * The harness thinks in a flat `{ path: contents }` map; the workbench keeps
 * files in a nanostore of `{ type, content }` records and drives a live
 * preview off it. This module is the only place that knows both shapes, so
 * neither side has to learn the other's.
 *
 * It also owns the two tools that only make sense in Willow's sandbox and have
 * no upstream Codex equivalent: `run_command`, which exposes a small allow-list
 * of sandbox operations, and `computer_use`, which drives the preview iframe.
 */

import { runComputerUseTask, type TestUpdate } from '@willow/ai/computer-use/session';
import { runTurn, type ModelBinding } from './harness/runtime/agent';
import { stripLooseCode } from './harness/runtime/loose-code';
import { nextId } from './harness/runtime/tools';
import type {
  CommandCall,
  ComputerAction,
  ComputerUseCall,
  HarnessEvent,
  Message,
  OutputChunk,
  ToolHandler,
  ToolResult,
} from './harness/runtime/protocol';
import { resolveBinding, type ProviderKeys } from './model-binding';
import { clearRequestLog, dumpRequestLog, requestLog } from './harness/runtime/request-log';
import type { CodexEffort } from './harness/overlay/effort';
import type { ModeKind } from './harness/overlay/collaboration-mode';
import { GoalRuntime, type ThreadGoal } from './harness/runtime/goal';
import type { RequestUserInputSink } from './harness/runtime/request-user-input';
import {
  applyHarnessEvent,
  beginTurn,
  endTurn,
  previewFrame,
} from './agent-store';

/* ---------------------------------------------------------------------- */
/* Workbench file bridge                                                   */
/* ---------------------------------------------------------------------- */

/** The slice of the sandpack store the harness needs. */
export interface WorkbenchFiles {
  files: {
    get: () => Record<string, { type: 'file'; content: string }>;
    set: (next: Record<string, { type: 'file'; content: string }>) => void;
  };
  setCurrentEditingFile: (path: string | null) => void;
  /**
   * The flag the whole preview pipeline is gated on.
   *
   * `setFile` raises it, but the harness cannot use `setFile` — see
   * `writeWorkbenchFiles` — so it has to raise it itself.
   */
  hasUserCode: { set: (value: boolean) => void };
  /** Cleared on any write, because the live files no longer match a snapshot. */
  activeSnapshotId: { set: (value: string | null) => void };
}

export function readWorkbenchFiles(workbench: WorkbenchFiles): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, entry] of Object.entries(workbench.files.get())) {
    if (entry?.content !== undefined) out[path] = entry.content;
  }
  return out;
}

/**
 * Writes the harness's file map back into the workbench.
 *
 * Replaces the whole map rather than calling `setFile` per path, because the
 * harness can delete files and `setFile` has no way to express a removal.
 * Assigning the map once also means the preview rebuilds once per patch rather
 * than once per file, which is what stops a multi-file edit flashing two or
 * three broken intermediate states.
 *
 * The cost of not going through `setFile` is that its two side effects have to
 * be reproduced here. Missing `hasUserCode` is not a cosmetic slip: every stage
 * of the preview pipeline is gated on it, so files were written, the transcript
 * showed them created, and nothing rendered — no bundle, no iframe, the empty
 * state still up, and the workspace never morphing out of chat mode.
 */
export function writeWorkbenchFiles(
  workbench: WorkbenchFiles,
  next: Record<string, string>,
): void {
  const mapped: Record<string, { type: 'file'; content: string }> = {};
  for (const [path, content] of Object.entries(next)) {
    mapped[path] = { type: 'file', content };
  }
  workbench.files.set(mapped);
  workbench.hasUserCode.set(true);
  workbench.activeSnapshotId.set(null);
}

/* ---------------------------------------------------------------------- */
/* run_command                                                             */
/* ---------------------------------------------------------------------- */

/**
 * The sandbox operations the agent may "run".
 *
 * Not a shell. Each entry is a named operation Willow implements itself, shown
 * through a terminal card because that is what it reads as. Anything not on
 * this list is refused by `tool-policy`, and the prompt says so.
 */
interface SandboxCommand {
  match: RegExp;
  cwd: string;
  run: (
    workbench: WorkbenchFiles,
    emit: (chunk: OutputChunk) => void,
  ) => Promise<{ exitCode: number; observation: string }>;
}

const SANDBOX_COMMANDS: SandboxCommand[] = [
  {
    match: /^(npm|pnpm|yarn)\s+(run\s+)?(typecheck|tsc|build)$/i,
    cwd: '~/sandbox',
    async run(workbench, emit) {
      emit({ stream: 'stdout', text: '$ tsc --noEmit\n\n' });
      const files = readWorkbenchFiles(workbench);
      const sources = Object.keys(files).filter((path) => /\.(tsx?|jsx?)$/.test(path));
      emit({ stream: 'stdout', text: `Checking ${sources.length} files…\n` });

      // A real typechecker is not available in the browser. Rather than fake a
      // result, report honestly and point at the thing that *does* validate the
      // project — the bundler, whose errors the preview already surfaces.
      emit({
        stream: 'stdout',
        text:
          '\nNo standalone typechecker runs in the sandbox.\n' +
          'The bundler type-strips and reports real errors in the preview pane.\n',
      });
      return {
        exitCode: 0,
        observation:
          'There is no standalone typechecker in this sandbox. The bundler ' +
          'reports genuine build errors in the preview; read those instead of ' +
          'running a check.',
      };
    },
  },
  {
    match: /^(npm|pnpm|yarn)\s+(install|i|add)(\s|$)/i,
    cwd: '~/sandbox',
    async run(_workbench, emit) {
      emit({ stream: 'stdout', text: '$ install\n\n' });
      emit({
        stream: 'stderr',
        text: 'Installation is declarative here — edit /package.json instead.\n',
      });
      return {
        exitCode: 1,
        observation:
          'Dependencies are declared, not installed. Use `add_dependency`, or ' +
          'patch the `dependencies` object in /package.json directly.',
      };
    },
  },
  {
    match: /^ls(\s|$)|^find(\s|$)|^tree(\s|$)/i,
    cwd: '~/sandbox',
    async run(workbench, emit) {
      const paths = Object.keys(readWorkbenchFiles(workbench)).sort();
      emit({ stream: 'stdout', text: `${paths.join('\n')}\n` });
      return { exitCode: 0, observation: `${paths.length} files:\n${paths.join('\n')}` };
    },
  },
];

const runCommandTool = (workbench: WorkbenchFiles): ToolHandler => ({
  id: 'run_command',
  async run(args, context): Promise<ToolResult> {
    const command = String(args.command ?? '').trim();
    if (!command) {
      return { observation: 'run_command requires a "command".', failed: true };
    }

    const entry = SANDBOX_COMMANDS.find((candidate) => candidate.match.test(command));

    const output: OutputChunk[] = [];
    const id = context.emit({
      id: nextId('call'),
      kind: 'command',
      status: 'running',
      startedAt: Date.now(),
      command,
      cwd: entry?.cwd ?? '~/sandbox',
      output,
    } as CommandCall);

    const emit = (chunk: OutputChunk) => {
      output.push(chunk);
      context.patch(id, { output: [...output] } as Partial<CommandCall>);
    };

    if (!entry) {
      emit({ stream: 'stderr', text: `command not found: ${command.split(/\s+/)[0]}\n` });
      context.patch(id, {
        status: 'error',
        endedAt: Date.now(),
        exitCode: 127,
      } as Partial<CommandCall>);
      return {
        observation:
          `ERROR ${command} is not available. This sandbox has no shell; only a ` +
          'small set of operations exist. Change files with apply_patch, add ' +
          'packages with add_dependency, and check your work by reading the ' +
          'preview error or using computer_use.',
        failed: true,
      };
    }

    const { exitCode, observation } = await entry.run(workbench, emit);
    context.patch(id, {
      status: exitCode === 0 ? 'success' : 'error',
      endedAt: Date.now(),
      exitCode,
    } as Partial<CommandCall>);

    return { observation, failed: exitCode !== 0 };
  },
});

/* ---------------------------------------------------------------------- */
/* computer_use                                                            */
/* ---------------------------------------------------------------------- */

/** Maps an upstream action name to viewport coordinates, when it has any. */
function actionCoordinates(update: TestUpdate): { x: number; y: number } | undefined {
  const match = /\((\d+),\s*(\d+)\)/.exec(update.message ?? '');
  if (!match) return undefined;
  // Upstream works in a 1440x900 space; the overlay wants percentages so it
  // stays correct however the screenshot is scaled in the card.
  return {
    x: Math.max(0, Math.min(100, (Number(match[1]) / 1440) * 100)),
    y: Math.max(0, Math.min(100, (Number(match[2]) / 900) * 100)),
  };
}

/**
 * Drives the preview with Gemini's computer-use model.
 *
 * The only thing there is to drive in this product is the app the agent just
 * built, which is exactly why it is worth having: it closes the loop between
 * writing a UI and checking that the UI actually works. Without it the agent
 * can only assert that its code is correct; with it, it can look.
 */
const computerUseTool = (apiKeys: ProviderKeys): ToolHandler => ({
  id: 'computer_use',
  async run(args, context): Promise<ToolResult> {
    const objective = String(args.objective ?? args.task ?? '').trim();
    if (!objective) {
      return {
        observation: 'computer_use requires an "objective" describing what to check.',
        failed: true,
      };
    }

    const frame = previewFrame.get();
    if (!frame) {
      return {
        observation:
          'The preview is not open, so there is nothing to drive. Ask the user ' +
          'to switch to the Preview tab, or verify by reading the files instead.',
        failed: true,
      };
    }

    const apiKey = apiKeys.gemini?.[0];
    if (!apiKey) {
      return {
        observation:
          'computer_use needs a Google API key, which is not configured. Verify ' +
          'by reading the files instead.',
        failed: true,
      };
    }

    const actions: ComputerAction[] = [];
    const started = Date.now();

    const id = context.emit({
      id: nextId('call'),
      kind: 'computer',
      status: 'running',
      startedAt: started,
      objective,
      actions,
      activity: 'Opening the preview',
    } as ComputerUseCall);

    const patch = (update: Partial<ComputerUseCall>) => context.patch(id, update as never);

    const onUpdate = (update: TestUpdate) => {
      if (update.type === 'screenshot') {
        // The message carries a data URI for the frame just captured.
        const src = /^data:image\//.test(update.message) ? update.message : undefined;
        if (src) patch({ screenshot: src });
        return;
      }

      if (update.type === 'action') {
        // Settle the previous action before opening the next, so exactly one
        // row is ever mid-flight.
        for (const action of actions) {
          if (action.status === 'running') action.status = 'success';
        }
        const at = actionCoordinates(update);
        actions.push({
          name: update.actionName ?? update.actionType ?? 'action',
          label: update.message,
          at: at ? { x: Math.round(at.x), y: Math.round(at.y) } : undefined,
          status: 'running',
          at_ms: Date.now() - started,
        });
        patch({ actions: [...actions], cursor: at, activity: update.message });
        return;
      }

      if (update.type === 'thinking' || update.type === 'plan' || update.type === 'text') {
        patch({ activity: update.message });
      }
    };

    try {
      const result = await runComputerUseTask(
        apiKey,
        objective,
        frame,
        onUpdate,
        [],
        () => Boolean(context.signal?.aborted),
        context.signal,
      );

      for (const action of actions) {
        if (action.status === 'running') action.status = 'success';
      }

      patch({
        status: result.completed ? 'success' : 'error',
        endedAt: Date.now(),
        activity: undefined,
        cursor: undefined,
        actions: [...actions],
        result: result.explanation,
        limited: result.limited,
      });

      return {
        observation:
          `computer_use ${result.completed ? 'completed' : 'did not complete'}: ` +
          `${result.explanation}\n\nActions performed:\n` +
          (result.actionsPerformed.length > 0
            ? result.actionsPerformed.map((entry) => `  - ${entry}`).join('\n')
            : '  (none)') +
          (result.limited
            ? '\n\nThe frame navigated somewhere that could not be scripted.'
            : ''),
        failed: !result.completed,
      };
    } catch (error) {
      const message = (error as Error).message;
      for (const action of actions) {
        if (action.status === 'running') action.status = 'cancelled';
      }
      patch({
        status: /abort|cancel/i.test(message) ? 'cancelled' : 'error',
        endedAt: Date.now(),
        activity: undefined,
        cursor: undefined,
        actions: [...actions],
        result: message,
      });
      return { observation: `computer_use failed: ${message}`, failed: true };
    }
  },
});

/* ---------------------------------------------------------------------- */
/* Running a turn                                                          */
/* ---------------------------------------------------------------------- */

export interface CodexTurnOptions {
  turnId: string;
  prompt: string;
  /** Prior conversation, oldest first. */
  history: Message[];
  workbench: WorkbenchFiles;
  modelConfig: unknown;
  selectedModelId?: string;
  apiKeys: ProviderKeys;
  /** Codex-ladder reasoning effort. Clamped per model by `resolveBinding`. */
  effort?: CodexEffort;
  /**
   * Collaboration mode. Defaults to `'default'`, as upstream does.
   *
   * `'plan'` is upstream's Plan mode: a developer message from the vendored
   * template, `update_plan` refused, mutation declined, `request_user_input`
   * available, and the plan delivered as a `<proposed_plan>` block.
   */
  mode?: ModeKind;
  /**
   * The objective for Goal mode, and the goal it resumes.
   *
   * Supplying `objective` starts a goal at the mode boundary — which is where
   * upstream's `/goal` command creates it, and deliberately not left to the
   * model's `create_goal` call: that tool's own description says to create a
   * goal only when explicitly asked, so a compliant model handed "Goal mode is
   * on" would correctly decline and the mode would sit inert.
   *
   * `resume` carries a goal already in flight, so continuations survive a
   * reload.
   */
  goal?: { objective?: string; resume?: ThreadGoal | null };
  /** Every goal transition, so the host can persist it with the session. */
  onGoal?: (goal: ThreadGoal | null) => void;
  /** How `request_user_input` reaches the user. Plan mode needs this. */
  requestUserInput?: RequestUserInputSink;
  signal?: AbortSignal;
  /** Prose, as it streams. The sidebar owns the message body. */
  onText: (chunk: string) => void;
  /**
   * Fired once, when the turn settles.
   *
   * `text` is the cleaned transcript for the finished message — not simply the
   * concatenation of what `onText` emitted. If the model wrote file contents as
   * prose, the harness made it re-send them as a patch, and the original block
   * is replaced here so the message does not show the same file twice: once as
   * code that was never applied, and once as a real diff.
   */
  onDone: (outcome: {
    reason: 'complete' | 'cancelled' | 'error';
    error?: string;
    text: string;
    /**
     * Why the loop stopped, when it was not the model finishing.
     *
     * The caller needs this to distinguish a turn that finished from one that
     * ran out of rounds — both used to report `'complete'`, so there was no way
     * to know whether to offer "continue".
     */
    stopReason?: string;
    /** The goal as it stands, for a Goal mode turn. */
    goal?: ThreadGoal | null;
  }) => void;
}

/**
 * Runs one Codex turn against the workbench.
 *
 * Resolves the model binding first so a missing API key fails before any UI
 * state is opened, then pipes every harness event into the activity store while
 * handing prose back to the caller.
 */
/*
 * The request log, reachable from the console.
 *
 * Attached on first use rather than at import, so it exists only once the Agent
 * tool has actually run something. `willowAgent.requests()` prints the table;
 * `willowAgent.dump()` gives JSON to paste into a report.
 */
function exposeRequestLog(): void {
  if (typeof window === 'undefined') return;
  const globals = window as unknown as Record<string, unknown>;
  if (globals.willowAgent) return;

  globals.willowAgent = {
    requests: () => {
      const entries = requestLog.get();
      // Model requests and tool runs share the timeline but not the columns,
      // so each row shows what it has.
      // eslint-disable-next-line no-console
      console.table(
        entries.map((entry) =>
          entry.kind === 'request'
            ? {
                what: `${entry.provider}/${entry.model}`,
                status: entry.status,
                firstToken: entry.firstTokenMs,
                total: entry.totalMs,
                promptChars: entry.promptChars,
                replyChars: entry.responseChars,
                error: entry.error?.message,
              }
            : {
                what: `tool: ${entry.name}`,
                status: entry.status,
                total: entry.totalMs,
                error: entry.error?.message,
              },
        ),
      );
      return entries;
    },
    dump: dumpRequestLog,
    clear: clearRequestLog,
  };
}

export async function runCodexTurn(options: CodexTurnOptions): Promise<void> {
  exposeRequestLog();

  let binding: ModelBinding;
  try {
    binding = resolveBinding(
      options.modelConfig,
      options.selectedModelId,
      options.apiKeys,
      options.effort,
    );
  } catch (error) {
    options.onDone({ reason: 'error', error: (error as Error).message, text: '' });
    return;
  }

  beginTurn(options.turnId);

  let transcript = '';

  /*
   * Goal mode, when the caller asked for it.
   *
   * The runtime is created here rather than inside `runTurn` so the same object
   * survives across the automatic continuations *and* across a reload: the host
   * persists whatever `onGoal` hands it and passes it back as `resume`.
   */
  const goalRuntime =
    options.goal && (options.goal.objective || options.goal.resume)
      ? new GoalRuntime(options.goal.resume ?? null, (goal) => options.onGoal?.(goal))
      : undefined;

  if (goalRuntime && options.goal?.objective) {
    const invalid = goalRuntime.ensureGoal(options.goal.objective);
    if (invalid) {
      // A 4,000-character cap and a non-empty rule are upstream's, and both are
      // things the user can fix — so this is reported rather than swallowed.
      options.onDone({ reason: 'error', error: invalid, text: '' });
      endTurn(options.turnId, invalid);
      return;
    }
  }

  await runTurn({
    prompt: options.prompt,
    history: options.history,
    files: () => readWorkbenchFiles(options.workbench),
    writeFiles: (next) => writeWorkbenchFiles(options.workbench, next),
    model: binding,
    signal: options.signal,
    mode: options.mode ?? 'default',
    goal: goalRuntime,
    requestUserInput: options.requestUserInput,
    extraTools: [runCommandTool(options.workbench), computerUseTool(options.apiKeys)],
    onEvent: (event: HarnessEvent) => {
      if (event.type === 'text') {
        transcript += event.chunk;
        options.onText(event.chunk);
        // Also recorded on the turn, which is the only place the prose keeps
        // its position relative to the tool calls it describes.
        applyHarnessEvent(options.turnId, event);
        return;
      }
      if (event.type === 'goal') {
        options.onGoal?.(event.goal);
        applyHarnessEvent(options.turnId, event);
        return;
      }
      if (event.type === 'turn-end') {
        endTurn(options.turnId, event.error);
        options.onDone({
          reason: event.reason,
          error: event.error,
          text: stripLooseCode(transcript),
          stopReason: event.stopReason,
          goal: goalRuntime?.current() ?? null,
        });
        return;
      }
      applyHarnessEvent(options.turnId, event);
    },
  });
}
