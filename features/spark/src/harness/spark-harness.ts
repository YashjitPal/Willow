import type { AiOptions, ChatMessage, StreamPhase } from '@willow/ai/chat';
import { runTurn, type ModelBinding, type Transport } from './runtime/agent';
import type { HarnessEvent, Message, ToolHandler } from './runtime/protocol';
import { createSparkHarnessProfile, type SparkProfileContext } from './overlay/spark-profile';
import { createSparkCapabilityTools, type SparkCapabilityContext } from './spark-tools';
import { createOpfsWorkspace, emptySparkWorkspace, type SparkWorkspace } from './workspace/workspace';
import { goalToolDeclarations, SparkGoalRuntime, type SparkThreadGoal } from './runtime/goal';

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
  /** Injectable provider transport for focused harness tests. */
  transport?: Transport;
  onEvent: (event: HarnessEvent) => void;
}

export interface SparkHarnessResult {
  response: string;
  files: Record<string, string>;
  reason: 'complete' | 'cancelled' | 'error';
  error?: string;
}

// Browser-safe stand-in for Codex's idle-thread continuation hook. A live app
// invocation cannot run forever, so retain the active persisted goal after a
// generous safety bound; reopening/resuming the Spark task continues it.
const MAX_GOAL_CONTINUATIONS_PER_INVOCATION = 32;

const toMessage = (entry: ChatMessage): Message => ({
  id: entry.id || `history-${entry.createdAt ?? Date.now()}`,
  role: entry.role,
  blocks: [{ type: 'text', id: `${entry.id ?? 'history'}-text`, content: entry.content }],
  createdAt: entry.createdAt ?? Date.now(),
});

/** Spark's focused Codex loop. Chat and Code Beta never import this module. */
export const runSparkHarnessTurn = async (options: SparkHarnessOptions): Promise<SparkHarnessResult> => {
  const workspace = options.workspace ?? await createOpfsWorkspace(options.scope).catch(() => emptySparkWorkspace());
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
  if (options.capabilities.selectedCapabilities?.includes('goal')) {
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
    options: options.model,
    label: options.model.label,
    effort: options.model.effort,
  };
  const history = [...(options.history ?? [])];
  const last = history.at(-1);
  if (last?.role === 'user' && last.content.trim() === options.prompt.trim()) {
    history.pop();
  }
  const baseHistory = history.map(toMessage);
  const run = async (prompt: string, turnHistory: Message[]) => runTurn({
    prompt,
    history: turnHistory,
    files: () => ({ ...files }),
    writeFiles: (next) => {
      files = { ...next };
      pendingWrite = pendingWrite.then(() => workspace.writeFiles(files));
    },
    model: binding,
    profile: createSparkHarnessProfile(options.capabilities),
    extraTools: capabilityTools,
    goalRuntime,
    collaborationThreadId: options.threadId ?? options.scope,
    toolDeclarations: [goalToolDeclarations()],
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

  await runAndRecord(options.prompt);

  // Codex Goal mode automatically starts another turn when the thread becomes
  // idle while its persisted goal is still active. Keep the browser port
  // bounded per invocation so a broken provider cannot loop forever; the goal
  // remains active and the next Spark run can resume it.
  for (let continuation = 0; continuation < MAX_GOAL_CONTINUATIONS_PER_INVOCATION && reason === 'complete' && goalRuntime.isActive(); continuation += 1) {
    if (options.signal?.aborted) break;
    await runAndRecord(goalRuntime.continuationPrompt());
  }
  await pendingWrite;
  return { response: response.trim(), files, reason, error };
};
