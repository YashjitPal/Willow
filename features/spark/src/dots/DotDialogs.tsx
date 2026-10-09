import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { DOT_NAME_MAX_LENGTH, isDefaultDotName, normalizeDotName } from './character/appearance-picker/dot-names';
import { sparkDotName, updateSparkDot, type SparkDot } from './dots-store';
import '../SparkTaskDetail.css';

/** Escape closes the dialog, and Tab stays inside it, as in a Spark task's rename and delete dialogs. */
function useDialogKeys(dialogRef: RefObject<HTMLElement | null>, onClose: () => void) {
  const latestClose = useRef(onClose);
  latestClose.current = onClose;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        latestClose.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [dialogRef]);
}

/**
 * A Spark task's rename dialog, for a bot. Codex's nickname rules apply: up to 24 characters, no backslashes,
 * and "bot" or an empty name means no nickname.
 */
export function DotRenameDialog({ dot, onClose }: { dot: SparkDot; onClose: () => void }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(dot.name ?? '');
  useDialogKeys(dialogRef, onClose);

  useEffect(() => {
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextName = normalizeDotName(draft);
    if (!nextName) return;
    updateSparkDot(dot.id, { name: isDefaultDotName(nextName) ? null : nextName });
    onClose();
  };

  return createPortal(
    <div
      className="spark-task-detail__dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <form ref={dialogRef} className="spark-task-detail__rename-dialog" onSubmit={save} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>Rename this bot</h2>
        <input ref={inputRef} value={draft} maxLength={DOT_NAME_MAX_LENGTH} placeholder="bot" aria-label="Bot name" onChange={(event) => setDraft(event.target.value)} />
        <div className="spark-task-detail__rename-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={!normalizeDotName(draft)}>
            Rename
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

/** A Spark task's delete dialog, for a bot. `onDelete` removes it, leaving the bot first if it is open. */
export function DotDeleteDialog({ dot, onClose, onDelete }: { dot: SparkDot; onClose: () => void; onDelete: () => void }) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useDialogKeys(dialogRef, onClose);

  useEffect(() => {
    window.requestAnimationFrame(() => cancelRef.current?.focus());
  }, []);

  return createPortal(
    <div
      className="spark-task-detail__dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div ref={dialogRef} className="spark-task-detail__delete-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
        <h2 id={titleId}>Delete this bot?</h2>
        <p id={descriptionId}>{sparkDotName(dot)} and its conversation will be deleted from your Willow activity, and any work it is doing will stop.</p>
        <div className="spark-task-detail__delete-actions">
          <button ref={cancelRef} type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="is-danger" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
