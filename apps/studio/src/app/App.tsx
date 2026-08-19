
import React, { useState, Suspense } from 'react';
import { useStore } from '@nanostores/react';
import { AUTO_MODEL } from '@willow/ai/models/auto-select';
import { Routes, Route, useNavigate, useSearchParams, Link, Navigate, useLocation } from 'react-router-dom';
import type { ViewType } from '../shell/sidebar/Sidebar';
import type { Notebook } from '@willow/notebooks/notebook-types';
import { StudioLayout } from '../shell/StudioLayout';
import { CodeWorkspaceSkeleton } from '@willow/code/CodeHomeSkeleton';
import { TopLoadingBar } from '@willow/ui/TopLoadingBar';
import { topLoadingReasons } from '@willow/ui/top-loading-store';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { SquarePen, Glasses } from 'lucide-react';
import { useAuth } from '@willow/auth/AuthContext';
import { STUDIO_SIDEBAR_EXPANDED_WIDTH } from '@willow/core/layout';
import { BackgroundProvider, useBackground } from '../shell/BackgroundContext';
import { ChatEmbeddingIndexer, SearchChatsPage } from '../shell/SearchChats';
import { UserDataProvider } from '@willow/auth/UserDataContext';
import { LocalFSProvider, useLocalFS } from '@willow/storage/local-fs/LocalFSContext';
import { migrateProjectKinds, rebuildMediaIndex } from '@willow/storage/media-storage';
import { useDrive } from '@willow/storage/adapters/use-drive';
import { mergeDriveProjectsIntoRegistry } from '@willow/storage/adapters/drive-discovery';
import { isProjectSaveBlocked, PROJECTS_UPDATED_EVENT, readProjectRegistry, writeProjectRegistry } from '@willow/projects/registry';
import { agentBuilderDraftFlush } from '@willow/agent-builder/agent-builder-store';
import { sparkLocation } from '@willow/spark/spark-store';
import { startNotebookChat } from '@willow/notebooks/notebook-chat-store';
import type { StudioExperience } from '@willow/core/types';
import { createDefaultProviderProfiles, normalizeProviderProfileState } from '@willow/ai/providers/profiles';
import {
  MODEL_CATALOG_UPDATED_EVENT,
  MODEL_CONFIG_STORAGE_KEY,
  extractModelCatalogSnapshot,
  mergeModelCatalogSnapshot,
  type ModelCatalogSnapshot,
} from './model-catalog-storage';

const settledFeatureFirstPaints = new Set<string>();
const FEATURE_FIRST_PAINT_SETTLE_MS = 350;

const FeatureFirstPaintGate: React.FC<{
  feature: 'agents' | 'media';
  children: React.ReactNode;
}> = ({ feature, children }) => {
  const [isReady, setIsReady] = useState(() => settledFeatureFirstPaints.has(feature));

  React.useLayoutEffect(() => {
    if (settledFeatureFirstPaints.has(feature)) return;

    const settleTimer = window.setTimeout(() => {
      settledFeatureFirstPaints.add(feature);
      setIsReady(true);
    }, FEATURE_FIRST_PAINT_SETTLE_MS);

    return () => {
      window.clearTimeout(settleTimer);
    };
  }, [feature]);

  return (
    <div
      className="h-full w-full"
      data-feature-first-paint={feature}
      aria-hidden={!isReady}
      style={{ visibility: isReady ? 'visible' : 'hidden' }}
    >
      {children}
    </div>
  );
};

// Lazy-load WorkbenchView to prevent WebContainer boot on login page
const WorkbenchView = React.lazy(() => import('@willow/code/WorkbenchView'));
const MediaView = React.lazy(() => import('@willow/media/MediaView'));
const DesignView = React.lazy(() => import('@willow/design/DesignView'));
const SparkWorkspace = React.lazy(() => import('@willow/spark/SparkWorkspace'));
const GemsView = React.lazy(() => import('@willow/gems/GemsView'));
const AllNotebooksPage = React.lazy(() =>
  import('@willow/notebooks/AllNotebooksPage').then((m) => ({ default: m.AllNotebooksPage })),
);
const NotebookCreatePage = React.lazy(() =>
  import('@willow/notebooks/NotebookCreatePage').then((m) => ({ default: m.NotebookCreatePage })),
);
/*
 * Willow's REAL composer, mounted on the notebook page.
 *
 * Gemini's notebook page mounts the same component its new-chat page does, so
 * this is deliberately the same `InputBar` rather than a notebook-specific copy —
 * model picker, dictation, attachments and submit all stay on one implementation.
 *
 * The import is hoisted into `loadComposer` so the notebook route can start it
 * itself. Everywhere else this chunk arrives on the back of `ChatView`, which
 * imports the composer directly; a cold load straight into `/notebook/<id>` never
 * mounts ChatView and so has no such carrier.
 */
const loadComposer = () => import('@willow/chat/composer/Composer');
const NotebookComposer = React.lazy(() => loadComposer().then((m) => ({ default: m.InputBar })));
/*
 * Both chunks are requested together.
 *
 * `NotebookComposer` is referenced only from inside `NotebookPage`'s render, so
 * left to itself the two downloads run in series: the page chunk lands, renders,
 * and only then asks for the composer. That waterfall is why the composer used to
 * appear a beat after the title and Past chats on a cold load. Starting it here
 * overlaps the two requests instead.
 *
 * Deliberately not awaited — the page must still paint on its own chunk alone,
 * rather than waiting on the larger composer bundle to arrive.
 */
const loadNotebookPage = () => import('@willow/notebooks/NotebookPage');
const NotebookPage = React.lazy(() => {
  void loadComposer();
  return loadNotebookPage().then((m) => ({ default: m.NotebookPage }));
});

/**
 * Map a pathname to the notebook view it selects, if any.
 *
 * One helper rather than three copies of the same `startsWith` ladder, because
 * the ladder has an ordering trap: `/notebooks/...` (the grid and the create
 * screen) and `/notebook/<id>` (one notebook) differ by a single character, so a
 * naive `startsWith('/notebook')` tested first swallows both. Gemini uses exactly
 * these paths, so they are matched rather than renamed.
 */
export const matchNotebookRoute = (
  pathname: string,
): { view: ViewType; notebookId?: string } | null => {
  if (pathname === '/notebooks/create') return { view: 'notebook-create' };
  if (pathname === '/notebooks' || pathname.startsWith('/notebooks/')) return { view: 'notebooks' };
  if (pathname.startsWith('/notebook/')) {
    const id = pathname.slice('/notebook/'.length).split('/')[0];
    return id ? { view: 'notebook', notebookId: decodeURIComponent(id) } : null;
  }
  return null;
};
/*
 * The app's initial view is the chat home screen, so everything this bundle
 * pulls in is dead weight on the cold path. Splitting the eager imports into
 * their own chunks means first paint waits on none of them.
 *
 *  - `ChatView` (chat home + all conversations) is the FIRST THING ON SCREEN.
 *    The boot shell already holds the view's shape, and the shell is not
 *    dismissed until React has actually painted, so a 500ms suspension here is
 *    invisible — the sidebar footer skeleton and the auth plumbing can start
 *    under the shell instead of after a 1.5MB parse. A `Suspense` at App level
 *    (below) restores it instantly after the first visit, and warm prefetch at
 *    idle covers the rest.
 *  - Media's `HeroSection` and `BottomPanel` ship to every chat home visitor;
 *    only Media mode renders them.
 *  - The settings tabs, the project browser and the login page have their own
 *    routes/mount points; login especially should not pay for the chat shell.
 *
 * `CodeWorkspaceSkeleton` is deliberately NOT split: it is tiny, and the Code
 * tab's real fallback renders it while the code chunk streams in.
 */
const ChatView = React.lazy(() => import('@willow/chat/ChatView'));
const HeroSection = React.lazy(() => import('@willow/media/MediaHome').then((m) => ({ default: m.HeroSection })));
const BottomPanel = React.lazy(() => import('@willow/media/MediaShowcase').then((m) => ({ default: m.BottomPanel })));
const SettingsModal = React.lazy(() => import('../settings/SettingsModal').then((m) => ({ default: m.SettingsModal })));
const PersonalIntelligenceTab = React.lazy(() =>
  import('../settings/tabs/personal-intelligence/PersonalIntelligenceTab').then((m) => ({ default: m.PersonalIntelligenceTab }))
);
const ActivityTab = React.lazy(() => import('../settings/tabs/activity/ActivityTab').then((m) => ({ default: m.ActivityTab })));
const SavedInfoTab = React.lazy(() => import('../settings/tabs/saved-info/SavedInfoTab').then((m) => ({ default: m.SavedInfoTab })));
const MemoryTab = React.lazy(() => import('../settings/tabs/memory/MemoryTab').then((m) => ({ default: m.MemoryTab })));
const ConnectedAppsTab = React.lazy(() =>
  import('../settings/tabs/connected-apps/ConnectedAppsTab').then((m) => ({ default: m.ConnectedAppsTab }))
);
const ProjectsPage = React.lazy(() => import('@willow/project-browser/ProjectsPage').then((m) => ({ default: m.ProjectsPage })));
const LoginPage = React.lazy(() => import('@willow/account/LoginPage'));
const Onboarding = React.lazy(() => import('@willow/onboarding/Onboarding').then((m) => ({ default: m.Onboarding })));
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
// Labs: the Code Beta surface. A fork of the Code tab above, running the
// vendored Codex harness. Lazy like every other sub-app, which also means its
// chunk — workbench, harness, vendored prompt — never ships to anyone who has
// not enabled the experiment.
const CodeBetaWorkspace = React.lazy(() =>
  import('@willow/code-beta/CodeHome').then(async (m) => {
    await m.preloadIdleImages();
    return { default: m.CodeWorkspace };
  })
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

/**
 * Reasons raised from *inside* the chat surface, as opposed to reasons that
 * describe moving between surfaces.
 *
 * `chat-suspense` is the Suspense fallback for ChatView's own chunk;
 * `chat-load:<chatId>` is ChatView reading a chat body. Both fire when the chat
 * surface is rebuilt for a brand-new empty thread, where there is nothing for the
 * user to wait on — see `silentChatSurfaceRef`. Everything else (`studio-mode`,
 * `studio-view`, `studio-experience`, the other `*-suspense` boundaries) is a
 * real transition and is never suppressed.
 */
const isChatSurfaceLoadingReason = (reason: string): boolean =>
  reason === 'chat-suspense' || reason.startsWith('chat-load:');

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
  const [currentView, setCurrentView] = useState<ViewType>(() => {
    if (location.pathname === '/search') return 'search';
    if (location.pathname === '/personalization-settings') return 'personal-intelligence';
    if (location.pathname === '/activity') return 'activity';
    if (location.pathname === '/saved-info') return 'saved-info';
    if (location.pathname === '/memory') return 'memory';
    if (location.pathname === '/connected-apps') return 'connected-apps';
    if (location.pathname === '/design') return 'design';
    if (location.pathname.startsWith('/gems')) return 'gems';
    const notebookRoute = matchNotebookRoute(location.pathname);
    if (notebookRoute) return notebookRoute.view;
    return 'home';
  });
  /**
   * Which notebook `/notebook/<id>` is pointing at.
   *
   * Derived from the URL rather than held as independent state, so a deep link,
   * a back/forward step, and a click from the sidebar all land on one source of
   * truth. `null` whenever the route is not a single notebook.
   */
  const activeNotebookId = React.useMemo(
    () => matchNotebookRoute(location.pathname)?.notebookId ?? null,
    [location.pathname],
  );
  /*
   * Swapping the rendered view is a TRANSITION, and that is what keeps the
   * content pane from going dark on a navigation.
   *
   * Every sub-app is a lazily-loaded chunk, so the first visit to one suspends
   * while its code downloads. As an urgent update that suspension commits
   * immediately: the outgoing page is already gone, the incoming one does not
   * exist yet, and the route's `Suspense` fallback — an empty div — is the only
   * thing left to paint. Marking the swap non-urgent instead lets React prepare
   * the new tree off-screen and hold the current one on screen until the new one
   * can be painted whole.
   *
   * Measured off Gemini opening a notebook (`tools/ui-research/captures/
   * notebooks/timeline.json`): its incoming page mounts 338ms after the click and
   * the outgoing one is not torn down until 564ms. The two overlap by ~226ms and
   * no frame in between is ever empty. This is that behaviour, said in React.
   */
  const [isViewPending, startViewTransition] = React.useTransition();
  const commitView = React.useCallback((next: ViewType) => {
    // Assigned rather than only set, so a navigation to anywhere else clears a
    // flag a previous home-bound change left behind.
    silentHomeArrivalRef.current = next === 'home';
    startViewTransition(() => setCurrentView(next));
  }, []);
  /*
   * The notebook the URL pointed at, held for as long as a swap takes.
   *
   * `activeNotebookId` is derived from the pathname, so it clears the instant a
   * navigation AWAY from a notebook begins — while `currentView` is still
   * `'notebook'`, because that update is the one being held. Rendering off the
   * live value alone would drop through to the projects branch for those frames,
   * which is the same dark flash arriving through another door.
   */
  const [heldNotebookId, setHeldNotebookId] = useState<string | null>(activeNotebookId);
  React.useEffect(() => {
    if (activeNotebookId) setHeldNotebookId(activeNotebookId);
  }, [activeNotebookId]);
  const [isTopLoading, setIsTopLoading] = useState(false);
  const topLoadingReasonsRef = React.useRef(new Set<string>());
  const topLoadingStartedAtRef = React.useRef(0);
  const topLoadingHideTimerRef = React.useRef<number | undefined>(undefined);
  /*
   * Up for the one frame in which the chat surface is torn down and rebuilt with
   * an empty thread — "New chat" and the temporary-chat toggle, both of which
   * bump `chatResetKey`.
   *
   * That rebuild is not a route transition. Nothing is being fetched that the
   * user is waiting on: the thread they asked for is empty by definition. But it
   * still remounts a lazily-loaded subtree and re-runs the chat surface's own
   * load effect, and either can raise a reason and flash the bar for the 280ms
   * minimum. So reasons raised from INSIDE the chat surface stay silent while
   * this is up.
   *
   * Deliberately scoped to those reasons. Arriving at New Chat from Code, Media
   * or Agents runs the same reset, but the mode/view change on the way in raises
   * `studio-mode`/`studio-view` — not chat-surface reasons — so that bar is
   * untouched. Same for opening a saved chat from Recents, which is a
   * `chat-load:` raised with no reset in flight.
   */
  const silentChatSurfaceRef = React.useRef(false);
  /*
   * Arriving at New chat raises no bar at all.
   *
   * Broader than `silentChatSurfaceRef` on purpose: that one silences the two
   * reasons the chat surface raises about itself, while this silences EVERY
   * reason for the length of the navigation. Landing on New chat otherwise
   * stacks up three of them — `studio-view` for the route, `studio-mode` for the
   * mode switch that rides along with it, and the chat surface's own load — so
   * suppressing them individually means finding all three and keeping them found.
   *
   * The work still happens; only the bar is withheld. Requested by name: the
   * destination is an empty thread, so there is nothing the user is waiting on.
   */
  const silentHomeArrivalRef = React.useRef(false);

  const startTopLoading = React.useCallback((reason: string) => {
    if (silentHomeArrivalRef.current) return;
    if (silentChatSurfaceRef.current && isChatSurfaceLoadingReason(reason)) return;
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

  // Mirror reasons raised from outside this tree (features/* cannot import from
  // apps/*, so ChatView reaches the bar through a nanostore) into the refcount
  // above. The store carries reasons only; the floor and the hide timer stay here
  // so external callers and App's own call sites share one policy.
  const externalTopLoadingReasons = useStore(topLoadingReasons);
  const mirroredTopLoadingRef = React.useRef<readonly string[]>([]);
  React.useEffect(() => {
    const previous = mirroredTopLoadingRef.current;
    mirroredTopLoadingRef.current = externalTopLoadingReasons;
    for (const reason of externalTopLoadingReasons) {
      if (!previous.includes(reason)) startTopLoading(reason);
    }
    for (const reason of previous) {
      if (!externalTopLoadingReasons.includes(reason)) finishTopLoading(reason);
    }
  }, [externalTopLoadingReasons, startTopLoading, finishTopLoading]);

  // Model Config State - Lifted for synchronization.
  // Persisted to localStorage so saved model presets & selection survive reload
  // (local-only, same policy as API keys — never sent to Willow servers).
  const DEFAULT_MODEL_CONFIG = {
    gemini: {
        model: 'gemini-3.7-flash',
        thinkingLevel: 3, // 3 = high thinking level (0=none, 1=low, 2=medium, 3=high)
        baseUrl: 'https://generativelanguage.googleapis.com',
        savedModels: [
          { id: 'default-flash-37', name: 'Gemini 3.7 Flash', thinkingLevel: 3, thinkingLabel: 'High', modelId: 'gemini-3.7-flash' },
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
        model: 'grok-4.6',
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
      // Not an id, on purpose. Personal Intelligence routes itself to the
      // cheapest capable model the user has actually added, and re-routes when
      // they add a cheaper or newer one. Naming a model here would pin every
      // install to one the user may hold no key for. A real id appears only once
      // the user picks one in Settings, and that pin is then permanent.
      personalIntelligence: AUTO_MODEL,
    },
    providerProfiles: createDefaultProviderProfiles({
      gemini: 'https://generativelanguage.googleapis.com',
      openai: 'https://api.openai.com/v1',
      anthropic: 'https://api.anthropic.com',
      moonshot: 'https://api.moonshot.cn/v1',
      spacexai: 'https://api.x.ai/v1',
      zhipuai: 'https://open.bigmodel.cn/api/paas/v4',
    }),
    resources: [],
    modelOrder: [] as string[],
  };

  const dedupeSavedModels = (models: any[] = []) => {
    const seen = new Set<string>();
    return models.filter(m => {
      const key = `${m.profileId || 'default'}:${m.modelId || m.id}`;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const [modelConfig, setModelConfig] = React.useState(() => {
    try {
      const raw = localStorage.getItem(MODEL_CONFIG_STORAGE_KEY);
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
          modelOrder: Array.isArray(parsed.modelOrder)
            ? parsed.modelOrder.filter((key: unknown): key is string => typeof key === 'string')
            : [],
          systemDefaults: {
            ...DEFAULT_MODEL_CONFIG.systemDefaults,
            ...(parsed.systemDefaults || {}),
            // Personal Intelligence shipped for a few hours with a hardcoded id
            // as its default. A stored copy of that id is not a choice the user
            // made, so it must not be read as one — it would pin them out of the
            // automatic routing they never opted out of.
            personalIntelligence: parsed.systemDefaults?.personalIntelligence === 'gemini-3.1-flash-lite'
              ? AUTO_MODEL
              : (parsed.systemDefaults?.personalIntelligence || AUTO_MODEL),
          },
          // Keep the persisted model-config shape consistent with the settings
          // and catalog code. Older builds wrote the normalized profiles under
          // `profiles`; accept that shape while migrating it to `providerProfiles`.
          ...(() => {
            const normalizedProfiles = normalizeProviderProfileState({
              profiles: Array.isArray(parsed.providerProfiles) ? parsed.providerProfiles : parsed.profiles,
              resources: parsed.resources,
            }, {
            gemini: 'https://generativelanguage.googleapis.com',
            openai: 'https://api.openai.com/v1',
            anthropic: 'https://api.anthropic.com',
            moonshot: 'https://api.moonshot.cn/v1',
            spacexai: 'https://api.x.ai/v1',
            zhipuai: 'https://open.bigmodel.cn/api/paas/v4',
            });
            return {
              providerProfiles: normalizedProfiles.profiles,
              resources: normalizedProfiles.resources,
            };
          })(),
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
    try { localStorage.setItem(MODEL_CONFIG_STORAGE_KEY, JSON.stringify(modelConfig)); } catch { /* ignore */ }
  }, [modelConfig]);
  React.useEffect(() => {
    const applySnapshot = (snapshot: ModelCatalogSnapshot) => {
      setModelConfig((current: any) => mergeModelCatalogSnapshot(current, snapshot));
    };
    const onCatalogUpdated = (event: Event) => {
      const snapshot = (event as CustomEvent<ModelCatalogSnapshot>).detail;
      if (snapshot) applySnapshot(snapshot);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== MODEL_CONFIG_STORAGE_KEY || !event.newValue) return;
      try {
        applySnapshot(extractModelCatalogSnapshot(JSON.parse(event.newValue)));
      } catch {
        // Ignore malformed writes from another tab.
      }
    };
    window.addEventListener(MODEL_CATALOG_UPDATED_EVENT, onCatalogUpdated);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(MODEL_CATALOG_UPDATED_EVENT, onCatalogUpdated);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
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
    silentChatSurfaceRef.current = true;
    setChatResetKey((k) => k + 1);
    setHasActiveChat(false);
    setIsIncognito(false);
  };

  const handleIncognitoChat = () => {
    silentChatSurfaceRef.current = true;
    setChatResetKey((k) => k + 1);
    setHasActiveChat(false);
    setIsIncognito(true);
  };

  /*
   * Stand the suppression down once the reset has finished landing.
   *
   * Not in this effect's body, because the two chat-surface reasons arrive at
   * different times. The Suspense fallback calls `startTopLoading` directly, so
   * `chat-suspense` lands in the reset commit itself (children's effects run
   * before this one). `chat-load:` goes through the module-level store instead —
   * ChatView writes the atom, the write re-renders App, and App's mirroring
   * effect converts it to a reason one commit LATER. A body-level clear would
   * already be down by then.
   *
   * One frame covers both and cannot swallow a real navigation: every reason this
   * predicate matches is raised by the chat surface's own mount, and reaching the
   * bar any other way takes a click, which is a later task.
   */
  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      silentChatSurfaceRef.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [chatResetKey]);

  const navigate = useNavigate();
  const viewChangeSequenceRef = React.useRef(0);
  const viewChangeIntentRef = React.useRef<ViewType | null>(null);
  const handleViewChange = React.useCallback(async (view: ViewType): Promise<boolean> => {
    if (view === currentView) return true;
    const sequence = ++viewChangeSequenceRef.current;
    viewChangeIntentRef.current = view;
    // Before the first `startTopLoading` below, which would otherwise raise the
    // bar for a home-bound change a beat before `commitView` could silence it.
    silentHomeArrivalRef.current = view === 'home';
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
    else if (view === 'search') navigate('/search');
    else if (view === 'personal-intelligence') navigate('/personalization-settings');
    else if (view === 'activity') navigate('/activity');
    else if (view === 'saved-info') navigate('/saved-info');
    else if (view === 'memory') navigate('/memory');
    else if (view === 'connected-apps') navigate('/connected-apps');
    else if (view === 'design') navigate('/design');
    else if (view === 'gems') navigate('/gems');
    else if (view === 'notebooks') navigate('/notebooks/view');
    else if (view === 'notebook-create') navigate('/notebooks/create');
    /*
     * 'notebook' is intentionally absent: it needs an id, so it is never reached
     * through `handleViewChange`. `openNotebook` navigates to `/notebook/<id>`
     * directly and the pathname sync below sets the view.
     */
    else if (
      searchParams.get('view') === 'agents' ||
      location.pathname === '/search' ||
      location.pathname === '/personalization-settings' ||
      location.pathname === '/saved-info' ||
      location.pathname === '/memory' ||
      location.pathname === '/connected-apps' ||
      location.pathname === '/design' ||
      location.pathname === '/gems' ||
      matchNotebookRoute(location.pathname) !== null
    ) {
      navigate('/', { replace: true });
    }
    commitView(view);
    return true;
  }, [commitView, currentView, finishTopLoading, navigate, searchParams, startTopLoading, location.pathname]);

  /**
   * Open one notebook.
   *
   * Separate from `handleViewChange` because that function's contract is
   * view-in, URL-out for views that have a fixed path, and a notebook's path
   * carries an id. Navigating is enough — the pathname sync sets `currentView`
   * and `activeNotebookId` reads the id back out of the URL.
   */
  const openNotebook = React.useCallback((notebookId: string) => {
    navigate(`/notebook/${encodeURIComponent(notebookId)}`);
  }, [navigate]);


  /**
   * Send the first message of a notebook chat.
   *
   * The notebook page cannot run the turn itself — streaming, persistence, title
   * generation and history all live in `ChatView`. So this queues the prompt plus
   * the notebook's grounding on `$notebookHandoff`, resets the chat surface to an
   * empty thread, and switches to it; `ChatView` picks the handoff up on mount.
   * See `notebook-chat-store.ts` for why the handoff carries a `consumed` flag
   * rather than being cleared by the reader.
   */
  const sendFromNotebook = React.useCallback(async (notebook: Notebook, prompt: string) => {
    if (!prompt.trim()) return;
    /*
     * ORDER MATTERS: reset and navigate FIRST, publish the handoff LAST.
     *
     * Setting it before the view change meant `ChatView` read it inside its own
     * mount, i.e. it started a turn while the surface was still coming up. The
     * turn then never finalised — the thinking indicator span forever, no error,
     * no reply, even though the request had already failed upstream. Publishing
     * after `handleViewChange` resolves means the handoff lands on a mounted,
     * settled ChatView, which is exactly the state a user typing into it is in.
     */
    handleNewChat();
    await handleViewChange('home');
    startNotebookChat(notebook, prompt);
  }, [handleViewChange]);

  const handleStudioExperienceChange = React.useCallback(async (experience: StudioExperience) => {
    if (experience === studioExperience && currentView === 'home') return;
    if (currentView !== 'home' && !(await handleViewChange('home'))) return;
    startTopLoading('studio-experience');
    setStudioExperience(experience);
    if (experience === 'chat') setStudioMode('chat');
  }, [currentView, studioExperience, handleViewChange, startTopLoading]);

  React.useEffect(() => {
    // If a programmatic view change is in flight, wait until the URL matches intent
    if (viewChangeIntentRef.current) {
      const intent = viewChangeIntentRef.current;
      const urlMatchesIntent =
        (intent === 'search' && location.pathname === '/search') ||
        (intent === 'personal-intelligence' && location.pathname === '/personalization-settings') ||
        (intent === 'activity' && location.pathname === '/activity') ||
        (intent === 'saved-info' && location.pathname === '/saved-info') ||
        (intent === 'memory' && location.pathname === '/memory') ||
        (intent === 'connected-apps' && location.pathname === '/connected-apps') ||
        (intent === 'design' && location.pathname === '/design') ||
        (intent === 'gems' && location.pathname.startsWith('/gems')) ||
        (intent === 'home' && location.pathname === '/');
      if (urlMatchesIntent) {
        viewChangeIntentRef.current = null;
      }
      return;
    }

    if (location.pathname === '/search') {
      if (currentView !== 'search') {
        commitView('search');
      }
    } else if (location.pathname === '/personalization-settings') {
      if (currentView !== 'personal-intelligence') {
        commitView('personal-intelligence');
      }
    } else if (location.pathname === '/activity') {
      if (currentView !== 'activity') {
        commitView('activity');
      }
    } else if (location.pathname === '/saved-info') {
      if (currentView !== 'saved-info') {
        commitView('saved-info');
      }
    } else if (location.pathname === '/memory') {
      if (currentView !== 'memory') {
        commitView('memory');
      }
    } else if (location.pathname === '/connected-apps') {
      if (currentView !== 'connected-apps') {
        commitView('connected-apps');
      }
    } else if (location.pathname === '/design') {
      if (currentView !== 'design') {
        commitView('design');
      }
    } else if (location.pathname.startsWith('/gems')) {
      if (currentView !== 'gems') {
        commitView('gems');
      }
    } else if (matchNotebookRoute(location.pathname)) {
      const next = matchNotebookRoute(location.pathname)!.view;
      if (currentView !== next) {
        commitView(next);
      }
    } else if (
      currentView === 'search' ||
      currentView === 'personal-intelligence' ||
      currentView === 'activity' ||
      currentView === 'saved-info' ||
      currentView === 'memory' ||
      currentView === 'connected-apps' ||
      currentView === 'design' ||
      currentView === 'gems' ||
      currentView === 'notebooks' ||
      currentView === 'notebook-create' ||
      currentView === 'notebook'
    ) {
      commitView('home');
    }
  }, [location.pathname, currentView, commitView]);

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
          commitView('agents');
        }
        return;
      }
      if (currentView !== 'agents') return;
      if (!user) {
        if (!cancelled && sequence === viewChangeSequenceRef.current) {
          startTopLoading('studio-view');
          commitView('home');
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
      if (!cancelled && sequence === viewChangeSequenceRef.current) commitView('home');
    };

    void syncViewFromUrl();
    return () => {
      cancelled = true;
    };
  }, [commitView, currentView, finishTopLoading, navigate, searchParams, startTopLoading, user]);

  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => finishTopLoading('studio-view'));
    return () => window.cancelAnimationFrame(frame);
  }, [currentView, finishTopLoading]);

  /*
   * Stand the New-chat suppression down once the arrival has landed.
   *
   * A frame after the commit, not inside it: the chat surface raises its own
   * reasons from effects that run in the same commit, and clearing in the body
   * would let those through — which is the bar this exists to prevent.
   *
   * Anywhere other than home clears it immediately, so a home-bound change that
   * never completed cannot leave the bar muted for the next navigation.
   */
  React.useEffect(() => {
    if (currentView !== 'home') {
      silentHomeArrivalRef.current = false;
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      silentHomeArrivalRef.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentView]);

  /*
   * The only feedback while a swap is held.
   *
   * The bar used to be raised by the route's `Suspense` fallback mounting. That
   * fallback no longer mounts, so a pending transition is now the one signal that
   * the click was heard — and a navigation the user cannot see the app react to
   * reads as a dead click, which is worse than the blank it replaced.
   */
  React.useEffect(() => {
    if (!isViewPending) return;
    startTopLoading('view-transition');
    return () => finishTopLoading('view-transition');
  }, [isViewPending, startTopLoading, finishTopLoading]);

  /*
   * Fetch the notebook route's chunk before anyone asks for it.
   *
   * Opening a notebook is the one common navigation that always paid for a
   * download. The chat surface is the boot view, so returning to it re-uses a
   * chunk that is already in memory and swaps instantly — but nothing loads the
   * notebook page until the click itself, and the route has no content to show
   * meanwhile, so the whole pane went dark for as long as the request took.
   * Gemini has no such gap, and the sidebar offers notebooks from every screen.
   *
   * At idle, so it competes with nothing the user is waiting on, and with a
   * timeout so a permanently busy tab still gets there. The cost is one small
   * chunk for a profile that never opens a notebook; the composer it pulls in
   * behind it is already resident on the chat surface.
   */
  React.useEffect(() => {
    let cancelled = false;
    const warm = () => {
      if (cancelled) return;
      void loadNotebookPage();
      void loadComposer();
    };

    const idle = window.requestIdleCallback;
    if (typeof idle === 'function') {
      const handle = idle(warm, { timeout: 4000 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback?.(handle);
      };
    }
    // Safari has no `requestIdleCallback`; a timer past first paint is close enough.
    const timer = window.setTimeout(warm, 2000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

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

  /*
   * Install the Connected Apps token sources, at boot.
   *
   * This is what tells Personal Intelligence which connections survived the
   * reload. `connectionsStore` remembers what the user connected to and is
   * persistent; the token behind it is not — Google gives a browser client no
   * refresh token, so its access token dies with the tab, and Spotify's durable
   * grant needs redeeming before it means anything. Installing the sources runs
   * that silent check, and the model's connector tools are built from its answer.
   *
   * It used to run only from the Connected Apps settings tab, which is the bug
   * this call fixes: a user who reloaded and went straight to the chat had every
   * connector marked unauthorized, so every connector tool was withheld until they
   * happened to open Settings.
   *
   * Imported dynamically, not at the top of this file. `@willow/personal` reaches
   * the profile store, the builder and every connector; a static import would put
   * all of it in the eager bundle that first paint waits on, for work that has no
   * deadline. The install is idempotent, so the effect re-running on an account
   * switch — and twice in development under StrictMode — costs nothing.
   *
   * `user?.email` is the login hint: it is what turns connecting into a single
   * Allow click for an already-signed-in Google account rather than an account
   * chooser. Not gated on `user` being present, because a signed-out user can
   * still hold connections, and the hint is only ever a hint.
   */
  React.useEffect(() => {
    let cancelled = false;
    void import('@willow/personal').then(({ initConnectorTokenSources }) => {
      if (cancelled) return;
      void initConnectorTokenSources({ loginHint: user?.email ?? undefined });
    });
    return () => {
      cancelled = true;
    };
  }, [user?.email]);

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

  /*
   * Splitting the settings modal only pays off if its chunk is never fetched on
   * the cold path, and `React.lazy` fetches on mount — not on `isOpen`. The
   * modal renders null while closed, so mounting it at boot would download the
   * whole settings bundle to display nothing. This latches on first open and
   * stays mounted afterwards, because the modal animates its own close and
   * unmounting it mid-transition would cut that animation off.
   */
  const [hasOpenedSettings, setHasOpenedSettings] = useState(false);
  React.useEffect(() => {
    if (isSettingsOpen) setHasOpenedSettings(true);
  }, [isSettingsOpen]);

  /*
   * NO full-screen spinner while auth resolves.
   *
   * This used to `return` a centred spinner on `loading`, which meant the entire
   * app — sidebar, composer, everything — waited on a Firebase session restore
   * plus a Firestore profile read before a single pixel of real UI existed. On a
   * cold load that spinner was the screen for most of the visible startup, and
   * it replaced the boot shell in `index.html` with a *worse* placeholder than
   * the one already on screen.
   *
   * Nothing below needs `user` to be resolved in order to render: the sidebar
   * skeletons its own account row off `loading`, the chat surface is local, and
   * the handful of account-only features gate themselves via `onAuthRequired`.
   * The one thing that does need it is onboarding, hence the `loading` guard
   * there — a signed-in first-run user must not see the shell flash before the
   * onboarding takes over.
   */

  // Show onboarding for new users
  if (!loading && showOnboarding && user) {
    return (
      <Suspense fallback={<div className="h-screen w-screen bg-[#0f0f0f]" aria-hidden="true" />}>
        <Onboarding onComplete={() => setShowOnboarding(false)} />
      </Suspense>
    );
  }

  const mainAppShell = (
    <>
      {/*
        * The bar is inset by the sidebar only while the sidebar is a visible
        * panel — which is to say, only while it is expanded.
        *
        * Expanded, the rail is `#1f1f1f` against the studio surface, so a bar
        * starting at its right edge lands on a real boundary. Collapsed, the rail
        * paints `var(--studio-surface)`, the same colour as the page behind it,
        * so there is no edge to start from: a 52px inset just left the bar
        * stopping short over unbroken background. Full width there instead.
        */}
      <TopLoadingBar
        active={isTopLoading}
        leftOffset={isSidebarHidden || isSidebarCollapsed ? 0 : STUDIO_SIDEBAR_EXPANDED_WIDTH}
        workspaceColor={userProfile?.workspaceColor}
      />
      {hasOpenedSettings && (
        <Suspense fallback={null}>
          <SettingsModal
            isOpen={isSettingsOpen}
            onClose={handleSettingsClose}
            modelConfig={modelConfig}
            setModelConfig={setModelConfig}
            initialTab={settingsInitialTab}
            initialConnector={settingsInitialConnector}
          />
        </Suspense>
      )}
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
        modelConfig={modelConfig}
        onSettingsClick={(tabId) => {
          if (tabId === 'intelligence') {
            handleViewChange('personal-intelligence');
          } else if (tabId === 'activity') {
            handleViewChange('activity');
          } else if (tabId === 'gems') {
            handleViewChange('gems');
          } else {
            if (tabId) setSettingsInitialTab(tabId as any);
            setIsSettingsOpen(true);
          }
        }}
        studioMode={studioMode}
        onModeChange={handleStudioModeChange}
        studioExperience={studioExperience}
        onStudioExperienceChange={handleStudioExperienceChange}
        onNewChat={handleNewChat}
        hasActiveChat={hasActiveChat}
        activeNotebookId={activeNotebookId}
        onOpenNotebook={openNotebook}
        isIncognito={isIncognito}
        onIncognitoChat={handleIncognitoChat}
        isSidebarCollapsed={isSidebarCollapsed}
        setIsSidebarCollapsed={setIsSidebarCollapsed}
        isSidebarHidden={isSidebarHidden}
      >
        {currentView === 'search' ? (
          <SearchChatsPage
            modelConfig={modelConfig}
            onOpenChat={() => {
              setStudioExperience('chat');
              setStudioMode('chat');
              void handleViewChange('home');
            }}
          />
        ) : currentView === 'agents' ? (
          <Suspense fallback={
            <StudioLoadingFallback reason="agents-suspense" onStart={startTopLoading} onFinish={finishTopLoading}>
              <div className="flex h-full w-full items-center justify-center bg-[#0f0f0f] text-sm text-[#888]">Loading Agents...</div>
            </StudioLoadingFallback>
          }>
            <FeatureFirstPaintGate feature="agents">
              <div className="h-full w-full">
                <AgentBuilderContent
                  isSidebarCollapsed={isSidebarCollapsed}
                  onClose={() => handleViewChange('home')}
                />
              </div>
            </FeatureFirstPaintGate>
          </Suspense>
        ) : currentView === 'design' ? (
          <Suspense fallback={
            <StudioLoadingFallback reason="design-suspense" onStart={startTopLoading} onFinish={finishTopLoading}>
              <div className="h-full w-full bg-[#0f0f0f]" />
            </StudioLoadingFallback>
          }>
            <DesignView />
          </Suspense>
        ) : currentView === 'home' ? (
          studioExperience === 'spark' ? (
            <Suspense fallback={
              <StudioLoadingFallback reason="spark-suspense" onStart={startTopLoading} onFinish={finishTopLoading}>
                <div className="flex h-full w-full items-center justify-center bg-[#0f0f0f] text-sm text-[#888]">Loading Spark...</div>
              </StudioLoadingFallback>
            }>
              <SparkWorkspace
                modelConfig={modelConfig}
                selectedModelId={selectedModelId}
                setSelectedModelId={setSelectedModelId}
              />
            </Suspense>
          ) : studioMode === 'chat' ? (
            /*
             * ChatView is the first thing the user lands on, and its chunk is
             * still fetching on the very first visit. While it suspends, keep
             * the main area empty so the sidebar skeletons + background show
             * through; once ChatView mounts it docks its composer with an empty
             * thread (its own loading state) and then settles to centre, so the
             * fallback and the component never fight over the same pixels.
             */
            <Suspense fallback={
              <StudioLoadingFallback reason="chat-suspense" onStart={startTopLoading} onFinish={finishTopLoading}>
                <div className="h-full w-full" />
              </StudioLoadingFallback>
            }>
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
                onNewChat={handleNewChat}
                workspaceColor={userProfile?.workspaceColor}
              />
            </Suspense>
          ) : studioMode === 'media' ? (
            <Suspense fallback={
              <StudioLoadingFallback reason="media-suspense" onStart={startTopLoading} onFinish={finishTopLoading}>
                <div className="flex h-full w-full items-center justify-center bg-transparent text-sm text-[#888]">Loading Media...</div>
              </StudioLoadingFallback>
          }>
              <FeatureFirstPaintGate feature="media">
                <div className="flex min-h-full flex-col" key="media">
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
              </FeatureFirstPaintGate>
            </Suspense>
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
        ) : currentView === 'code-beta' ? (
          <Suspense fallback={
            <StudioLoadingFallback reason="code-beta-suspense" onStart={startTopLoading} onFinish={finishTopLoading}>
              <CodeWorkspaceSkeleton />
            </StudioLoadingFallback>
          }>
            <CodeBetaWorkspace
              key={`code-beta-${chatResetKey}`}
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
        ) : currentView === 'personal-intelligence' ? (
          <Suspense fallback={
            <StudioLoadingFallback reason="settings-tab-suspense" onStart={startTopLoading} onFinish={finishTopLoading}>
              <div className="h-full w-full" />
            </StudioLoadingFallback>
          }>
            <PersonalIntelligenceTab />
          </Suspense>
        ) : currentView === 'activity' ? (
          <Suspense fallback={
            <StudioLoadingFallback reason="settings-tab-suspense" onStart={startTopLoading} onFinish={finishTopLoading}>
              <div className="h-full w-full" />
            </StudioLoadingFallback>
          }>
            <ActivityTab />
          </Suspense>
        ) : currentView === 'saved-info' ? (
          <Suspense fallback={
            <StudioLoadingFallback reason="settings-tab-suspense" onStart={startTopLoading} onFinish={finishTopLoading}>
              <div className="h-full w-full" />
            </StudioLoadingFallback>
          }>
            <SavedInfoTab />
          </Suspense>
        ) : currentView === 'memory' ? (
          <Suspense fallback={
            <StudioLoadingFallback reason="settings-tab-suspense" onStart={startTopLoading} onFinish={finishTopLoading}>
              <div className="h-full w-full" />
            </StudioLoadingFallback>
          }>
            <MemoryTab />
          </Suspense>
        ) : currentView === 'connected-apps' ? (
          <Suspense fallback={
            <StudioLoadingFallback reason="settings-tab-suspense" onStart={startTopLoading} onFinish={finishTopLoading}>
              <div className="h-full w-full" />
            </StudioLoadingFallback>
          }>
            <ConnectedAppsTab />
          </Suspense>
        ) : currentView === 'gems' ? (
          <Suspense fallback={<StudioLoadingFallback reason="gems-suspense" onStart={startTopLoading} onFinish={finishTopLoading}><div className="flex h-full w-full items-center justify-center bg-[#131314] text-sm text-[#888]">Loading Gems...</div></StudioLoadingFallback>}>
            <GemsView />
          </Suspense>
        ) : currentView === 'notebooks' ? (
          <Suspense fallback={<StudioLoadingFallback reason="notebooks-suspense" onStart={startTopLoading} onFinish={finishTopLoading}><div className="h-full w-full" /></StudioLoadingFallback>}>
            <AllNotebooksPage
              onOpenNotebook={openNotebook}
              onCreateNotebook={() => navigate('/notebooks/create?start=1')}
            />
          </Suspense>
        ) : currentView === 'notebook-create' ? (
          <Suspense fallback={<StudioLoadingFallback reason="notebooks-suspense" onStart={startTopLoading} onFinish={finishTopLoading}><div className="h-full w-full" /></StudioLoadingFallback>}>
            <NotebookCreatePage
              onCreated={openNotebook}
              onCancel={() => handleViewChange('notebooks')}
            />
          </Suspense>
        ) : currentView === 'notebook' && (activeNotebookId ?? heldNotebookId) ? (
          <Suspense fallback={<StudioLoadingFallback reason="notebooks-suspense" onStart={startTopLoading} onFinish={finishTopLoading}><div className="h-full w-full" /></StudioLoadingFallback>}>
            <NotebookPage
              notebookId={(activeNotebookId ?? heldNotebookId)!}
              /*
               * A notebook whose id no longer resolves — deleted here or in
               * another tab — falls back to the grid rather than rendering an
               * empty page the user cannot leave.
               */
              onMissing={() => handleViewChange('notebooks')}
              onOpenChat={() => { void handleViewChange('home'); }}
              renderComposer={(notebook) => (
                /*
                 * The fallback carries the composer's own silhouette — 64px tall,
                 * 32px radius, the same `#1e1f21` surface — so if the chunk is
                 * still in flight the slot reads as the composer filling in
                 * rather than an empty gap something pops into.
                 */
                <Suspense fallback={<div className="h-16 w-full rounded-[32px] bg-[#1e1f21]" />}>
                  <NotebookComposer
                    chatVariant
                    currentMode="chat"
                    onModeChange={() => {}}
                    modelConfig={modelConfig}
                    selectedModelId={selectedModelId}
                    setSelectedModelId={setSelectedModelId}
                    isAuthenticated={!!user}
                    onAuthRequired={() => setIsSettingsOpen(true)}
                    onSubmit={(prompt) => { void sendFromNotebook(notebook, prompt); }}
                  />
                </Suspense>
              )}
            />
          </Suspense>
        ) : (
          <Suspense fallback={
            <StudioLoadingFallback reason="projects-suspense" onStart={startTopLoading} onFinish={finishTopLoading}>
              <div className="h-full w-full" />
            </StudioLoadingFallback>
          }>
            <ProjectsPage view={currentView} onOpenDriveSettings={openDriveSettings} />
          </Suspense>
        )}
      </StudioLayout>
    </>
  );

  return (
    <BackgroundProvider>
      <UserDataProvider>
        <LocalFSProvider modelConfig={modelConfig}>
          <DriveProjectDiscovery />
          <ChatEmbeddingIndexer modelConfig={modelConfig} />
          <Routes>
           <Route path="/" element={mainAppShell} />
           <Route path="/search" element={mainAppShell} />
           <Route path="/personalization-settings" element={mainAppShell} />
           <Route path="/activity" element={mainAppShell} />
           <Route path="/saved-info" element={mainAppShell} />
           <Route path="/memory" element={mainAppShell} />
           <Route path="/connected-apps" element={mainAppShell} />
           <Route path="/design" element={mainAppShell} />
           <Route path="/gems" element={mainAppShell} />
           <Route path="/gems/create" element={mainAppShell} />
           {/* Gemini's own notebook paths, matched rather than renamed. */}
           <Route path="/notebooks" element={mainAppShell} />
           <Route path="/notebooks/view" element={mainAppShell} />
           <Route path="/notebooks/create" element={mainAppShell} />
           <Route path="/notebook/:notebookId" element={mainAppShell} />
           <Route path="/agents" element={user ? <Navigate to="/?view=agents" replace /> : <Navigate to="/login" replace />} />
        
        <Route path="/project1" element={
          <WorkbenchRouteGuard>
            <div className="h-screen w-screen overflow-hidden bg-[#0f0f0f]">
              {hasOpenedSettings && (
                <Suspense fallback={null}>
                  <SettingsModal
                    isOpen={isSettingsOpen}
                    onClose={() => { setIsSettingsOpen(false); setSettingsInitialTab(undefined); }}
                    modelConfig={modelConfig}
                    setModelConfig={setModelConfig}
                    initialTab={settingsInitialTab}
                  />
                </Suspense>
              )}
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

        <Route path="/login" element={
          <Suspense fallback={<div className="h-screen w-screen bg-[#0f0f0f]" aria-hidden="true" />}>
            <LoginPage />
          </Suspense>
        } />
        </Routes>
        </LocalFSProvider>
      </UserDataProvider>
    </BackgroundProvider>
  );
};

export default App;
