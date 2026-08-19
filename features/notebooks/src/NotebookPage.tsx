import React, { useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { useLocalFS } from '@willow/storage/local-fs/LocalFSContext';
import { chatDisplayName, isTempChatId } from '@willow/storage/local-fs/chat-metadata';

import './notebooks.css';
import type { Notebook } from './notebook-types';
import { NotebookSourcesDialog } from './NotebookSourcesDialog';
import { SourceIcon } from './SourceIcon';
import { NotebookMenu, MENU_TRIGGER_ATTR, type AnchorRect, rectOf } from './NotebookMenu';
import { NotebookSnackbar, showNotebookSnack } from './NotebookSnackbar';
import { requestChatRename, requestChatDelete } from './chat-dialog-requests';
import { MoveChatDialog } from './MoveChatDialog';
import { DeleteNotebookDialog } from './DeleteNotebookDialog';
import { NotebookSettingsDialog } from './NotebookSettingsDialog';
import { RenameNotebookDialog } from './RenameNotebookDialog';
import {
  hydrateNotebooks,
  notebooksHydratedStore,
  notebooksStore,
  setNotebookEmoji,
  subscribeToNotebookWrites,
  toggleNotebookPinned,
} from './notebooks-store';
import { useNotebookDisk } from './useNotebookDisk';

/**
 * The loading state for Past chats — recorded off Gemini, not invented.
 *
 * Its `.skeleton-loader-row` is 42px tall and holds a 283x18 radius-12 bar plus a
 * 40x18 pill, both `rgba(196,199,197,0.08)`, pulsing on a 1500ms linear loop whose
 * midpoint is at **33%** (see `nb-skeleton-pulse`). Three rows is what fits the
 * space a short list occupies, so the swap to real rows does not jump.
 */
const PastChatsSkeleton: React.FC = () => (
  <div aria-hidden="true">
    {[0, 1, 2].map((i) => (
      <div key={i} className="nb-skeleton-row">
        <span className="nb-skeleton-bar" />
        <span className="nb-skeleton-pill" />
      </div>
    ))}
  </div>
);

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
 * The fill differs between the two states as well, `rgb(31,31,31)` against
 * `rgb(23,23,23)`; `notebooks.css` records both measurements.
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
  /**
   * Called after a past chat is selected, so the shell can switch to the chat
   * surface. The selection itself happens here — see the note on `useLocalFS`.
   */
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

/**
 * The date beside a past chat, in Gemini's four cases.
 *
 *   today            "Today"
 *   yesterday        "Yesterday"
 *   earlier, same yr "Aug 16"
 *   a previous year  "Aug 16, 2025"
 *
 * Compared by calendar day, not by elapsed hours: a chat from 23:50 last night is
 * "Yesterday" even though it is well under 24h old, and one from 00:10 today is
 * "Today" even at 00:15. Subtracting timestamps gets both of those wrong.
 *
 * The year test is also calendar-based, so 31 Dec reads "Dec 31" and becomes
 * "Dec 31, <year>" the moment the year rolls over.
 */
const formatChatDate = (at: number): string | undefined => {
  if (!at) return undefined;
  const then = new Date(at);
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);
  if (dayDiff === 0) return 'Today';
  if (dayDiff === 1) return 'Yesterday';
  const sameYear = then.getFullYear() === now.getFullYear();
  return then.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
};

/**
 * The `more_vert` both three-dot triggers use.
 *
 * Real-hover measured on Gemini, and the same on the notebook header and the chat
 * row: `lm-icon-xl` at **28px**, axes `"FILL" 0, "GRAD" 0, "ROND" 100, "opsz" 28,
 * "wght" 260`, ink `rgb(196,199,197)`. Notably NOT the 20px/320 the menu's own item
 * glyphs use — the trigger is a size up and a weight lighter.
 */
const MoreVertGlyph: React.FC = () => (
  <MaterialSymbol
    name="more_vert"
    family="luminous"
    size={28}
    weight={260}
    roundness={100}
    opticalSize={28}
  />
);

export const NotebookPage: React.FC<NotebookPageProps> = ({
  notebookId,
  renderComposer,
  onOpenChat,
  onMissing,
}) => {
  /*
   * Read the chat list here rather than take it as a prop.
   *
   * `App` renders `LocalFSProvider`, so it sits *above* the context and cannot
   * consume it; this component is inside it. The notebook owns the ORDER (newest
   * first, maintained by `addChatToNotebook`) and LocalFS owns the metadata, so the
   * two are joined below rather than either duplicating the other.
   */
  const { localChats, getChatTimestamp, selectLocalFSInboxChat } = useLocalFS();
  const { renameNotebookWithFolder, fileChat, deleteNotebookWithFolder } = useNotebookDisk();
  const notebooks = useStore(notebooksStore);
  const isHydrated = useStore(notebooksHydratedStore);
  const notebook = notebooks.find((candidate) => candidate.id === notebookId);

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [isPickingEmoji, setIsPickingEmoji] = useState(false);
  const [isSourcesOpen, setIsSourcesOpen] = useState(false);
  /*
   * Both three-dot menus keep the TRIGGER'S RECT, not just an id.
   *
   * Gemini positions the panel against the button — right edges flush, top 4px below
   * its bottom — and the panel is portalled to <body>, so it has no positioned
   * ancestor to lay itself out against. Capturing the rect at click time is what
   * lets it land in the same place.
   */
  const [openRowMenu, setOpenRowMenu] = useState<{ chatId: string; anchor: AnchorRect } | null>(null);
  const [isHeaderMenuOpen, setIsHeaderMenuOpen] = useState<AnchorRect | null>(null);
  const [movingChatId, setMovingChatId] = useState<string | null>(null);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);

  const toggleRowMenu = (chatId: string, trigger: HTMLElement) => {
    // Measured here, not inside the updater — see the note on the header trigger.
    const anchor = rectOf(trigger);
    setIsHeaderMenuOpen(null);
    setOpenRowMenu((open) => (open?.chatId === chatId ? null : { chatId, anchor }));
  };

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
    if (draftTitle.trim() && draftTitle !== notebook.title) renameNotebookWithFolder(notebook.id, draftTitle);
  };

  const sourceCount = notebook.sources.length;
  /*
   * The last THREE sources, and both halves of that are measured. A Gemini notebook
   * holding four sources labels its chip "4 Sources" and draws exactly three discs, and
   * the three it draws are its 2nd, 3rd and 4th — favicon, favicon, `text/plain` against
   * a source list of file, wikipedia, ai.google.dev, copied text. So the count is capped
   * at three and it is the tail that survives, in list order.
   */
  const chipSources = notebook.sources.slice(-3);
  /*
   * Join the notebook's ids against the chat list.
   *
   * The filter drops ids that are no longer in `localChats`, so a chat deleted from
   * Recents does not leave a dead row. It is skipped entirely when `localChats` is
   * EMPTY, which is not the same as "every chat was deleted": with no local folder
   * connected the chat index simply is not available (see `isLocalFolderConnected`),
   * and filtering against it would erase every row of a notebook the user really did
   * chat in. An unavailable index must not look like a deletion.
   *
   * A named chat's id *is* its title in Willow — `rebindChatTurnChatId` renames the
   * id once a title is generated — which is why the id doubles as the label, exactly
   * as the sidebar's Recents rows use it. `chatDisplayName` drops the de-duplicating
   * " (2)" the id may carry; `chat.id` below stays raw, because that is what every
   * action addresses the chat by.
   */
  const known = new Set(localChats);
  const chats = notebook.chatIds
    .filter((chatId) => known.size === 0 || known.has(chatId))
    .map((chatId) => {
      const at = getChatTimestamp(chatId);
      return {
        id: chatId,
        /*
         * An unnamed chat still has its temp id, and a raw
         * `2026-08-16T08-40-23_b74vqr` is not a title. The sidebar renders these
         * as "Untitled" (see `displayName` in `Sidebar.tsx`); match it rather than
         * inventing a second convention. Naming needs a connected folder, so this
         * is the normal state on a browser-only workspace.
         */
        title: isTempChatId(chatId) ? 'Untitled' : chatDisplayName(chatId),
        // "Today" / "Yesterday" / "Aug 16" / "Aug 16, 2025" — see formatChatDate.
        subtitle: formatChatDate(at),
      };
    });

  return (
    /*
     * `gemini-chat-scrollbar` is the app-wide overlay scrollbar — transparent
     * until the pointer is over it, 12px track, rounded thumb — declared in
     * `apps/studio/index.html` and used by the chat surface and the sidebar. This
     * scroller carried no scrollbar styling at all, so it fell back to Chrome's
     * default, which is the one that looked foreign.
     *
     * The host stays `overflow-y: auto`, so a page that fits shows no scrollbar
     * at all; the class only governs how one looks when there is something to
     * scroll.
     */
    <div className="nb-surface nb-page-host gemini-chat-scrollbar">
      {/*
       * The header three-dot. Gemini pins this in the top bar's `.right-section`
       * rather than in the notebook column, so it stays put as the column scrolls.
       */}
      <div className="nb-page-actions">
        <button
          type="button"
          aria-label="Notebook settings"
          aria-haspopup="menu"
          aria-expanded={isHeaderMenuOpen !== null}
          {...MENU_TRIGGER_ATTR}
          onClick={(event) => {
            /*
             * Measure EAGERLY, before the setter.
             *
             * A function passed to a state setter is an updater and React runs it at
             * render time, not here — so reading `event.currentTarget` inside it gets
             * `null` (React clears the property once the handler returns) and
             * `rectOf` throws during the render phase, blanking the whole tree.
             */
            const anchor = rectOf(event.currentTarget);
            setOpenRowMenu(null);
            setIsHeaderMenuOpen((open) => (open ? null : anchor));
          }}
          className="nb-icon-button"
        >
          {/*
            * 24px at weight 300, matching the chat surface's three-dot rather than
            * the 28px/260 the past-chat rows use. Same corner of the same app, so
            * the two triggers are now one look.
            */}
          <MaterialSymbol
            name="more_vert"
            family="luminous"
            size={24}
            weight={300}
            roundness={100}
            opticalSize={24}
          />
        </button>
      </div>

      {isHeaderMenuOpen && (
        <NotebookMenu
          anchor={isHeaderMenuOpen}
          onClose={() => setIsHeaderMenuOpen(null)}
          /*
           * Order, glyphs and labels as recorded from Gemini's notebook menu
           * (199.1x160). The second item's label tracks the pinned state — it read
           * "Unpin" in the recording because that notebook was pinned.
           */
          items={[
            {
              label: 'Notebook settings',
              icon: 'article',
              onSelect: () => setIsSettingsOpen(true),
            },
            {
              label: notebook.pinned ? 'Unpin' : 'Pin',
              icon: 'push_pin',
              onSelect: () => toggleNotebookPinned(notebook.id),
            },
            {
              label: 'Rename',
              icon: 'edit',
              onSelect: () => setIsRenaming(true),
            },
            {
              // The only tinted item in either menu — Gemini's `.project-delete-button`.
              label: 'Delete',
              icon: 'delete',
              danger: true,
              onSelect: () => setIsConfirmingDelete(true),
            },
          ]}
        />
      )}

      <div className="nb-page-column">
        {/*
         * The composer is the ANCHOR, and the header stacks upward off it.
         *
         * Gemini's composer sits at the same y whether the notebook title is one
         * line or two (measured 380.8 in both cases), so its position is not derived
         * from the header's height — the header grows upward instead. Reproducing
         * that means positioning the header out of flow above this wrapper, so no
         * sum of child heights can drift the composer.
         */}
        <div className="nb-page-anchor">
        <div className="nb-page-header">
        {/*
         * ── emoji ─────────────────────────────────────────────────────────
         *
         * DISPLAY ONLY. The emoji and the title are both read-only here; the single
         * way to change either is the three-dot menu's Rename, which raises the
         * measured 512x236 dialog with the emoji picker inside it. An earlier version
         * let you click the glyph for a 12-emoji popover and click the heading to edit
         * it inline — two extra ways to rename a notebook that Gemini does not have,
         * and which quietly bypassed the real dialog.
         */}
        <div className="nb-page-emoji" aria-hidden="true">{notebook.emoji}</div>

        {/* ── title + sources chip ────────────────────────────────────────── */}
        <div className="nb-page-title-row">
          <h1 className="nb-page-title min-w-0 flex-1">{notebook.title}</h1>

          <button
            type="button"
            onClick={() => setIsSourcesOpen(true)}
            className={`nb-source-chip${sourceCount === 0 ? ' nb-no-icons' : ''}`}
          >
            {/*
             * Gemini nests each type icon in a 20px `rgb(31,31,31)` disc — a pill inside
             * the pill, and visible because the chip itself is the darker `rgb(23,23,23)`.
             * The image inside it is 15px, centred (measured 1121.1 in a container at
             * 1118.6, so (20-15)/2).
             *
             * Several sources STACK, each newer disc over the one before it. Gemini emits
             * `z-index: 0` on every disc regardless of count, so DOM order alone decides
             * and the LAST disc paints on top; `notebooks.css` puts that 0 on the class.
             * An earlier read of a one-source chip made this look like a descending
             * z-index, which would have stacked them the other way round.
             */}
            {sourceCount > 0 && (
              /*
               * The discs need a container of their own, gapless: the chip's own 4px gap
               * separates the icon GROUP from the label in Gemini, and letting it fall
               * between the discs instead would cancel the -4px overlap exactly.
               */
              <span className="nb-source-chip-icons">
                {chipSources.map((source) => (
                  <span key={source.id} className="nb-source-chip-icon">
                    <SourceIcon source={source} size={15} />
                  </span>
                ))}
              </span>
            )}
            {/* Capital "S" is Gemini's, and differs from the card grid's lowercase. */}
            {sourceCount === 0 ? 'Add sources' : `${sourceCount} ${sourceCount === 1 ? 'Source' : 'Sources'}`}
          </button>
        </div>

        </div>{/* .nb-page-header */}

        {/* ── composer, in the zero-state position ────────────────────────── */}
        {renderComposer && <div className="nb-page-composer">{renderComposer(notebook)}</div>}
        </div>{/* .nb-page-anchor */}

        {/* ── past chats ─────────────────────────────────────────────────── */}
        <h2 className="nb-section-title nb-page-section">Past chats</h2>
        {!isHydrated ? (
          <PastChatsSkeleton />
        ) : chats.length === 0 ? (
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
              <div key={chat.id} className="relative">
                <button
                  type="button"
                  onClick={() => {
                    void selectLocalFSInboxChat(chat.id);
                    onOpenChat?.(chat.id);
                  }}
                  className="nb-chat-row w-full"
                >
                  {/* No leading icon — the row's only glyph is this hover menu. */}
                  <span className="nb-chat-row-title">{chat.title}</span>
                  {chat.subtitle && <span className="nb-chat-row-sub">{chat.subtitle}</span>}
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`More options for ${chat.title}`}
                    aria-haspopup="menu"
                    aria-expanded={openRowMenu?.chatId === chat.id}
                    {...MENU_TRIGGER_ATTR}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleRowMenu(chat.id, event.currentTarget);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        event.stopPropagation();
                        toggleRowMenu(chat.id, event.currentTarget);
                      }
                    }}
                    className={`nb-chat-row-menu ${openRowMenu?.chatId === chat.id ? 'is-open' : ''}`}
                  >
                    <MoreVertGlyph />
                  </span>
                </button>

                {openRowMenu?.chatId === chat.id && (
                  <NotebookMenu
                    anchor={openRowMenu.anchor}
                    onClose={() => setOpenRowMenu(null)}
                    /*
                     * Order, glyphs and labels exactly as recorded from Gemini's
                     * chat-row menu (230.3x160):
                     *   notebook  Move to notebook
                     *   undo      Remove from notebook
                     *   edit      Rename
                     *   delete    Delete       <- NOT tinted here, unlike the
                     *                            notebook menu's Delete
                     */
                    items={[
                      {
                        label: 'Move to notebook',
                        icon: 'notebook',
                        onSelect: () => setMovingChatId(chat.id),
                      },
                      {
                        /*
                         * Unfiles the chat, leaving it in Recents — a notebook is a
                         * grouping, so this must not delete data. Gemini confirms it
                         * with a snackbar, hence the toast rather than silence.
                         *
                         * `fileChat(id, null)` and not `removeChatFromNotebook`: the
                         * chat's file has to come back out of this notebook's `Chats/`
                         * folder, or the reconciler reads the file's location as the
                         * truth on the next poll and re-files it.
                         */
                        label: 'Remove from notebook',
                        icon: 'undo',
                        onSelect: () => {
                          void fileChat(chat.id, null);
                          showNotebookSnack(`Deleted from ${notebook.title}`);
                        },
                      },
                      // Both of these raise the shell's existing chat dialogs.
                      { label: 'Rename', icon: 'edit', onSelect: () => requestChatRename(chat.id) },
                      { label: 'Delete', icon: 'delete', onSelect: () => requestChatDelete(chat.id) },
                    ]}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        <div className="h-16 shrink-0" />
      </div>

      {isSourcesOpen && <NotebookSourcesDialog notebook={notebook} onClose={() => setIsSourcesOpen(false)} />}

      {movingChatId && (
        <MoveChatDialog
          chatId={movingChatId}
          onClose={() => setMovingChatId(null)}
        />
      )}

      {isConfirmingDelete && (
        <DeleteNotebookDialog
          notebook={notebook}
          onClose={() => setIsConfirmingDelete(false)}
          onDeleted={() => {
            /*
             * Not awaited: the dialog dismisses on the click and the route is handed
             * back immediately, as it did when this was a single localStorage write.
             * The unfile-then-remove-folder sequence inside runs on after that, and
             * every step of it degrades to "an orphan folder on disk", never to a
             * lost conversation — see `useNotebookDisk`.
             */
            void deleteNotebookWithFolder(notebook.id);
            setIsConfirmingDelete(false);
            // The id no longer resolves, so hand the route back to the shell.
            onMissing?.();
          }}
        />
      )}

      {isSettingsOpen && (
        <NotebookSettingsDialog notebook={notebook} onClose={() => setIsSettingsOpen(false)} />
      )}

      {isRenaming && (
        <RenameNotebookDialog notebook={notebook} onClose={() => setIsRenaming(false)} />
      )}

      <NotebookSnackbar />
    </div>
  );
};
