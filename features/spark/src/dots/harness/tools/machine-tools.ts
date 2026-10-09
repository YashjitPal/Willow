/**
 * What a bot can do on its own computer (runtime/machine-bridge.ts): its own
 * account on a Linux machine on the user's PC that their bots share, with a
 * desktop, a browser, a shell and a folder of its own.
 *
 * The tools are OpenBot's (`app/src/lib/copilot/computer-tools.tsx`): open a
 * page and read it; snapshot what can be acted on, and act by ref; ask a person
 * to take over, or to type in one secret; work with files and a shell. Two
 * things differ, both because a bot's turn never waits on a person. Asking for
 * help records a card and returns at once — the bot hears, as an event, when
 * the user hands the computer back. And a computer the user has not set up yet
 * is asked for the same way, by the first tool the bot reaches for.
 *
 * The desktop tools go beyond OpenBot, whose computer has no screen: they are
 * the computer-use loop — look at a screenshot, act at a position on it, and
 * see the screen the action left, marked where it landed, which comes back
 * with its result. Positions are in the space the bot's model points in
 * (`runtime/screen-view.ts`) and become the screen's pixels here.
 */
import type { Attachment } from '@willow/ai/chat';
import { applyPatch, parsePatch, type PatchOp } from '../../../harness/runtime/apply-patch';
import { machineProblem, type DotMachineReply, type DotMachineRequest } from '../runtime/machine-bridge';
import { closerLook, geometryFor, howToPoint, pointsIn, regionOnScreen, toScreen, viewOf, type Mark, type ScreenGeometry } from '../runtime/screen-view';
import { patchable, patchPath } from './computer-tools';
import type { DotToolContext, DotToolResult } from '../runtime/protocol';
import { appendDotItem, getDotThread, updateDotRuntime } from '../thread/thread-store';
import type { DotHelpCard, DotItem, DotThread } from '../thread/thread-types';
import { fail, ok, stringArg, type DotToolEntry, type DotToolEnv } from './tool-env';

export const MACHINE_WORKSPACE = '~/workspace';
/** The desktop's screen (service.mjs, SCREEN). */
export const MACHINE_SCREEN = { width: 1280, height: 1024 };
const COMMAND_DEFAULT_SECONDS = 120;
const COMMAND_MAX_SECONDS = 600;
const MAX_OBSERVATION_CHARS = 16_000;
/** A secret request the user has not answered lapses with the computer's own (service.mjs). */
export const SECRET_TTL_MS = 10 * 60_000;

export type DotMachineEnv = DotToolEnv & { machine: NonNullable<DotToolEnv['machine']> };

/* ------------------------------------------------------------------------ */
/* The thread's record of the computer                                       */
/* ------------------------------------------------------------------------ */

const machineEvents = (thread: DotThread, itemId: string): DotItem[] =>
  thread.items.filter((item) => item.kind === 'event' && item.event === 'machine' && item.ref === itemId);

/** Requests to set the computer up that the user has not answered. */
export const pendingSetupRequests = (thread: DotThread): DotItem[] =>
  thread.items.filter((item) => item.kind === 'machine' && machineEvents(thread, item.id).length === 0);

/** How a setup request was answered, once it was. */
export const setupAnswer = (thread: DotThread, itemId: string): DotItem | undefined => {
  const steps = machineEvents(thread, itemId);
  return steps.find((item) => item.machineStep === 'ready' || item.machineStep === 'failed' || item.machineStep === 'declined') ?? steps.find((item) => item.machineStep === 'allowed');
};

const HELP_ENDINGS = new Set(['returned', 'cancelled', 'expired', 'interrupted', 'entered']);

/** How a request for help ended, once it has. */
export const helpOutcome = (thread: DotThread, itemId: string): DotItem | undefined =>
  machineEvents(thread, itemId).find((item) => item.machineStep !== undefined && HELP_ENDINGS.has(item.machineStep));

export const helpTaken = (thread: DotThread, itemId: string): boolean =>
  machineEvents(thread, itemId).some((item) => item.machineStep === 'taken');

/** Requests for help — takeovers and secrets — that have not ended. */
export const openHelpRequests = (thread: DotThread): DotItem[] =>
  thread.items.filter((item) => item.kind === 'help' && item.help && !helpOutcome(thread, item.id));

/* ------------------------------------------------------------------------ */
/* Talking to the computer                                                   */
/* ------------------------------------------------------------------------ */

type Body = Record<string, any>;

const clip = (text: string): string =>
  text.length <= MAX_OBSERVATION_CHARS ? text : `${text.slice(0, MAX_OBSERVATION_CHARS)}\n[… ${(text.length - MAX_OBSERVATION_CHARS).toLocaleString('en-US')} more characters]`;

const size = (bytes = 0): string => {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
};

const askForSetup = (env: DotMachineEnv, turnId: string): DotToolResult => {
  const thread = getDotThread(env.dotId);
  if (!thread) return fail('Your thread is not loaded yet.');
  if (thread.runtime.machine) {
    return fail('Your computer is not ready: setting it up did not finish. The user can try again from your profile; tell them only if the work needs it.');
  }
  const pending = pendingSetupRequests(thread)[0];
  if (pending) return ok(`Your computer is not set up yet, so nothing was done. You already asked the user to set it up (${pending.id}); you will hear when they decide.`);
  const lastRequest = [...thread.items].reverse().find((item) => item.kind === 'machine');
  if (lastRequest && setupAnswer(thread, lastRequest.id)?.machineStep === 'declined') {
    return fail(`The user declined to set up your computer (${lastRequest.id}). Do not ask again unless they bring it up; do the work another way.`);
  }
  const item = appendDotItem(env.dotId, { kind: 'machine', text: 'A computer of its own, to browse and run things without touching the user\'s.', turnId });
  return ok(`Your computer is not set up yet, so nothing was done. You asked the user to set it up (${item.id}): your own account on a Linux machine on their PC, separate from theirs, which they approve in the conversation. You will hear when it is ready; carry on with anything that does not need it, or end your turn.`);
};

const markBlocked = (env: DotMachineEnv) => {
  updateDotRuntime(env.dotId, (runtime) => (runtime.machine ? { ...runtime, machine: { ...runtime.machine, blockedAt: env.now() } } : runtime));
};

const refusal = (env: DotMachineEnv, reply: DotMachineReply<Body>): DotToolResult => {
  const body = reply.body ?? {};
  if (reply.status === 499) return fail(body.timedOut ? 'Your computer did not answer in time.' : 'Stopped.');
  if (body.humanHasControl) {
    markBlocked(env);
    return fail('A person has your computer right now — the user took it over, or you asked them to — so nothing was done. You will hear when they hand it back.');
  }
  return fail(String(body.error || `Your computer could not do that (${reply.status}).`));
};

const call = async (
  env: DotMachineEnv,
  context: DotToolContext,
  request: DotMachineRequest,
  onDone: (body: Body) => DotToolResult | Promise<DotToolResult>,
): Promise<DotToolResult> => {
  if (!env.machine.ready) return askForSetup(env, context.turnId);
  let reply: DotMachineReply<Body>;
  try {
    reply = await env.machine.bridge.call<Body>(env.dotId, request, context.signal);
  } catch (error) {
    return fail(machineProblem(error));
  }
  if (reply.status >= 200 && reply.status < 300) return onDone(reply.body ?? {});
  return refusal(env, reply);
};

/** One card per request: a page re-detected as a challenge, or a repeated ask, finds the card already there. */
const recordHelp = (env: DotMachineEnv, turnId: string, help: DotHelpCard): DotItem => {
  const existing = getDotThread(env.dotId)?.items.find((item) => item.kind === 'help' && item.help?.requestId === help.requestId);
  return existing ?? appendDotItem(env.dotId, { kind: 'help', text: help.reason, turnId, help });
};

const pageHeading = (body: Body): string => `${body.title ? `${body.title}\n` : ''}${body.url ?? ''}`;

const continues = (body: Body): string =>
  body.truncated && typeof body.next === 'number' ? `\n\n[The page goes on: read the rest with computer_read and "offset": ${body.next}.]` : '';

const notes = (body: Body): string => (Array.isArray(body.notes) && body.notes.length ? `\n\n${body.notes.join('\n')}` : '');

const challengeNote = (env: DotMachineEnv, context: DotToolContext, body: Body): string => {
  const challenge = body.challenge;
  if (!challenge?.requestId) return '';
  const item = recordHelp(env, context.turnId, {
    requestId: challenge.requestId,
    kind: 'takeover',
    reason: String(challenge.reason || 'This page wants a person.'),
    source: challenge.kind === 'cloudflare' ? 'cloudflare' : 'visible-challenge',
    url: body.url,
    title: body.title,
  });
  return `\n\nThis page is a check that a person has to clear${challenge.kind === 'cloudflare' ? ' (Cloudflare)' : ''}, so the user has been asked to take over your computer (${item.id}). Your actions on it are refused until they hand it back; you will hear when they do.`;
};

const elementLine = (element: Body): string => {
  const parts = [`${element.ref} ${element.role}${element.name ? ` "${element.name}"` : ''}`];
  if (element.value) parts.push(`value "${element.value}"`);
  if (element.checked !== undefined) parts.push(element.checked ? 'checked' : 'not checked');
  if (element.selected) parts.push('selected');
  if (element.expanded !== undefined) parts.push(element.expanded ? 'expanded' : 'collapsed');
  if (element.disabled) parts.push('disabled');
  return parts.join(', ');
};

const touched = (body: Body): string => {
  const element = body.element ?? {};
  return `the ${element.role ?? 'element'}${element.name ? ` "${element.name}"` : ''}`;
};

const snapshotId = (args: Record<string, unknown>): number | undefined => {
  const value = Number(args.snapshotId ?? args.snapshot_id);
  return Number.isFinite(value) ? value : undefined;
};

const inFront = (body: Body): string => (body.active ? ` The window in front is "${body.active}".` : '');

/**
 * The geometry of the latest picture each bot was sent of its screen — what its positions mean — with the way of
 * pointing it was drawn for: another model's picture means nothing to this one.
 */
const seen = new Map<string, { geometry: ScreenGeometry; profile: unknown }>();

/** Where the bot's positions on its screen point now: on its latest picture, or on the one it would be sent. */
const geometryNow = (env: DotMachineEnv): ScreenGeometry => {
  const last = seen.get(env.dotId);
  if (last && last.profile === env.vision?.profile) return last.geometry;
  return env.vision ? geometryFor(env.vision.profile, MACHINE_SCREEN) : { screen: MACHINE_SCREEN, picture: MACHINE_SCREEN, space: 'pixels' };
};

const spaceWords = (env: DotMachineEnv): string => pointsIn(env.vision?.profile.space ?? 'pixels');

/** A picture of the screen as the bot is sent it, marked where it just acted; its geometry becomes the bot's. */
const look = async (env: DotMachineEnv, shot: Body, marks: Mark[] = []): Promise<{ images: Attachment[]; geometry: ScreenGeometry; marked: boolean } | null> => {
  if (!shot?.data) return null;
  const { picture, geometry, marked } = await viewOf(env.vision, {
    data: String(shot.data),
    width: Number(shot.width) || MACHINE_SCREEN.width,
    height: Number(shot.height) || MACHINE_SCREEN.height,
  }, marks);
  seen.set(env.dotId, { geometry, profile: env.vision?.profile });
  return { images: [{ type: 'image', mimeType: picture.mimeType ?? 'image/jpeg', data: picture.data }], geometry, marked };
};

/** A desktop action's result: what was done, and the screen it left, which the model sees with the next request. */
const desktopResult = async (env: DotMachineEnv, summary: string, body: Body, marks: Mark[] = []): Promise<DotToolResult> => {
  const view = await look(env, body.screenshot, marks);
  const after = !view ? '' : view.marked
    ? ' The screen afterwards comes with this step\'s results, a ring marking where you acted: check it landed where you meant before you go on.'
    : ' The screen afterwards comes with this step\'s results.';
  return { observation: `${summary}${inFront(body)}${after}`, ...(view ? { images: view.images } : {}) };
};

const point = (args: Record<string, unknown>, xName = 'x', yName = 'y'): { x: number; y: number } | null => {
  const x = Number(args[xName]);
  const y = Number(args[yName]);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
};

/** A position the bot gave, as its screen's pixel; with what to say when it is not on its screenshot. */
const onScreen = (env: DotMachineEnv, args: Record<string, unknown>, xName = 'x', yName = 'y'): { at: { x: number; y: number }; given: { x: number; y: number } } | string => {
  const given = point(args, xName, yName);
  if (!given) return `Give "${xName}" and "${yName}": ${spaceWords(env)}.`;
  const at = toScreen(geometryNow(env), given);
  if (!at) return `(${given.x}, ${given.y}) is not on your screenshot. Use ${spaceWords(env)}.`;
  return { at, given };
};

const pause = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => {
    clearTimeout(timer);
    resolve();
  }, { once: true });
});

/* ------------------------------------------------------------------------ */
/* The tools                                                                 */
/* ------------------------------------------------------------------------ */

const navigateTool = (env: DotMachineEnv): DotToolEntry => ({
  doc: {
    name: 'computer_navigate',
    args: '{"url": "https://…"}',
    description: 'Open a web page in the browser on your own computer, where the user can watch it live. Returns the page\'s title and readable text, so answer from what comes back rather than sending the user to look. A long page continues with computer_read.',
  },
  handler: {
    id: 'computer_navigate',
    run: async (args, context) => {
      const url = stringArg(args, 'url');
      if (!url) return fail('Give the "url" to open.');
      return call(env, context, { method: 'POST', path: '/browser/navigate', body: { url }, timeoutMs: 75_000 }, (body) =>
        ok(clip(`${pageHeading(body)}\n\n${body.text || '(The page has no readable text.)'}${continues(body)}${challengeNote(env, context, body)}${notes(body)}`)));
    },
  },
});

const readTool = (env: DotMachineEnv): DotToolEntry => ({
  doc: {
    name: 'computer_read',
    args: '{"offset": 0}',
    description: 'Read the page open on your computer, without opening anything: after something you did changed it, such as submitting a form, or from "offset" to read on through a long page.',
  },
  handler: {
    id: 'computer_read',
    run: async (args, context) => {
      const offset = Math.max(0, Math.round(Number(args.offset ?? 0)) || 0);
      return call(env, context, { method: 'GET', path: `/browser/read?offset=${offset}`, timeoutMs: 45_000 }, (body) =>
        ok(clip(`${pageHeading(body)}${offset ? ` (from character ${offset})` : ''}\n\n${body.text || '(Nothing more to read.)'}${continues(body)}${challengeNote(env, context, body)}${notes(body)}`)));
    },
  },
});

const snapshotTool = (env: DotMachineEnv): DotToolEntry => ({
  doc: {
    name: 'computer_snapshot',
    args: '{}',
    description: 'List what you can act on in the page on your computer — fields, buttons, links, checkboxes — each with a ref, its label and its current value. Take one before clicking or typing, use its refs and send back its snapshotId; when an action says the refs are out of date, the page changed: take a new one.',
  },
  handler: {
    id: 'computer_snapshot',
    run: async (_args, context) => call(env, context, { method: 'POST', path: '/browser/snapshot', body: {}, timeoutMs: 45_000 }, (body) => {
      const elements: Body[] = Array.isArray(body.elements) ? body.elements : [];
      const heading = `Snapshot ${body.snapshotId} of ${body.title ? `"${body.title}" ` : ''}${body.url ?? ''}: ${elements.length === 0 ? 'nothing on this page can be acted on.' : `${elements.length} thing${elements.length === 1 ? '' : 's'} you can act on.`}`;
      const list = elements.map(elementLine).join('\n');
      const more = body.truncated ? '\n[More are further down the page: scroll and take another snapshot to see them.]' : '';
      return ok(clip(`${heading}${list ? `\n${list}` : ''}${more}${challengeNote(env, context, body)}${notes(body)}`));
    }),
  },
});

const clickTool = (env: DotMachineEnv): DotToolEntry => ({
  doc: {
    name: 'computer_click',
    args: '{"ref": "e3", "snapshotId": 12}',
    description: 'Click something on the page on your computer — a button, a link, a checkbox, a radio option — by its ref from your most recent snapshot and that snapshot\'s snapshotId.',
  },
  handler: {
    id: 'computer_click',
    run: async (args, context) => {
      const ref = stringArg(args, 'ref');
      if (!ref) return fail('Give the "ref" of what to click, from your most recent snapshot.');
      return call(env, context, { method: 'POST', path: '/browser/click', body: { ref, snapshotId: snapshotId(args) }, timeoutMs: 45_000 }, (body) =>
        ok(`Clicked ${touched(body)}.${body.covered ? ` ${body.covered}` : ''} The page is now ${body.url}.${notes(body)}`));
    },
  },
});

const typeTool = (env: DotMachineEnv): DotToolEntry => ({
  doc: {
    name: 'computer_type',
    args: '{"ref": "e5", "snapshotId": 12, "text": "…", "submit": false}',
    description: 'Fill in a field on the page on your computer, by ref from your most recent snapshot and its snapshotId. It replaces what the field holds; "submit" presses Enter afterwards. For a dropdown, give the option to choose; for a file upload, the path of a file in your folder.',
  },
  handler: {
    id: 'computer_type',
    run: async (args, context) => {
      const ref = stringArg(args, 'ref');
      if (!ref) return fail('Give the "ref" of the field, from your most recent snapshot.');
      if (typeof args.text !== 'string') return fail('Give the "text" to enter.');
      return call(env, context, { method: 'POST', path: '/browser/type', body: { ref, snapshotId: snapshotId(args), text: args.text, submit: args.submit === true }, timeoutMs: 45_000 }, (body) =>
        ok(`${body.chosen ? `Chose "${body.chosen}" in ${touched(body)}` : `Entered ${body.characters ?? 0} character${body.characters === 1 ? '' : 's'} into ${touched(body)}`}${body.submitted ? ' and pressed Enter' : ''}. The page is now ${body.url}.${notes(body)}`));
    },
  },
});

const keyTool = (env: DotMachineEnv): DotToolEntry => ({
  doc: {
    name: 'computer_key',
    args: '{"key": "Enter", "ref": "e5", "snapshotId": 12}',
    description: 'Press a key on the page on your computer — Enter, Tab, Escape, an arrow, or a shortcut such as Control+A — in a field given by ref, or on the page itself without one.',
  },
  handler: {
    id: 'computer_key',
    run: async (args, context) => {
      const key = stringArg(args, 'key');
      if (!key) return fail('Give the "key" to press.');
      const ref = stringArg(args, 'ref');
      return call(env, context, { method: 'POST', path: '/browser/key', body: { key, ...(ref ? { ref, snapshotId: snapshotId(args) } : {}) }, timeoutMs: 45_000 }, (body) =>
        ok(`Pressed ${body.key ?? key}. The page is now ${body.url}.${notes(body)}`));
    },
  },
});

const scrollTool = (env: DotMachineEnv): DotToolEntry => ({
  doc: {
    name: 'computer_scroll',
    args: '{"deltaY": 600}',
    description: 'Scroll the page on your computer down, or up with a negative amount, to bring more of it into view.',
  },
  handler: {
    id: 'computer_scroll',
    run: async (args, context) => {
      const deltaY = args.deltaY === undefined ? 600 : Number(args.deltaY);
      if (!Number.isFinite(deltaY)) return fail('"deltaY" must be a number of pixels.');
      return call(env, context, { method: 'POST', path: '/browser/scroll', body: { deltaY }, timeoutMs: 30_000 }, (body) =>
        ok(`Scrolled ${deltaY < 0 ? 'up' : 'down'} ${Math.abs(deltaY)} pixels.${body.position ? ` ${body.position}` : ''}${notes(body)}`));
    },
  },
});

const screenshotTool = (env: DotMachineEnv): DotToolEntry => ({
  doc: {
    name: 'computer_screenshot',
    args: '{"wait": 0}',
    description: `See your computer's screen as it is now: the whole desktop, with whatever windows are open on it. The desktop tools take ${spaceWords(env)}. "wait" first gives something still opening or loading that many seconds, up to 10.`,
  },
  handler: {
    id: 'computer_screenshot',
    run: async (args, context) => {
      const wait = Math.max(0, Math.min(10, Number(args.wait) || 0));
      if (wait && env.machine.ready) await pause(wait * 1_000, context.signal);
      return call(env, context, { method: 'GET', path: '/desktop/screenshot', timeoutMs: 30_000 }, async (body) => {
        const view = await look(env, body);
        if (!view) return fail('The screen could not be captured.');
        return {
          observation: `Screenshot of your screen.${inFront(body)} ${howToPoint(view.geometry)} The picture comes with this step's results and is not kept: take another to look again later.`,
          images: view.images,
        };
      });
    },
  },
});

const zoomTool = (env: DotMachineEnv): DotToolEntry => ({
  doc: {
    name: 'computer_zoom',
    args: '{"x": 400, "y": 300, "width": 200, "height": 150}',
    description: `Look closer at part of your computer's screen, to read small text or find a small target: the region with its top left at "x", "y" and that "width" and "height", in ${spaceWords(env)}. It comes magnified, with rulers along its edges in those same positions: act with what the rulers say, as on a screenshot.`,
  },
  handler: {
    id: 'computer_zoom',
    run: async (args, context) => {
      if (!env.vision) return fail('A closer look cannot be drawn here; take a screenshot instead.');
      const region = { x: Number(args.x), y: Number(args.y), width: Number(args.width), height: Number(args.height) };
      if (![region.x, region.y, region.width, region.height].every(Number.isFinite) || region.width <= 0 || region.height <= 0) {
        return fail(`Give "x" and "y" for the region's top left and its "width" and "height", in ${spaceWords(env)}.`);
      }
      const geometry = geometryNow(env);
      const crop = regionOnScreen(geometry, region);
      if (!crop) return fail(`That region is not on your screenshot, or too small to magnify. Use ${spaceWords(env)}.`);
      return call(env, context, { method: 'GET', path: '/desktop/screenshot', timeoutMs: 30_000 }, async (body) => {
        if (!body.data) return fail('The screen could not be captured.');
        const closer = await closerLook(env.vision!, { data: String(body.data), width: Number(body.width) || MACHINE_SCREEN.width, height: Number(body.height) || MACHINE_SCREEN.height }, geometry, crop);
        if (!closer) return fail('A closer look could not be drawn; take a screenshot instead.');
        return {
          observation: `A closer look at (${Math.round(region.x)}, ${Math.round(region.y)}) to (${Math.round(region.x + region.width)}, ${Math.round(region.y + region.height)}) of your screen, magnified ${closer.magnified}×, as it is now. Its rulers are in your usual positions: act with them.${inFront(body)}`,
          images: [{ type: 'image', mimeType: closer.picture.mimeType ?? 'image/jpeg', data: closer.picture.data }],
        };
      });
    },
  },
});

const desktopClickTool = (env: DotMachineEnv): DotToolEntry => ({
  doc: {
    name: 'computer_desktop_click',
    args: '{"x": 500, "y": 400, "button": "left", "clicks": 1, "hold": ""}',
    description: `Click a point on your computer's screen — a window, a menu, an icon, a field — at ${spaceWords(env)}. "button" is left, right or middle; "clicks": 2 double-clicks; "hold" keeps keys down through the click, such as "ctrl" or "shift". The screen afterwards comes back with a ring where the click landed.`,
  },
  handler: {
    id: 'computer_desktop_click',
    run: async (args, context) => {
      const target = onScreen(env, args);
      if (typeof target === 'string') return fail(target);
      const button = stringArg(args, 'button') ?? 'left';
      const clicks = args.clicks === undefined ? 1 : Number(args.clicks);
      const hold = stringArg(args, 'hold');
      return call(env, context, { method: 'POST', path: '/desktop/click', body: { ...target.at, button, clicks, ...(hold ? { hold } : {}) }, timeoutMs: 30_000 }, (body) => {
        const verb = body.clicks === 2 ? 'Double-clicked' : body.clicks === 3 ? 'Triple-clicked' : body.button === 'right' ? 'Right-clicked' : body.button === 'middle' ? 'Middle-clicked' : 'Clicked';
        const held = Array.isArray(body.held) && body.held.length ? ` holding ${body.held.join('+')}` : '';
        return desktopResult(env, `${verb}${held} at (${target.given.x}, ${target.given.y}).`, body, [{ at: { x: Number(body.x ?? target.at.x), y: Number(body.y ?? target.at.y) }, kind: 'point' }]);
      });
    },
  },
});

const desktopMoveTool = (env: DotMachineEnv): DotToolEntry => ({
  doc: {
    name: 'computer_desktop_move',
    args: '{"x": 500, "y": 400}',
    description: `Move the pointer on your computer's screen to a point, at ${spaceWords(env)}, and leave it there: for what shows on hover — a menu that opens, a tooltip — or to check where a click would land before you make it.`,
  },
  handler: {
    id: 'computer_desktop_move',
    run: async (args, context) => {
      const target = onScreen(env, args);
      if (typeof target === 'string') return fail(target);
      return call(env, context, { method: 'POST', path: '/desktop/move', body: target.at, timeoutMs: 30_000 }, (body) =>
        desktopResult(env, `Moved the pointer to (${target.given.x}, ${target.given.y}).`, body, [{ at: target.at, kind: 'point' }]));
    },
  },
});

const desktopTypeTool = (env: DotMachineEnv): DotToolEntry => ({
  doc: {
    name: 'computer_desktop_type',
    args: '{"text": "…"}',
    description: 'Type on your computer\'s keyboard, into whatever has the focus on its screen; a new line presses Enter. For a field on a web page, computer_type is exact; this is for everything else.',
  },
  handler: {
    id: 'computer_desktop_type',
    run: async (args, context) => {
      const text = args.text;
      if (typeof text !== 'string' || !text) return fail('Give the "text" to type.');
      return call(env, context, { method: 'POST', path: '/desktop/type', body: { text }, timeoutMs: 5 * 60_000 }, (body) => {
        const characters = Number(body.characters ?? text.length);
        return desktopResult(env, `Typed ${characters} character${characters === 1 ? '' : 's'}.`, body);
      });
    },
  },
});

const desktopKeyTool = (env: DotMachineEnv): DotToolEntry => ({
  doc: {
    name: 'computer_desktop_key',
    args: '{"key": "ctrl+s"}',
    description: 'Press a key on your computer\'s keyboard, for whatever has the focus on its screen: Enter, Escape, Tab, an arrow, F5, or a combination with ctrl, shift, alt or super joined by +.',
  },
  handler: {
    id: 'computer_desktop_key',
    run: async (args, context) => {
      const key = stringArg(args, 'key');
      if (!key) return fail('Give the "key" to press.');
      return call(env, context, { method: 'POST', path: '/desktop/key', body: { key }, timeoutMs: 30_000 }, (body) => desktopResult(env, `Pressed ${body.key ?? key}.`, body));
    },
  },
});

const desktopScrollTool = (env: DotMachineEnv): DotToolEntry => ({
  doc: {
    name: 'computer_desktop_scroll',
    args: '{"x": 500, "y": 400, "deltaY": 300}',
    description: `Scroll what is under a point on your computer's screen, at ${spaceWords(env)}: down by "deltaY" screen pixels, or up when it is negative; "deltaX" scrolls sideways.`,
  },
  handler: {
    id: 'computer_desktop_scroll',
    run: async (args, context) => {
      const target = onScreen(env, args);
      if (typeof target === 'string') return fail(target);
      const deltaY = args.deltaY === undefined ? 0 : Number(args.deltaY);
      const deltaX = args.deltaX === undefined ? 0 : Number(args.deltaX);
      if (!Number.isFinite(deltaY) || !Number.isFinite(deltaX) || (!deltaY && !deltaX)) return fail('Give "deltaY": pixels to scroll down, or up when it is negative.');
      return call(env, context, { method: 'POST', path: '/desktop/scroll', body: { ...target.at, deltaY, deltaX }, timeoutMs: 30_000 }, (body) =>
        desktopResult(env, `Scrolled ${deltaY ? `${deltaY < 0 ? 'up' : 'down'} ${Math.abs(deltaY)}` : `${deltaX < 0 ? 'left' : 'right'} ${Math.abs(deltaX)}`} pixels at (${target.given.x}, ${target.given.y}).`, body));
    },
  },
});

const desktopDragTool = (env: DotMachineEnv): DotToolEntry => ({
  doc: {
    name: 'computer_desktop_drag',
    args: '{"x": 200, "y": 300, "toX": 500, "toY": 300}',
    description: `Drag on your computer's screen: press the left button at one point, move to another and let go — to move a window, a file or a slider, or to select. Both points are ${spaceWords(env)}.`,
  },
  handler: {
    id: 'computer_desktop_drag',
    run: async (args, context) => {
      const from = onScreen(env, args);
      if (typeof from === 'string') return fail(from);
      const to = onScreen(env, args, 'toX', 'toY');
      if (typeof to === 'string') return fail(to);
      return call(env, context, { method: 'POST', path: '/desktop/drag', body: { ...from.at, toX: to.at.x, toY: to.at.y }, timeoutMs: 30_000 }, (body) =>
        desktopResult(env, `Dragged from (${from.given.x}, ${from.given.y}) to (${to.given.x}, ${to.given.y}).`, body, [{ at: from.at, kind: 'from' }, { at: to.at, kind: 'point' }]));
    },
  },
});

const requestHelpTool = (env: DotMachineEnv): DotToolEntry => ({
  doc: {
    name: 'computer_request_help',
    args: '{"reason": "…"}',
    description: 'Ask the user to take over your computer and do something you cannot: sign in, pass a check that a human is there, or make a choice only they can. Say exactly what you need; they see it as a card, drive your computer themselves and hand it back. Use it instead of giving up, and never ask for a password or code in a message instead.',
  },
  handler: {
    id: 'computer_request_help',
    run: async (args, context) => {
      const reason = stringArg(args, 'reason');
      if (!reason) return fail('Say in "reason" what you need the user to do, in one sentence they will understand.');
      return call(env, context, { method: 'POST', path: '/control/request', body: { reason }, timeoutMs: 30_000 }, (body) => {
        const request = body.request;
        if (!request?.id) return fail('Your computer did not take the request.');
        if (request.source === 'person') return ok('The user has your computer right now. You will hear when they hand it back.');
        const thread = getDotThread(env.dotId);
        const existing = thread?.items.find((item) => item.kind === 'help' && item.help?.requestId === request.id);
        if (existing) return ok(`You already asked the user to take over your computer (${existing.id}); it is still open. You will hear when they hand it back.`);
        const screen = body.screen;
        const item = recordHelp(env, context.turnId, { requestId: request.id, kind: 'takeover', reason, source: 'model', url: screen?.url, title: screen?.title });
        return ok(`Asked the user to take over your computer (${item.id}). Until they hand it back your actions on it are refused, and the request lapses if nobody takes it within 10 minutes. You will hear either way; carry on with anything else, or end your turn.`);
      });
    },
  },
});

const requestSecretTool = (env: DotMachineEnv): DotToolEntry => ({
  doc: {
    name: 'computer_request_secret',
    args: '{"label": "the code sent to your phone", "ref": "e7", "snapshotId": 12}',
    description: 'Ask the user for one value you must not be told — a password, a one-time code, a card number — for one field, given by ref from your most recent snapshot. They type it into a masked box that goes straight into that field; you never see it. It is only typed in: submit the form yourself afterwards.',
  },
  handler: {
    id: 'computer_request_secret',
    run: async (args, context) => {
      const label = stringArg(args, 'label');
      const ref = stringArg(args, 'ref');
      if (!label) return fail('Say in "label" what you need, in a few words.');
      if (!ref) return fail('Give the "ref" of the field it goes in, from your most recent snapshot.');
      return call(env, context, { method: 'POST', path: '/control/secret', body: { label, ref, snapshotId: snapshotId(args) }, timeoutMs: 30_000 }, (body) => {
        if (!body.secretRequestedAt) return fail('Your computer did not take the request.');
        const item = recordHelp(env, context.turnId, { requestId: `secret:${body.secretRequestedAt}`, kind: 'secret', reason: label, label, source: 'model' });
        return ok(`Asked the user for ${label} (${item.id}). They type it straight into the field and you will not see it. You will hear when it is in, or if they decline; then carry on from the page.`);
      });
    },
  },
});

const listFilesTool = (env: DotMachineEnv): DotToolEntry => ({
  doc: {
    name: 'computer_list_files',
    args: '{"path": "reports"}',
    description: `List what is in your folder on your computer (${MACHINE_WORKSPACE}), or in a folder inside it, with sizes. Look before reading a file whose exact name you are not sure of; never guess one.`,
  },
  handler: {
    id: 'computer_list_files',
    run: async (args, context) => {
      const path = stringArg(args, 'path');
      return call(env, context, { method: 'POST', path: '/files/list', body: path ? { path } : {}, timeoutMs: 30_000 }, (body) => {
        const entries: Body[] = Array.isArray(body.entries) ? body.entries : [];
        if (entries.length === 0) return ok(`${body.path && body.path !== '.' ? body.path : 'Your folder'} is empty.`);
        const lines = entries.map((entry) => (entry.kind === 'folder'
          ? `${entry.path}/${entry.skipped ? ' (not opened)' : ''}`
          : entry.kind === 'link' ? `${entry.path} (link)` : `${entry.path} — ${size(entry.bytes)}`));
        return ok(clip(`${lines.join('\n')}${body.truncated ? '\n[More not shown: list a folder inside.]' : ''}`));
      });
    },
  },
});

const readFileTool = (env: DotMachineEnv): DotToolEntry => ({
  doc: {
    name: 'computer_read_file',
    args: '{"path": "notes.md", "offset": 0}',
    description: 'Read a text file in your folder on your computer, by its path relative to the folder. A long file continues from "offset".',
  },
  handler: {
    id: 'computer_read_file',
    run: async (args, context) => {
      const path = stringArg(args, 'path');
      if (!path) return fail('Give the "path" of the file, relative to your folder.');
      const offset = Math.max(0, Math.round(Number(args.offset ?? 0)) || 0);
      return call(env, context, { method: 'POST', path: '/files/read', body: { path, offset }, timeoutMs: 30_000 }, (body) => {
        if (body.binary) return ok(`${body.path} is a binary file (${size(body.bytes)}); it cannot be shown as text. Inspect it with a command.`);
        const more = typeof body.next === 'number' ? `\n[Continues: read on with "offset": ${body.next}.]` : '';
        return ok(clip(`${body.path} — ${size(body.bytes)}${offset ? `, from byte ${offset}` : ''}:\n${body.text}${more}`));
      });
    },
  },
});

const writeFileTool = (env: DotMachineEnv): DotToolEntry => ({
  doc: {
    name: 'computer_write_file',
    args: '{"path": "reports/august.csv", "contents": "…", "append": false}',
    description: 'Save a text file in your folder on your computer, creating folders as needed; "append" adds to the end instead of replacing it. It stays there between conversations.',
  },
  handler: {
    id: 'computer_write_file',
    run: async (args, context) => {
      const path = stringArg(args, 'path');
      if (!path) return fail('Give the "path" to save to, relative to your folder.');
      if (typeof args.contents !== 'string') return fail('Give the "contents" to save.');
      return call(env, context, { method: 'POST', path: '/files/write', body: { path, contents: args.contents, append: args.append === true }, timeoutMs: 30_000 }, (body) =>
        ok(body.appended ? `Added to ${body.path}; it is now ${size(body.bytes)}.` : `Saved ${body.path} (${size(body.bytes)}).`));
    },
  },
});

/**
 * Codex's `apply_patch` on the bot's own computer: the precise way to change code there. Every file is read first
 * and the whole patch applied in memory, so a patch that fails anywhere changes nothing; deleting and moving are
 * left to commands, where they are explicit.
 */
const applyPatchTool = (env: DotMachineEnv): DotToolEntry => ({
  doc: {
    name: 'computer_apply_patch',
    args: '{"patch": "*** Begin Patch\\n*** Update File: path\\n@@ …\\n-old\\n+new\\n*** End Patch"}',
    description: 'Change files in your folder on your computer with a patch in Codex\'s apply_patch format, the precise way to edit code. Between "*** Begin Patch" and "*** End Patch": "*** Add File: path" and then every line of the new file starting with "+"; or "*** Update File: path" and then hunks, each opening "@@" (optionally followed by a line that locates it) with the lines around the change starting " ", removed lines "-" and added lines "+". Paths are relative to your folder. A patch that fails anywhere changes nothing. Delete or move files with a command.',
  },
  handler: {
    id: 'computer_apply_patch',
    run: async (args, context) => {
      if (!env.machine.ready) return askForSetup(env, context.turnId);
      const patch = typeof args.patch === 'string' ? args.patch : typeof args.input === 'string' ? args.input : '';
      if (!patch.trim()) return fail('Give the "patch".');
      let ops: PatchOp[];
      try {
        ops = parsePatch(patch, patchPath);
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
      if (ops.length === 0) return fail('That patch changes nothing.');
      const moving = ops.find((op) => op.kind === 'delete' || op.movePath);
      if (moving) return fail(`${moving.kind === 'delete' ? 'Delete' : 'Move'} ${moving.path} with computer_run_command.`);

      const files: Record<string, string> = {};
      const forms = new Map<string, (next: string) => string>();
      try {
        for (const op of ops) {
          if (op.path in files || (op.kind === 'add' && forms.has(op.path))) continue;
          const reply = await env.machine.bridge.call<Body>(env.dotId, { method: 'POST', path: '/files/read', body: { path: op.path, offset: 0 }, timeoutMs: 30_000 }, context.signal);
          const exists = reply.status >= 200 && reply.status < 300;
          if (!exists && reply.status !== 404) return refusal(env, reply);
          if (op.kind === 'add') {
            if (exists) return fail(`${op.path} already exists. Change it with "*** Update File: ${op.path}".`);
            continue;
          }
          if (!exists) return fail(`${op.path} does not exist. Create it with "*** Add File: ${op.path}".`);
          const body = reply.body ?? {};
          if (body.binary) return fail(`${op.path} is a binary file, which a patch cannot change.`);
          if (typeof body.next === 'number') return fail(`${op.path} is too large to patch (${size(body.bytes)}). Change it with a command.`);
          const form = patchable(String(body.text ?? ''));
          files[op.path] = form.text;
          forms.set(op.path, form.restore);
        }
      } catch (error) {
        return fail(machineProblem(error));
      }

      let result: ReturnType<typeof applyPatch>;
      try {
        result = applyPatch(files, ops);
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
      const written: string[] = [];
      for (const change of result.changes) {
        const next = result.files[change.path];
        if (next === undefined) continue;
        const restore = forms.get(change.path);
        try {
          const reply = await env.machine.bridge.call<Body>(env.dotId, { method: 'POST', path: '/files/write', body: { path: change.path, contents: restore ? restore(next) : next, append: false }, timeoutMs: 30_000 }, context.signal);
          if (reply.status < 200 || reply.status >= 300) return refusal(env, reply);
        } catch (error) {
          return fail(`${change.path} could not be written: ${machineProblem(error)}${written.length ? ` Already changed: ${written.join(', ')}.` : ' Nothing was changed.'}`);
        }
        written.push(`${change.kind === 'add' ? 'added' : 'updated'} ${change.path} (+${change.added} −${change.removed}${change.fuzz ? ', context matched loosely: check it' : ''})`);
      }
      return ok(written.length ? `Changed your folder: ${written.join('; ')}.` : 'The patch left every file as it was.');
    },
  },
});

const runCommandTool = (env: DotMachineEnv): DotToolEntry => ({
  doc: {
    name: 'computer_run_command',
    args: '{"command": "…", "timeout_seconds": 120}',
    description: `Run a command in bash on your own computer, in your folder (${MACHINE_WORKSPACE}), as a user without root. No one approves it first: it is your account. "apk add <package>" installs software, for the user's other bots too; nothing can be uninstalled. Open web pages with computer_navigate, not a browser started from a command. It is stopped after "timeout_seconds" (at most ${COMMAND_MAX_SECONDS}); start anything that must keep running in the background with its output sent to a file. Long output keeps its end.`,
  },
  handler: {
    id: 'computer_run_command',
    run: async (args, context) => {
      const command = stringArg(args, 'command');
      if (!command) return fail('Give the "command" to run.');
      const seconds = Math.max(1, Math.min(COMMAND_MAX_SECONDS, Math.round(Number(args.timeout_seconds ?? COMMAND_DEFAULT_SECONDS)) || COMMAND_DEFAULT_SECONDS));
      return call(env, context, { method: 'POST', path: '/exec', body: { command, timeoutMs: seconds * 1_000 }, timeoutMs: seconds * 1_000 + 30_000 }, (body) => {
        const outcome = body.timedOut
          ? `It ran past ${seconds} seconds and was stopped.`
          : body.stopped ? 'It was stopped.' : `It exited with code ${body.exitCode}.`;
        const parts = [outcome];
        if (String(body.stdout ?? '').trim()) parts.push(`Output:\n${String(body.stdout).replace(/\s+$/, '')}`);
        if (String(body.stderr ?? '').trim()) parts.push(`Errors:\n${String(body.stderr).replace(/\s+$/, '')}`);
        if (!String(body.stdout ?? '').trim() && !String(body.stderr ?? '').trim()) parts.push('It printed nothing.');
        if (body.truncated) parts.push('[Earlier output was cut; this is its end.]');
        const result = clip(parts.join('\n'));
        return body.exitCode === 0 && !body.timedOut ? ok(result) : { observation: result, failed: true };
      });
    },
  },
});

/** Everything a bot can do on its own computer. */
export const machineTools = (env: DotMachineEnv): DotToolEntry[] => [
  navigateTool(env),
  readTool(env),
  snapshotTool(env),
  clickTool(env),
  typeTool(env),
  keyTool(env),
  scrollTool(env),
  screenshotTool(env),
  zoomTool(env),
  desktopClickTool(env),
  desktopMoveTool(env),
  desktopTypeTool(env),
  desktopKeyTool(env),
  desktopScrollTool(env),
  desktopDragTool(env),
  requestHelpTool(env),
  requestSecretTool(env),
  listFilesTool(env),
  readFileTool(env),
  writeFileTool(env),
  applyPatchTool(env),
  runCommandTool(env),
];
