import React, { useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';

import './notebooks.css';
import { formatSourceCount } from './notebook-types';
import type { Notebook } from './notebook-types';
import {
  hydrateNotebooks,
  notebooksStore,
  renameNotebook,
  setNotebookEmoji,
  subscribeToNotebookWrites,
} from './notebooks-store';

/**
 * A single notebook — Gemini's `project-editor-window-v2`.
 *
 * Measured on the live page (1248px content, sidebar expanded):
 *
 *   project-editor-window-v2   724 wide, top 72
 *   title-container-content    660 wide
 *   .project-emoji             gds-display-m, 36px/36px
 *   h1.gds-display-s           32px/38px w360
 *   gem-source-list-chip       112x48, fully round, "1 Source"
 *   h2.section-title           "Past chats", 15px/20px w540, white/55
 *
 * **The composer is not rebuilt here.** Gemini's notebook page mounts the very
 * same component the new-chat page does: `project-chat-window > chat-window` with
 * `center-input-layout`, whose `fieldset.input-area-container` carries
 * `is-zero-state` — i.e. the centred zero-state composer, not a second one. So
 * this component takes the composer as a node and lets the shell pass Willow's
 * real `<InputBar>` through, which keeps model selection, dictation, attachments,
 * and submit on one implementation instead of two that drift.
 *
 * The source count reads "1 Source" with a capital S on the page chip while the
 * card grid says "1 source" lowercase. That is Gemini's own inconsistency, kept
 * because matching it is the point.
 */
export interface NotebookPageProps {
  notebookId: string;
  /** Willow's composer, rendered in the zero-state position beneath the header. */
  composer?: React.ReactNode;
  /** Past chats belonging to this notebook, newest first. */
  chats?: ReadonlyArray<{ id: string; title: string; subtitle?: string }>;
  onOpenChat?: (chatId: string) => void;
  onOpenSources?: (notebook: Notebook) => void;
  /** Rendered when the id does not resolve — e.g. after a delete in another tab. */
  onMissing?: () => void;
}

/**
 * Gemini offers a small glyph palette when the notebook emoji is clicked. These
 * are the ones observed across the user's own notebooks plus the default, which
 * keeps the picker recognisable without inventing a full emoji keyboard.
 */
const EMOJI_CHOICES = ['📔', '📈', '🧪', '⚗️', '📏', '🎯', '🍎', '🎤', '➕', '➡️', '😥', '📚'];

export const NotebookPage: React.FC<NotebookPageProps> = ({
  notebookId,
  composer,
  chats = [],
  onOpenChat,
  onOpenSources,
  onMissing,
}) => {
  const notebooks = useStore(notebooksStore);
  const notebook = notebooks.find((candidate) => candidate.id === notebookId);

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [isPickingEmoji, setIsPickingEmoji] = useState(false);

  useEffect(() => {
    hydrateNotebooks();
    return subscribeToNotebookWrites();
  }, []);

  useEffect(() => {
    // Only report "missing" once the list has actually been read, or the first
    // render of a deep link would bounce before hydration completes.
    if (!notebook && notebooks.length > 0 && onMissing) onMissing();
  }, [notebook, notebooks.length, onMissing]);

  if (!notebook) return null;

  const commitTitle = () => {
    setIsEditingTitle(false);
    if (draftTitle.trim() && draftTitle !== notebook.title) renameNotebook(notebook.id, draftTitle);
  };

  return (
    <div className="nb-spring flex h-full w-full flex-col items-center overflow-y-auto">
      <div className="flex w-full max-w-[724px] flex-col px-8 pt-[72px]">
        {/* ── header ─────────────────────────────────────────────────────── */}
        <div className="relative flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setIsPickingEmoji((open) => !open)}
            aria-label="Change notebook icon"
            className="nb-page-emoji w-fit rounded-2xl px-1 transition-colors duration-200 hover:bg-white/[0.08]"
          >
            <span aria-hidden="true">{notebook.emoji}</span>
          </button>

          {isPickingEmoji && (
            <div
              role="menu"
              className="absolute left-0 top-[52px] z-20 grid w-[232px] grid-cols-6 gap-1 rounded-2xl bg-[#282a2c] p-2 shadow-[0_2px_6px_2px_rgba(0,0,0,0.15)]"
            >
              {EMOJI_CHOICES.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setNotebookEmoji(notebook.id, emoji);
                    setIsPickingEmoji(false);
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-[20px] transition-colors duration-150 hover:bg-white/[0.08]"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-start justify-between gap-4">
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

            <button
              type="button"
              onClick={() => onOpenSources?.(notebook)}
              className="nb-source-chip shrink-0"
            >
              <MaterialSymbol
                name="library_books"
                family="luminous"
                size={20}
                weight={320}
                roundness={100}
                opticalSize={20}
              />
              {/* Capital "S" is Gemini's, and differs from the card grid. */}
              {`${notebook.sources.length} ${notebook.sources.length === 1 ? 'Source' : 'Sources'}`}
            </button>
          </div>
        </div>

        {/* ── composer, in the zero-state position ───────────────────────── */}
        {composer && <div className="mt-10 w-full">{composer}</div>}

        {/* ── past chats ─────────────────────────────────────────────────── */}
        <div className="mt-9 flex w-full flex-col">
          <h2 className="nb-section-title">Past chats</h2>
          {chats.length === 0 ? (
            <p className="mt-3 text-[15px] leading-5 text-white/40">
              Chats you start here will appear in this notebook.
            </p>
          ) : (
            <div className="mt-2 flex flex-col">
              {chats.map((chat) => (
                <button
                  key={chat.id}
                  type="button"
                  onClick={() => onOpenChat?.(chat.id)}
                  className="flex flex-col items-start gap-0.5 rounded-2xl px-3 py-3 text-left transition-colors duration-150 hover:bg-white/[0.06]"
                >
                  <span className="text-[15px] leading-5 text-[#e3e3e3]">{chat.title}</span>
                  {chat.subtitle && (
                    <span className="text-[13px] leading-[17px] text-white/55">{chat.subtitle}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="h-16 shrink-0" />
      </div>
    </div>
  );
};
