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
