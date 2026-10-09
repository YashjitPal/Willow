/**
 * Angular Material's ripple, which Gemini runs on its `mat-mdc-button`s. Recorded off
 * the header model picker: a press grows a circle from the pointer out to the
 * container's farthest corner over 225ms, and release fades it out over 150ms — but
 * never before the growth has finished, so a quick tap still shows the full circle.
 *
 * Only the geometry and timing live here. Colour, the `transition` property list and
 * the `scale3d(0, 0, 0)` start belong to `className`, the way `.mat-ripple-element`
 * carries them upstream.
 */
const ENTER_MS = 225;
const EXIT_MS = 150;

export function launchMaterialRipple(
  container: HTMLElement,
  className: string,
  clientX: number,
  clientY: number,
): () => void {
  const box = container.getBoundingClientRect();
  const x = clientX - box.left;
  const y = clientY - box.top;
  const radius = Math.max(
    Math.hypot(x, y),
    Math.hypot(box.width - x, y),
    Math.hypot(x, box.height - y),
    Math.hypot(box.width - x, box.height - y),
  );

  const ripple = document.createElement('span');
  ripple.className = className;
  ripple.style.left = `${x - radius}px`;
  ripple.style.top = `${y - radius}px`;
  ripple.style.width = `${radius * 2}px`;
  ripple.style.height = `${radius * 2}px`;
  ripple.style.transitionDuration = `${ENTER_MS}ms`;
  container.appendChild(ripple);
  // The start transform has to be computed before it changes, or the growth never animates.
  void getComputedStyle(ripple).transform;
  ripple.style.transform = 'scale3d(1, 1, 1)';
  const startedAt = performance.now();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    window.setTimeout(() => {
      ripple.style.transitionDuration = `${EXIT_MS}ms`;
      ripple.style.opacity = '0';
      window.setTimeout(() => ripple.remove(), EXIT_MS);
    }, Math.max(0, ENTER_MS - (performance.now() - startedAt)));
  };
}
