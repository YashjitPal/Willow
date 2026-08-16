import React, { useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';

import './notebooks.css';
import type { Notebook } from './notebook-types';
import { NotebookSourcesDialog } from './NotebookSourcesDialog';
import {
  hydrateNotebooks,
  notebooksHydratedStore,
  notebooksStore,
  renameNotebook,
  setNotebookEmoji,
  subscribeToNotebookWrites,
} from './notebooks-store';

/**
 * A single notebook — Gemini's `project-editor-window-v2`.
 *
 * Measured on a real notebook with **zero** sources, 660px column at x=582:
 *
 *   .project-emoji            y 257, 36px/36px
 *   title row                 32px/38px w360 title, chip on the right
 *   gem-source-list-chip      y 305, 116x48, pill `rgb(31,31,31)`, radius full,
 *                             padding 0 16, label gds-body-m 15/20
 *   composer (is-zero-state)  y 381, 660x64
 *   h2 "Past chats"           y 501, 15/20 w540, rgba(255,255,255,0.55)
 *   .notebook-empty-state     y 537, flex, gap 12, padding 16
 *     chat_bubble             20px Luminous, rgb(154,155,156)
 *     "Notebook chats will appear here"  15px, rgb(154,155,156)
 *
 * ── The chip changes identity at zero ──────────────────────────────────────
 *
 * With no sources the chip reads **"Add sources"** and carries `lm-no-icons` — no
 * leading glyph at all. Once there is at least one it becomes "N Sources" with an
 * icon. It is the same component in Gemini, so it is one element here with the
 * label and icon switched rather than two components.
 *
 * ── The composer is not rebuilt here ───────────────────────────────────────
 *
 * Gemini's notebook page mounts the same composer the new-chat page does:
 * `project-chat-window > chat-window` with `center-input-layout`, whose
 * `fieldset.input-area-container` carries `is-zero-state`. So this takes a render
 * prop and the shell passes Willow's real `<InputBar>` through — model picker,
 * dictation, attachments and submit all stay on one implementation. Sending is
 * routed through `startNotebookChat` (see `notebook-chat-store.ts`).
 */
export interface NotebookPageProps {
  notebookId: string;
  /**
   * Willow's composer, in the zero-state position under the header. Takes the
   * notebook so the shell can ground the turn on its sources.
   */
  renderComposer?: (notebook: Notebook) => React.ReactNode;
  /** Past chats belonging to this notebook, newest first. */
  chats?: ReadonlyArray<{ id: string; title: string; subtitle?: string }>;
  onOpenChat?: (chatId: string) => void;
  /** Called when the id does not resolve — e.g. after a delete in another tab. */
  onMissing?: () => void;
}

/**
 * Gemini offers a small glyph palette when the notebook emoji is clicked. These
 * are the ones observed across real notebooks plus the default, which keeps the
 * picker recognisable without inventing a full emoji keyboard.
 */
const EMOJI_CHOICES = ['📔', '📈', '🧪', '⚗️', '📏', '🎯', '🍎', '🎤', '➕', '➡️', '😥', '📚'];

export const NotebookPage: React.FC<NotebookPageProps> = ({
  notebookId,
  renderComposer,
  chats = [],
  onOpenChat,
  onMissing,
}) => {
  const notebooks = useStore(notebooksStore);
  const isHydrated = useStore(notebooksHydratedStore);
  const notebook = notebooks.find((candidate) => candidate.id === notebookId);

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [isPickingEmoji, setIsPickingEmoji] = useState(false);
  const [isSourcesOpen, setIsSourcesOpen] = useState(false);

  useEffect(() => {
    hydrateNotebooks();
    return subscribeToNotebookWrites();
  }, []);

  useEffect(() => {
    // Only report "missing" once the list has actually been read, or a deep link
    // would bounce before hydration completes.
    if (isHydrated && !notebook && onMissing) onMissing();
  }, [isHydrated, notebook, onMissing]);

  if (!notebook) return <div className="h-full w-full" />;

  const commitTitle = () => {
    setIsEditingTitle(false);
    if (draftTitle.trim() && draftTitle !== notebook.title) renameNotebook(notebook.id, draftTitle);
  };

  const sourceCount = notebook.sources.length;

  return (
    <div className="nb-surface nb-page-host">
      <div className="nb-page-column">
        {/* ── emoji ───────────────────────────────────────────────────────── */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setIsPickingEmoji((open) => !open)}
            aria-label="Change notebook icon"
            className="nb-page-emoji"
          >
            <span aria-hidden="true">{notebook.emoji}</span>
          </button>

          {isPickingEmoji && (
            <div role="menu" className="nb-emoji-menu">
              {EMOJI_CHOICES.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setNotebookEmoji(notebook.id, emoji);
                    setIsPickingEmoji(false);
                  }}
                  className="nb-emoji-choice"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── title + sources chip ────────────────────────────────────────── */}
        <div className="nb-page-title-row">
          {isEditingTitle ? (
            <input
              autoFocus
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              onBlur={commitTitle}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitTitle();
                if (event.key === 'Escape') setIsEditingTitle(false);
              }}
              maxLength={200}
              aria-label="Notebook title"
              className="nb-page-title min-w-0 flex-1 bg-transparent outline-none"
            />
          ) : (
            <h1
              role="button"
              tabIndex={0}
              onClick={() => {
                setDraftTitle(notebook.title);
                setIsEditingTitle(true);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  setDraftTitle(notebook.title);
                  setIsEditingTitle(true);
                }
              }}
              className="nb-page-title min-w-0 flex-1 cursor-text outline-none"
            >
              {notebook.title}
            </h1>
          )}

          <button type="button" onClick={() => setIsSourcesOpen(true)} className="nb-source-chip">
            {sourceCount > 0 && (
              <MaterialSymbol
                name="description"
                family="luminous"
                size={20}
                weight={320}
                roundness={100}
                opticalSize={20}
              />
            )}
            {/* Capital "S" is Gemini's, and differs from the card grid's lowercase. */}
            {sourceCount === 0 ? 'Add sources' : `${sourceCount} ${sourceCount === 1 ? 'Source' : 'Sources'}`}
          </button>
        </div>

        {/* ── composer, in the zero-state position ────────────────────────── */}
        {renderComposer && <div className="nb-page-composer">{renderComposer(notebook)}</div>}

        {/* ── past chats ─────────────────────────────────────────────────── */}
        <h2 className="nb-section-title nb-page-section">Past chats</h2>
        {chats.length === 0 ? (
          <div className="nb-empty-state">
            <MaterialSymbol
              name="chat_bubble"
              family="luminous"
              size={20}
              weight={320}
              roundness={100}
              opticalSize={20}
            />
            <span className="nb-empty-text">Notebook chats will appear here</span>
          </div>
        ) : (
          <div className="flex flex-col">
            {chats.map((chat) => (
              <button key={chat.id} type="button" onClick={() => onOpenChat?.(chat.id)} className="nb-chat-row">
                <MaterialSymbol
                  name="chat_bubble"
                  family="luminous"
                  size={20}
                  weight={320}
                  roundness={100}
                  opticalSize={20}
                  className="shrink-0 text-white/55"
                />
                <span className="nb-chat-row-title">{chat.title}</span>
                {chat.subtitle && <span className="nb-chat-row-sub">{chat.subtitle}</span>}
              </button>
            ))}
          </div>
        )}

        <div className="h-16 shrink-0" />
      </div>

      {isSourcesOpen && <NotebookSourcesDialog notebook={notebook} onClose={() => setIsSourcesOpen(false)} />}
    </div>
  );
};
