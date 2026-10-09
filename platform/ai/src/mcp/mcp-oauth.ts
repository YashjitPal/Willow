/**
 * Signing in to an MCP server, as the MCP authorization spec has it: OAuth 2.1 with PKCE, the server's protected
 * resource metadata pointing at its authorization server, and the token bound to the server with `resource`
 * (RFC 8707). The browser half — opening the sign-in page and catching where it sends the user back — belongs to the
 * host (the desktop app catches it on this computer's loopback, RFC 8252); everything here is that host's for the
 * asking, and takes its `fetch`, so the desktop app's relay reaches servers a page could not.
 *
 * A client is registered dynamically (RFC 7591) where the server offers it. Where it does not — some vendors ask
 * each user to make an app of their own — the user's client id, secret and redirect address are used instead.
 * Refresh keeps whatever new refresh token comes back, since servers that rotate them accept each only once.
 */

/** Where a server's sign-in lives, read from its metadata. */
export interface McpOAuthServer {
  /** The resource the token is for: the server's own identifier, else its address. */
  resource: string;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  /** Scopes the server asked for (WWW-Authenticate) or lists as supported. */
  scopes?: string[];
}

/** The client Willow signs in as: registered just now, or the user's own app. */
export interface McpOAuthClient {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
}

/** What signing in leaves: kept with the server's config, refreshed as it runs out. */
export interface McpOAuthGrant {
  accessToken: string;
  refreshToken?: string;
  /** Epoch milliseconds; absent when the server did not say. */
  expiresAt?: number;
  scope?: string;
  tokenEndpoint: string;
  resource: string;
  clientId: string;
  clientSecret?: string;
}

export class McpOAuthError extends Error {
  /** `no-registration`: the server does not let apps register themselves, so the user's own app is needed. */
  constructor(message: string, readonly detail?: string, readonly code?: 'no-registration') {
    super(message);
    this.name = 'McpOAuthError';
  }
}

/** `Bearer resource_metadata="…", scope="…", error="…"` → its parameters. */
export const parseWwwAuthenticate = (header: string | null | undefined): { resourceMetadata?: string; scope?: string; error?: string } => {
  const out: { resourceMetadata?: string; scope?: string; error?: string } = {};
  if (!header) return out;
  for (const match of header.matchAll(/([a-zA-Z_]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/g)) {
    const value = (match[2] ?? match[3] ?? '').replace(/\\(.)/g, '$1');
    const name = match[1].toLowerCase();
    if (name === 'resource_metadata') out.resourceMetadata = value;
    else if (name === 'scope') out.scope = value;
    else if (name === 'error') out.error = value;
  }
  return out;
};

const readJson = async (fetchImpl: typeof fetch, url: string): Promise<Record<string, unknown> | null> => {
  try {
    const response = await fetchImpl(url, { method: 'GET', headers: { accept: 'application/json' } });
    if (!response.ok) return null;
    const parsed = await response.json();
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
};

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

/** The well-known addresses for a URL's path, the path-suffixed one first (RFC 8414 §3, RFC 9728 §3). */
const wellKnown = (base: URL, name: string): string[] => {
  const path = base.pathname.replace(/\/+$/, '');
  const root = `${base.origin}/.well-known/${name}`;
  return path ? [`${root}${path}`, root] : [root];
};

/** Authorization server metadata for an issuer, trying OAuth's and OpenID's addresses in the spec's order. */
const authorizationServerMetadata = async (fetchImpl: typeof fetch, issuer: string): Promise<Record<string, unknown> | null> => {
  const url = new URL(issuer);
  const path = url.pathname.replace(/\/+$/, '');
  const candidates = path
    ? [`${url.origin}/.well-known/oauth-authorization-server${path}`, `${url.origin}/.well-known/openid-configuration${path}`, `${url.origin}${path}/.well-known/openid-configuration`]
    : [`${url.origin}/.well-known/oauth-authorization-server`, `${url.origin}/.well-known/openid-configuration`];
  for (const candidate of candidates) {
    const found = await readJson(fetchImpl, candidate);
    if (found && text(found.authorization_endpoint) && text(found.token_endpoint)) return found;
  }
  return null;
};

/**
 * Finds where a server signs in: asks it without credentials, follows `resource_metadata` from its 401 — or the
 * well-known address — to its authorization server, and reads that server's metadata. Servers from before protected
 * resource metadata keep their sign-in on their own origin, at the spec's default paths.
 */
export async function discoverOAuth(serverUrl: string, fetchImpl: typeof fetch): Promise<McpOAuthServer> {
  const server = new URL(serverUrl);
  let challenge: ReturnType<typeof parseWwwAuthenticate> = {};
  try {
    const probe = await fetchImpl(serverUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Willow', version: '1' } } }),
    });
    if (probe.status !== 401 && probe.ok) throw new McpOAuthError('This server lets you in without signing in.');
    challenge = parseWwwAuthenticate(probe.headers.get('www-authenticate'));
  } catch (error) {
    if (error instanceof McpOAuthError) throw error;
    throw new McpOAuthError('The server could not be reached to find where it signs in.', String(error));
  }

  let metadata: Record<string, unknown> | null = null;
  if (challenge.resourceMetadata) metadata = await readJson(fetchImpl, challenge.resourceMetadata);
  if (!metadata) {
    for (const candidate of wellKnown(server, 'oauth-protected-resource')) {
      metadata = await readJson(fetchImpl, candidate);
      if (metadata) break;
    }
  }

  const resource = text(metadata?.resource) ?? serverUrl;
  const servers = Array.isArray(metadata?.authorization_servers) ? (metadata!.authorization_servers as unknown[]).map(text).filter((entry): entry is string => Boolean(entry)) : [];
  const issuer = servers[0] ?? server.origin;
  const found = await authorizationServerMetadata(fetchImpl, issuer);
  const scopes = challenge.scope ? challenge.scope.split(/\s+/).filter(Boolean) : Array.isArray(metadata?.scopes_supported) ? (metadata!.scopes_supported as unknown[]).map(text).filter((entry): entry is string => Boolean(entry)) : undefined;

  if (found) {
    return {
      resource,
      issuer: text(found.issuer) ?? issuer,
      authorizationEndpoint: text(found.authorization_endpoint)!,
      tokenEndpoint: text(found.token_endpoint)!,
      ...(text(found.registration_endpoint) ? { registrationEndpoint: text(found.registration_endpoint) } : {}),
      ...(scopes?.length ? { scopes } : {}),
    };
  }
  if (servers.length) throw new McpOAuthError('The server names an authorization server that publishes no sign-in details.', issuer);
  // Before protected resource metadata: the server's own origin, at the default paths.
  return { resource, issuer: server.origin, authorizationEndpoint: `${server.origin}/authorize`, tokenEndpoint: `${server.origin}/token`, registrationEndpoint: `${server.origin}/register`, ...(scopes?.length ? { scopes } : {}) };
}

/** Registers Willow as a public native client with the server's authorization server (RFC 7591). */
export async function registerClient(server: McpOAuthServer, redirectUri: string, clientName: string, fetchImpl: typeof fetch): Promise<McpOAuthClient> {
  if (!server.registrationEndpoint) throw new McpOAuthError('This server does not let apps register themselves. Make an app of your own with the service, then enter its client ID.', undefined, 'no-registration');
  let response: Response;
  try {
    response = await fetchImpl(server.registrationEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        client_name: clientName,
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        application_type: 'native',
        ...(server.scopes?.length ? { scope: server.scopes.join(' ') } : {}),
      }),
    });
  } catch (error) {
    throw new McpOAuthError('Registering with the server failed.', String(error));
  }
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || !text(body.client_id)) {
    throw new McpOAuthError(response.status === 403 || response.status === 400 ? 'The server only lets apps it has approved sign in.' : 'Registering with the server failed.', text(body.error_description) ?? text(body.error) ?? `${response.status}`);
  }
  return { clientId: text(body.client_id)!, ...(text(body.client_secret) ? { clientSecret: text(body.client_secret) } : {}), redirectUri };
}

const base64Url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** A PKCE verifier and its S256 challenge (RFC 7636). */
export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return { verifier, challenge: base64Url(digest) };
}

export const randomState = (): string => base64Url(crypto.getRandomValues(new Uint8Array(16)));

/** The page the user signs in on, with everything that binds the answer to this attempt. */
export function authorizationUrl(server: McpOAuthServer, client: McpOAuthClient, attempt: { challenge: string; state: string }): string {
  const url = new URL(server.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', client.clientId);
  url.searchParams.set('redirect_uri', client.redirectUri);
  url.searchParams.set('code_challenge', attempt.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', attempt.state);
  url.searchParams.set('resource', server.resource);
  if (server.scopes?.length) url.searchParams.set('scope', server.scopes.join(' '));
  return url.toString();
}

const tokenRequest = async (endpoint: string, form: Record<string, string | undefined>, fetchImpl: typeof fetch): Promise<Record<string, unknown>> => {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(form)) if (value) body.set(key, value);
  let response: Response;
  try {
    response = await fetchImpl(endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: body.toString() });
  } catch (error) {
    throw new McpOAuthError('The sign-in server could not be reached.', String(error));
  }
  const parsed = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || !text(parsed.access_token)) {
    throw new McpOAuthError(parsed.error === 'invalid_grant' ? 'The sign-in has expired. Sign in again.' : 'The sign-in server turned the request down.', text(parsed.error_description) ?? text(parsed.error) ?? `${response.status}`);
  }
  return parsed;
};

const grantFrom = (body: Record<string, unknown>, base: Pick<McpOAuthGrant, 'tokenEndpoint' | 'resource' | 'clientId' | 'clientSecret'>, now: number, previousRefresh?: string): McpOAuthGrant => {
  const expiresIn = Number(body.expires_in);
  return {
    accessToken: text(body.access_token)!,
    // A server that rotates sends a new one, and the old is spent; one that does not keeps the old valid.
    ...(text(body.refresh_token) ?? previousRefresh ? { refreshToken: text(body.refresh_token) ?? previousRefresh } : {}),
    ...(Number.isFinite(expiresIn) && expiresIn > 0 ? { expiresAt: now + expiresIn * 1_000 } : {}),
    ...(text(body.scope) ? { scope: text(body.scope) } : {}),
    tokenEndpoint: base.tokenEndpoint,
    resource: base.resource,
    clientId: base.clientId,
    ...(base.clientSecret ? { clientSecret: base.clientSecret } : {}),
  };
};

/** Trades the code the sign-in page sent back for tokens. */
export async function exchangeCode(server: McpOAuthServer, client: McpOAuthClient, answer: { code: string; verifier: string }, fetchImpl: typeof fetch, now = Date.now()): Promise<McpOAuthGrant> {
  const body = await tokenRequest(server.tokenEndpoint, {
    grant_type: 'authorization_code',
    code: answer.code,
    redirect_uri: client.redirectUri,
    code_verifier: answer.verifier,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    resource: server.resource,
  }, fetchImpl);
  return grantFrom(body, { tokenEndpoint: server.tokenEndpoint, resource: server.resource, clientId: client.clientId, clientSecret: client.clientSecret }, now);
}

/** A fresh access token from the refresh token, keeping a rotated refresh token. */
export async function refreshGrant(grant: McpOAuthGrant, fetchImpl: typeof fetch, now = Date.now()): Promise<McpOAuthGrant> {
  if (!grant.refreshToken) throw new McpOAuthError('The sign-in has run out. Sign in again.');
  const body = await tokenRequest(grant.tokenEndpoint, {
    grant_type: 'refresh_token',
    refresh_token: grant.refreshToken,
    client_id: grant.clientId,
    client_secret: grant.clientSecret,
    resource: grant.resource,
  }, fetchImpl);
  return grantFrom(body, grant, now, grant.refreshToken);
}

/** Whether a grant's access token is spent, or about to be within `skewMs`. */
export const grantExpired = (grant: McpOAuthGrant, now = Date.now(), skewMs = 60_000): boolean => grant.expiresAt !== undefined && grant.expiresAt - skewMs <= now;

/**
 * The whole sign-in. The host supplies the address the sign-in page sends the user back to, and the way to show that
 * page and catch the answer; a client of the user's own (`client`) skips registration.
 */
export async function signIn(options: {
  serverUrl: string;
  fetchImpl: typeof fetch;
  clientName: string;
  redirectUri: string;
  client?: { clientId: string; clientSecret?: string };
  openAndWait: (url: string) => Promise<{ code?: string; state?: string; error?: string; errorDescription?: string }>;
  now?: () => number;
}): Promise<McpOAuthGrant> {
  const server = await discoverOAuth(options.serverUrl, options.fetchImpl);
  const client: McpOAuthClient = options.client
    ? { clientId: options.client.clientId, ...(options.client.clientSecret ? { clientSecret: options.client.clientSecret } : {}), redirectUri: options.redirectUri }
    : await registerClient(server, options.redirectUri, options.clientName, options.fetchImpl);
  const { verifier, challenge } = await pkcePair();
  const state = randomState();
  const answer = await options.openAndWait(authorizationUrl(server, client, { challenge, state }));
  if (answer.error) throw new McpOAuthError(answer.error === 'access_denied' ? 'Signing in was cancelled.' : 'The sign-in did not finish.', answer.errorDescription ?? answer.error);
  if (!answer.code) throw new McpOAuthError('The sign-in did not send back a code.');
  if (answer.state !== state) throw new McpOAuthError('The sign-in answer did not match this attempt, so it was ignored.');
  return exchangeCode(server, client, { code: answer.code, verifier }, options.fetchImpl, options.now?.() ?? Date.now());
}
