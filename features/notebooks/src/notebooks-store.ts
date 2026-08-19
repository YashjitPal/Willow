/**
 * The notebooks store.
 *
 * `nanostores` to match `features/gems/src/gems-store.ts`, the closest existing
 * feature store. The atom is the single source of truth for every notebook
 * surface; `notebooks-backend.ts` is only persistence behind it.
 *
 * Writes are "update the atom, then persist" rather than "persist, then re-read".
 * The re-read shape would make every mutation wait on a synchronous localStorage
 * round trip inside a click handler, and the create flow animates immediately off
 * the new notebook — so the atom has to already hold it when the navigation runs.
 */
import { atom } from 'nanostores';

import type { Notebook, NotebookSource, NotebookVertical } from './notebook-types';
import { DEFAULT_NOTEBOOK_EMOJI, UNTITLED_NOTEBOOK_TITLE } from './notebook-types';
import {
  NOTEBOOKS_UPDATED_EVENT,
  makeNotebookId,
  readNotebooks,
  setNotebookSourceFsName as recordNotebookSourceFsName,
  sortNotebooks,
  writeNotebooks,
} from './notebooks-backend';

export const notebooksStore = atom<Notebook[]>([]);

/**
 * True once the first hydrate has run.
 *
 * The sidebar section needs this to tell "no notebooks yet" from "not read yet":
 * rendering the section header over an empty list during the first tick is the
 * same bug the Recents header had — a heading is a promise that there is a
 * section, so the header waits on this too.
 */
export const notebooksHydratedStore = atom(false);

/** Read the registry into the atom. Safe to call repeatedly. */
export const hydrateNotebooks = (): void => {
  notebooksStore.set(sortNotebooks(readNotebooks()));
  notebooksHydratedStore.set(true);
};

const commit = (next: Notebook[]): Notebook[] => {
  const sorted = sortNotebooks(next);
  notebooksStore.set(sorted);
  writeNotebooks(sorted);
  return sorted;
};

/**
 * Subscribe the store to writes made anywhere else — another tab via `storage`,
 * or another surface in this tab via the custom event. Returns an unsubscribe.
 *
 * The custom event is dispatched by `writeNotebooks`, i.e. by our own commits
 * too, so the handler re-reads and re-sorts rather than assuming it is stale.
 * That is cheap and keeps a single code path for "something changed".
 */
export const subscribeToNotebookWrites = (): (() => void) => {
  if (typeof window === 'undefined') return () => {};
  const onChange = () => hydrateNotebooks();
  window.addEventListener(NOTEBOOKS_UPDATED_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(NOTEBOOKS_UPDATED_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
};

export const getNotebook = (id: string): Notebook | undefined =>
  notebooksStore.get().find((notebook) => notebook.id === id);

export interface CreateNotebookInput {
  title?: string;
  emoji?: string;
  vertical?: NotebookVertical;
}

/**
 * Create a notebook and return it.
 *
 * An empty or whitespace-only title becomes "Untitled notebook", which is what
 * Gemini does — its list holds two of them — rather than rejecting the submit.
 */
export const createNotebook = ({ title, emoji, vertical }: CreateNotebookInput = {}): Notebook => {
  const now = Date.now();
  const notebook: Notebook = {
    id: makeNotebookId(),
    title: (title ?? '').trim() || UNTITLED_NOTEBOOK_TITLE,
    emoji: emoji || DEFAULT_NOTEBOOK_EMOJI,
    vertical: vertical ?? 'organize',
    chatIds: [],
    sources: [],
    pinned: false,
    createdAt: now,
    updatedAt: now,
  };
  commit([...notebooksStore.get(), notebook]);
  return notebook;
};

/**
 * Patch a notebook.
 *
 * `updatedAt` is bumped for content edits but deliberately **not** for `pinned`:
 * pinning is a view preference, and letting it rewrite the timestamp would
 * silently reorder the unpinned list the moment a notebook was unpinned again.
 */
export const updateNotebook = (
  id: string,
  patch: Partial<Omit<Notebook, 'id' | 'createdAt'>>,
): void => {
  const touchesContent = Object.keys(patch).some((key) => key !== 'pinned' && key !== 'updatedAt');
  commit(
    notebooksStore.get().map((notebook) =>
      notebook.id === id
        ? { ...notebook, ...patch, updatedAt: touchesContent ? Date.now() : notebook.updatedAt }
        : notebook,
    ),
  );
};

export const renameNotebook = (id: string, title: string): void => {
  updateNotebook(id, { title: title.trim() || UNTITLED_NOTEBOOK_TITLE });
};

export const setNotebookEmoji = (id: string, emoji: string): void => {
  updateNotebook(id, { emoji: emoji || DEFAULT_NOTEBOOK_EMOJI });
};

export const toggleNotebookPinned = (id: string): void => {
  const notebook = getNotebook(id);
  if (!notebook) return;
  updateNotebook(id, { pinned: !notebook.pinned });
};

export const deleteNotebook = (id: string): void => {
  commit(notebooksStore.get().filter((notebook) => notebook.id !== id));
};

/**
 * Attach a chat to a notebook, newest first, without duplicating it.
 *
 * Called when a chat is started from a notebook page. The notebook owns the
 * ordering so its "Past chats" list does not have to re-sort against the global
 * chat timestamps, which are scoped separately.
 */
export const addChatToNotebook = (notebookId: string, chatId: string): void => {
  const notebook = getNotebook(notebookId);
  if (!notebook) return;
  const chatIds = [chatId, ...notebook.chatIds.filter((id) => id !== chatId)];
  updateNotebook(notebookId, { chatIds });
};

export const removeChatFromNotebook = (notebookId: string, chatId: string): void => {
  const notebook = getNotebook(notebookId);
  if (!notebook) return;
  updateNotebook(notebookId, { chatIds: notebook.chatIds.filter((id) => id !== chatId) });
};

/** The notebook a chat belongs to, or undefined. Chats live in at most one. */
export const findNotebookForChat = (chatId: string): Notebook | undefined =>
  notebooksStore.get().find((notebook) => notebook.chatIds.includes(chatId));

/*
 * There is deliberately no `moveChatBetweenNotebooks` here any more.
 *
 * Filing a chat has a disk half — the chat's own file moves between the global
 * `Chats/` folder and `Notebooks/<name>/Chats/` — and a registry-only refile
 * would be undone on the next poll, when the reconciler adopts the location the
 * file is actually in. `useNotebookDisk`'s `fileChat` is the one entry point that
 * does both halves, and it owns the remove-before-add ordering this pair needs:
 * `findNotebookForChat` assumes at most one owner, so a chat must never be
 * briefly in two, and an interrupted refile must leave it unfiled (recoverable)
 * rather than duplicated.
 */

export const addNotebookSource = (
  notebookId: string,
  source: Omit<NotebookSource, 'id' | 'createdAt'>,
): NotebookSource | undefined => {
  const notebook = getNotebook(notebookId);
  if (!notebook) return undefined;
  const created: NotebookSource = { ...source, id: makeNotebookId(), createdAt: Date.now() };
  updateNotebook(notebookId, { sources: [...notebook.sources, created] });
  return created;
};

export const removeNotebookSource = (notebookId: string, sourceId: string): void => {
  const notebook = getNotebook(notebookId);
  if (!notebook) return;
  updateNotebook(notebookId, { sources: notebook.sources.filter((s) => s.id !== sourceId) });
};

/**
 * Record the file name a source got inside the notebook's `Sources/` folder.
 *
 * The one mutation whose implementation is **not** here: the disk backfill runs
 * inside `LocalFSContext`, which may only import the backend, and two
 * implementations of "patch one source's fsName" would eventually disagree about
 * whether to bump `updatedAt` (it must not — see the backend's own note).
 *
 * The re-hydrate is belt and braces: `writeNotebooks` fires
 * `NOTEBOOKS_UPDATED_EVENT` synchronously and every mounted surface re-reads off
 * that, but a caller with no subscriber mounted still gets a current atom.
 *
 * Returns whether anything changed, so a caller inside a poll can stay
 * change-only.
 */
export const setNotebookSourceFsName = (
  notebookId: string,
  sourceId: string,
  fsName: string,
): boolean => {
  const changed = recordNotebookSourceFsName(notebookId, sourceId, fsName);
  if (changed) hydrateNotebooks();
  return changed;
};
