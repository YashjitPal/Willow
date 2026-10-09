/*
 * Willow open in two tabs: one `modelConfig` key, and a catalog that follows between them.
 *
 * Only the catalog is shared, so the tabs' configs differ everywhere else. A tab used to write
 * back every catalog it took from the other, which read over there as a fresh change and was
 * written back in turn. The tabs traded writes for as long as both were open, and a model added
 * in Settings -> Models flickered in and out of both while they did.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const { adoptModelCatalogSnapshot, createTabCatalogSync, extractModelCatalogSnapshot } = await importTs(
  path.join(repoRoot, 'apps', 'studio', 'src', 'app', 'model-catalog-storage.ts'),
);

const saved = (id, name) => ({ id, modelId: `gemini-${id}`, name, thinkingLevel: 1 });

const config = (models, gemini = {}) => ({
  gemini: { model: 'gemini-flash', thinkingLevel: 1, savedModels: models, ...gemini },
  openai: { savedModels: [] },
  anthropic: { savedModels: [] },
  moonshot: { savedModels: [] },
  spacexai: { savedModels: [] },
  zhipuai: { savedModels: [] },
  modelOrder: [],
});

const names = (modelConfig) => modelConfig.gemini.savedModels.map((model) => model.name).join(',');

const pickModel = (model) => (current) => ({ ...current, gemini: { ...current.gemini, model } });
const addModel = (model) => (current) => ({
  ...current,
  gemini: { ...current.gemini, savedModels: [...current.gemini.savedModels, model] },
});

/*
 * Tabs over one localStorage, under the browser's rule that a write fires `storage` in every
 * other tab, and only when it changes the stored value. Each tab does what App.tsx does: it
 * persists every new config unless that config came from another tab, and on `storage` it
 * adopts what is stored at that moment.
 */
const openTabs = (initial, count = 2) => {
  const store = { value: JSON.stringify(initial), writes: 0 };
  const tabs = Array.from({ length: count }, () => ({
    sync: createTabCatalogSync(),
    config: JSON.parse(store.value),
    pendingEvents: 0,
    catalogs: [],
  }));

  const commit = (tab, next) => {
    if (next === tab.config) return;
    if (names(next) !== names(tab.config)) tab.catalogs.push(names(next));
    tab.config = next;
    if (tab.sync.isFromOtherTab(next)) return;
    const value = JSON.stringify(next);
    if (value === store.value) return;
    store.value = value;
    store.writes += 1;
    for (const other of tabs) if (other !== tab) other.pendingEvents += 1;
  };

  return {
    store,
    tabs,
    change: (tab, update) => commit(tab, update(tab.config)),
    settle: () => {
      for (let delivered = 0; delivered < 100; delivered += 1) {
        const tab = tabs.find((candidate) => candidate.pendingEvents > 0);
        if (!tab) return;
        tab.pendingEvents -= 1;
        commit(tab, tab.sync.adoptStored(tab.config, store.value));
      }
      throw new Error('the tabs never stopped writing to each other');
    },
  };
};

it('keeps the same config when another tab wrote without changing the catalog', () => {
  const sync = createTabCatalogSync();
  const current = config([saved('a', 'A')]);
  const otherTab = config([saved('a', 'A')], { model: 'gemini-pro', thinkingLevel: 3 });

  assert.equal(sync.adoptStored(current, JSON.stringify(otherTab)), current);
  assert.equal(adoptModelCatalogSnapshot(current, extractModelCatalogSnapshot(otherTab)), current);
  assert.equal(sync.isFromOtherTab(current), false);
});

it("takes another tab's catalog without its settings, and marks the result as not to be written back", () => {
  const sync = createTabCatalogSync();
  const current = config([saved('a', 'A')]);
  const otherTab = config([saved('a', 'A'), saved('b', 'B')], { model: 'gemini-pro' });

  const next = sync.adoptStored(current, JSON.stringify(otherTab));
  assert.equal(names(next), 'A,B');
  assert.equal(next.gemini.model, 'gemini-flash');
  assert.equal(sync.isFromOtherTab(next), true);
  assert.equal(sync.isFromOtherTab({ ...next }), false, 'a change made on top of it is the tab\'s own');
});

it('ignores a stored value that is missing or does not parse', () => {
  const sync = createTabCatalogSync();
  const current = config([saved('a', 'A')]);
  assert.equal(sync.adoptStored(current, null), current);
  assert.equal(sync.adoptStored(current, '{"gemini":'), current);
});

it('settles after a model is added in one of two tabs instead of trading writes', () => {
  const browser = openTabs(config([saved('a', 'A')]));
  const [settings, other] = browser.tabs;

  // Picking a model in a provider's menu changes only fields the other tab does not share.
  browser.change(settings, pickModel('gemini-pro'));
  browser.settle();
  browser.change(settings, addModel(saved('b', 'B')));
  browser.settle();

  assert.equal(browser.store.writes, 2, 'one write per change, none echoed back');
  assert.deepEqual(settings.catalogs, ['A,B']);
  assert.deepEqual(other.catalogs, ['A,B'], 'the added model arrives once and stays');
  assert.equal(other.config.gemini.model, 'gemini-flash');
  assert.equal(names(JSON.parse(browser.store.value)), 'A,B');
});

it('leaves every tab on the stored catalog when both change it before hearing from the other', () => {
  const browser = openTabs(config([saved('a', 'A')]));
  const [first, second] = browser.tabs;

  browser.change(first, addModel(saved('b', 'B')));
  browser.change(second, addModel(saved('c', 'C')));
  browser.settle();

  // `first`'s event reaches `second` after `second` has written its own catalog over it.
  // Adopting the event's value instead of the stored one would leave the tabs disagreeing.
  const stored = names(JSON.parse(browser.store.value));
  assert.equal(names(first.config), stored);
  assert.equal(names(second.config), stored);
});

it('is wired into App that way', () => {
  const app = fs.readFileSync(path.join(repoRoot, 'apps', 'studio', 'src', 'app', 'App.tsx'), 'utf8');
  assert.match(
    app,
    /if \(tabCatalogSync\.isFromOtherTab\(modelConfig\)\) return;\s*try \{ localStorage\.setItem\(MODEL_CONFIG_STORAGE_KEY/,
  );
  assert.match(
    app,
    /const stored = localStorage\.getItem\(MODEL_CONFIG_STORAGE_KEY\);\s*setModelConfig\(\(current: any\) => tabCatalogSync\.adoptStored\(current, stored\)\);/,
  );
});
