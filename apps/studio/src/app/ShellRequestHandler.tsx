import React from 'react';
import { useStore } from '@nanostores/react';
import { clearShellRequest, pendingChatSeed, pendingShellRequest } from '@willow/core/shell-request';
import type { StudioExperience } from '@willow/core/types';
import { useLocalFS } from '@willow/storage/local-fs/LocalFSContext';
import { navigateSpark } from '@willow/spark/spark-store';
import type { SparkLocation } from '@willow/spark/spark-types';
import type { ViewType } from '../shell/sidebar/Sidebar';

interface ShellRequestHandlerProps {
  onStudioExperienceChange: (experience: StudioExperience) => unknown;
  onViewChange: (view: ViewType) => unknown;
  onNewChat: () => void;
}

/**
 * Carries out what a feature asked the shell for (`@willow/core/shell-request`), once each:
 *
 * - **A Spark page**, such as a chat's scheduled-action card asking for its schedule in
 *   Spark's editor. The same three steps as the sidebar's Spark rows.
 * - **A seeded chat**: Spark's Skills page "Create with Gemini" leaves Spark for a new chat
 *   already holding Gemini's question. The seed is set before the chat is reset, and the
 *   new ChatView takes it as it mounts, so the chat that was open never sees it.
 */
export const ShellRequestHandler: React.FC<ShellRequestHandlerProps> = ({
  onStudioExperienceChange,
  onViewChange,
  onNewChat,
}) => {
  const request = useStore(pendingShellRequest);
  const { selectLocalFSInboxChat } = useLocalFS();
  const handlers = React.useRef({ onStudioExperienceChange, onViewChange, onNewChat, selectLocalFSInboxChat });
  handlers.current = { onStudioExperienceChange, onViewChange, onNewChat, selectLocalFSInboxChat };

  React.useEffect(() => {
    if (!request) return;
    clearShellRequest(request.id);
    const shell = handlers.current;
    if (request.surface === 'spark') {
      void shell.onStudioExperienceChange('spark');
      void shell.onViewChange('home');
      navigateSpark(request.sparkLocation as SparkLocation);
      return;
    }
    pendingChatSeed.set(request.seed);
    shell.selectLocalFSInboxChat(null);
    shell.onNewChat();
    void shell.onStudioExperienceChange('chat');
    void shell.onViewChange('home');
  }, [request]);

  return null;
};
