/**
 * Skills, Schedules and Connected apps moving into Customize.
 *
 * Spark's Schedules, Skills and Connected apps rows, the settings menu's Scheduled
 * actions row and the `/connected-apps` page are retired behind Labs' "Old Skills and
 * Schedules". Off, Skills and Connected apps open Customize's tabs instead, and those
 * tabs run on the real skill library and the real connectors.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');

it('lists "Old Skills and Schedules" in Labs, off by default', () => {
  const store = read('platform', 'core', 'src', 'experiments-store.ts');
  assert.match(store, /'old-skills-schedules': false/);
  const roster = read('apps', 'studio', 'src', 'settings', 'labs-experiments.ts');
  assert.match(roster, /id: 'old-skills-schedules',\s*title: 'Old Skills and Schedules'/);
});

it('hides the old rows unless the experiment is on', () => {
  const sidebar = read('apps', 'studio', 'src', 'shell', 'sidebar', 'Sidebar.tsx');
  assert.match(sidebar, /id: 'scheduled'[^\n]*requiresExperiment: 'old-skills-schedules'/);
  const gate = sidebar.indexOf("experiments['old-skills-schedules'] && (");
  assert.ok(gate > 0, 'Spark\'s Customise rows are gated');
  const rows = sidebar.slice(gate, sidebar.indexOf('</>', gate));
  for (const go of ['goToSparkSchedules', 'goToSparkSkills', 'goToSparkApps']) assert.match(rows, new RegExp(go));
});

it('sends Connected apps and Skills to Customize\'s tabs', () => {
  const app = read('apps', 'studio', 'src', 'app', 'App.tsx');
  assert.match(app, /location\.pathname === '\/connected-apps' && !isOldLibraryEnabled\) \{\s*requestCustomizeTab\('connectors'\);\s*navigate\('\/customize'/);
  assert.match(app, /tabId === 'skills'\) \{\s*requestCustomizeTab\('skills'\);/);

  const pi = read('apps', 'studio', 'src', 'settings', 'tabs', 'personal-intelligence', 'PersonalIntelligenceTab.tsx');
  assert.doesNotMatch(pi, /navigate\('\/connected-apps'\)/);
  assert.match(pi, /requestCustomizeTab\('connectors'\);\s*navigate\('\/customize'\)/);

  const view = read('apps', 'studio', 'src', 'customize', 'CustomizeView.tsx');
  assert.match(view, /useStore\(\$customizeTabRequest\)/, 'the page takes the request');
});

it('runs Customize\'s Connectors on the real connections', () => {
  const view = read('apps', 'studio', 'src', 'customize', 'CustomizeView.tsx');
  assert.match(view, /useConnections\(\)/);
  assert.match(view, /<ConnectConsentDialog/);
  assert.doesNotMatch(view, /disconnectedConnectors/, 'no local make-believe connection state');
});

it('lists only connectors Willow can really connect', async () => {
  const customize = path.join(repoRoot, 'apps', 'studio', 'src', 'customize');
  const { CONNECTORS_DATA, DISCOVER_CATEGORIES } = await importTs(path.join(customize, 'customize-data.ts'));
  const { connectorCardId } = await importTs(path.join(customize, 'customize-connectors.ts'));
  const { isCardConnectable } = await importTs(
    path.join(repoRoot, 'apps', 'studio', 'src', 'settings', 'tabs', 'connected-apps', 'connector-map.ts'),
  );
  const { MCP_PRESETS } = await importTs(path.join(repoRoot, 'features', 'spark', 'src', 'mcp-catalog.ts'));
  assert.deepEqual(CONNECTORS_DATA.filter((item) => !item.mcp).map((item) => item.id), ['google-workspace', 'youtube', 'github', 'spotify']);
  for (const item of CONNECTORS_DATA) {
    if (item.mcp) assert.ok(MCP_PRESETS.some((preset) => preset.id === item.mcp), `${item.title} connects through a real MCP preset`);
    else assert.ok(isCardConnectable(connectorCardId(item.id)), `${item.title} has a real connector`);
    assert.ok(item.hasAddButton && !item.hasMoreButton, `${item.title} starts disconnected; the grant decides`);
  }
  // Gemini's cards with neither an API Willow can reach nor a public MCP server stay out.
  for (const gone of ['search-services', 'google-photos', 'youtube-music', 'contacts', 'gemini-notebook', 'google-business-profile', 'kbc', 'verify-ai']) {
    assert.ok(!CONNECTORS_DATA.some((item) => item.id === gone), `${gone} is not listed`);
  }
  for (const category of DISCOVER_CATEGORIES) {
    for (const item of category.items) assert.ok(item, `no dangling Discover entry in ${category.title}`);
  }
});

it('makes "Use now" type the skill\'s library name, and "Create with Gemini" open the seeded chat', async () => {
  const skills = await importTs(path.join(repoRoot, 'apps', 'studio', 'src', 'customize', 'customize-skills.ts'));
  const entries = skills.toLibrarySkills({ activeIds: ['apple-music-playlist'], inactiveIds: [], custom: [], edits: {} });
  const builtIn = { id: 'apple-music-playlist', type: 'skill', title: 'Apple Music playlist', subtitle: '', slug: 'apple-music-playlist' };
  assert.equal(entries[0].name, skills.customizeSkillName(builtIn), 'the "/" token is the library name');

  const view = read('apps', 'studio', 'src', 'customize', 'CustomizeView.tsx');
  assert.match(view, /openChatWith\(`\/\$\{customizeSkillName\(item, savedSkillsData\[item\.id\]\)\} `\)/);
  assert.match(view, /requestSeededChat\(\{ prompt: SKILL_SEED_PROMPT, reply: SKILL_SEED_REPLY \}\)/);
});

it('lists Grok 4.7 for xAI', () => {
  const models = read('apps', 'studio', 'src', 'settings', 'provider-models.ts');
  assert.match(models, /id: 'grok-4\.7',\s*name: 'Grok 4\.7'/);
});
