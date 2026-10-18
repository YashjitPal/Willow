import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** The node leaves this long after the close starts: Gemini's was gone by ~92ms of its 75ms fade. */
const CLOSE_MS = 90;

interface ScheduledDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Gemini's `lumi-dialog` for "Discard changes?" / "Discard new task?": a 420px card with 40px
 * corners and a 12% outline over Material's 32% scrim. It opens as Material's dialog does —
 * the scrim fading in over 400ms, the card scaling 0.8 to 1 in 150ms — and closes by fading
 * the card out in 75ms. Focus starts on the confirm button, quietly.
 */
export const ScheduledDialog: React.FC<ScheduledDialogProps> = ({ title, message, confirmLabel, onCancel, onConfirm }) => {
  const [shown, setShown] = useState(false);
  const [closing, setClosing] = useState(false);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const restoreRef = useRef<Element | null>(typeof document === 'undefined' ? null : document.activeElement);
  const titleId = React.useId();

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setShown(true);
      confirmRef.current?.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const finish = (then: () => void) => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(() => {
      then();
      const restore = restoreRef.current;
      if (restore instanceof HTMLElement && restore.isConnected) restore.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
    }, CLOSE_MS);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish(onCancel);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  });

  return createPortal(
    <div className="sched-scope sched-dialog-host">
      <div
        aria-hidden="true"
        className={`sched-dialog-backdrop${shown && !closing ? ' is-shown' : ''}`}
        onClick={() => finish(onCancel)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`sched-dialog${shown ? ' is-shown' : ''}${closing ? ' is-closing' : ''}`}
      >
        <div className="sched-dialog-body">
          <h1 id={titleId} className="sched-dialog-title">{title}</h1>
          <p className="sched-dialog-content sched-body-m">{message}</p>
        </div>
        <div className="sched-dialog-actions">
          <button type="button" className="sched-button sched-body-m" onClick={() => finish(onCancel)}>
            <span>Cancel</span>
          </button>
          <button ref={confirmRef} type="button" className="sched-button sched-button--tonal sched-body-m" onClick={() => finish(onConfirm)}>
            <span>{confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
