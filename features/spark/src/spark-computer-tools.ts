/**
 * The user's own computer, for a Spark task in the desktop app — the same reach the bots have (the local companion's
 * screen, `services/local-companion/src/screen.mjs`), shaped for a run that works in text: a task reads the open apps
 * and a window's controls, and acts on them by what they are, through the system's own accessibility (UI Automation on
 * Windows, Accessibility on macOS). These move nothing of the user's mouse — invoking a button is the system doing what
 * a click would — so a task and the user share the computer without getting in each other's way.
 *
 * Offered as MCP tools (`mcp__computer__*`) so they ride Spark's existing tool path with no change to its harness, and
 * only in the desktop app with the companion's screen within reach. The companion refuses Willow's own windows and
 * holds off while the user is at the computer, as it does for the bots.
 */
import { isDesktopApp } from '@willow/core/desktop-bridge';
import { localCompanion } from '@willow/code/local-companion';
import type { SparkMcpTool } from './harness/spark-tools';

type Platform = 'windows' | 'mac' | 'linux';

interface App { title?: string; app?: string; process?: string; pid?: number; window?: number; minimized?: boolean; foreground?: boolean; }
interface Element { index: number; role: string; name: string; value?: string; state?: string; actions?: string[]; }
interface Refused { ok?: false; refused?: string; message?: string; }

const refused = (value: unknown): value is Refused => Boolean(value) && typeof value === 'object' && 'refused' in (value as Record<string, unknown>);

const REFUSAL: Record<string, string> = {
  'user-active': 'The user is using their computer right now, so nothing was done. Try again shortly.',
  willow: 'That is Willow\'s own window, which a task never acts on. Nothing was done.',
  'willow-focus': 'Willow is the window in front, which a task never types into. Bring the window you mean to the front first.',
  locked: 'The user\'s screen is locked, so nothing was done.',
  stopped: 'The user stopped this, so nothing was done.',
};

const say = (value: Refused): string => REFUSAL[value.refused ?? ''] ?? value.message ?? 'The screen turned that away.';

const ask = async <T>(type: string, payload: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<T> =>
  localCompanion.request<T>(type, payload, timeoutMs);

export const appLine = (app: App, platform: Platform): string => {
  const name = app.title || app.app || app.process || 'untitled';
  const program = platform === 'windows' ? app.process : app.app;
  const ids = platform === 'windows' ? `pid ${app.pid}` : platform === 'mac' ? `window ${app.window}, pid ${app.pid}` : `window ${app.window}`;
  const marks = [app.foreground ? 'in front' : '', app.minimized ? 'minimized' : ''].filter(Boolean).join(', ');
  return `- "${name}"${program && program !== name ? ` (${program})` : ''} — ${ids}${marks ? `; ${marks}` : ''}`;
};

export const elementLine = (element: Element): string => {
  const parts = [`[${element.index}] ${element.role}${element.name ? ` "${element.name}"` : ''}`];
  if (element.value) parts.push(`value "${element.value}"`);
  if (element.state) parts.push(element.state);
  if (element.actions?.length) parts.push(element.actions.join(', '));
  return parts.join(' — ');
};

export const target = (args: Record<string, unknown>) => {
  const out: Record<string, unknown> = {};
  const pid = Math.round(Number(args.pid));
  if (Number.isInteger(pid) && pid > 0) out.pid = pid;
  if (typeof args.program === 'string' && args.program.trim()) out.process = args.program.trim().replace(/\.exe$/i, '');
  if (typeof args.title === 'string' && args.title.trim()) out.title = args.title.trim();
  const window = Math.round(Number(args.window));
  if (Number.isInteger(window) && window > 0) out.window = window;
  return out;
};

/** The computer-use tools for a Spark task, when the companion can reach the user's screen; empty otherwise. */
export const sparkComputerTools = async (): Promise<SparkMcpTool[]> => {
  if (!isDesktopApp()) return [];
  let platform: Platform;
  try {
    if (!(await localCompanion.connect(1_500))) return [];
    const named = localCompanion.capabilities.find((capability) => capability.startsWith('screen:'))?.slice('screen:'.length);
    if (named !== 'windows' && named !== 'mac' && named !== 'linux') return [];
    platform = named;
  } catch {
    return [];
  }

  const tool = (name: string, description: string, signature: string, call: (args: Record<string, unknown>) => Promise<unknown>): SparkMcpTool =>
    ({ name: `mcp__computer__${name}`, server: 'This computer', description, signature, call });

  const tools: SparkMcpTool[] = [
    tool('apps', 'List the windows open on the user\'s computer, each with how to reach it.', '{}', async () => {
      const result = await ask<{ apps: App[] } | Refused>('screen.apps', {}, 20_000);
      if (refused(result)) return say(result);
      if (!result.apps.length) return 'No windows are open.';
      return `Open windows:\n${result.apps.map((app) => appLine(app, platform)).join('\n')}`;
    }),
    tool('elements', platform === 'mac'
      ? 'List an app\'s controls — buttons, boxes, menu items — numbered, through Accessibility. "pid" from apps.'
      : 'List a window\'s controls — buttons, boxes, menu items, tabs — numbered, through UI Automation. Name it by "program", words in its "title", or "pid"; with none, the window in front.', '{ pid?: integer, program?: string, title?: string }', async (args) => {
      const result = await ask<{ snapshot: number; window: string; process?: string; elements: Element[]; truncated: boolean } | Refused>('screen.elements', target(args), 45_000);
      if (refused(result)) return say(result);
      if (!result.elements.length) return `"${result.window}" offers no controls to work by number.`;
      return `Controls of "${result.window}"${result.process ? ` (${result.process})` : ''}, list ${result.snapshot}:\n${result.elements.map(elementLine).join('\n')}${result.truncated ? '\n(more follow; narrow the window or work what is listed)' : ''}`;
    }),
    tool('act', 'Work a control by its number in an elements list — "list" is that list\'s number: "invoke" a button, "toggle" a checkbox, "select" an item, "expand"/"collapse", or "set_value" a box with "value". List again if the app has changed.', '{ list: integer, index: integer, action: string, value?: string }', async (args) => {
      const snapshot = Math.round(Number(args.list ?? args.snapshot));
      const index = Math.round(Number(args.index));
      const action = String(args.action ?? 'invoke').toLowerCase();
      const result = await ask<{ ok: true; name?: string } | Refused>('screen.element', { snapshot, index, action, ...(action === 'set_value' ? { value: String(args.value ?? '') } : {}) }, 20_000);
      if (refused(result)) return say(result);
      return `Done${result.name ? `: ${result.name}` : ''}.`;
    }),
    tool('focus', 'Bring a window to the front so typing reaches it. Name it as for elements.', '{ pid?: integer, program?: string, title?: string, window?: integer }', async (args) => {
      const result = await ask<{ ok: true; title?: string; foreground?: boolean } | Refused>('screen.focus', target(args), 20_000);
      if (refused(result)) return say(result);
      return result.foreground === false ? 'That window would not come to the front.' : `Brought ${result.title ? `"${result.title}"` : 'the window'} to the front.`;
    }),
    tool('type', platform === 'mac' ? 'Type into an app in the background — "pid" from apps — or, without it, the app in front; a new line is Return.' : 'Type into whatever has the focus; a new line is Enter. Focus the window first.', platform === 'mac' ? '{ text: string, pid?: integer }' : '{ text: string }', async (args) => {
      const text = String(args.text ?? '');
      if (!text) return 'Give the "text" to type.';
      const pid = Math.round(Number(args.pid));
      const result = await ask<{ ok: true } | Refused>('screen.act', { kind: 'type', text, ...(platform === 'mac' && pid > 0 ? { pid } : {}) }, 60_000 + text.length * 20);
      return refused(result) ? say(result) : `Typed ${text.length} character${text.length === 1 ? '' : 's'}.`;
    }),
    tool('key', platform === 'mac' ? 'Press a key in an app in the background — "pid" from apps — or the app in front: Return, Tab, an arrow, or cmd/ctrl/option/shift joined by +.' : 'Press a key for whatever has the focus: Enter, Tab, Escape, an arrow, F5, or ctrl/shift/alt joined by +.', platform === 'mac' ? '{ key: string, pid?: integer }' : '{ key: string }', async (args) => {
      const key = String(args.key ?? '');
      if (!key.trim()) return 'Give the "key" to press.';
      const pid = Math.round(Number(args.pid));
      const result = await ask<{ ok: true } | Refused>('screen.act', { kind: 'key', key, ...(platform === 'mac' && pid > 0 ? { pid } : {}) }, 30_000);
      return refused(result) ? say(result) : `Pressed ${key}.`;
    }),
  ];

  if (platform === 'linux') {
    tools.push(tool('open_app', 'Open an app on the task\'s own desktop (off the user\'s screen). "command" is how it starts, such as firefox.', '{ command: string }', async (args) => {
      const command = String(args.command ?? '').trim();
      if (!command) return 'Give the "command" that opens the app.';
      const result = await ask<{ ok: true; started?: string } | Refused>('screen.launch', { command }, 30_000);
      return refused(result) ? say(result) : `Started ${(result as { started?: string }).started ?? command} on the task's desktop.`;
    }));
  }

  return tools;
};
