/**
 * What a Spark run can reach beyond its workspace: the user's connected apps and MCP servers, and
 * how a call to either reads on the timeline.
 *
 * Connected apps are Willow's connectors (`@willow/personal`) — the same live reads and actions
 * Chat runs — offered only for products that are connected *and hold a token right now*
 * (`usableConnectors`). A model shown an app it cannot reach calls it anyway and apologises; one
 * never shown it answers from what it has. The Google ones also sit behind Spark's own Google
 * Workspace switch on the Connected apps page, which is on by default as Gemini's is.
 *
 * MCP servers are the app-level list in `@willow/ai/mcp/mcp-store`, shared with Code.
 */

import { boundMcpTools, connectEnabledMcpServers } from '@willow/ai/mcp/mcp-store';
import './mcp-relay';
import {
  connectorForAction,
  connectorForRead,
  geminiActionTools,
  geminiReadTools,
  runPersonalTool,
  usableConnectors,
  type ConnectorId,
} from '@willow/personal';
import type { ToolCall } from './harness/runtime/protocol';
import { sparkComputerTools } from './spark-computer-tools';
import type { SparkConnectorTool, SparkMcpTool } from './harness/spark-tools';
import type { SparkCommandRowStatus, SparkConnectedAppId } from './spark-types';

/** Each connector as an app on the timeline (its logo key and name), and whether it is Google Workspace. */
export const CONNECTOR_APPS: Record<ConnectorId, { app: string; label: string; workspace?: true }> = {
  gmail: { app: 'gmail', label: 'Gmail', workspace: true },
  calendar: { app: 'google-calendar', label: 'Google Calendar', workspace: true },
  drive: { app: 'google-drive', label: 'Google Drive', workspace: true },
  docs: { app: 'google-docs', label: 'Google Docs', workspace: true },
  tasks: { app: 'google-tasks', label: 'Google Tasks', workspace: true },
  youtube: { app: 'youtube', label: 'YouTube' },
  spotify: { app: 'spotify', label: 'Spotify' },
  github: { app: 'github', label: 'GitHub' },
};

interface Declaration {
  name: string;
  description: string;
  parameters?: { properties?: Record<string, { type?: string }>; required?: string[] };
}

/** A one-line argument signature the model can copy, from a declaration's parameters. */
export const argumentSignature = (parameters: Declaration['parameters'] | Record<string, unknown> | undefined): string => {
  const properties = (parameters as Declaration['parameters'])?.properties;
  if (!properties || Object.keys(properties).length === 0) return '{}';
  const required = new Set((parameters as Declaration['parameters'])?.required ?? []);
  const parts = Object.entries(properties).map(([name, definition]) => {
    const raw = (definition as { type?: unknown })?.type;
    const type = Array.isArray(raw) ? raw.join('|') : typeof raw === 'string' ? raw.toLowerCase() : 'any';
    return `${name}${required.has(name) ? '' : '?'}: ${type}`;
  });
  return `{ ${parts.join(', ')} }`;
};

/** The connected apps' tools for one run. */
export const sparkConnectorTools = (connections: Partial<Record<SparkConnectedAppId, boolean>>): SparkConnectorTool[] => {
  const connected = usableConnectors().filter((id) => !CONNECTOR_APPS[id]?.workspace || connections.workspace !== false);
  if (connected.length === 0) return [];
  const declarations: Declaration[] = [
    ...(geminiReadTools(connected)?.functionDeclarations ?? []),
    ...(geminiActionTools(connected)?.functionDeclarations ?? []),
  ];
  return declarations.flatMap((declaration) => {
    const connector = connectorForRead(declaration.name) ?? connectorForAction(declaration.name);
    const app = connector ? CONNECTOR_APPS[connector] : undefined;
    if (!app) return [];
    return [{
      name: declaration.name,
      app: app.app,
      appLabel: app.label,
      description: declaration.description,
      signature: argumentSignature(declaration.parameters),
      run: async (args: Record<string, unknown>) => {
        const result = await runPersonalTool(declaration.name, args);
        if (!result) return { text: `${app.label} is not available right now. Tell the user, and do not guess at what it holds.`, failed: true };
        return { text: result.text };
      },
    }];
  });
};

/**
 * Every tool of every enabled, connected MCP server, connecting enabled servers first — and, in the desktop app, the
 * user's own computer (`spark-computer-tools.ts`), offered the same way.
 */
export const sparkMcpTools = async (): Promise<SparkMcpTool[]> => {
  await connectEnabledMcpServers().catch(() => {});
  const servers = boundMcpTools().map((tool) => ({
    name: tool.qualifiedName,
    server: tool.serverLabel,
    description: tool.description,
    signature: argumentSignature(tool.inputSchema),
    call: async (args: Record<string, unknown>) => {
      const { text, failed } = await tool.client.callTool(tool.toolName, args);
      if (failed) throw new Error(text || `${tool.serverLabel} reported a failure.`);
      return text;
    },
  }));
  return [...servers, ...(await sparkComputerTools().catch(() => []))];
};

/**
 * The row a call puts on the timeline, for the calls that carry their own: reading a skill, a
 * connected app and an MCP tool. Every other call is a capability row keyed by its kind.
 */
export const timelineRowForCall = (call: ToolCall): { tool: string; label?: string; callId?: string; status?: SparkCommandRowStatus } | null => {
  if (call.kind === 'skill') return { tool: `skill:${call.skill}` };
  if (call.kind === 'app') return { tool: `app:${call.app}`, label: call.title };
  if (call.kind === 'mcp') return { tool: `mcp:${call.server}`, label: call.title };
  // A real command, from the desktop app's native runtime: the command itself, and its call's status
  // for the group it joins on the timeline (`spark-command-rows.ts`).
  if (call.kind === 'command' && call.shell) return { tool: 'command', label: nativeCommandLabel(call), callId: call.id, status: call.status };
  return null;
};

/** Codex's words for a `write_stdin` round, and the command for everything else. */
const nativeCommandLabel = (call: Extract<ToolCall, { kind: 'command' }>): string => {
  const command = call.command.replace(/\s+/g, ' ').trim();
  if (call.interaction === 'wait') return command ? `Waited for background terminal · ${command}` : 'Waited for background terminal';
  if (call.interaction === 'write') return command ? `Interacted with background terminal · ${command}` : 'Interacted with background terminal';
  return command;
};
