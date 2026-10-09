import React, { useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { useAuth } from '@willow/auth/AuthContext';
import { useCompactViewport } from '@willow/chat/use-compact-viewport';
import { getWorkspaceTheme } from '@willow/core/workspace-theme';

import './notebooks.css';
import { NotebookActionsMenu, type NotebookActionsTarget } from './NotebookActionsMenu';
import { MENU_TRIGGER_ATTR, rectOf, type AnchorRect } from './NotebookMenu';
import { NotebooksSplashScreen } from './NotebooksSplashScreen';
import { formatSourceCount } from './notebook-types';
import type { Notebook } from './notebook-types';
import { useThemeMode } from '@willow/core/theme-mode';
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
  /** Below 961px the card's menu is the page's `NotebookActionsMenu`, opened from here. */
  isCompactMenuOpen: boolean;
  onOpenCompactMenu: (anchor: AnchorRect) => void;
}> = ({ notebook, index, onOpen, isCompactMenuOpen, onOpenCompactMenu }) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { deleteNotebookWithFolder } = useNotebookDisk();
  const { isLight } = useThemeMode();
  const isCompact = useCompactViewport();

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
      className={`nb-card nb-card-enter outline-none focus-visible:ring-2 ${isLight ? 'focus-visible:ring-[color:var(--sync-0b57d0,#0b57d0)]' : 'focus-visible:ring-[color:var(--sync-a8c7fa,#a8c7fa)]'}${isCompact && isCompactMenuOpen ? ' is-menu-open' : ''}`}
      style={{ ['--nb-i' as string]: index }}
    >
      <div className="nb-card-header flex items-start justify-between">
        <span className="nb-card-emoji" aria-hidden="true">
          {notebook.emoji}
        </span>

        {isCompact ? (
          /*
           * Gemini's touch layout keeps ONE 36px trigger in a 24px slot: the pin while
           * pinned (labelled "Pinned"), the ⋮ otherwise and whenever the card is hovered
           * or its menu is open. Both open the same menu; none of them toggle the pin.
           */
          <div className="nb-card-trigger-slot">
            <button
              type="button"
              {...MENU_TRIGGER_ATTR}
              aria-label={notebook.pinned ? 'Pinned' : 'Open notebook actions menu'}
              aria-haspopup="menu"
              aria-expanded={isCompactMenuOpen}
              onClick={(event) => {
                event.stopPropagation();
                onOpenCompactMenu(rectOf(event.currentTarget));
              }}
              className={`nb-card-trigger${notebook.pinned ? ' is-pinned' : ''}`}
            >
              <MaterialSymbol
                name="push_pin"
                family="luminous"
                size={24}
                weight={300}
                roundness={100}
                opticalSize={24}
                className="nb-card-trigger-pin"
              />
              <MaterialSymbol
                name="more_vert"
                family="luminous"
                size={28}
                weight={260}
                roundness={100}
                opticalSize={28}
                className="nb-card-trigger-more"
              />
            </button>
          </div>
        ) : (
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
            className={`relative flex h-6 w-6 items-center justify-center rounded-full ${isLight ? 'text-[#444746]' : 'text-[#e6e6e6]'} before:absolute before:inset-0 before:rounded-full ${isLight ? 'before:bg-black/10' : 'before:bg-[rgb(196,199,197)]'} before:opacity-0 before:content-[''] hover:before:opacity-100`}
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
            className={`relative flex h-6 w-6 items-center justify-center rounded-full ${isLight ? 'text-[#444746]' : 'text-[#e6e6e6]'} before:absolute before:inset-0 before:rounded-full ${isLight ? 'before:bg-black/10' : 'before:bg-[rgb(196,199,197)]'} before:opacity-0 before:content-[''] hover:before:opacity-100`}
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
              className={`absolute right-6 top-14 z-20 min-w-[180px] overflow-hidden rounded-2xl py-2 ${
                isLight
                  ? 'bg-white text-[#1f1f1f] border border-black/10 shadow-[0_4px_20px_rgba(0,0,0,0.12)]'
                  : 'bg-[#282a2c] text-[#e3e3e3] shadow-[0_2px_6px_2px_rgba(0,0,0,0.15)]'
              }`}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  toggleNotebookPinned(notebook.id);
                  setIsMenuOpen(false);
                }}
                className={`flex w-full items-center gap-3 px-4 py-2 text-left text-[14px] leading-5 ${
                  isLight ? 'text-[#1f1f1f] hover:bg-black/5' : 'text-[#e3e3e3] hover:bg-white/[0.08]'
                }`}
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
                className={`flex w-full items-center gap-3 px-4 py-2 text-left text-[14px] leading-5 ${
                  isLight ? 'text-[#1f1f1f] hover:bg-black/5' : 'text-[#e3e3e3] hover:bg-white/[0.08]'
                }`}
              >
                <MaterialSymbol name="delete" family="luminous" size={18} roundness={100} opticalSize={18} />
                Delete
              </button>
            </div>
          )}
        </div>
        )}
      </div>

      <div className="nb-card-body flex flex-col">
        <span className="nb-card-title line-clamp-1">{notebook.title}</span>
        <span className="nb-card-sources">{formatSourceCount(notebook.sources.length)}</span>
      </div>
    </div>
  );
};

export const AllNotebooksPage: React.FC<AllNotebooksPageProps> = ({ onOpenNotebook, onCreateNotebook }) => {
  const notebooks = useStore(notebooksStore);
  const isHydrated = useStore(notebooksHydratedStore);
  const { isLight } = useThemeMode();
  const { workspaceColor } = useAuth();
  const theme = getWorkspaceTheme(workspaceColor);
  const [compactMenu, setCompactMenu] = useState<NotebookActionsTarget | null>(null);

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
    <div
      className="nb-spring nb-surface nb-grid-page h-full w-full overflow-y-auto p-6"
      style={{
        '--nb-grid-create-bg': theme.accentButton.bg,
        '--nb-grid-create-hover': theme.accentButton.hover,
      } as React.CSSProperties}
    >
      <div className="nb-grid-header flex h-[60px] items-center justify-between">
        {/* gds-headline-m */}
        <h1 className={`nb-grid-title text-[24px] font-[400] leading-7 ${isLight ? 'text-[#1f1f1f]' : 'text-[#e3e3e3]'}`}>Notebooks</h1>
        <button
          type="button"
          onClick={onCreateNotebook}
          className={`nb-grid-create flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-[540] leading-[17px] transition-all duration-200 ${
            isLight
              ? 'bg-[color:var(--sync-0b57d0,#0b57d0)] text-white hover:bg-[color:var(--sync-0842a0,#0842a0)]'
              : 'bg-[color:var(--sync-a8c7fa,#a8c7fa)] text-[color:var(--sync-062e6f,#062e6f)] hover:opacity-90'
          }`}
        >
          <MaterialSymbol name="add_2" family="luminous" size={16} weight={330} roundness={100} opticalSize={16} />
          <span className="nb-grid-create-label">New notebook</span>
        </button>
      </div>

      <div className="nb-card-grid mt-4">
        {notebooks.map((notebook, index) => (
          <NotebookCard
            key={notebook.id}
            notebook={notebook}
            index={index}
            onOpen={() => onOpenNotebook(notebook.id)}
            isCompactMenuOpen={compactMenu?.notebookId === notebook.id}
            onOpenCompactMenu={(anchor) => setCompactMenu((open) => (
              open?.notebookId === notebook.id ? null : { notebookId: notebook.id, anchor }
            ))}
          />
        ))}
      </div>

      <NotebookActionsMenu target={compactMenu} onClose={() => setCompactMenu(null)} />
    </div>
  );
};
