import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const read = (relative) =>
  fs.readFileSync(path.resolve(import.meta.dirname, '../../..', relative), 'utf8');

const source = read('features/chat/src/composer/use-composer-dictation.ts');

describe('Chrome native dictation resilience', () => {
  it('does not block mic startup while the on-device pack downloads', () => {
    assert.match(source, /Recognition\.install\(options\)\.catch/);
    assert.match(source, /return false;\s*\};\s*\n\s*export interface UseComposerDictationOptions/s);
    assert.match(source, /recognition\.processLocally = useOnDeviceRecognition/);
  });

  it('falls back to standard Chrome recognition if local language support is rejected', () => {
    assert.match(source, /event\.error === 'language-not-supported' && recognition\.processLocally/);
    assert.match(source, /recognition\.processLocally = false/);
    assert.match(source, /recognition\.start\(\);/);
  });

  it('keeps a recording alive across Chrome no-speech/end events', () => {
    assert.match(source, /event\.error === 'no-speech' && dictationPhaseRef\.current === 'recording'/);
    assert.match(source, /dictationPhaseRef\.current === 'recording'[\s\S]*?recognition\.start\(\);/);
    assert.match(
      source,
      /if \(event\.error === 'no-speech' && dictationPhaseRef\.current === 'recording'\) return;/,
    );
  });

  it('only finalizes after the user stops, while retaining late results', () => {
    assert.match(source, /nativeFinalizeTimerRef\.current = window\.setTimeout/);
    assert.match(source, /dictationPhaseRef\.current === 'processing'/);
    assert.match(source, /nativeCommittedTranscriptRef\.current/);
    assert.match(source, /nativeSessionTranscriptRef\.current/);
  });
});
