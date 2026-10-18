/** Where a bot stands once a turn is over. */
import type { DotRuntimeState } from '../thread/thread-types';
import type { DotTurnEndReason } from './protocol';

/**
 * Its status after a turn that began at `startedAt`, and its wake-up. Woken early — the user wrote or reacted, work
 * it handed off moved — the bot keeps the wake-up it set, until it comes or the bot sets another; one that was already
 * past when the turn began never came, and is dropped.
 */
export const afterTurn = (
  runtime: Pick<DotRuntimeState, 'status' | 'wakeAt'>,
  reason: DotTurnEndReason,
  startedAt: number,
): Pick<DotRuntimeState, 'status' | 'wakeAt' | 'wakeReason'> | Pick<DotRuntimeState, 'status'> => {
  if (reason === 'sleeping') return { status: 'sleeping' };
  const kept = runtime.wakeAt !== undefined && runtime.wakeAt > startedAt;
  const status = reason === 'error' ? 'error' : runtime.status === 'paused' ? 'paused' : kept ? 'sleeping' : 'idle';
  return kept ? { status } : { status, wakeAt: undefined, wakeReason: undefined };
};
