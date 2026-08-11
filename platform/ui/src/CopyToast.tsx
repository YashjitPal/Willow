import * as React from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@nanostores/react';
import { copyToastRequest, type CopyToastAction } from './copy-toast-store';
import './CopyToast.css';

/*
 * Gemini's copy snackbars, reproduced from measurement.
 *
 * Every visual value lives in `CopyToast.css` and was read off
 * gemini.google.com rather than chosen — see the header comment there. This
 * file is only the behaviour: where it mounts, and the timing of the three
 * phases.
 *
 * Gemini raises TWO of these, and they share everything but the label and the
 * trailing button:
 *
 *   response Copy  ->  "Copied to clipboard",  no button
 *   prompt Copy    ->  "Prompt copied"      +  "Start new chat"
 *
 * Both are Angular Material `mat-snack-bar`s in a CDK overlay pinned to the
 * bottom-LEFT of the viewport. Measured before and after the click, neither
 * Copy button swaps to a tick — the snackbar alone is the feedback.
 */

/**
 * Measured lifecycle of one snackbar, from a single uninterrupted page-side
 * rAF clock (an earlier pass timed it across CDP round-trips and the number
 * was meaningless):
 *
 *   node inserted -> exit animation starts    2163.4ms
 *   exit starts   -> removed from the DOM       83.7ms
 *   total on screen                          2247.1ms
 *
 * 2163 − the 150ms enter ≈ 2000ms, which is the configured duration: Material
 * arms its dismiss timer only once the enter animation has finished, so the
 * dwell is measured from `animationend`, not from mount. That is why the timer
 * below waits for the enter event instead of starting immediately.
 */
const DWELL_MS = 2000;
const ENTER_MS = 150;
const EXIT_MS = 75;

const ENTER_ANIMATION = 'willow-copy-toast-enter';

/**
 * One overlay host for the whole app, appended to `<body>` — the same shape as
 * `Tooltip`'s, and as Gemini's own `.cdk-overlay-container`. Queried before
 * creating so React's StrictMode double-invoke cannot produce two, and left in
 * place on unmount because the CDK container persists too.
 */
function getOverlayContainer(): HTMLElement {
  const existing = document.querySelector<HTMLElement>('.willow-copy-toast-container');
  if (existing) return existing;
  const el = document.createElement('div');
  el.className = 'willow-copy-toast-container';
  document.body.appendChild(el);
  return el;
}

interface CopyToastInstanceProps {
  message: string;
  action?: CopyToastAction;
  onDone: () => void;
}

/**
 * A single snackbar. Mounted keyed by request id, so it is always freshly
 * mounted and always plays its enter animation from frame one.
 */
function CopyToastInstance({ message, action, onDone }: CopyToastInstanceProps) {
  const [hiding, setHiding] = React.useState(false);
  const nodeRef = React.useRef<HTMLDivElement | null>(null);

  // Arm the dwell timer when the enter animation ends. The timeout is only a
  // safety net for a dropped `animationend` — same belt-and-braces as Tooltip.
  React.useEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    let dwell: number | undefined;
    let armed = false;

    const arm = () => {
      if (armed) return;
      armed = true;
      dwell = window.setTimeout(() => setHiding(true), DWELL_MS);
    };
    const onEnd = (e: AnimationEvent) => {
      if (e.animationName === ENTER_ANIMATION) arm();
    };

    node.addEventListener('animationend', onEnd);
    const fallback = window.setTimeout(arm, ENTER_MS + 50);
    return () => {
      node.removeEventListener('animationend', onEnd);
      window.clearTimeout(fallback);
      if (dwell !== undefined) window.clearTimeout(dwell);
    };
  }, []);

  // Tear down when the exit animation ends, which is what Gemini does — the
  // node left the DOM 83.7ms after a 75ms exit animation began.
  React.useEffect(() => {
    if (!hiding) return;
    const node = nodeRef.current;
    const done = () => onDone();
    node?.addEventListener('animationend', done);
    const timer = window.setTimeout(done, EXIT_MS + 50);
    return () => {
      node?.removeEventListener('animationend', done);
      window.clearTimeout(timer);
    };
  }, [hiding, onDone]);

  /*
   * Clicking the action dismisses the snackbar. Measured by clicking Gemini's
   * own "Start new chat" once (then restoring the conversation URL): the node
   * ran the same `_mat-snack-bar-exit` and left the DOM. The latency that
   * capture recorded — 655ms before the exit began, then removal only 14.5ms
   * into a 75ms animation — is the route change tearing the overlay down, not
   * a designed delay, so it is deliberately NOT reproduced. The dismissal
   * itself runs the normal exit path below.
   */
  const handleAction = () => {
    setHiding(true);
    action?.onClick();
  };

  return (
    <div
      ref={nodeRef}
      className={hiding ? 'willow-copy-toast willow-copy-toast--hiding' : 'willow-copy-toast'}
    >
      <div className="willow-copy-toast__surface" role="status">
        <div className="willow-copy-toast__row">
          <div className="willow-copy-toast__label">{message}</div>
          {action && (
            <div className="willow-copy-toast__actions">
              <button type="button" className="willow-copy-toast__action" onClick={handleAction}>
                <span className="willow-copy-toast__action-label">{action.label}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Mount once at the app root, beside `<GlobalTooltips />`. Renders whatever
 * `showCopyToast()` last asked for.
 *
 * A second copy while one is still on screen replaces it in place and replays
 * the enter animation from the start — the `key` remounts the instance. Not
 * measured: Gemini's Material queues instead (it dismisses the live snackbar,
 * waits for its exit, then attaches the next), which would insert a ~75ms gap
 * between the two. Worth revisiting only if that gap turns out to be visible.
 */
export function GlobalCopyToast() {
  const [container] = React.useState(getOverlayContainer);
  const request = useStore(copyToastRequest);

  const handleDone = React.useCallback(() => {
    const current = copyToastRequest.get();
    if (current && request && current.id === request.id) copyToastRequest.set(null);
  }, [request]);

  if (!request) return null;

  return createPortal(
    <CopyToastInstance
      key={request.id}
      message={request.message}
      action={request.action}
      onDone={handleDone}
    />,
    container,
  );
}

export default GlobalCopyToast;
