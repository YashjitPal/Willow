// Probes remote MCP servers the way `platform/ai/src/mcp/mcp-oauth.ts` discovers sign-in:
// 401 challenge -> protected resource metadata -> authorization server metadata -> registration endpoint.
// `--register` also registers a client exactly as `registerClient` does, with the companion's loopback redirect.
const register = process.argv.includes('--register');
const servers = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));

const json = async (url) => {
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
};

const wellKnown = (server, kind) => {
  const url = new URL(server);
  const path = url.pathname.replace(/\/$/, '');
  return [
    ...(path && path !== '/' ? [`${url.origin}/.well-known/${kind}${path}`] : []),
    `${url.origin}/.well-known/${kind}`,
  ];
};

const asMetadata = async (issuer) => {
  const url = new URL(issuer);
  const path = url.pathname.replace(/\/$/, '');
  const candidates = path && path !== '/'
    ? [`${url.origin}/.well-known/oauth-authorization-server${path}`, `${url.origin}/.well-known/openid-configuration${path}`, `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`]
    : [`${url.origin}/.well-known/oauth-authorization-server`, `${url.origin}/.well-known/openid-configuration`];
  for (const candidate of candidates) {
    const found = await json(candidate);
    if (found) return { found, from: candidate };
  }
  return null;
};

(async () => {
  for (const server of servers) {
    let challenge = '';
    let status = 0;
    try {
      const response = await fetch(server, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'probe', version: '0' } } }),
      });
      status = response.status;
      challenge = response.headers.get('www-authenticate') ?? '';
    } catch (error) {
      console.log(`${server}\n  initialize failed: ${error.message}`);
      continue;
    }
    const resourceMetadata = /resource_metadata="([^"]+)"/.exec(challenge)?.[1];
    let metadata = resourceMetadata ? await json(resourceMetadata) : null;
    if (!metadata) {
      for (const candidate of wellKnown(server, 'oauth-protected-resource')) {
        metadata = await json(candidate);
        if (metadata) break;
      }
    }
    const issuer = metadata?.authorization_servers?.[0] ?? new URL(server).origin;
    const as = await asMetadata(issuer);
    console.log(`${server}`);
    console.log(`  initialize: ${status}${challenge ? ` (${challenge.slice(0, 120)})` : ''}`);
    console.log(`  resource: ${metadata?.resource ?? '-'}  issuer: ${issuer}`);
    console.log(`  authorize: ${as?.found?.authorization_endpoint ?? '-'}`);
    console.log(`  token: ${as?.found?.token_endpoint ?? '-'}`);
    console.log(`  registration: ${as?.found?.registration_endpoint ?? 'NONE'}`);
    console.log(`  pkce: ${(as?.found?.code_challenge_methods_supported ?? []).join(',') || '-'}  scopes: ${(metadata?.scopes_supported ?? as?.found?.scopes_supported ?? []).slice(0, 8).join(' ') || '-'}`);
    if (register && as?.found?.registration_endpoint) {
      const scopes = /scope="([^"]+)"/.exec(challenge)?.[1]?.split(/\s+/) ?? metadata?.scopes_supported;
      try {
        const response = await fetch(as.found.registration_endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({
            client_name: 'Willow',
            redirect_uris: ['http://127.0.0.1:53682/callback'],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none',
            application_type: 'native',
            ...(scopes?.length ? { scope: scopes.join(' ') } : {}),
          }),
        });
        const body = await response.json().catch(() => ({}));
        console.log(`  register: ${response.status} ${body.client_id ? 'client_id issued' : JSON.stringify(body).slice(0, 160)}`);
      } catch (error) {
        console.log(`  register failed: ${error.message}`);
      }
    }
  }
})();
