import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { importTs } from './ts-module.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const jobsModule = await importTs(path.join(ROOT, 'platform/core/src/background-jobs.ts'));
const { createBackgroundJobs, JOB_RECORD_PREFIX, JOB_STALE_MS, JOB_MAX_TAKEOVERS } = jobsModule;

const flush = async (rounds = 20) => {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
};

const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

/** One browser: Web Locks shared by every tab, released when a tab dies. */
class Browser {
  constructor() {
    this.now = 1_000_000;
    this.timers = [];
    this.nextTimer = 1;
    this.held = new Map();
    this.queues = new Map();
    this.items = new Map();
    this.listeners = new Map();
    this.lifecycle = new Map();
  }

  /** Page Lifecycle: the browser is about to freeze the tab, or has woken it. */
  freeze(tab) { this.lifecycle.get(tab)?.onFreeze(); }
  resume(tab) { this.lifecycle.get(tab)?.onResume(); }

  request(tab, name, options, callback) {
    return new Promise((resolve, reject) => {
      const request = { tab, name, callback, resolve, reject };
      const queue = this.queues.get(name) ?? [];
      this.queues.set(name, queue);
      if (options.signal) {
        if (options.signal.aborted) return reject(abortError());
        options.signal.addEventListener('abort', () => {
          const index = queue.indexOf(request);
          if (index >= 0) {
            queue.splice(index, 1);
            reject(abortError());
          }
        });
      }
      if (!this.held.has(name) && queue.length === 0) this.grant(request);
      else if (options.ifAvailable) Promise.resolve().then(() => callback(null)).then(resolve, reject);
      else queue.push(request);
    });
  }

  grant(request) {
    this.held.set(request.name, request);
    Promise.resolve()
      .then(() => request.callback({ name: request.name, mode: 'exclusive' }))
      .then((value) => { this.unlock(request); request.resolve(value); },
        (error) => { this.unlock(request); request.reject(error); });
  }

  unlock(request) {
    if (this.held.get(request.name) !== request) return;
    this.held.delete(request.name);
    const next = this.queues.get(request.name)?.shift();
    if (next) this.grant(next);
  }

  /** The tab closed: its queued requests vanish and its locks are released. */
  kill(tab) {
    this.queues.forEach((queue, name) => this.queues.set(name, queue.filter((request) => request.tab !== tab)));
    [...this.held.values()].filter((request) => request.tab === tab).forEach((request) => this.unlock(request));
    this.timers = this.timers.filter((timer) => timer.tab !== tab);
    this.listeners.delete(tab);
  }

  notify(fromTab, key) {
    this.listeners.forEach((listener, tab) => { if (tab !== fromTab) queueMicrotask(() => listener(key)); });
  }

  env(tab) {
    const browser = this;
    const schedule = (callback, ms, repeat) => {
      const timer = { id: browser.nextTimer++, tab, at: browser.now + ms, ms, callback, repeat };
      browser.timers.push(timer);
      return timer.id;
    };
    const cancel = (id) => { browser.timers = browser.timers.filter((timer) => timer.id !== id); };
    return {
      storage: {
        getItem: (key) => browser.items.get(key) ?? null,
        setItem: (key, value) => { browser.items.set(key, String(value)); browser.notify(tab, key); },
        removeItem: (key) => { browser.items.delete(key); browser.notify(tab, key); },
        key: (index) => [...browser.items.keys()][index] ?? null,
        get length() { return browser.items.size; },
      },
      locks: { request: (name, options, callback) => browser.request(tab, name, options, callback) },
      now: () => browser.now,
      subscribe: (listener) => {
        browser.listeners.set(tab, listener);
        return () => browser.listeners.delete(tab);
      },
      setTimeout: (callback, ms) => schedule(callback, ms, false),
      clearTimeout: cancel,
      setInterval: (callback, ms) => schedule(callback, ms, true),
      clearInterval: cancel,
      onLifecycle: (onFreeze, onResume) => {
        browser.lifecycle.set(tab, { onFreeze, onResume });
        return () => browser.lifecycle.delete(tab);
      },
    };
  }

  async advance(ms) {
    const end = this.now + ms;
    for (;;) {
      await flush();
      const due = this.timers.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.now = due.at;
      if (due.repeat) due.at += due.ms;
      else this.timers = this.timers.filter((timer) => timer !== due);
      due.callback();
    }
    this.now = end;
    await flush();
  }

  record(id) {
    const raw = this.items.get(JOB_RECORD_PREFIX + id);
    return raw ? JSON.parse(raw) : null;
  }
}

const openTab = (browser, name) => createBackgroundJobs(browser.env(name));

/** A kind that resumes by starting the job again, and remembers what it was handed. */
const resumingKind = (jobs, log = []) => ({
  log,
  handles: [],
  takeOver(job) {
    log.push(job);
    this.handles.push(jobs.start({ id: job.id, kind: job.kind, scopeId: job.scopeId, payload: job.payload }));
  },
});

describe('background jobs across tabs', () => {
  it('writes a record while the job runs and removes it when it finishes', async () => {
    const browser = new Browser();
    const a = openTab(browser, 'a');
    const job = a.start({ id: 'chat:1', kind: 'chat', scopeId: 'u', payload: { chatId: 'c' } });
    await flush();
    assert.equal(browser.record('chat:1').owner, a.instanceId);
    assert.ok(browser.held.has('willow-job:chat:1'));
    job.finish();
    await flush();
    assert.equal(browser.record('chat:1'), null);
    assert.ok(!browser.held.has('willow-job:chat:1'));
  });

  it('does not take over a job that finished normally', async () => {
    const browser = new Browser();
    const a = openTab(browser, 'a');
    const b = openTab(browser, 'b');
    const kind = resumingKind(b);
    b.register('chat', kind);
    const job = a.start({ id: 'chat:1', kind: 'chat', scopeId: 'u', payload: {} });
    await flush();
    job.finish();
    await browser.advance(1000);
    assert.equal(kind.log.length, 0);
    assert.equal(browser.held.size, 0);
  });

  it('resumes in another open tab when the owning tab closes', async () => {
    const browser = new Browser();
    const a = openTab(browser, 'a');
    const b = openTab(browser, 'b');
    const kind = resumingKind(b);
    b.register('spark', kind);
    a.start({ id: 'spark:u:t1', kind: 'spark', scopeId: 'u', payload: { taskId: 't1' } });
    await flush();
    browser.kill('a');
    a.dispose();
    await browser.advance(10);
    assert.equal(kind.log.length, 1);
    assert.deepEqual(kind.log[0].payload, { taskId: 't1' });
    assert.equal(kind.handles[0].resumed, true);
    const record = browser.record('spark:u:t1');
    assert.equal(record.owner, b.instanceId);
    assert.equal(record.takeovers, 1);
    assert.equal(browser.held.get('willow-job:spark:u:t1').tab, 'b');
  });

  it('hands the latest payload to the tab that takes over', async () => {
    const browser = new Browser();
    const a = openTab(browser, 'a');
    const b = openTab(browser, 'b');
    const kind = resumingKind(b);
    b.register('chat', kind);
    const job = a.start({ id: 'chat:1', kind: 'chat', scopeId: 'u', payload: { chatId: 'New chat', turn: 'x' } });
    await flush();
    job.update({ chatId: 'Trip to Rome' });
    browser.kill('a');
    a.dispose();
    await browser.advance(10);
    assert.deepEqual(kind.log[0].payload, { chatId: 'Trip to Rome', turn: 'x' });
  });

  it('resumes once even with several tabs waiting', async () => {
    const browser = new Browser();
    const a = openTab(browser, 'a');
    const b = openTab(browser, 'b');
    const c = openTab(browser, 'c');
    const kindB = resumingKind(b);
    const kindC = resumingKind(c);
    b.register('chat', kindB);
    c.register('chat', kindC);
    a.start({ id: 'chat:1', kind: 'chat', scopeId: 'u', payload: {} });
    await flush();
    browser.kill('a');
    a.dispose();
    await browser.advance(10);
    assert.equal(kindB.log.length + kindC.log.length, 1);
    const winner = kindB.log.length ? kindB : kindC;
    winner.handles[0].finish();
    await browser.advance(1000);
    assert.equal(kindB.log.length + kindC.log.length, 1, 'the second waiting tab found nothing left to resume');
    assert.equal(browser.record('chat:1'), null);
  });

  it('passes to the next tab when the resuming tab closes too', async () => {
    const browser = new Browser();
    const a = openTab(browser, 'a');
    const b = openTab(browser, 'b');
    const c = openTab(browser, 'c');
    const kindB = resumingKind(b);
    b.register('chat', kindB);
    a.start({ id: 'chat:1', kind: 'chat', scopeId: 'u', payload: {} });
    await flush();
    browser.kill('a');
    a.dispose();
    await browser.advance(10);
    assert.equal(kindB.log.length, 1);
    const kindC = resumingKind(c);
    c.register('chat', kindC);
    await flush();
    browser.kill('b');
    b.dispose();
    await browser.advance(10);
    assert.equal(kindC.log.length, 1);
    assert.equal(browser.record('chat:1').takeovers, 2);
  });

  it('stops passing a job on after the takeover limit', async () => {
    const browser = new Browser();
    const abandoned = [];
    const c = openTab(browser, 'c');
    browser.items.set(JOB_RECORD_PREFIX + 'chat:1', JSON.stringify({
      id: 'chat:1', kind: 'chat', scopeId: 'u', payload: {}, owner: 'gone',
      startedAt: browser.now, heartbeatAt: browser.now, takeovers: JOB_MAX_TAKEOVERS,
    }));
    const kind = resumingKind(c);
    c.register('chat', { ...kind, takeOver: kind.takeOver.bind(kind), abandon: (job) => abandoned.push(job.id) });
    await browser.advance(10);
    assert.equal(kind.log.length, 0);
    assert.deepEqual(abandoned, ['chat:1']);
    assert.equal(browser.record('chat:1'), null);
  });

  it('resumes after a reload when the record is fresh', async () => {
    const browser = new Browser();
    const a = openTab(browser, 'a');
    a.start({ id: 'chat:1', kind: 'chat', scopeId: 'u', payload: {} });
    await flush();
    browser.kill('a');
    a.dispose();
    await browser.advance(2000);
    const reloaded = openTab(browser, 'a2');
    const kind = resumingKind(reloaded);
    reloaded.register('chat', kind);
    await browser.advance(10);
    assert.equal(kind.log.length, 1);
  });

  it('settles a record whose heartbeat stopped long ago instead of resuming it', async () => {
    const browser = new Browser();
    const a = openTab(browser, 'a');
    a.start({ id: 'chat:1', kind: 'chat', scopeId: 'u', payload: {} });
    await flush();
    browser.kill('a');
    a.dispose();
    await browser.advance(JOB_STALE_MS + 1000);
    const later = openTab(browser, 'later');
    const abandoned = [];
    const kind = resumingKind(later);
    later.register('chat', { takeOver: kind.takeOver.bind(kind), abandon: (job) => abandoned.push(job.id) });
    await browser.advance(10);
    assert.equal(kind.log.length, 0);
    assert.deepEqual(abandoned, ['chat:1']);
    assert.equal(browser.record('chat:1'), null);
  });

  it('keeps the heartbeat going while the owner runs, so a long job is not stale', async () => {
    const browser = new Browser();
    const a = openTab(browser, 'a');
    const b = openTab(browser, 'b');
    const kind = resumingKind(b);
    b.register('spark', kind);
    a.start({ id: 'spark:u:t1', kind: 'spark', scopeId: 'u', payload: {} });
    await browser.advance(JOB_STALE_MS * 2);
    assert.equal(kind.log.length, 0);
    browser.kill('a');
    a.dispose();
    await browser.advance(10);
    assert.equal(kind.log.length, 1);
  });

  it('lets a willing tab take a job another tab declines', async () => {
    const browser = new Browser();
    const a = openTab(browser, 'a');
    const busy = openTab(browser, 'busy');
    const free = openTab(browser, 'free');
    const declined = [];
    busy.register('code', { canTakeOver: (job) => { declined.push(job.id); return false; }, takeOver: () => assert.fail('declined tab resumed') });
    const kind = resumingKind(free);
    a.start({ id: 'code:1', kind: 'code', scopeId: 'u', payload: {} });
    await flush();
    free.register('code', kind);
    await flush();
    browser.kill('a');
    a.dispose();
    await browser.advance(10);
    assert.equal(declined.length, 1);
    assert.equal(kind.log.length, 1);
  });

  it('drops the record when the kind never starts the job again', async () => {
    const browser = new Browser();
    const a = openTab(browser, 'a');
    const b = openTab(browser, 'b');
    b.register('media', { takeOver: () => undefined });
    a.start({ id: 'media:1', kind: 'media', scopeId: 'u', payload: {} });
    await flush();
    browser.kill('a');
    a.dispose();
    await browser.advance(10);
    assert.ok(browser.record('media:1'), 'still held while the kind may yet start it');
    await browser.advance(20_000);
    assert.equal(browser.record('media:1'), null);
    assert.equal(browser.held.size, 0);
  });

  it('keeps the lock when the same tab starts the same job again', async () => {
    const browser = new Browser();
    const a = openTab(browser, 'a');
    const first = a.start({ id: 'spark:u:t1', kind: 'spark', scopeId: 'u', payload: { run: 1 } });
    await flush();
    const second = a.start({ id: 'spark:u:t1', kind: 'spark', scopeId: 'u', payload: { run: 2 } });
    first.finish();
    await flush();
    assert.deepEqual(browser.record('spark:u:t1').payload, { run: 2 });
    assert.equal(browser.held.get('willow-job:spark:u:t1').tab, 'a');
    second.finish();
    await flush();
    assert.equal(browser.record('spark:u:t1'), null);
    assert.equal(browser.held.size, 0);
  });

  it('lets an awake tab take over when the one ahead of it in the queue is frozen', async () => {
    const browser = new Browser();
    const a = openTab(browser, 'a');
    const frozen = openTab(browser, 'frozen');
    const awake = openTab(browser, 'awake');
    const frozenKind = resumingKind(frozen);
    const awakeKind = resumingKind(awake);
    frozen.register('chat', frozenKind);
    a.start({ id: 'chat:1', kind: 'chat', scopeId: 'u', payload: {} });
    await flush();
    awake.register('chat', awakeKind);
    await flush();
    assert.equal(browser.queues.get('willow-job:chat:1')[0].tab, 'frozen', 'the frozen tab queued first');
    browser.freeze('frozen');
    await flush();
    assert.ok(!browser.queues.get('willow-job:chat:1').some((request) => request.tab === 'frozen'), 'and left the queue');
    browser.kill('a');
    a.dispose();
    await browser.advance(10);
    assert.equal(awakeKind.log.length, 1);
    assert.equal(frozenKind.log.length, 0);
    browser.resume('frozen');
    await flush();
    assert.ok(browser.queues.get('willow-job:chat:1').some((request) => request.tab === 'frozen'), 'it rejoins on resume');
    awakeKind.handles[0].finish();
    await browser.advance(1000);
    assert.equal(frozenKind.log.length, 0, 'and finds the job finished when its turn comes');
  });

  it('only watches kinds it can run', async () => {
    const browser = new Browser();
    const a = openTab(browser, 'a');
    const b = openTab(browser, 'b');
    b.register('chat', resumingKind(b));
    a.start({ id: 'media:1', kind: 'media', scopeId: 'u', payload: {} });
    await flush();
    assert.equal(browser.queues.get('willow-job:media:1')?.length ?? 0, 0);
  });
});
