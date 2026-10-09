import React, { useEffect, useRef } from 'react';
import { useUserDataContext } from '@willow/auth/UserDataContext';
import { useLocalFS } from '@willow/storage/local-fs/LocalFSContext';
import { registerChatTurnTakeover } from './chat-turn-takeover';

/**
 * Lets this tab carry on chat replies that a closed tab was writing, whatever
 * screen it is showing. Mounted once at the app root; renders nothing.
 */
export const ChatTurnTakeover: React.FC<{ modelConfig: unknown }> = ({ modelConfig }) => {
  const { apiKeys, loading: areKeysLoading } = useUserDataContext();
  const {
    isLocalFolderConnected,
    loadLocalFSChat,
    loadLocalFSChatAttachment,
    saveLocalFSChat,
    chatScopeId,
  } = useLocalFS();
  const latest = useRef({ apiKeys, modelConfig, loadLocalFSChat, loadLocalFSChatAttachment, saveLocalFSChat, chatScopeId });
  latest.current = { apiKeys, modelConfig, loadLocalFSChat, loadLocalFSChatAttachment, saveLocalFSChat, chatScopeId };
  const ready = isLocalFolderConnected && !areKeysLoading;

  useEffect(() => {
    if (!ready) return undefined;
    return registerChatTurnTakeover({
      scopeId: () => latest.current.chatScopeId,
      modelConfig: () => latest.current.modelConfig,
      apiKeys: () => latest.current.apiKeys,
      loadChat: (chatId) => latest.current.loadLocalFSChat(chatId),
      loadAttachment: (attachmentId) => latest.current.loadLocalFSChatAttachment(attachmentId),
      saveChat: (chatId, messages, oldChatId) => latest.current.saveLocalFSChat(chatId, messages, oldChatId),
    });
  }, [ready]);

  return null;
};

export default ChatTurnTakeover;
