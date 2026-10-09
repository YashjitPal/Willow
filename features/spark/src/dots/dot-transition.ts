import { flushSync } from 'react-dom';

const GLIDE_MS = 450;
const GLIDE_EASING = 'cubic-bezier(0.2, 0, 0, 1)';

/**
 * Slides the bots list from where it was to where the new route put it, as Spark glides its task list. It moves the
 * scroll box the list sits in, not the list: the box clips sideways, and a list moved inside it would be cut off at
 * the box's edge.
 */
function glide(list: HTMLElement | null, from: DOMRect | undefined) {
  const box = list?.closest<HTMLElement>('.spark-dots');
  if (!list || !box || !list.isConnected || !from || from.width === 0) return;
  const to = list.getBoundingClientRect();
  const dx = from.left - to.left;
  if (to.width === 0 || Math.abs(dx) < 1) return;
  box.style.transition = 'none';
  box.style.transform = `translateX(${dx}px)`;
  void box.offsetWidth;
  requestAnimationFrame(() => {
    box.style.transition = `transform ${GLIDE_MS}ms ${GLIDE_EASING}`;
    box.style.transform = '';
  });
  window.setTimeout(() => {
    box.style.transition = '';
  }, GLIDE_MS + 20);
}

/**
 * Moves between the Bots tab and an open bot as Spark moves between its task list and a task
 * (`transitionTaskNavigation` in SparkWorkspace.tsx): one View Transition, in which the open bot's workspace
 * (`.spark-task-detail__workspace`, named `spark-task-workspace` in SparkWorkspace.css) slides in from the right or
 * out to it, while the bots list glides between the tab and the bot's left pane.
 */
export function transitionDotNavigation(navigate: () => void) {
  const transitionDocument = document as Document & { startViewTransition?: (callback: () => void) => unknown };
  if (!transitionDocument.startViewTransition || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    navigate();
    return;
  }
  const column = () => document.querySelector<HTMLElement>('.spark-dots__column');
  const from = column()?.getBoundingClientRect();
  try {
    transitionDocument.startViewTransition(() => {
      flushSync(navigate);
      glide(column(), from);
    });
  } catch {
    // A second click can land while the previous transition is finishing; the route still has to change.
    navigate();
  }
}
