import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import './notebooks.css';
import type { Notebook } from './notebook-types';
import { updateNotebook } from './notebooks-store';

/** Exit animation plus its 25ms delay — see `.nb-sheet-exit`. */
const SETTINGS_EXIT_MS = 125;

/**
 * Gemini's `project-instructions-editor` — the Notebook settings sheet, 512x446.
 *
 * Recorded measurements:
 *
 *   surface       bg `rgb(31,31,31)`, radius 32, **padding 20px** (not the usual 24)
 *   content       flex column, `gap: 20px`
 *   header        48px tall; h2 `padding: 24px 24px 0`, 20px/24px w470
 *   body          flex column, `gap: 12px`
 *   setting row   `padding: 12px 0`, space-between, label + description stacked 4px
 *   label         16px/24px w400 `rgb(230,230,230)`
 *   description   15px/20px w400 **`rgba(255,255,255,0.55)`**
 *   switch        52x32 track radius 9999, 24x24 handle
 *   textarea      bg `rgb(23,23,23)`, radius 16, padding 16, **17px/24px**,
 *                 `min-height: 120px`
 *   actions       40px tall, flex-end, gap 8
 *   Cancel        87x40, `padding: 0 20px`, 14px w500 `rgba(255,255,255,0.55)`, no fill
 *   Save          79.9x40, `padding: 0 24px`; DISABLED measured as
 *                 bg `rgba(230,230,230,0.12)` / ink `rgba(230,230,230,0.38)`
 *
 * Note the two bands are siblings, not nested: the switch lives in a `.setting-row`
 * that is `space-between`, while Instructions is a bare `.setting-text` followed by
 * the textarea. So the label/description pair is reused in two different layouts.
 */
export const NotebookSettingsDialog: React.FC<{
  notebook: Notebook;
  onClose: () => void;
}> = ({ notebook, onClose }) => {
  const [useMemory, setUseMemory] = useState(notebook.useMemory ?? false);
  const [instructions, setInstructions] = useState(notebook.instructions ?? '');

  // Gemini keeps Save disabled until something actually changes.
  const isDirty = useMemory !== (notebook.useMemory ?? false)
    || instructions !== (notebook.instructions ?? '');

  /*
   * Held open for the length of the exit fade — see `.nb-sheet-exit`. The parent
   * owns the mount, so a bare `onClose()` removes the tree in the same frame and
   * the animation never plays. Same shape as the Sources dialog.
   */
  const [isClosing, setIsClosing] = useState(false);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const requestClose = React.useCallback(() => {
    if (closeTimerRef.current !== undefined) return;
    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(onClose, SETTINGS_EXIT_MS);
  }, [onClose]);

  useEffect(() => () => {
    if (closeTimerRef.current !== undefined) window.clearTimeout(closeTimerRef.current);
  }, []);

  const save = () => {
    updateNotebook(notebook.id, { useMemory, instructions });
    requestClose();
  };

  return createPortal(
    <div
      className={`nb-set-scrim ${isClosing ? 'nb-sheet-exit' : ''}`}
      onClick={requestClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Notebook settings"
        className="nb-surface nb-set"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="nb-set-content">
          <div className="nb-set-header">
            <h2 className="nb-set-title">Notebook settings</h2>
          </div>

          <div className="nb-set-body">
            <div className="nb-set-row">
              <div className="nb-set-text">
                <span className="nb-set-label">Use notebook memory</span>
                <span className="nb-set-desc">
                  Consider all chats in this notebook when responding
                </span>
              </div>
              {/*
               * Gemini's `mat-slide-toggle`. The handle is positioned by its own
               * margin inside a zero-width `__handle-track`, which is how MDC slides
               * it — reproduced here with a transform, same end geometry.
               */}
              <button
                type="button"
                role="switch"
                aria-checked={useMemory}
                aria-label="Use notebook memory"
                onClick={() => setUseMemory((on) => !on)}
                className={`nb-switch ${useMemory ? 'is-on' : ''}`}
              >
                <span className="nb-switch-track" />
                <span className="nb-switch-handle" />
              </button>
            </div>

            <div className="nb-set-text">
              <span className="nb-set-label">Instructions</span>
              <span className="nb-set-desc">
                Tell Gemini how to respond and what tone to use
              </span>
            </div>

            <textarea
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder="Add detailed instructions to customize how Gemini helps with this notebook, like the tone it should use or how it should format its response."
              className="nb-set-textarea"
            />
          </div>

          <div className="nb-set-actions">
            <button type="button" onClick={requestClose} className="nb-set-cancel">Cancel</button>
            <button type="button" disabled={!isDirty} onClick={save} className="nb-set-save">Save</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
