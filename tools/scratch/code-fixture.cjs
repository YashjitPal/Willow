/**
 * Willow Code tab test fixture (Willow tab only, never the user's media tab).
 *
 * Gets the inline workbench into its real states without an AI run and without writing
 * anywhere the user would see:
 *
 *   seed     From the Code landing (idle), on a fresh load: guards fetch against every AI
 *            provider host, records the code-session store's keys, restores fixture files
 *            into the workbench store, then reopens a made-up chat id. Files first: with
 *            `hasUserCode` already true the sidebar mounts promoted, so it never saves the
 *            conversation as an inbox chat, and with no project name nothing is registered,
 *            autosaved or given a cover.
 *   inject   Then puts the fixture conversation in the sidebar's state (see below).
 *   chat     Stops in the centred chat layout instead (no files, no messages).
 *   cleanup  Reloads the tab (drops React state, the store and the guard), then deletes
 *            exactly the code-session keys that were not there before `seed`.
 *   status   Prints what is mounted and how many AI requests the guard has blocked.
 *
 *   node tools/scratch/code-fixture.cjs seed|inject|chat|cleanup|status
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const BASELINE = path.join(process.env.TEMP, 'code-fixture-baseline.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FILES = {
  '/App.tsx': `import React, { useState } from 'react';
import { Header } from './components/Header';
import { TodoItem } from './components/TodoItem';
import { formatDue } from './utils/format';

type Todo = { id: number; title: string; category: string; due: string; done: boolean };

const START: Todo[] = [
  { id: 1, title: 'Plan the launch announcement for the new mobile layout', category: 'Work', due: '2026-10-04', done: false },
  { id: 2, title: 'Buy groceries', category: 'Home', due: '2026-10-03', done: true },
  { id: 3, title: 'Book a dentist appointment', category: 'Health', due: '2026-10-09', done: false },
  { id: 4, title: 'Review the pull request that refactors the settings modal into two levels', category: 'Work', due: '2026-10-05', done: false },
];

export default function App() {
  const [todos, setTodos] = useState<Todo[]>(START);
  const [draft, setDraft] = useState('');
  const add = () => {
    if (!draft.trim()) return;
    setTodos((list) => [...list, { id: Date.now(), title: draft.trim(), category: 'Inbox', due: new Date().toISOString().slice(0, 10), done: false }]);
    setDraft('');
  };
  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif' }}>
      <Header count={todos.filter((t) => !t.done).length} />
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '16px' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a task" style={{ flex: 1, minWidth: 0, padding: '10px 12px', borderRadius: 10, border: '1px solid #334155', background: '#1e293b', color: 'inherit' }} />
          <button onClick={add} style={{ padding: '10px 16px', borderRadius: 10, border: 0, background: '#6366f1', color: 'white', fontWeight: 600 }}>Add</button>
        </div>
        {todos.map((todo) => (
          <TodoItem key={todo.id} title={todo.title} category={todo.category} due={formatDue(todo.due)} done={todo.done}
            onToggle={() => setTodos((list) => list.map((t) => (t.id === todo.id ? { ...t, done: !t.done } : t)))} />
        ))}
      </main>
    </div>
  );
}
`,
  '/components/Header.tsx': `import React from 'react';

export function Header({ count }: { count: number }) {
  return (
    <header className="flex items-center justify-between px-4 py-5 border-b border-slate-800">
      <h1 className="text-2xl font-bold text-slate-100">Tasks</h1>
      <span className="text-sm text-slate-400">{count} open</span>
    </header>
  );
}
`,
  '/components/TodoItem.tsx': `import React from 'react';

export function TodoItem({ title, category, due, done, onToggle }: { title: string; category: string; due: string; done: boolean; onToggle: () => void }) {
  return (
    <label style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px', marginBottom: 8, borderRadius: 12, background: '#1e293b', opacity: done ? 0.6 : 1 }}>
      <input type="checkbox" checked={done} onChange={onToggle} style={{ marginTop: 3 }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', textDecoration: done ? 'line-through' : 'none' }}>{title}</span>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{category} · due {due}</span>
      </span>
    </label>
  );
}
`,
  '/utils/format.ts': `export function formatDue(isoDate: string): string {
  const date = new Date(isoDate + 'T00:00:00');
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
`,
  '/styles.css': `body { margin: 0; }
`,
};

const CODE = "```tsx\nexport function TodoItem({ title, category, due, done, onToggle }: { title: string; category: string; due: string; done: boolean; onToggle: () => void }) {\n  return <label className=\"flex items-start gap-3 rounded-xl bg-slate-800 p-3\">{title}</label>;\n}\n```";

const SESSION = {
  id: 'session_zz_fixture',
  name: 'ZZ Fixture Session',
  messages: [
    { id: 'zz-m1', role: 'user', content: 'Build me a todo app with categories, due dates and a dark theme.', timestamp: Date.now() - 600000 },
    {
      id: 'zz-m2', role: 'assistant', thinkingTime: 12, hasCodeChanges: true, timestamp: Date.now() - 590000,
      content: `I built a dark task list with categories and due dates.\n\n## What's in it\n\n- A header with the open-task count\n- An input to add tasks, which land in **Inbox**\n- Each task shows its category and a friendly due date, e.g. \`formatDue('2026-10-04')\`\n\n${CODE}\n\nThe date helper lives in \`utils/format.ts\`. A very long identifier to check wrapping: \`useTaskListKeyboardNavigationWithRovingTabIndexAndTypeahead\`.`,
    },
    { id: 'zz-m3', role: 'user', content: 'Make the checkboxes bigger and add a filter row: averyveryverylongunbrokenwordthatshouldwrapinsteadofpushingthebubblesideways', timestamp: Date.now() - 300000 },
    {
      id: 'zz-m4', role: 'assistant', thinkingTime: 5, hasCodeChanges: false, timestamp: Date.now() - 290000,
      content: `Here is how the filter row would work:\n\n| Filter | Shows |\n| --- | --- |\n| All | Every task |\n| Open | Tasks not done yet |\n| Done | Completed tasks |\n\nWant me to apply it?`,
    },
  ],
  filesSnapshot: {},
  activeSnapshotId: 'zz-fixture',
  createdAt: Date.now() - 600000,
  updatedAt: Date.now() - 290000,
};

const GUARD = () => {
  if (window.__zzFetchGuard) return 'guard already on';
  const original = window.fetch.bind(window);
  const blocked = /generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com|api\.openai\.com|api\.anthropic\.com|api\.moonshot\.|api\.x\.ai|bigmodel\.cn|api\.z\.ai|openrouter\.ai|api\.deepseek\.com|api\.mistral\.ai|api\.groq\.com|api\.together\./;
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (blocked.test(url)) {
      window.__zzBlocked = (window.__zzBlocked || 0) + 1;
      return Promise.reject(new TypeError('blocked by the Code fixture guard'));
    }
    return original(input, init);
  };
  window.__zzFetchGuard = true;
  return 'guard on';
};

const IDB_KEYS = async () => {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('WillowDB');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const keysOf = (store) => new Promise((resolve) => {
    if (!db.objectStoreNames.contains(store)) return resolve([]);
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAllKeys();
    tx.oncomplete = () => resolve(req.result.map(String));
    tx.onerror = () => resolve([]);
  });
  const out = { code_sessions: await keysOf('code_sessions'), code_blobs: await keysOf('code_blobs') };
  db.close();
  return out;
};

// Chrome keeps only 250 resource-timing entries and a dev build loads far more modules, so
// fall back to Vite's `/@fs/<absolute path>` form, which is the URL the app imported.
const moduleUrl = ([suffix, root]) => {
  const urls = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.split('?')[0].endsWith(suffix));
  return urls[urls.length - 1] || `${location.origin}/@fs/${root}${suffix}`;
};
const REPO_ROOT = encodeURI(path.resolve(__dirname, '..', '..').replace(/\\/g, '/'));

(async () => {
  const cmd = process.argv[2] || 'status';
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 120000 });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  if (!page) throw new Error('no Willow tab');
  await page.bringToFront();

  if (cmd === 'cleanup') {
    await page.goto('http://localhost:3000/?mode=develop', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await sleep(4000);
    if (!fs.existsSync(BASELINE)) { console.log('no baseline: nothing seeded by this tool'); browser.disconnect(); return; }
    const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    const removed = await page.evaluate(async (base) => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('WillowDB');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const result = {};
      for (const store of ['code_sessions', 'code_blobs']) {
        if (!db.objectStoreNames.contains(store)) continue;
        const keys = await new Promise((resolve) => {
          const tx = db.transaction(store, 'readonly');
          const req = tx.objectStore(store).getAllKeys();
          tx.oncomplete = () => resolve(req.result);
        });
        const extra = keys.filter((k) => !base[store].includes(String(k)));
        await new Promise((resolve) => {
          const tx = db.transaction(store, 'readwrite');
          for (const k of extra) tx.objectStore(store).delete(k);
          tx.oncomplete = resolve;
          tx.onerror = resolve;
        });
        result[store] = extra.length;
      }
      db.close();
      return result;
    }, baseline);
    const after = await page.evaluate(IDB_KEYS);
    const same = ['code_sessions', 'code_blobs'].every((s) => after[s].length === baseline[s].length && after[s].every((k) => baseline[s].includes(k)));
    console.log(`removed ${JSON.stringify(removed)}; store keys back to baseline: ${same}`);
    if (same) fs.unlinkSync(BASELINE);
    browser.disconnect();
    return;
  }

  /*
   * Puts the fixture conversation on screen by setting the sidebar's own `messages` state.
   * A resumed chat reads its transcript only from the chat file on disk, so this is the
   * one way in that writes nothing. The hook is found by the run of state the source
   * declares right after it — `messages`, `currentStreamingResponse` (''),
   * `activeCodexTurn` (null), `designMessages` ([]), `designStreamingResponse` (''),
   * `codeChatSessionId` (the made-up id) — and nothing is set unless all six match.
   */
  if (cmd === 'inject') {
    console.log(await page.evaluate(GUARD));
    const result = await page.evaluate((messages) => {
      const field = (el) => Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
      const area = [...document.querySelectorAll('textarea')].find((t) => /Ask Willow|Save or discard/.test(t.placeholder));
      if (!area) return 'no workbench composer on screen';
      for (let fiber = area[field(area)]; fiber; fiber = fiber.return) {
        for (let hook = fiber.memoizedState; hook && typeof hook === 'object' && 'next' in hook; hook = hook.next) {
          const run = [hook, hook.next, hook.next?.next, hook.next?.next?.next, hook.next?.next?.next?.next, hook.next?.next?.next?.next?.next];
          if (run.some((h) => !h)) continue;
          const [m, s, t, d, ds, id] = run.map((h) => h.memoizedState);
          if (Array.isArray(m) && s === '' && t === null && Array.isArray(d) && ds === '' && id === 'zz-responsive-fixture' && hook.queue?.dispatch) {
            hook.queue.dispatch(messages);
            return 'messages set';
          }
        }
      }
      return 'sidebar messages state not found: nothing set';
    }, SESSION.messages);
    await sleep(1500);
    console.log(result, await page.evaluate(() => ({ visible: document.body.innerText.includes('Build me a todo app'), blocked: window.__zzBlocked || 0 })));
    browser.disconnect();
    return;
  }

  if (cmd === 'status') {
    console.log(await page.evaluate(() => ({
      path: location.pathname + location.search,
      guard: !!window.__zzFetchGuard,
      blocked: window.__zzBlocked || 0,
      landing: !!document.querySelector('#bottom-panel'),
      workbench: !!document.querySelector('textarea[placeholder="Ask Willow..."]') && !document.querySelector('#bottom-panel'),
    })));
    browser.disconnect();
    return;
  }

  // seed | chat: from a fresh Code landing.
  await page.goto('http://localhost:3000/?mode=develop', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  for (let i = 0; i < 40; i += 1) {
    await sleep(500);
    if (await page.evaluate(() => !!document.querySelector('#bottom-panel'))) break;
  }
  console.log(await page.evaluate(GUARD));
  if (cmd === 'seed') {
    if (!fs.existsSync(BASELINE)) {
      fs.writeFileSync(BASELINE, JSON.stringify(await page.evaluate(IDB_KEYS)));
    }
    const sessionUrl = await page.evaluate(moduleUrl, ['/features/code/src/session/code-session.ts', REPO_ROOT]);
    console.log(await page.evaluate(async (files, url) => {
      const { activeWorkbench } = await import(url);
      const workbench = activeWorkbench();
      workbench.restoreFromSnapshot('zz-fixture', files);
      return `files restored: ${Object.keys(workbench.files.get()).length}, hasUserCode ${workbench.hasUserCode.get()}`;
    }, FILES, sessionUrl));
  }
  const openUrl = await page.evaluate(moduleUrl, ['/platform/storage/src/code-chat-open-store.ts', REPO_ROOT]);
  console.log(await page.evaluate(async (url) => {
    const { requestCodeChatOpen } = await import(url);
    requestCodeChatOpen('zz-responsive-fixture');
    return 'reopened the made-up chat';
  }, openUrl));
  await sleep(3000);
  console.log(await page.evaluate(() => ({ landing: !!document.querySelector('#bottom-panel'), blocked: window.__zzBlocked || 0 })));
  browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
