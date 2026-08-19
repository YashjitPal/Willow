import React, { useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';

import './notebooks.css';
import { NotebooksSplashScreen } from './NotebooksSplashScreen';
import { formatSourceCount } from './notebook-types';
import type { Notebook } from './notebook-types';
import {
  hydrateNotebooks,
  notebooksHydratedStore,
  notebooksStore,
  subscribeToNotebookWrites,
  toggleNotebookPinned,
} from './notebooks-store';
import { useNotebookDisk } from './useNotebookDisk';

/**
 * The "All notebooks" grid — Gemini's `project-mgmt` in `notebook-card-view`.
 *
 * Measured on the live page at a 1236px container:
 *
 *   inner-container   padding 24px
 *   list-header       h 60 — h1 "Notebooks" (gds-headline-m, 28px tall) left,
 *                     a `New notebook` primary button (127x36) right
 *   card              291 x 185, radius 40, bg rgb(27,27,27), padding 32
 *   grid pitch        299 across (291 + 8 gap), 193 down (185 + 8 gap) → 4 cols
 *   card-emoji        36px/36px
 *   card title        gds-title-l  20px/24px w470
 *   card sources      gds-body-m   15px/20px w400
 *
 * The card is `justify-content: space-between` in a column, which is what puts
 * the emoji hard against the top padding and the title/source block against the
 * bottom — the gap between them is whatever the 185px height leaves over, not a
 * fixed margin. Reproducing it with explicit margins looks right at one title
 * length and wrong at every other.
 *
 * The 291px card width is *derived*, not fixed — see `.nb-card-grid`.
 */
export interface AllNotebooksPageProps {
  onOpenNotebook: (notebookId: string) => void;
  onCreateNotebook: () => void;
}

const NotebookCard: React.FC<{
  notebook: Notebook;
  index: number;
  onOpen: () => void;
}> = ({ notebook, index, onOpen }) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { deleteNotebookWithFolder } = useNotebookDisk();

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      className="nb-card nb-card-enter outline-none focus-visible:ring-2 focus-visible:ring-[#a8c7fa]"
      style={{ ['--nb-i' as string]: index }}
    >
      <div className="flex items-start justify-between">
        <span className="nb-card-emoji" aria-hidden="true">
          {notebook.emoji}
        </span>

        <div className={`flex items-center gap-1 ${isMenuOpen ? 'nb-card-menu is-forced' : 'nb-card-menu'}`}>
          {/*
           * Unlike the sidebar row, the card DOES show a pin — Gemini renders its
           * card menu with `always-show-menu-icon` and a live pin button, and the
           * pin stays visible while pinned even when the card is not hovered.
           */}
          <button
            type="button"
            aria-label={notebook.pinned ? `Unpin ${notebook.title}` : `Pin ${notebook.title}`}
            aria-pressed={notebook.pinned}
            onClick={(event) => {
              event.stopPropagation();
              toggleNotebookPinned(notebook.id);
            }}
            className="relative flex h-6 w-6 items-center justify-center rounded-full text-[#e6e6e6] before:absolute before:inset-0 before:rounded-full before:bg-[rgb(196,199,197)] before:opacity-0 before:content-[''] hover:before:opacity-[0.08]"
          >
            <MaterialSymbol
              name="push_pin"
              family="luminous"
              size={16}
              weight={330}
              roundness={100}
              opticalSize={16}
              fill={notebook.pinned}
              className="relative"
            />
          </button>

          <button
            type="button"
            aria-label={`More options for ${notebook.title}`}
            onClick={(event) => {
              event.stopPropagation();
              setIsMenuOpen((open) => !open);
            }}
            className="relative flex h-6 w-6 items-center justify-center rounded-full text-[#e6e6e6] before:absolute before:inset-0 before:rounded-full before:bg-[rgb(196,199,197)] before:opacity-0 before:content-[''] hover:before:opacity-[0.08]"
          >
            <MaterialSymbol
              name="more_vert"
              family="luminous"
              size={20}
              weight={320}
              roundness={100}
              opticalSize={20}
              className="relative"
            />
          </button>

          {isMenuOpen && (
            <div
              role="menu"
              onClick={(event) => event.stopPropagation()}
              className="absolute right-6 top-14 z-20 min-w-[180px] overflow-hidden rounded-2xl bg-[#282a2c] py-2 shadow-[0_2px_6px_2px_rgba(0,0,0,0.15)]"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  toggleNotebookPinned(notebook.id);
                  setIsMenuOpen(false);
                }}
                className="flex w-full items-center gap-3 px-4 py-2 text-left text-[14px] leading-5 text-[#e3e3e3] hover:bg-white/[0.08]"
              >
                <MaterialSymbol name="push_pin" family="luminous" size={18} roundness={100} opticalSize={18} />
                {notebook.pinned ? 'Unpin' : 'Pin'}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  // The card disappears on the click; the folder removal and the
                  // unfiling of this notebook's chats run on behind it. Not awaited
                  // for the same reason the notebook page's dialog does not — see
                  // `useNotebookDisk`.
                  void deleteNotebookWithFolder(notebook.id);
                  setIsMenuOpen(false);
                }}
                className="flex w-full items-center gap-3 px-4 py-2 text-left text-[14px] leading-5 text-[#e3e3e3] hover:bg-white/[0.08]"
              >
                <MaterialSymbol name="delete" family="luminous" size={18} roundness={100} opticalSize={18} />
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col">
        <span className="nb-card-title line-clamp-1">{notebook.title}</span>
        <span className="nb-card-sources">{formatSourceCount(notebook.sources.length)}</span>
      </div>
    </div>
  );
};

export const AllNotebooksPage: React.FC<AllNotebooksPageProps> = ({ onOpenNotebook, onCreateNotebook }) => {
  const notebooks = useStore(notebooksStore);
  const isHydrated = useStore(notebooksHydratedStore);

  useEffect(() => {
    hydrateNotebooks();
    return subscribeToNotebookWrites();
  }, []);

  /*
   * Wait for the first read before choosing a surface. Without this the splash
   * paints for a frame on every visit by an account that *does* have notebooks —
   * a first-run screen flashing at a returning user is worse than a blank frame.
   */
  if (!isHydrated) return <div className="h-full w-full" />;

  /*
   * Zero notebooks is a different SURFACE, not an empty grid.
   *
   * Verified on a fresh Gemini account: /notebooks/view renders
   * `project-splash-screen` and nothing else — no "Notebooks" heading and no
   * top-right New notebook button. So the whole page is replaced, header
   * included, rather than the grid keeping its chrome over an empty body.
   */
  if (notebooks.length === 0) {
    return <NotebooksSplashScreen onGetStarted={onCreateNotebook} />;
  }

  return (
    <div className="nb-spring nb-surface h-full w-full overflow-y-auto p-6">
      <div className="flex h-[60px] items-center justify-between">
        {/* gds-headline-m */}
        <h1 className="text-[24px] font-[400] leading-7 text-[#e3e3e3]">Notebooks</h1>
        <button
          type="button"
          onClick={onCreateNotebook}
          className="flex h-9 items-center gap-2 rounded-full bg-[#a8c7fa] px-4 text-[13px] font-[540] leading-[17px] text-[#062e6f] transition-opacity duration-200 hover:opacity-90"
        >
          <MaterialSymbol name="add_2" family="luminous" size={16} weight={330} roundness={100} opticalSize={16} />
          New notebook
        </button>
      </div>

      <div className="nb-card-grid mt-4">
        {notebooks.map((notebook, index) => (
          <NotebookCard
            key={notebook.id}
            notebook={notebook}
            index={index}
            onOpen={() => onOpenNotebook(notebook.id)}
          />
        ))}
      </div>
    </div>
  );
};
