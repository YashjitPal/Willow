import { chatApp, mcpAppId } from '@willow/chat/composer/mentions/chat-apps';
import { connectorsForCard } from '../settings/tabs/connected-apps/connector-map';
import { CONNECTORS_DATA } from './customize-data';

/**
 * Customize → Connectors, on the real connectors.
 *
 * The cards are Gemini's catalogue; `connector-map.ts` is the much shorter list
 * Willow can actually request scopes for. Most ids are shared — only Workspace is
 * named differently here. A card that names an MCP preset instead (`CustomizeItem.mcp`)
 * connects through `customize-mcp.ts`, and has no connector here at all.
 */
const CARD_IDS: Record<string, string> = {
  'google-workspace': 'workspace',
};

/** The `connector-map.ts` card id behind a Customize connector. */
export const connectorCardId = (itemId: string): string => CARD_IDS[itemId] ?? itemId;

/** The chat "@" mention for a connector, when it maps to exactly one app; an MCP card's is its app's name. */
export const connectorMention = (itemId: string): string | null => {
  const server = CONNECTORS_DATA.find((item) => item.id === itemId)?.mcp;
  if (server) return chatApp(mcpAppId(server))?.label ?? null;
  const ids = connectorsForCard(connectorCardId(itemId));
  return ids.length === 1 ? chatApp(ids[0])?.label ?? null : null;
};
