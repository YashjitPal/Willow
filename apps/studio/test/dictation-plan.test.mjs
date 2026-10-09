import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const at = (...parts) => path.join(repoRoot, ...parts);
const read = (...parts) => fs.readFileSync(at(...parts), 'utf8');

const transcription = await importTs(at('platform', 'ai', 'src', 'transcription.ts'));
const { planDictation } = await importTs(at('platform', 'ai', 'src', 'dictation', 'dictation-session.ts'));
const onDevice = await importTs(at('platform', 'ai', 'src', 'dictation', 'on-device-transcription.ts'));

const BROWSER = { browserRecognizer: true };
const NO_RECOGNIZER = { browserRecognizer: false };
const steps = (plan) => plan.steps.map((step) => (step.kind === 'model' ? `${step.candidate.provider}:${step.candidate.modelId}` : 'on-device'));
const withTranscription = (transcriptionModel, extra = {}) => ({ systemDefaults: { transcription: transcriptionModel }, ...extra });

describe('which models can transcribe a recording', () => {
  const { transcriptionRoute, canTranscribeAudio } = transcription;

  it('sends Gemini models that read input as Gemini audio', () => {
    for (const id of ['gemini-3.5-flash-lite', 'gemini-3-pro', 'gemini-3.5-transcribe']) {
      assert.equal(transcriptionRoute('gemini', id), 'gemini', id);
    }
    for (const id of ['gemini-3.5-transcribe-live', 'gemini-2.5-flash-preview-tts', 'gemini-2.5-flash-image', 'imagen-4', 'veo-3', 'gemini-embedding-001', 'gemini-live-2.5-flash']) {
      assert.equal(transcriptionRoute('gemini', id), null, id);
    }
  });

  it("sends OpenAI's transcription models to /audio/transcriptions and its audio chat models to chat", () => {
    assert.equal(transcriptionRoute('openai', 'whisper-1'), 'openai-transcription');
    assert.equal(transcriptionRoute('openai', 'gpt-4o-mini-transcribe'), 'openai-transcription');
    assert.equal(transcriptionRoute('openai', 'gpt-4o-audio-preview'), 'openai-chat-audio');
    assert.equal(transcriptionRoute('openai', 'gpt-audio'), 'openai-chat-audio');
    assert.equal(transcriptionRoute('openai', 'gpt-5'), null);
    assert.equal(transcriptionRoute('openai', 'gpt-4o-mini-tts'), null);
  });

  it('keeps chat models with no audio input, and the no-key options, out', () => {
    assert.equal(canTranscribeAudio('anthropic', 'claude-sonnet-4-5'), false);
    assert.equal(canTranscribeAudio('spacexai', 'grok-4'), false);
    assert.equal(canTranscribeAudio('openai', 'chrome-native'), false);
    assert.equal(canTranscribeAudio('openai', 'on-device-whisper'), false);
  });

  it("finds a model's key in its profile's own bucket", () => {
    const modelConfig = {
      profiles: [{ id: 'work-gemini', transportProvider: 'gemini', enabled: true, apiKeyId: 'work' }],
      gemini: { savedModels: [{ id: 'g3', modelId: 'gemini-3-flash', name: 'Gemini 3 Flash', profileId: 'work-gemini' }] },
      systemDefaults: { transcription: 'gemini-3-flash' },
    };
    const selected = transcription.selectedTranscriptionCandidate(modelConfig);
    assert.deepEqual(transcription.transcriptionKeys(modelConfig, { work: [' K1 '] }, selected), ['K1']);
    assert.deepEqual(transcription.transcriptionKeys(modelConfig, { gemini: ['K2'] }, selected), ['K2']);
    assert.deepEqual(transcription.transcriptionKeys(modelConfig, {}, selected), []);
  });
});

describe('the route and fallbacks for one take', () => {
  it('listens with the browser by default, and falls back to this device when nothing is keyed', () => {
    const plan = planDictation(withTranscription('chrome-native'), {}, BROWSER);
    assert.equal(plan.first, 'browser');
    assert.deepEqual(steps(plan), ['on-device']);
    assert.equal(plan.unusableSelection, undefined);
  });

  it('records on its own where the browser has no recognizer (Firefox, the desktop app)', () => {
    const plan = planDictation(withTranscription('chrome-native'), {}, NO_RECOGNIZER);
    assert.equal(plan.first, 'record');
    assert.deepEqual(steps(plan), ['on-device']);
  });

  it('treats no choice at all as the browser', () => {
    assert.equal(planDictation({}, {}, BROWSER).first, 'browser');
  });

  it('lets a keyed model transcribe what the browser could not, before this device', () => {
    const plan = planDictation(withTranscription('chrome-native'), { gemini: ['G'], openai: ['O'] }, BROWSER);
    assert.equal(plan.first, 'browser');
    assert.deepEqual(steps(plan), ['gemini:gemini-3.5-flash-lite', 'openai:gpt-4o-mini-transcribe', 'on-device']);
  });

  it('prefers the cheapest saved Gemini model as a fallback', () => {
    const modelConfig = withTranscription('chrome-native', {
      gemini: { savedModels: [{ id: 'pro', modelId: 'gemini-3-pro', name: 'Pro' }, { id: 'lite', modelId: 'gemini-3.5-flash-lite', name: 'Lite' }] },
    });
    assert.deepEqual(steps(planDictation(modelConfig, { gemini: ['G'] }, BROWSER)), [
      'gemini:gemini-3.5-flash-lite',
      'gemini:gemini-3-pro',
      'on-device',
    ]);
  });

  it('sends a chosen model the recording first, then the others, then this device', () => {
    const modelConfig = withTranscription('whisper-1', { openai: { savedModels: [{ id: 'w', modelId: 'whisper-1', name: 'Whisper' }] } });
    const plan = planDictation(modelConfig, { gemini: ['G'], openai: ['O'] }, BROWSER);
    assert.equal(plan.first, 'model');
    assert.deepEqual(steps(plan), ['openai:whisper-1', 'gemini:gemini-3.5-flash-lite', 'openai:gpt-4o-mini-transcribe', 'on-device']);
  });

  it('keeps "On this device" on the device, keys or not', () => {
    const plan = planDictation(withTranscription('on-device-whisper'), { gemini: ['G'], openai: ['O'] }, BROWSER);
    assert.equal(plan.first, 'on-device');
    assert.deepEqual(steps(plan), ['on-device']);
  });

  it('says why a chosen model is unusable and listens with the browser instead', () => {
    const noEars = planDictation(withTranscription('claude-sonnet-4-5'), { anthropic: ['A'] }, BROWSER);
    assert.equal(noEars.first, 'browser');
    assert.match(noEars.unusableSelection, /can't transcribe audio/);
    const noKey = planDictation(withTranscription('gemini-3-pro', { gemini: { savedModels: [{ id: 'pro', modelId: 'gemini-3-pro', name: 'Gemini 3 Pro' }] } }), {}, BROWSER);
    assert.equal(noKey.first, 'browser');
    assert.match(noKey.unusableSelection, /Gemini 3 Pro has no API key/);
  });
});

describe('a take no one spoke in', () => {
  const tone = (amplitude, seconds = 1) => Float32Array.from({ length: 16000 * seconds }, (_, index) => amplitude * Math.sin(index / 8));

  it('measures as silence below the threshold, and speech above it', () => {
    assert.ok(onDevice.speechLevel(tone(0.002)) < onDevice.SILENCE_LEVEL);
    assert.ok(onDevice.speechLevel(tone(0.1)) > onDevice.SILENCE_LEVEL);
  });

  it('is judged by its loudest moment, so a short word in a long pause still counts', () => {
    const take = new Float32Array(16000 * 5);
    take.set(tone(0.1, 0.3).subarray(0, 4800), 40000);
    assert.ok(onDevice.speechLevel(take) > onDevice.SILENCE_LEVEL);
  });
});

describe("the composer's dictation button, as Gemini's", () => {
  const composer = read('features', 'chat', 'src', 'composer', 'Composer.tsx');
  const css = read('features', 'chat', 'src', 'composer', 'Composer.css');

  it("carries Gemini's labels and Ctrl+Shift+D", () => {
    assert.match(composer, /DICTATION_START_LABEL = 'Dictate \(\^⇧D\)'/);
    assert.match(composer, /DICTATION_STOP_LABEL = 'Stop dictation \(\^⇧D\)'/);
    assert.match(composer, /event\.ctrlKey[\s\S]{0,80}event\.shiftKey[\s\S]{0,80}event\.code !== 'KeyD'/);
  });

  it('folds to one line while listening, attachments and tool chips kept clear of the waveform', () => {
    assert.match(composer, /\{chatVariant && isDictationActive && <div aria-hidden="true" className="h-6 shrink-0" \/>\}/);
    assert.match(composer, /bottom-\[20px\] min-\[769px\]:max-\[960px\]:left-\[58px\] min-\[769px\]:max-\[960px\]:right-\[107px\] min-\[769px\]:max-\[960px\]:bottom-\[24px\] max-\[768px\]:left-\[54px\] max-\[768px\]:right-\[111px\] max-\[768px\]:bottom-\[28px\]/);
    assert.match(composer, /setDictationWaveLeft\(leading\.offsetLeft \+ leading\.offsetWidth \+ 8\)/);
  });

  it('becomes the filled stop button, focused, with Submit still there', () => {
    assert.match(composer, /family="google-symbols"\s+name="stop"[\s\S]{0,200}willow-dictation-stop-glyph/);
    assert.match(composer, /if \(isDictating && chatVariant\) micButtonRef\.current\?\.focus/);
    assert.match(composer, /isSubmitControlHidden = [^;]*!isDictationActive/);
    assert.match(composer, /stopDictationThen\(\(\) => setPendingSend\(true\)\)/);
    assert.match(css, /\.willow-dictation-stop \{\s*background-color: #141414 !important;/);
    assert.match(css, /\.willow-dictation-stop:focus \{\s*outline: 2\.4px solid #e0e0e0;\s*outline-offset: 1\.6px;/);
  });
});

describe('where dictation is chosen and where it runs', () => {
  it('offers only models that can hear a recording, plus the browser and this device', () => {
    for (const page of [read('apps', 'studio', 'src', 'settings', 'tabs', 'models-api', 'ModelsApiPage.tsx'), read('apps', 'studio', 'src', 'settings', 'tabs', 'ModelsTab.tsx')]) {
      assert.match(page, /canTranscribeAudio\(model\.provider, model\.modelId \|\| model\.id\)/);
      assert.match(page, /ON_DEVICE_TRANSCRIPTION_MODEL/);
      assert.match(page, /CHROME_NATIVE_TRANSCRIPTION_MODEL/);
    }
  });

  it("gives the desktop app's own pages the microphone on every platform", () => {
    const main = read('apps', 'desktop', 'src-tauri', 'src', 'main.rs');
    const tabs = read('apps', 'desktop', 'src-tauri', 'src', 'tabs.rs');
    const plist = read('apps', 'desktop', 'src-tauri', 'Info.plist');
    const entitlements = read('apps', 'desktop', 'src-tauri', 'Entitlements.plist');
    const config = JSON.parse(read('apps', 'desktop', 'src-tauri', 'tauri.conf.json'));
    assert.match(main, /\.on_permission_request\(\|webview, kind\| tabs::permission\(&webview, kind\)\)/);
    assert.match(tabs, /matches!\(kind, PermissionKind::Microphone \| PermissionKind::FileSystemAccess\)/);
    assert.match(tabs, /url\.origin\(\) == setup\.origin\.origin\(\)/);
    assert.match(tabs, /#\[cfg\(target_os = "linux"\)\][\s\S]{0,200}set_enable_media_stream\(true\)/);
    assert.match(plist, /NSMicrophoneUsageDescription/);
    assert.match(plist, /NSSpeechRecognitionUsageDescription/);
    assert.match(entitlements, /com\.apple\.security\.device\.audio-input<\/key>\s*<true\/>/);
    assert.equal(config.bundle.macOS.entitlements, './Entitlements.plist');
  });

  it('loads the on-device model in a worker from a CDN the bundle never ships', () => {
    const worker = read('platform', 'ai', 'src', 'dictation', 'whisper-worker.ts');
    const loader = read('platform', 'ai', 'src', 'dictation', 'on-device-transcription.ts');
    assert.match(worker, /https:\/\/cdn\.jsdelivr\.net\/npm\/@huggingface\/transformers@[\d.]+\/\+esm/);
    assert.match(worker, /onnx-community\/whisper-tiny/);
    assert.match(loader, /new Worker\(new URL\('\.\/whisper-worker\.ts', import\.meta\.url\), \{ type: 'module' \}\)/);
  });
});
