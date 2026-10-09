import React, { useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { useCompactViewport } from '@willow/chat/use-compact-viewport';
import { useThemeMode } from '@willow/core/theme-mode';
import { SectionHeader, SidebarItem } from '@willow/studio/shell/sidebar/SidebarPrimitives';

import { NotebookActionsMenu, type NotebookActionsTarget } from './NotebookActionsMenu';
import { MENU_TRIGGER_ATTR, rectOf } from './NotebookMenu';
import { notebooksHydratedStore, notebooksStore } from './notebooks-store';
import { hydrateNotebooks, subscribeToNotebookWrites } from './notebooks-store';
import type { Notebook } from './notebook-types';

/**
 * The sidebar Notebooks section.
 *
 * Layout is not re-derived here: Gemini's notebook row and Willow's existing
 * `<SidebarItem>` already agree to the pixel. Measured on Gemini's
 * `a.gem-nav-list-item` — 32px tall, `border-radius: 9999px`, `padding: 0 8px`,
 * `gap: 8px`, a 24px leading icon slot — which puts the label at x=46 inside a
 * row starting at x=6. `<SidebarItem>` decomposes the same 46px differently
 * (6px wrapper + 6px inner padding + 28px icon box + 6px gap) and centres its
 * icon at x=26, which is exactly where Gemini's 28px `gem-icon` sits. So this
 * renders through the shared primitive instead of a private row, and inherits
 * the collapsed-rail tooltip and active-state treatment for free.
 *
 * Row order matches Gemini exactly: **New notebook** first, then the notebooks
 * themselves, then **All notebooks** last.
 *
 * Icons are Luminous ligatures at the measured axes (`wght 320`, `ROND 100`,
 * `opsz 20`): `add_2`, `notebook`, `more_horiz`, and `more_vert` for the row menu.
 *
 * One detail worth not "fixing": the sidebar row has **no pin icon at all**, even
 * for a pinned notebook. Gemini renders its row menu with `hide-pin-icon`, and
 * probing confirmed the `.project-item-pin-icon` element is absent rather than
 * merely hidden. Pinning still matters — it sorts the notebook to the top — but
 * the pin glyph itself only appears on the card in the grid. The exception is the
 * narrow drawer, where the always-visible touch trigger draws `push_pin` in place of
 * the three dots while the notebook is pinned.
 */
export interface NotebooksSectionProps {
  isCollapsed: boolean;
  /** The open notebook, so its row can render active. */
  activeNotebookId?: string | null;
  /** True when the "All notebooks" grid is the current view. */
  isAllNotebooksActive?: boolean;
  /** True when the "New notebook" create screen is the current view. */
  isCreateNotebookActive?: boolean;
  onOpenNotebook: (notebookId: string) => void;
  onCreateNotebook: () => void;
  onOpenAllNotebooks: () => void;
  /**
   * Opens the row's context menu. Wired to the shell's menu so notebooks get the
   * same surface Recents rows use rather than a second, near-identical popover.
   */
  onNotebookMenu?: (event: React.MouseEvent, notebook: Notebook) => void;
  /** Id whose menu is currently open — keeps that row's button visible. */
  openMenuNotebookId?: string | null;
}

/**
 * How many notebooks the sidebar lists before deferring to "All notebooks".
 *
 * Gemini's own section showed 2 of 16, and its height (160px = header + 4 rows)
 * is fixed by the surrounding rail layout rather than by the list. Rather than
 * hard-code 2, this caps at a number that keeps the section from crowding out
 * Recents below it while still showing a useful working set. Pinned notebooks
 * sort first (see `sortNotebooks`), so a pinned one is never pushed out.
 */
const SIDEBAR_NOTEBOOK_LIMIT = 4;

/** Below 961px the drawer lists Gemini's two, measured at 800x1280 and 390x844. */
const COMPACT_NOTEBOOK_LIMIT = 2;

export const NotebooksSection: React.FC<NotebooksSectionProps> = ({
  isCollapsed,
  activeNotebookId,
  isAllNotebooksActive,
  isCreateNotebookActive,
  onOpenNotebook,
  onCreateNotebook,
  onOpenAllNotebooks,
  onNotebookMenu,
  openMenuNotebookId,
}) => {
  const notebooks = useStore(notebooksStore);
  const isHydrated = useStore(notebooksHydratedStore);
  const [isExpanded, setIsExpanded] = useState(true);
  const isCompact = useCompactViewport();
  const { isLight } = useThemeMode();
  /*
   * The narrow drawer's own row menu. Gemini's touch drawer shows each notebook's
   * trigger all the time — its pin while pinned, three dots otherwise — and hangs
   * Pin / Rename / Delete from it. The shell's `onNotebookMenu`, when wired, wins.
   */
  const [rowMenu, setRowMenu] = useState<NotebookActionsTarget | null>(null);
  const hasCompactMenu = isCompact && !onNotebookMenu;

  // One hydrate on mount plus a subscription, so a write from the card grid or
  // the create screen reaches the sidebar without either knowing it exists.
  useEffect(() => {
    hydrateNotebooks();
    return subscribeToNotebookWrites();
  }, []);

  // The header is a promise that there is a section; don't paint it over an
  // unread list. Same reasoning as the Recents header's hydration gate.
  if (!isHydrated) return null;

  const visible = notebooks.slice(0, isCompact ? COMPACT_NOTEBOOK_LIMIT : SIDEBAR_NOTEBOOK_LIMIT);

  return (
    <>
      <SectionHeader
        title="Notebooks"
        isCollapsed={isCollapsed}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded((expanded) => !expanded)}
        controlsId="willow-notebooks-section"
      />
      <div
        id="willow-notebooks-section"
        className="grid min-h-0"
        style={{
          /*
           * `grid-template-rows: 1fr -> 0fr` is how the rest of Willow's sidebar
           * collapses, and it matches Gemini: its `.expandable-section-content`
           * computes to `display: grid`, which is what makes an auto-height
           * section animate at all. 200ms on Gemini's standard emphasis curve.
           */
          gridTemplateRows: isExpanded ? '1fr' : '0fr',
          transition: 'grid-template-rows 200ms cubic-bezier(0.2, 0, 0, 1)',
        }}
      >
        <div className="min-h-0 overflow-hidden">
          <SidebarItem
            flushRight
            symbol="add_2"
            label="New notebook"
            isCollapsed={isCollapsed}
            active={isCreateNotebookActive}
            onClick={onCreateNotebook}
          />

          {visible.map((notebook) => (
            <SidebarItem
              key={notebook.id}
              flushRight
              symbol="notebook"
              label={notebook.title}
              isCollapsed={isCollapsed}
              active={activeNotebookId === notebook.id}
              onClick={() => onOpenNotebook(notebook.id)}
              keepActionsVisible={openMenuNotebookId === notebook.id || rowMenu?.notebookId === notebook.id}
              actions={
                hasCompactMenu ? (
                  <button
                    type="button"
                    {...MENU_TRIGGER_ATTR}
                    onClick={(event) => {
                      event.stopPropagation();
                      const anchor = rectOf(event.currentTarget);
                      setRowMenu((open) => (open?.notebookId === notebook.id ? null : { notebookId: notebook.id, anchor }));
                    }}
                    aria-label={`More options for ${notebook.title}`}
                    aria-haspopup="menu"
                    aria-expanded={rowMenu?.notebookId === notebook.id}
                    className={`sidebar-row-menu-btn relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full p-0 ${
                      isLight ? 'text-[#1f1f1f]' : 'text-[#e0e0e0]'
                    } before:absolute before:inset-0 before:rounded-full before:bg-[rgb(196,199,197)] before:opacity-0 before:content-[''] hover:before:opacity-[0.08]`}
                  >
                    <MaterialSymbol
                      name={notebook.pinned ? 'push_pin' : 'more_vert'}
                      family="luminous"
                      size={20}
                      weight={320}
                      roundness={100}
                      opticalSize={20}
                      className="relative"
                    />
                  </button>
                ) : onNotebookMenu ? (
                  /*
                   * 24x24, transparent, fully round, revealed by `visibility`
                   * rather than opacity — Gemini keeps `opacity: 1` in both
                   * states, so there is no fade. The hover tint is a ::before at
                   * rgb(196,199,197)/0.08; the button's own background never
                   * changes. Identical treatment to <RecentChatRow>.
                   */
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onNotebookMenu(event, notebook);
                    }}
                    aria-label={`More options for ${notebook.title}`}
                    className={`sidebar-row-menu-btn relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full p-0 text-[#e6e6e6] before:absolute before:inset-0 before:rounded-full before:bg-[rgb(196,199,197)] before:opacity-0 before:content-[''] hover:before:opacity-[0.08] ${
                      openMenuNotebookId === notebook.id ? 'visible' : 'invisible group-hover/item:visible'
                    }`}
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
                ) : undefined
              }
            />
          ))}

          {/*
            * "All notebooks" appears only once there IS more than the create row
            * to see. Verified on a fresh Gemini account: its Notebooks section
            * holds exactly one row, "New notebook" -> /notebooks/create, and the
            * All-notebooks row is absent rather than disabled. It would otherwise
            * point at a grid that has nothing in it — which is also why
            * /notebooks/view swaps itself for the first-run splash at zero.
            */}
          {notebooks.length > 0 && (
            <SidebarItem
              flushRight
              symbol="more_horiz"
              label="All notebooks"
              isCollapsed={isCollapsed}
              active={isAllNotebooksActive}
              onClick={onOpenAllNotebooks}
            />
          )}
        </div>
      </div>
      {hasCompactMenu && (
        <NotebookActionsMenu
          target={rowMenu}
          onClose={() => setRowMenu(null)}
          align="start"
          menuClassName="nb-menu--drawer"
        />
      )}
    </>
  );
};
