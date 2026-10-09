/*
 * Remote-browser fixtures for Willow's Spark, in the debug Chrome's Willow tab. Goes through
 * the app's own spark-store and remote-browser-store instances (found on the resource
 * timeline), so persistence and rendering take the normal path. Nothing here calls a model:
 * the pane's states are set directly, and its page is a real proxied site.
 *
 *   node tools/scratch/spark-rb-seed.cjs pending           a task waiting on the permission card (opens it)
 *   node tools/scratch/spark-rb-seed.cjs answered [url]    an allowed thread: card, "Allow", conclusion (opens it)
 *   node tools/scratch/spark-rb-seed.cjs pane [url]        open the open task's remote-browser pane
 *   node tools/scratch/spark-rb-seed.cjs close             close it
 *   node tools/scratch/spark-rb-seed.cjs phase <preparing|live|idle> [x,y]
 *   node tools/scratch/spark-rb-seed.cjs shots [n]         record n bridge screenshots into the history
 *   node tools/scratch/spark-rb-seed.cjs takeover on|off
 *   node tools/scratch/spark-rb-seed.cjs state             print the open task's session
 *   node tools/scratch/spark-rb-seed.cjs clear             delete every fixture this script made
 */
const puppeteer = require('puppeteer-core');

const PENDING_ID = 'seed-rb-pending';
const ANSWERED_ID = 'seed-rb-answered';

async function run(page, command, args) {
  return page.evaluate(async (cmd, argv, ids) => {
    // Newest first: after a hot update the timeline also holds the module's stale `?t=` URLs,
    // whose instances the app no longer renders from.
    const find = (pattern) => performance.getEntriesByType('resource')
      .filter((entry) => pattern.test(entry.name))
      .sort((a, b) => b.startTime - a.startTime)[0]?.name;
    const storeUrl = find(/\/spark-store\.ts(\?|$)/);
    if (!storeUrl) return { error: 'spark-store module not loaded yet — open Spark once first' };
    const store = await import(storeUrl);
    /*
     * The live instance of a module is whatever URL its importer asked for — Vite stamps
     * `?t=` onto modules it has hot-updated, even across a reload — and the resource
     * timeline stops recording at 250 entries, which this app passes. So read the import
     * URL out of the importer's own served source instead of guessing it.
     */
    const importedBy = async (importerUrl, file) => {
      const source = await (await fetch(importerUrl)).text();
      const match = new RegExp(`["']([^"']*/${file.replace('.', '\\.')}(?:\\?[^"']*)?)["']`).exec(source);
      return match ? new URL(match[1], importerUrl).href : null;
    };
    const browserUrl = find(/\/remote-browser\/remote-browser-store\.ts(\?|$)/);
    const browser = browserUrl ? await import(browserUrl).catch(() => null) : null;
    const framesUrl = browserUrl ? await importedBy(browserUrl, 'remote-browser-frames.ts') : null;
    const frames = framesUrl ? await import(framesUrl).catch(() => null) : null;
    const state = () => store.sparkState.get();
    const openId = () => (state().location.page === 'task' ? state().location.taskId : null);
    const now = Date.now();
    const iso = (offset) => new Date(now + offset).toISOString();

    if (cmd === 'pending') {
      if (!state().tasks.some((task) => task.id === ids.pending)) {
        store.createSparkTask('Use the remote browser to open wolframalpha.com and tell me the distance from Earth to the Moon.', {
          id: ids.pending,
          title: 'Lunar Distance Lookup',
          description: 'Initializing task',
          status: 'needs-input',
          openTask: false,
          response: "Before I open a browser, I want to make sure you're okay with that.",
          progressLabel: 'Needs input',
          activityTitle: 'Checking the lunar distance on WolframAlpha',
          activityLog: [
            { id: 'seed-rb-a1', kind: 'narration', text: "I'm opening WolframAlpha in the remote browser to look up the current distance." },
            { id: 'seed-rb-a2', kind: 'tool', tool: 'computer:Search WolframAlpha for the distance from Earth to the Moon' },
          ],
          usedTools: ['computer'],
          browserRequest: {
            id: 'seed-rb-request-1',
            title: 'Search WolframAlpha for the distance from Earth to the Moon',
            task: "Open https://www.wolframalpha.com, type 'distance from Earth to the Moon' into the search input box, submit the query, and report the result shown on the page (specifically the distance value and relevant details).",
            url: 'https://www.wolframalpha.com',
            status: 'pending',
            createdAt: iso(-60_000),
          },
        });
      }
      store.navigateSpark({ page: 'task', taskId: ids.pending });
      return { opened: ids.pending };
    }

    if (cmd === 'answered') {
      const url = argv[0] || 'https://example.com/';
      if (!state().tasks.some((task) => task.id === ids.answered)) {
        store.createSparkTask('Use the remote browser to check what example.com says about itself.', {
          id: ids.answered,
          title: 'Example Domain Check',
          description: 'Read the example.com page in the browser',
          status: 'complete',
          openTask: false,
          response: "Before I open a browser, I want to make sure you're okay with that.",
          progressLabel: 'Done',
          activityTitle: 'Reading example.com in the remote browser',
          activityLog: [
            { id: 'seed-rb-b1', kind: 'narration', text: "I'm opening example.com in the remote browser to read the page." },
            { id: 'seed-rb-b2', kind: 'tool', tool: 'computer:Read the example.com page' },
          ],
          usedTools: ['computer'],
          browserPermission: 'allowed',
          remoteBrowser: { url, title: 'Example Domain' },
          browserRequest: {
            id: 'seed-rb-request-2',
            title: 'Read the example.com page',
            task: 'Open https://example.com and report what the page says it is for, quoting its main paragraph.',
            url: 'https://example.com',
            status: 'allowed',
            createdAt: iso(-120_000),
          },
          turns: [{
            id: `${ids.answered}-turn-1`,
            prompt: 'Allow',
            response: 'The page at **example.com** describes itself as a domain reserved for documentation examples: anyone may use it in examples without asking permission, and it is not a real service, so it should not be relied on for testing or monitoring.',
            activityTitle: 'Reading example.com in the remote browser',
            activityLog: [
              { id: 'seed-rb-c1', kind: 'tool', tool: 'computer:Read the example.com page' },
              { id: 'seed-rb-c2', kind: 'narration', text: 'The browser read the page and returned its main paragraph.' },
            ],
            usedTools: ['computer'],
            browserDecision: { requestId: 'seed-rb-request-2', allowed: true },
            createdAt: iso(-90_000),
          }],
        });
      }
      store.navigateSpark({ page: 'task', taskId: ids.answered });
      return { opened: ids.answered };
    }

    if (!browser && cmd !== 'clear') return { error: 'remote-browser-store not loaded — open a task first' };
    const taskId = openId();
    if (!taskId && cmd !== 'clear') return { error: 'no task is open' };

    if (cmd === 'pane') {
      const task = state().tasks.find((candidate) => candidate.id === taskId);
      const url = argv[0] || task?.remoteBrowser?.url || 'https://example.com/';
      browser.openRemoteBrowserPane(taskId, { url, title: task?.remoteBrowser?.title || '' });
      return { pane: browser.getRemoteBrowserSession(taskId) && 'open' };
    }
    if (cmd === 'close') {
      browser.closeRemoteBrowserPane(taskId);
      return { closed: true };
    }
    if (cmd === 'phase') {
      const phase = argv[0] || 'idle';
      const [x, y] = (argv[1] || '640,300').split(',').map(Number);
      browser.updateRemoteBrowserSession(taskId, {
        phase,
        agentActive: phase !== 'idle',
        cursor: phase === 'live' ? { x, y, at: Date.now() } : null,
      });
      return { phase };
    }
    if (cmd === 'shots') {
      const count = Number(argv[0] || 3);
      const taken = [];
      for (let i = 0; i < count; i += 1) {
        const shot = await frames.callRemoteFrame(taskId, 'screenshot', {}, 25000);
        browser.pushRemoteBrowserShot(taskId, { dataUrl: shot.dataUrl, url: shot.url, title: shot.title });
        taken.push(`${shot.width}x${shot.height} ${Math.round(shot.dataUrl.length / 1024)}KB`);
        if (i < count - 1) await frames.callRemoteFrame(taskId, 'scroll', { direction: 'down', magnitude: 300 }, 15000);
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
      return { taken };
    }
    if (cmd === 'takeover') {
      browser.setRemoteBrowserControl(taskId, argv[0] !== 'off');
      return { inControl: argv[0] !== 'off' };
    }
    if (cmd === 'state') {
      const session = browser.getRemoteBrowserSession(taskId);
      return session ? { ...session, shots: session.shots.length } : { session: null };
    }
    if (cmd === 'clear') {
      const removed = [];
      // The screenshots kept for good, in IndexedDB and beside each task in the user's folder.
      const shotsUrl = browserUrl ? await importedBy(browserUrl, 'remote-browser-shots.ts') : null;
      const shots = shotsUrl ? await import(shotsUrl).catch(() => null) : null;
      let tasksDir = null;
      try {
        const db = await new Promise((resolve, reject) => { const r = indexedDB.open('WillowLocalFS', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
        const record = await new Promise((resolve) => { const q = db.transaction('handles', 'readonly').objectStore('handles').get('local_projects_dir'); q.onsuccess = () => resolve(q.result); q.onerror = () => resolve(null); });
        const root = record && (record.handle || record);
        if (root && await root.queryPermission({ mode: 'readwrite' }) === 'granted') {
          tasksDir = await (await root.getDirectoryHandle('Spark')).getDirectoryHandle('Tasks');
        }
      } catch {}
      const folders = [];
      for (const id of [ids.pending, ids.answered]) {
        browser?.disposeRemoteBrowserSession(id);
        if (store.deleteSparkTask(id)) removed.push(id);
        await shots?.deleteRemoteBrowserShots(id).catch(() => {});
        if (tasksDir) {
          try { await tasksDir.removeEntry(id, { recursive: true }); folders.push(id); } catch {}
        }
      }
      // Every scope: index entries and task records alike.
      let otherScopes = 0;
      for (const key of Object.keys(localStorage)) {
        if (/^willow:spark:task:v\d+:/.test(key) && /seed-rb-/.test(key)) {
          localStorage.removeItem(key);
          continue;
        }
        if (!/^willow:spark:v\d+:/.test(key)) continue;
        try {
          const value = JSON.parse(localStorage.getItem(key));
          const before = value?.tasks?.length ?? 0;
          if (Array.isArray(value?.tasks)) value.tasks = value.tasks.filter((task) => !/^seed-rb-/.test(String(task.id)));
          if ((value?.tasks?.length ?? 0) !== before) {
            otherScopes += before - value.tasks.length;
            localStorage.setItem(key, JSON.stringify(value));
          }
        } catch {
          // Not a Spark index.
        }
      }
      return { removed, otherScopes, folders };
    }
    return { error: `unknown command ${cmd}` };
  }, command, args, { pending: PENDING_ID, answered: ANSWERED_ID });
}

(async () => {
  const [command = 'state', ...args] = process.argv.slice(2);
  // Named every time: the dev server's tab (:3000) holds the user's real tasks, and a default
  // once wrote fixtures there when a test origin (:3101) was meant.
  const base = process.env.WILLOW_URL;
  if (!base) throw new Error('set WILLOW_URL to the Willow origin to seed, e.g. http://localhost:3101');
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  // One target, not browser.pages(): that attaches to every tab and hangs on a frozen one.
  const target = browser.targets().find((candidate) => candidate.type() === 'page' && candidate.url().startsWith(base) && !candidate.url().includes('/media'));
  const page = target && await target.page();
  if (!page) throw new Error(`no Willow tab at ${base}`);
  if (command === 'open-spark') {
    // Spark is a studio experience, not a route: the sidebar's Chat / Spark switch selects it.
    const clicked = await page.evaluate(() => {
      const target = [...document.querySelectorAll('button, [role="tab"], [role="radio"]')]
        .find((el) => /^Spark/.test((el.textContent || '').trim()) && el.getBoundingClientRect().top < 120);
      if (!target) return false;
      target.click();
      return true;
    });
    await new Promise((resolve) => setTimeout(resolve, 4000));
    console.log(JSON.stringify({ clicked }));
    await browser.disconnect();
    return;
  }
  console.log(JSON.stringify(await run(page, command, args)));
  await browser.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
