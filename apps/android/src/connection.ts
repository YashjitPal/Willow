import AsyncStorage from '@react-native-async-storage/async-storage';

import WillowTunnel from '../modules/willow-tunnel';

/**
 * The phone's ends of the tunnels. Fixed, because the WebView's origins - and the
 * storage and cookies kept under them - must not change when the PC's address does.
 */
export const AGENTS_LOCAL_PORT = 41860;
export const WILLOW_LOCAL_PORT = 41861;
export const AGENTS_ORIGIN = `http://localhost:${AGENTS_LOCAL_PORT}`;
export const WILLOW_ORIGIN = `http://localhost:${WILLOW_LOCAL_PORT}`;
export const WILLOW_URL = `${WILLOW_ORIGIN}/`;

const STORAGE_KEY = 'willow.connection';
const PROBE_TIMEOUT_MS = 6000;

/** What is kept between launches. Never the pairing token. */
export type Connection = {
  host: string;
  agentsPort: number;
  willowPort: number;
};

export type PairingLink = {
  host: string;
  agentsPort: number;
  token: string;
  /** An https:// link, through Tailscale Serve: only the discovery goes over it. */
  secure: boolean;
};

type MobileInfo = {
  willowPort: number;
  /** The server's own port, which the tunnels carry plain HTTP to; older PCs don't say. */
  agentsPort: number | null;
};

/** An error whose message is written for the phone's owner. */
export class ConnectError extends Error {}

const LINK_PATTERN =
  /^(https?):\/\/(\[[0-9a-f:.]+\]|[^\s/?#:@[\]]+)(?::(\d{1,5}))?(\/[^?#\s]*)?(\?[^#\s]*)?(#\S*)?$/i;

/**
 * T3 Code's pairing link: `http://<host>:<agentsPort>/pair#token=<credential>`, or an
 * https:// one through Tailscale Serve.
 */
export function parsePairingLink(text: string): PairingLink {
  const match = LINK_PATTERN.exec(text.trim());
  if (!match) {
    throw new ConnectError(
      "That doesn't look like a pairing link. It starts with http:// or https:// and ends with /pair#token=…",
    );
  }
  const [, scheme, rawHost, rawPort, , query = '', hash = ''] = match;
  const secure = scheme.toLowerCase() === 'https';
  const agentsPort = rawPort ? Number(rawPort) : secure ? 443 : 80;
  if (!isPort(agentsPort)) {
    throw new ConnectError(`${rawPort} is not a valid port.`);
  }
  const token = readParam(hash.slice(1), 'token') ?? readParam(query.slice(1), 'token');
  if (!token) {
    throw new ConnectError(
      'That link has no pairing token. Copy the whole link, including the part after #.',
    );
  }
  return { host: rawHost.replace(/^\[|\]$/g, ''), agentsPort, token, secure };
}

/** The page the agents' web client pairs itself on, through the tunnel. */
export function pairUrl(token: string): string {
  return `${AGENTS_ORIGIN}/pair#token=${encodeURIComponent(token)}`;
}

/** Asks the PC which port Willow is on, which also proves it can be reached. */
export async function probe(host: string, agentsPort: number, secure = false): Promise<MobileInfo> {
  const url = `${secure ? 'https' : 'http'}://${urlHost(host)}:${agentsPort}/.well-known/willow/mobile`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
  } catch {
    throw new ConnectError(
      `Couldn't reach your PC at ${host}:${agentsPort}. The PC and this phone must be on the same network, and 'Network access' must be turned on in the agents tab's Settings > Connections.`,
    );
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 404) {
    throw new ConnectError(
      "Your PC answered, but it doesn't offer Willow's phone connection. Update Willow on the PC, then try again.",
    );
  }
  if (!response.ok) {
    throw new ConnectError(
      `Your PC answered with an error (HTTP ${response.status}). Try again in a moment.`,
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const info = (body ?? {}) as { version?: unknown; willowPort?: unknown; agentsPort?: unknown };
  if (typeof info.version !== 'number' || info.version < 1 || !isPort(info.willowPort)) {
    throw new ConnectError(
      'Your PC answered with something unexpected. Update Willow on the PC, then try again.',
    );
  }
  return { willowPort: info.willowPort, agentsPort: isPort(info.agentsPort) ? info.agentsPort : null };
}

export async function openTunnels(connection: Connection): Promise<void> {
  try {
    await WillowTunnel.start(AGENTS_LOCAL_PORT, connection.host, connection.agentsPort);
    await WillowTunnel.start(WILLOW_LOCAL_PORT, connection.host, connection.willowPort);
  } catch (error) {
    throw new ConnectError(
      `Couldn't open the connection on this phone: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** First connection, from a pairing link. Resolves with the URL that pairs the WebView. */
export async function connectWithLink(
  link: PairingLink,
): Promise<{ connection: Connection; pairUrl: string }> {
  const info = await probe(link.host, link.agentsPort, link.secure);
  // The tunnels carry plain HTTP, so they go to the server's own port, not a link's https one.
  const agentsPort = info.agentsPort ?? (link.secure ? null : link.agentsPort);
  if (agentsPort === null) {
    throw new ConnectError(
      "Your PC answered over https:// but didn't say where the phone can reach it. Update Willow on the PC, then try again.",
    );
  }
  if (link.secure) {
    await probe(link.host, agentsPort).catch(() => {
      throw new ConnectError(
        "Your PC answers through Tailscale, but the phone also needs 'Network access' turned on in the agents tab's Settings > Connections.",
      );
    });
  }
  const connection: Connection = { host: link.host, agentsPort, willowPort: info.willowPort };
  await openTunnels(connection);
  await saveConnection(connection);
  return { connection, pairUrl: pairUrl(link.token) };
}

/** Reconnects to the saved PC, picking up Willow's port again in case it moved. */
export async function reconnect(saved: Connection): Promise<Connection> {
  const { willowPort } = await probe(saved.host, saved.agentsPort);
  const connection: Connection = { ...saved, willowPort };
  await openTunnels(connection);
  if (willowPort !== saved.willowPort) {
    await saveConnection(connection);
  }
  return connection;
}

/** Stops the tunnels and forgets the PC. The WebView's cookies are the caller's to clear. */
export async function disconnect(): Promise<void> {
  await WillowTunnel.stopAll().catch(() => {});
  await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
}

export async function loadConnection(): Promise<Connection | null> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const value = JSON.parse(stored) as Partial<Connection>;
    if (
      typeof value.host === 'string' &&
      value.host &&
      isPort(value.agentsPort) &&
      isPort(value.willowPort)
    ) {
      return { host: value.host, agentsPort: value.agentsPort, willowPort: value.willowPort };
    }
  } catch {
    // An unreadable entry is the same as none.
  }
  return null;
}

async function saveConnection(connection: Connection): Promise<void> {
  const { host, agentsPort, willowPort } = connection;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ host, agentsPort, willowPort }));
}

export function describeConnection(connection: Connection): string {
  return `${urlHost(connection.host)}:${connection.agentsPort}`;
}

function urlHost(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}

function isPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535;
}

/** Reads one `application/x-www-form-urlencoded` parameter, as URLSearchParams would. */
function readParam(encoded: string, name: string): string | null {
  for (const pair of encoded.split('&')) {
    const [key, ...rest] = pair.split('=');
    if (decodeFormComponent(key) !== name) continue;
    const value = decodeFormComponent(rest.join('=')).trim();
    if (value) return value;
  }
  return null;
}

function decodeFormComponent(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}
