import assert from 'node:assert/strict';
import path from 'node:path';
import { it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const { MCP_PRESETS, OWN_APP_REDIRECT, presetOwnApp, presetServer, presetSession, presetSignInServer, presetSignsIn, sessionEntry, signedInClient } = await importTs(path.join(repoRoot, 'features', 'spark', 'src', 'mcp-catalog.ts'));
const preset = (id) => MCP_PRESETS.find((entry) => entry.id === id);

it('lists apps that connect today, each with a real https address or the vendor it comes from', () => {
  const ids = MCP_PRESETS.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique: each is a server id');
  for (const entry of MCP_PRESETS) {
    if (entry.auth.kind === 'url') {
      assert.equal(entry.url, '');
      assert.match(entry.auth.link, /^https:\/\//);
    } else if (entry.auth.kind === 'program') {
      assert.equal(entry.url, '', `${entry.label} is a program, not an address`);
    } else {
      assert.match(entry.url, /^https:\/\/[^\s]+$/, `${entry.label} has an address`);
    }
    assert.ok(entry.description.length > 10);
  }
  assert.ok(ids.includes('zapier') && ids.includes('github') && ids.includes('exa'));
});

it('makes a server that is on, from a click, a pasted key or a pasted address, and says what is wrong otherwise', () => {
  assert.deepEqual(presetServer(preset('deepwiki'), ''), { id: 'deepwiki', label: 'DeepWiki', kind: 'http', enabled: true, url: 'https://mcp.deepwiki.com/mcp' });

  const github = presetServer(preset('github'), '  github_pat_11ABCDEF  ');
  assert.deepEqual(github.headers, { authorization: 'Bearer github_pat_11ABCDEF' });
  assert.equal(presetServer(preset('github'), 'Bearer abc').headers.authorization, 'Bearer abc', 'a pasted "Bearer" is not doubled');
  assert.match(presetServer(preset('github'), '').problem, /Paste your GitHub personal access token/);
  assert.match(presetServer(preset('stripe'), 'sk live 123').problem, /no spaces/);

  assert.equal(presetServer(preset('exa'), '').headers, undefined, 'an optional key can be left out');
  assert.deepEqual(presetServer(preset('exa'), 'exa-123').headers, { 'x-api-key': 'exa-123' });

  const zapier = presetServer(preset('zapier'), 'https://mcp.zapier.com/api/mcp/s/abc123/mcp');
  assert.equal(zapier.url, 'https://mcp.zapier.com/api/mcp/s/abc123/mcp');
  assert.match(presetServer(preset('zapier'), 'https://evil.example/zapier.com').problem, /not a Zapier address/);
  assert.match(presetServer(preset('zapier'), 'http://mcp.zapier.com/x').problem, /not a Zapier address/);
  assert.match(presetServer(preset('composio'), 'not a url').problem, /starting with https/);
});

it('signs in the way each vendor asks: Sentry\'s own scheme, Atlassian\'s email and token, or none at all', () => {
  assert.deepEqual(presetServer(preset('sentry'), 'sntryu_abc').headers, { authorization: 'Sentry-Bearer sntryu_abc' });
  assert.equal(presetServer(preset('sentry'), 'Sentry-Bearer sntryu_abc').headers.authorization, 'Sentry-Bearer sntryu_abc', 'a pasted scheme is not doubled');
  assert.equal(presetServer(preset('sentry'), 'Bearer sntryu_abc').headers.authorization, 'Sentry-Bearer sntryu_abc', 'Bearer is Sentry\'s OAuth, so a token always goes as Sentry-Bearer');

  const encoded = Buffer.from('sam@example.com:ATATT3x').toString('base64');
  assert.deepEqual(presetServer(preset('atlassian'), 'sam@example.com:ATATT3x').headers, { authorization: `Basic ${encoded}` });
  assert.equal(presetServer(preset('atlassian'), encoded).headers.authorization, `Basic ${encoded}`, 'already encoded, it goes as it is');
  assert.equal(presetServer(preset('atlassian'), `Basic ${encoded}`).headers.authorization, `Basic ${encoded}`);
  assert.match(presetServer(preset('atlassian'), 'ATATT3x').problem, /email, a colon, then the API token/);

  assert.deepEqual(presetServer(preset('linear'), 'lin_api_1').headers, { authorization: 'Bearer lin_api_1' });
  assert.equal(presetServer(preset('firecrawl'), '').headers, undefined, 'keyless, with fewer tools');
  assert.deepEqual(presetServer(preset('aws-knowledge'), 'ignored'), { id: 'aws-knowledge', label: 'AWS Knowledge', kind: 'http', enabled: true, url: 'https://knowledge-mcp.global.api.aws' });
});

it('groups the apps so a person finds theirs', () => {
  const groups = [...new Set(MCP_PRESETS.map((entry) => entry.group))];
  assert.deepEqual(groups, ['Connect many apps at once', 'Code', 'Search and research', 'Work and projects', 'Business', 'Design and websites', 'On this computer']);
  assert.equal(MCP_PRESETS.length, 45);
});

it('connects X by its app\'s Bearer token, or by signing in with that app, asking to read and keep bookmarks only', () => {
  const x = preset('x');
  assert.equal(x.url, 'https://api.x.com/mcp');
  // X's Bearer tokens carry %-escapes as they are copied; they go as they are.
  assert.deepEqual(presetServer(x, ' AAAAAAAAAAAAAAAAAAAAAMLheAAAAAAA0%2BuSeid ').headers, { authorization: 'Bearer AAAAAAAAAAAAAAAAAAAAAMLheAAAAAAA0%2BuSeid' });
  assert.equal(presetSignsIn(x), false, 'X lets no app register itself, so Connect asks for the token');
  const app = presetOwnApp(x);
  assert.equal(app.link, 'https://console.x.com');
  assert.equal(app.redirect, 'http://127.0.0.1:3334/oauth/callback', 'X takes a loopback callback as 127.0.0.1, not localhost');
  assert.ok(app.scopes.includes('offline.access'), 'X\'s access tokens last two hours; this brings a refresh token');
  assert.ok(app.scopes.includes('bookmark.write'), 'its bookmark tools change bookmarks');
  for (const scope of app.scopes) {
    assert.doesNotMatch(scope, /^(dm|block|mute|developer|media)\.|^(tweet|like|list|follows)\.write$/, `${scope}: nothing that posts, messages or spends`);
  }
  assert.equal(presetOwnApp(preset('github')), undefined);
  assert.equal(presetOwnApp(preset('asana')).redirect, OWN_APP_REDIRECT, 'an oauth preset\'s own app, too');
  assert.equal(presetOwnApp(preset('asana')).scopes, undefined, 'Asana is asked for what its server names');

  const oauth = { accessToken: 'a', tokenEndpoint: 'https://api.x.com/2/oauth2/token', resource: x.url, clientId: 'native-id' };
  assert.deepEqual(signedInClient({ oauth }), { clientId: 'native-id' }, 'signing in again uses the app it signed in with');
  assert.deepEqual(signedInClient({ oauth: { ...oauth, clientSecret: 's' } }), { clientId: 'native-id', clientSecret: 's' });
  assert.equal(signedInClient({}), undefined);
  assert.equal(signedInClient(null), undefined);
});

it('connects Zoho\'s apps by the address of a server made in Zoho MCP, in any of its data centres', () => {
  for (const id of ['zoho-crm', 'zoho-desk', 'zoho-mail', 'zoho-projects', 'bigin']) {
    const entry = preset(id);
    assert.equal(entry.auth.kind, 'url', `${entry.label} is a pasted address`);
    assert.equal(entry.auth.link, 'https://mcp.zoho.com');
  }
  const address = 'https://crm-1234.zohomcp.com/mcp/message?key=abc123';
  assert.deepEqual(presetServer(preset('zoho-crm'), ` ${address} `), { id: 'zoho-crm', label: 'Zoho CRM', kind: 'http', enabled: true, url: address });
  assert.equal(presetServer(preset('bigin'), 'https://bigin-1.zohomcp.eu/mcp/message?key=k').url, 'https://bigin-1.zohomcp.eu/mcp/message?key=k');
  assert.equal(presetServer(preset('zoho-mail'), 'https://mail-1.zohomcp.com.au/mcp/message?key=k').url, 'https://mail-1.zohomcp.com.au/mcp/message?key=k');
  assert.match(presetServer(preset('zoho-desk'), 'https://zohomcp.com.evil.example/mcp/message?key=k').problem, /not a Zoho Desk address/);
  assert.match(presetServer(preset('zoho-projects'), 'http://p-1.zohomcp.com/mcp/message?key=k').problem, /not a Zoho Projects address/);
});

it('adds the programs that start on this computer as they were checked, one asking for its folder', () => {
  const programs = MCP_PRESETS.filter((entry) => entry.auth.kind === 'program');
  assert.deepEqual(programs.map((entry) => `${entry.id}: ${entry.auth.command} ${entry.auth.args.join(' ')}`), [
    'playwright: npx -y @playwright/mcp@latest',
    'chrome-devtools: npx -y chrome-devtools-mcp@latest',
    'filesystem: npx -y @modelcontextprotocol/server-filesystem',
    'git: uvx mcp-server-git',
    'fetch: uvx mcp-server-fetch',
    'x-reader: uv run --script x-reader.py',
  ]);
  assert.ok(programs.every((entry) => entry.group === 'On this computer' && /^(Node\.js|uv)$/.test(entry.auth.comesWith)));
  assert.deepEqual(presetServer(preset('git'), 'ignored'), { id: 'git', label: 'Git', kind: 'program', command: 'uvx', args: ['mcp-server-git'], enabled: true });
  assert.deepEqual(presetServer(preset('filesystem'), ''), { problem: 'Choose the folder Files may use.' });
  assert.deepEqual(presetServer(preset('filesystem'), ' C:\\Users\\me\\Documents '), { id: 'filesystem', label: 'Files', kind: 'program', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:\\Users\\me\\Documents'], enabled: true });
  assert.deepEqual(programs.filter((entry) => entry.auth.bundled).map((entry) => entry.id), ['x-reader'], 'only Willow\'s own runs from the companion\'s copy');
});

it('connects X Reader with two of x.com\'s cookies, pasted one by one or as a Cookie header, in the variable it reads', () => {
  const reader = preset('x-reader');
  const session = presetSession(reader);
  assert.deepEqual(session, { site: 'x.com', name: 'X', cookies: ['auth_token', 'ct0'], env: 'X_COOKIES' });
  assert.equal(presetSession(preset('git')), undefined);
  const token = '0123456789abcdef0123456789abcdef01234567'; // backup-guard:allow
  const ct0 = 'fedcba9876543210fedcba9876543210';
  const header = `auth_token=${token}; ct0=${ct0}`;
  assert.deepEqual(presetServer(reader, sessionEntry(session, [` ${token} `, ct0])), {
    id: 'x-reader',
    label: 'X Reader',
    kind: 'program',
    command: 'uv',
    args: ['run', '--script', 'x-reader.py'],
    bundled: 'x-reader',
    env: { X_COOKIES: header },
    enabled: true,
  });
  const whole = `guest_id=v1%3A1; auth_token=${token}; lang=en; ct0=${ct0}; twid=u%3D1`;
  assert.equal(presetServer(reader, sessionEntry(session, [whole, ''])).env.X_COOKIES, header, 'a whole Cookie header, the other cookies left out');
  assert.equal(presetServer(reader, sessionEntry(session, ['', `cookie: ${whole}`])).env.X_COOKIES, header, 'into either field, "cookie:" and all');
  assert.equal(presetServer(reader, sessionEntry(session, [whole, 'abc123'])).env.X_COOKIES, `auth_token=${token}; ct0=abc123`, 'a value typed into its own field counts over a pasted one');
  assert.match(presetServer(reader, sessionEntry(session, [token, ''])).problem, /^Paste the ct0 cookie from x\.com\.$/);
  assert.match(presetServer(reader, '').problem, /^Paste the auth_token and ct0 cookies from x\.com\.$/);
  assert.match(presetServer(reader, sessionEntry(session, ['abc def', ct0])).problem, /That auth_token is not a cookie’s value/);
  assert.match(presetServer(reader, sessionEntry(session, [token, 'a"b'])).problem, /That ct0 is not a cookie’s value/);
  assert.equal(sessionEntry(session, ['', '  ']), '');
});

it('signs in to every site a program reads, in the companion, for the very cookies the program reads there', async () => {
  const { SITE_SIGN_INS } = await import(pathToFileURL(path.join(repoRoot, 'services', 'local-companion', 'src', 'site-sign-in.mjs')).href);
  const sessions = MCP_PRESETS.map(presetSession).filter(Boolean);
  assert.ok(sessions.length > 0);
  for (const session of sessions) {
    assert.ok(Object.hasOwn(SITE_SIGN_INS, session.site), `the companion signs in to ${session.site}`);
    assert.deepEqual(SITE_SIGN_INS[session.site].cookies, session.cookies, `${session.site}: what the sign-in hands back is what the program reads`);
    assert.ok(session.name, 'a name for its "Sign in to" button');
  }
});

it('connects X Reader from a sign-in to X, keeping only the cookies it reads, and says how one that did not finish ended', async () => {
  const { localCompanion } = await importTs(path.join(repoRoot, 'features', 'code', 'src', 'local-companion.ts'));
  const { canSignInToSites, cancelSiteSignIn, signInToSite } = await importTs(path.join(repoRoot, 'features', 'spark', 'src', 'site-sign-in.ts'));
  const reader = preset('x-reader');
  const session = presetSession(reader);
  const asked = [];
  let answer;
  localCompanion.request = async (type, payload, timeoutMs) => {
    asked.push({ type, payload, timeoutMs });
    if (answer instanceof Error) throw answer;
    return answer;
  };
  try {
    answer = { cookies: { guest_id: 'v1%3A1', auth_token: 'tok-123', ct0: 'csrf-456', twid: 'u%3D1' } };
    const signedIn = await signInToSite(session);
    assert.deepEqual(signedIn, { entry: 'auth_token=tok-123; ct0=csrf-456' });
    assert.deepEqual(asked[0], { type: 'site.signIn', payload: { site: 'x.com' }, timeoutMs: 11 * 60_000 }, 'longer than the companion keeps its window open');
    assert.equal(presetServer(reader, signedIn.entry).env.X_COOKIES, 'auth_token=tok-123; ct0=csrf-456', 'what it hands back connects as a paste does');

    answer = { cancelled: true };
    assert.deepEqual(await signInToSite(session), { cancelled: true }, 'the user closed the window, or Cancel did');
    answer = { cookies: { auth_token: 'tok-123' } };
    assert.match((await signInToSite(session)).problem, /^Signing in to x\.com didn’t give Willow its session\. Try again, or paste the cookies instead\.$/);
    answer = new Error('Nobody signed in to x.com within 10 minutes, so Willow closed the window.');
    assert.deepEqual(await signInToSite(session), { problem: answer.message }, 'the companion\'s own sentence');

    answer = {};
    cancelSiteSignIn();
    assert.deepEqual(asked.at(-1), { type: 'site.cancel', payload: {}, timeoutMs: 5_000 });
    assert.equal(await canSignInToSites(), false, 'only the desktop app opens one');
  } finally {
    delete localCompanion.request;
  }
});

it('offers sign-in for apps that take nothing else, with an app of the user\'s own where the service asks for one', () => {
  const signIns = MCP_PRESETS.filter((entry) => entry.auth.kind === 'oauth').map((entry) => entry.id);
  assert.deepEqual(signIns, ['fever', 'notion', 'asana', 'granola', 'wispr-flow', 'dropbox', 'hubspot', 'canva', 'webflow', 'wix']);
  // Each of these took Willow's own registration request when it was added (October 2026).
  for (const id of ['fever', 'granola', 'wispr-flow', 'dropbox', 'canva', 'webflow', 'wix']) {
    assert.equal(preset(id).auth.ownApp, undefined, `${preset(id).label} lets Willow register itself`);
  }
  assert.deepEqual(presetServer(preset('notion'), 'typed by mistake'), { id: 'notion', label: 'Notion', kind: 'http', enabled: true, url: 'https://mcp.notion.com/mcp' }, 'the sign-in brings the tokens, not the box');
  assert.equal(preset('notion').auth.ownApp, undefined, 'Notion lets Willow register itself');
  assert.equal(preset('asana').auth.ownApp.redirect, 'http://localhost:3334/oauth/callback');
  assert.match(preset('hubspot').auth.ownApp.link, /^https:\/\//);
});

it('offers a sign-in instead of a key where the server takes one and lets Willow register, and signs in to the bare address', () => {
  const instead = MCP_PRESETS.filter((entry) => entry.auth.kind === 'key' && entry.auth.signIn).map((entry) => entry.id);
  assert.deepEqual(instead, ['sentry', 'neon', 'supabase', 'postman', 'cloudflare', 'apify', 'linear', 'atlassian', 'monday', 'stripe']);
  assert.equal(presetSignsIn(preset('github')), false, 'GitHub admits only apps it approved');
  assert.equal(presetSignsIn(preset('notion')), true);
  assert.equal(presetSignsIn(preset('linear')), true);
  assert.deepEqual(presetSignInServer(preset('atlassian')), { id: 'atlassian', label: 'Atlassian', kind: 'http', url: 'https://mcp.atlassian.com/v2/mcp', enabled: true });
  assert.equal(OWN_APP_REDIRECT, preset('hubspot').auth.ownApp.redirect);
});
