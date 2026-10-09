/**
 * What Media offers to generate with.
 *
 * The selector used to start on Nano Banana Pro, Omni Flash and Lyria 3 Pro whether or not
 * the user had added them, sent Veo 3.1 Lite to a shut-down Veo 3.0 model, and let Veo
 * requests ask for 10 seconds, which Veo rejects. These run the rules that replaced that.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { importTs } from './ts-module.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (relative) => fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');

const models = await importTs(path.join(REPO_ROOT, 'features/media/src/media-models.ts'));
const catalog = await importTs(path.join(REPO_ROOT, 'platform/core/src/model-catalog.ts'));
const storage = await importTs(path.join(REPO_ROOT, 'apps/studio/src/app/model-catalog-storage.ts'));

const saved = (modelId, name) => ({ id: `rec-${modelId}`, modelId, name });
const configWith = (...gemini) => ({ gemini: { savedModels: gemini }, modelOrder: [] });

test('a fresh config offers no media models at all', () => {
  const lists = models.mediaModelLists(configWith(saved('gemini-3.7-flash', 'Gemini 3.7 Flash')));
  assert.deepEqual(lists, { image: [], video: [], music: [] });
  assert.equal(models.resolveModelPick('gemini-3-pro-image', lists.image), '');
});

test('lists hold only what was added, under live ids, with no voice model in music', () => {
  const lists = models.mediaModelLists(configWith(
    saved('veo-3.1-fast', 'Veo 3.1 Fast'),
    saved('gemini-3.1-flash-image-preview', 'Nano Banana 2'),
    saved('lyria-3-pro', 'Lyria 3 Pro'),
    saved('omni-flash', 'Gemini Omni Flash 1'),
    saved('gemini-3.7-flash', 'Gemini 3.7 Flash'),
  ));
  assert.deepEqual(lists.image, [{ id: 'gemini-nano-banana-2.1', name: 'Nano Banana 2.1' }]);
  assert.deepEqual(lists.video, [
    { id: 'veo-3.1-fast', name: 'Veo 3.1 Fast', apiId: 'veo-3.1-fast-generate-preview' },
    { id: 'omni-flash', name: 'Gemini Omni Flash 1', apiId: 'gemini-omni-flash-preview' },
  ]);
  assert.deepEqual(lists.music, [{ id: 'lyria-3-pro', name: 'Lyria 3 Pro' }]);

  const withVoice = models.mediaModelLists({ spacexai: { savedModels: [saved('grok-voice', 'Grok Voice')] } });
  assert.deepEqual(withVoice.music, []);
});

test('a remembered pick holds while it is added, and falls back to the first added model', () => {
  const image = [{ id: 'gemini-nano-banana-2.1', name: 'Nano Banana 2.1' }, { id: 'gemini-3-pro-image', name: 'Nano Banana Pro' }];
  assert.equal(models.resolveModelPick('gemini-3-pro-image', image), 'gemini-3-pro-image');
  assert.equal(models.resolveModelPick('gemini-3-pro-image-preview', image), 'gemini-3-pro-image');
  assert.equal(models.resolveModelPick('gemini-3.1-flash-image', image), 'gemini-nano-banana-2.1');
  assert.equal(models.resolveModelPick('grok-imagine', image), 'gemini-nano-banana-2.1');
  assert.equal(models.resolveModelPick('', image), 'gemini-nano-banana-2.1');
});

test('Veo 3.1 Lite is requested as itself, not as the shut-down Veo 3.0 Fast', () => {
  assert.equal(models.videoApiModelId('veo-3.1-lite'), 'veo-3.1-lite-generate-preview');
  assert.equal(models.videoApiModelId('some-custom-video-model'), 'some-custom-video-model');
  assert.ok(!read('features/media/src/MediaView.tsx').includes('veo-3.0-fast-generate-001'));
});

test('Veo is never asked for a length it rejects', () => {
  assert.deepEqual(models.videoDurationOptions('veo-3.1-fast'), ['4s', '6s', '8s']);
  assert.deepEqual(models.videoDurationOptions('omni-flash-1.1'), ['4s', '6s', '8s', '10s']);
  assert.equal(models.fitVideoDuration('veo-3.1', '10s'), '8s');
  assert.equal(models.fitVideoDuration('veo-3.1', '5s'), '4s');
  assert.equal(models.fitVideoDuration('veo-3.1', '2s'), '4s');
  assert.equal(models.fitVideoDuration('omni-flash', '10s'), '10s');
});

test('retired ids are rewritten in saved models and in synced catalogs, without duplicates', () => {
  assert.equal(catalog.liveModelId('gemini-3-pro-image-preview'), 'gemini-3-pro-image');
  assert.equal(catalog.liveModelId('gemini-3.1-flash-image'), 'gemini-nano-banana-2.1');
  assert.equal(catalog.liveModelId('gemini-3.8-flash'), 'gemini-3.8-flash');
  const migrated = catalog.migrateRetiredSavedModels([
    saved('gemini-3-pro-image-preview', 'Nano Banana Pro'),
    saved('gemini-3-pro-image', 'Nano Banana Pro'),
  ]);
  assert.deepEqual(migrated.map((m) => m.modelId), ['gemini-3-pro-image']);

  const merged = storage.mergeModelCatalogSnapshot({}, storage.extractModelCatalogSnapshot(
    configWith(saved('gemini-3.1-flash-image-preview', 'Nano Banana 2')),
  ));
  assert.deepEqual(
    merged.gemini.savedModels.map((m) => [m.modelId, m.name]),
    [['gemini-nano-banana-2.1', 'Nano Banana 2.1']],
  );
});

test('the Flash models taken out of Settings move onto 3.8 Flash, keeping what the user set', () => {
  const record = (id, modelId, name, extra = {}) => ({ id, modelId, name, thinkingLevel: 3, ...extra });
  // The old defaults: 3.7 and 3.6 Flash become one 3.8 Flash, the first one's record.
  const defaults = [
    record('default-flash-37', 'gemini-3.7-flash', 'Gemini 3.7 Flash'),
    record('default-flash-36', 'gemini-3.6-flash', 'Gemini 3.6 Flash'),
    record('default-flash-35-lite', 'gemini-3.5-flash-lite', 'Gemini 3.5 Flash Lite', { thinkingLevel: 1 }),
  ];
  const fromDefaults = catalog.migrateRetiredSavedModels(defaults);
  assert.deepEqual(
    fromDefaults.map((m) => [m.id, m.modelId, m.name]),
    [
      ['default-flash-37', 'gemini-3.8-flash', 'Gemini 3.8 Flash'],
      ['default-flash-35-lite', 'gemini-3.5-flash-lite', 'Gemini 3.5 Flash Lite'],
    ],
  );

  // A 3.8 Flash already added wins over one moved onto it, wherever it sits in the list.
  const withNewer = catalog.migrateRetiredSavedModels([
    record('mine-35', 'gemini-3.5-flash', 'Fast drafts', { thinkingLevel: 0 }),
    record('mine-38', 'gemini-3.8-flash', 'Gemini 3.8 Flash', { thinkingLevel: 2 }),
  ]);
  assert.deepEqual(withNewer.map((m) => [m.id, m.thinkingLevel]), [['mine-38', 2]]);

  // A name the user gave stays.
  assert.equal(
    catalog.liveSavedModel(record('mine', 'gemini-3.6-flash', 'Daily driver')).name,
    'Daily driver',
  );

  // A selection on a record dropped as a duplicate moves to the one kept, effort and all.
  assert.equal(catalog.migrateSelectedModelId('default-flash-36', defaults, fromDefaults), 'default-flash-37');
  assert.equal(catalog.migrateSelectedModelId('default-flash-36::effort-1', defaults, fromDefaults), 'default-flash-37::effort-1');
  assert.equal(catalog.migrateSelectedModelId('default-flash-37', defaults, fromDefaults), 'default-flash-37');
  assert.equal(catalog.migrateSelectedModelId('gone', defaults, fromDefaults), 'gone');
  assert.equal(catalog.migrateSelectedModelId('', defaults, fromDefaults), '');
});

test('new installs start on 3.8 Flash, and Settings offers Nano Banana 2.1 in place of Nano Banana 2', async () => {
  const app = read('apps/studio/src/app/App.tsx');
  const defaults = app.slice(app.indexOf('const DEFAULT_MODEL_CONFIG'), app.indexOf('openai: {', app.indexOf('const DEFAULT_MODEL_CONFIG')));
  assert.match(defaults, /model: 'gemini-3\.8-flash'/);
  assert.match(defaults, /modelId: 'gemini-3\.8-flash'/);
  assert.ok(!/gemini-3\.[567]-flash'/.test(defaults), 'a new install still starts with a Flash model Settings no longer offers');

  const providerModels = await importTs(path.join(REPO_ROOT, 'apps/studio/src/settings/provider-models.ts'));
  const google = providerModels.GEMINI_MODELS.map((m) => m.id);
  assert.ok(google.includes('gemini-nano-banana-2.1'));
  for (const removed of ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-image']) {
    assert.ok(!google.includes(removed), `${removed} is still offered`);
  }
  assert.equal(providerModels.getModelPricing('gemini-nano-banana-2.1'), '$0.034/image');
});

test('Settings no longer hands out a retired id', () => {
  const providerModels = read('apps/studio/src/settings/provider-models.ts');
  for (const retired of Object.keys(catalog.RETIRED_MODEL_IDS)) {
    assert.ok(!providerModels.includes(`'${retired}'`), `${retired} is still offered in Settings`);
  }
});

test('helper calls use live models and no third-party image service', () => {
  assert.ok(!read('features/media/src/MediaView.tsx').includes('gemini-1.5-flash'), 'tile naming still calls Gemini 1.5 Flash');
  const music = read('features/media/src/music/MusicView.tsx');
  assert.ok(!/pollinations|imagen-3/.test(music), 'song covers still use Imagen 3 or pollinations.ai');
  assert.ok(!music.includes('alert('), 'a failed song still raises a native alert');
});

test('the Media route mounts its own settings window', () => {
  const app = read('apps/studio/src/app/App.tsx');
  const start = app.indexOf('<Route path="/media/*"');
  assert.ok(start !== -1, 'no /media route');
  const end = app.indexOf('<Route path=', start + 1);
  const mediaRoute = app.slice(start, end === -1 ? undefined : end);
  assert.ok(mediaRoute.includes('<SettingsModal'), "More settings in Media opens nothing until you leave");
});
