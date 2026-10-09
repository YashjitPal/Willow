
import React, { useState, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@nanostores/react';
import { AUTO_MODEL } from '@willow/ai/models/auto-select';
import { Routes, Route, useNavigate, useSearchParams, Link, Navigate, useLocation } from 'react-router-dom';
import type { ViewType } from '../shell/sidebar/Sidebar';
import { ShellRouteSync } from './ShellRouteSync';
import { ShellRequestHandler } from './ShellRequestHandler';
import { isShellPath, parseShellPath } from './shell-routes';
import type { Notebook } from '@willow/notebooks/notebook-types';
import { StudioLayout } from '../shell/StudioLayout';
import { DesktopFrame } from '../shell/rail/DesktopFrame';
import { navigateRail } from '../shell/rail/rail-navigation';
import type { RailDestinationId } from '../shell/rail/AppRail';
import { $railReturns, noteRailPlace, noteSparkPlace } from '../shell/rail/rail-returns';
import { $harnessTab, closeHarnessTab } from '@willow/harness/harness-store';
import { CodeWorkspaceSkeleton } from '@willow/code/CodeHomeSkeleton';
import { TabLoading } from './TabLoading';
import { $codeScreenChats, $codeScreenProjects, $runningCodeScreens } from '@willow/code/workbench/code-turn-activity';
import { $codeResume, registerCodeTurnTakeover } from '@willow/code/workbench/code-turn-jobs';
import { atom, type WritableAtom } from 'nanostores';
import { designTurnRunning } from '@willow/design/design-store';
import { $mediaWorkRunning, MediaBackgroundContext } from '@willow/media/media-background';
import { $mediaResume, registerMediaWorkTakeover } from '@willow/media/media-jobs';
import { TopLoadingBar } from '@willow/ui/TopLoadingBar';
import { topLoadingReasons } from '@willow/ui/top-loading-store';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { SquarePen, Glasses } from 'lucide-react';
import { useAuth } from '@willow/auth/AuthContext';
import { STUDIO_SIDEBAR_EXPANDED_WIDTH } from '@willow/core/layout';
import { applyWorkspaceSync } from '@willow/core/workspace-sync';
import { BackgroundProvider, useBackground } from '../shell/BackgroundContext';
import { SettingsFileBridge } from './SettingsFileBridge';
import { PinnedChatsSettingsSection } from './PinnedChatsSettingsSection';
import { ShellActiveContext } from '../shell/shell-active';
import { ChatEmbeddingIndexer, SearchChatsPage } from '../shell/SearchChats';
import { UserDataProvider } from '@willow/auth/UserDataContext';
import { LocalFSProvider, useLocalFS } from '@willow/storage/local-fs/LocalFSContext';
import { clearCodeChatOpen, pendingCodeChatOpen, type CodeChatOpenRequest } from '@willow/storage/code-chat-open-store';
import { migrateProjectKinds, rebuildMediaIndex } from '@willow/storage/media-storage';
import { useDrive } from '@willow/storage/adapters/use-drive';
import { mergeDriveProjectsIntoRegistry } from '@willow/storage/adapters/drive-discovery';
import { isProjectSaveBlocked, PROJECTS_UPDATED_EVENT, readProjectRegistry, writeProjectRegistry } from '@willow/projects/registry';
import { agentBuilderDraftFlush } from '@willow/agent-builder/agent-builder-store';
import { sparkLocation } from '@willow/spark/spark-store';
import { $chatNotebookId, startNotebookChat } from '@willow/notebooks/notebook-chat-store';
import { $chatGemId } from '@willow/gems/gem-chat-store';
import { hydrateGems, resolveGem } from '@willow/gems/gems-store';
import { chatSelectionEpoch } from '@willow/storage/local-fs/chat-selection-store';
import type { StudioExperience } from '@willow/core/types';
import { experimentsStore, isExperimentEnabled } from '@willow/core/experiments-store';
import { collectSavedModelsInCatalogOrder, liveModelId, migrateRetiredSavedModels, migrateSelectedModelId } from '@willow/core/model-catalog';
import { isDesktopApp } from '@willow/core/desktop-bridge';
import { useThemeMode } from '@willow/core/theme-mode';
import { PROFILE_SCHEMA_VERSION, createDefaultProviderProfiles, normalizeProviderProfileState } from '@willow/ai/providers/profiles';
import { CHROME_NATIVE_TRANSCRIPTION_MODEL } from '@willow/ai/transcription';
import {
  MODEL_CATALOG_UPDATED_EVENT,
  MODEL_CONFIG_STORAGE_KEY,
  adoptModelCatalogSnapshot,
  createTabCatalogSync,
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
const WillowTV = React.lazy(() => import('@willow/media/tv/WillowTV'));
const DesignView = React.lazy(() => import('@willow/design/DesignView'));
const WaifuView = React.lazy(() => import('../waifu/WaifuView'));
const SparkWorkspace = React.lazy(() => import('@willow/spark/SparkWorkspace'));
/* The desktop pet: in the desktop app only, and loaded only there. */
const SparkPetsHost = React.lazy(() => import('@willow/spark/pets/SparkPetsHost'));
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
const NotebookModelPicker = React.lazy(() => import('@willow/chat/MobileModelPicker')
  .then((m) => ({ default: m.MobileModelPicker })));
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
 *
 * Not exported, deliberately: this file must export nothing but the App
 * component. Any other export makes React Refresh reject it, and then every edit
 * that reaches it — chat.ts, media-storage.ts, LocalFSContext… — fully reloads
 * every open tab instead of hot-swapping.
 */
const matchNotebookRoute = (
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
const ChatTurnTakeover = React.lazy(() => import('@willow/chat/ChatTurnTakeover'));
const HeroSection = React.lazy(() => import('@willow/media/MediaHome').then((m) => ({ default: m.HeroSection })));
const BottomPanel = React.lazy(() => import('@willow/media/MediaShowcase').then((m) => ({ default: m.BottomPanel })));
const SettingsModal = React.lazy(() => import('../settings/SettingsModal').then((m) => ({ default: m.SettingsModal })));
const PersonalIntelligenceTab = React.lazy(() =>
  import('../settings/tabs/personal-intelligence/PersonalIntelligenceTab').then((m) => ({ default: m.PersonalIntelligenceTab }))
);
const ActivityTab = React.lazy(() => import('../settings/tabs/activity/ActivityTab').then((m) => ({ default: m.ActivityTab })));
const SavedInfoTab = React.lazy(() => import('../settings/tabs/saved-info/SavedInfoTab').then((m) => ({ default: m.SavedInfoTab })));
const MemoryTab = React.lazy(() => import('../settings/tabs/memory/MemoryTab').then((m) => ({ default: m.MemoryTab })));
const ImportMemoryView = React.lazy(() => import('../import-memory/ImportMemoryView'));
const ConnectedAppsTab = React.lazy(() =>
  import('../settings/tabs/connected-apps/ConnectedAppsTab').then((m) => ({ default: m.ConnectedAppsTab }))
);
const CustomizeView = React.lazy(() => import('../customize/CustomizeView'));
const UsageLimitsView = React.lazy(() => import('../usage/UsageLimitsView'));
const SparkSettingsView = React.lazy(() => import('../spark-settings/SparkSettingsView'));
const ModelsApiPage = React.lazy(() =>
  import('../settings/tabs/models-api/ModelsApiPage').then((m) => ({ default: m.ModelsApiPage }))
);
const LabsPage = React.lazy(() => import('../settings/tabs/labs/LabsPage').then((m) => ({ default: m.LabsPage })));
const ProjectsPage = React.lazy(() => import('@willow/project-browser/ProjectsPage').then((m) => ({ default: m.ProjectsPage })));
const AuthModal = React.lazy(() => import('@willow/account/AuthModal').then((m) => ({ default: m.AuthModal })));
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

/*
 * A screen that is working stays mounted after the user leaves it, hidden, until
 * the work settles, plus a moment for its last save to start. Hidden rather than
 * `display: none`: Code's preview tools need a frame with a size. Opacity, not
 * just visibility, because a descendant can turn visibility back on; `inert` on
 * the host keeps every control out of reach and out of the tab order.
 */
const KEEP_ALIVE_GRACE_MS = 3000;
const BACKGROUND_SURFACE_STYLE: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  opacity: 0,
  visibility: 'hidden',
  pointerEvents: 'none',
  zIndex: -1,
  overflow: 'hidden',
};
const VISIBLE_SURFACE_STYLE: React.CSSProperties = { display: 'contents' };

/** The rail's tabs drawn inside the main shell, each kept mounted once opened. Spark's holds Bots too. */
type ShellTab = 'chat' | 'spark' | 'media' | 'customize';
const SHELL_TABS: readonly ShellTab[] = ['chat', 'spark', 'media', 'customize'];

const useKeepAlive = (busy: boolean): boolean => {
  const [lingering, setLingering] = React.useState(busy);
  React.useEffect(() => {
    if (busy) {
      setLingering(true);
      return undefined;
    }
    const timer = window.setTimeout(() => setLingering(false), KEEP_ALIVE_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [busy]);
  return busy || lingering;
};

/*
 * The Code home's place on screen. Its tree renders above the routes, so leaving
 * the main shell (for the Media editor) does not unmount a turn; this slot moves
 * the container it renders into into the main area while Code is on screen, and
 * back to the hidden parking spot when it goes. `moveBefore` keeps the preview
 * frame running across a move; a browser without it reloads the frame once.
 */
const moveInto = (parent: Element, node: Element) => {
  if (node.parentNode === parent) return;
  const { moveBefore } = parent as Element & { moveBefore?: (node: Node, child: Node | null) => void };
  if (moveBefore && node.isConnected && parent.isConnected) moveBefore.call(parent, node, null);
  else parent.appendChild(node);
};

const CodeHomeSlot: React.FC<{ container: HTMLElement; parking: React.RefObject<HTMLDivElement | null> }> = ({ container, parking }) => {
  const slotRef = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const slot = slotRef.current;
    if (!slot) return undefined;
    moveInto(slot, container);
    return () => {
      if (parking.current) moveInto(parking.current, container);
    };
  }, [container, parking]);
  return <div ref={slotRef} style={VISIBLE_SURFACE_STYLE} />;
};

/** Set while a guarded route's element is mounted, so a keeper above the routes shows its screen only once the guard let it through. */
const $workbenchRouteActive = atom(false);
const RouteMarker: React.FC<{ store: WritableAtom<boolean> }> = ({ store }) => {
  React.useLayoutEffect(() => {
    store.set(true);
    return () => store.set(false);
  }, [store]);
  return null;
};

type WorkbenchLocation = { pathname: string; search: string; hash: string; state: unknown; key: string };

/* The shell's names for Code's screens (`screenKey`): Code homes, and one per reopened project. */
const CODE_HOME_SCREEN = 'home';
const isCodeHomeScreen = (key: string) => key === CODE_HOME_SCREEN || key.startsWith(`${CODE_HOME_SCREEN}:`);
const projectScreenFor = (projectId: string) => `project:${projectId}`;

/**
 * A Code home: what the Code item opens. There is one, unless a chat was opened
 * while the one on show was still working — that chat gets a Code home of its
 * own, and the working one carries on, hidden, until it is done.
 */
interface CodeHomeEntry {
  key: string;
  /** What it renders into, wherever that currently sits (see `CodeHomeSlot`). */
  container: HTMLDivElement;
  /** A Recents chat for it to open, until it has. */
  open: CodeChatOpenRequest | null;
}

const makeCodeHome = (key: string, open: CodeChatOpenRequest | null = null): CodeHomeEntry => {
  const container = document.createElement('div');
  container.style.display = 'contents';
  return { key, container, open };
};

/** The list with one Code home moved last, which is the one on show. */
const showCodeHome = (homes: CodeHomeEntry[], key: string): CodeHomeEntry[] => {
  const home = homes.find((entry) => entry.key === key);
  return !home || home === homes[homes.length - 1] ? homes : [...homes.filter((entry) => entry !== home), home];
};
const projectScreenAt = (search: string) => projectScreenFor(new URLSearchParams(search).get('projectId') ?? search);

/** The Code screens mounted in this tab, which an inherited turn must not open over. */
type CodeTakeoverGate = { homeMounted: boolean; projectScreens: ReadonlySet<string> };

/**
 * Lets this tab carry on Code turns a closed tab was running, in a screen of
 * their own: never over the Code home or a project already open here, which
 * may be the user's. Renders nothing.
 */
const CodeTurnTakeover: React.FC<{ gate: React.MutableRefObject<CodeTakeoverGate> }> = ({ gate }) => {
  const { chatScopeId } = useLocalFS();
  const scopeRef = React.useRef(chatScopeId);
  scopeRef.current = chatScopeId;
  React.useEffect(() => registerCodeTurnTakeover((job) => {
    if (job.scopeId !== (scopeRef.current || 'guest')) return false;
    const { place } = job.payload;
    if (place.target === 'chat') return !gate.current.homeMounted;
    return !gate.current.projectScreens.has(projectScreenFor(place.projectId))
      && !Object.values($codeScreenProjects.get()).includes(place.projectName);
  }), [gate]);
  return null;
};

/** `useKeepAlive` for a set of screens: each busy one, and each for a moment after it stops. */
const useKeepAliveKeys = (busy: readonly string[]): ReadonlySet<string> => {
  const releasedAtRef = React.useRef(new Map<string, number>());
  const lastBusyRef = React.useRef<readonly string[]>([]);
  const [, wake] = React.useReducer((count: number) => count + 1, 0);
  const released = releasedAtRef.current;
  const now = Date.now();
  for (const key of lastBusyRef.current) if (!busy.includes(key) && !released.has(key)) released.set(key, now);
  for (const key of busy) released.delete(key);
  lastBusyRef.current = busy;
  for (const [key, at] of released) if (now - at >= KEEP_ALIVE_GRACE_MS) released.delete(key);
  const nextExpiry = released.size > 0 ? Math.min(...released.values()) + KEEP_ALIVE_GRACE_MS : null;
  React.useEffect(() => {
    if (nextExpiry === null) return undefined;
    const timer = window.setTimeout(wake, Math.max(0, nextExpiry - Date.now()));
    return () => window.clearTimeout(timer);
  }, [nextExpiry]);
  return new Set([...busy, ...released.keys()]);
};

interface CodeProjectScreensProps {
  gate: React.MutableRefObject<CodeTakeoverGate>;
  /** Shows the Code home that already has a project open. */
  onOpenCodeHome: (screenKey: string) => void;
  onSettingsClick: (tab?: string) => void;
  modelConfig: any;
  setModelConfig: React.Dispatch<React.SetStateAction<any>>;
  selectedModelId: string;
  setSelectedModelId: (id: string) => void;
}

/*
 * Reopened Code projects, above the routes for the same reason as Media: one
 * screen per project, each against its own last location. The one at
 * `/project1` is on show; any other one stays mounted, hidden, while its turn
 * runs, and a turn inherited from a closed tab opens its project here, hidden.
 * Insertion order is DOM order, so a screen never moves, which would reload its
 * preview.
 */
const CodeProjectScreens: React.FC<CodeProjectScreensProps> = ({ gate, onOpenCodeHome, ...workbenchProps }) => {
  const location = useLocation();
  const routeActive = useStore($workbenchRouteActive);
  const running = useStore($runningCodeScreens);
  const resume = useStore($codeResume);
  const savingInto = useStore($codeScreenProjects);

  const requested = location.pathname === '/project1' && routeActive ? projectScreenAt(location.search) : null;
  // A project the Code home is working on opens there: two screens would write one folder.
  const requestedName = React.useMemo(() => {
    const projectId = requested ? new URLSearchParams(location.search).get('projectId') : null;
    return projectId ? readProjectRegistry().find((project) => project.id === projectId)?.name ?? null : null;
  }, [requested, location.search]);
  const homeWithProject = requestedName === null
    ? null
    : Object.entries(savingInto).find(([key, name]) => isCodeHomeScreen(key) && name === requestedName)?.[0] ?? null;
  const visible = homeWithProject ? null : requested;
  const openCodeHomeRef = React.useRef(onOpenCodeHome);
  openCodeHomeRef.current = onOpenCodeHome;
  React.useEffect(() => {
    if (homeWithProject) openCodeHomeRef.current(homeWithProject);
  }, [homeWithProject]);

  const [locations] = useState(() => new Map<string, WorkbenchLocation>());
  if (visible) locations.set(visible, location);
  const resumePlace = resume?.job.payload.place;
  const resumeProject = resumePlace?.target === 'project' ? resumePlace : null;
  const resuming = resumeProject ? projectScreenFor(resumeProject.projectId) : null;
  if (resume && resumeProject && resuming && !locations.has(resuming)) {
    locations.set(resuming, {
      pathname: '/project1',
      search: `?projectId=${encodeURIComponent(resumeProject.projectId)}`,
      hash: '',
      state: null,
      key: `code-resume-${resume.job.id}`,
    });
  }
  const busy = running.filter((key) => locations.has(key));
  // A project left for another of the rail's places waits there as it was (rail-returns.ts).
  const codeReturn = useStore($railReturns).code;
  const leftOpen = codeReturn ? projectScreenAt(new URL(codeReturn, window.location.origin).search) : null;
  const kept = useKeepAliveKeys([
    ...busy,
    ...(resuming && !busy.includes(resuming) ? [resuming] : []),
    ...(leftOpen && leftOpen !== resuming && !busy.includes(leftOpen) && locations.has(leftOpen) ? [leftOpen] : []),
  ]);
  for (const key of [...locations.keys()]) {
    if (key !== visible && !kept.has(key)) locations.delete(key);
  }
  gate.current.projectScreens = new Set(locations.keys());

  return (
    <>
      {[...locations].map(([screenKey, shown]) => {
        const isOnShow = screenKey === visible;
        return (
          <div
            key={screenKey}
            className={isOnShow ? 'willow-frame-fill fixed inset-0 h-screen w-screen overflow-hidden bg-[#0f0f0f]' : undefined}
            style={isOnShow ? undefined : BACKGROUND_SURFACE_STYLE}
            inert={!isOnShow}
            aria-hidden={isOnShow ? undefined : true}
          >
            <Suspense fallback={<TabLoading className="h-screen w-screen" />}>
              <Routes location={shown}>
                <Route
                  path="/project1"
                  element={<WorkbenchView screenKey={screenKey} isOnShow={isOnShow} {...workbenchProps} />}
                />
              </Routes>
            </Suspense>
          </div>
        );
      })}
    </>
  );
};

/** The first project to open when `/media` names none, or null to open the empty editor. */
const defaultMediaProjectId = (): string | null => {
  try {
    const projects = readProjectRegistry() as any[];
    return projects.length > 0 ? projects[0].id : null;
  } catch {
    return null;
  }
};

const MediaRouteRedirect: React.FC = () => {
  const [searchParams] = useSearchParams();
  const { pathname } = useLocation();
  const fallback = searchParams.get('projectId') ? null : defaultMediaProjectId();
  if (!fallback) return null;
  // The same page of Media (/media/tools, a tool, a gallery tab), now naming a project.
  const next = new URLSearchParams(searchParams);
  next.set('projectId', fallback);
  return <Navigate to={{ pathname, search: `?${next.toString()}` }} replace />;
};

/*
 * The Media editor, outside the routes so leaving `/media` while it works keeps
 * the same instance alive. While hidden it is rendered against the last Media
 * location: its hooks would otherwise read the studio's URL, find no project,
 * and reset the very project that is still generating.
 */
const MediaKeepAlive: React.FC<{ onOpenSettings: (tab?: 'models') => void; modelConfig: unknown }> = ({ onOpenSettings, modelConfig }) => {
  const location = useLocation();
  // Work inherited from a closed tab opens its project here, hidden.
  const resume = useStore($mediaResume);
  // A project left for another of the rail's places waits there as it was (rail-returns.ts).
  const leftOpen = useStore($railReturns).media !== null;
  const keepAlive = useKeepAlive(useStore($mediaWorkRunning) || resume !== null || leftOpen);
  const isOnMedia = location.pathname.startsWith('/media')
    && (new URLSearchParams(location.search).has('projectId') || !defaultMediaProjectId());
  const lastMediaLocationRef = React.useRef<WorkbenchLocation | null>(null);
  if (isOnMedia) {
    lastMediaLocationRef.current = location;
  } else if (resume && lastMediaLocationRef.current?.key !== `media-resume-${resume.job.id}`) {
    lastMediaLocationRef.current = {
      pathname: '/media',
      search: `?projectId=${encodeURIComponent(resume.job.payload.projectId)}`,
      hash: '',
      state: null,
      key: `media-resume-${resume.job.id}`,
    };
  }
  const shown = isOnMedia ? location : keepAlive ? lastMediaLocationRef.current : null;
  // The editor's loading page is light in the light theme, so what stands before it is too.
  const { isLight } = useThemeMode();

  // Only while no editor is open in this tab: it holds one project at a time.
  const { chatScopeId } = useLocalFS();
  const gateRef = React.useRef({ mounted: false, scopeId: chatScopeId });
  gateRef.current = { mounted: shown !== null, scopeId: chatScopeId };
  React.useEffect(() => registerMediaWorkTakeover((job) =>
    job.scopeId === (gateRef.current.scopeId || 'guest') && !gateRef.current.mounted), []);

  if (!shown) return null;
  const projectId = new URLSearchParams(shown.search).get('projectId');

  return (
    <MediaBackgroundContext.Provider value={!isOnMedia}>
      <div
        className={isOnMedia ? 'willow-frame-fill fixed inset-0 h-screen w-screen overflow-hidden bg-[#000000]' : undefined}
        style={isOnMedia ? undefined : BACKGROUND_SURFACE_STYLE}
        inert={!isOnMedia}
        aria-hidden={isOnMedia ? undefined : true}
      >
        <Suspense fallback={<div className={`h-screen w-screen ${isLight ? 'bg-white' : 'bg-[#000000]'}`} />}>
          <Routes location={shown}>
            <Route
              path="/media/*"
              element={<MediaView key={projectId || 'empty'} onOpenSettings={onOpenSettings} modelConfig={modelConfig} />}
            />
          </Routes>
        </Suspense>
      </div>
    </MediaBackgroundContext.Provider>
  );
};

/*
 * The main shell, kept mounted across the screens outside it — a Media or Code project, Willow TV —
 * as a hidden layer rendered against its own last address, as the Media editor is beside it: its
 * tabs are then as the user left them when they come back, rather than built again. Hidden, `inert`
 * takes it out of reach, what listens on the window for files or Escape checks for that, and
 * `ShellActiveContext` hands the strip's menus and Ask Willow to the frame on show.
 */
const ShellKeepAlive: React.FC<{ onShow: boolean; children: React.ReactNode }> = ({ onShow, children }) => {
  const location = useLocation();
  const lastShellLocationRef = React.useRef<WorkbenchLocation | null>(null);
  if (onShow) lastShellLocationRef.current = location;
  const shown = onShow ? location : lastShellLocationRef.current;
  if (!shown) return null;
  return (
    <ShellActiveContext.Provider value={onShow}>
      <div
        style={onShow ? VISIBLE_SURFACE_STYLE : BACKGROUND_SURFACE_STYLE}
        inert={!onShow}
        aria-hidden={onShow ? undefined : true}
      >
        <Routes location={shown}>
          <Route path="*" element={children} />
        </Routes>
      </div>
    </ShellActiveContext.Provider>
  );
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
  /*
   * Agents and Design are unfinished surfaces, hidden until switched on in
   * Settings > Labs. The Sidebar hides their rows off the same flags; these
   * gates are what stop `/design` and `/?view=agents` being reachable anyway.
   */
  const experiments = useStore(experimentsStore);
  const isDesignEnabled = experiments['design-surface'];
  const isAgentsEnabled = experiments['agents-surface'];
  const isProjectsPanelEnabled = experiments['projects-panel'];
  const isWaifuEnabled = experiments['waifu-tab'];
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<'appearance' | 'workspace' | 'people' | 'models' | 'cloud' | 'privacy' | 'account' | 'labs' | 'connectors' | 'github' | undefined>(undefined);
  const [settingsInitialConnector, setSettingsInitialConnector] = useState<string | null | undefined>(undefined);
  const [currentView, setCurrentView] = useState<ViewType>(() => {
    if (location.pathname === '/search') return 'search';
    if (location.pathname === '/personalization-settings') return 'personal-intelligence';
    if (location.pathname === '/activity') return 'activity';
    if (location.pathname === '/saved-info') return 'saved-info';
    if (location.pathname === '/memory') return 'memory';
    if (location.pathname === '/import') return 'import-memory';
    if (location.pathname === '/connected-apps') return 'connected-apps';
    if (location.pathname === '/customize') return 'customize';
    if (location.pathname === '/models-settings') return 'models-api';
    if (location.pathname === '/labs') return 'labs';
    if (location.pathname === '/design' && isExperimentEnabled('design-surface')) return 'design';
    if (location.pathname === '/waifu' && isExperimentEnabled('waifu-tab')) return 'waifu';
    if (location.pathname.startsWith('/gems')) return 'gems';
    if (location.pathname === '/usage') return 'usage';
    if (location.pathname === '/gemini-spark' || location.pathname === '/spark-settings') return 'gemini-spark';
    if (location.pathname === '/projects' && isExperimentEnabled('projects-panel')) return 'projects';
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
        model: 'gemini-3.8-flash',
        thinkingLevel: 3, // 3 = high thinking level (0=none, 1=low, 2=medium, 3=high)
        baseUrl: 'https://generativelanguage.googleapis.com',
        savedModels: [
          { id: 'default-flash-38', name: 'Gemini 3.8 Flash', thinkingLevel: 3, thinkingLabel: 'High', modelId: 'gemini-3.8-flash' },
          { id: 'default-flash-35-lite', name: 'Gemini 3.5 Flash Lite', thinkingLevel: 1, thinkingLabel: 'Low', modelId: 'gemini-3.5-flash-lite' },
          { id: 'default-pro-high', name: 'Gemini 3.1 Pro', thinkingLevel: 3, thinkingLabel: 'High', modelId: 'gemini-3.1-pro-preview' }
        ] as Array<{ id: string; name: string; thinkingLevel: number; thinkingLabel?: string; effortLabel?: string; modelId: string }>
    },
    openai: {
        model: 'gpt-6-sol',
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
      transcription: CHROME_NATIVE_TRANSCRIPTION_MODEL,
      // Not an id, on purpose. Personal Intelligence routes itself to the
      // cheapest capable model the user has actually added, and re-routes when
      // they add a cheaper or newer one. Naming a model here would pin every
      // install to one the user may hold no key for. A real id appears only once
      // the user picks one in Settings, and that pin is then permanent.
      personalIntelligence: AUTO_MODEL,
      waifuModel: 'gemini-3.8-live',
    },
    providerProfiles: createDefaultProviderProfiles({
      gemini: 'https://generativelanguage.googleapis.com',
      openai: 'https://api.openai.com/v1',
      anthropic: 'https://api.anthropic.com',
      moonshot: 'https://api.moonshot.cn/v1',
      spacexai: 'https://api.x.ai/v1',
      zhipuai: 'https://open.bigmodel.cn/api/paas/v4',
    }),
    // Stamped, so the normalizer below reads this state as current. Without it
    // every boot looks unversioned and the one-time tool-policy migration runs
    // again, overwriting the two values a user is allowed to pick by hand.
    profileSchemaVersion: PROFILE_SCHEMA_VERSION,
    resources: [],
    modelOrder: [] as string[],
  };

  const dedupeSavedModels = (models: any[] = []) => {
    const seen = new Set<string>();
    return migrateRetiredSavedModels(models).filter(m => {
      const key = `${m.profileId || 'default'}:${m.modelId || m.id}`;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  // A system default naming a model Settings no longer offers names the one that replaced it.
  const liveSystemDefaults = <T extends Record<string, unknown>>(defaults: T): T => Object.fromEntries(
    Object.entries(defaults).map(([key, value]) => [key, typeof value === 'string' ? liveModelId(value) : value]),
  ) as T;

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
          gemini: {
            ...gemini,
            model: typeof gemini.model === 'string' ? liveModelId(gemini.model) : gemini.model,
            savedModels: dedupeSavedModels(gemini.savedModels),
          },
          openai: { ...openai, savedModels: dedupeSavedModels(openai.savedModels) },
          anthropic: { ...anthropic, savedModels: dedupeSavedModels(anthropic.savedModels) },
          moonshot: { ...moonshot, savedModels: dedupeSavedModels(moonshot.savedModels) },
          spacexai: { ...spacexai, savedModels: dedupeSavedModels(spacexai.savedModels) },
          zhipuai: { ...zhipuai, savedModels: dedupeSavedModels(zhipuai.savedModels) },
          modelOrder: Array.isArray(parsed.modelOrder)
            ? parsed.modelOrder.filter((key: unknown): key is string => typeof key === 'string')
            : [],
          systemDefaults: liveSystemDefaults({
            ...DEFAULT_MODEL_CONFIG.systemDefaults,
            ...(parsed.systemDefaults || {}),
            // The original Gemini transcription value was the shipped default,
            // not a user selection. Migrate only that exact value; any other
            // stored model remains the user's explicit LLM choice.
            transcription: parsed.systemDefaults?.transcription === 'gemini-3.5-flash-lite'
              ? CHROME_NATIVE_TRANSCRIPTION_MODEL
              : (parsed.systemDefaults?.transcription || CHROME_NATIVE_TRANSCRIPTION_MODEL),
            // Personal Intelligence shipped for a few hours with a hardcoded id
            // as its default. A stored copy of that id is not a choice the user
            // made, so it must not be read as one — it would pin them out of the
            // automatic routing they never opted out of.
            personalIntelligence: parsed.systemDefaults?.personalIntelligence === 'gemini-3.1-flash-lite'
              ? AUTO_MODEL
              : (parsed.systemDefaults?.personalIntelligence || AUTO_MODEL),
          }),
          // Keep the persisted model-config shape consistent with the settings
          // and catalog code. Older builds wrote the normalized profiles under
          // `profiles`; accept that shape while migrating it to `providerProfiles`.
          ...(() => {
            const normalizedProfiles = normalizeProviderProfileState({
              profiles: Array.isArray(parsed.providerProfiles) ? parsed.providerProfiles : parsed.profiles,
              resources: parsed.resources,
              schemaVersion: parsed.profileSchemaVersion,
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
              profileSchemaVersion: normalizedProfiles.schemaVersion,
            };
          })(),
        };
      }
    } catch { /* fall through */ }
    return DEFAULT_MODEL_CONFIG;
  });

  const [selectedModelId, setSelectedModelId] = useState(() => {
    let stored = '';
    try {
      stored = localStorage.getItem('selectedModelId') || '';
    } catch {
      return '';
    }
    // A model loaded onto the one that replaced it can have been dropped as its duplicate.
    let before: ReturnType<typeof collectSavedModelsInCatalogOrder> = [];
    try {
      before = collectSavedModelsInCatalogOrder(JSON.parse(localStorage.getItem(MODEL_CONFIG_STORAGE_KEY) || 'null'));
    } catch { /* nothing to carry over */ }
    return migrateSelectedModelId(stored, before, collectSavedModelsInCatalogOrder(modelConfig));
  });
  const [tabCatalogSync] = React.useState(createTabCatalogSync);
  // Persist model config + selection on every change.
  React.useEffect(() => {
    if (tabCatalogSync.isFromOtherTab(modelConfig)) return;
    try { localStorage.setItem(MODEL_CONFIG_STORAGE_KEY, JSON.stringify(modelConfig)); } catch { /* ignore */ }
  }, [modelConfig]);
  React.useEffect(() => {
    const onCatalogUpdated = (event: Event) => {
      const snapshot = (event as CustomEvent<ModelCatalogSnapshot>).detail;
      if (snapshot) setModelConfig((current: any) => adoptModelCatalogSnapshot(current, snapshot));
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== MODEL_CONFIG_STORAGE_KEY) return;
      const stored = localStorage.getItem(MODEL_CONFIG_STORAGE_KEY);
      setModelConfig((current: any) => tabCatalogSync.adoptStored(current, stored));
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
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth <= 960;
    }
    return false;
  });
  const [isSidebarHidden, setIsSidebarHidden] = useState(false);

  React.useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth <= 960) {
        setIsSidebarCollapsed(true);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  // A surface's address opens it (`shell-routes.ts`); `?mode=` on `/` still works.
  const [studioExperience, setStudioExperience] = useState<StudioExperience>(() =>
    parseShellPath(location.pathname)?.surface === 'spark' ? 'spark' : 'chat');
  const previousSparkLocationKeyRef = React.useRef<string | null>(null);
  const [studioMode, setStudioMode] = useState<'develop' | 'chat' | 'media'>(() => {
    const surface = parseShellPath(location.pathname)?.surface;
    if (surface === 'chat') return 'chat';
    if (surface === 'code') return 'develop';
    if (surface === 'media') return 'media';
    const modeParam = searchParams.get('mode') || searchParams.get('tab');
    if (modeParam === 'media' || modeParam === 'develop' || modeParam === 'chat') {
      return modeParam;
    }
    return 'chat';
  });
  const isCodeSurface = currentView === 'home' && studioExperience !== 'spark' && studioMode === 'develop';
  const isMediaSurface = currentView === 'home' && studioExperience !== 'spark' && studioMode === 'media';
  // The desktop app's rail is the way to Code and Media, and they have the page to themselves.
  const isSidebarAway = isDesktopApp() && (isCodeSurface || isMediaSurface);
  const isDesignSurface = currentView === 'design';
  const keepDesignAlive = useKeepAlive(useStore(designTurnRunning));

  /*
   * Code's screens: Code homes in the main shell (`CodeHomeEntry`), and each
   * reopened project (`CodeProjectScreens`). Each has its own state
   * (`@willow/code/session`), so any number can be mounted at once: the one on
   * show, and each other one, hidden, while its turn runs. A turn inherited from
   * a closed tab mounts the one its conversation needs.
   */
  const codeResume = useStore($codeResume);
  const runningCodeScreens = useStore($runningCodeScreens);
  const [codeHomes, setCodeHomes] = useState<CodeHomeEntry[]>(() => [makeCodeHome(CODE_HOME_SCREEN)]);
  const shownCodeHome = codeHomes[codeHomes.length - 1];
  const workingCodeHomes = runningCodeScreens.filter(isCodeHomeScreen);
  const keptCodeHomes = useKeepAliveKeys(
    codeResume?.job.payload.place.target === 'chat' && !workingCodeHomes.includes(shownCodeHome.key)
      ? [...workingCodeHomes, shownCodeHome.key]
      : workingCodeHomes,
  );
  const isOnMainShell = !/^\/(media|project1|tv)(\/|$)/.test(location.pathname);
  /*
   * The main shell is kept mounted once it has been on show (`ShellKeepAlive`), and in it each of the
   * rail's tabs once opened — the chat, Spark (Bots among it), Media's landing, Customize, the Code
   * home — so going back to one finds it as it was, not built again. Noted as they render, since what
   * renders this frame depends on it.
   */
  const shellShownRef = React.useRef(false);
  if (isOnMainShell) shellShownRef.current = true;
  const shellTab: ShellTab | null = currentView === 'home'
    ? (studioExperience === 'spark' ? 'spark' : studioMode === 'chat' ? 'chat' : studioMode === 'media' ? 'media' : null)
    : currentView === 'customize' ? 'customize' : null;
  const openedShellTabsRef = React.useRef(new Set<ShellTab>());
  if (shellTab) openedShellTabsRef.current.add(shellTab);
  const keptShellTabs = SHELL_TABS.filter((tab) => openedShellTabsRef.current.has(tab));
  const codeHomeOpenedRef = React.useRef(false);
  if (isCodeSurface && isOnMainShell) codeHomeOpenedRef.current = true;
  const mountedCodeHomes = codeHomes.filter((home) =>
    keptCodeHomes.has(home.key) || (home === shownCodeHome && codeHomeOpenedRef.current));
  const isShownCodeHomeMounted = mountedCodeHomes.includes(shownCodeHome);
  // An earlier Code home goes once its work is done; the one on show stays in the list.
  const keptCodeHomesKey = [...keptCodeHomes].sort().join('\n');
  React.useEffect(() => {
    setCodeHomes((homes) => {
      const next = homes.filter((home, index) => index === homes.length - 1 || keptCodeHomes.has(home.key));
      return next.length === homes.length ? homes : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keptCodeHomesKey, codeHomes]);
  const codeParkingRef = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    for (const home of codeHomes) {
      if (!home.container.isConnected && codeParkingRef.current) codeParkingRef.current.appendChild(home.container);
    }
  });
  const handleCodeHomeOpened = React.useCallback((key: string, epoch: number) => {
    setCodeHomes((homes) => {
      const opened = homes.find((home) => home.key === key && home.open?.epoch === epoch);
      return opened ? homes.map((home) => (home === opened ? { ...home, open: null } : home)) : homes;
    });
  }, []);
  const nextCodeHomeRef = React.useRef(1);
  const codeTakeoverGateRef = React.useRef<CodeTakeoverGate>({ homeMounted: false, projectScreens: new Set() });
  codeTakeoverGateRef.current.homeMounted = mountedCodeHomes.length > 0;

  React.useEffect(() => {
    const isSparkTask = studioExperience === 'spark' && activeSparkLocation.page === 'task';
    // An open dot is laid out as a task, so it takes the same collapse.
    const isSparkDot = studioExperience === 'spark' && activeSparkLocation.page === 'dots' && activeSparkLocation.dotId != null;
    const currentLocationKey = studioExperience === 'spark'
      ? (isSparkTask
        ? `spark:task:${activeSparkLocation.taskId}`
        : isSparkDot
          ? `spark:dot:${activeSparkLocation.dotId}`
          : `spark:${activeSparkLocation.page}`)
      : null;
    const previousLocationKey = previousSparkLocationKeyRef.current;

    // Collapse once when entering a task or a dot. Do not watch isSidebarCollapsed here:
    // after this transition the user must be able to expand the global sidebar.
    if ((isSparkTask || isSparkDot) && currentLocationKey !== previousLocationKey) {
      setIsSidebarCollapsed(true);
    }

    previousSparkLocationKeyRef.current = currentLocationKey;
  }, [
    activeSparkLocation.page,
    activeSparkLocation.page === 'task' ? activeSparkLocation.taskId : null,
    activeSparkLocation.page === 'dots' ? activeSparkLocation.dotId : null,
    studioExperience,
  ]);

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

  // Chat only: New chat leaves Code alone. A Code home left idle unmounts anyway,
  // so the next visit starts fresh, and one still working carries on, hidden.
  const resetChatSurface = () => {
    silentChatSurfaceRef.current = true;
    setChatResetKey((k) => k + 1);
    setHasActiveChat(false);
    setIsIncognito(false);
  };

  /*
   * A new chat belongs to no Gem and no notebook. Both contexts outlive the chat that set
   * them, so without this a plain chat started after a Gem or notebook one would keep
   * its instructions and sources. The notebook hand-off re-sets its own after this runs.
   */
  const handleNewChat = () => {
    $chatGemId.set(null);
    $chatNotebookId.set(null);
    if (location.pathname.startsWith('/gem/')) navigate('/');
    resetChatSurface();
  };

  const handleIncognitoChat = () => {
    $chatGemId.set(null);
    $chatNotebookId.set(null);
    if (location.pathname.startsWith('/gem/')) navigate('/');
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

  /*
   * `/gem/<id>` is a new chat with that Gem: the ordinary chat surface, reset, with the
   * Gem's context set. The reset comes first so it cannot clear what this sets, and
   * `ChatView` remounts on the reset, so it reads the Gem as it mounts.
   */
  const gemRouteId = React.useMemo(() => {
    const match = /^\/gem\/([^/]+)/.exec(location.pathname);
    return match ? decodeURIComponent(match[1]) : null;
  }, [location.pathname]);
  React.useEffect(() => {
    if (!gemRouteId) return;
    // A deleted Gem, or a premade one Willow no longer ships, goes back to the manager.
    hydrateGems();
    if (!resolveGem(gemRouteId)) {
      navigate('/gems', { replace: true });
      return;
    }
    $chatNotebookId.set(null);
    resetChatSurface();
    $chatGemId.set(gemRouteId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gemRouteId]);

  // Opening a saved chat leaves the Gem's URL; ChatView restores the chat's own Gem.
  const chatSelection = useStore(chatSelectionEpoch);
  const seenChatSelectionRef = React.useRef(chatSelection);
  React.useEffect(() => {
    if (chatSelection === seenChatSelectionRef.current) return;
    seenChatSelectionRef.current = chatSelection;
    if (location.pathname.startsWith('/gem/')) navigate('/', { replace: true });
  }, [chatSelection, location.pathname, navigate]);

  const viewChangeSequenceRef = React.useRef(0);
  const viewChangeIntentRef = React.useRef<ViewType | null>(null);
  const handleViewChange = React.useCallback(async (view: ViewType): Promise<boolean> => {
    if (view === currentView) return true;
    if (view === 'design' && !isDesignEnabled) return false;
    if (view === 'waifu' && !isWaifuEnabled) return false;
    if (view === 'agents' && !isAgentsEnabled) return false;
    if (view === 'projects' && !isProjectsPanelEnabled) return false;
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
    else if (view === 'customize') navigate('/customize');
    else if (view === 'models-api') navigate('/models-settings');
    else if (view === 'labs') navigate('/labs');
    else if (view === 'design') navigate('/design');
    else if (view === 'waifu') navigate('/waifu');
    else if (view === 'gems') navigate('/gems');
    else if (view === 'notebooks') navigate('/notebooks/view');
    else if (view === 'notebook-create') navigate('/notebooks/create');
    else if (view === 'usage') navigate('/usage');
    else if (view === 'gemini-spark') navigate('/gemini-spark');
    else if (view === 'projects') navigate('/projects');
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
      location.pathname === '/import' ||
      location.pathname === '/connected-apps' ||
      location.pathname === '/customize' ||
      location.pathname === '/models-settings' ||
      location.pathname === '/labs' ||
      location.pathname === '/design' ||
      location.pathname === '/waifu' ||
      location.pathname === '/gems' ||
      location.pathname.startsWith('/gems/') ||
      location.pathname.startsWith('/gem/') ||
      location.pathname === '/usage' ||
      location.pathname === '/gemini-spark' ||
      location.pathname === '/spark-settings' ||
      location.pathname === '/projects' ||
      matchNotebookRoute(location.pathname) !== null
    ) {
      navigate('/', { replace: true });
    }
    commitView(view);
    return true;
  }, [commitView, currentView, finishTopLoading, isAgentsEnabled, isDesignEnabled, isProjectsPanelEnabled, isWaifuEnabled, navigate, searchParams, startTopLoading, location.pathname]);

  /*
   * Reopening a Code chat, from anywhere.
   *
   * The Recents row, the Search page and the Search dialog all publish the same
   * request (see `code-chat-open-store`) and none of them switches the mode
   * themselves — the dialog is rendered from StudioLayout and has no route to
   * these setters at all. Routing lives here so there is one owner of the
   * decision, including which Code home opens the chat:
   *
   * - one that already has it open is shown as it is, a running turn and all;
   * - while the one on show is working, the chat gets a new Code home, and the
   *   working one carries on, hidden, until it is done;
   * - otherwise the one on show opens it.
   *
   * The chosen Code home holds the request until it has opened the chat
   * (`onOpenHandled`): it is lazy, so it may not be mounted yet.
   */
  const codeChatOpenRequest = useStore(pendingCodeChatOpen);
  const routedCodeChatEpochRef = React.useRef(0);
  React.useEffect(() => {
    if (!codeChatOpenRequest || codeChatOpenRequest.epoch === routedCodeChatEpochRef.current) return;
    routedCodeChatEpochRef.current = codeChatOpenRequest.epoch;
    const request = codeChatOpenRequest;
    clearCodeChatOpen();
    const holder = Object.entries($codeScreenChats.get())
      .find(([key, chatId]) => isCodeHomeScreen(key) && chatId === request.chatId)?.[0];
    const freshKey = `${CODE_HOME_SCREEN}:${++nextCodeHomeRef.current}`;
    setCodeHomes((homes) => {
      if (holder && homes.some((home) => home.key === holder)) return showCodeHome(homes, holder);
      const shown = homes[homes.length - 1];
      if ($runningCodeScreens.get().includes(shown.key)) return [...homes, makeCodeHome(freshKey, request)];
      return [...homes.slice(0, -1), { ...shown, open: request }];
    });
    setStudioExperience('chat');
    setStudioMode('develop');
    void handleViewChange('home');
  }, [codeChatOpenRequest, handleViewChange]);

  // A project a Code home has open reopens there (`CodeProjectScreens`).
  const openCodeHome = React.useCallback((screenKey: string) => {
    setCodeHomes((homes) => showCodeHome(homes, screenKey));
    navigate('/', { replace: true });
    setStudioExperience('chat');
    setStudioMode('develop');
    void handleViewChange('home');
  }, [navigate, handleViewChange]);

  /*
   * Bounce off a Labs-gated URL. The sync effects below simply decline to enter
   * the view, which would leave the shell rendering Home while the address bar
   * still read `/design` — and would leave the view stuck if a user turned the
   * flag off while sitting on the surface.
   */

  React.useEffect(() => {
    if (location.pathname === '/design' && !isDesignEnabled) {
      navigate('/', { replace: true });
    } else if (location.pathname === '/waifu' && !isWaifuEnabled) {
      navigate('/', { replace: true });
    } else if (searchParams.get('view') === 'agents' && !isAgentsEnabled) {
      navigate('/', { replace: true });
    } else if (location.pathname === '/projects' && !isProjectsPanelEnabled) {
      navigate('/', { replace: true });
    }
  }, [isAgentsEnabled, isDesignEnabled, isProjectsPanelEnabled, isWaifuEnabled, location.pathname, navigate, searchParams]);

  // Turning `projects-panel` off while sitting on the page leaves it, as the bounce above leaves its URL.
  React.useEffect(() => {
    if (currentView === 'projects' && !isProjectsPanelEnabled) commitView('home');
  }, [commitView, currentView, isProjectsPanelEnabled]);

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
        (intent === 'import-memory' && location.pathname === '/import') ||
        (intent === 'connected-apps' && location.pathname === '/connected-apps') ||
        (intent === 'customize' && location.pathname === '/customize') ||
        (intent === 'models-api' && location.pathname === '/models-settings') ||
        (intent === 'labs' && location.pathname === '/labs') ||
        (intent === 'design' && location.pathname === '/design') ||
        (intent === 'waifu' && location.pathname === '/waifu') ||
        (intent === 'gems' && location.pathname.startsWith('/gems')) ||
        (intent === 'usage' && location.pathname === '/usage') ||
        (intent === 'gemini-spark' && (location.pathname === '/gemini-spark' || location.pathname === '/spark-settings')) ||
        (intent === 'projects' && location.pathname === '/projects') ||
        // `/`, or the surface `ShellRouteSync` has already put in its place.
        (intent === 'home' && isShellPath(location.pathname));
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
    } else if (location.pathname === '/import') {
      if (currentView !== 'import-memory') {
        commitView('import-memory');
      }
    } else if (location.pathname === '/connected-apps') {
      if (currentView !== 'connected-apps') {
        commitView('connected-apps');
      }
    } else if (location.pathname === '/customize') {
      if (currentView !== 'customize') {
        commitView('customize');
      }
    } else if (location.pathname === '/models-settings') {
      if (currentView !== 'models-api') {
        commitView('models-api');
      }
    } else if (location.pathname === '/labs') {
      if (currentView !== 'labs') {
        commitView('labs');
      }
    } else if (location.pathname === '/design' && isDesignEnabled) {
      if (currentView !== 'design') {
        commitView('design');
      }
    } else if (location.pathname === '/waifu' && isWaifuEnabled) {
      if (currentView !== 'waifu') {
        commitView('waifu');
      }
    } else if (location.pathname.startsWith('/gems')) {
      if (currentView !== 'gems') {
        commitView('gems');
      }
    } else if (location.pathname === '/usage') {
      if (currentView !== 'usage') {
        commitView('usage');
      }
    } else if (location.pathname === '/gemini-spark' || location.pathname === '/spark-settings') {
      if (currentView !== 'gemini-spark') {
        commitView('gemini-spark');
      }
    } else if (location.pathname === '/projects' && isProjectsPanelEnabled) {
      if (currentView !== 'projects') {
        commitView('projects');
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
      currentView === 'import-memory' ||
      currentView === 'connected-apps' ||
      currentView === 'customize' ||
      currentView === 'models-api' ||
      currentView === 'labs' ||
      currentView === 'design' ||
      currentView === 'waifu' ||
      currentView === 'gems' ||
      currentView === 'usage' ||
      currentView === 'gemini-spark' ||
      currentView === 'notebooks' ||
      currentView === 'notebook-create' ||
      currentView === 'notebook' ||
      currentView === 'projects'
    ) {
      commitView('home');
    }
  }, [location.pathname, currentView, commitView, isDesignEnabled, isWaifuEnabled, isProjectsPanelEnabled]);

  // Where the desktop rail's Media and Code buttons go back to (rail-returns.ts).
  const agentTabInFront = useStore($harnessTab) !== null;
  React.useEffect(() => {
    if (isDesktopApp()) noteRailPlace(location.pathname, location.search, !agentTabInFront);
  }, [location.pathname, location.search, agentTabInFront]);
  // Bots and Spark each keep the place left there; they share one location in Spark's store.
  React.useEffect(() => (isDesktopApp() ? sparkLocation.subscribe(noteSparkPlace) : undefined), []);
  // An agent tab the rail leaves in front while it goes back to a project (rail-navigation.ts) closes
  // once that project has replaced the shell.
  React.useEffect(() => {
    if (!isOnMainShell) closeHarnessTab();
  }, [isOnMainShell]);

  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => finishTopLoading('studio-experience'));
    return () => window.cancelAnimationFrame(frame);
  }, [studioExperience, finishTopLoading]);
  const { user, userProfile, loading, workspaceColor } = useAuth();
  // Surfaces cloned from Gemini read its blues through `--sync-*`; on the root, so portals see them.
  React.useLayoutEffect(() => {
    applyWorkspaceSync(workspaceColor);
  }, [workspaceColor]);
  React.useEffect(() => {
    let cancelled = false;
    const sequence = ++viewChangeSequenceRef.current;
    const syncViewFromUrl = async () => {
      const intendedView = viewChangeIntentRef.current;
      if (intendedView) {
        const urlMatchesIntent = intendedView === 'agents'
          ? searchParams.get('view') === 'agents'
          : searchParams.get('view') !== 'agents';
        if (currentView === intendedView && urlMatchesIntent) viewChangeIntentRef.current = null;
        return;
      }

      if (isAgentsEnabled && searchParams.get('view') === 'agents') {
        if (!cancelled && sequence === viewChangeSequenceRef.current && currentView !== 'agents') {
          startTopLoading('studio-view');
          commitView('agents');
        }
        return;
      }
      if (currentView !== 'agents') return;

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
  }, [commitView, currentView, finishTopLoading, isAgentsEnabled, navigate, searchParams, startTopLoading]);

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
    // Mark that we're navigating to the workbench via React Router (not a page refresh).
    // The 'staging-nav' key keeps its legacy name on purpose: it is a live
    // sessionStorage contract read back in the refresh check above.
    sessionStorage.setItem('staging-nav', 'true');
    const encodedPrompt = encodeURIComponent(prompt);
    navigate(`/project1?prompt=${encodedPrompt}&mode=${mode}`, { state: { initialAttachments: attachments, isNewProject: true } });
  };

  /*
   * Chat, Develop and live voice run entirely on the user's own API key, so the
   * only thing they can be missing is a key — never an account. They get
   * Settings → Models rather than the login page, which is also what makes the
   * composer's "Add new" model button work in both signed states.
   */
  const openModelSettings = () => {
    setSettingsInitialTab('models');
    setIsSettingsOpen(true);
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

  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const showAuthModal = isAuthModalOpen || location.pathname === '/login';

  const handleCloseAuthModal = React.useCallback(() => {
    setIsAuthModalOpen(false);
    if (location.pathname === '/login') {
      navigate('/', { replace: true });
    }
  }, [location.pathname, navigate]);

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

  const isMainShellRoute = isOnMainShell;
  /*
   * A Media or Code project and Willow TV sit outside the main shell. In the desktop app the
   * rail stays beside them and takes the shell's own steps, bringing the shell back first.
   */
  const surfaceRail: RailDestinationId = location.pathname === '/project1' ? 'code' : 'media';
  const navigateRailFromSurface = (destination: RailDestinationId) => {
    navigateRail(destination, {
      current: surfaceRail,
      onShell: false,
      currentView,
      studioExperience,
      setCurrentView: handleViewChange,
      onModeChange: handleStudioModeChange,
      onStudioExperienceChange: handleStudioExperienceChange,
      navigate: (to) => navigate(to),
    });
  };
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
        leftOffset={isSidebarHidden || isSidebarAway || isSidebarCollapsed ? 0 : STUDIO_SIDEBAR_EXPANDED_WIDTH}
        workspaceColor={workspaceColor}
      />
      {/* Kept mounted behind a screen outside the shell, the shell leaves Settings to that screen's own. */}
      {hasOpenedSettings && isMainShellRoute && (
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
      <StudioLayout
        isSearchOpen={isSearchOpen}
        setIsSearchOpen={setIsSearchOpen}
        currentView={currentView}
        setCurrentView={handleViewChange}
        modelConfig={modelConfig}
        /*
         * Only the sidebar's gear menu reaches this — the profile menu's
         * "Settings" calls it with no `tabId` and lands in the modal below, and
         * the composer's own "Add new" has its own handler. So `models` opening
         * the standalone page does not move the modal's Models & API tab, which
         * is still where Settings → Models & API goes.
         */
        onSettingsClick={(tabId) => {
          if (tabId === 'intelligence') {
            handleViewChange('personal-intelligence');
          } else if (tabId === 'activity') {
            handleViewChange('activity');
          } else if (tabId === 'gems') {
            handleViewChange('gems');
          } else if (tabId === 'models') {
            handleViewChange('models-api');
          } else if (tabId === 'labs') {
            handleViewChange('labs');
          } else if (tabId === 'limits') {
            handleViewChange('usage');
          } else if (tabId === 'memory') {
            handleViewChange('memory');
          } else if (tabId === 'spark-settings') {
            handleViewChange('gemini-spark');
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
        isSidebarAway={isSidebarAway}
        onSignInClick={() => setIsAuthModalOpen(true)}
        isGemsEditor={/^\/gems\/(create|edit\/)/.test(location.pathname)}
      >
        {/*
          * Code and Design sit outside the view switch below, so a turn still running
          * when the user moves elsewhere keeps its screen mounted, hidden, until it settles.
          */}
        {/* The Code home itself renders above the routes; this is where it shows. */}
        {isShownCodeHomeMounted && isCodeSurface && <CodeHomeSlot container={shownCodeHome.container} parking={codeParkingRef} />}
        {(isDesignSurface || keepDesignAlive) && (
          <div
            style={isDesignSurface ? VISIBLE_SURFACE_STYLE : BACKGROUND_SURFACE_STYLE}
            inert={!isDesignSurface}
            aria-hidden={isDesignSurface ? undefined : true}
          >
            <Suspense fallback={
              <StudioLoadingFallback reason="design-suspense" onStart={startTopLoading} onFinish={finishTopLoading}>
                <TabLoading />
              </StudioLoadingFallback>
            }>
              <DesignView
                modelConfig={modelConfig}
                selectedModelId={selectedModelId}
                setSelectedModelId={setSelectedModelId}
                onAuthRequired={() => setIsSettingsOpen(true)}
                onWorkspaceActive={isDesignSurface ? setIsSidebarHidden : undefined}
              />
            </Suspense>
          </div>
        )}
        {/*
          * The rail's tabs inside the shell, each mounted from the first time it is opened: the one
          * on show in place, the rest hidden as a working screen is (`keptShellTabs`).
          */}
        {keptShellTabs.map((tab) => (
          <div
            key={tab}
            style={tab === shellTab ? VISIBLE_SURFACE_STYLE : BACKGROUND_SURFACE_STYLE}
            inert={tab !== shellTab}
            aria-hidden={tab === shellTab ? undefined : true}
          >
            {tab === 'spark' ? (
              <Suspense fallback={
                <StudioLoadingFallback reason="spark-suspense" onStart={startTopLoading} onFinish={finishTopLoading}>
                  <TabLoading />
                </StudioLoadingFallback>
              }>
                <SparkWorkspace
                  modelConfig={modelConfig}
                  selectedModelId={selectedModelId}
                  setSelectedModelId={setSelectedModelId}
                />
              </Suspense>
            ) : tab === 'chat' ? (
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
                  onAuthRequired={openModelSettings}
                  onOpenDriveSettings={openDriveSettings}
                  isIncognito={isIncognito}
                  onChatStartedChange={setHasActiveChat}
                  isSidebarCollapsed={isSidebarCollapsed}
                  onCollapseSidebar={() => setIsSidebarCollapsed(true)}
                  onNewChat={handleNewChat}
                  workspaceColor={workspaceColor}
                />
              </Suspense>
            ) : tab === 'media' ? (
              <Suspense fallback={
                <StudioLoadingFallback reason="media-suspense" onStart={startTopLoading} onFinish={finishTopLoading}>
                  <TabLoading />
                </StudioLoadingFallback>
              }>
                <FeatureFirstPaintGate feature="media">
                  {/* Media's home scrolls itself: the chat experience's <main> clips. Without a
                      scrollbar, so the desktop's columns keep their width. */}
                  <div className="media-home h-full overflow-y-auto overscroll-contain no-scrollbar">
                    <div className="flex min-h-full flex-col" key="media">
                      <HeroSection
                        initialMode="design"
                        onPromptSubmit={(prompt) => {
                          sessionStorage.setItem('staging-nav', 'true');
                          navigate(`/media?prompt=${encodeURIComponent(prompt)}`);
                        }}
                        onProjectSelect={(projectId, tempName) => {
                          sessionStorage.setItem('staging-nav', 'true');
                          const query = tempName
                            ? `?projectId=${encodeURIComponent(projectId)}&tempName=${encodeURIComponent(tempName)}`
                            : `?projectId=${encodeURIComponent(projectId)}`;
                          navigate(`/media${query}`);
                        }}
                        modelConfig={modelConfig}
                        selectedModelId={selectedModelId}
                        setSelectedModelId={setSelectedModelId}
                        onAuthRequired={openModelSettings}
                        isAuthenticated={!!user}
                        studioMode="media"
                        isSidebarCollapsed={isSidebarCollapsed}
                        isSidebarAway={isSidebarAway}
                      />
                      <div className="pb-20">
                        <BottomPanel onOpenDriveSettings={openDriveSettings} mode="media" />
                      </div>
                    </div>
                  </div>
                </FeatureFirstPaintGate>
              </Suspense>
            ) : (
              <Suspense fallback={
                <StudioLoadingFallback reason="customize-suspense" onStart={startTopLoading} onFinish={finishTopLoading}>
                  <div className="h-full w-full" />
                </StudioLoadingFallback>
              }>
                <CustomizeView />
              </Suspense>
            )}
          </div>
        ))}
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
              <TabLoading />
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
          null
        ) : currentView === 'home' ? (
          // The chat, Spark and Media's landing are kept tabs, above.
          null
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
        ) : currentView === 'import-memory' ? (
          <Suspense fallback={
            <StudioLoadingFallback reason="settings-tab-suspense" onStart={startTopLoading} onFinish={finishTopLoading}>
              <div className="h-full w-full" />
            </StudioLoadingFallback>
          }>
            <ImportMemoryView />
          </Suspense>
        ) : currentView === 'connected-apps' ? (
          <Suspense fallback={
            <StudioLoadingFallback reason="settings-tab-suspense" onStart={startTopLoading} onFinish={finishTopLoading}>
              <div className="h-full w-full" />
            </StudioLoadingFallback>
          }>
            <ConnectedAppsTab />
          </Suspense>
        ) : currentView === 'customize' ? (
          // A kept tab, above.
          null
        ) : currentView === 'waifu' ? (
          <Suspense fallback={
            <StudioLoadingFallback reason="waifu-suspense" onStart={startTopLoading} onFinish={finishTopLoading}>
              <div className="h-full w-full" />
            </StudioLoadingFallback>
          }>
            <WaifuView modelConfig={modelConfig} setModelConfig={setModelConfig} />
          </Suspense>
        ) : currentView === 'usage' ? (
          <Suspense fallback={
            <StudioLoadingFallback reason="usage-suspense" onStart={startTopLoading} onFinish={finishTopLoading}>
              <div className="h-full w-full" />
            </StudioLoadingFallback>
          }>
            <UsageLimitsView />
          </Suspense>
        ) : currentView === 'gemini-spark' ? (
          <Suspense fallback={
            <StudioLoadingFallback reason="spark-settings-suspense" onStart={startTopLoading} onFinish={finishTopLoading}>
              <div className="h-full w-full" />
            </StudioLoadingFallback>
          }>
            <SparkSettingsView />
          </Suspense>
        ) : currentView === 'models-api' ? (
          <Suspense fallback={
            <StudioLoadingFallback reason="settings-tab-suspense" onStart={startTopLoading} onFinish={finishTopLoading}>
              <div className="h-full w-full" />
            </StudioLoadingFallback>
          }>
            <ModelsApiPage modelConfig={modelConfig} setModelConfig={setModelConfig} />
          </Suspense>
        ) : currentView === 'labs' ? (
          <Suspense fallback={
            <StudioLoadingFallback reason="settings-tab-suspense" onStart={startTopLoading} onFinish={finishTopLoading}>
              <div className="h-full w-full" />
            </StudioLoadingFallback>
          }>
            <LabsPage />
          </Suspense>
        ) : currentView === 'gems' ? (
          <Suspense fallback={<StudioLoadingFallback reason="gems-suspense" onStart={startTopLoading} onFinish={finishTopLoading}><div className="h-full w-full" /></StudioLoadingFallback>}>
            <GemsView
              modelConfig={modelConfig}
              selectedModelId={selectedModelId}
              renderPreviewComposer={({ onSubmit, isGenerating, onStop }) => (
                <Suspense fallback={<div className="h-16 w-full rounded-[32px] bg-[#1e1f21]" />}>
                  <NotebookComposer
                    chatVariant
                    currentMode="chat"
                    onModeChange={() => {}}
                    modelConfig={modelConfig}
                    selectedModelId={selectedModelId}
                    setSelectedModelId={setSelectedModelId}
                    onAuthRequired={() => setIsSettingsOpen(true)}
                    isGenerating={isGenerating}
                    onStopGenerating={onStop}
                    onSubmit={(prompt) => onSubmit(prompt)}
                  />
                </Suspense>
              )}
              renderModelPicker={() => (
                <Suspense fallback={null}>
                  <NotebookModelPicker
                    modelConfig={modelConfig}
                    selectedModelId={selectedModelId}
                    setSelectedModelId={setSelectedModelId}
                    onAuthRequired={() => setIsSettingsOpen(true)}
                  />
                </Suspense>
              )}
            />
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
              renderModelPicker={() => (
                <Suspense fallback={null}>
                  <NotebookModelPicker
                    modelConfig={modelConfig}
                    selectedModelId={selectedModelId}
                    setSelectedModelId={setSelectedModelId}
                    onAuthRequired={() => setIsSettingsOpen(true)}
                  />
                </Suspense>
              )}
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
            <ProjectsPage onOpenDriveSettings={openDriveSettings} />
          </Suspense>
        )}
      </StudioLayout>
    </>
  );

  return (
    <BackgroundProvider>
      <SettingsFileBridge
        selectedModelId={selectedModelId}
        setSelectedModelId={setSelectedModelId}
        modelConfig={modelConfig}
        setModelConfig={setModelConfig}
        liveSystemDefaults={liveSystemDefaults}
      />
      <UserDataProvider>
        <LocalFSProvider modelConfig={modelConfig}>
          <DriveProjectDiscovery />
          <PinnedChatsSettingsSection />
          <ChatEmbeddingIndexer modelConfig={modelConfig} />
          <Suspense fallback={null}>
            <ChatTurnTakeover modelConfig={modelConfig} />
          </Suspense>
          {isDesktopApp() && !isMainShellRoute && (
            <DesktopFrame
              current={surfaceRail}
              onNavigate={navigateRailFromSurface}
              isIncognito={isIncognito}
              onNewChat={() => { navigateRailFromSurface('home'); handleNewChat(); }}
              onTemporaryChat={() => { navigateRailFromSurface('home'); handleIncognitoChat(); }}
              onSettings={() => setIsSettingsOpen(true)}
              onToggleSidebar={() => undefined}
              modelConfig={modelConfig}
            />
          )}
          <MediaKeepAlive
            modelConfig={modelConfig}
            onOpenSettings={(tab) => {
              setSettingsInitialTab(tab);
              setSettingsInitialConnector(undefined);
              setIsSettingsOpen(true);
            }}
          />
          <CodeTurnTakeover gate={codeTakeoverGateRef} />
          <ShellRouteSync
            currentView={currentView}
            studioExperience={studioExperience}
            studioMode={studioMode}
            isIncognito={isIncognito}
            codeHomeKey={shownCodeHome.key}
            setStudioExperience={setStudioExperience}
            setStudioMode={setStudioMode}
            onNewChat={handleNewChat}
          />
          <ShellRequestHandler
            onStudioExperienceChange={handleStudioExperienceChange}
            onViewChange={handleViewChange}
            onNewChat={handleNewChat}
          />
          <CodeProjectScreens
            gate={codeTakeoverGateRef}
            onOpenCodeHome={openCodeHome}
            onSettingsClick={(tab?: string) => {
              if (tab) setSettingsInitialTab(tab as any);
              setIsSettingsOpen(true);
            }}
            modelConfig={modelConfig}
            setModelConfig={setModelConfig}
            selectedModelId={selectedModelId}
            setSelectedModelId={setSelectedModelId}
          />
          {/*
            * Above the routes so runs, schedules and takeovers keep going in the Media editor too —
            * until Spark's own workspace is mounted, kept tab that it is, which does the same work.
            */}
          {!(shellShownRef.current && keptShellTabs.includes('spark')) && (
            <Suspense fallback={null}>
              <SparkWorkspace
                backgroundOnly
                modelConfig={modelConfig}
                selectedModelId={selectedModelId}
              />
            </Suspense>
          )}
          {isDesktopApp() && (
            <Suspense fallback={null}>
              <SparkPetsHost onOpenSpark={() => handleStudioExperienceChange('spark')} />
            </Suspense>
          )}
          {showAuthModal && (
            <Suspense fallback={null}>
              <AuthModal
                isOpen={showAuthModal}
                onClose={handleCloseAuthModal}
                initialMode={searchParams.get('mode') === 'signup' ? 'signup' : 'login'}
              />
            </Suspense>
          )}
          {/* The main shell itself, kept mounted beside the screens outside it (`ShellKeepAlive`). */}
          <ShellKeepAlive onShow={isMainShellRoute}>{mainAppShell}</ShellKeepAlive>
          <Routes>
           <Route path="/" element={null} />
           {/* The shell's own surfaces (`shell-routes.ts`); `ShellRouteSync` keeps them in step. */}
           <Route path="/app" element={null} />
           <Route path="/app/:chatId" element={null} />
          <Route path="/images" element={null} />
          <Route path="/videos" element={null} />
           <Route path="/code" element={null} />
           <Route path="/code/:chatId" element={null} />
           <Route path="/create" element={null} />
           <Route path="/spark/*" element={null} />
           <Route path="/projects" element={null} />
           <Route path="/search" element={null} />
           <Route path="/personalization-settings" element={null} />
           <Route path="/activity" element={null} />
           <Route path="/saved-info" element={null} />
           <Route path="/memory" element={null} />
           <Route path="/import" element={null} />
           <Route path="/connected-apps" element={null} />
           <Route path="/customize" element={null} />
           <Route path="/models-settings" element={null} />
           <Route path="/labs" element={null} />
           <Route path="/design" element={null} />
           <Route path="/waifu" element={null} />
           <Route path="/gems" element={null} />
           <Route path="/gems/view" element={null} />
           <Route path="/gems/create" element={null} />
           <Route path="/gems/edit/:gemId" element={null} />
           <Route path="/gem/:gemId" element={null} />
           <Route path="/usage" element={null} />
           <Route path="/gemini-spark" element={null} />
           <Route path="/spark-settings" element={null} />
           {/* Gemini's own notebook paths, matched rather than renamed. */}
           <Route path="/notebooks" element={null} />
           <Route path="/notebooks/view" element={null} />
           <Route path="/notebooks/create" element={null} />
           <Route path="/notebook/:notebookId" element={null} />
           <Route path="/agents" element={<Navigate to="/?view=agents" replace />} />
        
        <Route path="/project1" element={
          <WorkbenchRouteGuard>
            {/* The project itself is rendered above the routes; this says the guard let it through. */}
            <RouteMarker store={$workbenchRouteActive} />
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
          </WorkbenchRouteGuard>
        } />

        <Route path="/media/*" element={
          <WorkbenchRouteGuard>
            {/* The editor itself is `MediaKeepAlive`, above the routes. */}
            <MediaRouteRedirect />
            {/* Routes outside the main shell mount their own settings window, after the page so it paints on top. */}
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
          </WorkbenchRouteGuard>
        } />

        <Route path="/tv/*" element={
          <>
            <Suspense fallback={<div className="h-screen w-screen bg-[#000000]" />}>
              <WillowTV />
            </Suspense>
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
          </>
        } />

        <Route path="/login" element={null} />
        </Routes>
        {/*
          * Where a Code home waits while it is not on screen — laid out, never
          * painted or hit — and the Code homes themselves. After the routes, so a
          * slot that mounts in the same commit has moved one into place before it
          * measures.
          */}
        <div ref={codeParkingRef} style={BACKGROUND_SURFACE_STYLE} inert aria-hidden="true" />
        {mountedCodeHomes.map((home) => {
          const isShown = home === shownCodeHome && isCodeSurface && isMainShellRoute;
          return createPortal(
            <Suspense fallback={
              <StudioLoadingFallback reason="code-suspense" onStart={startTopLoading} onFinish={finishTopLoading}>
                <CodeWorkspaceSkeleton />
              </StudioLoadingFallback>
            }>
              <CodeWorkspace
                screenKey={home.key}
                isOnShow={isShown}
                openRequest={home.open}
                onOpenHandled={(epoch) => handleCodeHomeOpened(home.key, epoch)}
                modelConfig={modelConfig}
                setModelConfig={setModelConfig}
                selectedModelId={selectedModelId}
                setSelectedModelId={setSelectedModelId}
                isAuthenticated={!!user}
                onAuthRequired={openModelSettings}
                onSettingsClick={(tab) => {
                  if (tab) setSettingsInitialTab(tab as any);
                  setIsSettingsOpen(true);
                }}
                isSidebarCollapsed={isSidebarCollapsed}
                onWorkspaceActive={isShown ? setIsSidebarHidden : undefined}
              />
            </Suspense>,
            home.container,
            home.key,
          );
        })}
        </LocalFSProvider>
      </UserDataProvider>
    </BackgroundProvider>
  );
};

export default App;
