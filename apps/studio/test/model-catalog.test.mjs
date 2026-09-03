import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const catalog = await importTs(path.join(repoRoot, 'platform', 'core', 'src', 'model-catalog.ts'));
const storage = await importTs(path.join(repoRoot, 'apps', 'studio', 'src', 'app', 'model-catalog-storage.ts'));

/*
 * The offered-model roster and its pricing table, which several assertions below
 * read as source text. Named once because it moves: it lived inside
 * `SettingsModal.tsx` and `ModelsTab.tsx` until the standalone Models & API page
 * needed the same roster and it became a module both surfaces import.
 */
const CATALOG_SOURCE = path.join(repoRoot, 'apps', 'studio', 'src', 'settings', 'provider-models.ts');

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

it('offers GLM 5.3 with Zhipu AI\'s supported effort roster', () => {
  const settings = fs.readFileSync(path.join(repoRoot, 'apps', 'studio', 'src', 'settings', 'tabs', 'ModelsTab.tsx'), 'utf8');
  const chat = fs.readFileSync(path.join(repoRoot, 'platform', 'ai', 'src', 'chat.ts'), 'utf8');
  assert.match(settings, /id: 'glm-5\.3', name: 'GLM 5\.3'/);
  assert.match(settings, /level: 1, label: 'Low', value: 'low'/);
  assert.match(settings, /level: 2, label: 'High', value: 'high'/);
  assert.match(settings, /level: 3, label: 'Max', value: 'max'/);
  assert.match(settings, /modelId === 'glm-5\.3'/);
  assert.match(chat, /provider === 'zhipuai' && model === 'glm-5\.3'/);
  assert.match(chat, /thinking: \{ type: 'enabled' \}/);
});

/*
 * The Flash releases that start at Low rather than Minimal.
 *
 * Three places have to agree or the picker offers an effort the request cannot
 * send: the settings catalogue (`hasNone: false`), the effort picker, and the
 * clamp in chat.ts. The last two now read one exported list instead of matching
 * a hardcoded id, so this asserts membership rather than the old literals.
 */
/*
 * Every model the settings UI offers must have an explicit pricing entry.
 *
 * `getModelPricing` used to fall back to a provider-typical token pair, so a
 * model added to the catalogue without a price silently rendered a plausible
 * wrong number — which is how all three GPT-5.6 models came to be labelled
 * $2.50/$10.00. The fallback is now an empty string, and this asserts the
 * catalogue is covered so the empty case only ever means "custom model".
 *
 * A deliberately blank entry is allowed: a model the provider has announced but
 * not priced is a real state, and blank shows the category badge alone.
 */
it('prices every model the catalogue offers', async () => {
  const models = await importTs(CATALOG_SOURCE);
  const catalogSource = fs.readFileSync(CATALOG_SOURCE, 'utf8');

  for (const [provider, options] of Object.entries(models.PROVIDER_MODEL_OPTIONS)) {
    for (const option of options) {
      assert.ok(
        new RegExp(`'${option.id.replace(/\./g, '\\.')}':`).test(catalogSource),
        `${provider} model ${option.id} has no entry in MODEL_PRICES`,
      );
    }
  }

  // An unknown id gets nothing, never a guess.
  assert.equal(models.getModelPricing('some-custom-model'), '');
  assert.equal(models.getModelPricing('gpt-5.6-sol'), '$4.00/$20.00');
  // Per-generation models carry their real unit, not an invented token pair.
  assert.equal(models.getModelPricing('veo-3.1'), '$0.40/video');
  assert.equal(models.getModelPricing('lyria-3'), '$0.04/clip');
  assert.equal(models.getModelPricing('grok-voice'), '$0.08/min');
});

it('starts Gemini 3.7 and 3.8 Flash at Low, with no Minimal effort', async () => {
  const catalogSource = fs.readFileSync(CATALOG_SOURCE, 'utf8');
  const chat = fs.readFileSync(path.join(repoRoot, 'platform', 'ai', 'src', 'chat.ts'), 'utf8');
  const efforts = await importTs(path.join(repoRoot, 'platform', 'ai', 'src', 'models', 'efforts.ts'));

  for (const id of ['gemini-3.7-flash', 'gemini-3.8-flash']) {
    assert.match(catalogSource, new RegExp(`id: '${id.replace('.', '\\.')}',[\\s\\S]{0,160}?hasNone: false`));
    assert.ok(efforts.GEMINI_FLASH_WITHOUT_MINIMAL.includes(id));
    assert.equal(efforts.geminiFlashStartsAtLow(id), true);
    assert.equal(efforts.modelSupportsNoThinking({ provider: 'gemini', modelId: id, name: id }), false);
  }
  // Other Flash generations keep their level-0 `minimal` mapping.
  assert.equal(efforts.geminiFlashStartsAtLow('gemini-3.6-flash'), false);
  assert.equal(efforts.modelSupportsNoThinking({ provider: 'gemini', modelId: 'gemini-3.6-flash' }), true);
  // And the request layer floors them off the same list.
  assert.match(chat, /geminiFlashStartsAtLow\(model\) && options\.thinkingLevel === 0/);
});

it('offers Gemma 4 models with Minimal and High reasoning efforts', () => {
  const catalogSource = fs.readFileSync(CATALOG_SOURCE, 'utf8');
  const modelsTab = fs.readFileSync(path.join(repoRoot, 'apps', 'studio', 'src', 'settings', 'tabs', 'ModelsTab.tsx'), 'utf8');
  const chat = fs.readFileSync(path.join(repoRoot, 'platform', 'ai', 'src', 'chat.ts'), 'utf8');
  for (const [id, name] of [
    ['gemma-4-26b-a4b-it', 'Gemma 4 26B A4B IT'],
    ['gemma-4-31b-it', 'Gemma 4 31B IT'],
  ]) {
    assert.match(catalogSource, new RegExp(`id: '${id}',\\s*name: '${name}',[\\s\\S]{0,180}?maxLevels: 1,[\\s\\S]{0,100}?noneLabel: 'Minimal',[\\s\\S]{0,100}?levelLabels: \\{ 1: 'High' \\}`));
  }
  assert.match(modelsTab, /thinkingLevel: selectedModel\.maxLevels/);
  assert.match(modelsTab, /selectedModel\.reasoningEfforts/);
  assert.match(chat, /model\.startsWith\('gemma-4-'\)/);
  assert.match(chat, /0: 'minimal', 1: 'high'/);
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

it('offers Gemini 3.5 Transcribe models for voice transcription and keeps them out of chat', () => {
  const catalogSource = fs.readFileSync(CATALOG_SOURCE, 'utf8');
  const transcriptionSource = fs.readFileSync(path.join(repoRoot, 'platform', 'ai', 'src', 'transcription.ts'), 'utf8');
  assert.match(catalogSource, /id:\s*'gemini-3\.5-transcribe',[\s\S]{0,180}?name:\s*'Gemini 3\.5 Transcribe'/);
  assert.match(catalogSource, /id:\s*'gemini-3\.5-transcribe-live',[\s\S]{0,180}?name:\s*'Gemini 3\.5 Transcribe Live'/);
  // Google's published audio-in / text-out rates for the two transcribe SKUs.
  assert.match(catalogSource, /'gemini-3\.5-transcribe':\s*'\$2\.50\/\$12\.00'/);
  assert.match(catalogSource, /'gemini-3\.5-transcribe-live':\s*'\$3\.50\/\$21\.00'/);
  assert.match(transcriptionSource, /v1beta\/interactions/);
  assert.match(transcriptionSource, /extractInteractionTranscript/);
  assert.equal(catalog.isChatCapableModel({ id: 'transcribe', modelId: 'gemini-3.5-transcribe', name: 'Gemini 3.5 Transcribe' }), false);
  assert.equal(catalog.isChatCapableModel({ id: 'transcribe-live', modelId: 'gemini-3.5-transcribe-live', name: 'Gemini 3.5 Transcribe Live' }), false);
  assert.equal(catalog.getModelCategory({ id: 'transcribe', modelId: 'gemini-3.5-transcribe', name: 'Gemini 3.5 Transcribe' }), 'audio');
  assert.equal(catalog.getModelCategory({ id: 'transcribe-live', modelId: 'gemini-3.5-transcribe-live', name: 'Gemini 3.5 Transcribe Live' }), 'audio');
});
