import type { AiOptions, ChatMessage, StreamPhase } from '@willow/ai/chat';
import { runTurn, type ModelBinding } from './runtime/agent';
import type { HarnessEvent, Message, ToolHandler } from './runtime/protocol';
import { createSparkHarnessProfile, type SparkProfileContext } from './overlay/spark-profile';
import { createSparkCapabilityTools, type SparkCapabilityContext } from './spark-tools';
import { createOpfsWorkspace, emptySparkWorkspace, type SparkWorkspace } from './workspace/workspace';

export interface SparkHarnessOptions {
  prompt: string;
  history?: ChatMessage[];
  model: Omit<AiOptions, 'signal'> & { label: string; effort?: ModelBinding['effort'] };
  scope: string;
  capabilities: SparkProfileContext & SparkCapabilityContext;
  signal?: AbortSignal;
  workspace?: SparkWorkspace;
  onEvent: (event: HarnessEvent) => void;
}

export interface SparkHarnessResult {
  response: string;
  files: Record<string, string>;
  reason: 'complete' | 'cancelled' | 'error';
  error?: string;
}

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
  const transport = async (
    messages: { role: 'user' | 'assistant'; content: string }[],
    modelOptions: AiOptions,
    onToken: (token: string) => void,
    onStart: () => void,
    systemPrompt: string,
    onPhase: (phase: StreamPhase) => void,
    onToolCall: (name: string, args: Record<string, unknown>) => Promise<unknown>,
    onThought: (thought: string) => void,
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
    );
  };
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
  await runTurn({
    prompt: options.prompt,
    history: history.map(toMessage),
    files: () => ({ ...files }),
    writeFiles: (next) => {
      files = { ...next };
      pendingWrite = pendingWrite.then(() => workspace.writeFiles(files));
    },
    model: binding,
    profile: createSparkHarnessProfile(options.capabilities),
    extraTools: capabilityTools,
    transport,
    signal: options.signal,
    onEvent: emit,
  });
  await pendingWrite;
  return { response: response.trim(), files, reason, error };
};
