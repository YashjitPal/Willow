import type { AiOptions, ChatMessage, StreamPhase } from '@willow/ai/chat';
import { runTurn, type ModelBinding, type Transport } from './runtime/agent';
import type { HarnessEvent, Message, ToolHandler } from './runtime/protocol';
import { createSparkHarnessProfile, type SparkProfileContext } from './overlay/spark-profile';
import { createSparkNativeHarnessProfile } from './overlay/spark-native-profile';
import type { SparkNativeRuntime } from './native/native-runtime';
import {
  createSparkCapabilityTools,
  runComputerRequest,
  type SparkCapabilityContext,
  type SparkComputerRequest,
} from './spark-tools';
import { createOpfsWorkspace, emptySparkWorkspace, type SparkWorkspace } from './workspace/workspace';
import { goalToolDeclarations, SparkGoalRuntime, type SparkThreadGoal } from './runtime/goal';
import type { ModeKind } from './overlay/collaboration-mode';
import type { RequestUserInputSink } from './runtime/request-user-input';

export interface SparkHarnessOptions {
  prompt: string;
  history?: ChatMessage[];
  model: Omit<AiOptions, 'signal'> & { label: string; effort?: ModelBinding['effort'] };
  scope: string;
  threadId?: string;
  capabilities: SparkProfileContext & SparkCapabilityContext;
  signal?: AbortSignal;
  workspace?: SparkWorkspace;
  goal?: SparkThreadGoal | null;
  onGoalChange?: (goal: SparkThreadGoal | null) => void;
  /**
   * How Plan mode asks the user a question.
   *
   * Optional: without it `request_user_input` still registers in Plan mode and
   * tells the model the affordance is unwired, which is honest. Spark runs
   * tasks on a schedule, so an unattended run legitimately has nobody to ask.
   */
  requestUserInput?: RequestUserInputSink;
  /** Labs `request-user-input`: lets the agent ask outside Plan mode, non-blocking. */
  askOutsidePlanMode?: boolean;
  /** Injectable provider transport for focused harness tests. */
  transport?: Transport;
  /**
   * The user's answer to a browser permission card, carried by the turn that
   * answers it ("Allow" / "Don't allow").
   *
   * Allowed, the request the user reviewed runs before the model does — exactly
   * that plan, not one the model re-plans after the fact — and the model answers
   * from the browser's report. Declined, the model is told so and answers without it.
   */
  browserDecision?: { allowed: boolean; request: SparkComputerRequest };
  /**
   * The desktop app's native runtime (`./native/native-runtime.ts`). Set, the turn
   * works on the user's computer through Codex's tools instead of the browser
   * workspace; stopping the turn stops the commands it started.
   */
  native?: SparkNativeRuntime;
  onEvent: (event: HarnessEvent) => void;
}

export interface SparkHarnessResult {
  response: string;
  files: Record<string, string>;
  reason: 'complete' | 'cancelled' | 'error';
  error?: string;
}

/**
 * What the model reads on the turn that answers a permission card: the user's
 * own words, then what became of the request.
 */
const promptAfterBrowserDecision = async (
  options: SparkHarnessOptions,
  emit: (event: HarnessEvent) => void,
): Promise<string> => {
  const decision = options.browserDecision;
  if (!decision) return options.prompt;
  const { request } = decision;
  if (!decision.allowed) {
    return [
      options.prompt,
      `[The user did not allow the browser for "${request.title}". Do not call \`computer\` again unless they ask for it. Answer as well as you can without it, and say what you could not check.]`,
    ].join('\n\n');
  }
  const computer = options.capabilities.computer;
  if (!computer) {
    return [
      options.prompt,
      `[The user allowed the browser for "${request.title}", but it is unavailable in this run. Say so, and answer as well as you can without it.]`,
    ].join('\n\n');
  }
  emit({ type: 'activity', label: 'Thinking it through…' });
  const result = await runComputerRequest(computer, request, {
    emit: (call) => {
      emit({ type: 'call-start', call });
      return call.id;
    },
    patch: (id, patch) => emit({ type: 'call-progress', id, patch }),
    signal: options.signal,
  });
  emit({ type: 'activity', label: null });
  return [
    options.prompt,
    '[The user allowed the browser for this thread, and it ran the plan they reviewed. The `computer` result:]',
    result.observation,
    '[Answer the user\'s request from it now. Call `computer` again only if something essential is still missing.]',
  ].join('\n\n');
};

const toMessage = (entry: ChatMessage): Message => ({
  id: entry.id || `history-${entry.createdAt ?? Date.now()}`,
  role: entry.role,
  blocks: [{ type: 'text', id: `${entry.id ?? 'history'}-text`, content: entry.content }],
  createdAt: entry.createdAt ?? Date.now(),
});

/** Spark's focused Codex loop. Chat and Code Beta never import this module. */
export const runSparkHarnessTurn = async (options: SparkHarnessOptions): Promise<SparkHarnessResult> => {
  const { native } = options;
  const workspace = native
    ? emptySparkWorkspace()
    : options.workspace ?? await createOpfsWorkspace(options.scope).catch(() => emptySparkWorkspace());
  let files = await workspace.readFiles();
  let response = '';
  let reason: SparkHarnessResult['reason'] = 'complete';
  let error: string | undefined;
  let pendingWrite: Promise<void> = Promise.resolve();
  const emit = (event: HarnessEvent): void => {
    if (event.type === 'text') response += event.chunk;
    if (event.type === 'turn-end') {
      reason = event.reason;
      error = event.error;
    }
    options.onEvent(event);
  };
  const capabilityTools = createSparkCapabilityTools(options.capabilities);
  const goalRuntime = new SparkGoalRuntime(options.threadId ?? options.scope, options.goal, (goal) => {
    options.onGoalChange?.(goal);
    emit({ type: 'goal-updated', goal });
  });
  /*
   * The composer's Plan chip selects upstream's Plan collaboration mode.
   *
   * Upstream treats the mode as sticky session state that only a new developer
   * message changes; Spark's equivalent of "the user chose a mode" is the chip
   * recorded on the task, so it is read per turn from there.
   */
  const mode: ModeKind = options.capabilities.selectedCapabilities?.includes('plan')
    ? 'plan'
    : 'default';

  /*
   * Goal mode does not activate in Plan mode.
   *
   * Upstream's idle-continuation gate rejects a turn outright when the thread
   * is in Plan mode and the input carries no user text
   * (`TryStartTurnIfIdleRejectionReason::PlanMode` in
   * `codex-rs/core/src/session/inject.rs`), and its goal accounting skips plan
   * turns entirely. A Plan-mode turn produces a plan for the user to approve —
   * looping it against a persisted objective would have it re-plan forever
   * without ever being allowed to do the work.
   */
  if (mode !== 'plan' && options.capabilities.selectedCapabilities?.includes('goal')) {
    goalRuntime.ensureGoal(options.prompt);
  }
  const transport: Transport = options.transport ?? (async (
    messages: { role: 'user' | 'assistant'; content: string }[],
    modelOptions: AiOptions,
    onToken: (token: string) => void,
    onStart: () => void,
    systemPrompt: string,
    onPhase: (phase: StreamPhase) => void,
    onToolCall: (name: string, args: Record<string, unknown>) => Promise<unknown>,
    onThought: (thought: string) => void,
    onUsage: (usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number }) => void,
  ): Promise<unknown> => {
    const { streamChat } = await import('@willow/ai/chat');
    return streamChat(
      messages,
      { ...modelOptions },
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
  });
  const binding: ModelBinding = {
    // Spark owns this focused agent loop, so native provider tool rounds must
    // not reintroduce the shared chat default of 32 iterations.
    options: { ...options.model, maxToolIterations: Infinity },
    label: options.model.label,
    effort: options.model.effort,
  };
  const history = [...(options.history ?? [])];
  const last = history.at(-1);
  if (last?.role === 'user' && last.content.trim() === options.prompt.trim()) {
    history.pop();
  }
  const baseHistory = history.map(toMessage);
  const titleHint = options.browserDecision?.request.title;
  const run = async (prompt: string, turnHistory: Message[]) => runTurn({
    prompt,
    titleHint,
    history: turnHistory,
    files: () => ({ ...files }),
    writeFiles: (next) => {
      files = { ...next };
      pendingWrite = pendingWrite.then(() => workspace.writeFiles(files));
    },
    model: binding,
    // The flag has to reach the prompt as well as the registry, or the model
    // reads "only available in Plan mode" and declines a tool it now has.
    profile: native
      ? createSparkNativeHarnessProfile({ ...options.capabilities, askOutsidePlanMode: options.askOutsidePlanMode }, native.profile)
      : createSparkHarnessProfile({
        ...options.capabilities,
        askOutsidePlanMode: options.askOutsidePlanMode,
      }),
    // Native tools come last: they replace the web runtime's tools of the same ids.
    extraTools: native ? [...capabilityTools, ...native.tools] : capabilityTools,
    diskPatches: native?.diskPatches,
    turnContext: native?.turnContext,
    refusalFor: native?.refusalFor,
    mode,
    requestUserInput: options.requestUserInput,
    askOutsidePlanMode: options.askOutsidePlanMode,
    goalRuntime,
    collaborationThreadId: options.threadId ?? options.scope,
    toolDeclarations: native ? [goalToolDeclarations(), native.toolDeclarations] : [goalToolDeclarations()],
    transport,
    signal: options.signal,
    onEvent: emit,
  });

  const continuationHistory = [...baseHistory];
  const runAndRecord = async (prompt: string): Promise<void> => {
    const responseStart = response.length;
    await run(prompt, continuationHistory);
    const segment = response.slice(responseStart).trim();
    continuationHistory.push(toMessage({ role: 'user', content: prompt }));
    if (segment) continuationHistory.push(toMessage({ role: 'assistant', content: segment }));
  };

  await runAndRecord(await promptAfterBrowserDecision(options, emit));

  // Codex Goal mode automatically starts another turn when the thread becomes
  // idle while its persisted goal is still active. Continue until the model
  // completes the goal, cancellation occurs, or the goal is explicitly ended.
  for (;;) {
    if (reason !== 'complete' || !goalRuntime.isActive()) break;
    if (options.signal?.aborted) break;
    await runAndRecord(goalRuntime.continuationPrompt());
  }
  if (native && options.signal?.aborted) await native.stop();
  await pendingWrite;
  return { response: response.trim(), files, reason, error };
};
