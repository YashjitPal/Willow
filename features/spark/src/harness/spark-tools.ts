import { localCompanion } from '@willow/code/local-companion';
import { nextId } from './runtime/tools';
import type { AppCall, CommandCall, McpCall, ToolHandler, ToolResult } from './runtime/protocol';

export interface SparkCapabilityContext {
  skills: readonly { name: string; instructions: string }[];
  connectedApps: readonly { id: string; label: string }[];
  mcp?: readonly { name: string; description?: string; call: (args: Record<string, unknown>) => Promise<unknown> }[];
  onCapability?: (name: string) => void;
}

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

export const createSparkCapabilityTools = (context: SparkCapabilityContext): ToolHandler[] => {
  const tools: ToolHandler[] = [];
  if (context.connectedApps.length) {
    tools.push({
      id: 'connected_app',
      async run(args, toolContext): Promise<ToolResult> {
        const app = text(args.app);
        const match = context.connectedApps.find((candidate) => candidate.id === app || candidate.label.toLowerCase() === app.toLowerCase());
        context.onCapability?.(`app:${match?.id ?? app}`);
        const callId = toolContext.emit({
          id: nextId('call'), kind: 'app', status: 'running', startedAt: Date.now(),
          app: match?.label ?? app, action: text(args.action) || 'use', input: args,
        } as AppCall);
        const observation = match
          ? `The ${match.label} connection is enabled, but this Spark build has no action adapter for it yet. Do not claim to have read or changed it.`
          : `No connected app named ${JSON.stringify(app)} is available.`;
        toolContext.patch(callId, { status: 'error', endedAt: Date.now(), error: observation, output: observation } as Partial<AppCall>);
        return { observation: match
          ? observation
          : observation, failed: true };
      },
    } as ToolHandler);
  }
  if (context.mcp?.length) {
    for (const mcp of context.mcp) {
      tools.push({
        id: `mcp:${mcp.name}`,
        async run(args, toolContext): Promise<ToolResult> {
          context.onCapability?.(`mcp:${mcp.name}`);
          const callId = toolContext.emit({
            id: nextId('call'), kind: 'mcp', status: 'running', startedAt: Date.now(),
            server: mcp.name, tool: mcp.name, input: args,
          } as McpCall);
          try {
            const result = await mcp.call(args);
            toolContext.patch(callId, { status: 'success', endedAt: Date.now(), output: JSON.stringify(result) } as Partial<McpCall>);
            return { observation: JSON.stringify(result) };
          } catch (error) {
            const observation = `MCP ${mcp.name} failed: ${error instanceof Error ? error.message : 'unknown error'}`;
            toolContext.patch(callId, { status: 'error', endedAt: Date.now(), error: observation, output: observation } as Partial<McpCall>);
            return { observation, failed: true };
          }
        },
      } as ToolHandler);
    }
  }
  tools.push({
    id: 'run_command',
    async run(args, toolContext): Promise<ToolResult> {
      const command = text(args.command);
      if (!command) return { observation: 'run_command requires a command.', failed: true };
      context.onCapability?.('run_command');
      const callId = toolContext.emit({
        id: nextId('call'), kind: 'command', status: 'running', startedAt: Date.now(),
        command, cwd: text(args.cwd) || '/workspace', output: [],
      } as CommandCall);
      try {
        let workspaceId = text(args.workspaceId);
        if (!workspaceId && text(args.root)) {
          const authorised = await localCompanion.request<{ workspaceId: string }>('workspace.authorize', { root: text(args.root) });
          workspaceId = authorised.workspaceId;
        }
        if (!workspaceId) throw new Error('Authorise a local workspace before running commands.');
        const result = await localCompanion.request<{ code: number | null; signal?: string; stdout?: string; stderr?: string }>('shell.exec', {
          command,
          cwd: text(args.cwd) || '.',
          timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : 30_000,
          workspaceId,
        });
        const output = [
          result.stdout ? { stream: 'stdout' as const, text: result.stdout } : null,
          result.stderr ? { stream: 'stderr' as const, text: result.stderr } : null,
        ].filter((entry): entry is { stream: 'stdout' | 'stderr'; text: string } => Boolean(entry));
        toolContext.patch(callId, { status: result.code === 0 ? 'success' : 'error', endedAt: Date.now(), output, exitCode: result.code ?? undefined } as Partial<CommandCall>);
        return { observation: JSON.stringify(result), failed: result.code !== 0 };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Command execution is unavailable.';
        toolContext.patch(callId, { status: 'error', endedAt: Date.now(), error: message } as Partial<CommandCall>);
        return { observation: message, failed: true };
      }
    },
  });
  return tools;
};
