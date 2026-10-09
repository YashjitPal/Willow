/**
 * Runs `work` while holding the Web Lock `name`, across every tab and window of
 * Willow — or not at all when another holder has it. Resolves to whether the
 * work ran. Without the Locks API (tests, old engines) the work simply runs.
 */
export const withWebLock = async (name: string, work: () => Promise<void>): Promise<boolean> => {
  const locks = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks) {
    await work();
    return true;
  }
  return locks.request(name, { ifAvailable: true }, async (lock) => {
    if (!lock) return false;
    await work();
    return true;
  });
};

/** Runs `work` holding the lock `name` once its holder lets go — or, after `timeoutMs` of waiting, without it. */
export const withWebLockWhenFree = async (name: string, work: () => Promise<void>, timeoutMs: number): Promise<void> => {
  const locks = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks) return work();
  let ran = false;
  try {
    await locks.request(name, { signal: AbortSignal.timeout(timeoutMs) }, async () => {
      ran = true;
      await work();
    });
  } catch (error) {
    if (ran) throw error;
    await work();
  }
};
