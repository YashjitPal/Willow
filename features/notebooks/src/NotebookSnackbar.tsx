import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { atom } from 'nanostores';
import { useStore } from '@nanostores/react';

import './notebooks.css';

/**
 * Gemini's confirmation snackbar — the "Deleted from <notebook>" toast that appears
 * after **Remove from notebook**.
 *
 * Recorded from the live app:
 *
 *   host      bottom-LEFT, the surface inset 24px from both edges
 *   surface   386.5x60, min-width 344, bg `rgb(31,31,31)`, radius **16px**,
 *             shadow `0 0 20px rgba(0,0,0,0.28)`, padding `0 12px 0 0`
 *   label     15px/20px w400 `rgb(230,230,230)`, padding `12px 4px 12px 24px`
 *
 * Bottom-left, not bottom-centre — consistent with Gemini's other snackbars.
 */
const $snack = atom<{ id: number; message: string } | null>(null);

let nextId = 0;
let hideTimer: number | undefined;

/** Show a snackbar. Calling again replaces the current one and restarts its timer. */
export const showNotebookSnack = (message: string, ms = 4000): void => {
  if (hideTimer !== undefined) window.clearTimeout(hideTimer);
  $snack.set({ id: ++nextId, message });
  hideTimer = window.setTimeout(() => {
    $snack.set(null);
    hideTimer = undefined;
  }, ms);
};

export const NotebookSnackbar: React.FC = () => {
  const snack = useStore($snack);

  // A live region so the message is announced; the visual toast is easy to miss.
  useEffect(() => () => { if (hideTimer !== undefined) window.clearTimeout(hideTimer); }, []);

  if (!snack) return null;
  return createPortal(
    <div className="nb-snack-host" role="status" aria-live="polite">
      <div className="nb-surface nb-snack">
        <span className="nb-snack-label">{snack.message}</span>
      </div>
    </div>,
    document.body,
  );
};
