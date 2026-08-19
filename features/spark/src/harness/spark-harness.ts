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

const stringProperty = (description: string) => ({ type: 'STRING', description });

const createToolDeclarations = (
  capabilities: SparkProfileContext,
  nativeNameMap: Map<string, string>,
): { functionDeclarations: any[] }[] => [{
  functionDeclarations: [
    {
      name: 'apply_patch',
      description: 'Apply a Codex patch to create, update, move, or delete workspace files.',
      parameters: { type: 'OBJECT', properties: { patch: stringProperty('Complete Codex patch envelope') }, required: ['patch'] },
    },
    {
      name: 'read_file',
      description: 'Read a text file from the private Spark workspace.',
      parameters: { type: 'OBJECT', properties: { path: stringProperty('Workspace path beginning with /'), start_line: { type: 'INTEGER' }, end_line: { type: 'INTEGER' } }, required: ['path'] },
    },
    {
      name: 'list_files',
      description: 'List files in the private Spark workspace.',
      parameters: { type: 'OBJECT', properties: { path: stringProperty('Optional workspace directory path') } },
    },
    {
      name: 'search_files',
      description: 'Search text files in the private Spark workspace.',
      parameters: { type: 'OBJECT', properties: { query: stringProperty('Text or regular expression to search for'), regex: { type: 'BOOLEAN' } }, required: ['query'] },
    },
    {
      name: 'update_plan',
      description: 'Update a visible plan for a multi-step Spark task.',
      parameters: { type: 'OBJECT', properties: { plan: { type: 'ARRAY', items: { type: 'OBJECT' } }, explanation: stringProperty('Optional short explanation') }, required: ['plan'] },
    },
    {
      name: 'run_command',
      description: 'Run a command only inside a user-authorised local companion workspace.',
      parameters: { type: 'OBJECT', properties: { command: stringProperty('Command to run'), cwd: stringProperty('Workspace-relative working directory'), root: stringProperty('Absolute root to authorize when needed'), timeoutMs: { type: 'NUMBER' } }, required: ['command'] },
    },
    ...(capabilities.connectedApps.length ? [{
      name: 'connected_app',
      description: 'Use a connected app only when the requested app action has a real adapter.',
      parameters: { type: 'OBJECT', properties: { app: stringProperty('Connected app id'), action: stringProperty('Requested action') }, required: ['app', 'action'] },
    }] : []),
    ...(capabilities.mcpTools ?? []).map((tool) => {
      const nativeName = `mcp__${tool.name.replace(/[^a-zA-Z0-9_]/g, '_')}`;
      nativeNameMap.set(nativeName, `mcp:${tool.name}`);
      return ({
      name: nativeName,
      description: tool.description || `Call the ${tool.name} MCP tool.`,
      parameters: { type: 'OBJECT', properties: { input: { type: 'OBJECT' } } },
      });
    }),
  ],
}];

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
  const nativeNameMap = new Map<string, string>();
  const toolDeclarations = createToolDeclarations(options.capabilities, nativeNameMap);
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
      { ...modelOptions, enableSearch: false, enableCodeExecution: false },
      onToken,
      onStart,
      systemPrompt,
      onPhase,
      async (name, args) => onToolCall(nativeNameMap.get(name) ?? name, args),
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
    toolDeclarations,
    transport,
    signal: options.signal,
    onEvent: emit,
  });
  await pendingWrite;
  return { response: response.trim(), files, reason, error };
};
