import { atom } from 'nanostores';

/**
 * Snackbar requests raised from anywhere in the app.
 *
 * Same transport-only role as `top-loading-store`: `features/*` may not import
 * from `apps/*`, and the copy buttons that raise this live in
 * `features/chat`, while the overlay that renders it is mounted once at the
 * app root. The atom owns no timing — `<GlobalCopyToast>` owns the measured
 * enter/hold/exit cycle.
 *
 * `id` is what makes a repeat copy replay the animation. The message text is
 * identical every time ("Copied to clipboard"), so a plain string atom would
 * `set` the same value twice, nanostores would treat it as no change, and the
 * second copy would silently show nothing.
 */
/**
 * The trailing button some snackbars carry. Measured: copying a *response*
 * raises "Copied to clipboard" with no button, while copying a *prompt* raises
 * "Prompt copied" with a "Start new chat" button — same box, same animations,
 * so one component renders both and this stays optional.
 */
export interface CopyToastAction {
  label: string;
  onClick: () => void;
}

export interface CopyToastRequest {
  id: number;
  message: string;
  action?: CopyToastAction;
}

export const copyToastRequest = atom<CopyToastRequest | null>(null);

let sequence = 0;

export const showCopyToast = (message: string, action?: CopyToastAction): void => {
  sequence += 1;
  copyToastRequest.set({ id: sequence, message, action });
};
