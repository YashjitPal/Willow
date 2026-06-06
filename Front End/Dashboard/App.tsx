
import React, { useState, Suspense } from 'react';
import { Routes, Route, useNavigate, useSearchParams, Link, Navigate } from 'react-router-dom';
import { Sidebar, ViewType } from './components/Sidebar';
import { HeroSection } from './components/HeroSection';
import { BottomPanel } from './components/BottomPanel';
import { ShaderAnimation } from './components/ui/shader-lines';
import { WaveShaderBackground } from './components/ui/wave-shader';
import { SearchModal } from './components/SearchModal';
import { SettingsModal } from './components/SettingsModal';
import { ProjectsPage } from './components/ProjectsPage';
import { RainbowButton } from './components/ui/rainbow-button';
import { LoginPage } from './components/LoginPage';
import { Onboarding } from './components/Onboarding';
import { DashboardChat } from './components/DashboardChat';
import { SquarePen, Glasses } from 'lucide-react';
import { useAuth } from './context/AuthContext';
import { BackgroundProvider, useBackground } from './context/BackgroundContext';
import { UserDataProvider } from './context/UserDataContext';
import { LocalFSProvider, useLocalFS } from './context/LocalFSContext';

// Lazy-load StagingView to prevent WebContainer boot on login page
const StagingView = React.lazy(() => import('./components/staging/StagingView'));
const MediaView = React.lazy(() => import('./components/media/MediaView'));

// Dynamic background renderer based on context
const BackgroundRenderer: React.FC<{ isAuthenticated: boolean; isSidebarCollapsed?: boolean }> = ({ isAuthenticated, isSidebarCollapsed }) => {
  const { background } = useBackground();
  
  // Force 'lines' background for non-authenticated users
  const effectiveBackground = isAuthenticated ? background : 'lines';
  
  switch (effectiveBackground) {
    case 'waves':
      return <WaveShaderBackground isSidebarCollapsed={isSidebarCollapsed} />;
    case 'lines':
      return <ShaderAnimation />;
    case 'solid':
    default:
      return null;
  }
};

// Auth buttons for non-authenticated users
const AuthButtons: React.FC = () => {
  return (
    <div className="absolute top-4 right-6 z-50 flex items-center gap-3">
      <Link to="/login?mode=login">
        <button className="px-4 py-2 text-sm font-medium text-white/80 hover:text-white transition-colors">
          Log in
        </button>
      </Link>
      <Link to="/login?mode=signup">
        <RainbowButton className="px-4 py-2 text-sm font-bold">
          Sign up
        </RainbowButton>
      </Link>
    </div>
  );
};

const DashboardLayout: React.FC<{
  isSearchOpen: boolean;
  setIsSearchOpen: (open: boolean) => void;
  currentView: ViewType;
  setCurrentView: (view: ViewType) => void;
  children: React.ReactNode;
  onSettingsClick: () => void;
  isAuthenticated: boolean;
  dashboardMode: 'develop' | 'chat' | 'media';
  onModeChange: (mode: 'develop' | 'chat' | 'media') => void;
  onNewChat: () => void;
  hasActiveChat: boolean;
  isIncognito: boolean;
  onIncognitoChat: () => void;
  isSidebarCollapsed: boolean;
  setIsSidebarCollapsed: (collapsed: boolean) => void;
}> = ({
  isSearchOpen,
  setIsSearchOpen,
  currentView,
  setCurrentView,
  children,
  onSettingsClick,
  isAuthenticated,
  dashboardMode,
  onModeChange,
  onNewChat,
  hasActiveChat,
  isIncognito,
  onIncognitoChat,
  isSidebarCollapsed,
  setIsSidebarCollapsed
}) => {
  const { background } = useBackground();
  const { selectLocalFSInboxChat, activeChatId } = useLocalFS();

  const isChatOngoing = !!activeChatId || hasActiveChat;
  // Calculate effective background (non-authenticated users get 'lines')
  const effectiveBackground = isAuthenticated ? background : 'lines';
  
  return (
    <div className={`flex h-screen w-screen overflow-hidden ${effectiveBackground === 'solid' ? 'bg-[#212121]' : 'bg-[#1c1c1c]'} text-white selection:bg-pink-500/30 relative`}>
      {/* Background rendered at root level ONLY for waves (to cover sidebar) */}
      {currentView === 'home' && effectiveBackground === 'waves' && (
        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
            <BackgroundRenderer isAuthenticated={isAuthenticated} isSidebarCollapsed={isSidebarCollapsed} />
            <div className="absolute inset-0 z-[1] pointer-events-none opacity-[0.06] mix-blend-overlay" style={{backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.6' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='1'/%3E%3C/svg%3E")`}} />
            <div className="absolute inset-0 z-[2] bg-[radial-gradient(circle_at_center,transparent_30%,#1c1c1c_110%)] pointer-events-none" />
        </div>
      )}

      {/* Only show sidebar when authenticated */}
      {isAuthenticated && (
        <Sidebar 
          onSearchClick={() => setIsSearchOpen(true)} 
          currentView={currentView}
          onViewChange={setCurrentView}
          dashboardMode={dashboardMode}
          onModeChange={onModeChange}
          onSettingsClick={onSettingsClick}
          backgroundType={effectiveBackground}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          hasActiveChat={isChatOngoing}
          onNewChat={() => {
            selectLocalFSInboxChat(null);
            onNewChat();
          }}
          isIncognito={isIncognito}
          onIncognitoChat={onIncognitoChat}
        />
      )}
      
      {/* Show auth buttons when not authenticated */}
      {!isAuthenticated && <AuthButtons />}
      
      <SearchModal isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />

      <div className="flex-1 relative flex flex-col min-w-0 bg-transparent">
        {/* Top-right: Incognito Chat button in Chat mode */}
        {currentView === 'home' && dashboardMode === 'chat' && !isChatOngoing && (
          <div className="absolute top-4 right-4 z-30 flex items-center">
            <button
              onClick={() => {
                selectLocalFSInboxChat(null);
                if (isIncognito) {
                  onNewChat(); // Toggle back to normal chat mode
                } else {
                  onIncognitoChat(); // Toggle to incognito chat mode
                }
              }}
              title={isIncognito ? "Exit incognito chat" : "Incognito chat"}
              className={`p-1.5 rounded-lg transition-colors ${
                isIncognito 
                  ? 'text-purple-400 hover:text-purple-300 hover:bg-purple-500/10' 
                  : 'text-white/60 hover:text-white hover:bg-white/10'
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-[22px] h-[22px]"
              >
                {/* Fedora Hat Brim */}
                <path d="M3 14h18" />
                {/* Fedora Hat Crown */}
                <path d="M6 14l1.2-6.5C7.4 6.2 8.5 5.5 9.7 5.5h4.6c1.2 0 2.3 0.7 2.5 2l1.2 6.5" />
                {/* Hat ribbon */}
                <path d="M6.5 12h11" strokeWidth="1.5" />
                {/* Classic circular glasses */}
                <circle cx="8" cy="19.5" r="2" />
                <circle cx="16" cy="19.5" r="2" />
                {/* Glasses Bridge */}
                <path d="M10 19.5a2 2 0 0 1 4 0" />
              </svg>
            </button>
          </div>
        )}
        {/* Background rendered in content area for lines only (solid is just plain color) */}
        {currentView === 'home' && effectiveBackground === 'lines' && (
          <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
              <BackgroundRenderer isAuthenticated={isAuthenticated} isSidebarCollapsed={isSidebarCollapsed} />
              <div className="absolute inset-0 z-[1] pointer-events-none opacity-[0.06] mix-blend-overlay" style={{backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.6' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='1'/%3E%3C/svg%3E")`}} />
              <div className="absolute inset-0 z-[2] bg-[radial-gradient(circle_at_center,transparent_30%,#1c1c1c_110%)] pointer-events-none" />
          </div>
        )}
        {/* Solid background: No overlays, just plain color from parent */}
        <main
          className="flex-1 relative z-10 overflow-y-auto scroll-smooth flex flex-col"
          /* Reserve scrollbar gutter so centered content (e.g. InputBar) doesn't
             shift horizontally when the main scrollbar appears/disappears
             between Develop hero, Chat hero, and Chat thread views. */
          style={{ scrollbarGutter: 'stable' }}
        >
             {children}
        </main>
      </div>
    </div>
  );
};

const ProjectIframe: React.FC = () => {
    const [searchParams] = useSearchParams();
    const prompt = searchParams.get('prompt') || '';

    return (
        <iframe
            src={`http://localhost:3001/?prompt=${encodeURIComponent(prompt)}`}
            className="w-full h-full border-none"
            title="Project Content"
        />
    );
};

// Check for page refresh - used to redirect from staging to dashboard on refresh
const getNavigationType = (): string => {
  const navEntries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
  return navEntries[0]?.type || 'navigate';
};

// Wrapper component that handles refresh redirect BEFORE StagingView loads
// This prevents the visual glitch caused by StagingView rendering then redirecting
const StagingRouteGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Check synchronously if this is a refresh that should redirect
  const [shouldRedirect] = React.useState(() => {
    const isRouterNav = sessionStorage.getItem('staging-nav');
    if (isRouterNav) {
      return false;
    }
    return getNavigationType() === 'reload';
  });

  React.useEffect(() => {
    sessionStorage.removeItem('staging-nav');
  }, []);

  // If refreshing while on staging, redirect to dashboard immediately
  if (shouldRedirect) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

const App: React.FC = () => {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<'workspace' | 'people' | 'models' | 'cloud' | 'privacy' | 'account' | 'labs' | 'connectors' | 'github' | undefined>(undefined);
  const [settingsInitialConnector, setSettingsInitialConnector] = useState<string | null | undefined>(undefined);
  const [currentView, setCurrentView] = useState<ViewType>('home');

  // Model Config State - Lifted for synchronization.
  // Persisted to localStorage so saved model presets & selection survive reload
  // (local-only, same policy as API keys — never sent to Willow servers).
  const DEFAULT_MODEL_CONFIG = {
    gemini: {
        model: 'gemini-3-flash-preview',
        thinkingLevel: 3, // 3 = high thinking level (0=none, 1=low, 2=medium, 3=high)
        savedModels: [
          { id: 'default-flash-high', name: 'Gemini 3 Flash', thinkingLevel: 3, modelId: 'gemini-3-flash-preview' },
          { id: 'default-pro-high', name: 'Gemini 3.1 Pro', thinkingLevel: 3, modelId: 'gemini-3.1-pro-preview' }
        ] as Array<{ id: string; name: string; thinkingLevel: number; modelId: string }>
    },
    openai: {
        model: 'gpt-5.2-thinking',
        thinkingLevel: 2,
        savedModels: [] as Array<{ id: string; name: string; thinkingLevel: number; modelId: string }>
    },
    anthropic: {
        model: 'claude-sonnet-4.5',
        thinkingLevel: 2,
        savedModels: [] as Array<{ id: string; name: string; thinkingLevel: number; modelId: string }>
    }
  };

  const [modelConfig, setModelConfig] = React.useState(() => {
    try {
      const raw = localStorage.getItem('modelConfig');
      if (raw) {
        const parsed = JSON.parse(raw);
        // Merge per-provider so new fields/defaults aren't lost if the stored
        // shape is older than the current code.
        return {
          gemini: { ...DEFAULT_MODEL_CONFIG.gemini, ...parsed.gemini },
          openai: { ...DEFAULT_MODEL_CONFIG.openai, ...parsed.openai },
          anthropic: { ...DEFAULT_MODEL_CONFIG.anthropic, ...parsed.anthropic },
        };
      }
    } catch { /* fall through */ }
    return DEFAULT_MODEL_CONFIG;
  });

  const [selectedModelId, setSelectedModelId] = useState(() => {
    try {
      return localStorage.getItem('selectedModelId') || "";
    } catch {
      return "";
    }
  });
  const [agentSwarmEnabled, setAgentSwarmEnabled] = useState(false);

  // Persist model config + selection on every change.
  React.useEffect(() => {
    try { localStorage.setItem('modelConfig', JSON.stringify(modelConfig)); } catch { /* ignore */ }
  }, [modelConfig]);
  React.useEffect(() => {
    try { localStorage.setItem('selectedModelId', selectedModelId); } catch { /* ignore */ }
  }, [selectedModelId]);

  // Dashboard top-level mode: Develop (hero → staging) vs Chat (in-dashboard ChatGPT-style thread)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [dashboardMode, setDashboardMode] = useState<'develop' | 'chat' | 'media'>('chat');
  const [chatResetKey, setChatResetKey] = useState(0);
  const [hasActiveChat, setHasActiveChat] = useState(false);
  const [isIncognito, setIsIncognito] = useState(false);

  const handleDashboardModeChange = (mode: 'develop' | 'chat' | 'media') => {
    setDashboardMode(mode);
  };

  const handleNewChat = () => {
    setChatResetKey((k) => k + 1);
    setHasActiveChat(false);
    setIsIncognito(false);
  };

  const handleIncognitoChat = () => {
    setChatResetKey((k) => k + 1);
    setHasActiveChat(false);
    setIsIncognito(true);
  };

  const navigate = useNavigate();
  const { user, userProfile, loading } = useAuth();
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Check if user needs onboarding
  React.useEffect(() => {
    if (user && userProfile && !userProfile.onboardingComplete) {
      setShowOnboarding(true);
    } else {
      setShowOnboarding(false);
    }
  }, [user, userProfile]);

  const handlePromptSubmit = (prompt: string, mode: string = 'ship', attachments?: any[]) => {
    if (!user) {
      navigate('/login');
      return;
    }
    // Mark that we're navigating to staging via React Router (not a page refresh)
    sessionStorage.setItem('staging-nav', 'true');
    const encodedPrompt = encodeURIComponent(prompt);
    navigate(`/project1?prompt=${encodedPrompt}&mode=${mode}`, { state: { initialAttachments: attachments } });
  };

  // Helper to open settings to Drive connector
  const openDriveSettings = () => {
    setSettingsInitialTab('connectors');
    setSettingsInitialConnector('drive');
    setIsSettingsOpen(true);
  };

  // Reset settings initial state when modal closes
  const handleSettingsClose = () => {
    setIsSettingsOpen(false);
    setSettingsInitialTab(undefined);
    setSettingsInitialConnector(undefined);
  };

  // Show loading screen while auth state is being determined
  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#030303]">
        <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  // Show onboarding for new users
  if (showOnboarding && user) {
    return <Onboarding onComplete={() => setShowOnboarding(false)} />;
  }

  return (
    <BackgroundProvider>
      <UserDataProvider>
        <LocalFSProvider>
          <Routes>
          <Route path="/" element={
          <>
            <SettingsModal 
              isOpen={isSettingsOpen} 
              onClose={handleSettingsClose} 
              modelConfig={modelConfig}
              setModelConfig={setModelConfig}
              initialTab={settingsInitialTab}
              initialConnector={settingsInitialConnector}
            />
            <DashboardLayout
              isSearchOpen={isSearchOpen}
              setIsSearchOpen={setIsSearchOpen}
              currentView={currentView}
              setCurrentView={setCurrentView}
              onSettingsClick={() => setIsSettingsOpen(true)}
              isAuthenticated={!!user}
              dashboardMode={dashboardMode}
              onModeChange={handleDashboardModeChange}
              onNewChat={handleNewChat}
              hasActiveChat={hasActiveChat}
              isIncognito={isIncognito}
              onIncognitoChat={handleIncognitoChat}
              isSidebarCollapsed={isSidebarCollapsed}
              setIsSidebarCollapsed={setIsSidebarCollapsed}
            >
              {currentView === 'home' ? (
                dashboardMode === 'chat' ? (
                  <DashboardChat
                    key={chatResetKey}
                    modelConfig={modelConfig}
                    selectedModelId={selectedModelId}
                    setSelectedModelId={setSelectedModelId}
                    isAuthenticated={!!user}
                    onAuthRequired={!user ? () => navigate('/login') : undefined}
                    agentSwarmEnabled={agentSwarmEnabled}
                    onSwarmToggle={setAgentSwarmEnabled}
                    onOpenDriveSettings={openDriveSettings}
                    isIncognito={isIncognito}
                    onChatStartedChange={setHasActiveChat}
                  />
                ) : dashboardMode === 'media' ? (
                  <div className="flex flex-col min-h-full" key="media">
                    <HeroSection
                      initialMode="design"
                      onPromptSubmit={(prompt) => {
                        if (!user) {
                           navigate('/login');
                           return;
                        }
                        sessionStorage.setItem('staging-nav', 'true');
                        navigate(`/media?prompt=${encodeURIComponent(prompt)}`);
                      }}
                      onProjectSelect={(projectId) => {
                        if (!user) {
                           navigate('/login');
                           return;
                        }
                        sessionStorage.setItem('staging-nav', 'true');
                        navigate(`/media?projectId=${encodeURIComponent(projectId)}`);
                      }}
                      modelConfig={modelConfig}
                      selectedModelId={selectedModelId}
                      setSelectedModelId={setSelectedModelId}
                      onAuthRequired={!user ? () => navigate('/login') : undefined}
                      isAuthenticated={!!user}
                      agentSwarmEnabled={agentSwarmEnabled}
                      onSwarmToggle={setAgentSwarmEnabled}
                      dashboardMode="media"
                      isSidebarCollapsed={isSidebarCollapsed}
                    />
                    {/* Only show BottomPanel (projects showcase) when authenticated */}
                    {user && (
                      <div className="pb-20">
                        <BottomPanel onOpenDriveSettings={openDriveSettings} />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col min-h-full" key="develop">
                    <HeroSection
                      onPromptSubmit={handlePromptSubmit}
                      modelConfig={modelConfig}
                      selectedModelId={selectedModelId}
                      setSelectedModelId={setSelectedModelId}
                      onAuthRequired={!user ? () => navigate('/login') : undefined}
                      isAuthenticated={!!user}
                      agentSwarmEnabled={agentSwarmEnabled}
                      onSwarmToggle={setAgentSwarmEnabled}
                      dashboardMode="develop"
                      isSidebarCollapsed={isSidebarCollapsed}
                    />
                    {/* Only show BottomPanel (projects showcase) when authenticated */}
                    {user && (
                      <div className="pb-20">
                        <BottomPanel onOpenDriveSettings={openDriveSettings} />
                      </div>
                    )}
                  </div>
                )
              ) : (
                <ProjectsPage view={currentView} onOpenDriveSettings={openDriveSettings} />
              )}
            </DashboardLayout>
          </>
        } />
        
        <Route path="/project1" element={
          <StagingRouteGuard>
            <div className="h-screen w-screen overflow-hidden bg-[#1c1c1c]">
              <SettingsModal
                isOpen={isSettingsOpen}
                onClose={() => { setIsSettingsOpen(false); setSettingsInitialTab(undefined); }}
                modelConfig={modelConfig}
                setModelConfig={setModelConfig}
                initialTab={settingsInitialTab}
              />
              <Suspense fallback={<div className="h-screen w-screen bg-[#1c1c1c] flex items-center justify-center text-white">Loading...</div>}>
                <StagingView
                  onSettingsClick={(tab?: string) => {
                    if (tab) setSettingsInitialTab(tab as any);
                    setIsSettingsOpen(true);
                  }}
                  modelConfig={modelConfig}
                  setModelConfig={setModelConfig}
                  selectedModelId={selectedModelId}
                  setSelectedModelId={setSelectedModelId}
                  agentSwarmEnabled={agentSwarmEnabled}
                  onSwarmToggle={setAgentSwarmEnabled}
                />
              </Suspense>
            </div>
          </StagingRouteGuard>
        } />

        <Route path="/media" element={
          <StagingRouteGuard>
            <div className="h-screen w-screen overflow-hidden bg-[#1c1c1c]">
              <Suspense fallback={<div className="h-screen w-screen bg-[#1c1c1c] flex items-center justify-center text-white">Loading...</div>}>
                <MediaView />
              </Suspense>
            </div>
          </StagingRouteGuard>
        } />

        <Route path="/login" element={<LoginPage />} />
        </Routes>
        </LocalFSProvider>
      </UserDataProvider>
    </BackgroundProvider>
  );
};

export default App;
