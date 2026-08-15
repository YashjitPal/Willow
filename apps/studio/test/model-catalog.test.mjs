import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const catalog = await importTs(path.join(repoRoot, 'platform', 'core', 'src', 'model-catalog.ts'));
const storage = await importTs(path.join(repoRoot, 'apps', 'studio', 'src', 'app', 'model-catalog-storage.ts'));

const model = (providerId, id, modelId, name, extra = {}) => ({
  id,
  modelId,
  name,
  thinkingLevel: 1,
  ...extra,
  providerId,
});

it('orders the catalog from the persisted modelOrder and appends new models', () => {
  const config = {
    modelOrder: ['openai:b', 'gemini:a'],
    gemini: { savedModels: [model('gemini', 'a', 'gemini-a', 'Gemini A')] },
    openai: { savedModels: [model('openai', 'b', 'gpt-b', 'GPT B'), model('openai', 'c', 'gpt-c', 'GPT C')] },
  };
  assert.deepEqual(
    catalog.collectSavedModelsInCatalogOrder(config).map((entry) => entry.id),
    ['b', 'a', 'c'],
  );
});

it('keeps embedding and image models out of the text catalog', () => {
  assert.equal(catalog.isChatCapableModel({ id: 'embedding', modelId: 'gemini-embedding-2', name: 'Gemini Embedding 2' }), false);
  assert.equal(catalog.isChatCapableModel({ id: 'image', modelId: 'gpt-image-2', name: 'GPT Image 2' }), false);
  assert.equal(catalog.isChatCapableModel({ id: 'chat', modelId: 'gpt-5.6-sol', name: 'GPT 5.6' }), true);
  assert.equal(catalog.getModelCategory({ id: 'embedding', modelId: 'gemini-embedding-2', name: 'Gemini Embedding 2' }), 'embedding');
  assert.equal(catalog.getModelCategory({ id: 'image', modelId: 'gpt-image-2', name: 'GPT Image 2' }), 'image');
});

it('extracts only catalog metadata for disk sync and preserves secrets when merging it back', () => {
  const current = {
    gemini: { apiKey: 'must-stay-in-browser', savedModels: [model('gemini', 'old', 'old', 'Old')] },
    openai: { savedModels: [] },
    anthropic: { savedModels: [] },
    moonshot: { savedModels: [] },
    spacexai: { savedModels: [] },
    zhipuai: { savedModels: [] },
    modelOrder: [],
  };
  const snapshot = storage.extractModelCatalogSnapshot({
    ...current,
    gemini: { ...current.gemini, savedModels: [model('gemini', 'new', 'new', 'New')] },
    modelOrder: ['gemini:new'],
  });
  assert.equal(JSON.stringify(snapshot).includes('must-stay-in-browser'), false);
  const merged = storage.mergeModelCatalogSnapshot(current, snapshot);
  assert.equal(merged.gemini.apiKey, 'must-stay-in-browser');
  assert.deepEqual(merged.gemini.savedModels.map((entry) => entry.id), ['new']);
  assert.deepEqual(merged.modelOrder, ['gemini:new']);
});

it('registers the catalog as Models/catalog.json', async () => {
  const source = fs.readFileSync(path.join(repoRoot, 'apps', 'studio', 'src', 'app', 'register-model-catalog.ts'), 'utf8');
  assert.match(source, /registerSyncedFolder\('model-catalog'/);
  assert.match(source, /folder:\s*'Models'/);
  assert.match(source, /id:\s*'catalog'/);
});

it('keeps the custom editor collapsed below normal model adding and exposes drag ordering', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'apps', 'studio', 'src', 'settings', 'tabs', 'ModelsTab.tsx'), 'utf8');
  const normalAdd = source.indexOf('Add to Models');
  const customAdd = source.indexOf('aria-expanded={customModelExpanded}');
  const catalogList = source.indexOf('Unified Global Models List');
  assert.ok(normalAdd >= 0 && customAdd > normalAdd && catalogList > customAdd);
  assert.match(source, /draggable/);
  assert.match(source, /GripVertical/);
  assert.match(source, /reorderCatalogModel/);
});

it('uses the shared ordered text catalog in Chat, Workbench, and the model menu', () => {
  const menu = fs.readFileSync(path.join(repoRoot, 'platform', 'ui', 'src', 'models', 'ModelsMenu.tsx'), 'utf8');
  const chat = fs.readFileSync(path.join(repoRoot, 'features', 'chat', 'src', 'composer', 'use-composer-models.ts'), 'utf8');
  const code = fs.readFileSync(path.join(repoRoot, 'features', 'code', 'src', 'workbench', 'model-labels.ts'), 'utf8');
  for (const source of [menu, chat, code]) {
    assert.match(source, /collectSavedModelsInCatalogOrder/);
    assert.match(source, /isChatCapableModel/);
  }
});

it('uses the same order for Media while routing image models there', () => {
  const media = fs.readFileSync(path.join(repoRoot, 'features', 'media', 'src', 'MediaView.tsx'), 'utf8');
  assert.match(media, /collectSavedModelsInCatalogOrder\(parsed\)/);
  assert.match(media, /getModelCategory\(model\) === 'image'/);
  assert.match(media, /getModelCategory\(model\) === 'video'/);
});
