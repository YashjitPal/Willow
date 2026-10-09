/**
 * The app a bot's call reaches — a connected app, the user's email, an MCP server — as its conversation marks it:
 * "Connecting to <logo> <app>", the line Willow's chat shows while a connected app's tool runs.
 */
import { mcpServers } from '@willow/ai/mcp/mcp-store';
import { chatApp } from '@willow/chat/composer/mentions/chat-apps';
import { connectorForAction, connectorForRead, type ConnectorId } from '@willow/personal';
import { MCP_PRESETS } from '../../mcp-catalog';
import { CONNECTOR_APPS } from '../../spark-connectors';

export interface DotAppMark {
  /** One mark per app per turn, by this. */
  key: string;
  label: string;
  /** The app's own logo, where Willow has one; else a Material Symbol. */
  logo?: string;
  symbol?: string;
}

const connected = (id: ConnectorId): DotAppMark | null => {
  const app = CONNECTOR_APPS[id];
  return app ? { key: `app:${id}`, label: app.label, ...(chatApp(id)?.logo ? { logo: chatApp(id)!.logo } : { symbol: 'apps' }) } : null;
};

/** The app a call reaches, or null for the bot's own tools, the web and the user's computer. */
export const appOfCall = (tool: string | undefined): DotAppMark | null => {
  if (!tool) return null;
  if (tool === 'send_email') return connected('gmail');
  if (tool.startsWith('app:')) {
    const id = connectorForRead(tool.slice(4)) ?? connectorForAction(tool.slice(4));
    return id ? connected(id) : null;
  }
  const server = /^mcp:mcp__(.+?)__/.exec(tool)?.[1];
  // Spark's own `computer` tools are the user's computer, which the conversation marks its own way.
  if (!server || server === 'computer') return null;
  const preset = MCP_PRESETS.find((entry) => entry.id === server);
  const label = mcpServers.get().find((entry) => entry.id === server)?.label ?? preset?.label ?? server;
  return { key: `mcp:${server}`, label, symbol: preset?.icon ?? 'extension' };
};
