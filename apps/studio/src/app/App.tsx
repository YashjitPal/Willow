
import React, { useState, Suspense } from 'react';
import { useStore } from '@nanostores/react';
import { Routes, Route, useNavigate, useSearchParams, Link, Navigate, useLocation } from 'react-router-dom';
import type { ViewType } from '../shell/sidebar/Sidebar';
import { StudioLayout } from '../shell/StudioLayout';
import { HeroSection } from '@willow/media/MediaHome';
import { BottomPanel } from '@willow/media/MediaShowcase';
import { SettingsModal } from '../settings/SettingsModal';
import { PersonalIntelligenceTab } from '../settings/tabs/personal-intelligence/PersonalIntelligenceTab';
import { SavedInfoTab } from '../settings/tabs/saved-info/SavedInfoTab';
import { ProjectsPage } from '@willow/project-browser/ProjectsPage';
import { LoginPage } from '@willow/account/LoginPage';
import { Onboarding } from '@willow/onboarding/Onboarding';
import { ChatView } from '@willow/chat/ChatView';
import { CodeWorkspaceSkeleton } from '@willow/code/CodeHomeSkeleton';
import { TopLoadingBar } from '@willow/ui/TopLoadingBar';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { SquarePen, Glasses } from 'lucide-react';
import { useAuth } from '@willow/auth/AuthContext';
import { STUDIO_SIDEBAR_COLLAPSED_WIDTH, STUDIO_SIDEBAR_EXPANDED_WIDTH } from '@willow/core/layout';
import { BackgroundProvider, useBackground } from '../shell/BackgroundContext';
import { UserDataProvider } from '@willow/auth/UserDataContext';
import { LocalFSProvider, useLocalFS } from '@willow/storage/local-fs/LocalFSContext';
import { migrateProjectKinds, rebuildMediaIndex } from '@willow/storage/media-storage';
import { useDrive } from '@willow/storage/adapters/use-drive';
import { mergeDriveProjectsIntoRegistry } from '@willow/storage/adapters/drive-discovery';
import { isProjectSaveBlocked, PROJECTS_UPDATED_EVENT, readProjectRegistry, writeProjectRegistry } from '@willow/projects/registry';
import { agentBuilderDraftFlush } from '@willow/agent-builder/agent-builder-store';
import { sparkLocation } from '@willow/spark/spark-store';
import type { StudioExperience } from '@willow/core/types';

// Lazy-load WorkbenchView to prevent WebContainer boot on login page
const WorkbenchView = React.lazy(() => import('@willow/code/WorkbenchView'));
const MediaView = React.lazy(() => import('@willow/media/MediaView'));
const SparkWorkspace = React.lazy(() => import('@willow/spark/SparkWorkspace'));
const GemsView = React.lazy(() => import('@willow/gems/GemsView'));
// Lazy-load the Code tab so its chunk (sandpack workbench, card images, …)
// never ships while on Home; resolve only after the default card images are
// warmed so the bento grid appears fully formed (skeleton shows meanwhile).
const CodeWorkspace = React.lazy(() =>
  import('@willow/code/CodeHome').then(async (m) => {
    await m.preloadIdleImages();
    return { default: m.CodeWorkspace };
  })
);
const AgentBuilderContent = React.lazy(() =>
  import('@willow/agent-builder/AgentsWorkspace').then((module) => ({ default: module.AgentsWorkspace }))
);

const StudioLoadingFallback: React.FC<{
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

// Check for page refresh — used to redirect from the workbench back to the studio home
const getNavigationType = (): string => {
  const navEntries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
  return navEntries[0]?.type || 'navigate';
};

// Wrapper component that handles refresh redirect BEFORE WorkbenchView loads
// This prevents the visual glitch caused by WorkbenchView rendering then redirecting
const WorkbenchRouteGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [searchParams] = useSearchParams();
  // Check synchronously if this is a refresh that should redirect
  const [shouldRedirect] = React.useState(() => {
    const isRouterNav = sessionStorage.getItem('staging-nav');
    if (isRouterNav) {
      return false;
    }
    // A durable project id makes this a valid reopen, including a hard refresh.
    // Only transient prompt-only workbench routes still fall back to the studio home.
    return getNavigationType() === 'reload' && !searchParams.get('projectId');
  });

  React.useEffect(() => {
    sessionStorage.removeItem('staging-nav');
  }, []);

  // If refreshing while on the workbench, redirect to the studio home immediately
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
  const location = useLocation();
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

  // Studio top-level mode: Develop (hero → workbench) vs Chat (in-studio ChatGPT-style thread)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isSidebarHidden, setIsSidebarHidden] = useState(false);
  const [studioExperience, setStudioExperience] = useState<StudioExperience>('chat');
  const [studioMode, setStudioMode] = useState<'develop' | 'chat' | 'media'>(() => {
    const modeParam = searchParams.get('mode') || searchParams.get('tab');
    if (modeParam === 'media' || modeParam === 'develop' || modeParam === 'chat') {
      return modeParam;
    }
    return 'chat';
  });

  React.useEffect(() => {
    const modeParam = searchParams.get('mode') || searchParams.get('tab');
    if (modeParam === 'media' || modeParam === 'develop' || modeParam === 'chat') {
      setStudioExperience('chat');
      setStudioMode(modeParam);
    }
  }, [searchParams]);
  const [chatResetKey, setChatResetKey] = useState(0);
  const [hasActiveChat, setHasActiveChat] = useState(false);
  const [isIncognito, setIsIncognito] = useState(false);

  const sparkSidebarRestoreRef = React.useRef<boolean | null>(null);
  React.useEffect(() => {
    const narrowViewport = window.matchMedia('(max-width: 720px)').matches;
    const isSparkTaskDetail = studioExperience === 'spark' && activeSparkLocation.page === 'task';

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
  }, [activeSparkLocation.page, studioExperience, isSidebarCollapsed]);

  const handleStudioModeChange = (mode: 'develop' | 'chat' | 'media') => {
    if (studioExperience === 'chat' && mode === studioMode) return;
    startTopLoading('studio-mode');
    setStudioExperience('chat');
    setStudioMode(mode);
  };

  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => finishTopLoading('studio-mode'));
    return () => window.cancelAnimationFrame(frame);
  }, [studioExperience, studioMode, finishTopLoading]);

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
    startTopLoading('studio-view');
    if (currentView === 'agents' && view !== 'agents') {
      const flushDraft = agentBuilderDraftFlush.get();
      if (flushDraft && !(await flushDraft())) {
        if (sequence === viewChangeSequenceRef.current) {
          viewChangeIntentRef.current = null;
          finishTopLoading('studio-view');
        }
        return false;
      }
    }
    if (sequence !== viewChangeSequenceRef.current) return false;
    if (view === 'agents') navigate('/?view=agents');
    else if (view === 'personal-intelligence') navigate('/personalization-settings');
    else if (view === 'saved-info') navigate('/saved-info');
    else if (view === 'gems') navigate('/gems');
    else if (
      searchParams.get('view') === 'agents' ||
      location.pathname === '/personalization-settings' ||
      location.pathname === '/saved-info' ||
      location.pathname === '/gems'
    ) {
      navigate('/', { replace: true });
    }
    setCurrentView(view);
    return true;
  }, [currentView, finishTopLoading, navigate, searchParams, startTopLoading, location.pathname]);

  const handleStudioExperienceChange = React.useCallback(async (experience: StudioExperience) => {
    if (experience === studioExperience && currentView === 'home') return;
    if (currentView !== 'home' && !(await handleViewChange('home'))) return;
    startTopLoading('studio-experience');
    setStudioExperience(experience);
    if (experience === 'chat') setStudioMode('chat');
  }, [currentView, studioExperience, handleViewChange, startTopLoading]);

  React.useEffect(() => {
    if (location.pathname === '/personalization-settings') {
      if (currentView !== 'personal-intelligence') {
        setCurrentView('personal-intelligence');
      }
    } else if (location.pathname === '/saved-info') {
      if (currentView !== 'saved-info') {
        setCurrentView('saved-info');
      }
    } else if (location.pathname.startsWith('/gems')) {
      if (currentView !== 'gems') {
        setCurrentView('gems');
      }
    } else if (currentView === 'personal-intelligence' || currentView === 'saved-info' || currentView === 'gems') {
      setCurrentView('home');
    }
  }, [location.pathname, currentView]);

  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => finishTopLoading('studio-experience'));
    return () => window.cancelAnimationFrame(frame);
  }, [studioExperience, finishTopLoading]);
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
          startTopLoading('studio-view');
          setCurrentView('agents');
        }
        return;
      }
      if (currentView !== 'agents') return;
      if (!user) {
        if (!cancelled && sequence === viewChangeSequenceRef.current) {
          startTopLoading('studio-view');
          setCurrentView('home');
        }
        return;
      }

      startTopLoading('studio-view');
      const flushDraft = agentBuilderDraftFlush.get();
      if (flushDraft && !(await flushDraft())) {
        if (!cancelled && sequence === viewChangeSequenceRef.current) {
          navigate('/?view=agents', { replace: true });
          finishTopLoading('studio-view');
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
    const frame = window.requestAnimationFrame(() => finishTopLoading('studio-view'));
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
    // Mark that we're navigating to the workbench via React Router (not a page refresh).
    // The 'staging-nav' key keeps its legacy name on purpose: it is a live
    // sessionStorage contract read back in the refresh check above.
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

  const mainAppShell = (
    <>
      <TopLoadingBar
        active={isTopLoading}
        leftOffset={!user || isSidebarHidden ? 0 : (isSidebarCollapsed ? STUDIO_SIDEBAR_COLLAPSED_WIDTH : STUDIO_SIDEBAR_EXPANDED_WIDTH)}
      />
      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={handleSettingsClose} 
        modelConfig={modelConfig}
        setModelConfig={setModelConfig}
        initialTab={settingsInitialTab}
        initialConnector={settingsInitialConnector}
      />
      {!(currentView === 'home' && studioExperience === 'spark') && (
        <Suspense fallback={null}>
          <SparkWorkspace
            backgroundOnly
            modelConfig={modelConfig}
            selectedModelId={selectedModelId}
          />
        </Suspense>
      )}
      <StudioLayout
        isSearchOpen={isSearchOpen}
        setIsSearchOpen={setIsSearchOpen}
        currentView={currentView}
        setCurrentView={handleViewChange}
        onSettingsClick={(tabId) => {
          if (tabId === 'intelligence') {
            handleViewChange('personal-intelligence');
          } else if (tabId === 'gems') {
            handleViewChange('gems');
          } else {
            if (tabId) setSettingsInitialTab(tabId as any);
            setIsSettingsOpen(true);
          }
        }}
        isAuthenticated={!!user}
        studioMode={studioMode}
        onModeChange={handleStudioModeChange}
        studioExperience={studioExperience}
        onStudioExperienceChange={handleStudioExperienceChange}
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
            <StudioLoadingFallback reason="agents-suspense" onStart={startTopLoading} onFinish={finishTopLoading}>
              <div className="flex h-full w-full items-center justify-center bg-[#0f0f0f] text-sm text-[#888]">Loading Agents...</div>
            </StudioLoadingFallback>
          }>
            <div className="h-full w-full">
              <AgentBuilderContent
                isSidebarCollapsed={isSidebarCollapsed}
                onClose={() => handleViewChange('home')}
              />
            </div>
          </Suspense>
        ) : currentView === 'home' ? (
          studioExperience === 'spark' ? (
            <Suspense fallback={
              <StudioLoadingFallback reason="spark-suspense" onStart={startTopLoading} onFinish={finishTopLoading}>
                <div className="flex h-full w-full items-center justify-center bg-[#0f0f0f] text-sm text-[#888]">Loading Spark...</div>
              </StudioLoadingFallback>
            }>
              <SparkWorkspace modelConfig={modelConfig} selectedModelId={selectedModelId} />
            </Suspense>
          ) : studioMode === 'chat' ? (
            <ChatView
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
          ) : studioMode === 'media' ? (
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
                studioMode="media"
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
              <StudioLoadingFallback reason="code-suspense" onStart={startTopLoading} onFinish={finishTopLoading}>
                <CodeWorkspaceSkeleton />
              </StudioLoadingFallback>
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
        ) : currentView === 'personal-intelligence' ? (
          <PersonalIntelligenceTab />
        ) : currentView === 'saved-info' ? (
          <SavedInfoTab />
        ) : currentView === 'gems' ? (
          <Suspense fallback={<StudioLoadingFallback reason="gems-suspense" onStart={startTopLoading} onFinish={finishTopLoading}><div className="flex h-full w-full items-center justify-center bg-[#131314] text-sm text-[#888]">Loading Gems...</div></StudioLoadingFallback>}>
            <GemsView />
          </Suspense>
        ) : (
          <ProjectsPage view={currentView} onOpenDriveSettings={openDriveSettings} />
        )}
      </StudioLayout>
    </>
  );

  return (
    <BackgroundProvider>
      <UserDataProvider>
        <LocalFSProvider modelConfig={modelConfig}>
          <DriveProjectDiscovery />
          <Routes>
           <Route path="/" element={mainAppShell} />
           <Route path="/personalization-settings" element={mainAppShell} />
           <Route path="/saved-info" element={mainAppShell} />
           <Route path="/gems" element={mainAppShell} />
           <Route path="/gems/create" element={mainAppShell} />
           <Route path="/agents" element={user ? <Navigate to="/?view=agents" replace /> : <Navigate to="/login" replace />} />
        
        <Route path="/project1" element={
          <WorkbenchRouteGuard>
            <div className="h-screen w-screen overflow-hidden bg-[#0f0f0f]">
              <SettingsModal
                isOpen={isSettingsOpen}
                onClose={() => { setIsSettingsOpen(false); setSettingsInitialTab(undefined); }}
                modelConfig={modelConfig}
                setModelConfig={setModelConfig}
                initialTab={settingsInitialTab}
              />
              <Suspense fallback={<div className="h-screen w-screen bg-[#0f0f0f] flex items-center justify-center text-white">Loading...</div>}>
                <WorkbenchView
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
          </WorkbenchRouteGuard>
        } />

        <Route path="/media/*" element={
          <WorkbenchRouteGuard>
            <div className="h-screen w-screen overflow-hidden bg-[#0f0f0f]">
              <Suspense fallback={<div className="h-screen w-screen bg-[#0f0f0f] flex items-center justify-center text-white">Loading...</div>}>
                <MediaView />
              </Suspense>
            </div>
          </WorkbenchRouteGuard>
        } />

        <Route path="/login" element={<LoginPage />} />
        </Routes>
        </LocalFSProvider>
      </UserDataProvider>
    </BackgroundProvider>
  );
};

export default App;
