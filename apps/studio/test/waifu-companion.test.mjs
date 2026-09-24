import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import { importTs } from './ts-module.mjs';

const appDir = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(appDir, '..', '..');

describe('Waifu AI companion integration', () => {
  it('exports curated Live2D models with valid URLs and default model', async () => {
    const modelsModule = await importTs(
      path.join(repoRoot, 'apps', 'studio', 'src', 'waifu', 'waifu-models.ts'),
    );

    assert.ok(Array.isArray(modelsModule.WAIFU_MODELS));
    assert.ok(modelsModule.WAIFU_MODELS.length >= 10, 'Expected at least 10 curated Live2D models');
    assert.ok(modelsModule.DEFAULT_MODEL, 'Default model should exist');
    assert.equal(modelsModule.DEFAULT_MODEL.name, 'Hiyori');
    assert.ok(modelsModule.DEFAULT_MODEL.fallbackUrl, 'Default model should have a fallbackUrl');

    for (const model of modelsModule.WAIFU_MODELS) {
      assert.ok(model.id, 'Model should have id');
      assert.ok(model.name, 'Model should have name');
      assert.ok(model.url.endsWith('.model3.json'), `Model ${model.name} url must be a .model3.json`);
    }
  });

  it('exports companion personas including Ani and extractEmotion logic', async () => {
    const personasModule = await importTs(
      path.join(repoRoot, 'apps', 'studio', 'src', 'waifu', 'waifu-personas.ts'),
    );

    assert.ok(Array.isArray(personasModule.WAIFU_PERSONAS));
    const ani = personasModule.WAIFU_PERSONAS.find((p) => p.id === 'ani');
    assert.ok(ani, 'Ani persona must be present');
    assert.equal(ani.name, 'Ani');
    assert.ok(ani.systemPrompt.length > 50);

    // Emotion extraction
    assert.equal(personasModule.extractEmotion('I am so happy and smiling! ✨'), 'happy');
    assert.equal(personasModule.extractEmotion('What?! I did not expect that!'), 'surprised');
    assert.equal(personasModule.extractEmotion('I feel sad and want to cry...'), 'sad');
    assert.equal(personasModule.extractEmotion('Let me think and wonder about that'), 'thoughtful');
  });

  it('resolves live models for Waifu Model system default', async () => {
    const engineModule = await importTs(
      path.join(repoRoot, 'apps', 'studio', 'src', 'waifu', 'waifu-engine.ts'),
    );

    const liveTarget = engineModule.resolveWaifuModelTarget(
      'gemini-3.8-live',
      {},
      { gemini: { apiKey: 'test-key' } }
    );
    assert.equal(liveTarget.isLive, true);
    assert.equal(liveTarget.provider, 'gemini');
    assert.equal(liveTarget.apiKey, 'test-key');
  });

  it('exports Live2D frequency-based lip-sync pipeline and voice defaults', async () => {
    const audioModule = await importTs(
      path.join(repoRoot, 'apps', 'studio', 'src', 'waifu', 'waifu-audio.ts'),
    );

    assert.equal(typeof audioModule.registerLipSyncTarget, 'function');
    assert.equal(typeof audioModule.startLipSyncFromAnalyser, 'function');
    assert.equal(typeof audioModule.stopLipSync, 'function');
    assert.equal(typeof audioModule.speakWithLipSync, 'function');
    assert.equal(typeof audioModule.stopSpeaking, 'function');

    const storeModule = await importTs(
      path.join(repoRoot, 'apps', 'studio', 'src', 'waifu', 'waifu-store.ts'),
    );
    const settings = storeModule.waifuSettingsStore.get();
    assert.equal(settings.liveVoice, 'Aoede', 'Default live voice should be Aoede');
  });

  it('GeminiLiveSession supports sendText and audio output analyser for live models', async () => {
    const liveModule = await importTs(
      path.join(repoRoot, 'platform', 'ai', 'src', 'live.ts'),
    );

    assert.ok(liveModule.GeminiLiveSession);
    const proto = liveModule.GeminiLiveSession.prototype;
    assert.equal(typeof proto.sendText, 'function', 'GeminiLiveSession must have sendText');
    assert.equal(typeof proto.start, 'function');
    assert.equal(typeof proto.interrupt, 'function');
    assert.ok(Object.getOwnPropertyDescriptor(proto, 'hasMic')?.get, 'GeminiLiveSession should have hasMic getter');
  });

  it('drives mouth target smoothly via registerLipSyncTarget and cleans up', async () => {
    const audioModule = await importTs(
      path.join(repoRoot, 'apps', 'studio', 'src', 'waifu', 'waifu-audio.ts'),
    );

    let lastOpenY = -1;
    let lastForm = -1;
    audioModule.registerLipSyncTarget({
      setMouth: (openY, form) => {
        lastOpenY = openY;
        lastForm = form;
      },
    });

    audioModule.stopLipSync();
    assert.equal(lastOpenY, 0);
    assert.equal(lastForm, 0);

    // Mock AnalyserNode
    const mockAnalyser = {
      fftSize: 1024,
      frequencyBinCount: 512,
      getFloatTimeDomainData: (arr) => { arr.fill(0.05); },
      getByteFrequencyData: (arr) => { arr.fill(40); },
    };
    const cleanup = audioModule.startLipSyncFromAnalyser(mockAnalyser);
    assert.equal(typeof cleanup, 'function', 'startLipSyncFromAnalyser should return cleanup function');
    assert.equal(audioModule.isLipSyncActive(), true, 'Lip sync should be active');

    // Follow-up turns: stopSpeaking() should not kill active Live analyser tap
    audioModule.stopSpeaking();
    assert.equal(audioModule.isLipSyncActive(), true, 'stopSpeaking should preserve active live analyser');

    // Subsequent call to startLipSyncFromAnalyser reuses active analyser
    const cleanup2 = audioModule.startLipSyncFromAnalyser(mockAnalyser);
    assert.equal(audioModule.isLipSyncActive(), true);

    cleanup2();
    assert.equal(audioModule.isLipSyncActive(), false, 'Cleanup should deactivate lip sync');
    assert.equal(lastOpenY, 0);
    assert.equal(lastForm, 0);

    audioModule.registerLipSyncTarget(null);
  });
});

