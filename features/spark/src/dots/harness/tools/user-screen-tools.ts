/**
 * The user's own computer, once they connect it in the desktop app — their screen, and the apps and controls on it —
 * each system the way it is done best there (`runtime/screen-bridge.ts`):
 *
 * - Windows: the one desktop the user is looking at, shared with them. The same computer-use loop as on the bot's own
 *   computer — look, act at a position, see the screen the action left, marked where it landed — in the positions the
 *   model points in (`runtime/screen-view.ts`), one monitor at a time; plus the open apps, and a window's controls by
 *   what they are, through UI Automation. While the bot acts an overlay shows it: a glow, a pill with Stop and Esc,
 *   and the bot's own cursor travelling to each action.
 * - macOS: in the background, app by app. The bot reads a window, lists its controls through Accessibility and works
 *   them by what they are, or types into the app — without taking the user's screen or focus.
 * - Linux: a desktop of the bot's own, off the user's display. The bot opens apps there and works them with the same
 *   look-and-point loop; the user's own screen is never touched.
 *
 * Every tool first needs the user's go-ahead for their screen (`runtime/screen-control.ts`): a card they allow, or —
 * when they let the bot act without asking — a grant it has at once. The go-ahead is shared with them, so the Windows
 * helper holds off while they are using the computer, and no tool ever acts on Willow's own windows.
 */
import type { Attachment } from '@willow/ai/chat';
import type { DotToolContext, DotToolResult } from '../runtime/protocol';
import type { DotScreenApp, DotScreenBridge, DotScreenElement, DotScreenPlatform, DotScreenRefused, DotScreenShot, DotScreenTarget } from '../runtime/screen-bridge';
import { activeScreen, declinedScreen, endLapsedScreen, pendingScreenRequests, requestScreen, touchScreen, type DotScreenDeps } from '../runtime/screen-control';
import { showScreenOverlay } from '../runtime/screen-overlay';
import { closerLook, fromScreen, howToPoint, pointsIn, regionOnScreen, toScreen, viewOf, type Mark, type ScreenGeometry } from '../runtime/screen-view';
import { getDotThread } from '../thread/thread-store';
import { fail, ok, permissionsNow, stringArg, type DotToolEntry, type DotToolEnv } from './tool-env';

export type DotUserScreenEnv = DotToolEnv & { screen: { bridge: DotScreenBridge; deps: DotScreenDeps; platform: DotScreenPlatform; color?: string } };

/** Windows shares the one desktop and Linux gives the bot one of its own; both are pointed at by position. */
const isPointable = (platform: DotScreenPlatform): boolean => platform === 'windows' || platform === 'linux';

/**
 * The latest picture of the user's screen each bot was sent: which monitor, where it sits, what positions mean, and
 * the way of pointing it was drawn for — another model's picture means nothing to this one.
 */
const seenBy = new Map<string, { geometry: ScreenGeometry; monitor: number; window?: number; left: number; top: number; profile: unknown }>();
const seen = {
  get: (env: DotUserScreenEnv) => {
    const last = seenBy.get(env.dotId);
    return last && last.profile === env.vision?.profile ? last : undefined;
  },
};

const spaceWords = (env: DotUserScreenEnv): string => pointsIn(env.vision?.profile.space ?? 'pixels');

const REFUSALS: Record<DotScreenRefused['refused'], string> = {
  'user-active': 'The user kept using their computer — the mouse or the keyboard — for the last half minute, so nothing was done. Ask them in a message whether you should go on, and carry on when they say.',
  willow: 'That is Willow\'s own window, which you never act on, so nothing was done. Reach what you need another way — another window, the taskbar — or ask the user.',
  'willow-focus': 'Willow is the window in front, and you never type into it, so nothing was done. Bring the window you mean to the front first.',
  locked: 'The user\'s screen is locked, or the system is showing a prompt only they can answer, so nothing was done.',
  stopped: 'The user stopped you using their screen, so nothing was done. Leave it alone unless they ask you to use it again.',
};

const refusal = (outcome: DotScreenRefused): DotToolResult => fail(REFUSALS[outcome.refused] ?? outcome.message);

const isRefused = (value: unknown): value is DotScreenRefused => Boolean(value) && typeof value === 'object' && 'refused' in (value as Record<string, unknown>);

/** How long an action waits for the user to stop using their computer, and how often it looks. */
export const USER_QUIET_WAIT_MS = 30_000;
const USER_QUIET_POLL_MS = 600;

/**
 * An action held off because the user moved the mouse or typed a moment ago waits where it is and goes ahead once they
 * stop — moving the mouse or typing pauses the bot, it does not end its work. Left to the bot, a refusal it cannot wait
 * out ends the task. Only when the user keeps at it for half a minute does the bot hear of it.
 */
export const patiently = async <T>(context: Pick<DotToolContext, 'signal' | 'activity'>, run: () => Promise<T>, waitMs = USER_QUIET_WAIT_MS): Promise<T> => {
  const until = Date.now() + waitMs;
  let outcome = await run();
  let waited = false;
  while (isRefused(outcome) && outcome.refused === 'user-active' && Date.now() < until && !context.signal?.aborted) {
    if (!waited) context.activity?.('Waiting for you to finish');
    waited = true;
    await new Promise((resolve) => setTimeout(resolve, USER_QUIET_POLL_MS));
    outcome = await run();
  }
  if (waited) context.activity?.(null);
  return outcome;
};

/** patiently, for as long as this bot's screen waits for the user. */
const quietly = <T>(env: DotUserScreenEnv, context: Pick<DotToolContext, 'signal' | 'activity'>, run: () => Promise<T>): Promise<T> =>
  patiently(context, run, env.screen.waitForUserMs ?? USER_QUIET_WAIT_MS);

const problem = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return /not running|unavailable|disconnected|timed out/i.test(message) ? "Willow can't reach the user's screen right now: its companion is not running." : message;
};

/** The grant in force, if any, as the bot acts under it: its id goes with each action so one the user stopped is refused. */
const grantNow = (env: DotUserScreenEnv): string | undefined => {
  const thread = getDotThread(env.dotId);
  return thread ? activeScreen(thread, env.now())?.itemId : undefined;
};

/**
 * The user's go-ahead for their screen: null when the bot has it — and the overlay, on Windows, is shown for it — else
 * what to tell the bot, that it asked, or why it cannot.
 */
const goAhead = (env: DotUserScreenEnv, context: DotToolContext, reason: string | undefined): DotToolResult | null => {
  const thread = getDotThread(env.dotId);
  if (!thread?.runtime.computer) return fail('The user has not connected their computer, so their screen is out of reach.');
  endLapsedScreen(env.dotId, env.now());
  const latest = getDotThread(env.dotId)!;
  const grant = activeScreen(latest, env.now());
  if (grant) {
    touchScreen(env.dotId, env.now());
    void showScreenOverlay(env.screen.bridge, { dotId: env.dotId, grant: grant.itemId, name: env.dotName, color: env.screen.color });
    return null;
  }
  const pending = pendingScreenRequests(latest)[0];
  if (pending) return ok(`You already asked to see and use the user's screen (${pending.id}), so nothing was done. You will hear when they decide.`);
  const declined = declinedScreen(latest);
  if (declined) return fail(`The user declined to let you use their screen (${declined.id}). Ask them in a message before you ask again, and only if the work truly needs it.`);
  const atOnce = permissionsNow(env) === 'act';
  const item = requestScreen(env.dotId, { reason: reason?.slice(0, 300) || 'To work on your screen.', turnId: context.turnId, atOnce, now: env.now() });
  if (atOnce) {
    void showScreenOverlay(env.screen.bridge, { dotId: env.dotId, grant: item.id, name: env.dotName, color: env.screen.color });
    return null;
  }
  return ok(`Asked the user to let you see and use their screen (${item.id}), so nothing was done yet. You will hear when they decide: carry on with anything that does not need their screen, or end your turn.`);
};

const sinceTouch = (shot: DotScreenShot): string => {
  const idle = shot.userIdleMs;
  if (typeof idle !== 'number' || idle >= 15_000) return '';
  return ` They used the mouse or keyboard ${Math.max(1, Math.round(idle / 1_000))} second${Math.round(idle / 1_000) === 1 ? '' : 's'} ago, so they may be at the computer: do not get in their way.`;
};

const front = (shot: Pick<DotScreenShot, 'foreground'>): string =>
  shot.foreground?.title ? ` The window in front is "${shot.foreground.title}"${shot.foreground.willow ? ' — Willow itself, which you never act on' : ''}.` : '';

const capture = async (env: DotUserScreenEnv, target?: { monitor?: number; window?: number }): Promise<DotScreenShot | DotToolResult> => {
  try {
    const shot = await env.screen.bridge.capture(target);
    if (isRefused(shot)) return refusal(shot);
    return shot;
  } catch (error) {
    return fail(problem(error));
  }
};

/** A picture of the user's screen as the bot is sent it, marked where it acted; its geometry becomes the bot's. */
const look = async (env: DotUserScreenEnv, shot: DotScreenShot, marks: Mark[] = []): Promise<{ images: Attachment[]; geometry: ScreenGeometry; marked: boolean }> => {
  const { picture, geometry, marked } = await viewOf(env.vision, { data: shot.data, width: shot.width, height: shot.height }, marks);
  seenBy.set(env.dotId, { geometry, monitor: shot.monitor ?? 1, ...(shot.window ? { window: shot.window } : {}), left: shot.left ?? 0, top: shot.top ?? 0, profile: env.vision?.profile });
  return { images: [{ type: 'image', mimeType: picture.mimeType ?? 'image/jpeg', data: picture.data }], geometry, marked };
};

const isShot = (value: DotScreenShot | DotToolResult): value is DotScreenShot => 'data' in value;

/** A position the bot gave on its latest picture, as a point on the user's desktop and on that monitor. */
const onScreen = (env: DotUserScreenEnv, args: Record<string, unknown>, xName = 'x', yName = 'y') => {
  const last = seen.get(env);
  if (!last) return 'Take a screenshot of the user\'s screen first: positions are on your latest one.';
  const given = { x: Number(args[xName]), y: Number(args[yName]) };
  if (!Number.isFinite(given.x) || !Number.isFinite(given.y)) return `Give "${xName}" and "${yName}": ${spaceWords(env)}.`;
  const local = toScreen(last.geometry, given);
  if (!local) return `(${given.x}, ${given.y}) is not on your screenshot. Use ${spaceWords(env)}.`;
  return { given, local, desktop: { x: last.left + local.x, y: last.top + local.y }, monitor: last.monitor };
};

/** Does the action, then shows the screen it left, marked where it acted. */
const act = async (env: DotUserScreenEnv, context: DotToolContext, summary: string, action: Parameters<DotScreenBridge['act']>[0], monitor: number | undefined, marks: Mark[]): Promise<DotToolResult> => {
  try {
    const outcome = await quietly(env, context, () => env.screen.bridge.act({ ...action, ...(grantNow(env) ? { grant: grantNow(env) } : {}) }));
    if (isRefused(outcome)) return refusal(outcome);
  } catch (error) {
    return fail(problem(error));
  }
  touchScreen(env.dotId, env.now());
  const after = await capture(env, monitor === undefined ? undefined : { monitor });
  if (!isShot(after)) return { observation: `${summary} The screen could not be seen afterwards: take a screenshot before you go on.` };
  const view = await look(env, after, marks);
  const check = view.marked ? ', a ring marking where you acted: check it landed where you meant before you go on' : '';
  return { observation: `${summary}${front(after)} The screen afterwards comes with this step's results${check}.`, images: view.images };
};

const reasonArg = (args: Record<string, unknown>) => stringArg(args, 'reason');

/** Which app on macOS each bot last looked at or listed the controls of: where its typing goes, in the background. */
const appBy = new Map<string, number>();

/* ------------------------------------------------------------------------ */
/* Looking                                                                    */
/* ------------------------------------------------------------------------ */

const SCREENSHOT_DOCS: Record<DotScreenPlatform, (env: DotUserScreenEnv) => { args: string; description: string }> = {
  windows: (env) => ({
    args: '{"monitor": 1, "wait": 0, "reason": "…"}',
    description: `See the user's own screen as it is now: one monitor, 1 being their main one. The user_desktop_ tools take ${spaceWords(env)}. "wait" first gives something still opening that many seconds, up to 10. The first time, the user is asked to let you see and use their screen; say why in "reason".`,
  }),
  linux: (env) => ({
    args: '{"wait": 0, "reason": "…"}',
    description: `See your desktop on the user's computer as it is now: a display of your own, off their screen, where the apps you open with user_open_app run. The user_desktop_ tools take ${spaceWords(env)}. "wait" first gives something still opening that many seconds, up to 10. The first time, the user is asked to let you use their computer this way; say why in "reason".`,
  }),
  mac: () => ({
    args: '{"window": 123, "wait": 0, "reason": "…"}',
    description: 'See one of the user\'s windows as it is now, captured where it stands — it need not be in front, and nothing on their screen moves. "window" is its id from user_apps. Read it, then work its controls with user_elements and user_element. The first time, the user is asked to let you see and use their apps; say why in "reason".',
  }),
};

const screenshotTool = (env: DotUserScreenEnv): DotToolEntry => ({
  doc: { name: 'user_screenshot', ...SCREENSHOT_DOCS[env.screen.platform](env) },
  handler: {
    id: 'user_screenshot',
    run: async (args, context) => {
      const blocked = goAhead(env, context, reasonArg(args));
      if (blocked) return blocked;
      const wait = Math.max(0, Math.min(10, Number(args.wait) || 0));
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait * 1_000));
      if (env.screen.platform === 'mac') {
        const window = Math.round(Number(args.window)) || 0;
        if (!window) return fail('Give the "window" to look at: its id from user_apps.');
        const shot = await capture(env, { window });
        if (!isShot(shot)) return shot;
        const listed = await env.screen.bridge.apps().catch(() => null);
        const app = listed && !isRefused(listed) ? listed.apps.find((entry) => entry.window === window) : undefined;
        if (app?.pid) appBy.set(env.dotId, app.pid);
        const view = await look(env, shot);
        return {
          observation: `${app ? `"${app.title || app.app}" in ${app.app}` : `Window ${window}`}, as it is now. Its controls are not reached by position here: list them with user_elements${app?.pid ? ` (pid ${app.pid})` : ''} and work them by number. The picture comes with this step's results and is not kept.`,
          images: view.images,
        };
      }
      const monitor = env.screen.platform === 'windows' && args.monitor !== undefined ? Math.round(Number(args.monitor)) || undefined : undefined;
      const shot = await capture(env, monitor === undefined ? undefined : { monitor });
      if (!isShot(shot)) return shot;
      const view = await look(env, shot);
      if (env.screen.platform === 'linux') {
        return { observation: `Screenshot of your desktop on the user's computer. ${howToPoint(view.geometry)} The picture comes with this step's results and is not kept: take another to look again later.`, images: view.images };
      }
      const which = (shot.monitors ?? 1) > 1 ? ` — screen ${shot.monitor} of ${shot.monitors}${shot.primary ? ', their main one' : ''}` : '';
      return {
        observation: `Screenshot of the user's screen${which}.${front(shot)} ${howToPoint(view.geometry)}${sinceTouch(shot)} The picture comes with this step's results and is not kept: take another to look again later.`,
        images: view.images,
      };
    },
  },
});

const zoomTool = (env: DotUserScreenEnv): DotToolEntry => ({
  doc: {
    name: 'user_zoom',
    args: '{"x": 400, "y": 300, "width": 200, "height": 150}',
    description: `Look closer at part of your latest screenshot, to read small text or find a small target: the region with its top left at "x", "y" and that "width" and "height", in ${spaceWords(env)}. It comes magnified, with rulers along its edges in those same positions${isPointable(env.screen.platform) ? ': act with what the rulers say, as on a screenshot' : ''}.`,
  },
  handler: {
    id: 'user_zoom',
    run: async (args, context) => {
      const blocked = goAhead(env, context, undefined);
      if (blocked) return blocked;
      const last = seen.get(env);
      if (!last) return fail('Take a screenshot first: a closer look is of part of your latest one.');
      if (!env.vision) return fail('A closer look cannot be drawn here; take a screenshot instead.');
      const region = { x: Number(args.x), y: Number(args.y), width: Number(args.width), height: Number(args.height) };
      if (![region.x, region.y, region.width, region.height].every(Number.isFinite) || region.width <= 0 || region.height <= 0) {
        return fail(`Give "x" and "y" for the region's top left and its "width" and "height", in ${spaceWords(env)}.`);
      }
      const crop = regionOnScreen(last.geometry, region);
      if (!crop) return fail(`That region is not on your screenshot, or too small to magnify. Use ${spaceWords(env)}.`);
      const shot = await capture(env, last.window ? { window: last.window } : env.screen.platform === 'windows' ? { monitor: last.monitor } : undefined);
      if (!isShot(shot)) return shot;
      const closer = await closerLook(env.vision, { data: shot.data, width: shot.width, height: shot.height }, last.geometry, crop);
      if (!closer) return fail('A closer look could not be drawn; take a screenshot instead.');
      return {
        observation: `A closer look at (${Math.round(region.x)}, ${Math.round(region.y)}) to (${Math.round(region.x + region.width)}, ${Math.round(region.y + region.height)}), magnified ${closer.magnified}×, as it is now. Its rulers are in your usual positions${isPointable(env.screen.platform) ? ': act with them' : ''}.`,
        images: [{ type: 'image', mimeType: closer.picture.mimeType ?? 'image/jpeg', data: closer.picture.data }],
      };
    },
  },
});

/* ------------------------------------------------------------------------ */
/* Pointing and typing: Windows' shared desktop, and Linux's desktop of its own */
/* ------------------------------------------------------------------------ */

const whose = (env: DotUserScreenEnv): string => (env.screen.platform === 'linux' ? 'your desktop on the user\'s computer' : 'the user\'s screen');

const clickTool = (env: DotUserScreenEnv): DotToolEntry => ({
  doc: {
    name: 'user_desktop_click',
    args: '{"x": 500, "y": 400, "button": "left", "clicks": 1, "hold": ""}',
    description: `Click a point on ${whose(env)}, at ${spaceWords(env)}. "button" is left, right or middle; "clicks": 2 double-clicks; "hold" keeps keys down through the click, such as "ctrl" or "shift". The screen afterwards comes back with a ring where the click landed.`,
  },
  handler: {
    id: 'user_desktop_click',
    run: async (args, context) => {
      const blocked = goAhead(env, context, reasonArg(args));
      if (blocked) return blocked;
      const target = onScreen(env, args);
      if (typeof target === 'string') return fail(target);
      const button = (stringArg(args, 'button') ?? 'left').toLowerCase();
      const clicks = Math.max(1, Math.min(3, Math.round(Number(args.clicks ?? 1)) || 1));
      const hold = stringArg(args, 'hold');
      const verb = clicks === 2 ? 'Double-clicked' : clicks === 3 ? 'Triple-clicked' : button === 'right' ? 'Right-clicked' : button === 'middle' ? 'Middle-clicked' : 'Clicked';
      return act(env, context, `${verb}${hold ? ` holding ${hold}` : ''} at (${target.given.x}, ${target.given.y}).`, { kind: 'click', ...target.desktop, button, clicks, ...(hold ? { hold } : {}) }, target.monitor, [{ at: target.local, kind: 'point' }]);
    },
  },
});

const moveTool = (env: DotUserScreenEnv): DotToolEntry => ({
  doc: {
    name: 'user_desktop_move',
    args: '{"x": 500, "y": 400}',
    description: `Move the pointer on ${whose(env)} to a point, at ${spaceWords(env)}, and leave it there: for what shows on hover, or to check where a click would land before you make it.`,
  },
  handler: {
    id: 'user_desktop_move',
    run: async (args, context) => {
      const blocked = goAhead(env, context, reasonArg(args));
      if (blocked) return blocked;
      const target = onScreen(env, args);
      if (typeof target === 'string') return fail(target);
      return act(env, context, `Moved the pointer to (${target.given.x}, ${target.given.y}).`, { kind: 'move', ...target.desktop }, target.monitor, [{ at: target.local, kind: 'point' }]);
    },
  },
});

const scrollTool = (env: DotUserScreenEnv): DotToolEntry => ({
  doc: {
    name: 'user_desktop_scroll',
    args: '{"x": 500, "y": 400, "deltaY": 300}',
    description: `Scroll what is under a point on ${whose(env)}, at ${spaceWords(env)}: down by "deltaY" screen pixels, or up when it is negative; "deltaX" scrolls sideways.`,
  },
  handler: {
    id: 'user_desktop_scroll',
    run: async (args, context) => {
      const blocked = goAhead(env, context, reasonArg(args));
      if (blocked) return blocked;
      const target = onScreen(env, args);
      if (typeof target === 'string') return fail(target);
      const deltaY = Number(args.deltaY ?? 0);
      const deltaX = Number(args.deltaX ?? 0);
      if (!Number.isFinite(deltaY) || !Number.isFinite(deltaX) || (!deltaY && !deltaX)) return fail('Give "deltaY": pixels to scroll down, or up when it is negative.');
      const words = deltaY ? `${deltaY < 0 ? 'up' : 'down'} ${Math.abs(deltaY)}` : `${deltaX < 0 ? 'left' : 'right'} ${Math.abs(deltaX)}`;
      return act(env, context, `Scrolled ${words} pixels at (${target.given.x}, ${target.given.y}).`, { kind: 'scroll', ...target.desktop, deltaY, deltaX }, target.monitor, [{ at: target.local, kind: 'point' }]);
    },
  },
});

const dragTool = (env: DotUserScreenEnv): DotToolEntry => ({
  doc: {
    name: 'user_desktop_drag',
    args: '{"x": 200, "y": 300, "toX": 500, "toY": 300}',
    description: `Drag on ${whose(env)}: press the left button at one point, move to another and let go. Both points are ${spaceWords(env)}.`,
  },
  handler: {
    id: 'user_desktop_drag',
    run: async (args, context) => {
      const blocked = goAhead(env, context, reasonArg(args));
      if (blocked) return blocked;
      const from = onScreen(env, args);
      if (typeof from === 'string') return fail(from);
      const to = onScreen(env, args, 'toX', 'toY');
      if (typeof to === 'string') return fail(to);
      return act(env, context, `Dragged from (${from.given.x}, ${from.given.y}) to (${to.given.x}, ${to.given.y}).`, { kind: 'drag', ...from.desktop, toX: to.desktop.x, toY: to.desktop.y }, from.monitor, [{ at: from.local, kind: 'from' }, { at: to.local, kind: 'point' }]);
    },
  },
});

/** Typing and keys on macOS go to one app, in the background; what the window looks like after comes back. */
const actInApp = async (env: DotUserScreenEnv, context: DotToolContext, summary: string, action: Parameters<DotScreenBridge['act']>[0]): Promise<DotToolResult> => {
  const pid = appBy.get(env.dotId);
  if (!pid) return fail('Look at a window with user_screenshot, or list an app\'s controls with user_elements, first: typing goes to that app.');
  try {
    const outcome = await quietly(env, context, () => env.screen.bridge.act({ ...action, pid, ...(grantNow(env) ? { grant: grantNow(env) } : {}) }));
    if (isRefused(outcome)) return refusal(outcome);
  } catch (error) {
    return fail(problem(error));
  }
  touchScreen(env.dotId, env.now());
  const window = seen.get(env)?.window;
  if (!window) return ok(`${summary} Look at the window again to see what it did.`);
  const after = await capture(env, { window });
  if (!isShot(after)) return ok(`${summary} The window could not be seen afterwards: look at it again before you go on.`);
  const view = await look(env, after);
  return { observation: `${summary} The window afterwards comes with this step's results.`, images: view.images };
};

const typeTool = (env: DotUserScreenEnv): DotToolEntry => ({
  doc: {
    name: 'user_desktop_type',
    args: '{"text": "…"}',
    description: env.screen.platform === 'mac'
      ? 'Type into the app you last looked at, in the background, into whatever has its focus there; a new line presses Return. To fill a box, set its value with user_element instead. Never type a password or a code: ask the user to type it themselves.'
      : `Type on ${env.screen.platform === 'linux' ? 'your desktop' : 'the user\'s keyboard'}, into whatever has the focus; a new line presses Enter. Click where the text goes first, and never type a password or a code: ask the user to type it themselves.`,
  },
  handler: {
    id: 'user_desktop_type',
    run: async (args, context) => {
      const blocked = goAhead(env, context, reasonArg(args));
      if (blocked) return blocked;
      if (typeof args.text !== 'string' || !args.text) return fail('Give the "text" to type.');
      if (args.text.length > 5_000) return fail('Type at most 5,000 characters at a time.');
      const summary = `Typed ${args.text.length} character${args.text.length === 1 ? '' : 's'}.`;
      if (env.screen.platform === 'mac') return actInApp(env, context, summary, { kind: 'type', text: args.text });
      return act(env, context, summary, { kind: 'type', text: args.text }, seen.get(env)?.monitor, []);
    },
  },
});

const keyTool = (env: DotUserScreenEnv): DotToolEntry => ({
  doc: {
    name: 'user_desktop_key',
    args: env.screen.platform === 'mac' ? '{"key": "cmd+s"}' : '{"key": "ctrl+s"}',
    description: env.screen.platform === 'mac'
      ? 'Press a key in the app you last looked at, in the background: Return, Escape, Tab, an arrow, or a combination with cmd, ctrl, option or shift joined by +.'
      : `Press a key on ${env.screen.platform === 'linux' ? 'your desktop' : 'the user\'s keyboard'}, for whatever has the focus: Enter, Escape, Tab, an arrow, F5, or a combination with ctrl, shift, alt or ${env.screen.platform === 'linux' ? 'super' : 'win'} joined by +.`,
  },
  handler: {
    id: 'user_desktop_key',
    run: async (args, context) => {
      const blocked = goAhead(env, context, reasonArg(args));
      if (blocked) return blocked;
      const key = stringArg(args, 'key');
      if (!key) return fail('Give the "key" to press.');
      if (env.screen.platform === 'mac') return actInApp(env, context, `Pressed ${key}.`, { kind: 'key', key });
      return act(env, context, `Pressed ${key}.`, { kind: 'key', key }, seen.get(env)?.monitor, []);
    },
  },
});

/* ------------------------------------------------------------------------ */
/* Apps and their controls                                                    */
/* ------------------------------------------------------------------------ */

const appLine = (app: DotScreenApp, platform: DotScreenPlatform): string => {
  const name = app.title || app.app || app.process || 'untitled';
  const program = platform === 'windows' ? app.process : platform === 'mac' ? app.app : undefined;
  const ids = platform === 'windows' ? `pid ${app.pid}` : platform === 'mac' ? `window ${app.window}, pid ${app.pid}` : `window ${app.window}`;
  const marks = [app.foreground ? 'in front' : '', app.minimized ? 'minimized' : ''].filter(Boolean).join(', ');
  return `- "${name}"${program && program !== name ? ` (${program})` : ''} — ${ids}${marks ? `; ${marks}` : ''}`;
};

const appsTool = (env: DotUserScreenEnv): DotToolEntry => ({
  doc: {
    name: 'user_apps',
    args: '{}',
    description: env.screen.platform === 'mac'
      ? 'List the windows open on the user\'s Mac, front to back, each with its app, window id and pid: the window id for user_screenshot, the pid for user_elements.'
      : env.screen.platform === 'linux'
        ? 'List the windows open on your desktop on the user\'s computer, each with its window id.'
        : 'List the windows open on the user\'s computer, front to back, each with its program and pid — to find the app the work is in, and to reach its controls with user_elements.',
  },
  handler: {
    id: 'user_apps',
    run: async (args, context) => {
      const blocked = goAhead(env, context, reasonArg(args));
      if (blocked) return blocked;
      try {
        const listed = await env.screen.bridge.apps();
        if (isRefused(listed)) return refusal(listed);
        touchScreen(env.dotId, env.now());
        if (!listed.apps.length) return ok(env.screen.platform === 'linux' ? 'Nothing is open on your desktop yet: open what the work needs with user_open_app.' : 'No windows are open.');
        return ok(`Open windows:\n${listed.apps.map((app) => appLine(app, env.screen.platform)).join('\n')}`);
      } catch (error) {
        return fail(problem(error));
      }
    },
  },
});

/** The controls each bot last listed, by number; acting names one by its number in that list. */
const listedBy = new Map<string, { snapshot: number; elements: DotScreenElement[] }>();

/** A window target from a tool's arguments: a pid, a program's name, or words in a window's title. */
const targetOf = (args: Record<string, unknown>): DotScreenTarget => {
  const target: DotScreenTarget = {};
  const pid = Math.round(Number(args.pid));
  if (Number.isInteger(pid) && pid > 0) target.pid = pid;
  const program = stringArg(args, 'program');
  if (program) target.process = program.replace(/\.exe$/i, '');
  const title = stringArg(args, 'title');
  if (title) target.title = title;
  const window = Math.round(Number(args.window));
  if (Number.isInteger(window) && window > 0) target.window = window;
  return target;
};

/** Where an element sits in the bot's own positions, when its latest Windows screenshot shows that spot. */
const positionOf = (env: DotUserScreenEnv, element: DotScreenElement): string => {
  if (env.screen.platform !== 'windows' || !element.center) return '';
  const last = seen.get(env);
  if (!last) return '';
  const local = { x: element.center.x - last.left, y: element.center.y - last.top };
  const { screen } = last.geometry;
  if (local.x < 0 || local.y < 0 || local.x >= screen.width || local.y >= screen.height) return '';
  const at = fromScreen(last.geometry, local);
  return ` at (${at.x}, ${at.y})`;
};

const elementLine = (env: DotUserScreenEnv, element: DotScreenElement): string => {
  const parts = [`[${element.index}] ${element.role}${element.name ? ` "${element.name}"` : ''}`];
  if (element.value) parts.push(`value "${element.value}"`);
  if (element.state) parts.push(element.state);
  if (element.actions?.length) parts.push(element.actions.join(', '));
  return `${parts.join(' — ')}${positionOf(env, element)}`;
};

const elementsTool = (env: DotUserScreenEnv): DotToolEntry => ({
  doc: {
    name: 'user_elements',
    args: env.screen.platform === 'mac' ? '{"pid": 1234}' : '{"program": "notepad", "title": "", "pid": 0}',
    description: env.screen.platform === 'mac'
      ? 'List the controls of an app on the user\'s Mac — buttons, boxes, menu items, checkboxes — numbered, each with what it is, its name, its value and what it takes, read through Accessibility in the background. "pid" is from user_apps. Work them with user_element by number.'
      : 'List the controls of a window on the user\'s computer — buttons, boxes, menu items, checkboxes, tabs — numbered, each with what it is, its name, its value and what it takes, read through UI Automation. Name the window by "program", by words in its "title", or by "pid"; with none, the window in front. Working a control by number with user_element is surer than clicking its pixels, and leaves their mouse alone.',
  },
  handler: {
    id: 'user_elements',
    run: async (args, context) => {
      const blocked = goAhead(env, context, reasonArg(args));
      if (blocked) return blocked;
      const target = targetOf(args);
      if (env.screen.platform === 'mac' && !target.pid) return fail('Give the "pid" of the app: from user_apps.');
      try {
        const listed = await quietly(env, context, () => env.screen.bridge.elements(target));
        if (isRefused(listed)) return refusal(listed);
        touchScreen(env.dotId, env.now());
        listedBy.set(env.dotId, { snapshot: listed.snapshot, elements: listed.elements });
        if (env.screen.platform === 'mac' && target.pid) appBy.set(env.dotId, target.pid);
        if (!listed.elements.length) return ok(`"${listed.window}" offers no controls to work by number. Look at it and work it another way.`);
        const more = listed.truncated ? '\nThe list stops there: the window has more. Narrow it by looking closer, or work what you need from what is listed.' : '';
        return ok(`Controls of "${listed.window}"${listed.process ? ` (${listed.process})` : ''}:\n${listed.elements.map((element) => elementLine(env, element)).join('\n')}${more}`);
      } catch (error) {
        return fail(problem(error));
      }
    },
  },
});

const ELEMENT_ACTIONS = new Set(['invoke', 'toggle', 'select', 'expand', 'collapse', 'set_value']);
const DONE: Record<string, string> = { invoke: 'Pressed', toggle: 'Toggled', select: 'Selected', expand: 'Expanded', collapse: 'Collapsed' };

/** After acting on a control: the screen (Windows) or the window (macOS) as it is now, so the bot sees what it did. */
const afterwards = async (env: DotUserScreenEnv, summary: string): Promise<DotToolResult> => {
  const last = seen.get(env);
  if (!last) return ok(`${summary} Take a screenshot to see what it did.`);
  const after = await capture(env, last.window ? { window: last.window } : { monitor: last.monitor });
  if (!isShot(after)) return ok(`${summary} Look again to see what it did.`);
  const view = await look(env, after);
  return { observation: `${summary}${front(after)} What it looks like now comes with this step's results.`, images: view.images };
};

const elementTool = (env: DotUserScreenEnv): DotToolEntry => ({
  doc: {
    name: 'user_element',
    args: '{"index": 3, "action": "invoke", "value": ""}',
    description: 'Work a control from your latest user_elements list, by its number: "invoke" presses a button or link, "toggle" a checkbox, "select" a list item or tab, "expand" or "collapse" a menu or tree, "set_value" fills a box with "value". The app does it as if the user had, without their mouse. If the app has changed since you listed it, list it again.',
  },
  handler: {
    id: 'user_element',
    run: async (args, context) => {
      const blocked = goAhead(env, context, reasonArg(args));
      if (blocked) return blocked;
      const listed = listedBy.get(env.dotId);
      if (!listed) return fail('List the window\'s controls with user_elements first: you act on one by its number there.');
      const index = Math.round(Number(args.index));
      const element = listed.elements.find((candidate) => candidate.index === index);
      if (!element) return fail(`There is no control ${args.index} in your latest list.`);
      const action = (stringArg(args, 'action') ?? 'invoke').toLowerCase();
      if (!ELEMENT_ACTIONS.has(action)) return fail('"action" is invoke, toggle, select, expand, collapse or set_value.');
      if (action === 'set_value' && typeof args.value !== 'string') return fail('Give the "value" to set.');
      try {
        const outcome = await quietly(env, context, () => env.screen.bridge.element({ snapshot: listed.snapshot, index, action, ...(action === 'set_value' ? { value: String(args.value) } : {}) }));
        if (isRefused(outcome)) return refusal(outcome);
      } catch (error) {
        return fail(problem(error));
      }
      touchScreen(env.dotId, env.now());
      const what = `${element.role}${element.name ? ` "${element.name}"` : ''}`;
      const done = action === 'set_value' ? `Set ${what} to ${JSON.stringify(String(args.value).slice(0, 80))}.` : `${DONE[action]} ${what}.`;
      return afterwards(env, done);
    },
  },
});

const focusTool = (env: DotUserScreenEnv): DotToolEntry => ({
  doc: {
    name: 'user_focus_window',
    args: env.screen.platform === 'mac' ? '{"pid": 1234}' : env.screen.platform === 'linux' ? '{"window": 123}' : '{"program": "notepad", "title": "", "pid": 0}',
    description: env.screen.platform === 'mac'
      ? 'Bring an app to the front of the user\'s Mac. Their screen and focus are theirs: do this only when they asked for it, or when the work cannot be done in the background. "pid" is from user_apps.'
      : env.screen.platform === 'linux'
        ? 'Bring a window on your desktop to the front, so your keys go to it. "window" is from user_apps.'
        : 'Bring a window on the user\'s computer to the front, restoring it if minimized, so your clicks and keys reach it. Name it by "program", by words in its "title", or by "pid".',
  },
  handler: {
    id: 'user_focus_window',
    run: async (args, context) => {
      const blocked = goAhead(env, context, reasonArg(args));
      if (blocked) return blocked;
      const target = targetOf(args);
      if (!Object.keys(target).length) return fail(env.screen.platform === 'linux' ? 'Give the "window": from user_apps.' : env.screen.platform === 'mac' ? 'Give the "pid": from user_apps.' : 'Name the window: "program", words in its "title", or "pid".');
      try {
        const outcome = await quietly(env, context, () => env.screen.bridge.focus(target));
        if (isRefused(outcome)) return refusal(outcome);
        touchScreen(env.dotId, env.now());
        if (env.screen.platform === 'mac') {
          if (target.pid) appBy.set(env.dotId, target.pid);
          return ok(`Brought ${outcome.title ? `"${outcome.title}"` : 'the app'} to the front.`);
        }
        if (outcome.foreground === false) return ok('Windows would not bring that window to the front. Click it, or its button on the taskbar, instead.');
        return afterwards(env, `Brought ${outcome.title ? `"${outcome.title}"` : 'the window'} to the front.`);
      } catch (error) {
        return fail(problem(error));
      }
    },
  },
});

const openAppTool = (env: DotUserScreenEnv): DotToolEntry => ({
  doc: {
    name: 'user_open_app',
    args: '{"command": "firefox", "reason": "…"}',
    description: 'Open an app on your desktop on the user\'s computer — it runs there, off their screen, and ends when your use of it does. "command" is how the app is started, such as firefox or libreoffice --calc. Take a screenshot after a moment to see it.',
  },
  handler: {
    id: 'user_open_app',
    run: async (args, context) => {
      const blocked = goAhead(env, context, reasonArg(args));
      if (blocked) return blocked;
      const command = stringArg(args, 'command');
      if (!command) return fail('Give the "command" that starts the app.');
      try {
        const outcome = await quietly(env, context, () => env.screen.bridge.launch(command));
        if (isRefused(outcome)) return refusal(outcome);
        touchScreen(env.dotId, env.now());
        return ok(`Started ${outcome.started ?? command} on your desktop. Give it a moment, then take a screenshot ("wait" helps).`);
      } catch (error) {
        return fail(problem(error));
      }
    },
  },
});

/**
 * Everything a bot can do on the user's computer through its screen, as the system does it best: Windows' shared
 * desktop by position and by control, macOS's apps by control in the background, Linux's desktop of the bot's own.
 */
export const userScreenTools = (env: DotUserScreenEnv): DotToolEntry[] => {
  if (env.screen.platform === 'mac') return [appsTool(env), screenshotTool(env), zoomTool(env), elementsTool(env), elementTool(env), typeTool(env), keyTool(env), focusTool(env)];
  if (env.screen.platform === 'linux') return [openAppTool(env), screenshotTool(env), zoomTool(env), clickTool(env), moveTool(env), typeTool(env), keyTool(env), scrollTool(env), dragTool(env), appsTool(env), focusTool(env)];
  return [screenshotTool(env), zoomTool(env), clickTool(env), moveTool(env), typeTool(env), keyTool(env), scrollTool(env), dragTool(env), appsTool(env), elementsTool(env), elementTool(env), focusTool(env)];
};
