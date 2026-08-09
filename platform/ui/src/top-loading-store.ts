import { atom } from 'nanostores';

/**
 * Top-loading reasons requested from OUTSIDE `App`'s own tree.
 *
 * `App` owns the real refcount and the 280ms minimum-visible floor
 * (`startTopLoading`/`finishTopLoading`). This atom deliberately owns neither —
 * it is only a transport, mirrored into that refcount by one effect in App.
 * Anything already inside App should keep calling those functions directly.
 *
 * It exists because `features/*` may not import from `apps/*`, so a feature that
 * needs the route-progress bar (e.g. ChatView while a chat body loads) has no
 * other way to reach it.
 *
 * Reasons share one Set with App's own keys (`studio-view`, `studio-mode`,
 * `*-suspense`), so namespace yours — `chat-load:<chatId>`. A colliding key
 * would let one caller's finish cancel another's bar.
 *
 * Every start MUST be paired with a finish on the identical string, including
 * on unmount: this module outlives any component, so an unreleased reason leaves
 * the bar running forever.
 */
export const topLoadingReasons = atom<readonly string[]>([]);

export const startTopLoadingReason = (reason: string): void => {
  const current = topLoadingReasons.get();
  if (current.includes(reason)) return;
  topLoadingReasons.set([...current, reason]);
};

export const finishTopLoadingReason = (reason: string): void => {
  const current = topLoadingReasons.get();
  if (!current.includes(reason)) return;
  topLoadingReasons.set(current.filter((value) => value !== reason));
};
