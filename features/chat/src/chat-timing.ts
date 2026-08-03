/**
 * Resolves after the browser has had a chance to paint one frame.
 *
 * Used to force a visible render of an intermediate state before the next
 * update replaces it. The timeout is a safety net for environments where
 * `requestAnimationFrame` never fires (background tabs, headless renders), so
 * an awaiting caller can never be stranded.
 */
export const waitForBrowserPaint = () => new Promise<void>((resolve) => {
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    resolve();
  };
  const fallback = window.setTimeout(finish, 50);
  requestAnimationFrame(() => {
    window.clearTimeout(fallback);
    finish();
  });
});
