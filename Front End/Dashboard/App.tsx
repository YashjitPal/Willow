
import React, { useState, Suspense } from 'react';
import { useStore } from '@nanostores/react';
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
import { CodeWorkspaceSkeleton } from './components/CodeWorkspaceSkeleton';
import { TopLoadingBar } from './components/ui/TopLoadingBar';
import { MaterialSymbol } from './components/ui/MaterialSymbol';
import { SquarePen, Glasses } from 'lucide-react';
import { useAuth } from './context/AuthContext';
import { DASHBOARD_SIDEBAR_COLLAPSED_WIDTH, DASHBOARD_SIDEBAR_EXPANDED_WIDTH } from './lib/dashboard-layout';
import { BackgroundProvider, useBackground } from './context/BackgroundContext';
import { UserDataProvider } from './context/UserDataContext';
import { LocalFSProvider, useLocalFS } from './context/LocalFSContext';
import { migrateProjectKinds, rebuildMediaIndex } from './lib/mediaStorage';
import { useDrive } from './hooks/useDrive';
import { mergeDriveProjectsIntoRegistry } from './lib/driveProjectDiscovery';
import { isProjectSaveBlocked, PROJECTS_UPDATED_EVENT, readProjectRegistry, writeProjectRegistry } from './lib/projectStorage';
import { agentBuilderDraftFlush } from './lib/stores/agent-builder-store';
import { sparkLocation } from './lib/stores/spark-store';
import type { DashboardExperience } from './types';

// Lazy-load StagingView to prevent WebContainer boot on login page
const StagingView = React.lazy(() => import('./components/staging/StagingView'));
const MediaView = React.lazy(() => import('./components/media/MediaView'));
const SparkWorkspace = React.lazy(() => import('./components/spark/SparkWorkspace'));
// Lazy-load the Code tab so its chunk (sandpack workbench, card images, …)
// never ships while on Home; resolve only after the default card images are
// warmed so the bento grid appears fully formed (skeleton shows meanwhile).
const CodeWorkspace = React.lazy(() =>
  import('./components/CodeWorkspace').then(async (m) => {
    await m.preloadIdleImages();
    return { default: m.CodeWorkspace };
  })
);
const AgentBuilderContent = React.lazy(() =>
  import('./components/agents/AgentsWorkspace').then((module) => ({ default: module.AgentsWorkspace }))
);

const DashboardLoadingFallback: React.FC<{
  reason: string;
  onStart: (reason: string) => void;
  onFinish: (reason: string) => void;
  children: React.ReactNode;
}> = ({ reason, onStart, onFinish, children }) => {
  React.useEffect(() => {
    onStart(reason);
    return () => onFinish(reason);
  }, [onFinish, onStart, reason]);

  return <>{children}</>;
};

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
  dashboardExperience: DashboardExperience;
  onDashboardExperienceChange: (experience: DashboardExperience) => void;
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
  isAuthenticated,
  dashboardMode,
  onModeChange,
  dashboardExperience,
  onDashboardExperienceChange,
  onNewChat,
  hasActiveChat,
  isIncognito,
  onIncognitoChat,
  isSidebarCollapsed,
  setIsSidebarCollapsed,
  isSidebarHidden = false
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

  const isChatExperience = dashboardExperience === 'chat';
  const isChatOngoing = isChatExperience && (!!activeChatId || hasActiveChat);
  // Calculate effective background (non-authenticated users get 'lines')
  const effectiveBackground = isAuthenticated ? background : 'lines';
  const dashboardSurface = '#0f0f0f';
  
  return (
    <div
      className={`dashboard-layout dashboard-layout--${dashboardExperience} flex h-screen w-screen overflow-hidden bg-[var(--dashboard-surface)] text-white selection:bg-pink-500/30 relative`}
      style={{ '--dashboard-surface': dashboardSurface } as React.CSSProperties}
    >
      {/* Background rendered at root level ONLY for waves (to cover sidebar) */}
      {currentView === 'home' && isChatExperience && effectiveBackground === 'waves' && (
        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
            <BackgroundRenderer isAuthenticated={isAuthenticated} isSidebarCollapsed={isSidebarCollapsed} />
            <div className="absolute inset-0 z-[1] pointer-events-none opacity-[0.06] mix-blend-overlay" style={{backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.6' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='1'/%3E%3C/svg%3E")`}} />
            <div
              className="absolute inset-0 z-[2] pointer-events-none"
              style={{ background: 'radial-gradient(circle at center, transparent 30%, var(--dashboard-surface) 110%)' }}
            />
        </div>
      )}

      {/* Only show sidebar when authenticated */}
      {isAuthenticated && (
        <>
          {dashboardExperience === 'spark' && isSidebarCollapsed && !isSidebarHidden && (
            <button
              type="button"
              className="dashboard-sidebar-mobile-open"
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
            dashboardMode={dashboardMode}
            onModeChange={onModeChange}
            dashboardExperience={dashboardExperience}
            onDashboardExperienceChange={onDashboardExperienceChange}
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
            isHidden={isSidebarHidden}
          />
          {dashboardExperience === 'spark' && !isSidebarCollapsed && (
            <button
              type="button"
              className="dashboard-sidebar-mobile-scrim"
              aria-label="Close navigation"
              onClick={() => setIsSidebarCollapsed(true)}
            />
          )}
        </>
      )}
      
      {/* Show auth buttons when not authenticated */}
      {!isAuthenticated && <AuthButtons />}
      
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
        {/* Top-right: Temporary Chat button in Chat mode (Exact Gemini Web specs) */}
        {currentView === 'home' && isChatExperience && dashboardMode === 'chat' && !isChatOngoing && (
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
              className={`w-[36px] h-[36px] p-2 rounded-full flex items-center justify-center transition-colors ${
                isIncognito 
                  ? 'bg-[#e3e3e3]/[0.16] text-[#e3e3e3] hover:bg-[#e3e3e3]/[0.24]' 
                  : 'bg-transparent text-[#e3e3e3] hover:bg-[#e3e3e3]/[0.08]'
              }`}
            >
              <span 
                className="lumi-symbols text-[24px] leading-none select-none text-[#e3e3e3]"
                style={{ fontFamily: "'Luminous Symbols', 'Google Symbols', 'Material Symbols Rounded', sans-serif" }}
              >
                gemini_chat_temp
              </span>
            </button>
          </div>
        )}
        {/* Background rendered in content area for lines only (solid is just plain color) */}
        {currentView === 'home' && isChatExperience && effectiveBackground === 'lines' && (
          <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
              <BackgroundRenderer isAuthenticated={isAuthenticated} isSidebarCollapsed={isSidebarCollapsed} />
              <div className="absolute inset-0 z-[1] pointer-events-none opacity-[0.06] mix-blend-overlay" style={{backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.6' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='1'/%3E%3C/svg%3E")`}} />
              <div
                className="absolute inset-0 z-[2] pointer-events-none"
                style={{ background: 'radial-gradient(circle at center, transparent 30%, var(--dashboard-surface) 110%)' }}
              />
          </div>
        )}
        {/* Solid background: No overlays, just plain color from parent */}
        <main
          className={`flex-1 relative z-10 overflow-y-auto scroll-smooth flex flex-col ${
            isChatExperience ? '' : 'spark-dashboard-scroll'
          }`}
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
  const [searchParams] = useSearchParams();
  // Check synchronously if this is a refresh that should redirect
  const [shouldRedirect] = React.useState(() => {
    const isRouterNav = sessionStorage.getItem('staging-nav');
    if (isRouterNav) {
      return false;
    }
    // A durable project id makes this a valid reopen, including a hard refresh.
    // Only transient prompt-only staging routes still fall back to the dashboard.
    return getNavigationType() === 'reload' && !searchParams.get('projectId');
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

/** Make projects created on another device visible in the normal registry. */
const DriveProjectDiscovery: React.FC = () => {
  const { user } = useAuth();
  const { chatScopeId } = useLocalFS();
  const { isReady, listProjects } = useDrive();

  React.useEffect(() => {
    if (!user || !isReady || !chatScopeId.startsWith(`${user.uid}::`)) return;
    let cancelled = false;
    void listProjects().then((folders) => {
      if (cancelled) return;
      const current = readProjectRegistry();
      const { projects, changed } = mergeDriveProjectsIntoRegistry(current, folders, isProjectSaveBlocked);
      if (!changed) return;
      writeProjectRegistry(projects);
      window.dispatchEvent(new Event(PROJECTS_UPDATED_EVENT));
    });
    return () => { cancelled = true; };
  }, [chatScopeId, isReady, listProjects, user?.uid]);

  return null;
};

const App: React.FC = () => {
  const [searchParams] = useSearchParams();
  const activeSparkLocation = useStore(sparkLocation);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<'workspace' | 'people' | 'models' | 'cloud' | 'privacy' | 'account' | 'labs' | 'connectors' | 'github' | undefined>(undefined);
  const [settingsInitialConnector, setSettingsInitialConnector] = useState<string | null | undefined>(undefined);
  const [currentView, setCurrentView] = useState<ViewType>('home');
  const [isTopLoading, setIsTopLoading] = useState(false);
  const topLoadingReasonsRef = React.useRef(new Set<string>());
  const topLoadingStartedAtRef = React.useRef(0);
  const topLoadingHideTimerRef = React.useRef<number | undefined>(undefined);

  const startTopLoading = React.useCallback((reason: string) => {
    if (topLoadingHideTimerRef.current) {
      window.clearTimeout(topLoadingHideTimerRef.current);
      topLoadingHideTimerRef.current = undefined;
    }
    if (topLoadingReasonsRef.current.size === 0) {
      topLoadingStartedAtRef.current = performance.now();
      setIsTopLoading(true);
    }
    topLoadingReasonsRef.current.add(reason);
  }, []);

  const finishTopLoading = React.useCallback((reason: string) => {
    topLoadingReasonsRef.current.delete(reason);
    if (topLoadingReasonsRef.current.size > 0) return;

    const remaining = Math.max(0, 280 - (performance.now() - topLoadingStartedAtRef.current));
    if (topLoadingHideTimerRef.current) window.clearTimeout(topLoadingHideTimerRef.current);
    topLoadingHideTimerRef.current = window.setTimeout(() => {
      topLoadingHideTimerRef.current = undefined;
      if (topLoadingReasonsRef.current.size === 0) setIsTopLoading(false);
    }, remaining);
  }, []);

  React.useEffect(() => () => {
    if (topLoadingHideTimerRef.current) window.clearTimeout(topLoadingHideTimerRef.current);
  }, []);

  // Model Config State - Lifted for synchronization.
  // Persisted to localStorage so saved model presets & selection survive reload
  // (local-only, same policy as API keys — never sent to Willow servers).
  const DEFAULT_MODEL_CONFIG = {
    gemini: {
        model: 'gemini-3.6-flash',
        thinkingLevel: 3, // 3 = high thinking level (0=none, 1=low, 2=medium, 3=high)
        baseUrl: 'https://generativelanguage.googleapis.com',
        savedModels: [
          { id: 'default-flash-36', name: 'Gemini 3.6 Flash', thinkingLevel: 3, thinkingLabel: 'High', modelId: 'gemini-3.6-flash' },
          { id: 'default-flash-35-lite', name: 'Gemini 3.5 Flash Lite', thinkingLevel: 1, thinkingLabel: 'Low', modelId: 'gemini-3.5-flash-lite' },
          { id: 'default-pro-high', name: 'Gemini 3.1 Pro', thinkingLevel: 3, thinkingLabel: 'High', modelId: 'gemini-3.1-pro-preview' }
        ] as Array<{ id: string; name: string; thinkingLevel: number; thinkingLabel?: string; effortLabel?: string; modelId: string }>
    },
    openai: {
        model: 'gpt-5.6-sol',
        thinkingLevel: 2,
        baseUrl: 'https://api.openai.com/v1',
        savedModels: [] as Array<{ id: string; name: string; thinkingLevel: number; thinkingLabel?: string; effortLabel?: string; modelId: string }>
    },
    anthropic: {
        model: 'claude-sonnet-5',
        thinkingLevel: 2,
        baseUrl: 'https://api.anthropic.com',
        savedModels: [] as Array<{ id: string; name: string; thinkingLevel: number; thinkingLabel?: string; effortLabel?: string; modelId: string }>
    },
    moonshot: {
        model: 'kimi-k3',
        thinkingLevel: 0,
        baseUrl: 'https://api.moonshot.cn/v1',
        savedModels: [] as Array<{ id: string; name: string; thinkingLevel: number; thinkingLabel?: string; effortLabel?: string; modelId: string }>
    },
    spacexai: {
        model: 'grok-4.5',
        thinkingLevel: 0,
        baseUrl: 'https://api.x.ai/v1',
        savedModels: [] as Array<{ id: string; name: string; thinkingLevel: number; thinkingLabel?: string; effortLabel?: string; modelId: string }>
    },
    zhipuai: {
        model: 'glm-5.2',
        thinkingLevel: 0,
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        savedModels: [] as Array<{ id: string; name: string; thinkingLevel: number; thinkingLabel?: string; effortLabel?: string; modelId: string }>
    },
    systemDefaults: {
      chatRenaming: 'gemini-3.1-flash-lite',
      computerUse: 'claude-sonnet-4.5',
      transcription: 'gemini-3.5-flash-lite',
    }
  };

  const dedupeSavedModels = (models: any[] = []) => {
    const seen = new Set<string>();
    return models.filter(m => {
      const key = m.modelId || m.id;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const [modelConfig, setModelConfig] = React.useState(() => {
    try {
      const raw = localStorage.getItem('modelConfig');
      if (raw) {
        const parsed = JSON.parse(raw);
        // Merge per-provider so new fields/defaults aren't lost if the stored
        // shape is older than the current code.
        const gemini = { ...DEFAULT_MODEL_CONFIG.gemini, ...parsed.gemini };
        const openai = { ...DEFAULT_MODEL_CONFIG.openai, ...parsed.openai };
        const anthropic = { ...DEFAULT_MODEL_CONFIG.anthropic, ...parsed.anthropic };
        const moonshot = { ...DEFAULT_MODEL_CONFIG.moonshot, ...(parsed.moonshot || {}) };
        const spacexai = { ...DEFAULT_MODEL_CONFIG.spacexai, ...(parsed.spacexai || {}) };
        const zhipuai = { ...DEFAULT_MODEL_CONFIG.zhipuai, ...(parsed.zhipuai || {}) };

        return {
          gemini: { ...gemini, savedModels: dedupeSavedModels(gemini.savedModels) },
          openai: { ...openai, savedModels: dedupeSavedModels(openai.savedModels) },
          anthropic: { ...anthropic, savedModels: dedupeSavedModels(anthropic.savedModels) },
          moonshot: { ...moonshot, savedModels: dedupeSavedModels(moonshot.savedModels) },
          spacexai: { ...spacexai, savedModels: dedupeSavedModels(spacexai.savedModels) },
          zhipuai: { ...zhipuai, savedModels: dedupeSavedModels(zhipuai.savedModels) },
          systemDefaults: { ...DEFAULT_MODEL_CONFIG.systemDefaults, ...(parsed.systemDefaults || {}) },
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
  // Persist model config + selection on every change.
  React.useEffect(() => {
    try { localStorage.setItem('modelConfig', JSON.stringify(modelConfig)); } catch { /* ignore */ }
  }, [modelConfig]);
  React.useEffect(() => {
    try { localStorage.setItem('selectedModelId', selectedModelId); } catch { /* ignore */ }
  }, [selectedModelId]);

  // Dashboard top-level mode: Develop (hero → staging) vs Chat (in-dashboard ChatGPT-style thread)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isSidebarHidden, setIsSidebarHidden] = useState(false);
  const [dashboardExperience, setDashboardExperience] = useState<DashboardExperience>('chat');
  const [dashboardMode, setDashboardMode] = useState<'develop' | 'chat' | 'media'>(() => {
    const modeParam = searchParams.get('mode') || searchParams.get('tab');
    if (modeParam === 'media' || modeParam === 'develop' || modeParam === 'chat') {
      return modeParam;
    }
    return 'chat';
  });

  React.useEffect(() => {
    const modeParam = searchParams.get('mode') || searchParams.get('tab');
    if (modeParam === 'media' || modeParam === 'develop' || modeParam === 'chat') {
      setDashboardExperience('chat');
      setDashboardMode(modeParam);
    }
  }, [searchParams]);
  const [chatResetKey, setChatResetKey] = useState(0);
  const [hasActiveChat, setHasActiveChat] = useState(false);
  const [isIncognito, setIsIncognito] = useState(false);

  const sparkSidebarRestoreRef = React.useRef<boolean | null>(null);
  React.useEffect(() => {
    const narrowViewport = window.matchMedia('(max-width: 720px)').matches;
    const isSparkTaskDetail = dashboardExperience === 'spark' && activeSparkLocation.page === 'task';

    if (isSparkTaskDetail) {
      if (sparkSidebarRestoreRef.current === null) {
        sparkSidebarRestoreRef.current = isSidebarCollapsed;
      }
      if (!isSidebarCollapsed) setIsSidebarCollapsed(true);
      return;
    }

    if (sparkSidebarRestoreRef.current !== null) {
      const shouldRestoreCollapsed = sparkSidebarRestoreRef.current;
      sparkSidebarRestoreRef.current = null;
      setIsSidebarCollapsed(narrowViewport ? true : shouldRestoreCollapsed);
    }
  }, [activeSparkLocation.page, dashboardExperience, isSidebarCollapsed]);

  const handleDashboardModeChange = (mode: 'develop' | 'chat' | 'media') => {
    if (dashboardExperience === 'chat' && mode === dashboardMode) return;
    startTopLoading('dashboard-mode');
    setDashboardExperience('chat');
    setDashboardMode(mode);
  };

  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => finishTopLoading('dashboard-mode'));
    return () => window.cancelAnimationFrame(frame);
  }, [dashboardExperience, dashboardMode, finishTopLoading]);

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
  const viewChangeSequenceRef = React.useRef(0);
  const viewChangeIntentRef = React.useRef<ViewType | null>(null);
  const handleViewChange = React.useCallback(async (view: ViewType): Promise<boolean> => {
    if (view === currentView) return true;
    const sequence = ++viewChangeSequenceRef.current;
    viewChangeIntentRef.current = view;
    startTopLoading('dashboard-view');
    if (currentView === 'agents' && view !== 'agents') {
      const flushDraft = agentBuilderDraftFlush.get();
      if (flushDraft && !(await flushDraft())) {
        if (sequence === viewChangeSequenceRef.current) {
          viewChangeIntentRef.current = null;
          finishTopLoading('dashboard-view');
        }
        return false;
      }
    }
    if (sequence !== viewChangeSequenceRef.current) return false;
    if (view === 'agents') navigate('/?view=agents');
    else if (searchParams.get('view') === 'agents') navigate('/', { replace: true });
    setCurrentView(view);
    return true;
  }, [currentView, finishTopLoading, navigate, searchParams, startTopLoading]);

  const handleDashboardExperienceChange = React.useCallback(async (experience: DashboardExperience) => {
    if (experience === dashboardExperience && currentView === 'home') return;
    if (currentView !== 'home' && !(await handleViewChange('home'))) return;
    startTopLoading('dashboard-experience');
    setDashboardExperience(experience);
    if (experience === 'chat') setDashboardMode('chat');
  }, [currentView, dashboardExperience, handleViewChange, startTopLoading]);

  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => finishTopLoading('dashboard-experience'));
    return () => window.cancelAnimationFrame(frame);
  }, [dashboardExperience, finishTopLoading]);
  const { user, userProfile, loading } = useAuth();
  React.useEffect(() => {
    let cancelled = false;
    const sequence = ++viewChangeSequenceRef.current;
    const syncViewFromUrl = async () => {
      const intendedView = viewChangeIntentRef.current;
      if (intendedView) {
        const urlMatchesIntent = intendedView === 'agents'
          ? Boolean(user && searchParams.get('view') === 'agents')
          : searchParams.get('view') !== 'agents';
        if (currentView === intendedView && urlMatchesIntent) viewChangeIntentRef.current = null;
        return;
      }

      if (user && searchParams.get('view') === 'agents') {
        if (!cancelled && sequence === viewChangeSequenceRef.current && currentView !== 'agents') {
          startTopLoading('dashboard-view');
          setCurrentView('agents');
        }
        return;
      }
      if (currentView !== 'agents') return;
      if (!user) {
        if (!cancelled && sequence === viewChangeSequenceRef.current) {
          startTopLoading('dashboard-view');
          setCurrentView('home');
        }
        return;
      }

      startTopLoading('dashboard-view');
      const flushDraft = agentBuilderDraftFlush.get();
      if (flushDraft && !(await flushDraft())) {
        if (!cancelled && sequence === viewChangeSequenceRef.current) {
          navigate('/?view=agents', { replace: true });
          finishTopLoading('dashboard-view');
        }
        return;
      }
      if (!cancelled && sequence === viewChangeSequenceRef.current) setCurrentView('home');
    };

    void syncViewFromUrl();
    return () => {
      cancelled = true;
    };
  }, [currentView, finishTopLoading, navigate, searchParams, startTopLoading, user]);

  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => finishTopLoading('dashboard-view'));
    return () => window.cancelAnimationFrame(frame);
  }, [currentView, finishTopLoading]);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Check if user needs onboarding
  React.useEffect(() => {
    if (user && userProfile && !userProfile.onboardingComplete) {
      setShowOnboarding(true);
    } else {
      setShowOnboarding(false);
    }
  }, [user, userProfile]);

  // One-time backfill of project `kind` for legacy entries created before
  // media/code typing existed. Notifies project surfaces to re-read when done.
  React.useEffect(() => {
    void migrateProjectKinds().then((changed) => {
      if (changed) window.dispatchEvent(new Event('willow_projects_updated'));
    });
    // Build the realtime localStorage media index from existing IndexedDB media
    // so projects that already have media are reflected immediately.
    void rebuildMediaIndex();
  }, []);

  const handlePromptSubmit = (prompt: string, mode: string = 'ship', attachments?: any[]) => {
    if (!user) {
      navigate('/login');
      return;
    }
    // Mark that we're navigating to staging via React Router (not a page refresh)
    sessionStorage.setItem('staging-nav', 'true');
    const encodedPrompt = encodeURIComponent(prompt);
    navigate(`/project1?prompt=${encodedPrompt}&mode=${mode}`, { state: { initialAttachments: attachments, isNewProject: true } });
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
        <LocalFSProvider modelConfig={modelConfig}>
          <DriveProjectDiscovery />
          <Routes>
          <Route path="/" element={
          <>
            <TopLoadingBar
              active={isTopLoading}
              leftOffset={!user || isSidebarHidden ? 0 : (isSidebarCollapsed ? DASHBOARD_SIDEBAR_COLLAPSED_WIDTH : DASHBOARD_SIDEBAR_EXPANDED_WIDTH)}
            />
            <SettingsModal 
              isOpen={isSettingsOpen} 
              onClose={handleSettingsClose} 
              modelConfig={modelConfig}
              setModelConfig={setModelConfig}
              initialTab={settingsInitialTab}
              initialConnector={settingsInitialConnector}
            />
            {!(currentView === 'home' && dashboardExperience === 'spark') && (
              <Suspense fallback={null}>
                <SparkWorkspace
                  backgroundOnly
                  modelConfig={modelConfig}
                  selectedModelId={selectedModelId}
                />
              </Suspense>
            )}
            <DashboardLayout
              isSearchOpen={isSearchOpen}
              setIsSearchOpen={setIsSearchOpen}
              currentView={currentView}
              setCurrentView={handleViewChange}
              onSettingsClick={() => setIsSettingsOpen(true)}
              isAuthenticated={!!user}
              dashboardMode={dashboardMode}
              onModeChange={handleDashboardModeChange}
              dashboardExperience={dashboardExperience}
              onDashboardExperienceChange={handleDashboardExperienceChange}
              onNewChat={handleNewChat}
              hasActiveChat={hasActiveChat}
              isIncognito={isIncognito}
              onIncognitoChat={handleIncognitoChat}
              isSidebarCollapsed={isSidebarCollapsed}
              setIsSidebarCollapsed={setIsSidebarCollapsed}
              isSidebarHidden={isSidebarHidden}
            >
              {currentView === 'agents' ? (
                <Suspense fallback={
                  <DashboardLoadingFallback reason="agents-suspense" onStart={startTopLoading} onFinish={finishTopLoading}>
                    <div className="flex h-full w-full items-center justify-center bg-[#0f0f0f] text-sm text-[#888]">Loading Agents...</div>
                  </DashboardLoadingFallback>
                }>
                  <div className="h-full w-full">
                    <AgentBuilderContent
                      isSidebarCollapsed={isSidebarCollapsed}
                      onClose={() => handleViewChange('home')}
                    />
                  </div>
                </Suspense>
              ) : currentView === 'home' ? (
                dashboardExperience === 'spark' ? (
                  <Suspense fallback={
                    <DashboardLoadingFallback reason="spark-suspense" onStart={startTopLoading} onFinish={finishTopLoading}>
                      <div className="flex h-full w-full items-center justify-center bg-[#0f0f0f] text-sm text-[#888]">Loading Spark...</div>
                    </DashboardLoadingFallback>
                  }>
                    <SparkWorkspace modelConfig={modelConfig} selectedModelId={selectedModelId} />
                  </Suspense>
                ) : dashboardMode === 'chat' ? (
                  <DashboardChat
                    key={chatResetKey}
                    modelConfig={modelConfig}
                    selectedModelId={selectedModelId}
                    setSelectedModelId={setSelectedModelId}
                    isAuthenticated={!!user}
                    onAuthRequired={!user ? () => navigate('/login') : undefined}
                    onOpenDriveSettings={openDriveSettings}
                    isIncognito={isIncognito}
                    onChatStartedChange={setHasActiveChat}
                    isSidebarCollapsed={isSidebarCollapsed}
                    onCollapseSidebar={() => setIsSidebarCollapsed(true)}
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
                      onProjectSelect={(projectId, tempName) => {
                        if (!user) {
                           navigate('/login');
                           return;
                        }
                        sessionStorage.setItem('staging-nav', 'true');
                        const query = tempName 
                          ? `?projectId=${encodeURIComponent(projectId)}&tempName=${encodeURIComponent(tempName)}` 
                          : `?projectId=${encodeURIComponent(projectId)}`;
                        navigate(`/media${query}`);
                      }}
                      modelConfig={modelConfig}
                      selectedModelId={selectedModelId}
                      setSelectedModelId={setSelectedModelId}
                      onAuthRequired={!user ? () => navigate('/login') : undefined}
                      isAuthenticated={!!user}
                      dashboardMode="media"
                      isSidebarCollapsed={isSidebarCollapsed}
                    />
                    {/* Only show BottomPanel (projects showcase) when authenticated */}
                    {user && (
                      <div className="pb-20">
                        <BottomPanel onOpenDriveSettings={openDriveSettings} mode="media" />
                      </div>
                    )}
                  </div>
                ) : (
                  <Suspense fallback={
                    <DashboardLoadingFallback reason="code-suspense" onStart={startTopLoading} onFinish={finishTopLoading}>
                      <CodeWorkspaceSkeleton />
                    </DashboardLoadingFallback>
                  }>
                    <CodeWorkspace
                      key={`develop-${chatResetKey}`}
                      chatResetKey={chatResetKey}
                      modelConfig={modelConfig}
                      setModelConfig={setModelConfig}
                      selectedModelId={selectedModelId}
                      setSelectedModelId={setSelectedModelId}
                      isAuthenticated={!!user}
                      onAuthRequired={!user ? () => navigate('/login') : undefined}
                      onSettingsClick={(tab) => {
                        if (tab) setSettingsInitialTab(tab as any);
                        setIsSettingsOpen(true);
                      }}
                      isSidebarCollapsed={isSidebarCollapsed}
                      onWorkspaceActive={setIsSidebarHidden}
                    />
                  </Suspense>
                )
              ) : (
                <ProjectsPage view={currentView} onOpenDriveSettings={openDriveSettings} />
              )}
            </DashboardLayout>
          </>
        } />
        <Route path="/agents" element={user ? <Navigate to="/?view=agents" replace /> : <Navigate to="/login" replace />} />
        
        <Route path="/project1" element={
          <StagingRouteGuard>
            <div className="h-screen w-screen overflow-hidden bg-[#0f0f0f]">
              <SettingsModal
                isOpen={isSettingsOpen}
                onClose={() => { setIsSettingsOpen(false); setSettingsInitialTab(undefined); }}
                modelConfig={modelConfig}
                setModelConfig={setModelConfig}
                initialTab={settingsInitialTab}
              />
              <Suspense fallback={<div className="h-screen w-screen bg-[#0f0f0f] flex items-center justify-center text-white">Loading...</div>}>
                <StagingView
                  onSettingsClick={(tab?: string) => {
                    if (tab) setSettingsInitialTab(tab as any);
                    setIsSettingsOpen(true);
                  }}
                  modelConfig={modelConfig}
                  setModelConfig={setModelConfig}
                  selectedModelId={selectedModelId}
                  setSelectedModelId={setSelectedModelId}
                />
              </Suspense>
            </div>
          </StagingRouteGuard>
        } />

        <Route path="/media/*" element={
          <StagingRouteGuard>
            <div className="h-screen w-screen overflow-hidden bg-[#0f0f0f]">
              <Suspense fallback={<div className="h-screen w-screen bg-[#0f0f0f] flex items-center justify-center text-white">Loading...</div>}>
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
