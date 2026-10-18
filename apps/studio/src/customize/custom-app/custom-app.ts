/**
 * Custom apps: MCP servers added by address from Connectors' "+ Custom", as Gemini's custom connected apps are.
 *
 * Each is a server in Willow's one MCP store (`@willow/ai/mcp/mcp-store`), so Chat, Spark and the rest use its
 * tools like any other server's, and one added anywhere else (Spark's Connected apps) shows here too. What the
 * store has no field for — what the server said about itself and when it was last read — is kept in `META_KEY`.
 *
 * Adding one runs Gemini's three steps: the address is checked (`isHttpsAddress`, not already connected), then
 * the server is tried while stored switched off (`stageCustomApp`) — signed in to from the desktop app when it
 * asks — and only the review's Connect turns it on (`saveCustomApp`). Leaving earlier removes it again.
 */
import { atom } from 'nanostores';
import {
  connectMcpServer,
  mcpRuntime,
  mcpServers,
  removeMcpServer,
  setMcpServerEnabled,
  suggestMcpServerId,
  upsertMcpServer,
  type McpServerConfig,
} from '@willow/ai/mcp/mcp-store';
import type { McpToolDescriptor } from '@willow/ai/mcp/mcp-protocol';
import { MCP_PRESETS, OWN_APP_REDIRECT } from '@willow/spark/mcp-catalog';
import { canSignInHere, needsOwnApp, signInFromDesktop, signInProblem } from '@willow/spark/mcp-signin';
import type { CustomizeItem } from '../customize-data';

/** Where a sign-in to a server comes back to, for a user's own OAuth app: the companion's fixed loopback address. */
export const CUSTOM_APP_REDIRECT = OWN_APP_REDIRECT;

/** Gemini's rule: an address that parses as https and is written with it. */
export const isHttpsAddress = (value: string): boolean => {
  const url = value.trim();
  if (!url) return false;
  try {
    return new URL(url).protocol === 'https:' && url.startsWith('https://');
  } catch {
    return false;
  }
};

/** An address as Gemini compares them for "already connected": host lower-cased, no trailing slash. */
export const addressKey = (value: string): string | null => {
  const url = value.trim();
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${parsed.port ? `:${parsed.port}` : ''}${parsed.pathname.replace(/\/$/, '')}${parsed.search}`;
  } catch {
    return null;
  }
};

export const isAddressConnected = (value: string, servers: readonly McpServerConfig[]): boolean => {
  const key = addressKey(value);
  return Boolean(key) && servers.some((server) => server.url && addressKey(server.url) === key && !customAppMeta.get()[server.id]?.pending);
};

/** The site a server belongs to, for its favicon: `mcp.deepwiki.com` is deepwiki.com, `api.example.co.uk` example.co.uk. */
export const siteOf = (value: string): string => {
  let host = '';
  try {
    host = new URL(value).hostname.toLowerCase();
  } catch {
    return '';
  }
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const short = parts[parts.length - 1].length === 2 && parts[parts.length - 2].length <= 3;
  return parts.slice(short ? -3 : -2).join('.');
};

/** Gemini's own picture for a custom app: the site's favicon, through Google's favicon service. */
export const faviconFor = (value: string): string => {
  const site = siteOf(value);
  return site ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(site)}&sz=32` : '';
};

/* ------------------------------------------------------------------------ */
/* What Customize keeps beside the store                                    */
/* ------------------------------------------------------------------------ */

export interface CustomAppMeta {
  /** Stored while its dialogs are open, and not yet one of the user's apps. */
  pending?: boolean;
  /** When it was staged, so one left by a closed tab can be cleared. */
  stagedAt?: number;
  description?: string;
  madeBy?: string;
  tools?: string[];
  syncedAt?: number;
}

const META_KEY = 'willow:customize:custom-apps';

const readMeta = (): Record<string, CustomAppMeta> => {
  try {
    const parsed = JSON.parse(localStorage.getItem(META_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

export const customAppMeta = atom<Record<string, CustomAppMeta>>(readMeta());

const writeMeta = (next: Record<string, CustomAppMeta>): void => {
  customAppMeta.set(next);
  try {
    localStorage.setItem(META_KEY, JSON.stringify(next));
  } catch {
    /* Private mode: kept for the session. */
  }
};

const setMeta = (id: string, meta: CustomAppMeta | null): void => {
  const next = { ...customAppMeta.get() };
  if (meta) next[id] = meta;
  else delete next[id];
  writeMeta(next);
};

const STALE_STAGE_MS = 10 * 60_000;

/** Removes servers staged by dialogs that never finished (a reload or a closed tab mid-way). */
export const clearStaleStages = async (now = Date.now()): Promise<void> => {
  const meta = customAppMeta.get();
  for (const [id, entry] of Object.entries(meta)) {
    if (entry.pending && now - (entry.stagedAt ?? 0) > STALE_STAGE_MS) {
      await removeMcpServer(id);
      setMeta(id, null);
    }
  }
};

/* ------------------------------------------------------------------------ */
/* The list                                                                 */
/* ------------------------------------------------------------------------ */

/** Ids on Customize cards, so a custom app is never mistaken for one of the listed connectors. */
export const CUSTOM_APP_PREFIX = 'custom-app:';

export const isCustomAppItem = (item: Pick<CustomizeItem, 'id'>): boolean => item.id.startsWith(CUSTOM_APP_PREFIX);

export const customAppServerId = (item: Pick<CustomizeItem, 'id'>): string => item.id.slice(CUSTOM_APP_PREFIX.length);

/** The store's servers that are custom apps: at an address, not one of the catalog's cards, and finished adding. */
export const customAppServers = (
  servers: readonly McpServerConfig[],
  meta: Record<string, CustomAppMeta>,
): McpServerConfig[] =>
  servers.filter((server) => server.kind === 'http' && Boolean(server.url) && !MCP_PRESETS.some((preset) => preset.id === server.id) && !meta[server.id]?.pending);

export const customAppItem = (server: McpServerConfig, meta: CustomAppMeta | undefined): CustomizeItem => ({
  id: `${CUSTOM_APP_PREFIX}${server.id}`,
  type: 'connector',
  title: server.label,
  subtitle: meta?.description ?? '',
  description: meta?.description,
  logoSrc: faviconFor(server.url ?? ''),
  hasAddButton: !server.enabled,
  hasMoreButton: server.enabled,
});

/** A server's tools by name: the live list when it is connected, else the one read when it was added. */
export const customAppTools = (serverId: string): string[] => {
  const live = mcpRuntime.get()[serverId];
  if (live?.status.state === 'ready') return live.tools.map((tool) => tool.name);
  return customAppMeta.get()[serverId]?.tools ?? [];
};

/* ------------------------------------------------------------------------ */
/* Adding one                                                               */
/* ------------------------------------------------------------------------ */

export interface StagedApp {
  serverId: string;
  name: string;
  description: string;
  madeBy: string;
  tools: McpToolDescriptor[];
  logo: string;
  syncedAt: number;
}

export type StageResult =
  | { ok: true; app: StagedApp }
  /** `expand`: the address is fine but the service wants the user's own OAuth app, so Additional settings opens. */
  | { ok: false; error: string; expand?: boolean };

/** Gemini's sentences for a server that did not connect, by what Willow's client says went wrong. */
export const failureText = (kind: string | undefined, desktop: boolean): string => {
  switch (kind) {
    case 'not-mcp':
    case 'protocol':
      return 'This URL does not appear to be a valid MCP server. Check the URL.';
    case 'blocked-by-server':
      return desktop
        ? 'We had trouble connecting to this server. Contact the server provider for help.'
        : 'This server doesn’t let a web page connect to it. Connect it from the Willow desktop app.';
    case 'unreachable':
    case 'timeout':
      return 'We had trouble connecting to this server. Contact the server provider for help.';
    default:
      return 'Verify the URL and try again.';
  }
};

const nameFrom = (serverName: string | undefined, url: string): string => {
  const name = serverName?.trim();
  if (name && !/^(mcp|server|mcp-server)$/i.test(name)) return name;
  const site = siteOf(url).split('.')[0] ?? '';
  return site ? site.charAt(0).toUpperCase() + site.slice(1) : 'Custom app';
};

const readyApp = (serverId: string, url: string): StagedApp | null => {
  const entry = mcpRuntime.get()[serverId];
  if (entry?.status.state !== 'ready') return null;
  // `instructions` is guidance for the model, not a description, so only a server's own `description` is shown.
  const info = entry.client?.serverInfo as { name?: string; title?: string; description?: string } | undefined;
  const name = nameFrom(info?.title || info?.name, url);
  return {
    serverId,
    name,
    description: info?.description?.trim().slice(0, 280) ?? '',
    madeBy: info?.name?.trim() || name,
    tools: entry.tools,
    logo: faviconFor(url),
    syncedAt: Date.now(),
  };
};

/**
 * Tries a server at `url` without adding it: stored switched off (so no turn uses its tools yet), connected, and
 * signed in to first when it asks and this is the desktop app. `client` is the user's own OAuth app, from
 * Additional settings. Fails with Gemini's sentence for what went wrong, having removed what it stored.
 */
export async function stageCustomApp(url: string, client?: { clientId: string; clientSecret?: string }): Promise<StageResult> {
  const address = url.trim();
  let host = 'custom-app';
  try {
    host = new URL(address).hostname;
  } catch {
    return { ok: false, error: 'Please enter a valid URL starting with https://' };
  }
  // Never a catalog card's id: a server under one of those is that card's (DeepWiki's, Canva's), not a custom app.
  const id = suggestMcpServerId(siteOf(address).split('.')[0] || host, MCP_PRESETS.map((preset) => preset.id));
  const config: McpServerConfig = { id, label: host, kind: 'http', url: address, enabled: false };
  setMeta(id, { pending: true, stagedAt: Date.now() });
  upsertMcpServer(config);
  const fail = async (result: StageResult): Promise<StageResult> => {
    await removeMcpServer(id);
    setMeta(id, null);
    return result;
  };
  try {
    if (!client) await connectMcpServer(id);
    let status = mcpRuntime.get()[id]?.status;
    if (client || (status?.state === 'failed' && status.kind === 'needs-sign-in')) {
      if (!(await canSignInHere())) return fail({ ok: false, error: 'This server asks you to sign in, which works in the Willow desktop app.' });
      try {
        await signInFromDesktop(config, client ? { client, redirect: CUSTOM_APP_REDIRECT } : {});
      } catch (error) {
        if (needsOwnApp(error)) {
          return fail({ ok: false, error: 'This server doesn’t support automatic registration. Enter your OAuth client ID and client secret to connect.', expand: true });
        }
        return fail({ ok: false, error: signInProblem(error) });
      }
      // The sign-in turns the server on; it stays off until the review's Connect.
      const signedIn = mcpServers.get().find((server) => server.id === id);
      if (signedIn) upsertMcpServer({ ...signedIn, enabled: false });
      status = mcpRuntime.get()[id]?.status;
    }
    if (status?.state !== 'ready') {
      const desktop = await canSignInHere();
      return fail({ ok: false, error: failureText(status?.state === 'failed' ? status.kind : undefined, desktop) });
    }
    const app = readyApp(id, address);
    return app ? { ok: true, app } : fail({ ok: false, error: 'Verify the URL and try again.' });
  } catch {
    return fail({ ok: false, error: 'We had trouble connecting to this server. Contact the server provider for help.' });
  }
}

/** The review's Connect: the staged server, named, switched on. */
export async function saveCustomApp(app: StagedApp, name: string): Promise<void> {
  const server = mcpServers.get().find((entry) => entry.id === app.serverId);
  if (!server) return;
  upsertMcpServer({ ...server, label: name.trim(), enabled: true });
  setMeta(app.serverId, {
    description: app.description || undefined,
    madeBy: app.madeBy,
    tools: app.tools.map((tool) => tool.name),
    syncedAt: app.syncedAt,
  });
  if (mcpRuntime.get()[app.serverId]?.status.state !== 'ready') await connectMcpServer(app.serverId);
}

/** Leaving the dialogs before Connect: the staged server and any sign-in it got are dropped. */
export async function discardCustomApp(serverId: string): Promise<void> {
  if (!customAppMeta.get()[serverId]?.pending) return;
  await removeMcpServer(serverId);
  setMeta(serverId, null);
}

/** Whether an app with this name is already connected (Gemini's duplicate-name check), not counting `serverId`. */
export const isNameTaken = (name: string, serverId: string, takenTitles: readonly string[] = []): boolean => {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return false;
  const meta = customAppMeta.get();
  return (
    mcpServers.get().some((server) => server.id !== serverId && !meta[server.id]?.pending && server.label.trim().toLowerCase() === wanted) ||
    takenTitles.some((title) => title.trim().toLowerCase() === wanted)
  );
};

/* ------------------------------------------------------------------------ */
/* An added one                                                             */
/* ------------------------------------------------------------------------ */

export const disconnectCustomApp = (serverId: string): Promise<void> => setMcpServerEnabled(serverId, false);

export const reconnectCustomApp = (serverId: string): Promise<void> => setMcpServerEnabled(serverId, true);

/** Delete: the server goes from every surface, with its sign-in. */
export async function deleteCustomApp(serverId: string): Promise<void> {
  await removeMcpServer(serverId);
  setMeta(serverId, null);
}

/** Re-reads an added app's tools, as its page's "Last synced" says. */
export async function syncCustomApp(serverId: string): Promise<void> {
  const server = mcpServers.get().find((entry) => entry.id === serverId);
  if (!server?.enabled) return;
  if (mcpRuntime.get()[serverId]?.status.state !== 'ready') await connectMcpServer(serverId);
  const entry = mcpRuntime.get()[serverId];
  if (entry?.status.state !== 'ready') return;
  const meta = customAppMeta.get()[serverId] ?? {};
  setMeta(serverId, { ...meta, tools: entry.tools.map((tool) => tool.name), syncedAt: Date.now() });
}
