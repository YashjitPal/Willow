/**
 * The disk half of a notebook mutation.
 *
 * A notebook exists in two places: the registry (scoped localStorage, and
 * authoritative — notebooks keep working with no folder connected) and its folder
 * under `Notebooks/`. Every mutation that has both halves goes through here, so no
 * surface has to remember that there are two.
 *
 * The registry write lands first and synchronously, always. That keeps the UI
 * instant, and it is what stops a mutation from being lost when there is no folder:
 * the disk call is a mirror, and every one of them returns a failure value instead
 * of throwing.
 *
 * Direction of dependency is the ordinary one for this package — a component-level
 * module reaching down to the store and out to `useLocalFS`. The storage layer
 * still only imports `notebooks-backend`.
 */
import { useCallback } from 'react';
import { useLocalFS } from '@willow/storage/local-fs/LocalFSContext';

import type { Notebook } from './notebook-types';
import type { CreateNotebookInput } from './notebooks-store';
import {
  addChatToNotebook,
  createNotebook,
  deleteNotebook,
  findNotebookForChat,
  getNotebook,
  removeChatFromNotebook,
  renameNotebook,
} from './notebooks-store';

export interface NotebookDiskActions {
  createNotebookWithFolder: (input?: CreateNotebookInput) => Notebook;
  renameNotebookWithFolder: (notebookId: string, title: string) => void;
  fileChat: (chatId: string, notebookId: string | null) => Promise<void>;
  deleteNotebookWithFolder: (notebookId: string) => Promise<void>;
}

export const useNotebookDisk = (): NotebookDiskActions => {
  const {
    ensureLocalFSNotebookDir,
    renameLocalFSNotebookFolder,
    deleteLocalFSNotebookFolder,
    moveLocalFSChatToNotebook,
  } = useLocalFS();

  /**
   * Create a notebook, and its folder with it.
   *
   * Returns the notebook synchronously — the create screen animates straight into
   * the new notebook, so it cannot wait on the disk — and creates the folder in the
   * background. Creating it eagerly rather than on the first source write is what
   * makes `Notebooks/<name>/{Sources,Chats}` show up when the user goes looking for
   * it, which is the point of the layout.
   */
  const createNotebookWithFolder = useCallback((input: CreateNotebookInput = {}): Notebook => {
    const notebook = createNotebook(input);
    void ensureLocalFSNotebookDir(notebook.id);
    return notebook;
  }, [ensureLocalFSNotebookDir]);

  /**
   * Rename a notebook and move its folder to match.
   *
   * The no-change check is repeated here even though both callers already make it:
   * a folder rename copies every chat file the notebook owns and then deletes the
   * originals, so a rename to the same title is a lot of I/O — and a window in
   * which the reconciler must be held off — for nothing.
   */
  const renameNotebookWithFolder = useCallback((notebookId: string, title: string): void => {
    const next = title.trim();
    if (!next || getNotebook(notebookId)?.title === next) return;
    renameNotebook(notebookId, next);
    // After the commit, never before: the new folder name is derived from the title
    // that was actually persisted.
    void renameLocalFSNotebookFolder(notebookId);
  }, [renameLocalFSNotebookFolder]);

  /**
   * File a chat into a notebook, or out of one with `null`.
   *
   * The one place that knows filing has two halves: the notebook's `chatIds` in the
   * registry, and the chat's own file, which physically moves between the global
   * `Chats/` folder and `Notebooks/<name>/Chats/`. Every surface that files a chat —
   * the notebook page's row menu, the chat picker, the chat that was started from a
   * notebook — goes through here, because a surface that did only the registry half
   * would leave the file where it was and the reconciler would then adopt the file's
   * location and undo the filing on the next poll.
   *
   * The registry half is synchronous and lands first, so the sidebar and the
   * notebook's "Past chats" list update on the click. The disk half is awaited, so a
   * caller that wants to know the file has moved can.
   */
  const fileChat = useCallback(async (chatId: string, notebookId: string | null): Promise<void> => {
    if (!chatId) return;
    const current = findNotebookForChat(chatId);
    const target = notebookId ? getNotebook(notebookId) : undefined;
    // A notebook that no longer exists is not somewhere to file a chat. Unfiling it
    // instead would be a guess; leaving it alone lets the caller see nothing happen.
    if (notebookId && !target) return;

    if (current?.id !== target?.id) {
      /*
       * Remove before add, never both at once: `findNotebookForChat` assumes at most
       * one owner, so a chat must never be briefly in two, and a listener that ran
       * between two independent writes would see it twice. Both calls persist, so
       * the order also decides what an interruption leaves behind — unfiled
       * (recoverable) rather than duplicated.
       */
      if (current) removeChatFromNotebook(current.id, chatId);
      if (target) addChatToNotebook(target.id, chatId);
    }

    // Called even when the registry already agreed: the record may still carry a
    // pending move from an earlier attempt, and this retries it.
    await moveLocalFSChatToNotebook(chatId, target ? target.id : null);
  }, [moveLocalFSChatToNotebook]);

  /**
   * Delete a notebook: its chats are unfiled, its folder removed, its row dropped.
   *
   * Order is the whole of the correctness here. Every chat is unfiled **first**, and
   * while the registry still knows this notebook — both the source folder lookup and
   * the reconciler's "unaccounted for, not deleted" guard resolve through the
   * registry, so a row dropped early would strand every chat file in a folder
   * nothing scans. The folder goes next, and it refuses to be removed while a chat
   * file is still inside. The row is dropped last.
   *
   * Deleting a notebook must not delete conversations, so nothing here removes a
   * chat: they return to Recents, which is where an unfiled chat belongs.
   */
  const deleteNotebookWithFolder = useCallback(async (notebookId: string): Promise<void> => {
    const notebook = getNotebook(notebookId);
    if (!notebook) return;

    // Sequentially: the folder removal below is only allowed once every one of them
    // has left, so this cannot be a fan-out that the removal races.
    for (const chatId of [...notebook.chatIds]) {
      removeChatFromNotebook(notebookId, chatId);
      await moveLocalFSChatToNotebook(chatId, null);
    }

    await deleteLocalFSNotebookFolder(notebookId);
    deleteNotebook(notebookId);
  }, [deleteLocalFSNotebookFolder, moveLocalFSChatToNotebook]);

  return {
    createNotebookWithFolder,
    renameNotebookWithFolder,
    fileChat,
    deleteNotebookWithFolder,
  };
};
