/*
 * Dev only: stops a tab from reloading itself just because Chrome froze it.
 *
 * Freezing a page closes its WebSockets — Chrome does it to background tabs, and
 * to every tab while the laptop sits in Modern Standby — and Vite's client answers
 * any lost HMR socket by reloading the page as soon as it runs again, which is the
 * moment the tab is clicked. Instead, this asks the dev server (`hmrResumeState` in
 * vite.config.ts) whether it restarted or pushed a change meanwhile, and reloads
 * only then. Otherwise the page stays as it was; Vite's client has no socket left,
 * so the next change reloads the page rather than hot-swapping it.
 */

type HotContext = NonNullable<ImportMeta['hot']>;

interface ServerState {
  startedAt: number;
  changedAt: number;
}

const STATE_URL = '/__willow/hmr-state';

/** `null` while the server cannot be reached; `'unsupported'` if it has no such endpoint. */
async function readServerState(): Promise<ServerState | 'unsupported' | null> {
  let res: Response;
  try {
    res = await fetch(STATE_URL, { cache: 'no-store' });
  } catch {
    return null;
  }
  const state = res.ok ? await res.json().catch(() => null) : null;
  return state && typeof state.startedAt === 'number' && typeof state.changedAt === 'number'
    ? state
    : 'unsupported';
}

const untilVisible = (): Promise<void> => new Promise((resolve) => {
  if (document.visibilityState === 'visible') {
    resolve();
    return;
  }
  const onChange = () => {
    if (document.visibilityState !== 'visible') return;
    document.removeEventListener('visibilitychange', onChange);
    resolve();
  };
  document.addEventListener('visibilitychange', onChange);
});

const wait = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

export function installHmrResume(hot: HotContext): void {
  let known: ServerState | null = null;
  const syncWithServer = () => {
    void readServerState().then((state) => {
      if (state && state !== 'unsupported') known = state;
    });
  };
  syncWithServer();
  // An applied hot update brings the page level with the server again.
  hot.on('vite:afterUpdate', syncWithServer);

  let leaving = false;
  window.addEventListener('pagehide', () => { leaving = true; });

  const reloadOnNextChange = (socketUrl: string) => {
    const socket = new WebSocket(socketUrl, 'vite-hmr');
    socket.addEventListener('message', (event) => {
      let type: unknown;
      try {
        type = JSON.parse(String(event.data))?.type;
      } catch {
        return;
      }
      if (type === 'update' || type === 'full-reload') location.reload();
    });
    socket.addEventListener('close', () => { void resume(socketUrl); });
  };

  const resume = async (socketUrl: string): Promise<void> => {
    while (!leaving) {
      await untilVisible();
      const state = await readServerState();
      if (state === null) {
        await wait(1000);
        continue;
      }
      if (state === 'unsupported' || !known || state.startedAt !== known.startedAt || state.changedAt !== known.changedAt) {
        location.reload();
        return;
      }
      console.info('[willow] Lost the dev-server socket with nothing changed (the tab was frozen); kept the page. The next code change reloads it.');
      reloadOnNextChange(socketUrl);
      return;
    }
  };

  // Vite awaits its listeners before it polls and reloads, so a promise that
  // never settles is what holds its reload back.
  hot.on('vite:ws:disconnect', ({ webSocket }) => {
    void resume(webSocket.url);
    return new Promise<never>(() => {});
  });
}
