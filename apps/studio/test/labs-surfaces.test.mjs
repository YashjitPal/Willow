/**
 * Regression tests: Labs has two surfaces and one roster behind them.
 *
 * The modal's `LabsTab` and the standalone `LabsPage` at `/labs` both render
 * `settings/labs-experiments.ts` over `experimentsStore`. The failure this
 * guards is quiet: duplicate the row list and an experiment ends up offered on
 * one surface and hidden on the other, which the user can only discover by
 * opening the right one.
 *
 * Source assertions where the guarantee is about which module a component reads
 * from, behaviour where the modules are plain and can just be imported.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';

import { importTs } from './ts-module.mjs';

const appDir = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(appDir, '..', '..');

const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
const SOURCE = {
  roster: ['apps', 'studio', 'src', 'settings', 'labs-experiments.ts'],
  tab: ['apps', 'studio', 'src', 'settings', 'tabs', 'LabsTab.tsx'],
  page: ['apps', 'studio', 'src', 'settings', 'tabs', 'labs', 'LabsPage.tsx'],
  pageCss: ['apps', 'studio', 'src', 'settings', 'tabs', 'labs', 'LabsPage.css'],
  app: ['apps', 'studio', 'src', 'app', 'App.tsx'],
};

const rosterModule = path.join(repoRoot, ...SOURCE.roster);
const experimentsModule = path.join(repoRoot, 'platform', 'core', 'src', 'experiments-store.ts');

// These files quote their own class names and copy in prose.
const codeOnly = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/^[^\S\r\n]*\/\/.*$/gm, '');

const withLocalStorage = async (run) => {
  const had = 'localStorage' in globalThis;
  const previous = globalThis.localStorage;
  const cells = new Map();
  globalThis.localStorage = {
    getItem: (key) => (cells.has(key) ? cells.get(key) : null),
    setItem: (key, value) => { cells.set(key, String(value)); },
    removeItem: (key) => { cells.delete(key); },
    clear: () => cells.clear(),
    key: (index) => [...cells.keys()][index] ?? null,
    get length() { return cells.size; },
  };
  try {
    return await run();
  } finally {
    if (had) globalThis.localStorage = previous;
    else delete globalThis.localStorage;
  }
};

it('keeps the roster and the flag list in step, in both directions', async () => {
  await withLocalStorage(async () => {
    const { LABS_EXPERIMENTS } = await importTs(rosterModule);
    const { EXPERIMENT_DEFAULTS } = await importTs(experimentsModule);

    const wired = LABS_EXPERIMENTS.filter((row) => row.id !== null).map((row) => row.id);
    const flags = Object.keys(EXPERIMENT_DEFAULTS);

    // A row naming a flag that does not exist renders a switch that writes into
    // nothing; the store drops unknown ids on read, so it would silently forget.
    for (const id of wired) {
      assert.ok(flags.includes(id), `roster row "${id}" is not a real ExperimentId`);
    }
    // And a flag with no row is a feature with no way to turn it on.
    for (const id of flags) {
      assert.ok(wired.includes(id), `experiment "${id}" has no row on either Labs surface`);
    }

    // Every experiment ships off, so a fresh profile behaves as it did before the
    // experiment existed. Pinned here because the roster is where someone adding
    // one looks, and the default lives in the other file.
    for (const id of flags) {
      assert.equal(EXPERIMENT_DEFAULTS[id], false, `experiment "${id}" ships enabled`);
    }
  });
});

it('gives every unwired row an explicit drawn state', async () => {
  await withLocalStorage(async () => {
    const { LABS_EXPERIMENTS, LABS_DESCRIPTION } = await importTs(rosterModule);

    for (const row of LABS_EXPERIMENTS) {
      assert.ok(row.title, 'a roster row has no title');
      assert.ok(row.description, `roster row "${row.title}" has no description`);
      if (row.id === null) {
        // `undefined` would render as off by accident rather than by decision —
        // and one of these rows is deliberately drawn on.
        assert.equal(typeof row.staticEnabled, 'boolean',
          `mock-up row "${row.title}" does not say which state it is drawn in`);
      }
    }

    const titles = LABS_EXPERIMENTS.map((row) => row.title);
    assert.equal(new Set(titles).size, titles.length, 'two roster rows share a title');
    assert.match(LABS_DESCRIPTION, /alpha release/, 'the alpha warning left the shared copy');
  });
});

it('renders both surfaces from the shared roster, not from their own copies', () => {
  for (const key of ['tab', 'page']) {
    const source = codeOnly(read(...SOURCE[key]));
    assert.match(source, /LABS_EXPERIMENTS/, `${key}: does not read the shared roster`);
    assert.match(source, /LABS_DESCRIPTION/, `${key}: does not read the shared description`);
    assert.match(source, /LABS_EXPERIMENTS\.map\(/, `${key}: has the roster but does not map it`);
    // The titles are the cheapest tell that a surface has grown its own list.
    assert.ok(!/GitHub branch switching|Darker Design Background/.test(source),
      `${key}: a row's copy is hardcoded again instead of coming from the roster`);
    assert.match(source, /experimentsStore/, `${key}: does not read the shared flag store`);
  }
});

it('scopes every Labs page rule so it cannot repaint another settings page', () => {
  const css = read(...SOURCE.pageCss).replace(/\/\*[\s\S]*?\*\//g, '');

  const selectors = [...css.matchAll(/(^|\})\s*([^{}@]+?)\s*\{/g)]
    .map((match) => match[2].trim())
    .filter((selector) => selector.length > 0 && !selector.startsWith('@'));

  assert.ok(selectors.length > 10, 'the stylesheet stopped parsing as expected');
  for (const selector of selectors) {
    assert.ok(selector.includes('.labs-page-container'),
      `"${selector}" is unscoped — it would leak onto the other settings pages`);
  }

  // The switch is the specific hazard: `.mdc-switch` is PersonalIntelligenceTab's
  // class, so this file uses its own name for the same geometry.
  assert.ok(!/\.mdc-switch/.test(css), 'the page reused the Personal Intelligence switch class');
});

it('takes its accent from the workspace colour rather than a fixed hue', () => {
  const page = read(...SOURCE.page);
  assert.match(page, /getWorkspaceTheme\(userProfile\?\.workspaceColor\)/,
    'the page no longer resolves the workspace theme');
  assert.match(page, /'--lp-switch-on-track': theme\.creamy\.hex/,
    'the switched-on track is not the workspace pastel');
  assert.match(page, /'--lp-switch-on-handle': theme\.sendButton\.bg/,
    'the switch handle is not the workspace accent');
});

it('wires /labs everywhere a settings route has to be wired', () => {
  const app = read(...SOURCE.app);

  // Missing any one of these leaves the surface half-reachable: a URL that
  // renders Home, a view that never updates the address bar, or a back button
  // that strands the shell on a page nothing links to.
  const required = [
    ["import('../settings/tabs/labs/LabsPage')", 'the lazy import'],
    ["if (location.pathname === '/labs') return 'labs';", 'the currentView initialiser'],
    ["else if (view === 'labs') navigate('/labs');", 'the navigate branch'],
    ["(intent === 'labs' && location.pathname === '/labs')", 'the in-flight intent match'],
    ["commitView('labs')", 'the pathname sync'],
    ["currentView === 'labs'", 'the render branch and the fall-back-to-home list'],
    ["tabId === 'labs'", 'the sidebar gear handler'],
    ['<Route path="/labs" element={mainAppShell} />', 'the route'],
  ];
  for (const [snippet, what] of required) {
    assert.ok(app.includes(snippet), `App.tsx is missing ${what}: ${snippet}`);
  }

  // The gear opens the page; the modal's own Labs tab must still exist for
  // profile menu -> Settings -> Labs.
  assert.match(read(...['apps', 'studio', 'src', 'settings', 'SettingsModal.tsx']), /<LabsTab \/>/,
    'the modal lost its Labs tab, so Settings has no Labs section at all');
});
