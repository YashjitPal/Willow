import React, { useEffect, useId, useRef, useState } from 'react';
import './SparkTaskDialogs.css';

/**
 * The Rename and Delete confirmations behind a task row's action menu.
 *
 * Copy is Gemini's, verbatim from the live dialogs:
 *   Rename — title "Rename this thread", buttons "Cancel" / "Rename", and the
 *            confirm button is disabled until the name actually changes.
 *   Delete — title "Delete this thread?", body "All prompts, responses and feedback
 *            will be deleted from your Gemini Apps activity, along with any
 *            schedules created." followed by a "Learn more" link that opens in a
 *            new window.
 *
 * `SparkAllTasks` and `SparkTaskDetail` still carry their own older copies of these
 * dialogs ("Rename task" / "Save", "Delete task?"); they should move onto this
 * component rather than a fourth copy being added.
 */

const LEARN_MORE_URL = 'https://support.google.com/gemini?p=activity';

interface SparkTaskRenameDialogProps {
  currentTitle: string;
  onCancel: () => void;
  onConfirm: (title: string) => void;
}

export const SparkTaskRenameDialog: React.FC<SparkTaskRenameDialogProps> = ({
  currentTitle,
  onCancel,
  onConfirm,
}) => {
  const [draft, setDraft] = useState(currentTitle);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  const trimmed = draft.trim();

  return (
    <SparkDialogBackdrop onDismiss={onCancel}>
      <form
        className="spark-task-dialog spark-task-dialog--rename"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={(event) => {
          event.preventDefault();
          if (!trimmed || trimmed === currentTitle) return;
          onConfirm(trimmed);
        }}
      >
        <h2 id={titleId}>Rename this thread</h2>
        <input
          ref={inputRef}
          value={draft}
          aria-label="Thread name"
          maxLength={120}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="spark-task-dialog__actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit" disabled={!trimmed || trimmed === currentTitle}>Rename</button>
        </div>
      </form>
    </SparkDialogBackdrop>
  );
};

interface SparkTaskDeleteDialogProps {
  onCancel: () => void;
  onConfirm: () => void;
}

export const SparkTaskDeleteDialog: React.FC<SparkTaskDeleteDialogProps> = ({ onCancel, onConfirm }) => {
  const titleId = useId();
  const descriptionId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <SparkDialogBackdrop onDismiss={onCancel}>
      <div
        className="spark-task-dialog spark-task-dialog--delete"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <h2 id={titleId}>Delete this thread?</h2>
        <p id={descriptionId}>
          All prompts, responses and feedback will be deleted from your Willow activity, along with
          any schedules created.{' '}
          <a href={LEARN_MORE_URL} target="_blank" rel="noopener noreferrer">
            Learn more
          </a>
        </p>
        <div className="spark-task-dialog__actions">
          <button ref={cancelRef} type="button" onClick={onCancel}>Cancel</button>
          <button type="button" onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </SparkDialogBackdrop>
  );
};

const SparkDialogBackdrop: React.FC<{ onDismiss: () => void; children: React.ReactNode }> = ({
  onDismiss,
  children,
}) => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onDismiss();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onDismiss]);

  return (
    <div
      className="spark-task-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onDismiss();
      }}
    >
      {children}
    </div>
  );
};
