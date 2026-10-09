/**
 * The user's own screen, as a bot asks for it: a card — see and use your screen — that the user allows or declines,
 * and while it is allowed, Stop on it takes it back. Seeing and using go together, as with a person given remote
 * access: their mouse and keyboard are shared with them, so the grant is for a stretch of work, not for good.
 *
 * A grant lapses after a quiet spell, or when the user disconnects their computer or connects something else in its
 * place. With the bot acting without asking, the card is the record of a grant it already has, and Stop still ends
 * it — as do, on Windows, the Stop on the overlay's pill and Esc.
 */
import { appendDotItem, getDotThread, updateDotRuntime } from '../thread/thread-store';
import type { DotItem, DotThread } from '../thread/thread-types';

/** A grant left unused this long lapses: the next use asks again. */
export const SCREEN_QUIET_MS = 15 * 60_000;

const endedListeners = new Set<(dotId: string) => void>();

/** Hears every grant end — stopped, lapsed, or out of reach — so what showed it (Windows' overlay) can go too. */
export const onScreenGrantEnded = (listener: (dotId: string) => void): (() => void) => {
  endedListeners.add(listener);
  return () => endedListeners.delete(listener);
};

const grantEnded = (dotId: string) => {
  for (const listener of endedListeners) {
    try { listener(dotId); } catch { /* one listener's trouble is not the grant's */ }
  }
};

export interface DotScreenDeps {
  now: () => number;
  wake: (dotId: string) => void;
}

export type ScreenState = 'pending' | 'allowed' | 'declined' | 'stopped' | 'ended';

const steps = (thread: DotThread, itemId: string): DotItem[] =>
  thread.items.filter((item) => item.kind === 'event' && item.event === 'screen' && item.ref === itemId);

/** Where a request stands. One that was allowed has ended once another grant, or none, holds the screen. */
export const screenState = (thread: DotThread, item: DotItem, now: number): ScreenState => {
  const last = steps(thread, item.id).at(-1)?.screenStep;
  if (!last) return 'pending';
  if (last !== 'allowed') return last;
  const grant = thread.runtime.screen;
  return grant?.itemId === item.id && now - grant.lastAt < SCREEN_QUIET_MS ? 'allowed' : 'ended';
};

/** Requests for the screen the user has not answered, oldest first. */
export const pendingScreenRequests = (thread: DotThread): DotItem[] =>
  thread.items.filter((item) => item.kind === 'screen' && steps(thread, item.id).length === 0);

/** The grant in force, if any. */
export const activeScreen = (thread: DotThread, now: number): NonNullable<DotThread['runtime']['screen']> | null => {
  const grant = thread.runtime.screen;
  return grant && now - grant.lastAt < SCREEN_QUIET_MS ? grant : null;
};

/** The latest request, when the user declined it and has not written since: asking again waits on their word. */
export const declinedScreen = (thread: DotThread): DotItem | undefined => {
  const request = [...thread.items].reverse().find((item) => item.kind === 'screen');
  if (!request) return undefined;
  const decision = steps(thread, request.id).at(-1);
  if (decision?.screenStep !== 'declined') return undefined;
  return thread.items.some((item) => item.kind === 'user' && item.seq > decision.seq) ? undefined : request;
};

const post = (dotId: string, ref: string, screenStep: NonNullable<DotItem['screenStep']>, text: string, quiet = false) =>
  appendDotItem(dotId, { kind: 'event', event: 'screen', ref, screenStep, text, ...(quiet ? { quiet: true } : {}) });

/**
 * The bot asks for the screen — or, `atOnce`, as the user lets it act without asking, has it now, the card its record.
 */
export const requestScreen = (dotId: string, request: { reason: string; turnId?: string; atOnce: boolean; now: number }): DotItem => {
  const item = appendDotItem(dotId, {
    kind: 'screen',
    text: request.reason,
    screen: { reason: request.reason, ...(request.atOnce ? { standing: 'mode' as const } : {}) },
    ...(request.turnId ? { turnId: request.turnId } : {}),
  });
  if (request.atOnce) {
    post(dotId, item.id, 'allowed', `You have the user's screen (${item.id}), as they let you act without asking.`, true);
    updateDotRuntime(dotId, { screen: { itemId: item.id, since: request.now, lastAt: request.now } });
  }
  return item;
};

export const allowScreen = (dotId: string, itemId: string, deps: DotScreenDeps): void => {
  const thread = getDotThread(dotId);
  const item = thread?.items.find((entry) => entry.id === itemId && entry.kind === 'screen');
  if (!thread || !item || screenState(thread, item, deps.now()) !== 'pending') return;
  const now = deps.now();
  post(dotId, itemId, 'allowed', `The user let you see and use their screen (${itemId}). It is yours to use until they stop you, or until you leave it unused for ${SCREEN_QUIET_MS / 60_000} minutes.`);
  updateDotRuntime(dotId, { screen: { itemId, since: now, lastAt: now } });
  deps.wake(dotId);
};

export const declineScreen = (dotId: string, itemId: string, deps: DotScreenDeps): void => {
  const thread = getDotThread(dotId);
  const item = thread?.items.find((entry) => entry.id === itemId && entry.kind === 'screen');
  if (!thread || !item || screenState(thread, item, deps.now()) !== 'pending') return;
  post(dotId, itemId, 'declined', `The user chose not to let you use their screen (${itemId}). Do the work another way, or ask them what they would prefer.`);
  deps.wake(dotId);
};

/**
 * The user took the screen back — Stop on the card, or on the overlay's pill, or Esc: it is theirs again, and the bot
 * hears it.
 */
export const stopScreen = (dotId: string, deps: DotScreenDeps, how?: 'button' | 'escape'): void => {
  const grant = getDotThread(dotId)?.runtime.screen;
  if (!grant) return;
  updateDotRuntime(dotId, { screen: undefined });
  const way = how === 'escape' ? ' — they pressed Esc' : how === 'button' ? ' — they pressed Stop on their screen' : '';
  post(dotId, grant.itemId, 'stopped', `The user stopped you using their screen (${grant.itemId})${way}. Leave it alone unless they ask you to use it again.`);
  grantEnded(dotId);
  deps.wake(dotId);
};

/** The bot used the screen: the grant's quiet spell starts again. */
export const touchScreen = (dotId: string, now: number): void => {
  updateDotRuntime(dotId, (runtime) => (runtime.screen ? { ...runtime, screen: { ...runtime.screen, lastAt: now } } : runtime));
};

/** A grant that has gone unused past its spell ends, quietly: the next use asks again. */
export const endLapsedScreen = (dotId: string, now: number): void => {
  const grant = getDotThread(dotId)?.runtime.screen;
  if (!grant || now - grant.lastAt < SCREEN_QUIET_MS) return;
  updateDotRuntime(dotId, { screen: undefined });
  post(dotId, grant.itemId, 'ended', `Your use of the user's screen (${grant.itemId}) lapsed after ${SCREEN_QUIET_MS / 60_000} minutes unused.`, true);
  grantEnded(dotId);
};

/** The screen is out of reach now — the computer disconnected, or one folder in its place: grant and requests end. */
export const endScreenAccess = (dotId: string, why: string): void => {
  const thread = getDotThread(dotId);
  if (!thread) return;
  const grant = thread.runtime.screen;
  if (grant) {
    updateDotRuntime(dotId, { screen: undefined });
    post(dotId, grant.itemId, 'ended', `Your use of the user's screen (${grant.itemId}) ended: ${why}.`, true);
    grantEnded(dotId);
  }
  for (const item of pendingScreenRequests(thread)) post(dotId, item.id, 'ended', `Your request to use the user's screen (${item.id}) was withdrawn: ${why}.`, true);
};
