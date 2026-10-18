import { useEffect, useMemo } from 'react';
import { useStore } from '@nanostores/react';
import { mcpServers } from '@willow/ai/mcp/mcp-store';
import type { CustomizeItem } from '../customize-data';
import { clearStaleStages, customAppItem, customAppMeta, customAppServers } from './custom-app';

/** The Connectors tab's "Custom apps" cards, from the MCP store; a server a closed tab left half-added is cleared first. */
export function useCustomApps(): CustomizeItem[] {
  const servers = useStore(mcpServers);
  const meta = useStore(customAppMeta);
  useEffect(() => {
    void clearStaleStages();
  }, []);
  return useMemo(
    () => customAppServers(servers, meta).map((server) => customAppItem(server, meta[server.id])),
    [servers, meta],
  );
}
