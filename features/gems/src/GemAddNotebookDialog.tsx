import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@nanostores/react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { hydrateNotebooks, notebooksStore } from '@willow/notebooks/notebooks-store';
import { UNTITLED_NOTEBOOK_TITLE, type Notebook } from '@willow/notebooks/notebook-types';

const CLOSE_MS = 125;

const createdLabel = (time: number): string =>
  `Created ${new Date(time).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;

const sourcesLabel = (count: number): string => `${count} source${count === 1 ? '' : 's'}`;

/**
 * Gemini's "Add notebook" picker, opened from the knowledge uploader's notebook row: a
 * 600px dialog, at most 576 tall, listing notebooks under "Recent", several selectable at
 * once — a selected row turns blue-low with a primary check at its end — and Add disabled
 * until one is. Here it lists Willow's own notebooks, most recently changed first.
 */
export const GemAddNotebookDialog: React.FC<{
  onAdd: (notebooks: Notebook[]) => void;
  onClose: () => void;
}> = ({ onAdd, onClose }) => {
  const notebooks = useStore(notebooksStore);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [closing, setClosing] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => { hydrateNotebooks(); }, []);
  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const recent = useMemo(() => [...notebooks].sort((a, b) => b.updatedAt - a.updatedAt), [notebooks]);

  const close = useCallback(() => {
    if (timerRef.current !== undefined) return;
    setClosing(true);
    timerRef.current = window.setTimeout(onClose, CLOSE_MS);
  }, [onClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      close();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [close]);

  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const add = () => {
    const chosen = recent.filter((notebook) => selected.has(notebook.id));
    if (!chosen.length) return;
    onAdd(chosen);
    close();
  };

  return createPortal(
    <div className={`gems-surface gem-nb-dialog-layer${closing ? ' is-closing' : ''}`}>
      <div className="gem-nb-dialog-scrim" onClick={close} />
      <div role="dialog" aria-modal="true" aria-labelledby="gem-nb-dialog-title" className="gem-nb-dialog">
        <div className="gem-nb-dialog-header">
          <div className="gem-nb-dialog-title">
            <MaterialSymbol
              name="notebook"
              family="luminous"
              size={28}
              variationSettings={'"FILL" 0, "GRAD" 0, "ROND" 100, "opsz" 28, "wght" 260'}
            />
            <h2 id="gem-nb-dialog-title">Add notebook</h2>
          </div>
          <button type="button" aria-label="Close" className="gems-icon-button gem-nb-dialog-close" onClick={close} autoFocus>
            <MaterialSymbol name="close" family="google-symbols" size={24} weight={400} />
          </button>
        </div>
        <div className="gem-nb-dialog-content gemini-chat-scrollbar">
          {recent.length ? (
            <div role="listbox" aria-multiselectable="true" aria-labelledby="gem-nb-dialog-section" className="gem-nb-dialog-list">
              <h3 id="gem-nb-dialog-section" className="gem-nb-dialog-section">Recent</h3>
              {recent.map((notebook) => {
                const isSelected = selected.has(notebook.id);
                return (
                  <div
                    key={notebook.id}
                    role="option"
                    aria-selected={isSelected}
                    tabIndex={0}
                    className={`gem-nb-dialog-row${isSelected ? ' is-selected' : ''}`}
                    onClick={() => toggle(notebook.id)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      toggle(notebook.id);
                    }}
                  >
                    <span className="gem-nb-dialog-chip">
                      <MaterialSymbol
                        name="book_5"
                        family="luminous"
                        size={24}
                        variationSettings={'"FILL" 0, "GRAD" 0, "ROND" 100, "opsz" 24, "wght" 300'}
                      />
                    </span>
                    <span className="gem-nb-dialog-content-row">
                      <span className="gem-nb-dialog-text">
                        <span className="gem-nb-dialog-name">{notebook.title || UNTITLED_NOTEBOOK_TITLE}</span>
                        <span className="gem-nb-dialog-meta">
                          <span>{sourcesLabel(notebook.sources.length)}</span>
                          <span className="gem-nb-dialog-separator"> • </span>
                          <time dateTime={new Date(notebook.createdAt).toISOString()}>{createdLabel(notebook.createdAt)}</time>
                        </span>
                      </span>
                      {isSelected && (
                        <MaterialSymbol name="check" family="google-symbols" size={24} weight={400} className="gem-nb-dialog-check" />
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="gem-nb-dialog-empty">You don’t have any notebooks yet.</p>
          )}
        </div>
        <div className="gem-nb-dialog-actions">
          <div className="gem-nb-dialog-count" aria-live="polite">{selected.size ? `${selected.size} selected` : ''}</div>
          <button type="button" className="gem-nb-dialog-add" disabled={!selected.size} onClick={add}>Add</button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
