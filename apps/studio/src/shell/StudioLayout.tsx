import React from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { Sidebar, ViewType } from './sidebar/Sidebar';
import { ConversationActionsMenu } from './ConversationActionsMenu';
import { SearchModal } from './SearchModal';
import { useBackground } from './BackgroundContext';
import { useLocalFS } from '@willow/storage/local-fs/LocalFSContext';
import { WaveShaderBackground } from '@willow/ui/wave-shader';
import { ShaderAnimation } from '@willow/ui/shader-lines';
import { STUDIO_SIDEBAR_COLLAPSED_WIDTH, STUDIO_SIDEBAR_EXPANDED_WIDTH } from '@willow/core/layout';
import type { StudioExperience } from '@willow/core/types';
import { useStore } from '@nanostores/react';
import { $chatPanelOpen, $voiceModeActive } from '@willow/chat/chat-panel-store';
import { useAuth } from '@willow/auth/AuthContext';

/*
 * Signed out is NOT a different layout. Everything Willow does runs locally, so
 * the shell, the sidebar and the background are identical in both states and the
 * only thing sign-in changes is the handful of features that genuinely need an
 * account — those call `onAuthRequired` at their own call sites (see
 * `ChatView.tsx` `isAuthenticated` guards).
 *
 * This used to be three separate signed-out overrides: the `lines` shader forced
 * on regardless of the user's saved background, the sidebar gated out entirely,
 * and a Log in / Sign up pair pinned top-right. Together they read as a barrier
 * screen in front of an app that never needed one. All three are gone; do not
 * reintroduce a signed-out-only visual.
 */
const BackgroundRenderer: React.FC<{ isSidebarCollapsed?: boolean }> = ({ isSidebarCollapsed }) => {
  const { background } = useBackground();

  switch (background) {
    case 'waves':
      return <WaveShaderBackground isSidebarCollapsed={isSidebarCollapsed} />;
    case 'lines':
      return <ShaderAnimation />;
    case 'solid':
    default:
      return null;
  }
};const WORKSPACE_SELECTION_BG: Record<string, string> = {
  yellow: 'rgba(253, 221, 65, 0.35)',
  blue: 'rgba(168, 199, 250, 0.35)',
  green: 'rgba(156, 228, 179, 0.35)',
  pink: 'rgba(250, 178, 205, 0.35)',
  orange: 'rgba(255, 202, 138, 0.35)',
};

export const StudioLayout: React.FC<{
  isSearchOpen: boolean;
  setIsSearchOpen: (open: boolean) => void;
  currentView: ViewType;
  setCurrentView: (view: ViewType) => void;
  children: React.ReactNode;
  onSettingsClick: (tabId?: string) => void;
  studioMode: 'develop' | 'chat' | 'media';
  onModeChange: (mode: 'develop' | 'chat' | 'media') => void;
  studioExperience: StudioExperience;
  onStudioExperienceChange: (experience: StudioExperience) => void;
  onNewChat: () => void;
  hasActiveChat: boolean;
  isIncognito: boolean;
  onIncognitoChat: () => void;
  isSidebarCollapsed: boolean;
  setIsSidebarCollapsed: (collapsed: boolean) => void;
  isSidebarHidden?: boolean;
}> = ({
  isSearchOpen,
  setIsSearchOpen,
  currentView,
  setCurrentView,
  children,
  onSettingsClick,
  studioMode,
  onModeChange,
  studioExperience,
  onStudioExperienceChange,
  onNewChat,
  hasActiveChat,
  isIncognito,
  onIncognitoChat,
  isSidebarCollapsed,
  setIsSidebarCollapsed,
  isSidebarHidden = false,
}) => {
  const { background } = useBackground();
  const { 
    selectLocalFSInboxChat, 
    activeChatId,
    isLocalFolderConnected,
    isLocalFolderAuthorized,
    isInitializingLocalFS,
    authorizeLocalFolder,
    disconnectLocalFolder
  } = useLocalFS();

  const { userProfile } = useAuth();
  const effectiveWorkspaceColor = userProfile?.workspaceColor || 'green';
  const selectionBg = WORKSPACE_SELECTION_BG[effectiveWorkspaceColor] || WORKSPACE_SELECTION_BG.green;

  const isChatExperience = studioExperience === 'chat';
  const chatPanelOpen = useStore($chatPanelOpen);
  const voiceModeActive = useStore($voiceModeActive);
  const isChatOngoing = isChatExperience && (!!activeChatId || hasActiveChat);
  const studioSurface = '#0f0f0f';
  
  return (
    <div
      className={`studio-layout studio-layout--${studioExperience} flex h-screen w-screen overflow-hidden bg-[var(--studio-surface)] text-white relative`}
      style={{
        '--studio-surface': studioSurface,
        '--studio-selection-bg': selectionBg,
      } as React.CSSProperties}
    >
      {/* Background rendered at root level ONLY for waves (to cover sidebar) */}
      {currentView === 'home' && isChatExperience && background === 'waves' && (
        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
            <BackgroundRenderer isSidebarCollapsed={isSidebarCollapsed} />
            <div className="absolute inset-0 z-[1] pointer-events-none opacity-[0.06] mix-blend-overlay" style={{backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.6' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='1'/%3E%3C/svg%3E")`}} />
            <div
              className="absolute inset-0 z-[2] pointer-events-none"
              style={{ background: 'radial-gradient(circle at center, transparent 30%, var(--studio-surface) 110%)' }}
            />
        </div>
      )}

      {/* The sidebar is unconditional — see the note on BackgroundRenderer above. */}
      {studioExperience === 'spark' && isSidebarCollapsed && !isSidebarHidden && (
        <button
          type="button"
          className="studio-sidebar-mobile-open"
          aria-label="Open sidebar"
          onClick={() => setIsSidebarCollapsed(false)}
        >
          <MaterialSymbol
            name="side_nav_expand"
            family="google-symbols"
            size={24}
            weight={400}
            opticalSize={24}
          />
        </button>
      )}
      <Sidebar
        onSearchClick={() => setIsSearchOpen(true)}
        currentView={currentView}
        onViewChange={setCurrentView}
        studioMode={studioMode}
        onModeChange={onModeChange}
        studioExperience={studioExperience}
        onStudioExperienceChange={onStudioExperienceChange}
        onSettingsClick={onSettingsClick}
        backgroundType={background}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        hasActiveChat={isChatOngoing}
        onNewChat={() => {
          selectLocalFSInboxChat(null);
          onNewChat();
        }}
        isIncognito={isIncognito}
        onIncognitoChat={onIncognitoChat}
        isHidden={isSidebarHidden}
      />
      {studioExperience === 'spark' && !isSidebarCollapsed && (
        <button
          type="button"
          className="studio-sidebar-mobile-scrim"
          aria-label="Close navigation"
          onClick={() => setIsSidebarCollapsed(true)}
        />
      )}


      <SearchModal isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />

      {/* Persistent Authorize Sync Modal */}
      {isLocalFolderConnected && !isLocalFolderAuthorized && !isInitializingLocalFS && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/60 backdrop-fade-in" />
          <div className="relative bg-[#1e1f20] rounded-[28px] p-6 max-w-[500px] w-full shadow-2xl modal-scale-in">
            <h2 className="text-[22px] font-medium text-[#e3e3e3] mb-4">Authorize local folder?</h2>
            <p className="text-[15px] text-[#c4c7c5] leading-relaxed mb-8">
              Willow requires your permission to read and write to the connected folder in order to sync your chats and projects.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void disconnectLocalFolder();
                }}
                className="px-5 py-2.5 text-[14px] font-medium text-[#e3e3e3] hover:bg-white/5 rounded-full transition-colors"
              >
                Turn off
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void authorizeLocalFolder();
                }}
                className="px-5 py-2.5 text-[14px] font-medium text-[#e3e3e3] hover:bg-white/5 rounded-full transition-colors"
              >
                Authorize
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 relative flex flex-col min-w-0 bg-transparent">
        {/*
          Pinned "Temporary Chat" label, measured from Gemini's
          `div.temporary-chat-header`: 16px padding around a 40px line box
          (72px tall), centred, 14px/500 in #c4c7c5, with the 8px `.info-text`
          padding-left that offsets the label 4px right of true centre.

          Gemini positions this `fixed` at `right: 0` with
          `width: calc(100vw - 288px - 16px * 2)` and transitions the width over
          300ms so it tracks the sidebar. Willow's content column is already a
          `relative` flex sibling of the sidebar, so `absolute inset-x-0 top-0`
          resolves to the identical box (measured x 288 -> 1536 at a 1536px
          viewport) and follows the sidebar for free.

          It appears only once the conversation is under way. Gemini's temporary
          chat opens with no header at all — the zero state carries the
          `gemini_chat_temp` glyph and the "Incognito chat" card instead, and
          the pinned label fades in with the thread. Hence the `isChatOngoing`
          gate; without it the label sat above the zero-state card, which Gemini
          never shows.

          `pointer-events-none` is the one deliberate departure. The measured
          header box fully contains the toggle button (x 1488-1524, y 14-50), so
          a click-absorbing overlay here would make incognito impossible to
          leave. The label has no interactive content, so this changes nothing
          visual.
        */}
        {currentView === 'home' && isChatExperience && studioMode === 'chat' && isIncognito && isChatOngoing && (
          <div
            data-test-id="temporary-chat-header"
            className="absolute inset-x-0 top-0 z-20 flex items-center justify-center p-4 pointer-events-none select-none"
            style={{
              fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif',
              fontSize: '14px',
              fontWeight: 500,
              lineHeight: '40px',
              color: '#c4c7c5',
            }}
          >
            <span style={{ paddingLeft: '8px' }}>Temporary Chat</span>
          </div>
        )}
        {/*
          Top-right: the conversation-actions menu, which is what Gemini shows
          in this exact box once a conversation is under way. It is the
          `isChatOngoing` counterpart of the temporary-chat button below —
          Gemini shows one control here at a time, and the measured trigger
          occupies the same 36x36 at top 14 / right 12 as the button does.

          Gated to a real chat id: every row acts on a named chat, and
          `hasActiveChat` can be true for an unsaved one.
        */}
        {currentView === 'home' && isChatExperience && studioMode === 'chat' && isChatOngoing && !!activeChatId && !chatPanelOpen && !voiceModeActive && (
          <ConversationActionsMenu chatId={activeChatId} />
        )}
        {/* Top-right: Temporary Chat button in Chat mode (Exact Gemini Web specs) */}
        {currentView === 'home' && isChatExperience && studioMode === 'chat' && !isChatOngoing && (
          <div className="absolute top-[14px] right-[12px] z-30 flex items-center">
            <button
              onClick={() => {
                selectLocalFSInboxChat(null);
                if (isIncognito) {
                  onNewChat(); // Toggle back to normal chat mode
                } else {
                  onIncognitoChat(); // Toggle to incognito chat mode
                }
              }}
              title={isIncognito ? "Exit temporary chat" : "Temporary chat"}
              aria-label="Temporary chat"
              /*
               * No selected-state fill. Active is carried by the glyph swapping
               * to `close`, so a pill on top of that would be saying it twice;
               * hover is the only background this button ever shows.
               */
              className="w-[36px] h-[36px] p-2 rounded-full flex items-center justify-center transition-colors bg-transparent text-[#e3e3e3] hover:bg-[#e3e3e3]/[0.08]"
            >
              <span
                className="lumi-symbols text-[24px] leading-none select-none text-[#e3e3e3]"
                style={{ fontFamily: "'Luminous Symbols', 'Google Symbols', 'Material Symbols Rounded', sans-serif" }}
              >
                {/*
                  Active, this becomes the close glyph — Gemini swaps the symbol
                  rather than relying on the filled pill alone, so the control
                  reads as "leave temporary chat" instead of just "selected".
                  The pill stays; it is the swap that was missing.
                */}
                {isIncognito ? 'close' : 'gemini_chat_temp'}
              </span>
            </button>
          </div>
        )}
        {/* Background rendered in content area for lines only (solid is just plain color) */}
        {currentView === 'home' && isChatExperience && background === 'lines' && (
          <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
              <BackgroundRenderer isSidebarCollapsed={isSidebarCollapsed} />
              <div className="absolute inset-0 z-[1] pointer-events-none opacity-[0.06] mix-blend-overlay" style={{backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.6' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='1'/%3E%3C/svg%3E")`}} />
              <div
                className="absolute inset-0 z-[2] pointer-events-none"
                style={{ background: 'radial-gradient(circle at center, transparent 30%, var(--studio-surface) 110%)' }}
              />
          </div>
        )}
        <main
          className={`flex-1 relative z-10 overflow-y-auto scroll-smooth flex flex-col ${
            isChatExperience ? '' : 'spark-studio-scroll'
          }`}
          style={{ scrollbarGutter: 'stable' }}
        >
             {children}
        </main>
      </div>
    </div>
  );
};
