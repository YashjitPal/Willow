/**
 * The composer's model pill while a live session is up: it lists voice models
 * instead of text ones, and edits a separate selection.
 *
 * The registry half runs for real through `importTs`, because `listVoiceModels`
 * derives its roster from `VOICE_PROVIDERS` and the thing worth testing is that
 * the derivation holds when a provider is added — which a text assertion cannot
 * show. The wiring half reads `Composer.tsx` and `ModelsMenu.tsx` as text, the
 * convention here, since a React tree is not what is under test.
 *
 * The menu is read from `@willow/ui`, not from Chat: it takes its roster as a
 * prop and holds no chat state, so it moved to `platform/ui/src/models/` when the
 * Chat/Code edge was cut. The voice roster it renders is still Chat's.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, before } from 'node:test';

import { importTs } from './ts-module.mjs';

const read = (relative) =>
  fs.readFileSync(path.resolve(import.meta.dirname, '../../..', relative), 'utf8');

const composer = read('features/chat/src/composer/Composer.tsx');
const menu = read('platform/ui/src/models/ModelsMenu.tsx');

describe('voice model registry', () => {
  let registry;

  before(async () => {
    registry = await importTs(
      path.resolve(
        import.meta.dirname,
        '../../../features/chat/src/voice-settings/voice-providers.ts',
      ),
    );
  });

  it('lists every provider model, tagged with its provider', () => {
    const listed = registry.listVoiceModels();
    assert.ok(listed.length > 0, 'roster is empty');

    const expected = registry.VOICE_PROVIDERS.flatMap((p) =>
      p.models.map((m) => ({ id: m.id, name: m.name, providerId: p.id, providerLabel: p.label })),
    );
    assert.deepEqual(listed, expected);
    // Provider order is registry order, so the picker is stable across renders.
    assert.deepEqual(
      listed.map((m) => m.providerId),
      expected.map((m) => m.providerId),
    );
  });

  it('lists the id live mode actually opens a socket with', async () => {
    const { LIVE_MODEL_ID } = await importTs(
      path.resolve(import.meta.dirname, '../../../platform/ai/src/live.ts'),
    );
    assert.ok(
      registry.listVoiceModels().some((m) => m.id === LIVE_MODEL_ID),
      'the default live model is missing from the picker roster',
    );
  });

  it('every listed model is claimed by the provider that lists it', () => {
    for (const model of registry.listVoiceModels()) {
      const provider = registry.findVoiceProvider(model.id);
      assert.ok(provider, `no provider matches ${model.id}`);
      // `matches` classifies and `models` enumerates; a model that appears in one
      // but fails the other would render in the picker and then find no voices.
      assert.equal(provider.id, model.providerId);
    }
  });

  it('falls back rather than putting an unrunnable id on the wire', () => {
    const first = registry.listVoiceModels()[0].id;
    assert.equal(registry.resolveVoiceModelId(undefined), first);
    assert.equal(registry.resolveVoiceModelId('models/left-over-from-an-old-build'), first);
    assert.equal(registry.resolveVoiceModelId(first), first);
  });
});

describe('composer pill in live mode', () => {
  it('switches to the voice roster only while live', () => {
    assert.match(
      composer,
      /const showVoiceModels = chatVariant && liveActive && voiceModels\.length > 0;/,
    );
    // From the registry, not the user's saved models: a live model can be absent
    // from Settings -> Models and still be the one voice mode runs.
    assert.match(composer, /const voiceModels = useMemo\(\(\) => listVoiceModels\(\), \[\]\);/);
  });

  it('edits the live selection, leaving the text model untouched', () => {
    assert.match(composer, /const liveModelId = useStore\(liveModelStore\);/);
    // Two separate stores, so leaving voice mode restores the typed-message model
    // exactly as the user left it.
    assert.match(composer, /liveModelStore/);
    assert.match(composer, /selectedModelId/);
  });

  it('guards a stored id that no longer exists', () => {
    assert.match(
      composer,
      /voiceModels\.find\(\(m\) => m\.id === liveModelId\) \|\| voiceModels\[0\]/,
    );
  });

  it('shortens the voice label the same way as a text model', () => {
    assert.match(composer, /getShortName\(liveModel\?\.name \|\| ''\)/);
  });

  it('drops the effort segment, which a live model has no levels for', () => {
    assert.match(composer, /const pillEffortLabel = showVoiceModels \? '' : activeEffortDisplayLabel;/);
  });
});

describe('models menu with a voice roster', () => {
  it('takes the roster as an optional prop, so text mode is unchanged', () => {
    assert.match(menu, /voiceModels\?:/);
    assert.match(menu, /const isVoiceRoster = /);
  });

  it('hides the effort rows for voice models', () => {
    assert.match(menu, /selectedEfforts = isVoiceRoster \? \[\] :/);
  });
});
