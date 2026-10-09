import React, { useEffect } from 'react';
import { useStore } from '@nanostores/react';
import { useAuth } from '@willow/auth/AuthContext';
import { $askWillow } from '@willow/chat/ask-willow';
import { desktopHasMica, reportDesktopFrame } from '@willow/core/desktop-bridge';
import { useThemeMode } from '@willow/core/theme-mode';
import { getWorkspaceTheme } from '@willow/core/workspace-theme';
import { harnessFrameShell } from '@willow/harness/harness-theme';
import { isHarnessId } from '@willow/harness/harnesses';
import { AppMenu } from './AppMenu';
import { AppRail, type RailDestinationId } from './AppRail';

/** The desktop app's Ask Willow window (from the right-click menu), loaded the first time it opens. */
const AskWillow = React.lazy(() => import('@willow/chat/AskWillow').then((module) => ({ default: module.AskWillow })));

interface DesktopFrameProps {
  current: RailDestinationId;
  onNavigate: (destination: RailDestinationId) => void;
  isIncognito: boolean;
  onNewChat: () => void;
  onTemporaryChat: () => void;
  onSettings: () => void;
  onToggleSidebar: () => void;
  modelConfig: unknown;
  /**
   * Whether this frame is the one on show. The main shell's stays mounted, hidden, beside a project's
   * (`shell-active.ts`), and only one may answer the strip's menus and open Ask Willow.
   */
  active?: boolean;
  /** What the page holds. Willow's surfaces outside the main shell are laid over it instead (`willow-frame-fill`). */
  children?: React.ReactNode;
}

/**
 * The desktop app's frame around Willow (AppRail.css): the rail, the rounded page, the strip's
 * File, Edit and View menus drawn over it, and Ask Willow. The main shell's layout fills the
 * page; a Media or Code project and Willow TV, which sit outside that shell, are laid over the
 * page where it is, so the rail stays beside them as beside the rest of Willow.
 */
export const DesktopFrame: React.FC<DesktopFrameProps> = ({
  current,
  onNavigate,
  isIncognito,
  onNewChat,
  onTemporaryChat,
  onSettings,
  onToggleSidebar,
  modelConfig,
  active = true,
  children,
}) => {
  const { workspaceColor } = useAuth();
  const { isLight } = useThemeMode();
  // An agent's tab is in its agent's colour (features/harness harness-theme.ts), and so is the frame round it.
  const shells = isHarnessId(current) ? harnessFrameShell(current) : getWorkspaceTheme(workspaceColor).frameShell;
  const frameShell = shells[isLight ? 'light' : 'dark'];
  // The window's strip sits on the same shell, so it follows the colour too.
  useEffect(() => {
    reportDesktopFrame(frameShell, isLight);
  }, [frameShell, isLight]);
  const askWillow = useStore($askWillow);

  return (
    <div
      className={`willow-frame${isLight ? ' willow-frame--light' : ''}${desktopHasMica() ? ' willow-frame--mica' : ''}`}
      style={{ '--willow-frame-shell': frameShell } as React.CSSProperties}
    >
      <AppRail current={current} onNavigate={onNavigate} isLight={isLight} />
      <div className="willow-frame__page">{children}</div>
      {active && (
        <AppMenu
          isLight={isLight}
          isIncognito={isIncognito}
          onNewChat={onNewChat}
          onTemporaryChat={onTemporaryChat}
          onSettings={onSettings}
          onToggleSidebar={onToggleSidebar}
        />
      )}
      {active && askWillow && (
        <React.Suspense fallback={null}>
          <AskWillow modelConfig={modelConfig} />
        </React.Suspense>
      )}
    </div>
  );
};
