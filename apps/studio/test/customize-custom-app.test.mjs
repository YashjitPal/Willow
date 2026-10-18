/**
 * Connectors' "+ Custom": Gemini's custom connected apps, kept as MCP servers in Willow's one store.
 *
 * The address rules and the sentences are Gemini's (custom-mcp-registration-dialog and its consent and review
 * steps), the picture is the site's favicon through Google's s2 service as Gemini's is, and a custom app never
 * takes a catalog card's id. The skill editor's name rules are Gemini's skill-editor's.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const customize = (...parts) => path.join(repoRoot, 'apps', 'studio', 'src', 'customize', ...parts);

const app = await importTs(customize('custom-app', 'custom-app.ts'));
const names = await importTs(customize('skill-name.ts'));

const server = (over) => ({ id: 'deepwiki-2', label: 'DeepWiki', kind: 'http', url: 'https://mcp.deepwiki.com/mcp', enabled: true, ...over });

test('an address has to be written with https:// and parse as https', () => {
  assert.equal(app.isHttpsAddress('https://mcp.deepwiki.com/mcp'), true);
  assert.equal(app.isHttpsAddress('  https://mcp.deepwiki.com/mcp  '), true);
  assert.equal(app.isHttpsAddress('http://mcp.deepwiki.com/mcp'), false);
  assert.equal(app.isHttpsAddress('mcp.deepwiki.com/mcp'), false);
  assert.equal(app.isHttpsAddress('https://'), false);
  assert.equal(app.isHttpsAddress(''), false);
});

test('"already connected" compares addresses with the host lower-cased and no trailing slash, and ignores staged ones', () => {
  assert.equal(app.addressKey('https://MCP.DeepWiki.com/mcp/'), 'https://mcp.deepwiki.com/mcp');
  assert.equal(app.addressKey('not a url'), null);
  assert.equal(app.isAddressConnected('https://mcp.deepwiki.com/mcp/', [server()]), true);
  assert.equal(app.isAddressConnected('https://mcp.deepwiki.com/sse', [server()]), false);
  app.customAppMeta.set({ 'deepwiki-2': { pending: true, stagedAt: 0 } });
  try {
    assert.equal(app.isAddressConnected('https://mcp.deepwiki.com/mcp', [server()]), false, 'a server mid-dialog is not yet one of the apps');
  } finally {
    app.customAppMeta.set({});
  }
});

test('a custom app shows its site\'s favicon through Google\'s favicon service', () => {
  assert.equal(app.siteOf('https://mcp.deepwiki.com/mcp'), 'deepwiki.com');
  assert.equal(app.siteOf('https://api.example.co.uk/mcp'), 'example.co.uk');
  assert.equal(app.siteOf('https://example.com'), 'example.com');
  assert.equal(app.siteOf('nonsense'), '');
  assert.equal(app.faviconFor('https://mcp.deepwiki.com/mcp'), 'https://www.google.com/s2/favicons?domain=deepwiki.com&sz=32');
  assert.equal(app.faviconFor(''), '');
});

test('the list holds finished http servers that are not catalog cards, switched on or off', () => {
  const listed = app.customAppServers([
    server(),
    server({ id: 'deepwiki', label: 'DeepWiki preset' }),
    server({ id: 'staged', url: 'https://staged.example.com/mcp' }),
    server({ id: 'worker', kind: 'worker', url: undefined }),
    server({ id: 'off', url: 'https://off.example.com/mcp', enabled: false }),
  ], { staged: { pending: true } });
  assert.deepEqual(listed.map((entry) => entry.id), ['deepwiki-2', 'off']);

  const on = app.customAppItem(server(), { description: 'Wiki answers' });
  assert.equal(on.id, 'custom-app:deepwiki-2');
  assert.equal(app.isCustomAppItem(on), true);
  assert.equal(app.customAppServerId(on), 'deepwiki-2');
  assert.equal(on.type, 'connector');
  assert.equal(on.subtitle, 'Wiki answers');
  assert.deepEqual([on.hasAddButton, on.hasMoreButton], [false, true]);
  const off = app.customAppItem(server({ enabled: false }), undefined);
  assert.deepEqual([off.hasAddButton, off.hasMoreButton, off.subtitle], [true, false, '']);
});

test('a custom app\'s id never takes a catalog card\'s, so DeepWiki added by address is not the DeepWiki preset', async () => {
  const source = read('apps', 'studio', 'src', 'customize', 'custom-app', 'custom-app.ts');
  assert.match(source, /suggestMcpServerId\([^;]*MCP_PRESETS\.map\(\(preset\) => preset\.id\)\)/);
  const store = await importTs(path.join(repoRoot, 'platform', 'ai', 'src', 'mcp', 'mcp-store.ts'));
  assert.equal(store.suggestMcpServerId('deepwiki', ['deepwiki']), 'deepwiki-2');
});

test('a server that did not connect gets Gemini\'s sentence for what went wrong', () => {
  const invalid = 'This URL does not appear to be a valid MCP server. Check the URL.';
  const trouble = 'We had trouble connecting to this server. Contact the server provider for help.';
  assert.equal(app.failureText('not-mcp', false), invalid);
  assert.equal(app.failureText('protocol', true), invalid);
  assert.equal(app.failureText('unreachable', false), trouble);
  assert.equal(app.failureText('timeout', true), trouble);
  assert.equal(app.failureText('blocked-by-server', true), trouble);
  assert.match(app.failureText('blocked-by-server', false), /desktop app/, 'a web page is told where it would work');
  assert.equal(app.failureText(undefined, true), 'Verify the URL and try again.');
});

test('the three dialogs keep Gemini\'s widths, timings and sentences', () => {
  const css = stripComments(read('apps', 'studio', 'src', 'customize', 'custom-app', 'CustomAppDialogs.css'));
  assert.match(css, /\.cad-registration \{\s*width: 512px;\s*max-width: calc\(100vw - 48px\);/);
  assert.match(css, /\.cad-consent \{\s*width: 512px;\s*min-width: 464px;\s*max-width: min\(600px, calc\(100vw - 40px\)\);/);
  assert.match(css, /\.cad-review \{[^}]*width: 832px;/);
  assert.match(css, /transition: opacity 150ms linear, transform 150ms cubic-bezier\(0, 0, 0\.2, 1\);/);
  assert.match(css, /transition: opacity 75ms linear, transform 75ms cubic-bezier\(0, 0, 0\.2, 1\);/);
  const dialogs = read('apps', 'studio', 'src', 'customize', 'custom-app', 'CustomAppDialogs.tsx');
  assert.match(dialogs, /const CLOSE_MS = 155;/);
  for (const sentence of [
    'Connect to an MCP server',
    'Please enter a valid URL starting with https://',
    'This MCP server is already connected.',
    'Connect this MCP server',
    'I understand and accept the security and privacy risks of connecting this custom app.',
    'Save your custom app',
    'An app with this name is already connected.',
  ]) assert.ok(dialogs.includes(sentence), sentence);
});

test('a skill\'s name takes what is typed into lowercase words joined by single hyphens', () => {
  assert.equal(names.slugSkillName('Hello World! 2'), 'hello-world-2');
  assert.equal(names.slugSkillName('Meeting   Notes'), 'meeting-notes');
  assert.equal(names.slugSkillName('a--b__c'), 'a-bc');
  assert.equal(names.slugSkillName('Résumé'), 'résumé');
});

test('a skill saves with a valid unused name, a description and instructions; the messages wait for Create', () => {
  const { SKILL_ERRORS } = names;
  assert.equal(SKILL_ERRORS.nameFormat, 'Use lowercase letters, numbers and hyphens only. Must not start or end with a hyphen (1–64 chars).');
  assert.equal(names.isSkillNameInvalid('notes-2'), false);
  assert.equal(names.isSkillNameInvalid('-notes'), true);
  assert.equal(names.isSkillNameInvalid('notes-'), true);
  assert.equal(names.isSkillNameInvalid('a'.repeat(65)), true);
  assert.equal(names.isSkillNameInvalid(''), false, 'an empty name is missing, not malformed');
  assert.equal(names.isSkillNameTaken('notes', 'notes', ['notes']), false, 'a skill keeps its own name');
  assert.equal(names.isSkillNameTaken(' notes ', '', ['notes']), true);

  const full = { name: 'notes', description: 'Summarise notes', instructions: 'Bullet points.' };
  assert.equal(names.canSaveSkill(full, '', []), true);
  assert.equal(names.canSaveSkill({ ...full, description: ' ' }, '', []), false);
  assert.equal(names.canSaveSkill(full, '', ['notes']), false);

  const empty = { name: '', description: '', instructions: '' };
  assert.deepEqual(names.skillErrors(empty, '', [], false), { name: null, taken: null, description: null, instructions: null });
  assert.deepEqual(names.skillErrors(empty, '', [], true), {
    name: SKILL_ERRORS.nameEmpty,
    taken: null,
    description: SKILL_ERRORS.description,
    instructions: SKILL_ERRORS.instructions,
  });
  assert.equal(names.skillErrors({ ...full, name: 'notes-' }, '', [], true).name, SKILL_ERRORS.nameFormat);
  assert.equal(names.skillErrors(full, '', ['notes'], false).taken, SKILL_ERRORS.nameTaken, 'a taken name shows at once');
});
