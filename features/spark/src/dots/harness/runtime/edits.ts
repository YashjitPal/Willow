/**
 * Edits a bot proposes while the user has it check with them before doing anything (its Permissions).
 *
 * `user_apply_patch` puts the patch on a card instead of writing it (`tools/computer-tools.ts`). The user applies it
 * or declines. Applying checks the patch again against the files as they are by then — they may have moved on — and
 * writes only what still takes it, each file only if it has not changed since it was read. An `applying` step is
 * written under a lock first, so a second window or a reload never applies it twice, and every outcome is an event
 * the bot hears.
 */
import { appendDotItem, getDotThread } from '../thread/thread-store';
import type { DotItem, DotThread } from '../thread/thread-types';
import { describeChanges, preparePatch, writePatch } from '../tools/computer-tools';
import type { DotComputerDeps } from './computer-access';
import { copyToTheirs, sizeOf, type CopyOutcome } from './transfer';
import { withWebLock } from './web-lock';

export type EditState = NonNullable<DotItem['editStep']> | 'pending';

const proposalItem = (thread: DotThread, itemId: string): DotItem | undefined =>
  thread.items.find((item) => item.id === itemId && item.kind === 'edit' && item.edit?.proposed);

const lastStep = (thread: DotThread, itemId: string): DotItem | undefined => {
  for (let index = thread.items.length - 1; index >= 0; index -= 1) {
    const entry = thread.items[index]!;
    if (entry.kind === 'event' && entry.event === 'edit' && entry.ref === itemId && entry.editStep) return entry;
  }
  return undefined;
};

/** Where an edit stands. One the bot made at once was never anything but applied. */
export const editState = (thread: DotThread, item: DotItem): EditState =>
  item.edit?.proposed ? lastStep(thread, item.id)?.editStep ?? 'pending' : 'applied';

/** Why a proposed edit did not go in, when it failed. */
export const editProblem = (thread: DotThread, item: DotItem): string | undefined => {
  const step = lastStep(thread, item.id);
  return step?.editStep === 'failed' ? step.problem : undefined;
};

/** Proposed edits waiting for the user, oldest first. */
export const pendingEdits = (thread: DotThread): DotItem[] =>
  thread.items.filter((item) => item.kind === 'edit' && item.edit?.proposed && editState(thread, item) === 'pending');

const record = (dotId: string, ref: string, editStep: NonNullable<DotItem['editStep']>, text: string, problem?: string, quiet = false) =>
  appendDotItem(dotId, { kind: 'event', event: 'edit', ref, editStep, text, ...(problem ? { failed: true, problem } : {}), ...(quiet ? { quiet: true } : {}) });

/** The user tapped Apply on a proposed edit. */
export const applyProposedEdit = async (dotId: string, itemId: string, deps: DotComputerDeps): Promise<void> => {
  const thread = getDotThread(dotId);
  const item = thread && proposalItem(thread, itemId);
  if (!thread || !item || editState(thread, item) !== 'pending') return;
  await withWebLock(`willow-dot-edit:${itemId}`, async () => {
    const latest = getDotThread(dotId);
    const current = latest && proposalItem(latest, itemId);
    if (!latest || !current || editState(latest, current) !== 'pending') return;
    const { patch, copy, scope } = current.edit!.proposed!;
    const where = current.edit!.root;
    const connected = latest.runtime.computer;
    if (!connected || connected.root !== scope.root || Boolean(connected.whole) !== Boolean(scope.whole)) {
      const problem = `${scope.whole ? 'Their whole computer' : scope.root} is not connected any more.`;
      record(dotId, itemId, 'failed', `The user tried to apply your change to ${where} (${itemId}), but ${scope.whole ? 'their whole computer' : scope.root} is not connected any more. Nothing changed.`, problem);
      deps.wake(dotId);
      return;
    }
    record(dotId, itemId, 'applying', `The user is applying your change to ${where} (${itemId}).`, undefined, true);
    if (copy) {
      // A file from the bot's own computer, copied as it is now.
      const outcome: CopyOutcome = deps.machine
        ? await copyToTheirs(deps.machine, dotId, deps.computer, copy.from, { root: copy.root, path: copy.path })
        : { problem: 'Your own computer is out of reach here.' };
      if (!getDotThread(dotId)) return;
      if ('problem' in outcome) record(dotId, itemId, 'failed', `The user accepted your copy of ${copy.from} (${itemId}), but it did not go: ${outcome.problem}`, outcome.problem);
      else record(dotId, itemId, 'applied', `The user accepted your copy of ${copy.from} (${itemId}): it is now in ${where} (${sizeOf(outcome.bytes)}).`);
      deps.wake(dotId);
      return;
    }
    const computer = { root: connected.root, ...(connected.whole ? { whole: true, home: connected.home ?? connected.root } : {}), bridge: deps.computer };
    const prepared = await preparePatch(computer, patch ?? '');
    if (!getDotThread(dotId)) return;
    if ('problem' in prepared) {
      record(dotId, itemId, 'failed', `The user applied your change to ${where} (${itemId}), but it no longer fits the files, so nothing changed: ${prepared.problem}`, prepared.problem);
      deps.wake(dotId);
      return;
    }
    const { written, problem } = prepared.changes.length ? await writePatch(deps.computer, prepared) : { written: [], problem: undefined };
    if (!getDotThread(dotId)) return;
    if (problem) {
      record(dotId, itemId, 'failed', `The user applied your change to ${where} (${itemId}), but not all of it went in: ${problem}`, problem);
    } else {
      record(dotId, itemId, 'applied', written.length
        ? `The user applied your change to ${where} (${itemId}): ${describeChanges(written)}.`
        : `The user applied your change to ${where} (${itemId}); the files already read that way.`);
    }
    deps.wake(dotId);
  });
};

/** The user tapped Don't apply. */
export const declineProposedEdit = (dotId: string, itemId: string, deps: Pick<DotComputerDeps, 'wake'>): void => {
  const thread = getDotThread(dotId);
  const item = thread && proposalItem(thread, itemId);
  if (!thread || !item || editState(thread, item) !== 'pending') return;
  record(dotId, itemId, 'declined', `The user chose not to apply your change to ${item.edit!.root} (${itemId}). Nothing changed.`);
  deps.wake(dotId);
};

/** What was connected changed under proposals still waiting: their paths now point nowhere, so they are withdrawn. */
export const withdrawPendingEdits = (dotId: string, why: string): void => {
  const thread = getDotThread(dotId);
  if (!thread) return;
  for (const item of pendingEdits(thread)) {
    record(dotId, item.id, 'failed', `Your proposed change to ${item.edit!.root} (${item.id}) was withdrawn: ${why}.`, `Withdrawn: ${why}.`);
  }
};

/** Proposals whose window closed while applying them: say so, unless another window still is. */
export const settleInterruptedEdits = (dotId: string, deps: Pick<DotComputerDeps, 'wake'>): void => {
  const thread = getDotThread(dotId);
  if (!thread) return;
  for (const item of thread.items) {
    if (item.kind !== 'edit' || !item.edit?.proposed || editState(thread, item) !== 'applying') continue;
    void withWebLock(`willow-dot-edit:${item.id}`, async () => {
      const latest = getDotThread(dotId);
      if (!latest || editState(latest, item) !== 'applying') return;
      record(
        dotId,
        item.id,
        'failed',
        `Your change to ${item.edit!.root} (${item.id}) was being applied when Willow closed, so some of its files may have changed and others not. Look at them before proposing it again.`,
        'Willow closed while it was being applied.',
      );
      deps.wake(dotId);
    });
  }
};
