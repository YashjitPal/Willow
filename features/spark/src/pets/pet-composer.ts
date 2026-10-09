/**
 * The composer on screen, which is where a click on the pet was most likely meant
 * to go. Waited for briefly: it may be on a page that is still opening.
 */
export const focusVisibleComposer = (): void => {
  const deadline = Date.now() + 1500;
  const attempt = () => {
    const fields = [...document.querySelectorAll<HTMLTextAreaElement>('textarea.willow-dictation-textarea')];
    const field = fields.find((candidate) => !candidate.disabled && candidate.getClientRects().length > 0);
    if (field) field.focus();
    else if (Date.now() < deadline) window.setTimeout(attempt, 50);
  };
  requestAnimationFrame(attempt);
};
