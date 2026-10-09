import assert from 'node:assert/strict';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const { MCP_PRESETS, OWN_APP_REDIRECT, presetServer, presetSignInServer, presetSignsIn } = await importTs(path.join(repoRoot, 'features', 'spark', 'src', 'mcp-catalog.ts'));
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
  assert.deepEqual(groups, ['Connect many apps at once', 'Code', 'Search and research', 'Work and projects', 'Business', 'On this computer']);
  assert.equal(MCP_PRESETS.length, 31);
});

it('adds the programs that start on this computer as they were checked, one asking for its folder', () => {
  const programs = MCP_PRESETS.filter((entry) => entry.auth.kind === 'program');
  assert.deepEqual(programs.map((entry) => `${entry.id}: ${entry.auth.command} ${entry.auth.args.join(' ')}`), [
    'playwright: npx -y @playwright/mcp@latest',
    'chrome-devtools: npx -y chrome-devtools-mcp@latest',
    'filesystem: npx -y @modelcontextprotocol/server-filesystem',
    'git: uvx mcp-server-git',
    'fetch: uvx mcp-server-fetch',
  ]);
  assert.ok(programs.every((entry) => entry.group === 'On this computer' && /^(Node\.js|uv)$/.test(entry.auth.comesWith)));
  assert.deepEqual(presetServer(preset('git'), 'ignored'), { id: 'git', label: 'Git', kind: 'program', command: 'uvx', args: ['mcp-server-git'], enabled: true });
  assert.deepEqual(presetServer(preset('filesystem'), ''), { problem: 'Choose the folder Files may use.' });
  assert.deepEqual(presetServer(preset('filesystem'), ' C:\\Users\\me\\Documents '), { id: 'filesystem', label: 'Files', kind: 'program', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:\\Users\\me\\Documents'], enabled: true });
});

it('offers sign-in for apps that take nothing else, with an app of the user\'s own where the service asks for one', () => {
  const signIns = MCP_PRESETS.filter((entry) => entry.auth.kind === 'oauth').map((entry) => entry.id);
  assert.deepEqual(signIns, ['notion', 'asana', 'hubspot']);
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
