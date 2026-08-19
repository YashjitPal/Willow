import React, { useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';

import './notebooks.css';
import { hydrateNotebooks, notebooksStore, subscribeToNotebookWrites } from './notebooks-store';
import { useNotebookDisk } from './useNotebookDisk';

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
 *
 * **It is also "Add to notebook".** A chat that is not in a notebook yet — reached
 * from the conversation menu or a Recents row's menu — gets the same dialog under a
 * different title, because it is the same choice. Only the title, the info line, the
 * empty-state string and whether the owning notebook is excluded from the list
 * differ. The bands are all fixed heights and both info strings are one line, so the
 * measured 434x465 holds either way.
 *
 * The owning notebook is **derived** from `chatId`, not passed in: it is a function
 * of the registry, so a prop would only let a caller disagree with it. That also
 * makes the dialog correct from the shell, where nothing else has read the registry —
 * hence the hydrate below, which the notebook page's own mount makes redundant but
 * which the sidebar's does not (its Notebooks section is unmounted while collapsed).
 */
export const MoveChatDialog: React.FC<{
  chatId: string;
  onClose: () => void;
}> = ({ chatId, onClose }) => {
  const notebooks = useStore(notebooksStore);
  const { fileChat } = useNotebookDisk();
  const [isMoving, setIsMoving] = useState(false);

  useEffect(() => {
    hydrateNotebooks();
    return subscribeToNotebookWrites();
  }, []);

  // Chats live in at most one notebook, so the first match is the owner.
  const fromNotebook = notebooks.find((notebook) => notebook.chatIds.includes(chatId)) ?? null;

  const title = fromNotebook ? 'Move Chat' : 'Add to notebook';

  // Moving a chat into the notebook it already lives in is a no-op, so it isn't offered.
  const targets = fromNotebook ? notebooks.filter((candidate) => candidate.id !== fromNotebook.id) : notebooks;

  return (
    <div className="nb-move-scrim" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="nb-surface nb-move"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="nb-move-header">
          <h1 className="nb-move-title">{title}</h1>
          <button type="button" aria-label="Close" onClick={onClose} className="nb-move-close">
            {/* Measured: a 24px `close` from google-symbols, not the Luminous family. */}
            <MaterialSymbol name="close" family="google-symbols" size={24} />
          </button>
        </div>

        <div className="nb-move-info">
          {fromNotebook ? 'Select a notebook to move this chat into' : 'Select a notebook to add this chat to'}
        </div>

        <div className="nb-move-list">
          <div className="nb-move-list-inner">
            {targets.length === 0 ? (
              <div className="nb-move-empty">{fromNotebook ? 'No other notebooks yet' : 'No notebooks yet'}</div>
            ) : (
              targets.map((target) => (
                <button
                  key={target.id}
                  type="button"
                  disabled={isMoving}
                  onClick={() => {
                    // Guard against a double-click landing two moves.
                    setIsMoving(true);
                    /*
                     * `fileChat` covers both modes: it unfiles from whichever notebook
                     * currently owns the chat before filing it here, so this one call
                     * is correct whether the chat was in a notebook or not. The disk
                     * half is not awaited — the dialog closes on the click, as Gemini's
                     * does, and a move that fails leaves the record dirty for the
                     * reconciler to finish.
                     */
                    void fileChat(chatId, target.id);
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
