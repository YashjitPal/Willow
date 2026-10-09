import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const recognizer = await importTs(path.join(repoRoot, 'platform', 'ai', 'src', 'dictation', 'browser-recognizer.ts'));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = (...transcripts) => ({ resultIndex: 0, results: transcripts.map((transcript) => ({ isFinal: true, 0: { transcript } })) });

/**
 * Chrome's recognizer, scripted: `sessions[n]` runs on the n-th `start()` (the last one repeats),
 * `onStop` when the take is stopped. Each is handed the instance to fire events from.
 */
const fakeRecognition = ({ sessions, onStop = (rec) => rec.onend?.(), available, install } = {}) => {
  const created = [];
  class FakeRecognition {
    constructor() {
      this.starts = 0;
      this.running = false;
      created.push(this);
    }
    start() {
      if (this.running) {
        const error = new Error('already started');
        error.name = 'InvalidStateError';
        throw error;
      }
      this.running = true;
      const session = sessions[Math.min(this.starts, sessions.length - 1)];
      this.starts += 1;
      queueMicrotask(() => session?.(this));
    }
    stop() {
      queueMicrotask(() => onStop(this));
    }
    abort() {
      this.aborted = true;
    }
    end() {
      this.running = false;
      this.onend?.();
    }
  }
  if (available) FakeRecognition.available = available;
  if (install) FakeRecognition.install = install;
  globalThis.window = { setTimeout, clearTimeout, webkitSpeechRecognition: FakeRecognition };
  return created;
};

afterEach(() => {
  delete globalThis.window;
});

describe('the browser recognizer (one dictation take)', () => {
  it('counts a recognizer that hears speech and ends with nothing as broken (headless Chrome, no speech key)', async () => {
    const created = fakeRecognition({ sessions: [(rec) => { rec.onspeechstart?.(); rec.end(); }] });
    const failures = [];
    const take = await recognizer.startBrowserRecognition({ language: 'en-US', onFailure: (reason) => failures.push(reason) });
    await sleep(400);
    assert.equal(take.failed, true);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /without results/);
    // It stops restarting once broken, instead of "listening" forever.
    const starts = created[0].starts;
    await sleep(200);
    assert.equal(created[0].starts, starts);
    assert.deepEqual(await take.stop(), { text: '', failed: true, heardSpeech: true, reason: failures[0] });
  });

  it('gives up on a fatal error rather than restarting into it', async () => {
    const created = fakeRecognition({ sessions: [(rec) => { rec.onerror?.({ error: 'network' }); rec.end(); }] });
    const take = await recognizer.startBrowserRecognition({ language: 'en-US' });
    await sleep(250);
    assert.equal(take.failed, true);
    assert.equal(created[0].starts, 1);
    assert.equal((await take.stop()).reason, 'network');
  });

  it('keeps one take alive across no-speech and end events until the user stops', async () => {
    const created = fakeRecognition({
      sessions: [
        (rec) => { rec.onerror?.({ error: 'no-speech' }); rec.end(); },
        (rec) => { rec.onspeechstart?.(); rec.onresult?.(results('hello there')); rec.end(); },
        () => {},
      ],
    });
    const take = await recognizer.startBrowserRecognition({ language: 'en-US' });
    await sleep(400);
    assert.equal(take.failed, false);
    assert.equal(created[0].starts, 3);
    assert.deepEqual(await take.stop(), { text: 'hello there', failed: false, heardSpeech: true, reason: undefined });
  });

  it('joins sessions and keeps a result that lands while it finalizes', async () => {
    fakeRecognition({
      sessions: [
        (rec) => { rec.onspeechstart?.(); rec.onresult?.(results('hello')); rec.end(); },
        (rec) => { rec.onresult?.(results('world')); },
      ],
      // Chrome starts each later result of a session with its space.
      onStop: (rec) => { rec.onresult?.(results('world', ' again')); rec.end(); },
    });
    const take = await recognizer.startBrowserRecognition({ language: 'en-US' });
    await sleep(250);
    assert.equal((await take.stop()).text, 'hello world again');
  });

  it("retries on Chrome's standard recognizer when the installed language pack is rejected", async () => {
    const created = fakeRecognition({
      available: async () => 'available',
      install: async () => true,
      sessions: [
        (rec) => { rec.onerror?.({ error: 'language-not-supported' }); rec.end(); },
        () => {},
      ],
    });
    const take = await recognizer.startBrowserRecognition({ language: 'en-US' });
    await sleep(300);
    assert.equal(created[0].processLocally, false);
    // Started again by the retry and by `onend` both: the second start is not a failure.
    assert.equal(take.failed, false);
    assert.ok(created[0].starts >= 2);
    take.abort();
  });

  it('never holds a take on the on-device pack download', async () => {
    let installs = 0;
    const created = fakeRecognition({
      available: async () => 'downloadable',
      install: () => { installs += 1; return new Promise(() => {}); },
      sessions: [() => {}],
    });
    const take = await recognizer.startBrowserRecognition({ language: 'en-US' });
    assert.equal(installs, 1);
    assert.equal(created[0].processLocally, false);
    assert.equal(created[0].starts, 1);
    take.abort();
  });

  it('says so when the browser has no recognizer (Firefox, the WebView2 desktop app)', async () => {
    globalThis.window = { setTimeout, clearTimeout };
    assert.equal(recognizer.browserRecognitionAvailable(), false);
    assert.equal(await recognizer.startBrowserRecognition({ language: 'en-US' }), null);
  });
});
