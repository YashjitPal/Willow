/**
 * Willow's Android app (apps/android): a WebView showing Willow's page from the user's computer,
 * where the agents' server serves it to paired phones (vendor/t3code apps/server
 * src/willow/mobile.ts). The app sets `window.__WILLOW_ANDROID__` before Willow's scripts run;
 * messages to the app go through its `post`, and the app's answers come back to its `listeners`.
 */
export interface WillowAndroid {
  version: number;
  /** The agents' server, through the app's own tunnel to the computer. */
  agentsOrigin: string;
  /** The phone tools its owner lets agents use; none while that is off. */
  tools: string[];
  listeners: Array<(message: unknown) => void>;
  post: (message: unknown) => void;
}

export const androidApp = (): WillowAndroid | null => {
  if (typeof window === 'undefined') return null;
  const app = (window as { __WILLOW_ANDROID__?: Partial<WillowAndroid> }).__WILLOW_ANDROID__;
  return app && typeof app.post === 'function' && typeof app.agentsOrigin === 'string' && Array.isArray(app.listeners)
    ? (app as WillowAndroid)
    : null;
};

export const isAndroidApp = (): boolean => androidApp() !== null;

/** The agent tabs' server on a phone: its origin through the app, and a sign-in the computer issues this paired phone. */
export const androidHarnessConnection = async (): Promise<{ url: string; token: string }> => {
  const app = androidApp();
  if (!app) throw new Error('This is not Willow’s Android app.');
  const response = await fetch('/api/willow/harness', { method: 'POST', credentials: 'same-origin' });
  const body = (await response.json().catch(() => ({}))) as { token?: unknown; error?: unknown };
  if (!response.ok || typeof body.token !== 'string') {
    throw new Error(typeof body.error === 'string' ? body.error : 'The computer did not let this phone into the agents.');
  }
  return { url: app.agentsOrigin, token: body.token };
};

const PHONE_ID_KEY = 'willow_phone_id';
/** Longer than the camera and the user's answer may take. */
const APP_ANSWER_MS = 200_000;
const RETRY_MS = 5_000;

interface PhoneCall {
  id: string;
  tool: string;
  args: unknown;
}

interface AppAnswer {
  ok: boolean;
  result?: unknown;
  error?: string;
}

const phoneId = (): string => {
  let id = localStorage.getItem(PHONE_ID_KEY);
  if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    id = crypto.randomUUID().replace(/-/g, '');
    localStorage.setItem(PHONE_ID_KEY, id);
  }
  return id;
};

const postJson = (path: string, body: unknown) =>
  fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'same-origin',
  });

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

let started = false;

/**
 * The phone's side of Willow on Android: the computer's local companion (code, bots and Spark on
 * the computer) through the phone listener, and the agents' `phone_*` tools, which this page
 * long-polls the computer for and hands to the app.
 */
export function startAndroidPhone(): void {
  const app = androidApp();
  if (!app || started) return;
  started = true;
  void fetch('/api/willow/session', { credentials: 'same-origin' })
    .then((response) => response.json() as Promise<{ companion?: unknown }>)
    .then((session) => {
      if (session.companion !== true) return;
      // The listener adds the companion's own token on the computer.
      localStorage.setItem('willow_companion_url', `${window.location.origin.replace(/^http/, 'ws')}/api/willow/companion`);
      localStorage.removeItem('willow_companion_token');
    })
    .catch(() => undefined);
  void relay(app);
}

async function relay(app: WillowAndroid) {
  const phone = phoneId();
  const answers = new Map<string, (answer: AppAnswer) => void>();
  app.listeners.push((message) => {
    const data = message as { kind?: unknown; id?: unknown; ok?: unknown; result?: unknown; error?: unknown } | null;
    if (!data || data.kind !== 'phone-result' || typeof data.id !== 'string') return;
    const settle = answers.get(data.id);
    answers.delete(data.id);
    settle?.({ ok: data.ok === true, result: data.result, ...(typeof data.error === 'string' ? { error: data.error } : {}) });
  });

  const run = (call: PhoneCall) =>
    new Promise<AppAnswer>((resolve) => {
      const timer = window.setTimeout(() => {
        answers.delete(call.id);
        resolve({ ok: false, error: 'The Willow app did not answer.' });
      }, APP_ANSWER_MS);
      answers.set(call.id, (answer) => {
        window.clearTimeout(timer);
        resolve(answer);
      });
      app.post({ kind: 'phone-call', id: call.id, tool: call.tool, args: call.args ?? {} });
    }).then((answer) => postJson('/api/willow/phone/result', { phone, id: call.id, ...answer }).catch(() => undefined));

  let offered = '';
  for (;;) {
    try {
      const tools = JSON.stringify(Array.isArray(app.tools) ? app.tools : []);
      if (tools !== offered) {
        const response = await postJson('/api/willow/phone/hello', { phone, tools: JSON.parse(tools), label: 'Android phone' });
        if (!response.ok) throw new Error(String(response.status));
        offered = tools;
      }
      const response = await fetch(`/api/willow/phone/next?phone=${encodeURIComponent(phone)}`, { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error(String(response.status));
      const { calls } = (await response.json()) as { calls?: PhoneCall[] };
      for (const call of Array.isArray(calls) ? calls : []) {
        if (call && typeof call.id === 'string' && typeof call.tool === 'string') void run(call);
      }
    } catch {
      offered = '';
      await sleep(RETRY_MS);
    }
  }
}
