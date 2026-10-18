/**
 * The connector cards Willow connects as their vendors' own MCP servers (`CustomizeItem.mcp`): Canva, Dropbox, Wix,
 * Zoho's apps and the rest. A card is a face on a preset from Spark's catalog, so connecting one here adds the same
 * server Spark → Connected apps would, under the same id — whichever page it was added on, the other shows it
 * connected, and every surface that uses MCP tools (Chat, Spark, the bots, Code) sees it.
 *
 * How a card connects is its preset's `auth`:
 *
 * - **`oauth`**: a sign-in in the user's browser, from the desktop app only. Each of these servers lets Willow
 *   register itself, but only three of them answer a web page at all (CORS), and the sign-in needs a loopback address
 *   to come back to, which only the companion can open.
 * - **`url`** (Zoho's apps): the user makes a server in Zoho MCP with that app's tools in it and pastes its address,
 *   which carries its own key. One that asks for a sign-in on top signs in like an `oauth` card.
 * - **`key`** (monday.com, X): a pasted token. monday.com's server also takes a sign-in in the desktop app; X's takes
 *   one with an X developer app of the user's own (`ownApp`), there too.
 * - **`program`** (X Reader): one of the programs Willow ships, which the companion runs on this computer, so only
 *   from the desktop app. X Reader reads X signed in as the user: they sign in to X in a browser window the companion
 *   opens, which hands back the session's two cookies (`signInMcpSession`), or they paste the cookies themselves.
 */
import { map } from 'nanostores';
import { connectMcpServer, removeMcpServer, upsertMcpServer, type McpServerConfig, type McpStatus } from '@willow/ai/mcp/mcp-store';
import {
  MCP_PRESETS,
  OWN_APP_REDIRECT,
  presetOwnApp,
  presetServer,
  presetSession,
  presetSignInServer,
  presetSignsIn,
  signedInClient,
  type McpPreset,
} from '@willow/spark/mcp-catalog';
import { needsOwnApp, signInFromDesktop, signInProblem } from '@willow/spark/mcp-signin';
import { cancelSiteSignIn, signInToSite } from '@willow/spark/site-sign-in';
import type { CustomizeItem } from './customize-data';

/** The preset a card connects through, or null for a card that uses one of Willow's own connectors. */
export const mcpPresetFor = (item: Pick<CustomizeItem, 'mcp'>): McpPreset | null =>
  item.mcp ? MCP_PRESETS.find((preset) => preset.id === item.mcp) ?? null : null;

/** A card's server, when it is added and on — what "connected" means for these cards. */
export const mcpCardServer = (preset: McpPreset, servers: readonly McpServerConfig[]): McpServerConfig | null =>
  servers.find((server) => server.id === preset.id && server.enabled) ?? null;

/** Whether connecting a card is a sign-in — in the desktop app, where one can happen — rather than something typed. */
export const mcpCardSignsIn = (preset: McpPreset, canSignIn: boolean): boolean => canSignIn && presetSignsIn(preset);

/** Whether connecting a card is signing in to the site its program reads (X Reader), where a sign-in window can open. */
export const mcpCardSignsInToSite = (preset: McpPreset, canSignInToSites: boolean): boolean => canSignInToSites && Boolean(presetSession(preset));

/**
 * A sign-in started from Customize, by preset id. It lives here rather than in a component because the grid's
 * Connect starts it and the card's page shows it, and the user may move between the two while the browser is open.
 */
export interface McpCardSignIn {
  busy?: boolean;
  problem?: string;
}

export const $mcpCardSignIns = map<Record<string, McpCardSignIn>>({});

/** The latest sign-in by preset id: only it may say how sign-in went, so a cancelled one ending later says nothing. */
const attempts = new Map<string, number>();

/**
 * Signs in to a card's server and connects it; `server` is one already added — from a pasted address, or signed in
 * to before — signed in to as it is. True when it connected, false when it failed or one was already under way.
 *
 * Most cards' servers let Willow register itself. A service that stops allowing it is said so, rather than sending
 * the user off to make an app. X registers no apps: its card signs in with the user's own (`client`), and signing in
 * again uses the one it signed in with before.
 */
export const signInMcpCard = async (
  preset: McpPreset,
  options: { server?: McpServerConfig; client?: { clientId: string; clientSecret?: string } } = {},
): Promise<boolean> => {
  if ($mcpCardSignIns.get()[preset.id]?.busy) return false;
  const attempt = (attempts.get(preset.id) ?? 0) + 1;
  attempts.set(preset.id, attempt);
  const latest = () => attempts.get(preset.id) === attempt;
  $mcpCardSignIns.setKey(preset.id, { busy: true });
  const ownApp = presetOwnApp(preset);
  const client = options.client ?? (ownApp ? signedInClient(options.server) : undefined);
  try {
    await signInFromDesktop(
      options.server ?? presetSignInServer(preset),
      client ? { client, redirect: ownApp?.redirect ?? OWN_APP_REDIRECT, ...(ownApp?.scopes ? { scopes: ownApp.scopes } : {}) } : {},
    );
    if (latest()) $mcpCardSignIns.setKey(preset.id, {});
    return true;
  } catch (error) {
    const problem = needsOwnApp(error) ? `${preset.label} didn’t let Willow sign in this time. Try again later.` : signInProblem(error);
    if (latest()) $mcpCardSignIns.setKey(preset.id, { problem });
    return false;
  }
};

/**
 * Connects a card whose program reads a site as the user (X Reader) by signing in to that site, in a browser window
 * the companion opens; the session that sign-in makes is the program's. True when it connected; false when the user
 * closed the window, it failed, or one was already under way.
 */
export const signInMcpSession = async (preset: McpPreset): Promise<boolean> => {
  const session = presetSession(preset);
  if (!session || $mcpCardSignIns.get()[preset.id]?.busy) return false;
  const attempt = (attempts.get(preset.id) ?? 0) + 1;
  attempts.set(preset.id, attempt);
  $mcpCardSignIns.setKey(preset.id, { busy: true });
  const ended = await signInToSite(session);
  if (attempts.get(preset.id) !== attempt) return false;
  if ('cancelled' in ended) {
    $mcpCardSignIns.setKey(preset.id, {});
    return false;
  }
  const problem = 'problem' in ended ? ended.problem : addMcpCard(preset, ended.entry);
  $mcpCardSignIns.setKey(preset.id, problem ? { problem } : {});
  return !problem;
};

/**
 * Stops waiting for a sign-in the user walked away from, which would otherwise hold the card for the ten minutes the
 * companion waits. One they finish in the browser anyway still connects; a site's sign-in window closes.
 */
export const cancelMcpCardSignIn = (preset: McpPreset): void => {
  attempts.set(preset.id, (attempts.get(preset.id) ?? 0) + 1);
  $mcpCardSignIns.setKey(preset.id, {});
  if (presetSession(preset)) cancelSiteSignIn();
};

/** Adds a card's server from what the user typed — a token, or their server's address — or says what is wrong with it. */
export const addMcpCard = (preset: McpPreset, entered: string): string | null => {
  const server = presetServer(preset, entered);
  if ('problem' in server) return server.problem;
  upsertMcpServer(server);
  $mcpCardSignIns.setKey(preset.id, {});
  void connectMcpServer(server.id);
  return null;
};

/** Disconnects a card: its server goes, and with it any key or sign-in it held. */
export const removeMcpCard = async (preset: McpPreset): Promise<void> => {
  $mcpCardSignIns.setKey(preset.id, {});
  await removeMcpServer(preset.id);
};

/** What a connected card's page says about its server right now; a program's first start fetches what it runs on. */
export const mcpStatusText = (status: McpStatus | undefined, program = false): string => {
  switch (status?.state) {
    case 'ready':
      return `Connected · ${status.toolCount} ${status.toolCount === 1 ? 'tool' : 'tools'}`;
    case 'connecting':
      return program ? 'Starting… The first start can take a minute while it downloads.' : 'Connecting…';
    case 'failed':
      return status.message;
    default:
      return 'Connected';
  }
};
