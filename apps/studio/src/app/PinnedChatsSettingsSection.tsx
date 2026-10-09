/**
 * The pinned chats in `settings.json` (`pinnedChats`), so a new copy of Willow on the folder — a
 * reinstall, a fresh profile, the web version — pins what the user pinned. A pin list belongs to the
 * folder's chat scope (`pinnedChatsStorageKey`), hence a section of its own inside `LocalFSProvider`
 * rather than one of `SettingsFileBridge`'s. Renders nothing.
 */

import React from 'react';
import { registerSettingsSection } from '@willow/core/settings-file';
import { useLocalFS } from '@willow/storage/local-fs/LocalFSContext';
import {
  PINNED_CHATS_CHANGED_EVENT,
  pinnedChatsStorageKey,
  readPinnedChats,
  writePinnedChats,
} from '../shell/chat-actions';

const pins = (value: unknown): string[] =>
  Array.isArray(value) ? [...new Set(value.filter((entry): entry is string => typeof entry === 'string'))] : [];

export function PinnedChatsSettingsSection() {
  const { chatScopeId } = useLocalFS();
  const scope = React.useRef(chatScopeId);
  scope.current = chatScopeId;

  React.useEffect(() => registerSettingsSection('pinnedChats', {
    order: 75,
    // A scope that never had a pin list leaves the file's as it is: a sign-in's new scope is not a list emptied.
    read: () => readPinnedChats(scope.current) ?? undefined,
    apply: (value) => {
      if (!Array.isArray(value)) return;
      const chats = pins(value);
      if (JSON.stringify(chats) !== JSON.stringify(readPinnedChats(scope.current) ?? [])) writePinnedChats(scope.current, chats);
    },
    subscribe: (onChange) => {
      const onPinned = (event: Event) => {
        if ((event as CustomEvent<{ chatScopeId?: string }>).detail?.chatScopeId === scope.current) onChange();
      };
      const onStorage = (event: StorageEvent) => {
        if (event.key === pinnedChatsStorageKey(scope.current)) onChange();
      };
      window.addEventListener(PINNED_CHATS_CHANGED_EVENT, onPinned);
      window.addEventListener('storage', onStorage);
      return () => {
        window.removeEventListener(PINNED_CHATS_CHANGED_EVENT, onPinned);
        window.removeEventListener('storage', onStorage);
      };
    },
    merge: (fromFile, local) => {
      const file = pins(fromFile);
      return [...file, ...pins(local).filter((chat) => !file.includes(chat))];
    },
  }), []);

  return null;
}
