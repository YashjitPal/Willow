/**
 * Signing in to an MCP server (platform/ai/src/mcp/mcp-oauth.ts), against a stand-in authorization server: finding
 * where a server signs in, registering, PKCE, the sign-in page's address, trading the code, refreshing — and the
 * transport and store using the tokens.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const mcp = (name) => path.join(repoRoot, 'platform', 'ai', 'src', 'mcp', name);
const oauth = await importTs(mcp('mcp-oauth.ts'));
const { createHttpTransport } = await importTs(mcp('http-transport.ts'));

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** A server at mcp.example.com that sends a 401 pointing at its metadata, and an authorization server at auth.example.com/t1. */
const standIn = ({ challenge = true, registration = true } = {}) => {
  const seen = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const body = typeof init.body === 'string' ? init.body : undefined;
    seen.push({ url, method: init.method ?? 'GET', body, headers: init.headers });
    if (url === 'https://mcp.example.com/mcp') {
      return new Response('', { status: 401, headers: challenge ? { 'www-authenticate': 'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp", scope="read write"' } : {} });
    }
    if (url === 'https://mcp.example.com/.well-known/oauth-protected-resource/mcp') {
      return json({ resource: 'https://mcp.example.com/mcp', authorization_servers: ['https://auth.example.com/t1'] });
    }
    if (url === 'https://auth.example.com/.well-known/oauth-authorization-server/t1') {
      return json({ issuer: 'https://auth.example.com/t1', authorization_endpoint: 'https://auth.example.com/t1/authorize', token_endpoint: 'https://auth.example.com/t1/token', ...(registration ? { registration_endpoint: 'https://auth.example.com/t1/register' } : {}) });
    }
    if (url === 'https://auth.example.com/t1/register') return json({ client_id: 'client-123' }, 201);
    if (url === 'https://auth.example.com/t1/token') {
      const form = new URLSearchParams(body);
      if (form.get('grant_type') === 'refresh_token' && form.get('refresh_token') === 'spent') return json({ error: 'invalid_grant' }, 400);
      return json({ access_token: form.get('grant_type') === 'refresh_token' ? 'access-2' : 'access-1', refresh_token: form.get('grant_type') === 'refresh_token' ? 'refresh-2' : 'refresh-1', expires_in: 3600, token_type: 'Bearer' });
    }
    return new Response('', { status: 404 });
  };
  return { seen, fetchImpl };
};

it('reads a server\'s challenge for where it signs in, and its authorization server\'s metadata', async () => {
  assert.deepEqual(oauth.parseWwwAuthenticate('Bearer error="invalid_token", resource_metadata="https://x/y", scope="a b"'), { error: 'invalid_token', resourceMetadata: 'https://x/y', scope: 'a b' });
  const { fetchImpl } = standIn();
  assert.deepEqual(await oauth.discoverOAuth('https://mcp.example.com/mcp', fetchImpl), {
    resource: 'https://mcp.example.com/mcp',
    issuer: 'https://auth.example.com/t1',
    authorizationEndpoint: 'https://auth.example.com/t1/authorize',
    tokenEndpoint: 'https://auth.example.com/t1/token',
    registrationEndpoint: 'https://auth.example.com/t1/register',
    scopes: ['read', 'write'],
  });
});

it('finds the metadata at its well-known address when the 401 does not name it, and falls back to the origin before that existed', async () => {
  const { fetchImpl } = standIn({ challenge: false });
  const found = await oauth.discoverOAuth('https://mcp.example.com/mcp', fetchImpl);
  assert.equal(found.tokenEndpoint, 'https://auth.example.com/t1/token');

  const legacy = await oauth.discoverOAuth('https://old.example.com/mcp', async () => new Response('', { status: 401 }));
  assert.deepEqual(legacy, { resource: 'https://old.example.com/mcp', issuer: 'https://old.example.com', authorizationEndpoint: 'https://old.example.com/authorize', tokenEndpoint: 'https://old.example.com/token', registrationEndpoint: 'https://old.example.com/register' });

  await assert.rejects(oauth.discoverOAuth('https://open.example.com/mcp', async () => json({ jsonrpc: '2.0', id: 0, result: {} })), /lets you in without signing in/);
});

it('registers as a public native client, and says plainly when a server takes only apps it approved', async () => {
  const { seen, fetchImpl } = standIn();
  const server = await oauth.discoverOAuth('https://mcp.example.com/mcp', fetchImpl);
  const client = await oauth.registerClient(server, 'http://127.0.0.1:50123/callback', 'Willow', fetchImpl);
  assert.deepEqual(client, { clientId: 'client-123', redirectUri: 'http://127.0.0.1:50123/callback' });
  const sent = JSON.parse(seen.find((entry) => entry.url.endsWith('/register')).body);
  assert.deepEqual(sent, { client_name: 'Willow', redirect_uris: ['http://127.0.0.1:50123/callback'], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', application_type: 'native', scope: 'read write' });

  await assert.rejects(oauth.registerClient({ ...server, registrationEndpoint: 'https://figma.example/register' }, 'http://127.0.0.1:1/cb', 'Willow', async () => json({ error: 'forbidden' }, 403)), /only lets apps it has approved/);
  await assert.rejects(oauth.registerClient({ ...server, registrationEndpoint: undefined }, 'http://127.0.0.1:1/cb', 'Willow', fetchImpl), (error) => /Make an app of your own/.test(error.message) && error.code === 'no-registration');
});

it('binds the sign-in page to this attempt with PKCE, state and the resource', async () => {
  const { verifier, challenge } = await oauth.pkcePair();
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(challenge, crypto.createHash('sha256').update(verifier).digest('base64url'));
  const url = new URL(oauth.authorizationUrl(
    { resource: 'https://mcp.example.com/mcp', issuer: 'x', authorizationEndpoint: 'https://auth.example.com/t1/authorize?prompt=consent', tokenEndpoint: 'x', scopes: ['read'] },
    { clientId: 'client-123', redirectUri: 'http://127.0.0.1:50123/callback' },
    { challenge, state: 'state-1' },
  ));
  assert.equal(url.origin + url.pathname, 'https://auth.example.com/t1/authorize');
  assert.deepEqual(Object.fromEntries(url.searchParams), { prompt: 'consent', response_type: 'code', client_id: 'client-123', redirect_uri: 'http://127.0.0.1:50123/callback', code_challenge: challenge, code_challenge_method: 'S256', state: 'state-1', resource: 'https://mcp.example.com/mcp', scope: 'read' });
});

it('trades the code for tokens, refreshes keeping a rotated refresh token, and knows when one has run out', async () => {
  const { seen, fetchImpl } = standIn();
  const server = await oauth.discoverOAuth('https://mcp.example.com/mcp', fetchImpl);
  const grant = await oauth.exchangeCode(server, { clientId: 'client-123', clientSecret: 'shh', redirectUri: 'http://127.0.0.1:1/cb' }, { code: 'code-1', verifier: 'v' }, fetchImpl, 1_000);
  assert.deepEqual(grant, { accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: 3_601_000, tokenEndpoint: 'https://auth.example.com/t1/token', resource: 'https://mcp.example.com/mcp', clientId: 'client-123', clientSecret: 'shh' });
  assert.deepEqual(Object.fromEntries(new URLSearchParams(seen.at(-1).body)), { grant_type: 'authorization_code', code: 'code-1', redirect_uri: 'http://127.0.0.1:1/cb', code_verifier: 'v', client_id: 'client-123', client_secret: 'shh', resource: 'https://mcp.example.com/mcp' });

  const refreshed = await oauth.refreshGrant(grant, fetchImpl, 2_000);
  assert.equal(refreshed.accessToken, 'access-2');
  assert.equal(refreshed.refreshToken, 'refresh-2', 'the rotated one replaces the spent one');
  assert.equal(new URLSearchParams(seen.at(-1).body).get('resource'), 'https://mcp.example.com/mcp');
  await assert.rejects(oauth.refreshGrant({ ...grant, refreshToken: 'spent' }, fetchImpl), /expired\. Sign in again/);
  await assert.rejects(oauth.refreshGrant({ ...grant, refreshToken: undefined }, fetchImpl), /run out\. Sign in again/);

  assert.equal(oauth.grantExpired({ ...grant, expiresAt: 100_000 }, 30_000), false);
  assert.equal(oauth.grantExpired({ ...grant, expiresAt: 100_000 }, 50_000), true, 'within a minute of running out counts as out');
  assert.equal(oauth.grantExpired({ ...grant, expiresAt: undefined }, 9e15), false);
});

it('signs in end to end, and ignores an answer meant for another attempt', async () => {
  const { fetchImpl } = standIn();
  let opened;
  const grant = await oauth.signIn({
    serverUrl: 'https://mcp.example.com/mcp',
    fetchImpl,
    clientName: 'Willow',
    redirectUri: 'http://127.0.0.1:50123/callback',
    openAndWait: async (url) => {
      opened = new URL(url);
      return { code: 'code-1', state: opened.searchParams.get('state') };
    },
  });
  assert.equal(opened.searchParams.get('client_id'), 'client-123');
  assert.equal(grant.accessToken, 'access-1');

  await assert.rejects(oauth.signIn({ serverUrl: 'https://mcp.example.com/mcp', fetchImpl, clientName: 'Willow', redirectUri: 'http://127.0.0.1:1/cb', openAndWait: async () => ({ code: 'c', state: 'forged' }) }), /did not match this attempt/);
  await assert.rejects(oauth.signIn({ serverUrl: 'https://mcp.example.com/mcp', fetchImpl, clientName: 'Willow', redirectUri: 'http://127.0.0.1:1/cb', openAndWait: async () => ({ error: 'access_denied' }) }), /cancelled/);

  // A user's own app skips registration.
  const own = standIn({ registration: false });
  const ownGrant = await oauth.signIn({ serverUrl: 'https://mcp.example.com/mcp', fetchImpl: own.fetchImpl, clientName: 'Willow', redirectUri: 'http://localhost:3334/oauth/callback', client: { clientId: 'mine', clientSecret: 's' }, openAndWait: async (url) => ({ code: 'c', state: new URL(url).searchParams.get('state') }) });
  assert.equal(ownGrant.clientId, 'mine');
  assert.equal(own.seen.some((entry) => entry.url.endsWith('/register')), false);
});

it('signs a server in through the store, connects with its token, and keeps a refreshed grant', async () => {
  const store = await importTs(mcp('mcp-store.ts'));
  const { fetchImpl: authFetch } = standIn();
  const bearers = [];
  // The MCP server itself answers only a current token; the rest is the stand-in authorization server.
  const fetchImpl = async (input, init = {}) => {
    if (String(input) !== 'https://mcp.example.com/mcp' || !init.headers?.authorization) return authFetch(input, init);
    bearers.push(init.headers.authorization);
    if (init.headers.authorization === 'Bearer stale') return new Response('', { status: 401 });
    const message = JSON.parse(init.body);
    if (message.method === 'initialize') return json({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'Stand-in', version: '1' } } });
    if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (message.method === 'tools/list') return json({ jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'search', description: 'Search pages', inputSchema: { type: 'object' } }] } });
    return json({ jsonrpc: '2.0', id: message.id, result: {} });
  };
  store.setMcpFetch(fetchImpl);
  try {
    // Added by address with a key the server turned away: a 401 asks for a sign-in, which replaces the key.
    store.upsertMcpServer({ id: 'notion', label: 'Notion', kind: 'http', url: 'https://mcp.example.com/mcp', headers: { authorization: 'Bearer stale', 'x-workspace': 'w1' }, enabled: true });
    await store.connectMcpServer('notion');
    assert.equal(store.mcpRuntime.get().notion.status.kind, 'needs-sign-in');
    await store.signInMcpServer(store.mcpServers.get().find((server) => server.id === 'notion'), {
      redirectUri: 'http://127.0.0.1:50123/callback',
      openAndWait: async (url) => ({ code: 'code-1', state: new URL(url).searchParams.get('state') }),
    });
    const saved = store.mcpServers.get().find((server) => server.id === 'notion');
    assert.equal(saved.enabled, true, 'signing in is the deliberate act that turns it on');
    assert.deepEqual(saved.headers, { 'x-workspace': 'w1' }, 'the typed key is gone; other headers stay');
    assert.equal(saved.oauth.accessToken, 'access-1');
    bearers.length = 0;
    await store.connectMcpServer('notion');
    assert.equal(store.mcpRuntime.get().notion.status.state, 'ready');
    assert.deepEqual(store.boundMcpTools().map((tool) => tool.qualifiedName), ['mcp__notion__search']);
    assert.ok(bearers.every((value) => value === 'Bearer access-1'));

    // Run out: the next connection refreshes first, and the rotated grant is what is kept.
    store.upsertMcpServer({ ...saved, oauth: { ...saved.oauth, accessToken: 'stale', expiresAt: Date.now() - 1 } });
    bearers.length = 0;
    await store.connectMcpServer('notion');
    assert.equal(store.mcpRuntime.get().notion.status.state, 'ready');
    const kept = store.mcpServers.get().find((server) => server.id === 'notion').oauth;
    assert.deepEqual([kept.accessToken, kept.refreshToken], ['access-2', 'refresh-2']);
    assert.ok(bearers.every((value) => value === 'Bearer access-2'));
  } finally {
    await store.removeMcpServer('notion');
    store.setMcpFetch(undefined);
  }
});

it('sends the token, and on a refusal gets one fresh token and tries once more', async () => {
  const sent = [];
  let accepted = 'access-2';
  const fetchImpl = async (_url, init) => {
    sent.push(init.headers.authorization);
    if (init.headers.authorization !== `Bearer ${accepted}`) return new Response('', { status: 401 });
    return json({ jsonrpc: '2.0', id: 1, result: { ok: true } });
  };
  let refreshes = 0;
  const transport = createHttpTransport({ url: 'https://mcp.example.com/mcp', fetchImpl, auth: { token: async () => 'access-1', refresh: async () => { refreshes += 1; return 'access-2'; } } });
  const heard = [];
  transport.onMessage((message) => heard.push(message));
  await transport.send({ jsonrpc: '2.0', id: 1, method: 'ping' });
  assert.deepEqual(sent, ['Bearer access-1', 'Bearer access-2']);
  assert.equal(refreshes, 1);
  assert.equal(heard[0].result.ok, true);

  accepted = 'never';
  const ended = createHttpTransport({ url: 'https://mcp.example.com/mcp', fetchImpl, auth: { token: async () => 'access-1', refresh: async () => null } });
  await assert.rejects(ended.send({ jsonrpc: '2.0', id: 2, method: 'ping' }), (error) => error.kind === 'needs-sign-in' && /Sign in again/.test(error.message));
});
