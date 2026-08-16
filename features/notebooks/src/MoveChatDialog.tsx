import React, { useState } from 'react';
import { useStore } from '@nanostores/react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';

import './notebooks.css';
import type { Notebook } from './notebook-types';
import { notebooksStore, moveChatBetweenNotebooks } from './notebooks-store';

/**
 * "Move Chat" — recorded at **434x465**, and structurally NOT the standard dialog:
 * there is no action row at all, because picking a notebook commits immediately.
 *
 *   surface  bg `rgb(31,31,31)`, radius 32, backdrop `rgba(0,0,0,0.32)`
 *   header   434x56, `padding: 0 16px 0 0`; h1 `padding: 24px 24px 0`, 20px/24px
 *            w470 `rgb(227,227,227)`; a 40x40 close button at dx 378 holding a 24px
 *            `close` glyph in `rgb(196,199,197)`
 *   info     434x38, `padding: 2px 24px 16px`, 15px/20px w400 `rgb(230,230,230)`
 *   list     `padding: 16px 24px 0`, 371px tall and the only scrolling band;
 *            inner list `padding: 8px 0`
 *   row      374x48, `padding: 12px 16px`, text 16px/24px `rgb(227,227,227)`
 *
 * 56 + 38 + 371 = 465, so the height is exactly the three bands stacked.
 *
 * This one does NOT reuse `GeminiDialog`: that component hard-codes a title / content
 * / actions triple, and this dialog has a close button in its header, an info band,
 * and no actions at all.
 */
export const MoveChatDialog: React.FC<{
  chatId: string;
  fromNotebook: Notebook;
  onClose: () => void;
}> = ({ chatId, fromNotebook, onClose }) => {
  const notebooks = useStore(notebooksStore);
  const [isMoving, setIsMoving] = useState(false);

  // Moving a chat into the notebook it already lives in is a no-op, so it isn't offered.
  const targets = notebooks.filter((candidate) => candidate.id !== fromNotebook.id);

  return (
    <div className="nb-move-scrim" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Move Chat"
        className="nb-surface nb-move"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="nb-move-header">
          <h1 className="nb-move-title">Move Chat</h1>
          <button type="button" aria-label="Close" onClick={onClose} className="nb-move-close">
            {/* Measured: a 24px `close` from google-symbols, not the Luminous family. */}
            <MaterialSymbol name="close" family="google-symbols" size={24} />
          </button>
        </div>

        <div className="nb-move-info">Select a notebook to move this chat into</div>

        <div className="nb-move-list">
          <div className="nb-move-list-inner">
            {targets.length === 0 ? (
              <div className="nb-move-empty">No other notebooks yet</div>
            ) : (
              targets.map((target) => (
                <button
                  key={target.id}
                  type="button"
                  disabled={isMoving}
                  onClick={() => {
                    // Guard against a double-click landing two moves.
                    setIsMoving(true);
                    moveChatBetweenNotebooks(fromNotebook.id, target.id, chatId);
                    onClose();
                  }}
                  className="nb-move-row"
                >
                  <span className="nb-move-row-label">{target.title}</span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
