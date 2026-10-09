import React, { useState } from 'react';
import { useStore } from '@nanostores/react';

import { DeleteNotebookDialog } from './DeleteNotebookDialog';
import { NotebookMenu, type AnchorRect } from './NotebookMenu';
import { RenameNotebookDialog } from './RenameNotebookDialog';
import { notebooksStore, toggleNotebookPinned } from './notebooks-store';
import { useNotebookDisk } from './useNotebookDisk';

/** Whose menu is open, and the trigger it hangs from. */
export interface NotebookActionsTarget {
  notebookId: string;
  anchor: AnchorRect;
}

/**
 * The menu a notebook card or drawer row raises below 961px, and the dialogs its items
 * open. Gemini's card menu and its drawer row menu are the same three items — Pin (or
 * Unpin), Rename, Delete — with no tint on Delete.
 *
 * Mount it beside the clickable cards or rows, never inside one: React bubbles portal
 * events through the component tree, so a click or an Enter inside a dialog mounted
 * under a card would also open that card's notebook. It stays mounted while the menu is
 * closed, because the dialogs outlive the menu that opened them.
 */
export const NotebookActionsMenu: React.FC<{
  target: NotebookActionsTarget | null;
  onClose: () => void;
  align?: 'end' | 'start';
  menuClassName?: string;
}> = ({ target, onClose, align, menuClassName }) => {
  const notebooks = useStore(notebooksStore);
  const { deleteNotebookWithFolder } = useNotebookDisk();
  const [dialog, setDialog] = useState<{ kind: 'rename' | 'delete'; notebookId: string } | null>(null);
  const menuNotebook = target ? notebooks.find((notebook) => notebook.id === target.notebookId) : undefined;
  const dialogNotebook = dialog ? notebooks.find((notebook) => notebook.id === dialog.notebookId) : undefined;

  return (
    <>
      {target && menuNotebook && (
        <NotebookMenu
          anchor={target.anchor}
          align={align}
          className={menuClassName}
          onClose={onClose}
          items={[
            {
              label: menuNotebook.pinned ? 'Unpin' : 'Pin',
              icon: 'push_pin',
              onSelect: () => toggleNotebookPinned(menuNotebook.id),
            },
            {
              label: 'Rename',
              icon: 'edit',
              onSelect: () => setDialog({ kind: 'rename', notebookId: menuNotebook.id }),
            },
            {
              label: 'Delete',
              icon: 'delete',
              onSelect: () => setDialog({ kind: 'delete', notebookId: menuNotebook.id }),
            },
          ]}
        />
      )}

      {dialog?.kind === 'rename' && dialogNotebook && (
        <RenameNotebookDialog notebook={dialogNotebook} onClose={() => setDialog(null)} />
      )}

      {dialog?.kind === 'delete' && dialogNotebook && (
        <DeleteNotebookDialog
          notebook={dialogNotebook}
          onClose={() => setDialog(null)}
          onDeleted={() => {
            void deleteNotebookWithFolder(dialogNotebook.id);
            setDialog(null);
          }}
        />
      )}
    </>
  );
};
