import React, { useState, useRef } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { allocateMediaBatchTimestamps, compareMediaItemsNewestFirst, loadProjectMedia, saveProjectMedia, saveProjectCover } from '@willow/storage/media-storage';
import { readProjectRegistry, writeProjectRegistry } from '@willow/projects/registry';
import { transactionalRenameProject } from '@willow/projects/rename';
import { extractVideoFrame } from '@willow/storage/covers';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { atom } from 'nanostores';
import { useStore } from '@nanostores/react';
import { $mediaWorkRunning, MediaBackgroundContext } from './media-background';
import { $mediaResume, startMediaWorkJob, type MediaWorkJob } from './media-jobs';
import type { BackgroundJobHandle } from '@willow/core/background-jobs';
import {
  ArrowLeft, 
  MoreVertical, 
  Search, 
  Plus, 
  HelpCircle, 
  Settings, 
  ArrowRight,
  X,
  Scan,
  ChevronDown,
  Heart,
  Download,
  Share2,
  Flag,
  Crop,
  Info,
  Eye,
  EyeOff,
  Check,
  Folder,
  Film,
  Clipboard
} from 'lucide-react';
import { useAuth } from '@willow/auth/AuthContext';
import { Avatar } from '@willow/ui/Avatar';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import {
  ViewSettingsMenu,
  MoreMenu,
  AccountMenu,
  ProjectMenu,
  SortFilterMenu,
  DEFAULT_SORT_FILTER,
  loadViewSettings,
  saveViewSettings,
  type ViewSettings,
  type SortFilter,
} from './HeaderMenus';

/* Flow's header controls: 40x40 at a 12px radius, glyphs at 24px unfilled with weight axis 300,
 * and a hover state layer of rgb(218,220,224) at 0.1 over the whole button. */
const HEADER_ICON_BUTTON = 'w-10 h-10 shrink-0 flex items-center justify-center rounded-xl text-white hover:bg-[rgba(218,220,224,0.1)] transition-colors outline-none';
const HEADER_ICON_AXES = '"FILL" 0, "wght" 300';
/* Inter runs wider than Google Sans Text at the same declared size, so naming the face matters
 * for the project title's measured width, not just its shape. */
const PROJECT_NAME_FONT = "'Google Sans Text', 'Inter', system-ui, -apple-system, sans-serif";

/*
 * The header's search group, measured off Flow with `tools/ui-research/scrapers/flow/69-search.cjs`:
 * a 430x40 field, an 8px gap and a 42x40 Sort & Filter chip. The header's own insets are 24px left
 * and 20px right, and its right-hand controls sit 12px apart — the open field stops 12px short of
 * the account chip, which is the one control Flow keeps beside it.
 */
const SEARCH_FIELD_WIDTH = 430;
const SEARCH_GROUP_GAP = 8;
const SORT_FILTER_WIDTH = 42;
const SEARCH_GROUP_WIDTH = SEARCH_FIELD_WIDTH + SEARCH_GROUP_GAP + SORT_FILTER_WIDTH;
const HEADER_INSET_LEFT = 24;
const HEADER_INSET_RIGHT = 20;
const HEADER_GROUP_GAP = 12;
/*
 * One curve, both directions. Flow's search group computes `transition: 0.3s ease-in-out`, and it
 * reads the same open as closed, so opening and closing are one animation played either way. It lives
 * on the group two levels above the field; the field itself only transitions its border colour.
 *
 * An earlier pass here fitted two different beziers to Flow's traced *width* — 280ms opening, 230ms
 * closing — which was fitting the wrong quantity. The width is a layout consequence of this eased
 * group, and the header's other controls collapsing partway through put a kink in it that no single
 * bezier can follow, which is why those fits never got below ~13px and drifted 20ms depending on
 * which reps went in. The composite they did land on was front-loaded, and that is what made closing
 * look like the bar jumped before it shrank: at 50ms, ease-in-out has covered 5.7% of the travel
 * (Flow measures 5.2%), while 230ms of cubic-bezier(0.28, 0, 0.47, 0.91) has covered 28%.
 *
 * 270ms and not the 300ms Flow declares, because Flow's field does not take the full 300ms: the time
 * it spends between a quarter and three quarters of its travel is 82.6ms opening and 82.6ms closing,
 * and for a symmetric ease-in-out that span is 0.306 of the duration, so what is on screen runs 267ms
 * both ways. That milestone span is used in preference to lining the traces up at their start, because
 * both apps drop frames and the first moving sample is not the first moved pixel — an earlier attempt
 * to align on it reported 29% divergence on data that actually agreed. Measured against Willow's own
 * 300ms it recovers 302ms, so the estimator is sound.
 *
 * Position rides the same timing function as width deliberately. Flow never translates this row — its
 * left edge moves only because the width shrinks inside a centred container, which makes position
 * linear in the width's own progress. Sharing one curve reproduces that; giving transform its own
 * would not.
 */
const SEARCH_TRANSITION = 'width 270ms ease-in-out, transform 270ms ease-in-out';
import { useUserDataContext } from '@willow/auth/UserDataContext';
import { DEVICE_KEY_SLOT } from '@willow/auth/device-keys';
import { useLocalFS } from '@willow/storage/local-fs/LocalFSContext';
import { AssetMenuModal } from './AssetMenuModal';
import { AgentSidebar } from './AgentSidebar';
import { createMediaAgent, toAgentAttachments, type GenerationOutcome, type MediaAgentHost } from './agent/agent-session';
import type { AgentModelOption } from './agent/agent-tools';
import { AgentStatusText } from './agent/AgentStatusText';
import { MusicView } from './music/MusicView';
import { MusicPlayerSidebar } from './music/MusicPlayerSidebar';
import { RatioIcon } from './media-icons';
import type { MediaKind, MediaItem, ImageAttachment } from './types';
import { SUNFLOWER_BOX_SHADOW } from './sunflower-art';
import { MediaVideo, GalleryTile } from './GalleryTile';
import { getImageAr, computeMaxCropBox } from './crop-math';
import { estimateDropdownHeight, computeDropDirection } from './dropdown-placement';
import { type Annotation, buildAnnotationSystemPrompt } from './annotations';
import { AnnotationOverlay } from './AnnotationOverlay';
import { CropOverlay } from './CropOverlay';
import { PenMenu } from './PenMenu';
import { SelectMenu, CropMenu } from './ToolFlyouts';
import { liveModelId } from '@willow/core/model-catalog';
import {
  VIDEO_MODEL_CATALOG,
  fitVideoDuration,
  isOmniFlashModel,
  mediaModelLists,
  onModelPicksChange,
  readModelPick,
  resolveModelPick,
  videoApiModelId,
  videoDurationOptions,
  writeModelPick,
  type MediaModelKind,
} from './media-models';
import { onViewSettingsChange } from './view-settings';
import { useMediaDetailsSync } from './media-details-sync';
import { needsSongAudioFile, ownSongAudio, songAudioBaseName, songAudioFileName } from './song-audio';
import { importAgentSessions } from './agent/agent-session-files';
import { deletedHere, rememberDeleted } from './deleted-here';
import { PromptNotice, type PromptNoticeState } from './PromptNotice';
import { FlowLoadingPage } from './FlowLoadingPage';
import { PromptValue } from './PromptTextarea';
import { PromptEditor, type PromptEditorHandle, type PromptMention } from './PromptEditor';
import { SceneTile } from './scenes/SceneTile';
import { SceneMediaPicker } from './scenes/SceneMediaPicker';
import { FlowIcon, FlowMatDivider, FlowMatMenu, FlowMatMenuItem, SceneSnackbarHost } from './scenes/flow-ui';
import { $scenes, addVideoToScene, bindSceneProject, createEmptyScene, createSceneFromVideos, createSceneWithVideo, dropVideoScene, ensureVideoScene, getScene, isVideoScene, setSceneClips, setSceneOpener, showSnack, trashScene, updateScene as updateStoredScene, videoSceneId } from './scenes/scene-store';
import { readScenesFromFolder, useSceneFolderSync, type SceneFolder } from './scenes/scene-folder-sync';
import { captureFrame } from './scenes/scene-frames';
import { $collections, $collectionsLoaded, bindCollectionProject, collectionFolder, createCollection, deleteCollection, descendantsOf, getCollection, moveCollection, parentOf, renameCollection, updateCollection, type Collection } from './collections/collection-store';
import { CollectionTile } from './collections/CollectionTile';
import { DragPreview, PromptDropZone, sameDropTarget, type DropTarget } from './drag/DragPreview';
import { EditorBoundary, isChunkLoadError } from './EditorBoundary';
import { ConfirmDialog, FlagDialog, ShareDialog } from './editor/editor-overlays';
import { copyImage, downloadCollection } from './editor/media-download';
import { collectionPath, listCollections, MEDIA_AGENT_SESSIONS_FOLDER } from '@willow/storage/media-collections';
import type { SceneHost } from './scenes/scene-host';
import type { ImageEditHost } from './editor/ImageEditor';
import type { VideoViewHost } from './scenes/SceneBuilder';
import { $characters, $charactersLoaded, bindCharacterProject, characterName, createCharacter, deleteCharacter, getCharacter, setCharacterOpener, updateCharacter, type Character } from './characters/character-store';
import type { CharacterHost } from './characters/character-host';
import { readCharactersFromFolder, useCharacterFolderSync, type CharacterFolder } from './characters/character-folder-sync';
import { CHARACTERS_FOLDER } from './characters/character-files';
import { CharactersGrid, CharacterTile } from './characters/CharactersGrid';
import { CharacterIngredientCard } from './characters/CharacterIngredientCard';
import { expandCharacterReferences } from './characters/character-references';
import { BatchView, type LaidOutBatch } from './batch/BatchView';
import { BatchInfo, type BatchInfoModel } from './batch/BatchInfo';
import { isGenerated, legacyBatchKeys, ratioValue } from './batch/batch-layout';
import { GALLERY_GAP, layoutGallery, type GalleryCell } from './gallery-layout';
import { preloadableLazy } from './preloadable-lazy';
import { MediaSidebar } from './MediaSidebar';
import { MediaCompactHeader } from './MediaCompactHeader';
import { useKeyboardInset, useMediaViewport, useRailDrawer, useShortViewport } from './use-media-viewport';
import type { ToolsHost } from './tools/tools-host';
import { isToolsPath, parseToolsRoute, toolLocation, toolsLocation } from './tools/tools-routes';
import { $dock, $toolPrefs, initToolsStore, setDockOpen, togglePin } from './tools/tools-store';
import './flow-image-history.css';
import './media-responsive.css';

// Preloadable, so a switch between them in an editor's rail never draws an empty frame while a chunk loads.
const SceneBuilder = preloadableLazy(() => import('./scenes/SceneBuilder'));
const ImageEditor = preloadableLazy(() => import('./editor/ImageEditor'));

/** How long an editor's rail waits for the next item to be drawable before it switches anyway. */
const EDITOR_SWITCH_WAIT_MS = 1500;

/**
 * Resolves once `item` can open in its editor with a picture on its first frame — the editor's
 * chunk in, a video's scene made with its opening frame as the poster, an image decoded — or once
 * the wait is up.
 */
function readyToDraw(item: MediaItem): Promise<void> {
  const url = item.url;
  const sceneId = videoSceneId(item.id);
  const work = item.kind === 'video'
    ? Promise.all([
        SceneBuilder.preload(),
        url && ensureVideoScene({ id: item.id, url, ratio: item.ratio, name: item.shortenedPrompt || item.prompt })
          .then(() => captureFrame(url, 0, 640))
          .then((poster) => { if (!getScene(sceneId)?.poster) updateStoredScene(sceneId, { poster }); }),
      ])
    : Promise.all([ImageEditor.preload(), url && decodeImage(url)]);
  const wait = new Promise<void>((resolve) => window.setTimeout(resolve, EDITOR_SWITCH_WAIT_MS));
  return Promise.race([work.then(() => undefined, () => undefined), wait]);
}

const decodeImage = (url: string): Promise<void> => {
  const image = new Image();
  image.src = url;
  return image.decode();
};
const ToolsSurface = React.lazy(() => import('./tools/ToolsSurface'));
const NewCharacterPage = preloadableLazy(() => import('./characters/NewCharacterPage'));
const CharacterEditPage = preloadableLazy(() => import('./characters/CharacterEditPage'));

/** Scenes ride through the gallery's layout as items with this model id and a `scene:` id. */
const SCENE_ITEM_PREFIX = 'scene:';
/** So do collections, as square stand-ins with a `collection:` id. */
const COLLECTION_ITEM_PREFIX = 'collection:';
/** And characters, in All media as in Flow's, as square stand-ins with a `character:` id. */
const CHARACTER_ITEM_PREFIX = 'character:';
/**
 * A file on disk after a move: its name there, and its folder (none: Images/, Videos/, Audio/).
 * `audio`: a song's audio beside its cover.
 */
type FileMove = { id: string; fsName: string; folder?: string; audio?: boolean };
const EMPTY_ITEMS: MediaItem[] = [];
/** A collection's, a scene's or a character's place in the gallery: each is a batch of its own. */
const isStandIn = (m: MediaItem) => m.id.startsWith(COLLECTION_ITEM_PREFIX) || m.id.startsWith(SCENE_ITEM_PREFIX) || m.id.startsWith(CHARACTER_ITEM_PREFIX);
const tileAspect = (m: MediaItem) => ratioValue(m.ratio);
const tileIdOf = (m: MediaItem) => m.id;

const popupItemVariants = {
  hidden: { opacity: 1, y: 0, scale: 1 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0 },
  },
  exit: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0 },
  },
};

/* Flow uses semantic Google Symbol names for the non-16:9 ratios. The literal
 * `crop_4_3`/`crop_3_4` names are not glyphs in Flow's face and render as text. */
const flowRatioGlyph = (ratio: string) => ({
  '16:9': 'crop_16_9',
  '4:3': 'crop_landscape',
  '1:1': 'crop_square',
  '3:4': 'crop_portrait',
  '9:16': 'crop_9_16',
}[ratio] || 'crop_16_9');

// Returns a function whose identity never changes but which always invokes the
// latest render's implementation. Lets memoized tiles receive stable handler
// props (so React.memo actually holds) without freezing any state they read.
function useEventCallback<T extends (...args: any[]) => any>(fn: T): T {
  const ref = React.useRef(fn);
  React.useLayoutEffect(() => { ref.current = fn; });
  return React.useMemo(() => ((...args: any[]) => ref.current(...args)) as T, []);
}

const preloadImage = (url: string): Promise<void> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = url;
    if (img.complete) resolve();
  });
};

const preloadAllImages = async (urls: string[]): Promise<void> => {
  if (urls.length === 0) return;
  await Promise.race([
    Promise.all(urls.map(preloadImage)),
    new Promise((resolve) => window.setTimeout(resolve, 2500)),
  ]);
};

/** How one generation ended. The prompt box ignores it; the agent reports it to the model. */
type GenerationResult = { status: 'completed'; url: string } | { status: 'failed'; error: string };

/** '1x' / 'x2' / 'x4' → 1 / 2 / 4. */
const batchCount = (batch: string): number => Math.max(1, parseInt(batch.replace('x', ''), 10) || 1);

/* An overlay of an editor kept alive off screen: still laid out, never painted or hit. */
const BACKGROUND_OVERLAY_STYLE: React.CSSProperties = { opacity: 0, visibility: 'hidden', pointerEvents: 'none' };
/* The Tools pages' black while their chunk loads, so the gallery never shows through. */
const TOOLS_FALLBACK_STYLE: React.CSSProperties = {
  position: 'fixed',
  inset: 'var(--willow-frame-inset, 0)',
  borderRadius: 'var(--willow-frame-page-radius, 0)',
  zIndex: 900,
  background: '#000',
};

export const MediaView: React.FC<{
  onOpenSettings?: (tab?: 'models') => void;
  /** The host's live model config; without it the saved one is read once from localStorage. */
  modelConfig?: unknown;
}> = ({ onOpenSettings, modelConfig }) => {
  const { user, userProfile, signInWithGoogle, signOut } = useAuth();
  const { apiKeys } = useUserDataContext();
  const { chatScopeId, isLocalFolderConnected, isLocalFolderAuthorized, localFolderName, authorizeLocalFolder, saveLocalFSMedia, saveLocalFSCover, refreshLocalMedia, deleteLocalFSMediaFile, renameLocalFSMediaFile, renameLocalFSProject, loadLocalFSMediaUrl, ensureLocalFSCollectionFolder, moveLocalFSMediaFile, renameLocalFSCollectionFolder, deleteLocalFSCollectionFolder, saveLocalFSMediaAgentSession, deleteLocalFSMediaAgentSession, saveLocalFSScene, deleteLocalFSScene, listLocalFSScenes, saveLocalFSMediaDetails, listLocalFSMediaFolderFiles, saveLocalFSMediaFolderFile, deleteLocalFSMediaFolderFile } = useLocalFS();

  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  // The router's own `setSearchParams` resolves "?…" against the `/media/*` route's base, which
  // took /media/tools, a tool's page or a gallery tab to plain /media; this keeps the path. Read
  // from the address itself, which a navigation updates at once, so two calls in one tick both land.
  const setSearchParams = React.useCallback((update: (prev: URLSearchParams) => URLSearchParams, options?: { replace?: boolean }) => {
    const search = update(new URLSearchParams(window.location.search)).toString();
    navigate({ pathname: window.location.pathname, search: search ? `?${search}` : '' }, options);
  }, [navigate]);
  const projectId = searchParams.get('projectId') || '';

  // A store, not state: only the composer's controls subscribe (see PromptTextarea.tsx), so a
  // keystroke re-renders them instead of this whole page. One per mount, as state was, so a
  // project switch still starts from an empty prompt.
  const [promptStore] = React.useState(() => atom(searchParams.get('prompt') || ''));
  const [projectName, setProjectName] = React.useState(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const urlProjectId = urlParams.get('projectId');
      if (urlProjectId) {
        const urlTempName = urlParams.get('tempName');
        if (urlTempName) return urlTempName;

          try {
            const projects = readProjectRegistry() as any[];
            const match = projects.find((p: any) => p.id === urlProjectId);
            if (match) return match.name;
          } catch (e) {}
      }
    }
    return 'Default Project';
  });

  const projectNameRef = React.useRef(projectName);
  const projectIdRef = React.useRef(projectId);
  React.useEffect(() => {
    projectNameRef.current = projectName;
  }, [projectName]);
  React.useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);

  // Redirect to first project if projectId is missing
  React.useEffect(() => {
    if (!projectId) {
      const projects = readProjectRegistry() as any[];
      if (projects.length === 0) {
        return;
      }
      const firstId = projects[0].id;
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.set('projectId', firstId);
        return next;
      }, { replace: true });
    }
  }, [projectId, setSearchParams]);

  // Sync project name
  React.useEffect(() => {
    const updateProjectName = () => {
      if (!projectId) return;
      if (projectId.startsWith('temp_')) return;
        try {
          const projects = readProjectRegistry() as any[];
          const match = projects.find((p: any) => p.id === projectId);
          if (match) {
            setProjectName(match.name);
          }
        } catch (e) {}
    };

    updateProjectName();
    window.addEventListener('willow_projects_updated', updateProjectName);
    return () => window.removeEventListener('willow_projects_updated', updateProjectName);
  }, [projectId]);

  // ── Header popover menus ────────────────────────────────────────────────
  // One piece of state rather than three booleans: the menus are mutually exclusive, and
  // opening one while another is up has to close the other, not stack them.
  const [openHeaderMenu, setOpenHeaderMenu] = React.useState<'project' | 'settings' | 'more' | 'filter' | 'add' | null>(null);
  const addMenuButtonRef = React.useRef<HTMLButtonElement>(null);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = React.useState(false);
  const projectMenuButtonRef = React.useRef<HTMLButtonElement>(null);
  const viewSettingsButtonRef = React.useRef<HTMLButtonElement>(null);
  const moreMenuButtonRef = React.useRef<HTMLButtonElement>(null);
  const sortFilterButtonRef = React.useRef<HTMLButtonElement>(null);
  const [viewSettings, setViewSettings] = React.useState<ViewSettings>(loadViewSettings);
  // Only a change is saved: the defaults of a browser that has none saved are not a choice, and
  // settings.json may yet bring the user's. That (or another tab) changes them under the page.
  const savedViewSettingsRef = React.useRef(viewSettings);
  React.useEffect(() => {
    if (viewSettings === savedViewSettingsRef.current) return;
    savedViewSettingsRef.current = viewSettings;
    saveViewSettings(viewSettings);
  }, [viewSettings]);
  React.useEffect(() => onViewSettingsChange(() => {
    const saved = loadViewSettings();
    savedViewSettingsRef.current = saved;
    setViewSettings((current) => (JSON.stringify(current) === JSON.stringify(saved) ? current : saved));
  }), []);
  const [sortFilter, setSortFilter] = React.useState<SortFilter>(DEFAULT_SORT_FILTER);
  const closeHeaderMenu = React.useCallback(() => setOpenHeaderMenu(null), []);

  // ── Phones and tablets (media-responsive.css) ───────────────────────────
  // Below 961px the header is MediaCompactHeader, the rail is a drawer on a phone (upright or on its
  // side) and an icon rail that opens one on a tablet, and the gallery's rows are shorter. A
  // navigation closes the drawer.
  const viewport = useMediaViewport();
  const isNarrow = viewport !== 'desktop';
  useKeyboardInset(isNarrow);
  /** A phone on its side: a tablet's width, but a phone's rows. */
  const isShortNarrow = useShortViewport() && isNarrow;
  const [isNavDrawerOpen, setIsNavDrawerOpen] = React.useState(false);
  React.useEffect(() => { setIsNavDrawerOpen(false); }, [location.pathname, location.search, isNarrow]);
  const compactSearchFormRef = React.useRef<HTMLFormElement>(null);
  const railAsDrawer = useRailDrawer();
  const railPresentation = railAsDrawer ? 'drawer' : viewport === 'tablet' ? 'rail' : 'desktop';

  // ── Header search ───────────────────────────────────────────────────────
  // Open is a mode, not a focus state — Flow's field stays wide after the pointer goes elsewhere
  // and only Escape or its own back arrow puts it away, which is also what clears the query.
  const [searchQuery, setSearchQuery] = React.useState('');
  const [isSearchOpen, setIsSearchOpen] = React.useState(false);
  /*
   * The open field's geometry is measured, but it is deliberately NOT state. Setting state from the
   * layout effect below would commit a second full MediaView render on every open and every close,
   * and this component renders the whole gallery inline — so that second pass re-creates every tile
   * for a change that only ever moves one row in the header. Measured values go to a ref and are
   * written straight to the node instead; the ref is read during render only so that an unrelated
   * re-render (typing in the field) re-emits the width the node already has rather than snapping it
   * back to resting.
   */
  const searchGeometryRef = React.useRef<{ dx: number; width: number } | null>(null);
  const headerRef = React.useRef<HTMLElement>(null);
  const searchSlotRef = React.useRef<HTMLDivElement>(null);
  const searchGroupRef = React.useRef<HTMLDivElement>(null);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const accountButtonRef = React.useRef<HTMLButtonElement>(null);

  const openSearch = React.useCallback(() => {
    setIsSearchOpen(true);
    // The width animation starts this frame; focusing after it would scroll the header.
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }, []);
  const closeSearch = React.useCallback(() => {
    setIsSearchOpen(false);
    setSearchQuery('');
    searchInputRef.current?.blur();
  }, []);

  /*
   * Where the open field has to reach: from the header's own left inset to the account chip, which
   * is the one control Flow keeps visible beside it. Measured rather than derived, because the
   * slot's resting position depends on the project name's length and the chip's on the user's name.
   * The slot itself never moves — only the row inside it is transformed — so reading it while open
   * is stable.
   *
   * Writing width/transform to the node here still animates: React has already committed this
   * render's `transition` by the time layout effects run, and the node is still painted at its
   * previous values, so the change is what the transition interpolates from.
   */
  React.useLayoutEffect(() => {
    const apply = () => {
      const group = searchGroupRef.current;
      if (!group) return;
      const geometry = isSearchOpen ? searchGeometryRef.current : null;
      group.style.width = geometry ? `${geometry.width}px` : `min(${SEARCH_GROUP_WIDTH}px, 100%)`;
      group.style.transform = `translateX(${geometry ? geometry.dx : 0}px)`;
    };
    if (!isSearchOpen) {
      searchGeometryRef.current = null;
      apply();
      return undefined;
    }
    const measure = () => {
      const slot = searchSlotRef.current;
      const header = headerRef.current;
      if (!slot || !header) return;
      const headerBox = header.getBoundingClientRect();
      const slotBox = slot.getBoundingClientRect();
      const chipBox = accountButtonRef.current?.getBoundingClientRect();
      const left = headerBox.left + HEADER_INSET_LEFT;
      const right = (chipBox ? chipBox.left : headerBox.right - HEADER_INSET_RIGHT) - HEADER_GROUP_GAP;
      // The resting group must fit its responsive slot; otherwise closing can overshoot its right edge.
      const closedWidth = Math.min(SEARCH_GROUP_WIDTH, slotBox.width);
      searchGeometryRef.current = { dx: left - slotBox.left, width: Math.max(closedWidth, right - left) };
      apply();
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [isSearchOpen]);

  React.useEffect(() => {
    if (!isSearchOpen) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeSearch(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isSearchOpen, closeSearch]);

  /*
   * Clicking away closes it — but only with nothing typed, which is the rule Flow follows and not an
   * arbitrary one: while a query is live an outside click there leaves the bar open and merely blurs
   * it, so the results you are reading stay on screen with the terms that produced them still visible.
   * Escape is the gesture that closes regardless, and it clears as it goes.
   *
   * On pointerdown rather than click, because Flow's bar is already closed before the mouse comes back
   * up. The filter menu is portalled to the body, so in the DOM it is outside the group and has to be
   * excluded by hand or picking a sort order would dismiss the search sitting behind it.
   */
  React.useEffect(() => {
    if (!isSearchOpen) return undefined;
    const onPointerDown = (e: PointerEvent) => {
      if (searchQuery) return;
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (searchGroupRef.current?.contains(target) || compactSearchFormRef.current?.contains(target)) return;
      if (target.closest('[role="menu"], [role="dialog"]')) return;
      closeSearch();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [isSearchOpen, searchQuery, closeSearch]);

  // ── Top-left project rename ─────────────────────────────────────────────
  const [isEditingProjectName, setIsEditingProjectName] = React.useState(false);
  const [editingProjectNameValue, setEditingProjectNameValue] = React.useState('');
  // Set when Enter/Escape already resolved the edit, so the input's onBlur
  // (which fires as it unmounts) doesn't commit a second time / after cancel.
  const projectRenameResolvedRef = React.useRef(false);
  // Timestamp until which disk-change-triggered gallery reloads are suppressed
  // (invariant #13): the folder move behind a project rename fires a burst of
  // FileSystemObserver events (one per copied file), and reloading off a
  // half-moved folder blanks/reshuffles the grid. MAX_SAFE_INTEGER while the
  // move runs; a short settle window after; then ONE clean reload.
  const renameReloadGuardRef = React.useRef(0);
  // Latest loadMedia (defined later in the file) for the post-rename reload.
  const loadMediaRef = React.useRef<(skipIfGenerating: boolean) => void>(() => {});

  const commitProjectRename = React.useCallback(async (rawName: string) => {
    setIsEditingProjectName(false);
    const oldName = projectNameRef.current;
    if (!projectId || rawName === oldName) return;
    const realId = projectId.startsWith('temp_') ? projectId.replace('temp_', '') : projectId;
    if (isLocalFolderConnected) {
      renameReloadGuardRef.current = Number.MAX_SAFE_INTEGER;
    }
    const commitName = (newName: string) => {
      projectNameRef.current = newName;
      setProjectName(newName);
    };
    const result = await transactionalRenameProject({
      projectId,
      rawName,
      currentName: oldName,
      isLocalFolderConnected,
      renameLocalFSProject,
      findProject: (projects) => projects.find((project) => project.id === projectId)
        || projects.find((project) => project.id === realId)
        || (projectId.startsWith('temp_')
          ? projects.find((project) => project.name === oldName && project.kind === 'media')
          : undefined),
      allowUnregistered: projectId.startsWith('temp_'),
      commitRegistered: commitName,
      commitUnregistered: (newName) => {
        commitName(newName);
        setSearchParams(prev => {
          const next = new URLSearchParams(prev);
          next.set('tempName', newName);
          return next;
        }, { replace: true });
      },
    });
    if (!result.ok) console.error('Failed to rename media project:', result.error);
    if (isLocalFolderConnected) {
      renameReloadGuardRef.current = Date.now() + 800;
      window.setTimeout(() => { loadMediaRef.current(false); }, 850);
    }
  }, [isLocalFolderConnected, projectId, renameLocalFSProject, setSearchParams]);


  // Media loading is consolidated into ONE projectId-keyed effect below
  // ("Unified media load"). It reconciles with disk when a folder is connected
  // (disk = source of truth) and hydrates streaming blob: URLs, or falls back to
  // IndexedDB base64 when there's no folder. Do NOT add a second load path or a
  // reload poll here — divergent load paths previously wiped the gallery.


  // Parse prompt from URL search parameters if passed
  React.useEffect(() => {
    const urlPrompt = searchParams.get('prompt');
    if (urlPrompt) {
      promptStore.set(urlPrompt);
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.delete('prompt');
        return next;
      }, { replace: true });
    }
  }, [searchParams, setSearchParams, promptStore]);

  // Item ids with a disk write currently in flight. Generation completion
  // (saveGeneratedMedia) and the auto-sync backfill effect can both see the
  // same just-completed unsaved item at the same moment; without this guard
  // both saved it and the collision numbering minted "X.png" + "X (1).png",
  // which the reconciler then ingested as a phantom duplicate tile.
  const fsSaveInFlightRef = React.useRef<Set<string>>(new Set());

  // A song's audio goes beside its cover, named after it, so the folder holds the song and not only
  // its picture. The audio file's name, or undefined when it could not be written.
  const saveSongAudio = React.useCallback(async (item: MediaItem, inProject: string, coverFsName: string, folder: string | undefined): Promise<string | undefined> => {
    if (!item.audioUrl) return undefined;
    try {
      const blob = await (await fetch(item.audioUrl)).blob();
      return (await saveLocalFSMedia(inProject, 'audio', songAudioFileName(coverFsName, blob.type), blob, folder)) || undefined;
    } catch {
      return undefined;
    }
  }, [saveLocalFSMedia]);

  const saveGeneratedMedia = React.useCallback(async (item: MediaItem, url: string) => {
    if (!isLocalFolderConnected) return;
    // If the user switched projects while this generation was in flight, the
    // item no longer exists in the current gallery — bail, or the file would
    // be written into the NEW project's folder (projectNameRef tracks the
    // current project) and reconcile in as a foreign tile there.
    if (!mediaItemsRef.current.some(m => m.id === item.id)) return;
    if (fsSaveInFlightRef.current.has(item.id)) return;
    fsSaveInFlightRef.current.add(item.id);
    try {
      const currentProjectName = projectNameRef.current;
      const name = item.shortenedPrompt || item.prompt;
      const ext = item.kind === 'video' ? 'mp4' : 'png';
      const cleanName = name.replace(/[\/:*?"<>|]/g, '').trim() || 'media';
      const filename = `${cleanName}.${ext}`;

      const response = await fetch(url);
      const blob = await response.blob();
      const live = mediaItemsRef.current.find(m => m.id === item.id);
      const folder = collectionFolder(live?.collectionId);
      const finalName = await saveLocalFSMedia(currentProjectName, item.kind, filename, blob, folder);
      if (finalName) {
        const audioFsName = item.kind === 'audio' ? await saveSongAudio(item, currentProjectName, finalName, folder) : undefined;
        setMediaItems(prev => prev.map(m => m.id === item.id ? { ...m, isSavedToFS: true, fsName: finalName, ...(audioFsName ? { audioFsName } : {}) } : m));
      }
    } catch (err) {
      // Ignored to prevent debugging logs in production
    } finally {
      fsSaveInFlightRef.current.delete(item.id);
    }
  }, [isLocalFolderConnected, saveLocalFSMedia, saveSongAudio]);
  const [isAgentActive, setIsAgentActive] = React.useState(false);
  const [isAgentSidebarOpen, setIsAgentSidebarOpen] = React.useState(false);
  const [activeMusicItem, setActiveMusicItem] = React.useState<MediaItem | null>(null);

  const isRightSidebarOpen = isAgentSidebarOpen || !!activeMusicItem;
  const prevIsRightSidebarOpen = React.useRef(isRightSidebarOpen);
  const isRightSidebarToggling = prevIsRightSidebarOpen.current !== isRightSidebarOpen;
  
  React.useEffect(() => {
    prevIsRightSidebarOpen.current = isRightSidebarOpen;
  }, [isRightSidebarOpen]);
  const [agentAnimationKey, setAgentAnimationKey] = React.useState(0);

  // One agent conversation per mount, like the prompt. MediaView subscribes only to whether a
  // turn is running; the transcript streams into stores that AgentSidebar alone reads. The host
  // ref is assigned on every render further down, once the generation functions it exposes exist.
  const agentHostRef = React.useRef<MediaAgentHost | null>(null);
  const [mediaAgent] = React.useState(() => createMediaAgent({
    getHost: () => agentHostRef.current as MediaAgentHost,
    scopeId: chatScopeId,
  }));
  const isAgentGenerating = useStore(mediaAgent.$running);
  React.useEffect(() => () => mediaAgent.dispose(), [mediaAgent]);
  const activeSidebarTab = React.useMemo(() => {
    const parts = location.pathname.split('/');
    const lastPart = parts[parts.length - 1];
    return ['images', 'video', 'characters', 'music', 'scenes', 'uploads', 'tools'].includes(lastPart) ? lastPart : 'all';
  }, [location.pathname]);
  
  const activeSidebarTabRef = React.useRef(activeSidebarTab);
  React.useEffect(() => {
    activeSidebarTabRef.current = activeSidebarTab;
  }, [activeSidebarTab]);
  // Flow's Tools pages (/media/tools, /media/tool/<id>, /media/create-tool) sit over the gallery;
  // the rail's dock lists the pinned and recent tools wherever Media is.
  const toolsRoute = React.useMemo(() => parseToolsRoute(location.pathname, location.search), [location.pathname, location.search]);
  const toolDock = useStore($dock);
  const toolDockOpen = !!useStore($toolPrefs).dockOpen;
  React.useEffect(() => { void initToolsStore(chatScopeId || 'guest'); }, [chatScopeId]);
  const [activeMenuId, setActiveMenuId] = React.useState<string | null>(null);
  const [canvasContextMenuCoords, setCanvasContextMenuCoords] = React.useState<{ x: number; y: number } | null>(null);
  const [canvasMenuStyle, setCanvasMenuStyle] = React.useState<React.CSSProperties>({});
  const canvasMenuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClose = (event: Event) => {
      if (event.type === 'scroll') {
        setCanvasContextMenuCoords(null);
        return;
      }
      
      const mouseEvent = event as MouseEvent;
      const clickedOutsideCanvasMenu = canvasMenuRef.current && !canvasMenuRef.current.contains(mouseEvent.target as Node);
      
      if (clickedOutsideCanvasMenu) {
        setCanvasContextMenuCoords(null);
      }
    };

    if (canvasContextMenuCoords) {
      document.addEventListener('mousedown', handleClose, { capture: true });
      document.addEventListener('scroll', handleClose, { capture: true, passive: true });
    }
    return () => {
      document.removeEventListener('mousedown', handleClose, { capture: true });
      document.removeEventListener('scroll', handleClose, { capture: true });
    };
  }, [canvasContextMenuCoords]);

  const [hoveredTileId, setHoveredTileId] = React.useState<string | null>(null);
  const [draggingItemId, setDraggingItemId] = React.useState<string | null>(null);
  const [, setDragMousePos] = React.useState({ x: 0, y: 0 });
  /** What a drop would hit right now (drag/DragPreview.tsx); set only when it changes. */
  const [dropTarget, setDropTarget] = React.useState<DropTarget | null>(null);
  const dropTargetRef = React.useRef<DropTarget | null>(null);
  /** The tiles a drag carries: the whole selection when it starts on a selected tile. */
  const dragIdsRef = React.useRef<string[]>([]);
  const dragPreviewRef = React.useRef<HTMLDivElement>(null);
  const dragStartPointRef = React.useRef({ x: 0, y: 0 });
  /* Focus anywhere inside the composer, not just the textarea: Flow lifts the whole shell, and
   * React's onFocus/onBlur are focusin/focusout, so one pair on the shell covers the controls. */
  const [isComposerFocused, setIsComposerFocused] = React.useState(false);
  
  // React state for overlap calculations (can lag by 1 frame safely)
  const [selectionBox, setSelectionBox] = React.useState<{ 
    startX: number; 
    startY: number; 
    currentX: number; 
    currentY: number;
    startScrollTop: number;
    startScrollLeft: number;
  } | null>(null);
  
  // Refs for zero-latency direct DOM visual updates
  const selectionBoxRef = React.useRef<HTMLDivElement>(null);
  const selectionDragStartRef = React.useRef<{
    startX: number;
    startY: number;
    startScrollTop: number;
    startScrollLeft: number;
  } | null>(null);

  const [selectedTileIds, setSelectedTileIds] = React.useState<Set<string>>(new Set());
  const [isCreatingMusic, setIsCreatingMusic] = React.useState(false);
  const isSelectingRef = React.useRef(false);
  const mouseViewportPosRef = React.useRef({ x: 0, y: 0 });

  // Zero-latency visual updater
  const updateSelectionBoxVisuals = React.useCallback(() => {
    if (!selectionBoxRef.current || !mainRef.current || !isSelectingRef.current || !selectionDragStartRef.current) return;
    
    const el = mainRef.current;
    const rect = el.getBoundingClientRect();
    const dragStart = selectionDragStartRef.current;
    
    const scrollDiffX = el.scrollLeft - dragStart.startScrollLeft;
    const scrollDiffY = el.scrollTop - dragStart.startScrollTop;
    
    const viewStartX = dragStart.startX - scrollDiffX;
    const viewStartY = dragStart.startY - scrollDiffY;
    const viewCurrentX = mouseViewportPosRef.current.x;
    const viewCurrentY = mouseViewportPosRef.current.y;
    
    const rawLeft = Math.min(viewStartX, viewCurrentX);
    const rawTop = Math.min(viewStartY, viewCurrentY);
    const rawRight = Math.max(viewStartX, viewCurrentX);
    const rawBottom = Math.max(viewStartY, viewCurrentY);
    
    const left = Math.max(rawLeft, rect.left);
    const top = Math.max(rawTop, rect.top);
    const right = Math.min(rawRight, rect.right);
    const bottom = Math.min(rawBottom, rect.bottom);
    
    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);
    
    selectionBoxRef.current.style.left = `${left}px`;
    selectionBoxRef.current.style.top = `${top}px`;
    selectionBoxRef.current.style.width = `${width}px`;
    selectionBoxRef.current.style.height = `${height}px`;
    selectionBoxRef.current.style.display = (width === 0 || height === 0) ? 'none' : 'block';
  }, []);

  React.useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isSelectingRef.current) return;
      
      // Track screen/viewport coordinates
      mouseViewportPosRef.current = { x: e.clientX, y: e.clientY };
      setDragMousePos({ x: e.clientX, y: e.clientY });

      // Synchronous DOM update for zero lag
      updateSelectionBoxVisuals();

      setSelectionBox(prev => {
        if (!prev) return null;
        return { ...prev, currentX: e.clientX, currentY: e.clientY };
      });
    };

    const handleMouseUp = () => {
      if (isSelectingRef.current) {
        isSelectingRef.current = false;
        setTimeout(() => setSelectionBox(null), 0); // Give a tick so click handlers know we were selecting if needed
      }
    };

    const handleGlobalMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target?.closest) return;
      if (selectedItemRef.current !== null || activeSidebarTabRef.current === 'characters' || isToolsPath(window.location.pathname)) return;
      const isInsideTile = target.closest('.gallery-tile');
      const isButtonOrInteractive = target.closest('button, input, select, textarea, a, [role="button"], .interactive-element, .custom-scrollbar-thumb');
      
      if (e.button === 0 && !isInsideTile && !isButtonOrInteractive) {
        setSelectedTileIds(new Set());
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('mousedown', handleGlobalMouseDown);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mousedown', handleGlobalMouseDown);
    };
  }, []);

  const handleCanvasContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    
    const target = e.target as HTMLElement;
    if (
      target.closest('.gallery-tile') ||
      target.closest('button') ||
      target.closest('input') ||
      target.closest('textarea') ||
      target.closest('a') ||
      target.closest('.prompt-container-box') ||
      target.closest('.search-container') ||
      target.closest('.agent-sidebar-container') ||
      target.closest('.asset-menu-modal-container') ||
      target.closest('[role="button"]') ||
      target.closest('.interactive-element') ||
      target.closest('.custom-scrollbar-thumb')
    ) {
      return;
    }

    setActiveMenuId(null);

    const x = e.clientX - 4;
    const y = e.clientY - 4;
    const dropdownWidth = 180;
    const dropdownHeight = 145;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = x;
    if (left + dropdownWidth > viewportWidth - 4) {
      left = viewportWidth - dropdownWidth - 4;
    }
    if (left < 4) left = 4;

    let top = y;
    if (top + dropdownHeight > viewportHeight - 4) {
      top = viewportHeight - dropdownHeight - 4;
      if (top < 4) {
        top = 4;
      }
    }

    setCanvasMenuStyle({
      position: 'fixed',
      left: `${left}px`,
      top: `${top}px`,
      width: `${dropdownWidth}px`,
      zIndex: 9999,
      transformOrigin: 'top left',
    });

    setCanvasContextMenuCoords({ x: e.clientX, y: e.clientY });
  };

  React.useEffect(() => {
    if (!selectionBox || !mainRef.current) return;
    
    // Calculate unclipped viewport coordinates of the selection box using initial and current scroll diffs
    const scrollDiffX = mainRef.current.scrollLeft - selectionBox.startScrollLeft;
    const scrollDiffY = mainRef.current.scrollTop - selectionBox.startScrollTop;
    
    const viewStartX = selectionBox.startX - scrollDiffX;
    const viewStartY = selectionBox.startY - scrollDiffY;
    const viewCurrentX = selectionBox.currentX;
    const viewCurrentY = selectionBox.currentY;
    
    const boxLeft = Math.min(viewStartX, viewCurrentX);
    const boxRight = Math.max(viewStartX, viewCurrentX);
    const boxTop = Math.min(viewStartY, viewCurrentY);
    const boxBottom = Math.max(viewStartY, viewCurrentY);

    const tiles = mainRef.current.querySelectorAll('.gallery-tile');
    const newSelected = new Set<string>();
    tiles.forEach(tile => {
      const tileRect = tile.getBoundingClientRect();
      const overlap = !(
        tileRect.right < boxLeft ||
        tileRect.left > boxRight ||
        tileRect.bottom < boxTop ||
        tileRect.top > boxBottom
      );
      if (overlap) {
        const id = (tile as HTMLElement).dataset.id;
        if (id) newSelected.add(id);
      }
    });
    setSelectedTileIds(newSelected);
  }, [selectionBox]);

  // Ref to track the mousedown origin for drag threshold detection
  const customDragStartRef = React.useRef<{ itemId: string; startX: number; startY: number } | null>(null);
  // Flag to suppress the click event that fires after mouseup ends a drag
  const wasDraggingRef = React.useRef(false);

  // Flow's drop targets, by what is under the pointer: the composer's slots (drag/DragPreview.tsx),
  // the sidebar's Trash, a collection, or — for videos only, as Willow's scenes hold video clips —
  // a scene. Anything else takes no drop, and releasing there does nothing. A collection can't go
  // into itself or into a collection inside it, and a drag with a collection in it takes nothing
  // into the composer: Flow still lights the slot under the pointer, but shows no label and drops
  // nothing there (`collectionSlot`).
  const dragHasCollection = () => dragIdsRef.current.some((id) => id.startsWith(COLLECTION_ITEM_PREFIX));
  const collectionSlot = (target: DropTarget | null) =>
    (target?.kind === 'prompt' || target?.kind === 'start' || target?.kind === 'end') && dragHasCollection();
  const dropTargetAt = (x: number, y: number): DropTarget | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!el) return null;
    const draggedCollections = dragIdsRef.current.filter((id) => id.startsWith(COLLECTION_ITEM_PREFIX)).map((id) => id.slice(COLLECTION_ITEM_PREFIX.length));
    const zone = el.closest<HTMLElement>('[data-drop-zone]')?.dataset.dropZone;
    if (zone === 'start' || zone === 'end' || zone === 'prompt') return { kind: zone };
    if (el.closest('[data-drop-trash]')) return { kind: 'trash' };
    const collectionId = el.closest<HTMLElement>('[data-drop-collection]')?.dataset.dropCollection;
    if (collectionId) {
      const intoItself = draggedCollections.some((id) => id === collectionId || descendantsOf(id).some((c) => c.id === collectionId));
      return intoItself ? null : { kind: 'collection', id: collectionId };
    }
    const sceneId = el.closest<HTMLElement>('[data-drop-scene]')?.dataset.dropScene;
    if (sceneId && dragIdsRef.current.every((id) => mediaItemsRef.current.find((m) => m.id === id)?.kind === 'video')) {
      return { kind: 'scene', id: sceneId };
    }
    return null;
  };

  // Custom mouse-based drag system (replaces HTML5 drag to allow mouse wheel scrolling)
  React.useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // Check if we need to activate drag (threshold of 5px)
      if (customDragStartRef.current && !draggingItemId) {
        const dx = e.clientX - customDragStartRef.current.startX;
        const dy = e.clientY - customDragStartRef.current.startY;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
          const itemId = customDragStartRef.current.itemId;
          const withSelection = selectedTileIds.has(itemId) && selectedTileIds.size > 1;

          // If dragging an item that is not part of the selection, clear selection
          if (!selectedTileIds.has(itemId)) {
            setSelectedTileIds(new Set());
          }

          dragIdsRef.current = withSelection ? [itemId, ...[...selectedTileIds].filter((id) => id !== itemId)] : [itemId];
          dragStartPointRef.current = { x: e.clientX, y: e.clientY };
          mouseViewportPosRef.current = { x: e.clientX, y: e.clientY };
          setDraggingItemId(itemId);
          document.body.style.userSelect = 'none';
        }
        return;
      }

      // The preview follows the pointer without a render; only a change of target renders.
      if (draggingItemId) {
        mouseViewportPosRef.current = { x: e.clientX, y: e.clientY };
        const preview = dragPreviewRef.current;
        if (preview) {
          preview.style.left = `${e.clientX}px`;
          preview.style.top = `${e.clientY}px`;
        }
        const next = dropTargetAt(e.clientX, e.clientY);
        if (!sameDropTarget(next, dropTargetRef.current)) {
          dropTargetRef.current = next;
          setDropTarget(next);
        }
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      // Cancel a potential drag that never crossed the threshold
      if (customDragStartRef.current && !draggingItemId) {
        customDragStartRef.current = null;
        return;
      }

      if (!draggingItemId) return;

      document.body.style.userSelect = '';
      const items = dragIdsRef.current
        .map((id) => mediaItemsRef.current.find((m) => m.id === id))
        .filter((m): m is MediaItem => !!m);
      const collections = dragIdsRef.current
        .filter((id) => id.startsWith(COLLECTION_ITEM_PREFIX))
        .map((id) => getCollection(id.slice(COLLECTION_ITEM_PREFIX.length)))
        .filter((c): c is Collection => !!c);
      const target = dropTargetAt(e.clientX, e.clientY);
      dropDraggedItems(collectionSlot(target) ? null : target, items, collections);

      dropTargetRef.current = null;
      setDropTarget(null);
      setDraggingItemId(null);
      customDragStartRef.current = null;
      // Suppress the click event that the browser fires right after mouseup
      wasDraggingRef.current = true;
      requestAnimationFrame(() => { wasDraggingRef.current = false; });
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingItemId, selectedTileIds]);

  // Auto-scroll when dragging near edges
  React.useEffect(() => {
    if (!draggingItemId && !selectionBox) return;

    let animationFrameId: number;
    
    const scrollLoop = () => {
      const el = mainRef.current;
      if (!el) {
        animationFrameId = requestAnimationFrame(scrollLoop);
        return;
      }
      
      const rect = el.getBoundingClientRect();
      const pointer = mouseViewportPosRef.current;
      const mouseY = pointer.y;
      
      const threshold = 140;
      const topBoundary = rect.top + threshold;
      const bottomBoundary = rect.bottom - threshold;
      
      if (mouseY < topBoundary && mouseY > rect.top) {
        const distance = topBoundary - mouseY;
        const speed = Math.min(25, (distance / threshold) * 25);
        el.scrollTop -= speed;
      } else if (mouseY > bottomBoundary && mouseY < rect.bottom) {
        // Don't auto-scroll down when hovering over the prompt box or frame drop zones
        const elUnder = document.elementFromPoint(pointer.x, mouseY);
        const isOverDropTarget = elUnder?.closest('.prompt-container-box, [data-drop-zone]');
        if (!isOverDropTarget) {
          const distance = mouseY - bottomBoundary;
          const speed = Math.min(25, (distance / threshold) * 25);
          el.scrollTop += speed;
        }
      }
      
      animationFrameId = requestAnimationFrame(scrollLoop);
    };
    
    animationFrameId = requestAnimationFrame(scrollLoop);
    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [draggingItemId, selectionBox !== null]);

  const promptEditorRef = React.useRef<PromptEditorHandle>(null);

  // Full-screen Image viewer modal states
  const [selectedItem, setSelectedItem] = React.useState<MediaItem | null>(null);
  const pendingViewerItemIdRef = React.useRef<string | null>(null);
  const [fullscreenMusicItem, setFullscreenMusicItem] = React.useState<MediaItem | null>(null);
  const selectedItemRef = React.useRef(selectedItem);
  React.useEffect(() => {
    selectedItemRef.current = selectedItem;
  }, [selectedItem]);

  const [showHistory, setShowHistory] = React.useState(true);
  const [activeTool, setActiveTool] = React.useState<'crop' | 'pen' | 'select'>('pen');
  const [showPenMenu, setShowPenMenu] = React.useState(false);
  const [showSelectMenu, setShowSelectMenu] = React.useState(false);
  const [showCropMenu, setShowCropMenu] = React.useState(false);
  const [activeSelectSubTool, setActiveSelectSubTool] = React.useState<'box' | 'lasso'>('box');
  const [activeCropRatio, setActiveCropRatio] = React.useState<'16:9' | '9:16' | '1:1' | 'freeform'>('16:9');
  const [pendingTool, setPendingTool] = React.useState<'crop' | 'pen' | 'select' | null>(null);
  const [previousTool, setPreviousTool] = React.useState<'pen' | 'select'>('pen');
  const [activeColor, setActiveColor] = React.useState('#ff0000');
  const [penSize, setPenSize] = React.useState(4);
  const [activePenSubTool, setActivePenSubTool] = React.useState<'draw' | 'text' | 'rect'>('draw');
  const [showColorPicker, setShowColorPicker] = React.useState(false);

  // Carousel animation states
  const [isAnimating, setIsAnimating] = React.useState(false);
  const [xTranslate, setXTranslate] = React.useState(-176);
  const targetItemRef = React.useRef<MediaItem | null>(null);
  const [editPrompt, setEditPrompt] = React.useState('');
  const [viewerModelId, setViewerModelId] = React.useState<string>('');
  const [isViewerModelDropdownOpen, setIsViewerModelDropdownOpen] = React.useState(false);
  const viewerModelDropdownRef = React.useRef<HTMLDivElement>(null);
  const [viewerAttachments, setViewerAttachments] = React.useState<ImageAttachment[]>([]);
  const [expandedHistoryPrompts, setExpandedHistoryPrompts] = React.useState<Set<string>>(new Set());
  const [expandableHistoryPrompts, setExpandableHistoryPrompts] = React.useState<Set<string>>(new Set());

  // Flow keeps prompt expansion ephemeral. Opening another history item starts
  // collapsed again, while the current item's own expand/collapse choice stays
  // intact across live metadata updates.
  React.useEffect(() => {
    setExpandedHistoryPrompts(new Set());
    setExpandableHistoryPrompts(new Set());
  }, [selectedItem?.id]);
  const [viewerRemovingIds, setViewerRemovingIds] = React.useState<Set<string>>(new Set());
  const hasViewerAttachments = viewerAttachments.length > 0 && !viewerAttachments.every(att => viewerRemovingIds.has(att.id));
  const [isViewerAssetMenuOpen, setIsViewerAssetMenuOpen] = React.useState(false);
  const viewerAssetMenuPlusRef = React.useRef<HTMLButtonElement>(null);
  const viewerFileInputRef = React.useRef<HTMLInputElement>(null);
  const viewerTextareaRef = React.useRef<HTMLTextAreaElement>(null);
  const [isViewerTopFaded, setIsViewerTopFaded] = React.useState(false);
  const [isViewerBottomFaded, setIsViewerBottomFaded] = React.useState(false);
  // Interactive crop box state (all values in % of image container 0-100)
  const [cropBox, setCropBox] = React.useState({ x: 0, y: 0, w: 100, h: 100 });
  const cropContainerRef = React.useRef<HTMLDivElement>(null);
  const toolbarRef = React.useRef<HTMLDivElement>(null);
  const cropDragRef = React.useRef<{
    type: 'move' | 'nw' | 'ne' | 'sw' | 'se';
    startMouseX: number;
    startMouseY: number;
    startBox: { x: number; y: number; w: number; h: number };
  } | null>(null);

  // Initialize crop box when ratio changes while in crop mode
  React.useEffect(() => {
    if (activeTool === 'crop') {
      setCropBox(computeMaxCropBox(activeCropRatio, getImageAr(selectedItem?.ratio)));
    }
  }, [activeCropRatio, activeTool, selectedItem]);

  // Crop drag handlers
  const getCropMousePct = (e: MouseEvent | React.MouseEvent) => {
    const el = cropContainerRef.current;
    if (!el) return { px: 0, py: 0 };
    const rect = el.getBoundingClientRect();
    return {
      px: ((e.clientX - rect.left) / rect.width) * 100,
      py: ((e.clientY - rect.top) / rect.height) * 100,
    };
  };

  const onCropPointerDown = (e: React.MouseEvent, type: 'move' | 'nw' | 'ne' | 'sw' | 'se') => {
    e.preventDefault();
    e.stopPropagation();

    // Auto-close any open tool menu when using the tool
    setShowPenMenu(false);
    setShowSelectMenu(false);
    setShowCropMenu(false);
    setShowColorPicker(false);

    const { px, py } = getCropMousePct(e.nativeEvent);
    cropDragRef.current = {
      type,
      startMouseX: px,
      startMouseY: py,
      startBox: { ...cropBox },
    };
    const onMove = (ev: MouseEvent) => {
      if (!cropDragRef.current) return;
      const { px: mx, py: my } = getCropMousePct(ev);
      const dx = mx - cropDragRef.current.startMouseX;
      const dy = my - cropDragRef.current.startMouseY;
      const s = cropDragRef.current.startBox;
      const t = cropDragRef.current.type;

      if (t === 'move') {
        let nx = s.x + dx;
        let ny = s.y + dy;
        nx = Math.max(0, Math.min(100 - s.w, nx));
        ny = Math.max(0, Math.min(100 - s.h, ny));
        setCropBox({ x: nx, y: ny, w: s.w, h: s.h });
        return;
      }

      // Resize from corners
      const imageAr = getImageAr(selectedItem?.ratio);
      const isFixed = activeCropRatio !== 'freeform';
      let cropAr = 1;
      if (isFixed) {
        const [cw, ch] = activeCropRatio.split(':').map(Number);
        cropAr = (cw / ch) / imageAr; // in percentage-space AR
      }

      let nx = s.x, ny = s.y, nw = s.w, nh = s.h;
      const minSize = 5; // minimum 5% in either dimension

      if (t === 'se') {
        nw = Math.max(minSize, Math.min(100 - s.x, s.w + dx));
        if (isFixed) {
          nh = nw / cropAr;
        } else {
          nh = Math.max(minSize, Math.min(100 - s.y, s.h + dy));
        }
        if (ny + nh > 100) { nh = 100 - ny; if (isFixed) nw = nh * cropAr; }
        if (nx + nw > 100) { nw = 100 - nx; if (isFixed) nh = nw / cropAr; }
      } else if (t === 'sw') {
        nw = Math.max(minSize, Math.min(s.x + s.w, s.w - dx));
        nx = s.x + s.w - nw;
        if (isFixed) {
          nh = nw / cropAr;
        } else {
          nh = Math.max(minSize, Math.min(100 - s.y, s.h + dy));
        }
        if (ny + nh > 100) { nh = 100 - ny; if (isFixed) { nw = nh * cropAr; nx = s.x + s.w - nw; } }
        if (nx < 0) { nx = 0; nw = s.x + s.w; if (isFixed) nh = nw / cropAr; }
      } else if (t === 'ne') {
        nw = Math.max(minSize, Math.min(100 - s.x, s.w + dx));
        if (isFixed) {
          nh = nw / cropAr;
        } else {
          nh = Math.max(minSize, Math.min(s.y + s.h, s.h - dy));
        }
        ny = s.y + s.h - nh;
        if (ny < 0) { ny = 0; nh = s.y + s.h; if (isFixed) nw = nh * cropAr; }
        if (nx + nw > 100) { nw = 100 - nx; if (isFixed) { nh = nw / cropAr; ny = s.y + s.h - nh; } }
      } else if (t === 'nw') {
        nw = Math.max(minSize, Math.min(s.x + s.w, s.w - dx));
        nx = s.x + s.w - nw;
        if (isFixed) {
          nh = nw / cropAr;
        } else {
          nh = Math.max(minSize, Math.min(s.y + s.h, s.h - dy));
        }
        ny = s.y + s.h - nh;
        if (nx < 0) { nx = 0; nw = s.x + s.w; if (isFixed) { nh = nw / cropAr; ny = s.y + s.h - nh; } }
        if (ny < 0) { ny = 0; nh = s.y + s.h; if (isFixed) { nw = nh * cropAr; nx = s.x + s.w - nw; } }
      }

      setCropBox({ x: nx, y: ny, w: nw, h: nh });
    };
    const onUp = () => {
      cropDragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  interface TextInputState {
    x: number;
    y: number;
    value: string;
  }

  const [annotations, setAnnotations] = React.useState<Annotation[]>([]);
  const [redoStack, setRedoStack] = React.useState<Annotation[]>([]);
  const [currentAnnotation, setCurrentAnnotation] = React.useState<Annotation | null>(null);
  const [textInput, setTextInput] = React.useState<TextInputState | null>(null);

  React.useEffect(() => {
    setActiveTool('pen');
    setPreviousTool('pen');
    setShowPenMenu(false);
    setShowSelectMenu(false);
    setShowCropMenu(false);
    setActiveSelectSubTool('box');
    setActiveCropRatio('16:9');
    setPendingTool(null);
    setShowColorPicker(false);
    setAnnotations([]);
    setRedoStack([]);
    setCurrentAnnotation(null);
    setTextInput(null);
  }, [selectedItem]);

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setShowPenMenu(false);
        setShowSelectMenu(false);
        setShowCropMenu(false);
        setShowColorPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const svgRef = React.useRef<SVGSVGElement>(null);

  const getCoordinates = (e: React.MouseEvent<SVGSVGElement> | MouseEvent) => {
    if (!svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    return { x, y };
  };

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    // Only allow starting drawings or selections with the primary (left) mouse button
    if (e.button !== 0) return;

    if (activeTool !== 'pen' && activeTool !== 'select') return;

    // Auto-close any open tool menu when using the tool
    setShowPenMenu(false);
    setShowSelectMenu(false);
    setShowCropMenu(false);
    setShowColorPicker(false);

    const coords = getCoordinates(e);
    if (!coords) return;

    if (activeTool === 'pen') {
      if (activePenSubTool === 'draw') {
        const newAnn: Annotation = {
          id: Math.random().toString(),
          type: 'draw',
          color: activeColor,
          size: penSize,
          points: [coords]
        };
        setCurrentAnnotation(newAnn);
      } else if (activePenSubTool === 'rect') {
        const newAnn: Annotation = {
          id: Math.random().toString(),
          type: 'rect',
          color: activeColor,
          size: penSize,
          x: coords.x,
          y: coords.y,
          width: 0,
          height: 0
        };
        setCurrentAnnotation(newAnn);
      } else if (activePenSubTool === 'text') {
        setTextInput({
          x: coords.x,
          y: coords.y,
          value: ''
        });
      }
    } else if (activeTool === 'select') {
      setAnnotations((prev) => prev.filter((ann) => ann.type !== 'select-box' && ann.type !== 'select-lasso'));
      
      if (activeSelectSubTool === 'box') {
        const newAnn: Annotation = {
          id: Math.random().toString(),
          type: 'select-box',
          color: '#ffffff',
          size: 1.5,
          x: coords.x,
          y: coords.y,
          width: 0,
          height: 0
        };
        setCurrentAnnotation(newAnn);
      } else if (activeSelectSubTool === 'lasso') {
        const newAnn: Annotation = {
          id: Math.random().toString(),
          type: 'select-lasso',
          color: '#ffffff',
          size: 1.5,
          points: [coords]
        };
        setCurrentAnnotation(newAnn);
      }
    }
    setRedoStack([]);
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement> | MouseEvent) => {
    // If a drawing is active but the left mouse button is not pressed (e.g. missed MouseUp event),
    // save the current drawing and release the state to prevent accidental hover painting.
    if (currentAnnotation && (e.buttons & 1) === 0) {
      setAnnotations([...annotations, currentAnnotation]);
      setCurrentAnnotation(null);
      return;
    }

    if (!currentAnnotation) return;
    const coords = getCoordinates(e);
    if (!coords) return;

    if ((currentAnnotation.type === 'draw' || currentAnnotation.type === 'select-lasso') && currentAnnotation.points) {
      setCurrentAnnotation({
        ...currentAnnotation,
        points: [...currentAnnotation.points, coords]
      });
    } else if (currentAnnotation.type === 'rect' || currentAnnotation.type === 'select-box') {
      const width = coords.x - (currentAnnotation.x || 0);
      const height = coords.y - (currentAnnotation.y || 0);
      setCurrentAnnotation({
        ...currentAnnotation,
        width,
        height
      });
    }
  };

  const handleMouseUp = () => {
    if (!currentAnnotation) return;
    setAnnotations([...annotations, currentAnnotation]);
    setCurrentAnnotation(null);
  };

  React.useEffect(() => {
    if (!currentAnnotation) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      handleMouseMove(e);
    };

    const handleWindowMouseUp = () => {
      handleMouseUp();
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [currentAnnotation, annotations]);

  const handleUndo = () => {
    if (annotations.length === 0) return;
    const last = annotations[annotations.length - 1];
    setAnnotations(annotations.slice(0, -1));
    setRedoStack([last, ...redoStack]);
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[0];
    setRedoStack(redoStack.slice(1));
    setAnnotations([...annotations, next]);
  };

  const handleReset = () => {
    setAnnotations([]);
    setRedoStack([]);
    setActiveColor('#ff0000');
    setPenSize(4);
    setActivePenSubTool('draw');
    setShowColorPicker(false);
    setTextInput(null);
  };

  const handleToolSwitch = (targetTool: 'crop' | 'pen' | 'select') => {
    if (targetTool === 'crop') {
      if (activeTool === 'crop') {
        setShowCropMenu(!showCropMenu);
        return;
      }
      if (annotations.length > 0) {
        setPendingTool('crop');
      } else {
        setPreviousTool(activeTool as 'pen' | 'select');
        setActiveTool('crop');
        setShowCropMenu(true);
        setShowPenMenu(false);
        setShowSelectMenu(false);
      }
      return;
    }

    if (targetTool === activeTool) {
      if (targetTool === 'pen') {
        setShowPenMenu(!showPenMenu);
      } else if (targetTool === 'select') {
        setShowSelectMenu(!showSelectMenu);
      }
      return;
    }

    if (annotations.length > 0) {
      setPendingTool(targetTool);
    } else {
      setActiveTool(targetTool);
      setShowPenMenu(targetTool === 'pen');
      setShowSelectMenu(targetTool === 'select');
      setShowCropMenu(false);
    }
  };

  const mainRef = React.useRef<HTMLElement>(null);
  
  // Scroll direction header show/hide state
  const [isHeaderVisible, setIsHeaderVisible] = React.useState(true);
  const [isAtTop, setIsAtTop] = React.useState(true);
  const lastScrollTop = React.useRef(0);
  const maxScrollTop = React.useRef(0);

  // Unified transition timing used by left sidebar, right agent sidebar, and music sidebar (matching Google Flow's slower, smooth glide)
  const sidebarShowTransition = '0.38s ease-in-out';
  const sidebarHideTransition = '0.38s ease-in-out';
  const currentSidebarTransitionTiming = isHeaderVisible ? sidebarShowTransition : sidebarHideTransition;
  const headerFadeTransition = 'opacity 0.5s ease-in-out, visibility 0.5s ease-in-out';

  const customScrollbarThumbRef = React.useRef<HTMLDivElement>(null);
  
  const updateCustomScrollbar = React.useCallback((el: HTMLElement) => {
    const thumbEl = customScrollbarThumbRef.current;
    if (!el || !thumbEl) return;
    
    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollHeight <= clientHeight) {
      thumbEl.style.opacity = '0';
      thumbEl.style.pointerEvents = 'none';
      return;
    }
    
    thumbEl.style.opacity = '1';
    thumbEl.style.pointerEvents = 'auto';
    
    const scrollRatio = clientHeight / scrollHeight;
    const thumbHeight = Math.max(scrollRatio * clientHeight, 40);
    const maxThumbTop = clientHeight - thumbHeight;
    const scrollPercent = scrollTop / (scrollHeight - clientHeight);
    const thumbTop = scrollPercent * maxThumbTop;
    
    thumbEl.style.height = `${thumbHeight}px`;
    thumbEl.style.transform = `translateY(${thumbTop}px)`;
  }, []);

  const isDraggingThumb = React.useRef(false);
  const startDragY = React.useRef(0);
  const startScrollTop = React.useRef(0);

  const handleThumbMouseDown = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!mainRef.current) return;
    
    isDraggingThumb.current = true;
    startDragY.current = e.clientY;
    startScrollTop.current = mainRef.current.scrollTop;
    
    document.body.style.userSelect = 'none';

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingThumb.current || !mainRef.current) return;
      
      const { scrollHeight, clientHeight } = mainRef.current;
      const scrollRatio = clientHeight / scrollHeight;
      const thumbHeight = Math.max(scrollRatio * clientHeight, 40);
      const trackDistance = clientHeight - thumbHeight;
      const scrollableDistance = scrollHeight - clientHeight;
      
      const deltaY = moveEvent.clientY - startDragY.current;
      const scrollDelta = (deltaY / trackDistance) * scrollableDistance;
      
      mainRef.current.scrollTop = startScrollTop.current + scrollDelta;
    };
    
    const handleMouseUp = () => {
      isDraggingThumb.current = false;
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
    
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, []);

  // Set only on a change. Setting the same value on every scroll event still re-runs this whole
  // component on most of them (React renders before it can bail out), which was most of the
  // main thread's work while the gallery scrolled.
  const headerStateRef = React.useRef({ visible: isHeaderVisible, atTop: isAtTop });
  const showHeader = (visible: boolean) => {
    if (headerStateRef.current.visible === visible) return;
    headerStateRef.current.visible = visible;
    setIsHeaderVisible(visible);
  };
  const markAtTop = (atTop: boolean) => {
    if (headerStateRef.current.atTop === atTop) return;
    headerStateRef.current.atTop = atTop;
    setIsAtTop(atTop);
  };
  const handleScroll = (e: React.UIEvent<HTMLElement>) => {
    updateCustomScrollbar(e.currentTarget);
    const scrollTop = e.currentTarget.scrollTop;
    if (scrollTop <= 40) {
      showHeader(true);
      markAtTop(true);
      maxScrollTop.current = scrollTop;
    } else {
      markAtTop(false);
      if (scrollTop > lastScrollTop.current) {
        showHeader(false);
        maxScrollTop.current = scrollTop;
      } else if (scrollTop < lastScrollTop.current) {
        // Reappear only after scrolling up at least 100px from peak scroll position (matching Google Flow)
        if (maxScrollTop.current - scrollTop >= 100) {
          showHeader(true);
        }
      }
    }
    lastScrollTop.current = scrollTop;

    // Realtime update of the selection box boundaries on scroll
    if (isSelectingRef.current && mainRef.current) {
      // Synchronous DOM update for zero lag during scroll
      updateSelectionBoxVisuals();
      
      setSelectionBox(prev => {
        if (!prev) return null;
        return { 
          ...prev, 
          currentX: mouseViewportPosRef.current.x, 
          currentY: mouseViewportPosRef.current.y 
        };
      });
    }
  };

  const [attachments, setAttachments] = React.useState<ImageAttachment[]>([]);
  const [hoveredAttachmentUrl, setHoveredAttachmentUrl] = React.useState<string | null>(null);
  /** The hovered chip in viewport pixels, and the top of the composer it sits in. */
  const [hoveredAttachmentRect, setHoveredAttachmentRect] = React.useState<{ left: number; top: number; width: number; shellTop: number } | null>(null);
  const [hoveredAttachmentIsEndFrame, setHoveredAttachmentIsEndFrame] = React.useState<boolean>(false);
  const [hoveredAttachmentCharacterId, setHoveredAttachmentCharacterId] = React.useState<string | null>(null);
  const hoverTimeoutRef = React.useRef<any>(null);
  const closeTimeoutRef = React.useRef<any>(null);
  
  const handleAttachmentMouseEnter = (e: React.MouseEvent<HTMLDivElement>, url: string, isEndFrame?: boolean, characterId?: string) => {
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    
    const rect = e.currentTarget.getBoundingClientRect();
    const shellTop = e.currentTarget.closest('.prompt-container-box')?.getBoundingClientRect().top ?? rect.top;
    
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredAttachmentRect({ left: rect.left, top: rect.top, width: rect.width, shellTop });
      setHoveredAttachmentUrl(url);
      setHoveredAttachmentIsEndFrame(!!isEndFrame);
      setHoveredAttachmentCharacterId(characterId ?? null);
    }, 330);
  };

  const handleAttachmentMouseLeave = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    
    closeTimeoutRef.current = setTimeout(() => {
      setHoveredAttachmentUrl(null);
      setHoveredAttachmentRect(null);
      setHoveredAttachmentIsEndFrame(false);
    }, 200);
  };

  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [removingIds, setRemovingIds] = React.useState<Set<string>>(new Set());
  const hasActiveAttachments = attachments.filter(Boolean).length > 0 && !attachments.filter(Boolean).every(att => removingIds.has(att.id));

  const removeAttachment = (id: string) => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    setHoveredAttachmentUrl(null);
    setHoveredAttachmentRect(null);

    if (modelMode === 'video' && videoMode === 'frames') {
      setAttachments(prev => {
        const next = [...prev];
        const idx = next.findIndex(att => att && att.id === id);
        if (idx !== -1) {
          next[idx] = undefined as any;
        }
        if (!next[0] && !next[1]) {
          return [];
        }
        return next;
      });
      return;
    }
    setRemovingIds(prev => new Set(prev).add(id));
    setTimeout(() => {
      setAttachments(prev => prev.filter(att => att && att.id !== id));
      setRemovingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 200);
  };

  const processUploads = async (files: File[]) => {
    if (files.length === 0) return;
    
    if (isLocalFolderConnected && !isLocalFolderAuthorized) {
      await authorizeLocalFolder();
    }

    for (const file of files) {
      const isImage = file.type.startsWith('image/');
      const isVideo = file.type.startsWith('video/');
      const isAudio = file.type.startsWith('audio/');
      
      const fileKind: MediaKind = (isVideo || isAudio) ? 'video' : 'image';
      const ext = file.type.split('/')[1] || (isImage ? 'png' : isVideo ? 'mp4' : 'mp3');
      const fileTypeName = isImage ? 'image' : isVideo ? 'video' : 'audio';
      const filename = file.name || `uploaded-${fileTypeName}-${Date.now()}.${ext}`;
      const promptText = isImage ? 'Uploaded Image' : isVideo ? 'Uploaded Video' : 'Uploaded Audio';
      
      const url = URL.createObjectURL(file);
      
      const getAspectRatio = (): Promise<string> => {
        if (isImage) {
          return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
              resolve(`${img.naturalWidth}:${img.naturalHeight}`);
            };
            img.onerror = () => resolve('16:9');
            img.src = url;
          });
        } else if (isVideo) {
          return new Promise((resolve) => {
            const vid = document.createElement('video');
            vid.onloadedmetadata = () => {
              resolve(`${vid.videoWidth}:${vid.videoHeight}`);
            };
            vid.onerror = () => resolve('16:9');
            vid.src = url;
          });
        } else {
          return Promise.resolve('16:9');
        }
      };
      
      const ratio = await getAspectRatio();
      
      const newItem: MediaItem = {
        id: `pasted-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        kind: fileKind,
        status: 'generating',
        prompt: promptText,
        modelId: 'upload',
        modelName: 'Upload',
        ratio: ratio,
        timestamp: Date.now(),
        collectionId: openCollectionRef.current,
      };
      
      setIsLayoutSuppressing(true);
      setMediaItems(prev => [newItem, ...prev]);
      setTimeout(() => {
        setIsLayoutSuppressing(false);
      }, 150);

      setTimeout(() => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onloadend = async () => {
          const base64Url = reader.result as string;
          
          let finalFsName = undefined;
          let finalSavedToFS = false;
          
          if (isLocalFolderConnected && isLocalFolderAuthorized) {
            try {
              finalFsName = await saveLocalFSMedia(projectName || 'Default', fileKind, filename, file, collectionFolder(newItem.collectionId));
              // saveLocalFSMedia FAILS by returning null (it doesn't throw) —
              // only mark saved when we actually got a disk filename back,
              // otherwise the auto-sync backfill skips this item forever.
              finalSavedToFS = !!finalFsName;
            } catch (err) {
              console.error("Failed to save to FS", err);
            }
          }
          
          const newAttachment: ImageAttachment = {
            id: newItem.id,
            url: url,
            name: filename,
            file: file,
            kind: fileKind
          };

          setAttachments(prev => {
            const next = [...prev, newAttachment];
            return (modelMode === 'video' && videoMode === 'frames') ? next.slice(0, 2) : next;
          });

          setMediaItems(currentItems => {
            const updatedItems = currentItems.map(m => m.id === newItem.id ? { 
              ...m, 
              status: 'completed', 
              url: base64Url,
              isSavedToFS: finalSavedToFS,
              fsName: finalFsName 
            } as MediaItem : m);
            if (projectId && !projectId.startsWith('temp_')) {
              saveProjectMedia(projectId, updatedItems, chatScopeId);
            }
            return updatedItems;
          });
        };
      }, 1500);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files).filter(file => 
      file.type.startsWith('image/') || file.type.startsWith('video/') || file.type.startsWith('audio/')
    );
    await processUploads(files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Model Menu State
  const [isModelMenuOpen, setIsModelMenuOpen] = React.useState(false);
  const [generationError, setGenerationError] = React.useState<PromptNoticeState | null>(null);
  const [mediaItems, setMediaItems] = React.useState<MediaItem[]>([]);
  const isBackground = React.useContext(MediaBackgroundContext);
  const isMediaWorking = isAgentGenerating || mediaItems.some((item) => item.status === 'generating');
  React.useEffect(() => { $mediaWorkRunning.set(isMediaWorking); }, [isMediaWorking]);
  React.useEffect(() => () => $mediaWorkRunning.set(false), []);
  // For work another tab may carry on (see "Work another tab carries on" below):
  // what each video asked for, which the item does not carry, and which items the
  // running agent turn made — that turn runs again, so they are not restarted.
  const videoDurationsRef = React.useRef(new Map<string, string>());
  const agentTurnItemIdsRef = React.useRef(new Set<string>());
  React.useEffect(() => {
    if (isAgentGenerating) agentTurnItemIdsRef.current = new Set();
  }, [isAgentGenerating]);
  /* Set when this editor inherits a closed tab's work, so its job resumes under the same id. */
  const inheritedJobIdRef = React.useRef<string | null>(null);
  // Scenes are not media and are never saved as media; they join the layout as stand-in items
  // so they flow through the same justified rows, and SceneTile draws them. Characters join
  // All media the same way, drawn by CharacterTile.
  const characters = useStore($characters);
  const scenes = useStore($scenes);
  const scenesById = React.useMemo(() => new Map(scenes.map((s) => [s.id, s])), [scenes]);
  const sceneItems = React.useMemo(() => scenes
    .filter((s) => !s.trashedAt)
    .map((s): MediaItem => ({
      id: `${SCENE_ITEM_PREFIX}${s.id}`,
      kind: 'video',
      status: 'completed',
      url: s.poster,
      prompt: s.name,
      modelId: 'scene',
      modelName: 'Scene',
      ratio: s.aspectRatio,
      timestamp: s.createdAt,
    })), [scenes]);
  // A gallery tile stands for an item's whole edit history, as in Flow: it shows the newest
  // finished version and opens on it.
  const latestVersions = React.useMemo(() => {
    const latest = new Map<string, MediaItem>();
    for (const item of mediaItems) {
      if (!item.historyGroupId || item.status !== 'completed' || !item.url) continue;
      const current = latest.get(item.historyGroupId);
      if (!current || item.timestamp > current.timestamp) latest.set(item.historyGroupId, item);
    }
    return latest;
  }, [mediaItems]);
  /** Edit histories with more than one finished version: Flow badges those tiles with `stacks`. */
  const historyGroupsWithVersions = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of mediaItems) {
      if (!item.historyGroupId || item.status !== 'completed' || item.characterId) continue;
      counts.set(item.historyGroupId, (counts.get(item.historyGroupId) ?? 0) + 1);
    }
    return new Set([...counts].filter(([, n]) => n > 1).map(([id]) => id));
  }, [mediaItems]);
  // ── Collections ──────────────────────────────────────────────────────────
  // Collections live in ./collections. Like Flow's they are folders: an item in one shows only
  // inside it (`?collection=<id>`), and at the top of the project the collection is a square tile.
  const collections = useStore($collections);
  const collectionIds = React.useMemo(() => new Set(collections.map((c) => c.id)), [collections]);
  const openCollectionId = new URLSearchParams(location.search).get('collection');
  const openCollection = openCollectionId ? collections.find((c) => c.id === openCollectionId) ?? null : null;
  /** What is made or uploaded while a collection is open goes into it, as in Flow. */
  const openCollectionRef = React.useRef<string | undefined>(undefined);
  openCollectionRef.current = openCollection?.id;
  /** The sidebar's tabs leave a collection, as Flow's do. */
  const tabSearch = React.useMemo(() => {
    const next = new URLSearchParams(location.search);
    next.delete('collection');
    const search = next.toString();
    return search ? `?${search}` : '';
  }, [location.search]);
  /** The rail's rows: a gallery tab, or Tools, which also opens its dock as Flow's does. */
  const navigateSidebarTab = (tab: string) => {
    if (tab === 'tools') {
      setDockOpen(true);
      navigate(toolsLocation(tabSearch));
      return;
    }
    navigate((tab === 'all' ? '/media' : `/media/${tab}`) + tabSearch);
  };
  const openDockTool = (id: string) => navigate(toolLocation(tabSearch, id));
  const locationHref = (to: { pathname: string; search: string }) => to.pathname + to.search;
  const toolsHref = locationHref(toolsLocation(tabSearch));
  const dockToolHref = (id: string) => locationHref(toolLocation(tabSearch, id));
  /** Which collection an item is in; one whose collection is gone is back at the top. */
  const homeOf = React.useCallback((item: MediaItem): string | null =>
    (item.collectionId && collectionIds.has(item.collectionId) ? item.collectionId : null), [collectionIds]);
  /** The collection a collection sits in, if that one still exists; null at the top of the project. */
  const parentIdOf = React.useCallback((c: Collection): string | null =>
    (c.parentId && collectionIds.has(c.parentId) ? c.parentId : null), [collectionIds]);
  /**
   * Each collection's tiles — its own and those of every collection inside it, as Flow counts and
   * covers them — its cover then newest first, each showing its newest finished version.
   */
  const collectionContents = React.useMemo(() => {
    const direct = new Map<string, MediaItem[]>();
    for (const item of [...mediaItems].sort(compareMediaItemsNewestFirst)) {
      const home = homeOf(item);
      if (!home || item.historyParentId || item.characterId) continue;
      const latest = latestVersions.get(item.historyGroupId || item.id);
      const tile = latest && latest.id !== item.id && latest.url !== item.url ? { ...item, url: latest.url } : item;
      direct.set(home, [...(direct.get(home) ?? []), tile]);
    }
    const children = new Map<string, string[]>();
    for (const c of collections) {
      const parent = parentIdOf(c);
      if (parent) children.set(parent, [...(children.get(parent) ?? []), c.id]);
    }
    const gather = (id: string, seen: Set<string>): MediaItem[] => {
      if (seen.has(id)) return [];
      seen.add(id);
      return [...(direct.get(id) ?? []), ...(children.get(id) ?? []).flatMap((child) => gather(child, seen))];
    };
    const byCollection = new Map<string, MediaItem[]>();
    for (const c of collections) {
      const list = gather(c.id, new Set()).sort(compareMediaItemsNewestFirst);
      const at = c.coverId ? list.findIndex((m) => (m.historyGroupId || m.id) === c.coverId) : -1;
      if (at > 0) list.unshift(...list.splice(at, 1));
      if (list.length) byCollection.set(c.id, list);
    }
    return byCollection;
  }, [mediaItems, latestVersions, homeOf, collections, parentIdOf]);
  const displayMediaItems = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    let filtered = mediaItems.filter((item) => {
      // Flow keeps viewer edits in the detail history rail. They should not
      // become separate tiles in the main canvas/gallery.
      if (item.historyParentId) return false;
      // A character's images belong to the character, shown on its own page.
      if (item.characterId) return false;
      if (openCollection ? homeOf(item) !== openCollection.id : homeOf(item) !== null) return false;
      if (query && !(item.shortenedPrompt || item.prompt || '').toLowerCase().includes(query)) {
        return false;
      }
      if (activeSidebarTab === 'images') {
        return item.kind === 'image';
      }
      if (activeSidebarTab === 'video') {
        return item.kind === 'video';
      }
      if (activeSidebarTab === 'uploads') {
        return item.modelId === 'upload';
      }
      if (activeSidebarTab === 'music') {
        return item.kind === 'audio';
      }
      return true;
    }).map((item) => {
      const latest = latestVersions.get(item.historyGroupId || item.id);
      return latest && latest.id !== item.id && latest.url !== item.url ? { ...item, url: latest.url } : item;
    });

    if (activeSidebarTab === 'scenes' || (activeSidebarTab === 'all' && !openCollection)) {
      const sceneTiles = sceneItems.filter((s) => !query || s.prompt.toLowerCase().includes(query));
      filtered = activeSidebarTab === 'scenes' ? sceneTiles : [...sceneTiles, ...filtered];
    }

    // The collections at this level: the project's own, or the ones inside the open collection.
    if (activeSidebarTab === 'all') {
      const level = openCollection?.id ?? null;
      const collectionTiles = collections
        .filter((c) => parentIdOf(c) === level && (!query || c.name.toLowerCase().includes(query)))
        .map((c): MediaItem => ({
          id: `${COLLECTION_ITEM_PREFIX}${c.id}`,
          kind: 'image',
          status: 'completed',
          url: '',
          prompt: c.name,
          modelId: 'collection',
          modelName: 'Collection',
          ratio: '1:1',
          timestamp: c.createdAt,
        }));
      filtered = [...collectionTiles, ...filtered];
    }

    // Characters are tiles of All media too, at the top of the project, by when they were made.
    if (activeSidebarTab === 'all' && !openCollection) {
      const characterTiles = characters
        .filter((c) => !query || characterName(c).toLowerCase().includes(query))
        .map((c): MediaItem => ({
          id: `${CHARACTER_ITEM_PREFIX}${c.id}`,
          kind: 'image',
          status: 'completed',
          url: '',
          prompt: characterName(c),
          modelId: 'character',
          modelName: 'Character',
          ratio: '1:1',
          timestamp: c.createdAt,
          ...(c.favorite ? { favorite: true } : {}),
        }));
      filtered = [...characterTiles, ...filtered];
    }

    if (activeSidebarTab === 'music') {
      filtered = [
        {
          id: 'new-music-button',
          kind: 'audio',
          status: 'completed',
          url: '',
          prompt: 'New Music',
          modelId: 'ui',
          modelName: 'UI',
          ratio: '1:1',
          timestamp: Date.now(),
        } as MediaItem,
        ...filtered
      ];
    }
    // The search bar's filters (SortFilterMenu), each list "any of". Willow keeps no clip duration
    // or resolution, so those two rows narrow nothing.
    const f = sortFilter;
    const typeOf = (m: MediaItem) => (m.id.startsWith(COLLECTION_ITEM_PREFIX) ? 'collections'
      : m.id.startsWith(SCENE_ITEM_PREFIX) ? 'scenes'
        : m.id.startsWith(CHARACTER_ITEM_PREFIX) ? 'characters'
          : m.kind === 'video' ? 'videos' : m.kind === 'image' ? 'images' : 'other');
    const shapeOf = (m: MediaItem) => {
      const [w, h] = (m.ratio || '').split(':').map(Number);
      return !w || !h || w === h ? 'freeform' : w > h ? 'landscape' : 'portrait';
    };
    const isMedia = (m: MediaItem) => !isStandIn(m);
    if (f.types.length) filtered = filtered.filter((m) => f.types.includes(typeOf(m)));
    if (f.ratios.length) filtered = filtered.filter((m) => !m.id.startsWith(COLLECTION_ITEM_PREFIX) && !m.id.startsWith(CHARACTER_ITEM_PREFIX) && f.ratios.includes(shapeOf(m)));
    if (f.created.length) {
      filtered = filtered.filter((m) => isMedia(m) && (
        (f.created.includes('uploaded') && m.modelId === 'upload')
        || (f.created.includes('generated') && m.modelId !== 'upload')
        || (f.created.includes('favorites') && !!m.favorite)
      ));
    }
    return filtered;
  }, [mediaItems, sceneItems, characters, activeSidebarTab, searchQuery, latestVersions, collections, openCollection, homeOf, parentIdOf, sortFilter]);

  React.useEffect(() => {
    if (activeSidebarTab === 'music') {
       const hasMusic = mediaItems.some(item => item.kind === 'audio' && item.id !== 'new-music-button');
       if (!hasMusic) {
         setIsCreatingMusic(true);
       }
    } else {
       setIsCreatingMusic(false);
    }
  }, [activeSidebarTab, mediaItems]);
  const mediaLoadedRef = React.useRef(false);
  const [isInitialLoading, setIsInitialLoading] = React.useState(true);
  const [isInitialLoadingFadingOut, setIsInitialLoadingFadingOut] = React.useState(false);
  const currentProjectIdRef = React.useRef(projectId);

  React.useEffect(() => {
    if (currentProjectIdRef.current !== projectId) {
      currentProjectIdRef.current = projectId;
      setIsInitialLoading(true);
      setIsInitialLoadingFadingOut(false);
    }
  }, [projectId]);
  // Mirror of mediaItems for use inside non-reactive listeners.
  const mediaItemsRef = React.useRef<MediaItem[]>([]);
  React.useEffect(() => { mediaItemsRef.current = mediaItems; }, [mediaItems]);

  // Keep the detail viewer bound to the live item as generation updates its URL,
  // status, shortened prompt, or persisted metadata. This is important for
  // edits: Flow keeps the viewer open while the new history card is generating.
  React.useEffect(() => {
    if (!selectedItem) return;
    const live = mediaItems.find((item) => item.id === selectedItem.id);
    if (live && live !== selectedItem) setSelectedItem(live);
    const pendingId = pendingViewerItemIdRef.current;
    if (pendingId) {
      const pending = mediaItems.find((item) => item.id === pendingId);
      if (pending?.status === 'completed' && pending.url) {
        pendingViewerItemIdRef.current = null;
        setSelectedItem(pending);
      }
    }
  }, [mediaItems, selectedItem]);
  // A video opens in the Scenebuilder on a scene of its own, built when it opens and dropped when it
  // closes, so the next open starts from the video as it is then.
  const openVideoId = selectedItem?.kind === 'video' && selectedItem.url ? selectedItem.id : null;
  React.useEffect(() => {
    if (!openVideoId) return undefined;
    const item = mediaItemsRef.current.find((m) => m.id === openVideoId);
    if (item?.url) {
      // Without its scene the view stays an empty page, so a video that can't be read closes it.
      void ensureVideoScene({ id: item.id, url: item.url, ratio: item.ratio, name: item.shortenedPrompt || item.prompt }).catch(() => {
        setSelectedItem((current) => (current?.id === openVideoId ? null : current));
        showSnack({ icon: 'error', tone: 'error', text: 'This video could not be opened.', actions: [{ label: 'Dismiss' }] });
      });
    }
    return () => dropVideoScene(openVideoId);
  }, [openVideoId]);
  /** An editor that failed to load or render: back to the gallery, saying why. */
  const onEditorFailed = useEventCallback((error: Error, close: () => void) => {
    close();
    showSnack(isChunkLoadError(error)
      ? { icon: 'error', tone: 'error', text: 'Willow needs to reload to open this.', actions: [{ label: 'Reload', run: () => window.location.reload() }, { label: 'Dismiss' }] }
      : { icon: 'error', tone: 'error', text: 'This could not be opened.', actions: [{ label: 'Dismiss' }] });
  });
  const materializingProjectRef = React.useRef<string | null>(null);

  // Synchronously bind the canvas items & fullscreen viewer globally in the render body so StreamingMarkdown can preview them instantly during render
  (window as any).canvasMediaItems = mediaItems;
  (window as any).openCanvasItemInFullscreen = (item: MediaItem) => {
    if (item.kind === 'audio') {
      setActiveMusicItem(item);
    } else {
      setSelectedItem(item);
    }
  };

  // Clean up global window bindings on unmount
  React.useEffect(() => {
    return () => {
      delete (window as any).canvasMediaItems;
      delete (window as any).openCanvasItemInFullscreen;
    };
  }, []);

  const prevSelectedTileIdsRef = React.useRef<Set<string>>(new Set());

  // Automatically sync selection with prompt ingredients in realtime
  React.useEffect(() => {
    const prevSelected = prevSelectedTileIdsRef.current;
    
    // 1. Identify newly-selected items
    const newlySelected = new Set<string>();
    selectedTileIds.forEach(id => {
      if (!prevSelected.has(id)) {
        newlySelected.add(id);
      }
    });

    // 2. Identify newly-unselected items
    const newlyUnselected = new Set<string>();
    prevSelected.forEach(id => {
      if (!selectedTileIds.has(id)) {
        newlyUnselected.add(id);
      }
    });

    // Handle newly-selected items (Auto-Addition)
    if (newlySelected.size > 0) {
      const itemsToAdd = mediaItems.filter(m => newlySelected.has(m.id));
      if (itemsToAdd.length > 0) {
        setAttachments(prev => {
          let next = [...prev];
          let changed = false;
          itemsToAdd.forEach(item => {
            if (item.url && !next.some(att => att && att.url === item.url)) {
              next.push({
                id: item.id,
                url: item.url,
                name: item.shortenedPrompt || item.prompt || 'Attached Media',
                kind: item.kind
              });
              changed = true;
            }
          });
          return changed ? next : prev;
        });
      }
    }

    // Handle newly-unselected items (Auto-Removal with smooth 200ms fade transition)
    if (newlyUnselected.size > 0) {
      setRemovingIds(prev => {
        const next = new Set(prev);
        newlyUnselected.forEach(id => next.add(id));
        return next;
      });

      setTimeout(() => {
        setAttachments(prev => {
          const next = prev.filter(att => att && !newlyUnselected.has(att.id));
          return next.length !== prev.length ? next : prev;
        });
        setRemovingIds(prev => {
          const next = new Set(prev);
          newlyUnselected.forEach(id => next.delete(id));
          return next;
        });
      }, 200);
    }

    // Keep the prevSelectedTileIdsRef in sync
    prevSelectedTileIdsRef.current = new Set(selectedTileIds);
  }, [selectedTileIds, mediaItems]);

  // Blob: URLs created for disk-backed media (the heavy bytes live on disk, not
  // in IndexedDB). We OWN these and must revoke them on project change / unmount
  // to avoid leaking memory.
  const mediaBlobUrlsRef = React.useRef<string[]>([]);
  // The folder each of those URLs was read from ('' for Images/, Videos/ and Audio/). A URL reads
  // its file where it was when made, so it stops loading once the file moves — into a
  // collection, or with its collection's folder — and is only reused while the file stays put.
  const blobFolderRef = React.useRef(new Map<string, string>());
  const attachmentsRef = React.useRef<ImageAttachment[]>([]);
  React.useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);

  const revokeMediaBlobUrls = React.useCallback((keep?: Set<string>) => {
    const activeUrls = new Set(attachmentsRef.current.map(a => a?.url).filter(Boolean));
    if (keep) for (const u of keep) activeUrls.add(u);
    const keptUrls: string[] = [];

    for (const u of mediaBlobUrlsRef.current) {
      if (activeUrls.has(u)) {
        keptUrls.push(u);
      } else {
        try { URL.revokeObjectURL(u); } catch {}
        blobFolderRef.current.delete(u);
      }
    }
    mediaBlobUrlsRef.current = keptUrls;
    return keptUrls;
  }, []);
  React.useEffect(() => () => { revokeMediaBlobUrls(); }, [revokeMediaBlobUrls]);

  // Load generation token so concurrent loads (project switch + a realtime
  // disk-change refresh) can't clobber each other — only the latest applies.
  const loadGenRef = React.useRef(0);
  // The projectId whose media state currently occupies mediaItems. Lets the
  // temp-project branch below distinguish a real project SWITCH (wipe to a
  // fresh canvas) from a mere loadMedia identity change (folder authorization
  // flip, projectName resolving, …) which must NOT wipe in-flight generations.
  const lastLoadedProjectIdRef = React.useRef<string | null>(null);

  // Load the gallery and hydrate disk-backed items into streaming blob: URLs.
  // • Folder connected → reconcile against disk (source of truth) + hydrate.
  // • No folder → IndexedDB metadata (browser-only items keep their base64 url).
  // `skipIfGenerating` is used by the realtime path so a background refresh never
  // clobbers an in-progress generation.
  const initialLoadCompletedRef = React.useRef(false);

  /** The project folder's Scenes/ (set with the scene sync below); read after each reconcile. */
  const sceneFolderRef = React.useRef<SceneFolder | null>(null);
  /** Its Images/Characters/, likewise. */
  const characterFolderRef = React.useRef<CharacterFolder | null>(null);
  const loadMedia = React.useCallback(async (skipIfGenerating: boolean) => {
    const loadStartTime = Date.now();
    // Not reserved for the initial load: a realtime refresh can supersede it, and
    // then this refresh is the only load left to take the loading screen down.
    const finishLoading = () => {
      if (initialLoadCompletedRef.current) return;
      initialLoadCompletedRef.current = true;
      const elapsed = Date.now() - loadStartTime;
      const minWait = Math.max(0, 350 - elapsed);
      window.setTimeout(() => {
        setIsInitialLoadingFadingOut(true);
      }, minWait);
    };

    if (!projectId) {
      revokeMediaBlobUrls();
      setMediaItems([]);
      const projects = readProjectRegistry() as any[];
      if (projects.length === 0) {
        finishLoading();
      }
      return;
    }
    // If a folder is connected, wait for authorization to settle so we don't load empty IndexedDB first
    if (isLocalFolderConnected && !isLocalFolderAuthorized) {
      return;
    }
    // A temp_ project is by definition brand new — never read stored media for
    // it. An abandoned earlier session could have left a record under a
    // colliding random id, and its items would resurrect here as ghost tiles.
    // Marking loaded=true arms the debounced save so generations made during
    // the temp phase persist (under the real id) as usual.
    if (projectId.startsWith('temp_')) {
      // Realtime disk-change refreshes have nothing to reconcile for a temp
      // project — and must never wipe its in-flight generations.
      if (skipIfGenerating) return;
      // Only wipe when actually ENTERING this temp project, not when loadMedia
      // is merely recreated (authorization flip etc.) while we're already on it.
      if (lastLoadedProjectIdRef.current !== projectId) {
        revokeMediaBlobUrls();
        setMediaItems([]);
      }
      lastLoadedProjectIdRef.current = projectId;
      mediaLoadedRef.current = true;
      finishLoading();
      return;
    }
    if (skipIfGenerating && (
      mediaItemsRef.current.some(i => i.status === 'generating') ||
      fsSaveInFlightRef.current.size > 0
    )) return;
    const gen = ++loadGenRef.current;
    const connected = isLocalFolderConnected && isLocalFolderAuthorized && !!projectName;
    // Pass the LIVE items so the reconcile never works off the stale debounced
    // IndexedDB record — right after a generation batch completes, the stored
    // record lags ~600ms behind state and mis-pairs the new files with the
    // wrong items (tiles visibly rearranged, mapping then persisted). ONLY
    // when the in-memory items actually belong to THIS project (on a project
    // switch they're still the previous project's — injecting those would
    // corrupt this project's record). The temp_→real materialization reload
    // is the same logical project, so it keeps the overlay too.
    const itemsBelongHere =
      lastLoadedProjectIdRef.current === projectId ||
      lastLoadedProjectIdRef.current === `temp_${projectId}`;
    const items = connected
      ? await refreshLocalMedia(projectId, projectName, itemsBelongHere ? mediaItemsRef.current : undefined)
      : await loadProjectMedia(projectId, chatScopeId);

    // Failed generations last only for the session that saw them fail: saving
    // drops them, and a stored record from before that rule — or one holding a
    // 'generating' entry from a browser closed mid-run — is cleaned up here.
    // Failures this session is already showing stay on screen.
    const liveFailed = itemsBelongHere ? mediaItemsRef.current.filter((m) => m.status === 'failed') : [];
    const liveFailedIds = new Set(liveFailed.map((m) => m.id));
    // Except the ones a closed tab was generating, when this tab inherited that
    // work: they stay, and the resume starts each one again.
    const resume = $mediaResume.get();
    const resumingIds = resume && (projectId === resume.job.payload.projectId || projectId === `temp_${resume.job.payload.projectId}`)
      ? new Set(resume.job.payload.itemIds)
      : null;
    if (resume && resumingIds) inheritedJobIdRef.current = resume.job.id;
    const loaded = (items || []).filter((m: any) =>
      m
      && (m.status !== 'generating' || resumingIds?.has(m.id))
      && (m.status !== 'failed' || liveFailedIds.has(m.id))
    );
    const loadedIds = new Set(loaded.map((m: any) => m.id));
    loaded.push(...liveFailed.filter((m) => !loadedIds.has(m.id)));

    const freshBlobUrls: string[] = [];
    const freshFolders = new Map<string, string>();
    // INVARIANT #14: reuse the currently-displayed blob: URL when the same
    // item (id + fsName + kind) is already on screen with a live one. Minting
    // a fresh URL (and revoking the old) forces every <img> to unload and
    // reload, visibly collapsing/reflowing the masonry on each realtime
    // refresh even when nothing changed on disk.
    // Live means still in mediaBlobUrlsRef. A URL revoked by any path — a
    // superseded load, Fast Refresh re-running the unmount cleanup — must be
    // re-minted, or the tile keeps a dead URL that every later refresh reuses.
    const liveBlobUrls = new Set(mediaBlobUrlsRef.current);
    const prevById = new Map(mediaItemsRef.current.map((i: any) => [i?.id, i]));
    const reusedUrls = new Set<string>();
    // Read fresh rather than from the store: the reconcile above may just have adopted a folder.
    const stored = connected ? await listCollections(projectId, chatScopeId).catch(() => []) : [];
    const storedById = new Map(stored.map((c) => [c.id, c]));
    const folderOf = new Map<string, string>(stored.map((c): [string, string] => [c.id, collectionPath(c, storedById)]));
    // A song's audio file beside its cover, read (or reused) like the cover, unless the item
    // carries real audio of its own.
    const hydrateSongAudio = async (m: any) => {
      if (!connected || m?.kind !== 'audio' || !m.audioFsName || (m.audioUrl && !m.audioUrl.startsWith('blob:'))) return m;
      const folder = m.collectionId ? folderOf.get(m.collectionId) : undefined;
      const prev = prevById.get(m.id);
      if (prev?.audioFsName === m.audioFsName && liveBlobUrls.has(prev.audioUrl) && blobFolderRef.current.get(prev.audioUrl) === (folder ?? '')) {
        reusedUrls.add(prev.audioUrl);
        return { ...m, audioUrl: prev.audioUrl };
      }
      const blobUrl = await loadLocalFSMediaUrl(projectName, 'audio', m.audioFsName, folder);
      if (!blobUrl) return { ...m, audioUrl: undefined };
      freshFolders.set(blobUrl, folder ?? '');
      freshBlobUrls.push(blobUrl);
      return { ...m, audioUrl: blobUrl };
    };
    const hydrateFile = async (m: any) => {
      if (m?.url) return m; // browser-only base64 (or already hydrated) — use as-is
      if (connected && m?.fsName && m?.kind) {
        const isAudioFile = m.kind === 'audio' && /\.(mp3|wav|m4a|ogg|flac|aac)$/i.test(m.fsName);
        const folder = m.collectionId ? folderOf.get(m.collectionId) : undefined;
        const readHere = (url: string) => liveBlobUrls.has(url) && blobFolderRef.current.get(url) === (folder ?? '');
        const prev = prevById.get(m.id);
        if (prev && prev.fsName === m.fsName && prev.kind === m.kind) {
          if (isAudioFile) {
            // Only when the item doesn't carry real (data:/http) audio of its
            // own — mirrors the keep-real-audio guard below.
            if ((!m.audioUrl || m.audioUrl.startsWith('blob:')) && readHere(prev.audioUrl)) {
              reusedUrls.add(prev.audioUrl);
              return { ...m, audioUrl: prev.audioUrl };
            }
          } else if (readHere(prev.url)) {
            reusedUrls.add(prev.url);
            return { ...m, url: prev.url };
          }
        }
        const blobUrl = await loadLocalFSMediaUrl(projectName, m.kind, m.fsName, folder);
        if (blobUrl) {
          freshFolders.set(blobUrl, folder ?? '');
          // For audio items the Audio/ file is usually the cover ART (an image
          // written at save time). But an externally dropped song file (.mp3
          // etc.) IS the audio — route that to audioUrl so the player works,
          // instead of pointing an <img> at an audio blob.
          if (isAudioFile) {
            // Re-hydrate over an empty OR stale blob: audioUrl (object URLs are
            // session-scoped; a persisted one is dead). Keep real data:/http
            // audio untouched.
            if (m.audioUrl && !m.audioUrl.startsWith('blob:')) {
              try { URL.revokeObjectURL(blobUrl); } catch {}
              return m;
            }
            freshBlobUrls.push(blobUrl);
            return { ...m, audioUrl: blobUrl };
          }
          freshBlobUrls.push(blobUrl);
          return { ...m, url: blobUrl };
        }
      }
      return m; // disk-backed but no folder/file → no displayable url
    };
    const hydrated = await Promise.all(loaded.map(async (m: any) => hydrateSongAudio(await hydrateFile(m))));

    // Bail if a newer load superseded this one, or a generation started meanwhile.
    if (gen !== loadGenRef.current || mediaItemsRef.current.some(i => i.status === 'generating')) {
      for (const u of freshBlobUrls) { try { URL.revokeObjectURL(u); } catch {} }
      return;
    }
    // INVARIANT #15: structural change-only gate. If every item is identical
    // (id/url/status/fsName/kind/prompt/timestamp/collection), skip the setState — each
    // realtime poll otherwise re-renders the whole masonry and tiles visibly
    // reposition even though nothing changed on disk. (With the URL reuse
    // above, unchanged items keep identical blob: urls, so idle refreshes and
    // post-rename reloads actually hit this gate.) The collection counts: a file moved between
    // collection folders on disk changes nothing else.
    const itemSig = (m: any) =>
      [m?.id, m?.url ?? '', m?.audioUrl ?? '', m?.audioFsName ?? '', m?.status, m?.fsName ?? '', m?.kind, m?.prompt ?? '', m?.timestamp ?? 0, m?.collectionId ?? ''].join('\u0000');
    // Scenes in the folder's Scenes/ point at videos by place, which this reconcile has settled, and
    // characters in its Images/Characters/ at their pictures.
    const readScenes = () => {
      if (connected && sceneFolderRef.current) void readScenesFromFolder(sceneFolderRef.current, projectId, projectName, hydrated, collectionFolder);
      if (connected && characterFolderRef.current) void readCharactersFromFolder(characterFolderRef.current, projectId, chatScopeId, projectName, hydrated, collectionFolder);
    };
    const prevItems = mediaItemsRef.current;
    if (lastLoadedProjectIdRef.current === projectId && prevItems.length === hydrated.length) {
      const prevSigs = new Set(prevItems.map(itemSig));
      if (hydrated.every((m: any) => prevSigs.has(itemSig(m)))) {
        for (const u of freshBlobUrls) { try { URL.revokeObjectURL(u); } catch {} }
        mediaLoadedRef.current = true;
        finishLoading();
        readScenes();
        return;
      }
    }
    const imageUrls = hydrated
      .filter((item: any) => item && (item.kind === 'image' || item.kind === 'audio' || item.coverUrl))
      .map((item: any) => item.coverUrl || item.url)
      .filter((url: any): url is string => typeof url === 'string' && url.length > 0 && !url.startsWith('blob:null'));

    // Whichever load will take the loading screen down preloads first, so the
    // gallery appears decoded — including a realtime refresh (see finishLoading).
    if (imageUrls.length > 0 && (!skipIfGenerating || !initialLoadCompletedRef.current)) {
      await preloadAllImages(imageUrls);
      // The preload can take seconds: long enough for a newer load to commit and
      // revoke the URLs held here. Committing after it would show every tile broken.
      if (gen !== loadGenRef.current || mediaItemsRef.current.some(i => i.status === 'generating')) {
        for (const u of freshBlobUrls) { try { URL.revokeObjectURL(u); } catch {} }
        return;
      }
    }

    const keptUrls = revokeMediaBlobUrls(reusedUrls); // release previous URLs not reused / not held by attachments
    mediaBlobUrlsRef.current = [...freshBlobUrls, ...keptUrls];
    for (const [url, folder] of freshFolders) blobFolderRef.current.set(url, folder);
    setMediaItems(hydrated);
    lastLoadedProjectIdRef.current = projectId;
    mediaLoadedRef.current = true;
    finishLoading();
    readScenes();
  }, [projectId, projectName, chatScopeId, isLocalFolderConnected, isLocalFolderAuthorized, refreshLocalMedia, loadLocalFSMediaUrl, revokeMediaBlobUrls]);

  // (Re)load on project / folder change.
  React.useEffect(() => { loadMediaRef.current = (s: boolean) => { void loadMedia(s); }; }, [loadMedia]);
  React.useEffect(() => {
    mediaLoadedRef.current = false;
    // This also fires when `projectName` changes mid-rename (loadMedia's
    // identity changes). Skip while the rename guard is up — the post-rename
    // timeout performs the one clean reload (which also re-arms the
    // debounced persist by setting mediaLoadedRef back to true).
    if (Date.now() >= renameReloadGuardRef.current) void loadMedia(false);
    return () => { loadGenRef.current++; }; // invalidate any in-flight load
  }, [loadMedia]);

  // Realtime: refresh the gallery when the disk watcher reports a change
  // (debounced; skipped while a generation is in flight so it can't clobber,
  // and while a project-folder rename is moving files — invariant #13).
  React.useEffect(() => {
    let t: number | undefined;
    const onDiskChanged = () => {
      if (t) window.clearTimeout(t);
      t = window.setTimeout(() => {
        if (Date.now() < renameReloadGuardRef.current) return;
        if (fsSaveInFlightRef.current.size > 0) return;
        void loadMedia(true);
      }, 300);
    };
    window.addEventListener('willow_disk_changed', onDiskChanged);
    return () => { if (t) window.clearTimeout(t); window.removeEventListener('willow_disk_changed', onDiskChanged); };
  }, [loadMedia]);

  // Save media items on changes with IndexedDB — only after initial load completes.
  // Debounced: with a large library, cloning every base64 payload into IndexedDB is
  // expensive, and doing it on every state change (e.g. the placeholder insert the
  // moment a generation starts) visibly stalled the UI.
  // Persist under the REAL project id even while the URL still carries the
  // temp_ prefix — records written under "temp_#1234" were orphaned at
  // materialization (the view reloads under "#1234" and finds nothing, wiping
  // the first generations from a folderless session).
  const persistProjectId = projectId && projectId.startsWith('temp_')
    ? projectId.replace('temp_', '')
    : projectId;
  const saveDebounceRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (!persistProjectId || !mediaLoadedRef.current) return;
    if (saveDebounceRef.current !== null) window.clearTimeout(saveDebounceRef.current);
    saveDebounceRef.current = window.setTimeout(() => {
      saveDebounceRef.current = null;
      saveProjectMedia(persistProjectId, mediaItemsRef.current, chatScopeId);
    }, 600);
  }, [persistProjectId, mediaItems, chatScopeId]);
  // Flush any pending save when the project changes, the view unmounts, or the
  // tab is being hidden/closed, so the debounce can never drop the last write.
  React.useEffect(() => {
    if (!persistProjectId) return;
    const flushPendingSave = () => {
      if (saveDebounceRef.current !== null) {
        window.clearTimeout(saveDebounceRef.current);
        saveDebounceRef.current = null;
        if (mediaLoadedRef.current) saveProjectMedia(persistProjectId, mediaItemsRef.current, chatScopeId);
      }
    };
    window.addEventListener('pagehide', flushPendingSave);
    return () => {
      window.removeEventListener('pagehide', flushPendingSave);
      flushPendingSave();
    };
  }, [persistProjectId, chatScopeId]);

  // Auto-sync completed items to disk once folder gets authorized
  /** Songs whose audio this visit has tried to put beside their covers, so a failure is not retried on every change. */
  const songAudioTriedRef = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    if (!isLocalFolderConnected || !isLocalFolderAuthorized || mediaItems.length === 0) return;

    const unsaved = mediaItems.filter(m => m.status === 'completed' && m.url && !m.isSavedToFS);
    const audioless = mediaItems.filter(m => needsSongAudioFile(m) && !songAudioTriedRef.current.has(m.id));
    if (unsaved.length === 0 && audioless.length === 0) return;

    const syncSongAudio = async () => {
      for (const item of audioless) {
        if (fsSaveInFlightRef.current.has(item.id) || songAudioTriedRef.current.has(item.id)) continue;
        const live = mediaItemsRef.current.find(m => m.id === item.id);
        if (!live?.fsName || !needsSongAudioFile(live)) continue;
        songAudioTriedRef.current.add(item.id);
        fsSaveInFlightRef.current.add(item.id);
        try {
          const audioFsName = await saveSongAudio(live, projectName, live.fsName, collectionFolder(live.collectionId));
          if (audioFsName) setMediaItems(prev => prev.map(m => m.id === item.id ? { ...m, audioFsName } : m));
        } finally {
          fsSaveInFlightRef.current.delete(item.id);
        }
      }
    };

    const syncUnsaved = async () => {
      for (const item of unsaved) {
        if (!item.url) continue;
        // Skip items whose disk write is already in flight elsewhere
        // (saveGeneratedMedia on generation completion) — double-saving minted
        // "X.png" + "X (1).png" duplicates that reconciled back as extra tiles.
        if (fsSaveInFlightRef.current.has(item.id)) continue;
        // `unsaved` is a snapshot; re-check live state in case the item was
        // saved (and marked) while earlier items in this loop were awaited.
        const live = mediaItemsRef.current.find(m => m.id === item.id);
        if (live?.isSavedToFS) continue;
        fsSaveInFlightRef.current.add(item.id);
        try {
          const name = item.shortenedPrompt || item.prompt;
          const ext = item.kind === 'video' ? 'mp4' : 'png';
          const cleanName = name.replace(/[\/:*?"<>|]/g, '').trim() || 'media';
          const filename = `${cleanName}.${ext}`;

          const response = await fetch(item.url);
          const blob = await response.blob();
          const folder = collectionFolder(live?.collectionId ?? item.collectionId);
          const finalName = await saveLocalFSMedia(projectName, item.kind, filename, blob, folder);
          if (finalName) {
            const audioFsName = item.kind === 'audio' ? await saveSongAudio(item, projectName, finalName, folder) : undefined;
            setMediaItems(prev => prev.map(m => m.id === item.id ? { ...m, isSavedToFS: true, fsName: finalName, ...(audioFsName ? { audioFsName } : {}) } : m));
          }
        } catch (e) {
          // Ignore write lock issues
        } finally {
          fsSaveInFlightRef.current.delete(item.id);
        }
      }
    };

    void syncUnsaved().then(syncSongAudio);
  }, [isLocalFolderConnected, isLocalFolderAuthorized, mediaItems, projectName, saveLocalFSMedia, saveSongAudio]);

  // Materialize temporary projects when the first generated item completes successfully
  React.useEffect(() => {
    if (!projectId || !projectId.startsWith('temp_') || mediaItems.length === 0) return;
    if (mediaItems.some((item) => item.status === 'generating')) return;
    if (materializingProjectRef.current === projectId) return;
    
    const completedItems = mediaItems.filter(m => m.status === 'completed' && m.url);
    if (completedItems.length === 0) return;
    
    const firstCompleted = completedItems[completedItems.length - 1];
    if (!firstCompleted || !firstCompleted.url) return;
    materializingProjectRef.current = projectId;
    const materializationItems = mediaItems.map((item) => ({ ...item }));
    const materializationProjectName = projectName;
    const materializationScopeId = chatScopeId;
    
    let realProjectId = projectId.replace('temp_', '');
    const projects = readProjectRegistry() as any[];

    // Temp-phase saves write to disk BEFORE materialization, so the disk
    // reconciler may have already ADOPTED this project's folder into the
    // registry under a minted id. Reuse that row (adopting ITS id) instead of
    // appending a second row with the same name — a name-duplicate permanently
    // cross-links two registry entries to one disk folder.
    const adopted = projects.find((p: any) =>
      p?.id !== realProjectId && p?.kind === 'media' &&
      typeof p?.name === 'string' && p.name.toLowerCase() === (projectName || '').toLowerCase()
    );
    if (adopted?.id) {
      realProjectId = adopted.id;
    }

    const projIndex = projects.findIndex((p: any) => p.id === realProjectId);
    if (projIndex === -1) {
      const newProj = {
        id: realProjectId,
        name: projectName,
        hasCover: true,
        kind: 'media'
      };
      const updatedProjects = [...projects, newProj];
      try {
        writeProjectRegistry(updatedProjects);
      } catch (err) {}

      window.dispatchEvent(new CustomEvent('willow_projects_updated'));
    } else if (!projects[projIndex].hasCover) {
      const updatedProjects = projects.map((project: any, index: number) =>
        index === projIndex ? { ...project, hasCover: true } : project
      );
      writeProjectRegistry(updatedProjects);
      window.dispatchEvent(new CustomEvent('willow_projects_updated'));
    }
    
    const finalizeProjectCreation = async () => {
      try {
        // Cover is a still image — capture a frame if the first item is a video.
        let coverUrl = firstCompleted.url as string;
        if (firstCompleted.kind === 'video') {
          const frame = await extractVideoFrame(firstCompleted.url as string);
          if (frame) coverUrl = frame;
        }
        await saveProjectCover(realProjectId, coverUrl, materializationScopeId);
        void saveLocalFSCover(materializationProjectName, coverUrl);
        await saveProjectMedia(realProjectId, materializationItems, materializationScopeId);
        if (projectIdRef.current !== projectId) return;
        setSearchParams(prev => {
          const next = new URLSearchParams(prev);
          next.set('projectId', realProjectId);
          next.delete('tempName');
          return next;
        }, { replace: true });
      } catch (e) {
        if (materializingProjectRef.current === projectId) materializingProjectRef.current = null;
      }
    };
    
    void finalizeProjectCreation();
  }, [projectId, mediaItems, projectName, chatScopeId, saveLocalFSCover, setSearchParams]);

  // Auto-set the first generated item as the project cover if none is set. The
  // cover is always a still image — if the first item is a video we capture a
  // frame (so the card shows a static shot, not a playing clip).
  React.useEffect(() => {
    if (!projectId || projectId.startsWith('temp_') || mediaItems.length === 0) return;
    const projects = readProjectRegistry() as any[];
    const projIndex = projects.findIndex((p: any) => p.id === projectId);
    if (projIndex === -1 || projects[projIndex].hasCover) return;
    const completedItems = mediaItems.filter(m => m.status === 'completed' && m.url);
    if (completedItems.length === 0) return;
    // Oldest completed item is at the end (new items are prepended).
    const firstItem = completedItems[completedItems.length - 1];
    if (!firstItem?.url) return;

    void (async () => {
      let coverUrl = firstItem.url as string;
      if (firstItem.kind === 'video') {
        const frame = await extractVideoFrame(firstItem.url as string);
        if (frame) coverUrl = frame;
      }
      await saveProjectCover(projectId, coverUrl, chatScopeId);
      void saveLocalFSCover(projectName, coverUrl);
      // Re-read before writing (avoid clobbering concurrent updates) + refresh UI.
      try {
        const cur = readProjectRegistry() as any[];
        const idx = cur.findIndex((p: any) => p.id === projectId);
        if (idx !== -1 && !cur[idx].hasCover) {
          const { coverUrl: _legacy, ...rest } = cur[idx];
          cur[idx] = { ...rest, hasCover: true };
          writeProjectRegistry(cur);
          window.dispatchEvent(new Event('willow_projects_updated'));
        }
      } catch {}
    })();
  }, [projectId, mediaItems, projectName, chatScopeId, saveLocalFSCover]);

  // Manual set cover handler
  const handleSetAsCover = React.useCallback(async (url: string, isVideo: boolean = false) => {
    if (!projectId) return;
    // Covers are always still images. If the chosen item is a video, grab a
    // single frame and use that PNG (so the cover is a static shot, not a
    // playing video). Fall back to the raw url only if frame capture fails.
    let coverUrl = url;
    if (isVideo) {
      const frame = await extractVideoFrame(url);
      if (frame) coverUrl = frame;
    }
    // 1. Save the cover image in IndexedDB (what the UI reads).
    await saveProjectCover(projectId, coverUrl, chatScopeId);
    // 2. Write an INDEPENDENT copy to disk as Media/<name>/cover.png, replacing
    //    any previous cover (saveLocalFSCover writes a fresh file from the bytes;
    //    it never moves/renames the source media, which stays in Images/Videos).
    await saveLocalFSCover(projectNameRef.current, coverUrl);
    // 3. Mark hasCover in the registry.
      try {
        const projects = readProjectRegistry() as any[];
        const updated = projects.map((p: any) => {
          if (p.id === projectId) {
            const { coverUrl, ...rest } = p; // strip legacy field
            return { ...rest, hasCover: true };
          }
          return p;
        });
        try {
          writeProjectRegistry(updated);
        } catch (err) {}
      } catch (e) {}
    // 4. Tell every project surface to reload covers so the new one shows at once.
    window.dispatchEvent(new Event('willow_projects_updated'));
  }, [projectId, chatScopeId, saveLocalFSCover]);
  const [renamingItemId, setRenamingItemId] = React.useState<string | null>(null);
  // The models added in Settings → Models. The host passes its live config, so a model added
  // while Media is open is offered at once.
  const savedModelConfig = React.useMemo(() => {
    if (modelConfig) return modelConfig;
    try {
      return JSON.parse(localStorage.getItem('modelConfig') || 'null');
    } catch {
      return null;
    }
  }, [modelConfig]);
  const { image: imageModels, video: videoModels, music: musicModels } = React.useMemo(
    () => mediaModelLists(savedModelConfig),
    [savedModelConfig],
  );

  /*
   * Each selection is the remembered pick while that model is still added, else the first
   * added model, else '' — and on '' Generate asks for a model instead of using one the user
   * never added.
   */
  const [imagePick, setImagePick] = React.useState(() => readModelPick('image', chatScopeId));
  const [videoPick, setVideoPick] = React.useState(() => readModelPick('video', chatScopeId));
  const [musicPick, setMusicPick] = React.useState(() => readModelPick('music', chatScopeId));
  // A sign-in, settings.json or another tab may change them under the page.
  React.useEffect(() => {
    const sync = () => {
      setImagePick(readModelPick('image', chatScopeId));
      setVideoPick(readModelPick('video', chatScopeId));
      setMusicPick(readModelPick('music', chatScopeId));
    };
    sync();
    return onModelPicksChange(sync);
  }, [chatScopeId]);
  const pickModel = (kind: MediaModelKind, id: string) => {
    const live = liveModelId(id);
    (kind === 'image' ? setImagePick : kind === 'video' ? setVideoPick : setMusicPick)(live);
    writeModelPick(kind, live, chatScopeId);
  };
  const openModelSettings = () => onOpenSettings?.('models');

  type ImageModelId = string;
  const imageModel: ImageModelId = resolveModelPick(imagePick, imageModels);
  const setImageModel = (id: ImageModelId) => pickModel('image', id);
  const musicModel = resolveModelPick(musicPick, musicModels);
  const setMusicModel = (id: string) => pickModel('music', id);
  // Song covers go through Gemini, so they use a Gemini image model the user added, theirs first.
  const coverImageModel = [imageModel, ...imageModels.map((m) => m.id)].find((id) => id.startsWith('gemini-')) ?? '';
  const [isImageModelDropdownOpen, setIsImageModelDropdownOpen] = React.useState(false);
  const [imageModelDropDirection, setImageModelDropDirection] = React.useState<'down' | 'up'>('down');
  const imageModelDropdownRef = React.useRef<HTMLDivElement>(null);
  const imageModelButtonRef = React.useRef<HTMLButtonElement>(null);

  type VideoModelId = string;
  const DEFAULT_VIDEO_MODELS = VIDEO_MODEL_CATALOG;
  const VIDEO_MODELS = videoModels;

  const videoModel: VideoModelId = resolveModelPick(videoPick, videoModels);
  const setVideoModel = (id: VideoModelId) => pickModel('video', id);
  const [isVideoModelDropdownOpen, setIsVideoModelDropdownOpen] = React.useState(false);
  const [videoModelDropDirection, setVideoModelDropDirection] = React.useState<'down' | 'up'>('down');
  const videoModelDropdownRef = React.useRef<HTMLDivElement>(null);
  const videoModelButtonRef = React.useRef<HTMLButtonElement>(null);
  const getVideoModelName = (id: VideoModelId) =>
    videoModels.find((m) => m.id === id)?.name ?? VIDEO_MODEL_CATALOG.find((m) => m.id === id)?.name ?? (id || 'No video model');
  // A "no model added" notice clears itself once a model of that kind is added.
  const visibleGenerationError = generationError?.missingModel
    && (generationError.missingModel === 'image' ? imageModels : videoModels).length > 0
    ? null
    : generationError;
  const getVideoModelDisplayName = (id: VideoModelId) => {
    const name = getVideoModelName(id);
    if (!name) return 'Model';
    return name
      .replace(/Gemini\s+/gi, '')
      .replace(/Claude\s+/gi, '')
      .replace(/GPT\s+/gi, '')
      .replace(/OpenAI\s+/gi, '')
      .replace(/\s+Extended$/gi, '')
      .trim();
  };

  const toggleImageModelDropdown = () => {
    setIsImageModelDropdownOpen(open => {
      const next = !open;
      if (next) {
        setImageModelDropDirection(
          computeDropDirection(imageModelButtonRef.current, estimateDropdownHeight(Math.max(2, imageModels.length))),
        );
      }
      return next;
    });
  };

  const toggleVideoModelDropdown = () => {
    setIsVideoModelDropdownOpen(open => {
      const next = !open;
      if (next) {
        setVideoModelDropDirection(
          computeDropDirection(videoModelButtonRef.current, estimateDropdownHeight(Math.max(2, VIDEO_MODELS.length))),
        );
      }
      return next;
    });
  };
  // Below 961px a model list opens in place inside the settings sheet (media-responsive.css), which
  // can leave it under the sheet's scrolled edge.
  const revealModelList = React.useCallback((list: HTMLDivElement | null) => {
    if (list && isNarrow) list.scrollIntoView({ block: 'nearest' });
  }, [isNarrow]);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (imageModelDropdownRef.current && !imageModelDropdownRef.current.contains(event.target as Node)) {
        setIsImageModelDropdownOpen(false);
      }
    };
    if (isImageModelDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside, { capture: true });
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, { capture: true });
    };
  }, [isImageModelDropdownOpen]);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (videoModelDropdownRef.current && !videoModelDropdownRef.current.contains(event.target as Node)) {
        setIsVideoModelDropdownOpen(false);
      }
    };
    if (isVideoModelDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside, { capture: true });
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, { capture: true });
    };
  }, [isVideoModelDropdownOpen]);

  const getImageModelName = (id: string) =>
    imageModels.find((m) => m.id === liveModelId(id))?.name ?? (id || 'No image model');

  const menuRef = React.useRef<HTMLDivElement>(null);
  const popupRef = React.useRef<HTMLDivElement>(null);
  const activeMenuButtonRef = React.useRef<HTMLElement | null>(null);
  const [menuRect, setMenuRect] = React.useState<{ bottom: number; right: number } | null>(null);

  const openModelMenu = () => {
    if (menuRef.current) {
      activeMenuButtonRef.current = menuRef.current;
      const r = menuRef.current.getBoundingClientRect();
      setMenuRect({
        bottom: window.innerHeight - r.top + 4,
        right: window.innerWidth - r.right,
      });
    }
    setIsModelMenuOpen(true);
  };

  const openModelMenuFromRef = (buttonElement: HTMLElement) => {
    activeMenuButtonRef.current = buttonElement;
    const r = buttonElement.getBoundingClientRect();
    setMenuRect({
      bottom: window.innerHeight - r.top + 4,
      right: window.innerWidth - r.right,
    });
    setIsModelMenuOpen(true);
  };

  React.useEffect(() => {
    const isInsideMenu = (target: Node | null) =>
      (!!target && menuRef.current?.contains(target)) ||
      (!!target && activeMenuButtonRef.current?.contains(target)) ||
      (!!target && popupRef.current?.contains(target));
    const handleClickOutside = (event: MouseEvent) => {
      if (!isInsideMenu(event.target as Node)) {
        setIsModelMenuOpen(false);
      }
    };
    const handleScroll = (event: Event) => {
      if (isInsideMenu(event.target as Node)) return;
      setIsModelMenuOpen(false);
    };
    const handleResize = () => setIsModelMenuOpen(false);
    if (isModelMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside, { capture: true });
      window.addEventListener('scroll', handleScroll, true);
      window.addEventListener('wheel', handleScroll, { capture: true, passive: true });
      window.addEventListener('resize', handleResize);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, { capture: true });
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('wheel', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [isModelMenuOpen]);

  const [modelMode, setModelMode] = useState<'image' | 'video'>('image');
  
  const [isAssetMenuOpen, setIsAssetMenuOpen] = useState(false);
  /** The add menu's trigger: the add button, or in Frames mode (which has none) the frame row. */
  const assetMenuPlusRef = useRef<HTMLElement>(null);
  const [assetMenuSource, setAssetMenuSource] = useState<'main' | 'sidebar' | 'instruction-reference'>('main');
  const [sidebarButtonRef, setSidebarButtonRef] = useState<React.RefObject<HTMLButtonElement> | null>(null);
  const [activeInstructionId, setActiveInstructionId] = useState<string | null>(null);
  const [instructionButtonRef, setInstructionButtonRef] = useState<React.RefObject<any> | null>(null);

  const [imageRatio, setImageRatio] = React.useState('16:9');
  const [imageBatch, setImageBatch] = React.useState('x4');
  const [imageEffort, setImageEffort] = React.useState<'low' | 'medium' | 'high' | 'minimal'>('low');
  const [imageQuality, setImageQuality] = React.useState<string>('high');
  const [imageResolution, setImageResolution] = React.useState<string>('1k');
  const [videoMode, setVideoMode] = React.useState<'frames' | 'ingredients'>('ingredients');
  const [videoRatio, setVideoRatio] = React.useState('16:9');
  const [videoBatch, setVideoBatch] = React.useState('x4');
  const [videoDurationPick, setVideoDuration] = React.useState('10s');
  // Veo rejects 10s, so a Veo model gets the nearest length it takes; the pick itself is kept.
  const videoDuration = fitVideoDuration(videoModel, videoDurationPick);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = React.useState(false);
  const [isLayoutSuppressing, setIsLayoutSuppressing] = React.useState(false);
  
  const handleToggleLeftSidebar = () => {
    setIsLayoutSuppressing(true);
    setIsSidebarCollapsed(c => !c);
    setTimeout(() => {
      setIsLayoutSuppressing(false);
    }, 150);
  };

  const [showFramesPlaceholders, setShowFramesPlaceholders] = React.useState(false);
  const [prevIsFramesMode, setPrevIsFramesMode] = React.useState(false);
  const isFramesMode = modelMode === 'video' && videoMode === 'frames';
  const isFramesModeRef = React.useRef(isFramesMode);
  React.useEffect(() => { isFramesModeRef.current = isFramesMode; }, [isFramesMode]);

  if (isFramesMode !== prevIsFramesMode) {
    setPrevIsFramesMode(isFramesMode);
    if (isFramesMode) {
      setShowFramesPlaceholders(true);
      // Automatically slice attachments to a max of 2 when entering Frames mode
      setAttachments(prev => {
        if (prev.length > 2) {
          return prev.slice(0, 2);
        }
        return prev;
      });
    }
  }

  React.useEffect(() => {
    if (!isFramesMode) {
      if (!hasActiveAttachments) {
        const timer = setTimeout(() => {
          setShowFramesPlaceholders(false);
        }, 350);
        return () => clearTimeout(timer);
      } else {
        setShowFramesPlaceholders(false);
      }
    }
  }, [isFramesMode, hasActiveAttachments]);


  const [canvasInnerWidth, setCanvasInnerWidth] = React.useState(0);
  const [scrollbarWidth, setScrollbarWidth] = React.useState(0);
  // Measure via a callback ref, not an effect: the <main> node is destroyed and
  // recreated by the early-return views (music creation, fullscreen player,
  // characters) without activeSidebarTab changing, so an effect keyed on the tab
  // never re-measures the new node — leaving the gallery laid out at ~1px wide.
  const mainResizeObserverRef = React.useRef<ResizeObserver | null>(null);
  const attachMainRef = React.useCallback((el: HTMLElement | null) => {
    (mainRef as React.MutableRefObject<HTMLElement | null>).current = el;
    mainResizeObserverRef.current?.disconnect();
    mainResizeObserverRef.current = null;
    if (!el) return;
    const update = () => {
      // A detaching node reports 0×0 — never bake that into layout state.
      if (!el.isConnected) return;
      setCanvasInnerWidth(el.clientWidth - 12);
      // Determine OS scrollbar width (e.g. ~17px on Windows, 0px on macOS overlay)
      setScrollbarWidth(el.offsetWidth - el.clientWidth);
      updateCustomScrollbar(el);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    mainResizeObserverRef.current = ro;
  }, [updateCustomScrollbar]);

  // The observer only sees the node's own box — refresh the thumb when content
  // height changes underneath it (tab switch, items added/removed).
  React.useEffect(() => {
    const el = mainRef.current;
    if (el && el.isConnected) updateCustomScrollbar(el);
  }, [activeSidebarTab, displayMediaItems.length, updateCustomScrollbar]);

  // Viewer prompt-box height tracking. When the bottom "What do you want to
  // change?" card grows (attachments / multiline text), the flex-1 main area
  // shrinks and drags the left toolbar and right history thumbnail upward. We
  // measure the card and imperatively counter-translate ONLY those two rails so
  // they stay pinned, while the centered image keeps its natural drift/resize.
  //
  // The offsets are written directly to the DOM from inside the ResizeObserver
  // callback (NOT via React state). ResizeObserver fires after layout but before
  // paint in the SAME frame, so the counter-transform lands in lockstep with the
  // flex layout shift during the 250ms expand/shrink. A React state update would
  // re-render a frame later, leaving the rails visibly drifting mid-animation.
  const viewerPromptBaselineRef = React.useRef<number | null>(null);
  const viewerPromptResizeObserverRef = React.useRef<ResizeObserver | null>(null);
  const viewerPromptDeltaRef = React.useRef(0);
  const historyRailRef = React.useRef<HTMLDivElement | null>(null);

  const applyRailOffsets = React.useCallback(() => {
    const delta = viewerPromptDeltaRef.current;
    // Toolbar is vertically centered → it drifts up by delta/2, so counter by delta/2.
    if (toolbarRef.current) {
      toolbarRef.current.style.transform = `translateY(${delta / 2}px)`;
    }
    // History rail is bottom-anchored → it drifts up by the full delta.
    // Keep it at the actual bottom edge so the prompt actions remain inside
    // the visible rail instead of being clipped by the history viewport.
    if (historyRailRef.current) {
      historyRailRef.current.style.transform = `translateY(${delta}px)`;
    }
  }, []);

  // Callback ref for the history thumbnail's inner div: re-apply the current
  // offset whenever it mounts (e.g. toggling Show history back on while an
  // attachment is present), since the ResizeObserver won't fire on that toggle.
  const setHistoryRail = React.useCallback((el: HTMLDivElement | null) => {
    historyRailRef.current = el;
    if (el) applyRailOffsets();
  }, [applyRailOffsets]);

  const measureViewerPromptCard = React.useCallback((el: HTMLDivElement | null) => {
    viewerPromptResizeObserverRef.current?.disconnect();
    viewerPromptResizeObserverRef.current = null;
    if (!el) {
      // Card unmounted (viewer closed or crop mode) → no rail offset.
      viewerPromptBaselineRef.current = null;
      viewerPromptDeltaRef.current = 0;
      applyRailOffsets();
      return;
    }
    const update = () => {
      const h = el.offsetHeight;
      if (viewerPromptBaselineRef.current === null || h < viewerPromptBaselineRef.current) {
        viewerPromptBaselineRef.current = h;
      }
      viewerPromptDeltaRef.current = Math.max(0, h - (viewerPromptBaselineRef.current ?? h));
      applyRailOffsets();
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    viewerPromptResizeObserverRef.current = ro;
  }, [applyRailOffsets]);

  const prevItemCountRef = React.useRef(0);
  React.useEffect(() => {
    if (displayMediaItems.length > prevItemCountRef.current && mainRef.current) {
      mainRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
    prevItemCountRef.current = displayMediaItems.length;
  }, [displayMediaItems.length]);

  const updateViewerFades = (target: HTMLTextAreaElement) => {
    const scrollHeight = target.scrollHeight;
    const clientHeight = target.clientHeight;
    const scrollTop = target.scrollTop;

    // Use a 4px tolerance to handle fractional browser scaling/zoom & line heights
    const hasScrollableHeight = scrollHeight > clientHeight + 4;
    const scrolledFromTop = scrollTop > 2;
    const canScrollMore = scrollHeight - scrollTop > clientHeight + 4;

    setIsViewerTopFaded(hasScrollableHeight && scrolledFromTop);
    setIsViewerBottomFaded(hasScrollableHeight && canScrollMore);
  };

  React.useEffect(() => {
    const adjustHeight = () => {
      if (viewerTextareaRef.current) {
        const el = viewerTextareaRef.current;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 384)}px`;
        updateViewerFades(el);
      }
    };

    adjustHeight();

    const handle = requestAnimationFrame(adjustHeight);
    
    if (typeof document !== 'undefined' && 'fonts' in document) {
      document.fonts.ready.then(adjustHeight);
    }

    const timer = setTimeout(adjustHeight, 200);
    window.addEventListener('resize', adjustHeight);

    return () => {
      cancelAnimationFrame(handle);
      clearTimeout(timer);
      window.removeEventListener('resize', adjustHeight);
    };
  }, [editPrompt]);

  const getGeminiInlinePart = async (att: ImageAttachment): Promise<{ inlineData: { data: string; mimeType: string } }> => {
    if (att.url.startsWith('data:')) {
      const match = att.url.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        return {
          inlineData: {
            mimeType: match[1],
            data: match[2],
          },
        };
      }
    }

    if (att.file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          const match = result.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            resolve({
              inlineData: {
                mimeType: match[1],
                data: match[2],
              },
            });
          } else {
            reject(new Error('Failed to parse file data'));
          }
        };
        reader.onerror = reject;
        reader.readAsDataURL(att.file);
      });
    }

    try {
      const resp = await fetch(att.url);
      const blob = await resp.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          const match = result.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            resolve({
              inlineData: {
                mimeType: match[1],
                data: match[2],
              },
            });
          } else {
            reject(new Error('Failed to parse fetched blob'));
          }
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      throw new Error(`Failed to load attachment: ${att.name}`);
    }
  };

  // The user's renaming model when it is a Gemini one, since this request goes to Gemini.
  const chosenNamingModel = (savedModelConfig as any)?.systemDefaults?.chatRenaming;
  const namingModel = typeof chosenNamingModel === 'string' && chosenNamingModel.startsWith('gemini-')
    ? chosenNamingModel
    : 'gemini-3.1-flash-lite';

  const rephrasePromptForItems = async (itemIds: string[], activePrompt: string, apiKey: string) => {
    try {
      const fetchRephrase = async (model: string) => {
        return await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [{
                  text: `You are a creative helper. Rephrase this image generation prompt into a very concise and descriptive title/name (maximum 6 to 8 words). Return only the rephrased title itself, without any punctuation, quotes, introduction, or explanations.\n\nPrompt: ${activePrompt}`
                }]
              }]
            })
          }
        );
      };

      const rephraseResp = await fetchRephrase(namingModel);
      
      if (rephraseResp.ok) {
        const rephraseData = await rephraseResp.json();
        let text = rephraseData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text) {
          text = text.replace(/^["'`\s]+|["'`\s]+$/g, '');
          if (text) {
            setMediaItems(prev =>
              prev.map(m => (itemIds.includes(m.id) ? { ...m, shortenedPrompt: text } : m)),
            );
          }
        }
      }
    } catch (e) {
      // Fail silently
    }
  };

  const generateSingleImage = async (
    item: MediaItem,
    activePrompt: string,
    modelId: string,
    ratio: string,
    apiKey: string,
    activeAttachments: ImageAttachment[],
  ): Promise<GenerationResult> => {
    try {
      const isGrok = modelId === 'grok-imagine';
      const isOpenAi = modelId === 'gpt-image-2';
      
      if (isGrok || isOpenAi) {
        const savedConfigRaw = typeof window !== 'undefined' ? localStorage.getItem('modelConfig') : null;
        let modelConfig: any = null;
        try {
          modelConfig = savedConfigRaw ? JSON.parse(savedConfigRaw) : null;
        } catch (e) {}

        const provider = isGrok ? 'spacexai' : 'openai';
        const config = modelConfig?.[provider];
        const key = apiKeys?.[provider]?.[0];
        
        // Load baseUrl from local config
        let baseUrl = config?.baseUrl;
        
        // If not found in config, use the endpoint saved alongside the keys
        if (!baseUrl && typeof window !== 'undefined') {
          try {
            const serialized = localStorage.getItem(DEVICE_KEY_SLOT.providerState);
            if (serialized) {
              const ps = JSON.parse(serialized);
              baseUrl = ps?.[provider]?.baseUrl;
            }
          } catch (e) {}
        }
        
        baseUrl = (baseUrl || (isGrok ? 'https://api.x.ai/v1' : 'https://api.openai.com/v1')).trim();
        // Standardize: remove trailing slashes and trailing /v1 to prevent duplicate path suffixes
        baseUrl = baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
        
        if (!key) {
          throw new Error(`API key not configured for ${isGrok ? 'Grok' : 'OpenAI'}. Please set it up in the Settings panel.`);
        }

        const response = await fetch(`/llm-proxy/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json',
            'x-proxy-target': baseUrl
          },
          body: JSON.stringify({
            model: modelId,
            messages: [
              { 
                role: 'user', 
                content: `${activePrompt}${ratio ? ` [Aspect Ratio: ${ratio}]` : ''}${modelId === 'gpt-image-2' ? ` [Quality: ${imageQuality}] [Resolution: ${imageResolution}]` : ''}` 
              }
            ],
            // Only attach reasoning_effort parameter for models that natively support it
            ...( (modelId === 'gpt-image-2') ? { reasoning_effort: imageEffort === 'minimal' ? 'low' : imageEffort } : {} )
          })
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          const msg = errData?.error?.message || `API error (${response.status})`;
          throw new Error(msg);
        }

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content || '';
        
        const extractImageFromContent = (contentStr: string): string | null => {
          if (!contentStr) return null;
          
          // 1. Look for inline base64 data URIs
          const dataUriIndex = contentStr.indexOf('data:image/');
          if (dataUriIndex !== -1) {
            const sub = contentStr.slice(dataUriIndex);
            const endMatch = sub.match(/[\r\n\s\)\"']/);
            const endIndex = endMatch ? endMatch.index : sub.length;
            const rawUri = sub.slice(0, endIndex);
            return rawUri.replace(/[\r\n\s]+/g, '');
          }
          
          // 2. Look for absolute http/https URLs
          const httpsIndex = contentStr.indexOf('https://');
          const httpIndex = contentStr.indexOf('http://');
          const startIndex = httpsIndex !== -1 ? httpsIndex : httpIndex;
          if (startIndex !== -1) {
            const sub = contentStr.slice(startIndex);
            const endMatch = sub.match(/[\r\n\s\)\"']/);
            const endIndex = endMatch ? endMatch.index : sub.length;
            return sub.slice(0, endIndex).trim();
          }

          return null;
        };

        const imageUrl = extractImageFromContent(content);
        if (!imageUrl) {
          throw new Error('No image was returned in the model response. Try a different prompt.');
        }

        setMediaItems(prev =>
          prev.map(m => (m.id === item.id ? { ...m, status: 'completed', url: imageUrl } : m)),
        );
        if (isLocalFolderConnected) {
          void saveGeneratedMedia({ ...item, url: imageUrl }, imageUrl);
        }
        return { status: 'completed', url: imageUrl };
      }

      const inlineParts = await Promise.all(activeAttachments.map(getGeminiInlinePart));

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${liveModelId(modelId)}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: activePrompt },
                ...inlineParts
              ]
            }],
            generationConfig: {
              responseModalities: ['IMAGE'],
              imageConfig: { 
                aspectRatio: ratio, 
                imageSize: imageResolution === '1k' ? '1K' : imageResolution === '2k' ? '2K' : imageResolution === '4k' ? '4K' : '2K'
              },
            },
          }),
        },
      );

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const status = response.status;
        const msg = errData?.error?.message || '';
        
        if (status === 400 && msg.toLowerCase().includes('key')) {
          throw new Error('Invalid API Key. Please check your workspace configuration in the Settings panel.');
        } else if (status === 403) {
          throw new Error('Access forbidden. Please check your API key permissions and region restrictions.');
        } else if (status === 429) {
          throw new Error('Rate limit exceeded. Too many requests. Please wait a moment and try again.');
        } else if (status === 503 || status === 504) {
          throw new Error('The generation service is currently overloaded. Please wait a few seconds and try again.');
        }
        
        throw new Error(msg || `API error (${status})`);
      }

      const data = await response.json();
      
      if (data?.promptFeedback?.blockReason === 'SAFETY') {
        throw new Error('This prompt might violate our safety policies. Please try a different prompt or send feedback.');
      }
      if (data?.candidates?.[0]?.finishReason === 'SAFETY') {
        throw new Error('This prompt might violate our safety policies. Please try a different prompt or send feedback.');
      }
      if (data?.candidates?.[0]?.finishReason === 'RECITATION') {
        throw new Error('Blocked due to copyright or recitation policies. Please try a different prompt.');
      }

      const parts = data?.candidates?.[0]?.content?.parts || [];
      const imagePart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith('image/'));
      if (!imagePart?.inlineData?.data) {
        throw new Error('The model was unable to generate an image from this prompt. Try adding more descriptive details.');
      }
      const url = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
      setMediaItems(prev =>
        prev.map(m => (m.id === item.id ? { ...m, status: 'completed', url } : m)),
      );
      if (isLocalFolderConnected) {
        void saveGeneratedMedia({ ...item, url }, url);
      }
      return { status: 'completed', url };
    } catch (err: any) {
      console.error(`[image ${item.id}] failed:`, err);
      const error = err?.message || 'Generation failed.';
      setMediaItems(prev =>
        prev.map(m =>
          m.id === item.id ? { ...m, status: 'failed', error } : m,
        ),
      );
      return { status: 'failed', error };
    }
  };

  const generateSingleVideo = async (
    item: MediaItem,
    activePrompt: string,
    videoModelKey: VideoModelId,
    ratio: string,
    durationStr: string,
    apiKey: string,
    activeAttachments: ImageAttachment[],
  ): Promise<GenerationResult> => {
    videoDurationsRef.current.set(item.id, durationStr);
    try {
      const apiModelId = videoApiModelId(videoModelKey);
      const durationSec = parseInt(fitVideoDuration(videoModelKey, durationStr), 10) || 8;

      const inlineParts = await Promise.all(activeAttachments.map(getGeminiInlinePart));
      const firstImagePart = inlineParts[0]?.inlineData;

      if (isOmniFlashModel(videoModelKey)) {
        const interactionsInput = [
          { 
            type: 'text', 
            text: `${activePrompt}\n\n[System: Please generate this video with an aspect ratio of ${ratio} and a duration of ${durationSec} seconds.]` 
          },
          ...inlineParts.map(part => {
            if (part.inlineData) {
              return {
                type: 'image',
                mime_type: part.inlineData.mimeType || 'image/png',
                data: part.inlineData.data
              };
            }
            return null;
          }).filter(Boolean)
        ];

        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/interactions`,
          {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'x-goog-api-key': apiKey
            },
            body: JSON.stringify({
              model: `models/${apiModelId}`,
              input: interactionsInput,
              response_format: {
                type: 'video',
                aspect_ratio: ratio
              }
            }),
          }
        );

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          const status = response.status;
          const msg = errData?.error?.message || errData?.[0]?.error?.message || '';
          
          if (status === 400 && msg.toLowerCase().includes('key')) {
            throw new Error('Invalid API Key. Please check your workspace configuration in the Settings panel.');
          } else if (status === 403) {
            throw new Error('Access forbidden. Please check your API key permissions and region restrictions.');
          } else if (status === 429) {
            throw new Error('Rate limit exceeded. Too many requests. Please wait a moment and try again.');
          } else if (status === 503 || status === 504) {
            throw new Error('The generation service is currently overloaded. Please wait a few seconds and try again.');
          }
          
          throw new Error(msg || `API error (${status})`);
        }

        const data = await response.json();
        
        if (data?.promptFeedback?.blockReason === 'SAFETY' || data?.state === 'BLOCKED') {
          throw new Error('This prompt might violate our safety policies. Please try a different prompt or send feedback.');
        }

        let videoUrl = '';
        
        if (data?.steps) {
          const outputStep = data.steps.find((s: any) => 
            s.type === 'model_output' || s.stepType === 'model_output' || s.step_type === 'model_output'
          );
          if (outputStep) {
            const parts = Array.isArray(outputStep.content)
              ? outputStep.content
              : (outputStep.content?.parts || outputStep.modelOutput?.parts || []);
            
            const videoPart = parts.find((p: any) => 
              p.mime_type?.startsWith('video/') || p.mimeType?.startsWith('video/') ||
              p.inlineData?.mimeType?.startsWith('video/') || p.videoMetadata?.uri || p.video_metadata?.uri
            );
            
            if (videoPart) {
              if (videoPart.inlineData?.data) {
                videoUrl = `data:${videoPart.inlineData.mimeType};base64,${videoPart.inlineData.data}`;
              } else if (videoPart.data) {
                const mime = videoPart.mime_type || videoPart.mimeType || 'video/mp4';
                videoUrl = `data:${mime};base64,${videoPart.data}`;
              } else if (videoPart.videoMetadata?.uri) {
                videoUrl = videoPart.videoMetadata.uri;
              } else if (videoPart.video_metadata?.uri) {
                videoUrl = videoPart.video_metadata.uri;
              }
            }
          }
        }

        if (!videoUrl) {
          console.error("Unrecognized response shape or missing video:", data);
          throw new Error('The model was unable to generate a video from this prompt. Try adding more descriptive details.');
        }

        setMediaItems(prev =>
          prev.map(m => (m.id === item.id ? { ...m, status: 'completed', url: videoUrl } : m)),
        );
        if (isLocalFolderConnected) {
          void saveGeneratedMedia({ ...item, url: videoUrl }, videoUrl);
        }
        return { status: 'completed', url: videoUrl };
      }

      const instance: any = { prompt: activePrompt };
      if (firstImagePart) {
        instance.image = {
          imageBytes: firstImagePart.data,
          mimeType: firstImagePart.mimeType
        };
      }

      const startResp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${apiModelId}:predictLongRunning?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instances: [instance],
            parameters: {
              aspectRatio: ratio,
              durationSeconds: durationSec,
              personGeneration: 'allow_all',
            },
          }),
        },
      );

      if (!startResp.ok) {
        const errData = await startResp.json().catch(() => ({}));
        const status = startResp.status;
        const msg = errData?.error?.message || '';
        
        if (status === 400 && msg.toLowerCase().includes('key')) {
          throw new Error('Invalid API Key. Please check your workspace configuration in the Settings panel.');
        } else if (status === 403) {
          throw new Error('Access forbidden. Please check your API key permissions and region restrictions.');
        } else if (status === 429) {
          throw new Error('Rate limit exceeded. Too many requests. Please wait a moment and try again.');
        } else if (status === 503 || status === 504) {
          throw new Error('The generation service is currently overloaded. Please wait a few seconds and try again.');
        }
        
        throw new Error(msg || `API error (${status})`);
      }

      const startData = await startResp.json();
      const operationName: string | undefined = startData?.name;
      if (!operationName) throw new Error('Veo returned no operation handle.');

      let done = false;
      let videoUri: string | undefined;
      const maxAttempts = 90;
      for (let attempt = 0; attempt < maxAttempts && !done; attempt++) {
        await new Promise(r => setTimeout(r, 5000));
        const pollResp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/${operationName}?key=${apiKey}`,
        );
        if (!pollResp.ok) continue;
        const pollData = await pollResp.json();
        if (pollData?.done) {
          done = true;
          if (pollData.error) {
            const msg = pollData.error.message || '';
            if (msg.toLowerCase().includes('safety')) {
              throw new Error('This prompt might violate our safety policies. Please try a different prompt or send feedback.');
            }
            throw new Error(msg || 'Video generation failed.');
          }
          videoUri =
            pollData?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ??
            pollData?.response?.videos?.[0]?.uri ??
            pollData?.response?.generatedVideos?.[0]?.video?.uri;
        }
      }

      if (!videoUri) throw new Error('Video generation request timed out after polling.');

      const sep = videoUri.includes('?') ? '&' : '?';
      const externalUrl = `${videoUri}${sep}key=${apiKey}`;

      // Inline the video to a durable base64 data URL (like images already are),
      // so it survives reload. The external URL carries an API key and expires,
      // which would leave a black/blank video next time the project is opened.
      // Fall back to the external URL only if the fetch fails (plays this session).
      let url = externalUrl;
      try {
        const vblob = await fetch(externalUrl).then(r => r.blob());
        url = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(vblob);
        });
      } catch (e) {
        // keep externalUrl as a session-only fallback
      }

      setMediaItems(prev =>
        prev.map(m => (m.id === item.id ? { ...m, status: 'completed', url } : m)),
      );
      if (isLocalFolderConnected) {
        void saveGeneratedMedia({ ...item, url }, url);
      }
      return { status: 'completed', url };
    } catch (err: any) {
      console.error(`[video ${item.id}] failed:`, err);
      const error = err?.message || 'Video generation failed.';
      setMediaItems(prev =>
        prev.map(m =>
          m.id === item.id ? { ...m, status: 'failed', error } : m,
        ),
      );
      return { status: 'failed', error };
    }
  };

  // ── Media agent host ─────────────────────────────────────────────────────
  // The conversation, its streaming and its tool loop live in ./agent/agent-session.ts. This
  // is the half it cannot own: generations run through the same functions the prompt box uses,
  // so agent media is named, saved to disk and shown exactly like everything else.
  const getImageApiKey = (modelId: string): string => {
    const provider = modelId === 'grok-imagine' ? 'spacexai' : modelId === 'gpt-image-2' ? 'openai' : 'gemini';
    return apiKeys?.[provider]?.[0] || '';
  };

  // Only what the user added: the agent can't make a kind of media the prompt box can't.
  const agentImageModels: AgentModelOption[] = imageModels;
  const agentVideoModels: AgentModelOption[] = videoModels;
  const agentUserName = String(userProfile?.displayName || user?.displayName || '').trim().split(/\s+/)[0] || undefined;

  const toReferenceAttachment = (item: MediaItem): ImageAttachment => ({
    id: item.id,
    url: item.url || '',
    name: item.shortenedPrompt || item.prompt || 'Reference',
    kind: item.kind,
  });

  const createAgentItems = (
    kind: 'image' | 'video',
    spec: { prompt: string; model: string; modelName: string; ratio: string; count: number; attachments: ImageAttachment[] },
  ): MediaItem[] => {
    const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const items: MediaItem[] = allocateMediaBatchTimestamps(spec.count).map((timestamp, i) => ({
      id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`,
      kind,
      status: 'generating',
      prompt: spec.prompt,
      modelId: spec.model,
      modelName: spec.modelName,
      ratio: spec.ratio,
      timestamp,
      batchId,
      collectionId: openCollectionRef.current,
      ...(spec.attachments.length ? { attachments: spec.attachments } : {}),
      ...(kind === 'image' ? { effort: imageEffort, quality: imageQuality, resolution: imageResolution } : {}),
    }));
    items.forEach((item) => agentTurnItemIdsRef.current.add(item.id));
    setIsLayoutSuppressing(true);
    setMediaItems((prev) => [...items, ...prev]);
    setTimeout(() => setIsLayoutSuppressing(false), 150);
    const namingKey = apiKeys?.gemini?.[0];
    if (namingKey) void rephrasePromptForItems(items.map((item) => item.id), spec.prompt, namingKey);
    return items;
  };

  const toOutcome = (id: string, result: GenerationResult): GenerationOutcome =>
    result.status === 'completed' ? { id, status: 'completed', url: result.url } : { id, status: 'failed', error: result.error };

  const startAgentImages: MediaAgentHost['startImages'] = ({ prompt, apiPrompt, model, ratio, count, references }) => {
    if (!model) return { error: 'No image model is added. Add one in Settings → Models.' };
    const apiKey = getImageApiKey(model);
    if (!apiKey) return { error: `${getImageModelName(model)} needs an API key. Add one in Settings > Models & API.` };
    const attachments = references.map(toReferenceAttachment);
    const items = createAgentItems('image', { prompt, model, modelName: getImageModelName(model), ratio, count, attachments });
    const done = Promise.all(items.map(async (item) =>
      toOutcome(item.id, await generateSingleImage(item, apiPrompt ?? prompt, model, ratio, apiKey, attachments))));
    return { ids: items.map((item) => item.id), done };
  };

  const startAgentVideos: MediaAgentHost['startVideos'] = ({ prompt, apiPrompt, model, ratio, duration, count, frames }) => {
    if (!model) return { error: 'No video model is added. Add one in Settings → Models.' };
    const apiKey = apiKeys?.gemini?.[0];
    if (!apiKey) return { error: 'Video generation needs a Google Gemini API key. Add one in Settings > Models & API.' };
    const attachments = frames.map(toReferenceAttachment);
    const items = createAgentItems('video', { prompt, model, modelName: getVideoModelName(model), ratio, count, attachments });
    const done = Promise.all(items.map(async (item) =>
      toOutcome(item.id, await generateSingleVideo(item, apiPrompt ?? prompt, model as VideoModelId, ratio, duration, apiKey, attachments))));
    return { ids: items.map((item) => item.id), done };
  };

  // ── Work another tab carries on ────────────────────────────────────────────
  // While anything runs, the editor holds one background job (`media-jobs.ts`)
  // naming what another tab would start again if this one closed.
  const workJobRef = React.useRef<BackgroundJobHandle<MediaWorkJob> | null>(null);
  const workPayload = (): MediaWorkJob => {
    const agentRunning = isAgentGenerating;
    const generating = mediaItems.filter((item) => item.status === 'generating' && item.modelId !== 'upload');
    const question = [...mediaAgent.$messages.get()].reverse().find((message) => message.role === 'user');
    return {
      projectId: persistProjectId,
      agentSessionId: agentRunning ? mediaAgent.$session.get().id : null,
      agentPrompt: agentRunning && question ? question.content : null,
      itemIds: generating
        .filter((item) => !(agentRunning && agentTurnItemIdsRef.current.has(item.id)))
        .map((item) => item.id),
      videoDurations: Object.fromEntries(generating
        .filter((item) => item.kind === 'video')
        .map((item) => [item.id, videoDurationsRef.current.get(item.id) ?? videoDuration])),
    };
  };
  const workKey = isMediaWorking && persistProjectId ? JSON.stringify(workPayload()) : '';
  React.useEffect(() => {
    if (!workKey) {
      workJobRef.current?.finish();
      workJobRef.current = null;
      return;
    }
    const payload = JSON.parse(workKey) as MediaWorkJob;
    if (workJobRef.current) {
      workJobRef.current.update(payload);
      return;
    }
    workJobRef.current = startMediaWorkJob(inheritedJobIdRef.current ?? undefined, chatScopeId || 'guest', payload);
    inheritedJobIdRef.current = null;
  }, [workKey]);
  // Unmounting is leaving the work behind (another project): not for another tab
  // to pick up. A closed tab never unmounts, so its work still is.
  React.useEffect(() => () => {
    workJobRef.current?.finish();
    workJobRef.current = null;
  }, []);

  /** Starts a saved generating item again from what it recorded. */
  const restartGeneration = (item: MediaItem, durationStr?: string) => {
    // A reference is re-read from this gallery: the closed tab's `blob:` URLs died with it.
    const attachments = (item.attachments ?? []).flatMap((attachment) => {
      const source = attachment.id ? mediaItemsRef.current.find((candidate) => candidate.id === attachment.id) : undefined;
      const url = source?.url || (attachment.url && !attachment.url.startsWith('blob:') ? attachment.url : '');
      return url ? [{ ...attachment, url }] : [];
    });
    if (item.kind === 'video') {
      void generateSingleVideo(item, item.prompt, item.modelId as VideoModelId, item.ratio, durationStr || videoDuration, apiKeys?.gemini?.[0] || '', attachments);
    } else {
      void generateSingleImage(item, item.prompt, item.modelId, item.ratio, getImageApiKey(item.modelId), attachments);
    }
  };

  /*
   * Work a closed tab left, inherited by this one: once the gallery has loaded
   * (keeping the items it was still generating), start each of those again, and
   * run the agent's interrupted request again in its own conversation.
   */
  const mediaResume = useStore($mediaResume);
  const resumedJobRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!mediaResume || resumedJobRef.current === mediaResume.job.id) return;
    const { projectId: wanted, itemIds, videoDurations, agentSessionId, agentPrompt } = mediaResume.job.payload;
    if (wanted !== persistProjectId || isInitialLoading || !mediaLoadedRef.current) return;
    resumedJobRef.current = mediaResume.job.id;
    inheritedJobIdRef.current = mediaResume.job.id;
    for (const id of itemIds) {
      const item = mediaItemsRef.current.find((candidate) => candidate.id === id && candidate.status === 'generating');
      if (item) restartGeneration(item, videoDurations[id]);
    }
    if (!agentSessionId) {
      mediaResume.settle();
      return;
    }
    setIsAgentActive(true);
    setIsAgentSidebarOpen(true);
    void (async () => {
      await mediaAgent.openSession(agentSessionId);
      const question = [...mediaAgent.$messages.get()].reverse().find((message) => message.role === 'user');
      // The request this turn answered never reached the conversation if the tab
      // closed before the save at the turn's start landed.
      if (agentPrompt && question?.content !== agentPrompt) mediaAgent.send({ text: agentPrompt });
      else mediaAgent.resumeInterrupted();
      mediaResume.settle();
    })();
  }, [mediaResume, persistProjectId, isInitialLoading]);

  const AGENT_TAB_LABELS: Record<string, string> = {
    all: 'All media', images: 'Images', video: 'Videos', characters: 'Characters',
    music: 'Music', scenes: 'Scenes', uploads: 'Uploads', tools: 'Tools',
  };
  const sceneRef = (item: MediaItem) => ({ id: item.id, url: item.url, ratio: item.ratio });

  agentHostRef.current = {
    projectId: persistProjectId,
    scopeId: chatScopeId,
    geminiKeys: apiKeys?.gemini ?? [],
    userName: agentUserName,
    // Beside the project's media, under the folder name its saves use.
    saveSessionToDisk: (session, files) => (
      isLocalFolderConnected ? saveLocalFSMediaAgentSession(projectName || 'Default', session, files) : Promise.resolve(false)
    ),
    // Remembered too, so a copy the folder still has is not read back as one this browser lacks.
    deleteSessionFromDisk: (sessionId) => {
      rememberDeleted('agent-session', chatScopeId, persistProjectId, sessionId);
      return isLocalFolderConnected ? deleteLocalFSMediaAgentSession(projectName || 'Default', sessionId) : Promise.resolve(false);
    },
    get mediaItems() {
      return mediaItemsRef.current;
    },
    defaults: {
      imageModel,
      imageRatio,
      imageCount: batchCount(imageBatch),
      videoModel,
      videoRatio,
      videoCount: batchCount(videoBatch),
      videoDuration,
    },
    imageModels: agentImageModels,
    videoModels: agentVideoModels,
    get collections() {
      return $collections.get().map((c) => ({ id: c.id, name: c.name }));
    },
    get characters() {
      return $characters.get();
    },
    get scenes() {
      return $scenes.get();
    },
    get focus() {
      return {
        tab: AGENT_TAB_LABELS[activeSidebarTab] ?? 'All media',
        collectionId: openCollectionId ?? undefined,
        viewerId: selectedItem?.id,
        sceneId: activeSceneId && !isVideoScene(activeSceneId) ? activeSceneId : undefined,
        characterId: activeCharacter && activeCharacter !== 'new' ? activeCharacter : undefined,
        selection: [...selectedTileIds].map((id) => (
          id.startsWith(SCENE_ITEM_PREFIX) ? { kind: 'scene' as const, id: id.slice(SCENE_ITEM_PREFIX.length) }
            : id.startsWith(COLLECTION_ITEM_PREFIX) ? { kind: 'collection' as const, id: id.slice(COLLECTION_ITEM_PREFIX.length) }
              : { kind: 'media' as const, id }
        )),
      };
    },
    startImages: startAgentImages,
    startVideos: startAgentVideos,
    createCharacter: ({ name, prompt, personality, voice }) =>
      createCharacter({ name, prompt, ...(personality ? { personality } : {}), ...(voice ? { voice: { name: voice } } : {}) }).id,
    updateCharacter: (id, { voice, ...patch }) => {
      updateCharacter(id, { ...patch, ...(voice ? { voice: { name: voice } } : {}) });
    },
    deleteCharacter: (id) => deleteCharacter(id),
    startCharacterImage: ({ characterId, slot, prompt, model, references, parent }) => {
      const started = launchCharacterImage({ prompt, modelId: model, references, characterId, slot, parent });
      if ('notice' in started) return { error: started.notice.message };
      return { id: started.item.id, done: started.done.then((result) => toOutcome(started.item.id, result)) };
    },
    createScene: ({ name, videos }) => createSceneFromVideos(videos.map(sceneRef), name),
    updateScene: async (id, { name, plan }) => {
      if (name) updateStoredScene(id, { name });
      if (!plan) return getScene(id);
      return setSceneClips(
        id,
        plan.map((entry) => ('clip' in entry ? entry.clip : sceneRef(entry.video))),
        (mediaId) => mediaItemsRef.current.find((m) => m.id === mediaId)?.url,
      );
    },
  };

  // ── Scenebuilder host ────────────────────────────────────────────────────
  // Scenes live in ./scenes (store, tiles, editor). The editor opens on `?scene=<id>`, so the
  // browser's Back closes it, and reaches the gallery only through this host.
  React.useEffect(() => {
    void bindSceneProject(persistProjectId, chatScopeId);
  }, [persistProjectId, chatScopeId]);

  // Each scene is also a small file in the project folder's Scenes/, its clips pointing at their
  // videos' files there (scenes/scene-folder-sync.ts).
  const sceneFolder = React.useMemo<SceneFolder>(() => ({
    key: localFolderName || '',
    list: listLocalFSScenes,
    save: saveLocalFSScene,
    remove: deleteLocalFSScene,
  }), [localFolderName, listLocalFSScenes, saveLocalFSScene, deleteLocalFSScene]);
  React.useEffect(() => { sceneFolderRef.current = sceneFolder; }, [sceneFolder]);
  useSceneFolderSync({
    folder: sceneFolder,
    projectId: persistProjectId,
    projectName,
    connected: isLocalFolderConnected && isLocalFolderAuthorized && !!projectName && !!projectId && !projectId.startsWith('temp_'),
    items: mediaItems,
    folderOf: collectionFolder,
    collectionsKey: collections,
  });

  const openSceneEditor = useEventCallback((sceneId: string) => {
    const next = new URLSearchParams(location.search);
    next.set('scene', sceneId);
    navigate({ pathname: location.pathname, search: `?${next.toString()}` });
  });
  const closeSceneEditor = useEventCallback(() => {
    const next = new URLSearchParams(location.search);
    next.delete('scene');
    const search = next.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '' });
  });
  React.useEffect(() => {
    setSceneOpener(openSceneEditor);
    return () => setSceneOpener(null);
  }, [openSceneEditor]);

  // ── Characters ───────────────────────────────────────────────────────────
  // Characters live in ./characters. The tab shows their grid; the new-character page opens on
  // `?character=new` and a character on `?character=<id>`.
  const charactersLoaded = useStore($charactersLoaded);
  React.useEffect(() => {
    void bindCharacterProject(persistProjectId, chatScopeId);
  }, [persistProjectId, chatScopeId]);
  // Each character is also a small file in the project folder's Images/Characters/, its pictures
  // pointing at their files (characters/character-folder-sync.ts). Characters are kept per account,
  // so a change of account reads the folder again before writing to it.
  const characterFolder = React.useMemo<CharacterFolder>(() => ({
    key: `${chatScopeId}\u0000${localFolderName || ''}`,
    list: (name) => listLocalFSMediaFolderFiles(name, CHARACTERS_FOLDER),
    save: (name, fsName, text) => saveLocalFSMediaFolderFile(name, CHARACTERS_FOLDER, fsName, text),
    remove: (name, fsName) => deleteLocalFSMediaFolderFile(name, CHARACTERS_FOLDER, fsName),
  }), [chatScopeId, localFolderName, listLocalFSMediaFolderFiles, saveLocalFSMediaFolderFile, deleteLocalFSMediaFolderFile]);
  React.useEffect(() => { characterFolderRef.current = characterFolder; }, [characterFolder]);
  useCharacterFolderSync({
    folder: characterFolder,
    projectId: persistProjectId,
    projectName,
    connected: isLocalFolderConnected && isLocalFolderAuthorized && !!projectName && !!projectId && !projectId.startsWith('temp_'),
    items: mediaItems,
    folderOf: collectionFolder,
    collectionsKey: collections,
  });
  // The page a click asked for (null: none), shown on that click's own frame. react-router renders
  // navigations as transitions, which would leave the old page up a few frames. It holds only
  // while the location is the one it was asked from; once any navigation lands, the URL decides.
  const [characterRequest, setCharacterRequest] = React.useState<{ page: string | null; from: string } | null>(null);
  const openCharacterPage = useEventCallback((target: string | null) => {
    setCharacterRequest({ page: target, from: location.key });
    const next = new URLSearchParams(location.search);
    if (target) next.set('character', target);
    else next.delete('character');
    const search = next.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: !target });
  });
  React.useEffect(() => {
    setCharacterOpener(openCharacterPage);
    return () => setCharacterOpener(null);
  }, [openCharacterPage]);
  const activeCharacter = new URLSearchParams(location.search).get('character');
  // With no characters yet, Flow's Characters tab opens straight onto New character. That is decided
  // here, in render, so the empty grid never paints first; the effect only puts it in the URL.
  const charactersTabEmpty = activeSidebarTab === 'characters' && charactersLoaded && characters.length === 0;
  const pendingCharacterRequest = characterRequest?.from === location.key ? characterRequest : null;
  const characterPage = (pendingCharacterRequest ? pendingCharacterRequest.page : activeCharacter) ?? (charactersTabEmpty ? 'new' : null);
  React.useEffect(() => {
    if (!charactersTabEmpty || activeCharacter) return;
    const next = new URLSearchParams(location.search);
    next.set('character', 'new');
    navigate({ pathname: location.pathname, search: `?${next.toString()}` }, { replace: true });
  }, [charactersTabEmpty, activeCharacter]); // eslint-disable-line react-hooks/exhaustive-deps
  // Both character pages and both editors are fetched ahead, so none opens onto a frame of what is
  // behind it while its chunk loads: at idle, or at once when the Characters tab or a page is up.
  const characterPagesWanted = activeSidebarTab === 'characters' || !!characterPage;
  React.useEffect(() => {
    const preload = () => {
      void NewCharacterPage.preload();
      void CharacterEditPage.preload();
      void SceneBuilder.preload();
      void ImageEditor.preload();
    };
    if (characterPagesWanted) { preload(); return; }
    if (typeof window.requestIdleCallback !== 'function') {
      const timer = window.setTimeout(preload, 3000);
      return () => window.clearTimeout(timer);
    }
    const idle = window.requestIdleCallback(preload, { timeout: 5000 });
    return () => window.cancelIdleCallback(idle);
  }, [characterPagesWanted]);

  // ── @ mentions ───────────────────────────────────────────────────────────
  // Flow's prompt box: "@" at a word start opens the add menu as a popover over the box, and a
  // pick lands twice, as an ingredient and as a chip in the text that names it. A character's
  // ingredient stands for its portrait and body; toGenerationInput sends both under its name.
  // In Frames mode a character can't be an ingredient, so its chip is left invalid, as Flow's is.
  // The add button opens the same menu, as Flow's does; its picks join the ingredients only.
  const [mentionOpen, setMentionOpen] = React.useState(false);
  const [mentionAnchor, setMentionAnchor] = React.useState<DOMRect | null>(null);
  const mentionPickedRef = React.useRef(false);
  const addMenuFromRef = React.useRef<'mention' | 'plus'>('mention');
  const validMentionIds = React.useMemo(
    () => new Set(attachments.filter(Boolean).map((att) => att.characterId ?? att.id)),
    [attachments],
  );
  // Read while the picker renders its list, so not through mediaItemsRef (an effect behind).
  const mentionItemById = React.useCallback((id: string) => mediaItems.find((m) => m.id === id), [mediaItems]);
  // A character's own images are reached through the character, as on its pages.
  const mentionItems = React.useMemo(() => mediaItems.filter((m) => !m.characterId), [mediaItems]);
  const hoveredCharacter = hoveredAttachmentCharacterId ? characters.find((c) => c.id === hoveredAttachmentCharacterId) : undefined;
  const hoveredCharacterImages = hoveredCharacter
    ? [hoveredCharacter.portraitId, hoveredCharacter.bodyId]
      .map((id) => (id ? mediaItems.find((m) => m.id === id && m.status === 'completed' && !!m.url) : undefined))
      .filter((m): m is MediaItem => !!m)
    : [];
  const openMention = useEventCallback((field: HTMLElement) => {
    mentionPickedRef.current = false;
    addMenuFromRef.current = 'mention';
    setMentionAnchor((field.closest('.prompt-container-box') ?? field).getBoundingClientRect());
    setMentionOpen(true);
  });
  const openAddMenu = useEventCallback((trigger: HTMLElement) => {
    addMenuFromRef.current = 'plus';
    setMentionAnchor((trigger.closest('.prompt-container-box') ?? trigger).getBoundingClientRect());
    setMentionOpen(true);
  });
  const closeMention = useEventCallback(() => {
    setMentionOpen(false);
    if (addMenuFromRef.current === 'plus') promptEditorRef.current?.focus();
    else if (!mentionPickedRef.current) promptEditorRef.current?.cancelMention();
  });
  /** What a pick leaves in the text: the chip that names it when "@" asked, else nothing. */
  const landPick = (mention: PromptMention) => {
    if (addMenuFromRef.current === 'mention') promptEditorRef.current?.insertMention(mention);
    else promptEditorRef.current?.focus();
  };
  const mentionMedia = useEventCallback((item: MediaItem) => {
    mentionPickedRef.current = true;
    setMentionOpen(false);
    const title = item.shortenedPrompt || item.prompt || 'Untitled';
    if (item.url) {
      setAttachments((prev) => {
        if (prev.some((att) => att && att.url === item.url)) return prev;
        const next = [...prev, { id: item.id, url: item.url!, name: title, kind: item.kind }];
        return isFramesMode ? next.slice(0, 2) : next;
      });
    }
    landPick({ id: item.id, title, type: 'media' });
  });
  /** A character as an ingredient: its portrait shown, its portrait and body sent. */
  const attachCharacter = (character: Character) => {
    const portrait = character.portraitId ? mediaItemsRef.current.find((m) => m.id === character.portraitId) : undefined;
    setAttachments((prev) => (prev.some((att) => att?.characterId === character.id) ? prev : [
      ...prev,
      { id: character.id, url: portrait?.status === 'completed' ? portrait.url ?? '' : '', name: characterName(character), kind: 'image', characterId: character.id },
    ]));
  };
  const mentionCharacter = useEventCallback((character: Character) => {
    mentionPickedRef.current = true;
    setMentionOpen(false);
    if (!isFramesMode) attachCharacter(character);
    landPick({ id: character.id, title: characterName(character), type: 'entity' });
  });

  // ── Character tiles ──────────────────────────────────────────────────────
  // What a character's tile does, in the Characters tab and among All media's tiles alike.
  const favoriteCharacter = useEventCallback((c: Character) => updateCharacter(c.id, { favorite: !c.favorite }));
  const renameCharacter = useEventCallback((c: Character, name: string) => updateCharacter(c.id, { name: name.trim() === 'Untitled character' ? '' : name.trim() }));
  const removeCharacter = useEventCallback((c: Character) => {
    setMediaItems((prev) => prev.filter((m) => m.characterId !== c.id));
    deleteCharacter(c.id);
  });
  const copyCharacter = useEventCallback((c: Character) => {
    const copy = createCharacter({ name: c.name ? `${c.name} (copy)` : '', prompt: c.prompt, personality: c.personality, voice: c.voice });
    const cloneItem = (id: string | undefined) => {
      const src = id ? mediaItemsRef.current.find((m) => m.id === id) : undefined;
      if (!src?.url) return undefined;
      const dup: MediaItem = { ...src, id: `${Date.now()}-character-${Math.random().toString(36).slice(2, 8)}`, characterId: copy.id, historyGroupId: undefined, historyParentId: undefined, timestamp: Date.now(), isSavedToFS: false, fsName: undefined };
      setMediaItems((prev) => [dup, ...prev]);
      return dup.id;
    };
    updateCharacter(copy.id, { portraitId: cloneItem(c.portraitId), bodyId: cloneItem(c.bodyId) });
  });
  /** Add to prompt, as Flow's: the character as an ingredient. Frames take its portrait instead. */
  const addCharacterToPrompt = useEventCallback((c: Character) => {
    const portrait = c.portraitId ? mediaItemsRef.current.find((m) => m.id === c.portraitId) : undefined;
    if (isFramesMode) {
      if (portrait) onTileAddToPrompt(portrait);
      return;
    }
    attachCharacter(c);
    setTimeout(() => promptEditorRef.current?.focus(), 50);
  });

  /** What a generation is sent (character-references.ts). The prompt the item keeps is the user's own. */
  const characterImages = (characterId: string): MediaItem[] => {
    const character = getCharacter(characterId);
    return [character?.portraitId, character?.bodyId]
      .map((id) => (id ? mediaItemsRef.current.find((m) => m.id === id) : undefined))
      .filter((m): m is MediaItem => !!m?.url && m.status === 'completed');
  };
  const toGenerationInput = (prompt: string, refs: ImageAttachment[]) => expandCharacterReferences(prompt, refs, characterImages);

  /**
   * One of Frames mode's two slots, as Flow draws them: empty, a 56px chip labelled Start or End
   * that opens the add menu; filled, the frame as a 56px ingredient chip that a click removes.
   */
  const renderFrameSlot = (slot: 0 | 1) => {
    const att = attachments[slot];
    if (!att) {
      return (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setAssetMenuSource('main');
            setIsAssetMenuOpen(true);
          }}
          className="composer-frame-empty"
        >
          {slot === 0 ? 'Start' : 'End'}
        </button>
      );
    }
    // Omni Flash can't end on a frame: the end frame goes grey with a warning, as before.
    const unsupported = slot === 1 && (videoModel === 'omni-flash' || videoModel === 'omni-flash-1.1');
    return (
      <div
        onMouseEnter={(e) => {
          if (isModelMenuOpen || isAssetMenuOpen) return;
          handleAttachmentMouseEnter(e, att.url, slot === 1);
        }}
        onMouseLeave={handleAttachmentMouseLeave}
        className={`composer-ingredient relative group flex-shrink-0 transition-all duration-200 ${removingIds.has(att.id) ? 'opacity-0 scale-90' : 'opacity-100 scale-100 animate-in fade-in zoom-in-95'}`}
      >
        <div className={`relative w-[56px] h-[56px] rounded-[12px] overflow-hidden bg-[#1c1c1e] ${unsupported ? 'grayscale' : ''}`}>
          {att.kind === 'video' ? (
            <video src={att.url} className="w-full h-full object-cover" muted loop playsInline />
          ) : (
            <img src={att.url} alt={att.name} className="w-full h-full object-cover" />
          )}
          {unsupported && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-red-500">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-5 h-5">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" strokeLinecap="round" />
              </svg>
            </div>
          )}
        </div>
        <button
          onClick={() => removeAttachment(att.id)}
          aria-label="Remove frame"
          style={{ backgroundColor: 'rgba(22, 23, 24, 0.5)' }}
          className={`absolute inset-0 w-[56px] h-[56px] flex items-center justify-center rounded-[12px] text-white transition-opacity duration-200 z-[60] ${
            hoveredAttachmentUrl === att.url ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 hover:opacity-100'
          }`}
        >
          <FlowIcon name="cancel" size={16} />
        </button>
      </div>
    );
  };

  const resolveSceneMediaUrl = useEventCallback((mediaId: string) => mediaItemsRef.current.find((m) => m.id === mediaId)?.url);

  const importSceneFiles = async (files: File[]): Promise<MediaItem[]> => {
    const added: MediaItem[] = [];
    for (const file of files) {
      const kind: MediaKind | null = file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'image' : null;
      if (!kind) continue;
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const ratio = await new Promise<string>((resolve) => {
        const objectUrl = URL.createObjectURL(file);
        const done = (w: number, h: number) => { URL.revokeObjectURL(objectUrl); resolve(w && h ? `${w}:${h}` : '16:9'); };
        if (kind === 'image') {
          const img = new Image();
          img.onload = () => done(img.naturalWidth, img.naturalHeight);
          img.onerror = () => done(0, 0);
          img.src = objectUrl;
        } else {
          const vid = document.createElement('video');
          vid.onloadedmetadata = () => done(vid.videoWidth, vid.videoHeight);
          vid.onerror = () => done(0, 0);
          vid.src = objectUrl;
        }
      });
      let fsName: string | undefined;
      if (isLocalFolderConnected && isLocalFolderAuthorized) {
        fsName = (await saveLocalFSMedia(projectName || 'Default', kind, file.name, file).catch(() => null)) || undefined;
      }
      added.push({
        id: `pasted-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        kind,
        status: 'completed',
        url,
        prompt: kind === 'video' ? 'Uploaded Video' : 'Uploaded Image',
        modelId: 'upload',
        modelName: 'Upload',
        ratio,
        timestamp: Date.now(),
        isSavedToFS: !!fsName,
        fsName,
      });
    }
    if (added.length) setMediaItems((prev) => [...added, ...prev]);
    return added;
  };

  const activeSceneId = searchParams.get('scene');
  const sceneHost: SceneHost = {
    projectName: projectName || 'Untitled project',
    projectId: persistProjectId || undefined,
    listProjects: () => (readProjectRegistry() as any[])
      .filter((p) => p?.kind === 'media' && p.id && p.name)
      .map((p) => ({ id: String(p.id), name: String(p.name) })),
    loadProjectMedia: async (id) => (await loadProjectMedia(id, chatScopeId)) as MediaItem[],
    mediaItems,
    close: closeSceneEditor,
    openMedia: (item) => {
      closeSceneEditor();
      setSelectedItem(latestVersions.get(item.historyGroupId || item.id) ?? item);
    },
    addMediaItem: (item) => setMediaItems((prev) => [item, ...prev]),
    updateMediaItem: (id, patch) => setMediaItems((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m))),
    removeMediaItem: (id) => setMediaItems((prev) => prev.filter((m) => m.id !== id)),
    importFiles: importSceneFiles,
    geminiKey: () => apiKeys?.gemini?.[0],
    // Flow's Scenebuilder edits on Omni 1.1 Flash whatever the gallery's picker is set to, so this
    // does not depend on which video models the user has enabled for generation.
    omniApiModelId: DEFAULT_VIDEO_MODELS.find((m) => m.id === 'omni-flash-1.1')?.apiId ?? 'gemini-omni-1.1-flash',
    omniModelName: 'Gemini Omni Flash 1.1',
    saveGenerated: (item, url) => {
      if (isLocalFolderConnected) void saveGeneratedMedia(item, url);
    },
  };

  // The Tools pages: this project's gallery for Flow.media and Flow.save, the agent's generation
  // start for Flow.generate, and this rail drawn under their own header.
  const toolsHost: ToolsHost | null = toolsRoute ? {
    scopeId: chatScopeId || 'guest',
    projectId: persistProjectId || undefined,
    projectName: projectName || 'Untitled project',
    search: tabSearch,
    navigate: (to, options) => navigate(to, options),
    get mediaItems() {
      return mediaItemsRef.current;
    },
    listProjects: sceneHost.listProjects,
    loadProjectMedia: sceneHost.loadProjectMedia,
    adoptMedia: (item) => {
      const copy: MediaItem = {
        ...item,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now(),
        historyGroupId: undefined,
        historyParentId: undefined,
        isSavedToFS: false,
        fsName: undefined,
        audioFsName: undefined,
      };
      setMediaItems((prev) => [copy, ...prev]);
      if (copy.url && isLocalFolderConnected) void saveGeneratedMedia(copy, copy.url);
      return copy;
    },
    importFiles: importSceneFiles,
    imageModels: imageModels.map((m) => ({ id: m.id, name: m.name })),
    videoModels: videoModels.map((m) => ({ id: m.id, name: m.name })),
    defaultImageModel: imageModel,
    defaultVideoModel: videoModel,
    startImages: (spec) => startAgentImages(spec),
    startVideos: (spec) => startAgentVideos(spec),
    geminiKeys: apiKeys?.gemini ?? [],
    modelConfig: savedModelConfig,
    apiKeys,
    openSettings: () => onOpenSettings?.('models'),
    renderSidebar: () => (
      <MediaSidebar
        collapsed={isSidebarCollapsed}
        onToggleCollapsed={handleToggleLeftSidebar}
        activeTab=""
        toolsActive={toolsRoute.page === 'manager'}
        onNavigate={navigateSidebarTab}
        toolsHref={toolsHref}
        toolHref={dockToolHref}
        topInset={0}
        dock={toolDock}
        dockOpen={toolDockOpen}
        onToggleDock={() => setDockOpen(!toolDockOpen)}
        activeToolId={toolsRoute.page === 'view' ? toolsRoute.toolId : null}
        onOpenTool={openDockTool}
        onTogglePin={(id) => { togglePin(id); }}
        presentation={railPresentation}
        drawerOpen={isNavDrawerOpen}
        onDrawerOpenChange={setIsNavDrawerOpen}
        onHome={() => navigate('/?mode=media')}
      />
    ),
    openNav: () => setIsNavDrawerOpen(true),
  } : null;

  // Guards the await below: a second Enter must not start a second turn before the first exists.
  const agentSendingRef = React.useRef(false);
  const sendToAgent = async (text: string, options: { fromComposer?: boolean } = {}) => {
    const fromComposer = options.fromComposer !== false;
    if (agentSendingRef.current || mediaAgent.$turn.get().running) return;
    const activeAttachments = fromComposer ? attachments.filter(Boolean) : [];
    if (!text.trim() && activeAttachments.length === 0) return;
    agentSendingRef.current = true;
    try {
      setIsAgentSidebarOpen(true);
      if (fromComposer) {
        promptStore.set('');
        const attachmentIds = activeAttachments.map((att) => att.id);
        if (attachmentIds.length > 0) {
          setRemovingIds((prev) => {
            const next = new Set(prev);
            attachmentIds.forEach((id) => next.add(id));
            return next;
          });
          setTimeout(() => {
            setAttachments([]);
            setRemovingIds((prev) => {
              const next = new Set(prev);
              attachmentIds.forEach((id) => next.delete(id));
              return next;
            });
          }, 200);
        }
      }
      // A mentioned character goes by ID: the agent hands it to the generators as character_ids,
      // which bring its images along.
      mediaAgent.send({ text, attachments: await toAgentAttachments(activeAttachments) });
    } finally {
      agentSendingRef.current = false;
    }
  };

  const handleGenerate = async () => {
    const activePrompt = promptStore.get().trim();
    if (!activePrompt) return;

    if (isLocalFolderConnected && !isLocalFolderAuthorized) {
      await authorizeLocalFolder();
    }

    if (isAgentActive) {
      void sendToAgent(activePrompt);
      return;
    }

    setGenerationError(null);

    // Both checks run before the prompt is cleared, so it is still there to send once fixed.
    const activeModelId = modelMode === 'image' ? imageModel : videoModel;
    if (!activeModelId) {
      setGenerationError({
        message: modelMode === 'image'
          ? "You haven't added an image model yet. Add one to generate images."
          : "You haven't added a video model yet. Add one to generate videos.",
        settings: true,
        missingModel: modelMode,
      });
      return;
    }

    const getApiKeyForModel = (modelIdStr: string) => {
      const isGPT = modelIdStr === 'gpt-image-2';
      const isGrok = modelIdStr === 'grok-imagine';
      const provider = isGrok ? 'spacexai' : isGPT ? 'openai' : 'gemini';
      return apiKeys?.[provider]?.[0] || '';
    };

    const apiKey = getApiKeyForModel(activeModelId);
    if (!apiKey) {
      const isGPT = activeModelId === 'gpt-image-2';
      const isGrok = activeModelId === 'grok-imagine';
      const providerName = isGrok ? 'Grok' : isGPT ? 'OpenAI' : 'Google Gemini';
      setGenerationError({ message: `${providerName} API key is missing. Add it in Settings → Models & API.`, settings: true });
      return;
    }

    const activeAttachments = attachments.filter(Boolean);
    const attachmentIds = activeAttachments.map(att => att.id);
    if (attachmentIds.length > 0) {
      setRemovingIds(prev => {
        const next = new Set(prev);
        attachmentIds.forEach(id => next.add(id));
        return next;
      });
    }

    promptStore.set('');

    if (attachmentIds.length > 0) {
      setTimeout(() => {
        setAttachments([]);
        setRemovingIds(prev => {
          const next = new Set(prev);
          attachmentIds.forEach(id => next.delete(id));
          return next;
        });
      }, 200);
    } else {
      setAttachments([]);
    }

    const batchStr = modelMode === 'image' ? imageBatch : videoBatch;
    const batchCount = Math.max(1, parseInt(batchStr.replace('x', ''), 10) || 1);
    const activeRatio = modelMode === 'image' ? imageRatio : videoRatio;
    const activeModelName =
      modelMode === 'image' ? getImageModelName(imageModel) : getVideoModelName(videoModel);

    const batchTimestamps = allocateMediaBatchTimestamps(batchCount);
    const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newItems: MediaItem[] = Array.from({ length: batchCount }, (_, i) => ({
      id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`,
      kind: modelMode,
      status: 'generating',
      prompt: activePrompt,
      modelId: activeModelId,
      modelName: activeModelName,
      ratio: activeRatio,
      timestamp: batchTimestamps[i],
      batchId,
      collectionId: openCollectionRef.current,
      attachments: activeAttachments,
      ...(modelMode === 'image' ? {
        effort: imageEffort,
        quality: imageQuality,
        resolution: imageResolution,
      } : {})
    }));

    setIsLayoutSuppressing(true);
    setMediaItems(prev => [...newItems, ...prev]);
    setTimeout(() => {
      setIsLayoutSuppressing(false);
    }, 150);

    const itemIds = newItems.map(item => item.id);
    void rephrasePromptForItems(itemIds, activePrompt, apiKey);

    const input = toGenerationInput(activePrompt, activeAttachments);
    newItems.forEach(item => {
      if (item.kind === 'image') {
        void generateSingleImage(item, input.prompt, item.modelId, item.ratio, apiKey, input.attachments);
      } else {
        void generateSingleVideo(item, input.prompt, item.modelId as VideoModelId, item.ratio, videoDuration, apiKey, input.attachments);
      }
    });
  };

  const handleRefreshItem = async (targetItem: MediaItem) => {
    const isGPT = targetItem.modelId === 'gpt-image-2';
    const isGrok = targetItem.modelId === 'grok-imagine';
    const provider = isGrok ? 'spacexai' : isGPT ? 'openai' : 'gemini';
    const apiKey = apiKeys?.[provider]?.[0];
    if (!apiKey) return;

    if (isLocalFolderConnected && !isLocalFolderAuthorized) {
      await authorizeLocalFolder();
    }
    
    const newItem: MediaItem = {
      id: `${Date.now()}-0-${Math.random().toString(36).slice(2, 8)}`,
      kind: targetItem.kind,
      status: 'generating',
      prompt: targetItem.prompt,
      modelId: targetItem.modelId,
      modelName: targetItem.modelName,
      ratio: targetItem.ratio,
      timestamp: Date.now(),
      batchId: `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      collectionId: targetItem.collectionId,
      attachments: targetItem.attachments,
      effort: targetItem.effort,
      quality: targetItem.quality,
      resolution: targetItem.resolution,
    };
    
    setIsLayoutSuppressing(true);
    setMediaItems(prev => [newItem, ...prev]);
    setTimeout(() => {
      setIsLayoutSuppressing(false);
    }, 150);
    
    void rephrasePromptForItems([newItem.id], newItem.prompt, apiKey);

    const input = toGenerationInput(newItem.prompt, newItem.attachments || []);
    if (targetItem.kind === 'image') {
      void generateSingleImage(newItem, input.prompt, newItem.modelId, newItem.ratio, apiKey, input.attachments);
    } else {
      void generateSingleVideo(newItem, input.prompt, newItem.modelId as VideoModelId, newItem.ratio, videoDuration, apiKey, input.attachments);
    }
  };

  const handleRePromptItem = (targetItem: MediaItem) => {
    if (targetItem.kind === 'audio') {
      setIsCreatingMusic(true);
      setMusicModel(targetItem.modelId);
      return;
    }
    // 1. Restore the mode (Image vs. Video)
    setModelMode(targetItem.kind);

    // 2. Restore the specific model and aspect ratio used
    if (targetItem.kind === 'image') {
      setImageModel(targetItem.modelId as ImageModelId);
      setImageRatio(targetItem.ratio);
      if (targetItem.effort) {
        setImageEffort(targetItem.effort as any);
      }
      if (targetItem.quality) {
        setImageQuality(targetItem.quality);
      }
      if (targetItem.resolution) {
        setImageResolution(targetItem.resolution);
      }
    } else {
      setVideoModel(targetItem.modelId as VideoModelId);
      setVideoRatio(targetItem.ratio);
    }

    // 3. Restore the text prompt and attachments
    promptStore.set(targetItem.prompt);
    setAttachments(targetItem.attachments || []);

    // 4. Focus the prompt input area
    promptEditorRef.current?.focus();
  };

  const completedItems = React.useMemo(() => {
    return mediaItems.filter((m) => m.status === 'completed' && m.url);
  }, [mediaItems]);

  const viewerHistoryItems = React.useMemo(() => {
    if (!selectedItem) return [];
    const groupId = selectedItem.historyGroupId || selectedItem.id;
    const items = mediaItems.filter((item) =>
      (item.id === groupId || item.historyGroupId === groupId) &&
      (item.status === 'completed' || item.id === pendingViewerItemIdRef.current),
    );
    // Old records have no lineage and therefore naturally produce a one-card
    // history. New edits are ordered oldest -> newest, like Flow's bottom-anchored
    // rail. The active generating child is included immediately so the edit is
    // visible in the open viewer instead of appearing only as a new gallery tile.
    return items.sort((a, b) => a.timestamp - b.timestamp);
  }, [mediaItems, selectedItem]);

  React.useLayoutEffect(() => {
    const next = new Set<string>();
    for (const item of viewerHistoryItems) {
      const prompt = document.querySelector<HTMLElement>(`[data-flow-history-prompt-id="${CSS.escape(item.id)}"]`);
      if (!prompt) continue;

      // Chromium's scrollHeight for a -webkit-line-clamp element can equal its
      // clamped clientHeight, even when the underlying text has more lines.
      // Measure the same node once without the clamp so the Flow expand button
      // is mounted whenever the prompt really has hidden content.
      const wasExpanded = expandedHistoryPrompts.has(item.id);
      const originalStyle = prompt.getAttribute('style');
      const visibleHeight = prompt.getBoundingClientRect().height;
      let fullHeight = prompt.scrollHeight;
      if (!wasExpanded) {
        prompt.style.display = 'block';
        prompt.style.webkitLineClamp = 'unset';
        prompt.style.webkitBoxOrient = 'initial';
        prompt.style.overflowY = 'visible';
        fullHeight = prompt.scrollHeight;
        if (originalStyle === null) prompt.removeAttribute('style');
        else prompt.setAttribute('style', originalStyle);
      }

      if (wasExpanded || fullHeight > visibleHeight + 1) {
        next.add(item.id);
      }
    }
    setExpandableHistoryPrompts((previous) => {
      if (previous.size === next.size && [...next].every((id) => previous.has(id))) return previous;
      return next;
    });
  }, [expandedHistoryPrompts, viewerHistoryItems]);

  const selectedIdx = React.useMemo(() => {
    if (!selectedItem) return -1;
    return completedItems.findIndex((m) => m.id === selectedItem.id);
  }, [selectedItem, completedItems]);

  const K_THUMBS = 7;
  const carouselWindow = React.useMemo(() => {
    const N = completedItems.length;
    if (N === 0 || selectedIdx === -1) return { items: [] };

    // Construct exactly 15 items cycled around selectedIdx (-7 to +7 offset) for sliding animation
    const items = [];
    for (let d = -7; d <= 7; d++) {
      const idx = ((selectedIdx + d) % N + N) % N;
      items.push(completedItems[idx]);
    }
    return {
      items
    };
  }, [completedItems, selectedIdx]);

  const handleNextThumb = React.useCallback(() => {
    if (isAnimating) return;
    if (selectedIdx !== -1 && completedItems.length > 0) {
      const N = completedItems.length;
      const nextItem = completedItems[(selectedIdx + 1) % N];
      targetItemRef.current = nextItem;
      setXTranslate(-176 - 44);
      setIsAnimating(true);
    }
  }, [selectedIdx, completedItems, isAnimating]);

  const handlePrevThumb = React.useCallback(() => {
    if (isAnimating) return;
    if (selectedIdx !== -1 && completedItems.length > 0) {
      const N = completedItems.length;
      const prevItem = completedItems[(selectedIdx - 1 + N) % N];
      targetItemRef.current = prevItem;
      setXTranslate(-176 + 44);
      setIsAnimating(true);
    }
  }, [selectedIdx, completedItems, isAnimating]);

  const handleThumbClick = React.useCallback((thumbItem: MediaItem, idx: number) => {
    if (isAnimating) return;
    const offset = idx - 7;
    if (offset === 0) return; // Already selected

    targetItemRef.current = thumbItem;
    setXTranslate(-176 - offset * 44);
    setIsAnimating(true);
  }, [isAnimating]);

  const handleTransitionEnd = React.useCallback(() => {
    if (isAnimating && targetItemRef.current) {
      setSelectedItem(targetItemRef.current);
      setIsAnimating(false);
      setXTranslate(-176);
      targetItemRef.current = null;
    }
  }, [isAnimating]);

  React.useEffect(() => {
    setViewerModelId(selectedItem ? selectedItem.modelId : '');
    setIsViewerModelDropdownOpen(false);
    setViewerAttachments([]);
    setViewerRemovingIds(new Set());
    setIsViewerAssetMenuOpen(false);
  }, [selectedItem]);

  const handleViewerFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const newAttachments: ImageAttachment[] = Array.from(e.target.files)
      .filter(file => file.type.startsWith('image/'))
      .map(file => ({
        id: Math.random().toString(36).substring(7),
        url: URL.createObjectURL(file),
        name: file.name,
        file
      }));
    setViewerAttachments(prev => [...prev, ...newAttachments]);
    if (viewerFileInputRef.current) viewerFileInputRef.current.value = '';
  };

  const removeViewerAttachment = (id: string) => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    setHoveredAttachmentUrl(null);
    setHoveredAttachmentRect(null);

    setViewerRemovingIds(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setTimeout(() => {
      setViewerAttachments(prev => prev.filter(att => att.id !== id));
      setViewerRemovingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 200);
  };

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (viewerModelDropdownRef.current && !viewerModelDropdownRef.current.contains(event.target as Node)) {
        setIsViewerModelDropdownOpen(false);
      }
    };
    if (isViewerModelDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isViewerModelDropdownOpen]);

  const getAnnotatedImageBase64 = async (): Promise<{ data: string; mimeType: string } | null> => {
    if (!selectedItem || !selectedItem.url) return null;

    // Load the base image
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = selectedItem.url;

    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Draw base image
    ctx.drawImage(img, 0, 0);

    const scaleX = canvas.width / 100;
    const scaleY = canvas.height / 100;

    // Draw annotations on top of the image
    annotations.forEach((ann) => {
      if (ann.type === 'draw' && ann.points && ann.points.length > 0) {
        ctx.beginPath();
        ctx.lineWidth = Math.max(1, ann.size * (canvas.width / 1000));
        ctx.strokeStyle = ann.color;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        ctx.moveTo(ann.points[0].x * scaleX, ann.points[0].y * scaleY);
        for (let i = 1; i < ann.points.length; i++) {
          ctx.lineTo(ann.points[i].x * scaleX, ann.points[i].y * scaleY);
        }
        ctx.stroke();
      } else if (ann.type === 'rect' && ann.x !== undefined && ann.y !== undefined && ann.width !== undefined && ann.height !== undefined) {
        ctx.beginPath();
        ctx.lineWidth = Math.max(1, ann.size * (canvas.width / 1000));
        ctx.strokeStyle = ann.color;
        ctx.strokeRect(ann.x * scaleX, ann.y * scaleY, ann.width * scaleX, ann.height * scaleY);
      } else if (ann.type === 'text' && ann.x !== undefined && ann.y !== undefined && ann.text) {
        ctx.fillStyle = ann.color;
        const fontSize = Math.max(12, ann.size * 2.5 + 8) * (canvas.width / 800);
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.fillText(ann.text, ann.x * scaleX, ann.y * scaleY);
      } else if (ann.type === 'select-box' && ann.x !== undefined && ann.y !== undefined && ann.width !== undefined && ann.height !== undefined) {
        ctx.save();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(2, canvas.width / 400);
        ctx.setLineDash([Math.max(4, canvas.width / 150), Math.max(4, canvas.width / 150)]);
        ctx.strokeRect(ann.x * scaleX, ann.y * scaleY, ann.width * scaleX, ann.height * scaleY);
        ctx.restore();
      } else if (ann.type === 'select-lasso' && ann.points && ann.points.length > 0) {
        ctx.save();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(2, canvas.width / 400);
        ctx.setLineDash([Math.max(4, canvas.width / 150), Math.max(4, canvas.width / 150)]);
        ctx.beginPath();
        ctx.moveTo(ann.points[0].x * scaleX, ann.points[0].y * scaleY);
        for (let i = 1; i < ann.points.length; i++) {
          ctx.lineTo(ann.points[i].x * scaleX, ann.points[i].y * scaleY);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }
    });

    const dataUrl = canvas.toDataURL('image/jpeg', 1.0);
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      return {
        mimeType: match[1],
        data: match[2],
      };
    }

    return null;
  };

  // The viewer edits with the item's own model while it is still added, else the prompt box's
  // pick for that kind, else nothing, in which case it asks for a model like the prompt box.
  const viewerKind: 'image' | 'video' = selectedItem?.kind === 'video' ? 'video' : 'image';
  const viewerModels = viewerKind === 'video' ? videoModels : imageModels;
  const viewerModel = viewerModels.some((m) => m.id === liveModelId(viewerModelId))
    ? liveModelId(viewerModelId)
    : viewerKind === 'video' ? videoModel : imageModel;
  const viewerModelLabel = viewerModels.find((m) => m.id === viewerModel)?.name
    ?? (viewerKind === 'video' ? 'No video model' : 'No image model');

  const handleViewerGenerate = async () => {
    if (!editPrompt.trim() || !selectedItem || isAnimating) return;

    const newModelId = viewerModel;
    const newModelName = viewerModelLabel;
    if (!newModelId) {
      setGenerationError({
        message: viewerKind === 'image'
          ? "You haven't added an image model yet. Add one to edit images."
          : "You haven't added a video model yet. Add one to edit videos.",
        settings: true,
        missingModel: viewerKind,
      });
      return;
    }
    const isGPT = newModelId === 'gpt-image-2';
    const isGrok = newModelId === 'grok-imagine';
    const provider = isGrok ? 'spacexai' : isGPT ? 'openai' : 'gemini';
    const apiKey = apiKeys?.[provider]?.[0];
    if (!apiKey) {
      const providerName = isGrok ? 'Grok' : isGPT ? 'OpenAI' : 'Google Gemini';
      setGenerationError({ message: `${providerName} API key is missing. Add it in Settings → Models & API.`, settings: true });
      return;
    }

    const systemPrompt = buildAnnotationSystemPrompt(annotations);
    const fullPrompt = `[Context: ${systemPrompt}] ${editPrompt}`;

    const isImage = selectedItem.kind === 'image';

    const selectedInlinePart = await getAnnotatedImageBase64();
    const attachments: ImageAttachment[] = [];
    if (selectedInlinePart) {
      attachments.push({
        id: 'selected-base-img',
        name: 'base_image.png',
        url: `data:${selectedInlinePart.mimeType};base64,${selectedInlinePart.data}`
      });
    }

    const activeViewerAttachments = viewerAttachments.filter(att => !viewerRemovingIds.has(att.id));
    attachments.push(...activeViewerAttachments);

    // Flow treats edits as a single detail-view history, not as unrelated
    // gallery results. Promote the original item to a group on first edit and
    // carry that same group through every subsequent edit.
    const historyGroupId = selectedItem.historyGroupId || selectedItem.id;
    if (!selectedItem.historyGroupId) {
      setMediaItems(prev => prev.map(item => item.id === selectedItem.id
        ? { ...item, historyGroupId }
        : item));
    }

    const newItem: MediaItem = {
      id: `${Date.now()}-viewer-${Math.random().toString(36).slice(2, 8)}`,
      kind: selectedItem.kind,
      status: 'generating',
      prompt: editPrompt,
      modelId: newModelId,
      modelName: newModelName,
      ratio: selectedItem.ratio,
      timestamp: Date.now(),
      attachments: attachments.length > 0 ? attachments : undefined,
      historyGroupId,
      historyParentId: selectedItem.id,
      collectionId: selectedItem.collectionId,
      effort: imageEffort,
      quality: imageQuality,
      resolution: imageResolution,
    };

    setIsLayoutSuppressing(true);
    setMediaItems(prev => [newItem, ...prev]);
    // Keep the current image visible while the new history card generates;
    // switch to the new card only once its URL arrives.
    pendingViewerItemIdRef.current = newItem.id;
    setTimeout(() => {
      setIsLayoutSuppressing(false);
    }, 150);

    void rephrasePromptForItems([newItem.id], fullPrompt, apiKey);

    if (isImage) {
      void generateSingleImage(newItem, fullPrompt, newModelId, selectedItem.ratio, apiKey, attachments);
    } else {
      void generateSingleVideo(newItem, fullPrompt, newModelId as VideoModelId, selectedItem.ratio, videoDuration, apiKey, attachments);
    }

    setEditPrompt('');
    setViewerAttachments([]);
    setViewerRemovingIds(new Set());
  };

  // Stable tile handlers: their identity never changes across renders
  // (useEventCallback), so the memoized GalleryTile props stay shallow-equal and
  // a hover, prompt keystroke or agent streaming token no longer re-renders
  // every tile in the gallery — only tiles whose own flags changed.
  const onTileMouseDown = useEventCallback((item: MediaItem, e: React.MouseEvent) => {
    if (e.button !== 0 || renamingItemId || activeMenuId !== null) return;
    setHoveredTileId(null);
    setActiveMenuId(null);
    customDragStartRef.current = {
      itemId: item.id,
      startX: e.clientX,
      startY: e.clientY
    };
  });
  const onTileClick = useEventCallback((item: MediaItem) => {
    if (wasDraggingRef.current) return;
    if (renamingItemId === item.id) return;
    if (item.status === 'completed' && item.url) {
      if (item.kind === 'audio') {
        setActiveMusicItem(item);
      } else {
        const live = mediaItemsRef.current.find((m) => m.id === item.id) ?? item;
        setSelectedItem(latestVersions.get(live.historyGroupId || live.id) ?? live);
      }
    }
  });
  const onTileMouseEnter = useEventCallback((item: MediaItem) => {
    if (isModelMenuOpen || isAssetMenuOpen || (activeMenuId !== null && activeMenuId.endsWith('-context'))) return;
    setHoveredTileId(item.id);
  });
  const onTileMouseLeave = useEventCallback((item: MediaItem) => {
    if (hoveredTileId === item.id) setHoveredTileId(null);
    if (activeMenuId === item.id) setActiveMenuId(null);
  });
  const onTileMenuOpenChange = useEventCallback((itemId: string, open: boolean, isContext?: boolean) => {
    if (open && isContext) {
      setHoveredTileId(null);
      setCanvasContextMenuCoords(null);
    }
    setActiveMenuId(open ? (isContext ? `${itemId}-context` : itemId) : null);
  });
  const onTileCancel = useEventCallback((id: string) => {
    setMediaItems(prev => prev.filter(m => m.id !== id));
  });
  const onTileRefresh = useEventCallback(handleRefreshItem);
  const onTileRePrompt = useEventCallback(handleRePromptItem);
  const onTileSetAsCover = useEventCallback(handleSetAsCover);
  const onTileDelete = useEventCallback((id: string, fileGoesWithFolder = false) => {
    const item = mediaItemsRef.current.find(m => m.id === id);
    // If this item was shown via a disk blob: URL, revoke it.
    if (item?.url && item.url.startsWith('blob:')) {
      try { URL.revokeObjectURL(item.url); } catch {}
      mediaBlobUrlsRef.current = mediaBlobUrlsRef.current.filter(u => u !== item.url);
    }
    if (item?.audioFsName && item.audioUrl?.startsWith('blob:')) {
      try { URL.revokeObjectURL(item.audioUrl); } catch {}
      mediaBlobUrlsRef.current = mediaBlobUrlsRef.current.filter(u => u !== item.audioUrl);
    }
    setMediaItems(prev => {
      const next = prev.filter(m => m.id !== id);
      // Persist removal to IndexedDB (unified on the real project id).
      if (persistProjectId) void saveProjectMedia(persistProjectId, next, chatScopeId);
      return next;
    });
    setAttachments(prev => prev.filter(a => a.id !== id));
    // Remove the actual file from disk (disk = source of truth)
    // so it doesn't reappear on the next reconcile. A file whose collection's whole folder is
    // being deleted goes with it: deleting it separately races the recursive removal, which
    // then fails and leaves the folder to be adopted back as a collection.
    if (!fileGoesWithFolder && item?.fsName && item.kind) {
      void deleteLocalFSMediaFile(projectName, item.kind, item.fsName, collectionFolder(item.collectionId));
      // A song's audio would otherwise come back as a song of its own.
      const audio = ownSongAudio(item, mediaItemsRef.current);
      if (audio) void deleteLocalFSMediaFile(projectName, 'audio', audio, collectionFolder(item.collectionId));
    }
  });
  const onTileRename = useEventCallback((id: string, newName: string) => {
    const baseName = newName.trim();
    const items = mediaItemsRef.current;
    const target = items.find(m => m.id === id);
    if (!target) return;

    // Unique display name among the other tiles.
    let uniqueName = baseName;
    let counter = 1;
    while (items.some(m => m.id !== id && (m.shortenedPrompt || m.prompt || '').toLowerCase() === uniqueName.toLowerCase())) {
      uniqueName = `${baseName} (${counter})`;
      counter++;
    }

    // Optimistic display rename + IMMEDIATE IndexedDB persistence. The old
    // debounce-only path had a revert race: a focus/disk-change reconcile
    // landing inside the 600ms window read the STALE stored name back over
    // the state (and the re-armed debounce then persisted the reverted list).
    setMediaItems(prev => {
      const next = prev.map(m => m.id === id ? { ...m, shortenedPrompt: uniqueName } : m);
      if (persistProjectId) void saveProjectMedia(persistProjectId, next, chatScopeId);
      return next;
    });

    // Realtime disk rename: keep the on-disk file in lock-step with the tile's
    // display name (so the folder and future downloads agree). fsName and the
    // IndexedDB record are updated the moment the move completes — the disk
    // watcher reconciles from IndexedDB, and a stale fsName there would make
    // it treat the renamed file as foreign and drop this item's metadata.
    const targetKind = target.kind;
    const targetFsName = target.fsName;
    if (baseName && target.isSavedToFS && targetFsName && targetKind && isLocalFolderConnected) {
      void (async () => {
        const folder = collectionFolder(target.collectionId);
        const finalFsName = await renameLocalFSMediaFile(projectNameRef.current, targetKind, targetFsName, uniqueName, folder);
        if (!finalFsName || finalFsName === targetFsName) return; // no folder/file → metadata-only rename
        // A song's audio keeps its cover's name, by which a browser that starts over pairs them.
        const audio = ownSongAudio(target, items);
        const audioFsName = audio
          ? (await renameLocalFSMediaFile(projectNameRef.current, 'audio', audio, songAudioBaseName(finalFsName), folder)) || undefined
          : undefined;
        setMediaItems(prev => {
          const next = prev.map(m => m.id === id ? { ...m, shortenedPrompt: uniqueName, fsName: finalFsName, ...(audioFsName ? { audioFsName } : {}) } : m);
          if (persistProjectId) void saveProjectMedia(persistProjectId, next, chatScopeId);
          return next;
        });
      })();
    }
  });
  const onTileSetRenaming = useEventCallback((itemId: string, renaming: boolean) => {
    setRenamingItemId(renaming ? itemId : null);
  });
  // Persisted straight away rather than on the debounce, for the same reason as the rename above:
  // a reconcile landing inside the window would read the stored flag back over the state.
  const onTileToggleFavorite = useEventCallback((id: string) => {
    setMediaItems(prev => {
      const next = prev.map(m => m.id === id ? { ...m, favorite: !m.favorite } : m);
      if (persistProjectId) void saveProjectMedia(persistProjectId, next, chatScopeId);
      return next;
    });
  });
  const onTileAddToPrompt = useEventCallback((targetItem: MediaItem) => {
    if (targetItem.url) {
      setAttachments(prev => {
        if (prev.some(att => att && att.url === targetItem.url)) return prev;
        return [...prev, {
          id: targetItem.id,
          url: targetItem.url,
          name: targetItem.shortenedPrompt || targetItem.prompt || 'Attached Media',
          kind: targetItem.kind
        }];
      });
      setTimeout(() => {
        promptEditorRef.current?.focus();
      }, 50);
    }
  });
  /** A tile's Share and Flag output open the editors' dialogs. */
  const [shareItem, setShareItem] = React.useState<MediaItem | null>(null);
  const [flagOpen, setFlagOpen] = React.useState(false);
  const onTileShare = useEventCallback((item: MediaItem) => setShareItem(item));
  const onTileFlag = useEventCallback(() => setFlagOpen(true));
  // Flow's editors, which a gallery item opens into (its /edit/<id>): an image in the image editor,
  // a video in the Scenebuilder on a scene of its own. Both ride on the scene host and close back
  // to the gallery.
  // The rails open an item the way its tile does: on its newest finished version. The editor in
  // front stays until that item can be drawn at once (`readyToDraw`), so a switch never shows an
  // empty page or a black canvas. The last pick wins; one it overtook gives up its prepared scene.
  const editorSwitchRef = React.useRef<string | null>(null);
  const openFromEditor = useEventCallback((picked: MediaItem) => {
    const next = latestVersions.get(picked.historyGroupId || picked.id) ?? picked;
    editorSwitchRef.current = next.id;
    void readyToDraw(next).then(() => {
      if (editorSwitchRef.current !== next.id) {
        if (next.kind === 'video' && selectedItemRef.current?.id !== next.id) dropVideoScene(next.id);
        return;
      }
      editorSwitchRef.current = null;
      setSelectedItem(next);
    });
  });
  const editorHost: SceneHost = {
    ...sceneHost,
    close: () => { editorSwitchRef.current = null; setSelectedItem(null); },
    openMedia: openFromEditor,
  };
  /** An editor's Move to trash takes the asset with every version of it. */
  const trashFromEditor = (item: MediaItem) => {
    setSelectedItem(null);
    const root = item.historyGroupId || item.id;
    for (const m of mediaItemsRef.current) if (m.id === root || m.historyGroupId === root) onTileDelete(m.id);
  };

  // ── Collection actions ───────────────────────────────────────────────────
  // Every collection is a folder under the project folder on disk, kept in step here: creating
  // one makes its folder, renaming renames it, moving an item moves its file (with every version
  // of it, so the history stays together) and trashing takes the folder with its contents.
  const diskReady = isLocalFolderConnected && isLocalFolderAuthorized && !!projectName && !!projectId && !projectId.startsWith('temp_');
  React.useEffect(() => {
    void bindCollectionProject(persistProjectId, chatScopeId);
  }, [persistProjectId, chatScopeId]);
  // A collection made before the folder was connected (or in a project not yet on disk) gets its
  // folder as soon as there is somewhere to put it.
  React.useEffect(() => {
    if (!diskReady) return;
    for (const c of collections) if (!c.onDisk) void ensureLocalFSCollectionFolder(projectName, collectionFolder(c.id) as string);
  }, [collections, diskReady, projectName, ensureLocalFSCollectionFolder]);

  const collectionOpenedHereRef = React.useRef(false);
  React.useEffect(() => {
    if (!openCollectionId) collectionOpenedHereRef.current = false;
  }, [openCollectionId]);
  const openCollectionView = useEventCallback((collection: Collection) => {
    const next = new URLSearchParams(tabSearch);
    next.set('collection', collection.id);
    collectionOpenedHereRef.current = true;
    navigate({ pathname: '/media', search: `?${next.toString()}` });
  });
  /** The header's back arrow: back to where the collection was opened from. */
  const closeCollectionView = useEventCallback(() => {
    if (collectionOpenedHereRef.current) {
      collectionOpenedHereRef.current = false;
      navigate(-1);
      return;
    }
    navigate({ pathname: '/media', search: tabSearch }, { replace: true });
  });
  // A collection link whose collection is gone (trashed, or deleted on disk) falls back to the grid.
  const collectionsLoaded = useStore($collectionsLoaded);
  React.useEffect(() => {
    if (openCollectionId && collectionsLoaded && !getCollection(openCollectionId)) {
      navigate({ pathname: '/media', search: tabSearch }, { replace: true });
    }
  }, [openCollectionId, collectionsLoaded, collections, tabSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  // What each file was made with, beside the files (media-details-sync.ts), for a browser that
  // starts over to read back in its reconcile.
  const mediaReadHere = React.useCallback(
    () => mediaLoadedRef.current && lastLoadedProjectIdRef.current === projectId,
    [projectId],
  );
  useMediaDetailsSync({
    ready: diskReady && collectionsLoaded,
    isLoaded: mediaReadHere,
    projectId: persistProjectId,
    projectName,
    items: mediaItems,
    collections,
    folderOf: collectionFolder,
    save: saveLocalFSMediaDetails,
  });

  // A browser that starts over has none of the project's agent chats: the folder's copies of the
  // ones it lacks go back into its history, once each visit to the project.
  const agentChatsReadRef = React.useRef('');
  React.useEffect(() => {
    if (!diskReady || !persistProjectId) return;
    const key = `${chatScopeId}\u0000${persistProjectId}\u0000${projectName}`;
    if (agentChatsReadRef.current === key) return;
    agentChatsReadRef.current = key;
    const scopeId = chatScopeId;
    const projectKey = persistProjectId;
    void listLocalFSMediaFolderFiles(projectName, MEDIA_AGENT_SESSIONS_FOLDER)
      .then(async (files) => {
        if (!files) {
          // Unreadable: read again the next time this runs.
          if (agentChatsReadRef.current === key) agentChatsReadRef.current = '';
          return;
        }
        if (await importAgentSessions(projectKey, scopeId, files, deletedHere('agent-session', scopeId, projectKey))) {
          void mediaAgent.refreshHistory();
        }
      })
      .catch((error) => console.warn('[MediaAgent] Could not read the conversations in the project folder:', error));
  }, [diskReady, persistProjectId, projectName, chatScopeId, listLocalFSMediaFolderFiles, mediaAgent]);

  /**
   * Flow's New collection: an untitled tile at the start of the grid, no animation — inside the
   * open collection when there is one, as Flow makes it there.
   */
  const newCollection = useEventCallback((): Collection | null => {
    if (!persistProjectId) return null;
    const collection = createCollection(undefined, openCollectionRef.current);
    if (diskReady) void ensureLocalFSCollectionFolder(projectName, collectionFolder(collection.id) as string);
    if (activeSidebarTab !== 'all') navigate({ pathname: '/media', search: tabSearch });
    return collection;
  });
  const renameCollectionTo = useEventCallback((collection: Collection, name: string) => {
    const before = collection.folder;
    const moved = renameCollection(collection.id, name);
    if (!moved || !diskReady) return;
    void renameLocalFSCollectionFolder(projectName, moved.from, moved.to).then((ok) => {
      if (ok) void rereadMovedFiles(filesUnder(collection));
      else updateCollection(collection.id, { folder: before });
    });
  });
  /** Puts a collection inside another (null: back at the top), folder and all. */
  const moveCollectionTo = useEventCallback(async (collection: Collection, target: Collection | null) => {
    const before = parentOf(collection) ?? null;
    const moved = moveCollection(collection.id, target?.id ?? null);
    if (!moved || !diskReady) return;
    if (await renameLocalFSCollectionFolder(projectName, moved.from, moved.to)) await rereadMovedFiles(filesUnder(collection));
    else moveCollection(collection.id, before);
  });
  const toggleCollectionFavorite = useEventCallback((collection: Collection) => {
    updateCollection(collection.id, { favorite: !collection.favorite });
  });
  const downloadCollectionItems = useEventCallback((collection: Collection) => {
    void downloadCollection(collection.name, collectionContents.get(collection.id) ?? []).catch(() => {
      showSnack({ icon: 'error', tone: 'error', text: 'The download failed.', actions: [{ label: 'Dismiss' }] });
    });
  });
  /** The header title's edit while a collection is open; null when not editing. */
  const [collectionNameDraft, setCollectionNameDraft] = React.useState<string | null>(null);
  const movedToTrash = (n: number) => showSnack({ icon: 'info', text: `${n} item${n === 1 ? '' : 's'} moved to trash`, actions: [{ label: 'View in trash' }, { label: 'Dismiss' }] });
  /** Tiles to the trash, each with its whole edit history. */
  const trashTiles = useEventCallback((items: MediaItem[]) => {
    for (const m of items) {
      const root = m.historyGroupId || m.id;
      for (const x of mediaItemsRef.current) if (x.id === root || x.historyGroupId === root) onTileDelete(x.id);
    }
  });
  /**
   * Flow's "Move all contents to trash": the collection's contents and those of every collection
   * inside it go to the trash flattened, the collections themselves go, and so does the folder.
   * Returns how many tiles went.
   */
  const trashCollectionContents = useEventCallback((collection: Collection): number => {
    const ids = new Set([collection.id, ...descendantsOf(collection.id).map((c) => c.id)]);
    const diskFolder = diskReady ? collectionFolder(collection.id) : undefined;
    let tiles = 0;
    for (const m of mediaItemsRef.current) {
      if (!m.collectionId || !ids.has(m.collectionId)) continue;
      onTileDelete(m.id, !!diskFolder);
      if (!m.historyParentId) tiles += 1;
    }
    deleteCollection(collection.id);
    if (diskFolder) void deleteLocalFSCollectionFolder(projectName, diskFolder);
    if (openCollectionId && ids.has(openCollectionId)) closeCollectionView();
    return tiles;
  });
  /** Asked first (ConfirmDialog), as Flow does whenever a collection is among what goes. */
  const [trashRequest, setTrashRequest] = React.useState<{ items: MediaItem[]; collections: Collection[] } | null>(null);
  const requestCollectionTrash = useEventCallback((collection: Collection) => setTrashRequest({ items: [], collections: [collection] }));
  const confirmTrashRequest = useEventCallback(() => {
    if (!trashRequest) return;
    let tiles = 0;
    for (const c of trashRequest.collections) if (getCollection(c.id)) tiles += trashCollectionContents(c);
    trashTiles(trashRequest.items);
    tiles += trashRequest.items.length;
    setSelectedTileIds(new Set());
    // Flow counts what went into the trash; an empty collection still counts as one.
    movedToTrash(Math.max(1, tiles));
  });

  /** Moves tiles (each with its whole history) into a collection, or out of one with null. */
  const moveToCollection = useEventCallback(async (ids: string[], collection: Collection | null) => {
    const groups = new Set(ids.map((id) => {
      const m = mediaItemsRef.current.find((x) => x.id === id);
      return m?.historyGroupId || id;
    }));
    const moving = mediaItemsRef.current.filter((m) => groups.has(m.historyGroupId || m.id) && !m.characterId && (m.collectionId || null) !== (collection?.id ?? null));
    if (!moving.length) return;
    const movingIds = new Set(moving.map((m) => m.id));
    setMediaItems((prev) => {
      const next = prev.map((m) => (movingIds.has(m.id) ? { ...m, collectionId: collection?.id } : m));
      if (persistProjectId) void saveProjectMedia(persistProjectId, next, chatScopeId);
      return next;
    });
    if (!isLocalFolderConnected || !isLocalFolderAuthorized || !projectName) return;
    const folder = collection ? collectionFolder(collection.id) : undefined;
    const reread: FileMove[] = [];
    for (const m of moving) {
      if (!m.isSavedToFS || !m.fsName) continue;
      const from = collectionFolder(m.collectionId);
      const moved = await moveLocalFSMediaFile(projectName, m.kind, m.fsName, from, folder);
      if (!moved) continue;
      reread.push({ id: m.id, fsName: moved, folder });
      // A song's audio goes where its cover went: they pair up within a folder.
      const audio = ownSongAudio(m, mediaItemsRef.current);
      const movedAudio = audio ? await moveLocalFSMediaFile(projectName, 'audio', audio, from, folder) : null;
      if (movedAudio) reread.push({ id: m.id, fsName: movedAudio, folder, audio: true });
      if (moved !== m.fsName || (movedAudio && movedAudio !== m.audioFsName)) {
        setMediaItems((prev) => {
          const next = prev.map((x) => (x.id === m.id ? { ...x, fsName: moved, ...(movedAudio ? { audioFsName: movedAudio } : {}) } : x));
          if (persistProjectId) void saveProjectMedia(persistProjectId, next, chatScopeId);
          return next;
        });
      }
    }
    await rereadMovedFiles(reread);
  });
  /** Every file in a collection and the collections inside it, where it is now. */
  const filesUnder = (collection: Collection): FileMove[] => {
    const ids = new Set([collection.id, ...descendantsOf(collection.id).map((c) => c.id)]);
    return mediaItemsRef.current
      .filter((m) => m.collectionId && ids.has(m.collectionId) && m.isSavedToFS && m.fsName)
      .flatMap((m) => {
        const folder = collectionFolder(m.collectionId);
        return [
          { id: m.id, fsName: m.fsName as string, folder },
          ...(m.audioFsName ? [{ id: m.id, fsName: m.audioFsName, folder, audio: true }] : []),
        ];
      });
  };
  /**
   * New blob: URLs for files that have moved (see blobFolderRef). Each tile swaps to its new URL
   * only if it still shows the old one; the old one is released unless an attachment holds it.
   */
  const rereadMovedFiles = useEventCallback(async (moves: FileMove[]) => {
    if (!isLocalFolderConnected || !isLocalFolderAuthorized || !projectName) return;
    for (const move of moves) {
      const m = mediaItemsRef.current.find((x) => x.id === move.id);
      if (!m) continue;
      const field = move.audio || (m.kind === 'audio' && /\.(mp3|wav|m4a|ogg|flac|aac)$/i.test(move.fsName)) ? 'audioUrl' : 'url';
      const old = m[field];
      if (!old?.startsWith('blob:')) continue;
      const fresh = await loadLocalFSMediaUrl(projectName, m.kind, move.fsName, move.folder);
      if (!fresh) continue;
      blobFolderRef.current.set(fresh, move.folder ?? '');
      mediaBlobUrlsRef.current = [...mediaBlobUrlsRef.current, fresh];
      setMediaItems((prev) => prev.map((x) => (x.id === move.id && x[field] === old ? { ...x, [field]: fresh } : x)));
      if (!attachmentsRef.current.some((a) => a?.url === old)) {
        try { URL.revokeObjectURL(old); } catch {}
        mediaBlobUrlsRef.current = mediaBlobUrlsRef.current.filter((u) => u !== old);
        blobFolderRef.current.delete(old);
      }
    }
  });
  /** A collection tile in the gallery's drag: a press may become a drag; the click after one opens nothing. */
  const onCollectionPress = useEventCallback((collection: Collection, e: React.MouseEvent) => {
    const tile = displayMediaItems.find((m) => m.id === `${COLLECTION_ITEM_PREFIX}${collection.id}`);
    if (tile) onTileMouseDown(tile, e);
  });
  const onCollectionOpen = useEventCallback((collection: Collection) => {
    if (!wasDraggingRef.current) openCollectionView(collection);
  });
  /** Out of the open collection, into the one it sits in (or the top of the project). */
  const onTileMoveOutOfCollection = useEventCallback((id: string) => {
    const open = getCollection(openCollectionRef.current);
    void moveToCollection([id], open ? getCollection(parentOf(open)) ?? null : null);
  });
  const onTileSetCollectionCover = useEventCallback((item: MediaItem) => {
    const id = openCollectionRef.current;
    if (id) updateCollection(id, { coverId: item.historyGroupId || item.id });
  });

  /**
   * A drop from the gallery's drag. Each tile hands over the version it shows. Collections in the
   * drag go into a collection as a whole (nested, as in Flow) or to the trash; the other targets
   * take no collection.
   */
  const dropDraggedItems = useEventCallback((target: DropTarget | null, items: MediaItem[], collections: Collection[] = []) => {
    if (!target || (!items.length && !collections.length)) return;
    const shown = items.map((m) => latestVersions.get(m.historyGroupId || m.id) ?? m);
    const attachment = (m: MediaItem, unique = false): ImageAttachment => ({
      id: unique ? `${m.id}-${Math.random().toString(36).substring(7)}` : m.id,
      url: m.url as string,
      name: m.shortenedPrompt || m.prompt || 'Attached Media',
      kind: m.kind,
    });
    switch (target.kind) {
      case 'collection': {
        const collection = getCollection(target.id);
        if (!collection) return;
        if (items.length) void moveToCollection(items.map((m) => m.id), collection);
        for (const c of collections) void moveCollectionTo(c, collection);
        if (collections.length) setSelectedTileIds(new Set());
        return;
      }
      case 'scene':
        void (async () => {
          for (const m of shown) if (m.kind === 'video') await addVideoToScene(target.id, m);
        })();
        return;
      case 'trash': {
        if (collections.length) {
          setTrashRequest({ items, collections });
          return;
        }
        trashTiles(items);
        setSelectedTileIds(new Set());
        movedToTrash(items.length);
        return;
      }
      case 'start':
      case 'end': {
        const first = shown.find((m) => m.url);
        if (!first) return;
        setAttachments((prev) => {
          const next = [...prev];
          next[target.kind === 'start' ? 0 : 1] = attachment(first, true);
          return next;
        });
        return;
      }
      case 'prompt':
        setAttachments((prev) => {
          const next = [...prev];
          for (const m of shown) {
            if (m.url && !next.some((att) => att && att.url === m.url)) next.push(attachment(m));
          }
          return next;
        });
    }
  });

  /** Flow's menu for a selection of two or more tiles, at the pointer, in place of a tile's own. */
  const [selectionMenuAt, setSelectionMenuAt] = React.useState<{ x: number; y: number } | null>(null);
  const onSelectionMenu = useEventCallback((x: number, y: number) => {
    setHoveredTileId(null);
    setActiveMenuId(null);
    setSelectionMenuAt({ x, y });
  });
  /** The selection in grid order, split into tiles and collections. */
  const selectedParts = () => {
    const items: MediaItem[] = [];
    const picked: Collection[] = [];
    for (const id of selectedTileIds) {
      if (id.startsWith(COLLECTION_ITEM_PREFIX)) {
        const c = getCollection(id.slice(COLLECTION_ITEM_PREFIX.length));
        if (c) picked.push(c);
        continue;
      }
      const m = mediaItemsRef.current.find((x) => x.id === id);
      if (m) items.push(m);
    }
    return { items, collections: picked };
  };
  /** The selection's files: each tile's shown version, then everything in its collections. */
  const selectedFiles = () => {
    const { items, collections: picked } = selectedParts();
    return [
      ...items.map((m) => latestVersions.get(m.historyGroupId || m.id) ?? m),
      ...picked.flatMap((c) => collectionContents.get(c.id) ?? []),
    ];
  };
  /** Flow's New collection on a selection asks first, listing what would go in. */
  const [collectRequest, setCollectRequest] = React.useState<{ items: MediaItem[]; collections: Collection[] } | null>(null);
  const collectMessage = (request: { items: MediaItem[]; collections: Collection[] }) => {
    const count = (n: number, noun: string) => (n ? [`${n} ${noun}${n === 1 ? '' : 's'}`] : []);
    const kind = (k: MediaItem['kind']) => request.items.filter((m) => m.kind === k).length;
    return [
      'Do you want to create a collection with:',
      ...count(request.collections.length, 'collection'),
      ...count(kind('image'), 'image'),
      ...count(kind('video'), 'video'),
      ...count(kind('audio'), 'song'),
    ].join('\n');
  };
  /** The new collection takes the selection in, collections and all, where the selection was. */
  const confirmCollectRequest = useEventCallback(() => {
    if (!collectRequest) return;
    const created = newCollection();
    if (!created) return;
    if (collectRequest.items.length) void moveToCollection(collectRequest.items.map((m) => m.id), created);
    for (const c of collectRequest.collections) void moveCollectionTo(c, created);
    setSelectedTileIds(new Set());
  });
  const selectionToScene = useEventCallback(async () => {
    const videos = selectedFiles().filter((m) => m.kind === 'video' && m.status === 'completed' && m.url);
    if (!videos.length) {
      createEmptyScene();
      return;
    }
    const sceneId = await createSceneWithVideo(videos[0]);
    for (const m of videos.slice(1)) {
      if (!$scenes.get().some((s) => s.id === sceneId)) return;
      await addVideoToScene(sceneId, m);
    }
  });
  const downloadSelection = useEventCallback(() => {
    void downloadCollection(projectName || 'Media', selectedFiles()).catch(() => {
      showSnack({ icon: 'error', tone: 'error', text: 'The download failed.', actions: [{ label: 'Dismiss' }] });
    });
  });
  const copySelection = useEventCallback(() => {
    const image = selectedFiles().find((m) => m.kind === 'image' && m.url);
    if (image?.url) void copyImage(image.url).catch(() => undefined);
  });
  const trashSelection = useEventCallback(() => {
    const { items, collections: picked } = selectedParts();
    if (picked.length) {
      setTrashRequest({ items, collections: picked });
      return;
    }
    trashTiles(items);
    setSelectedTileIds(new Set());
    movedToTrash(items.length);
  });
  const videoViewHost: VideoViewHost = {
    rename: (item, name) => onTileRename(item.id, name),
    toggleFavorite: (item) => onTileToggleFavorite(item.id),
    trash: trashFromEditor,
  };
  /** An image edit: the source image first, then any ingredients, into the source's history. */
  const startImageEdit = (source: MediaItem, text: string, ingredients: MediaItem[], modelId: string, ratio: string, retrying?: MediaItem): MediaItem | null => {
    const model = imageModels.find((m) => m.id === liveModelId(modelId)) ?? imageModels.find((m) => m.id === imageModel);
    if (!model) {
      setGenerationError({ message: "You haven't added an image model yet. Add one to edit images.", settings: true, missingModel: 'image' });
      return null;
    }
    const isGPT = model.id === 'gpt-image-2';
    const isGrok = model.id === 'grok-imagine';
    const apiKey = apiKeys?.[isGrok ? 'spacexai' : isGPT ? 'openai' : 'gemini']?.[0];
    if (!apiKey) {
      setGenerationError({ message: `${isGrok ? 'Grok' : isGPT ? 'OpenAI' : 'Google Gemini'} API key is missing. Add it in Settings → Models & API.`, settings: true });
      return null;
    }
    setGenerationError(null);
    const attachments: ImageAttachment[] = retrying?.attachments ?? [source, ...ingredients]
      .filter((m) => m.url)
      .map((m) => ({ id: m.id, url: m.url as string, name: m.shortenedPrompt || m.prompt || 'image', kind: m.kind }));
    const historyGroupId = source.historyGroupId || source.id;
    if (!source.historyGroupId) setMediaItems((prev) => prev.map((m) => (m.id === source.id ? { ...m, historyGroupId } : m)));
    const item: MediaItem = retrying
      ? { ...retrying, status: 'generating', error: undefined, url: undefined }
      : {
        id: `${Date.now()}-viewer-${Math.random().toString(36).slice(2, 8)}`,
        kind: 'image',
        status: 'generating',
        prompt: text,
        modelId: model.id,
        modelName: model.name,
        ratio,
        timestamp: Date.now(),
        attachments,
        historyGroupId,
        historyParentId: source.id,
        collectionId: source.collectionId,
        effort: imageEffort,
        quality: imageQuality,
        resolution: imageResolution,
      };
    if (retrying) setMediaItems((prev) => prev.map((m) => (m.id === retrying.id ? item : m)));
    else {
      setMediaItems((prev) => [item, ...prev]);
      void rephrasePromptForItems([item.id], text, apiKey);
    }
    void generateSingleImage(item, item.prompt, model.id, item.ratio, apiKey, attachments);
    return item;
  };
  const imageEditHost: ImageEditHost = {
    models: imageModels,
    defaultModelId: imageModels.some((m) => m.id === liveModelId(selectedItem?.modelId ?? '')) ? liveModelId(selectedItem?.modelId ?? '') : imageModel,
    notice: visibleGenerationError ? (
      <PromptNotice notice={visibleGenerationError} onDismiss={() => setGenerationError(null)} onOpenSettings={openModelSettings} />
    ) : undefined,
    generate: (source, text, ingredients, modelId, ratio) => startImageEdit(source, text, ingredients, modelId, ratio),
    retry: (item) => {
      const parent = mediaItemsRef.current.find((m) => m.id === item.historyParentId);
      if (!parent) return;
      const started = startImageEdit(parent, item.prompt, [], item.modelId, item.ratio, item);
      if (started) setSelectedItem(started);
    },
    removeVersion: (item) => {
      if (selectedItem?.id === item.id) {
        const parent = mediaItemsRef.current.find((m) => m.id === item.historyParentId);
        if (parent) setSelectedItem(parent);
      }
      onTileDelete(item.id);
    },
    rename: (item, name) => onTileRename(item.id, name),
    toggleFavorite: (item) => onTileToggleFavorite(item.id),
    trash: trashFromEditor,
    open: (item) => setSelectedItem(item),
  };

  /**
   * A character's portrait or body, or a version of one. Kept out of the grid by its `characterId`.
   * Returns the pending item and its generation, or the notice to show when it can't start.
   */
  const launchCharacterImage = (
    { prompt: text, modelId, references, characterId, parent }: Parameters<CharacterHost['generate']>[0],
  ): { item: MediaItem; done: Promise<GenerationResult> } | { notice: PromptNoticeState } => {
    const model = imageModels.find((m) => m.id === liveModelId(modelId)) ?? imageModels.find((m) => m.id === imageModel);
    if (!model) {
      return { notice: { message: "You haven't added an image model yet. Add one to make characters.", settings: true, missingModel: 'image' } };
    }
    const isGPT = model.id === 'gpt-image-2';
    const isGrok = model.id === 'grok-imagine';
    const apiKey = apiKeys?.[isGrok ? 'spacexai' : isGPT ? 'openai' : 'gemini']?.[0];
    if (!apiKey) {
      return { notice: { message: `${isGrok ? 'Grok' : isGPT ? 'OpenAI' : 'Google Gemini'} API key is missing. Add it in Settings → Models & API.`, settings: true } };
    }
    const attachments: ImageAttachment[] = references
      .filter((m) => m.url)
      .map((m) => ({ id: m.id, url: m.url as string, name: m.shortenedPrompt || m.prompt || 'image', kind: m.kind }));
    const historyGroupId = parent ? (parent.historyGroupId || parent.id) : undefined;
    if (parent && !parent.historyGroupId) setMediaItems((prev) => prev.map((m) => (m.id === parent.id ? { ...m, historyGroupId } : m)));
    const item: MediaItem = {
      id: `${Date.now()}-character-${Math.random().toString(36).slice(2, 8)}`,
      kind: 'image',
      status: 'generating',
      prompt: text,
      modelId: model.id,
      modelName: model.name,
      ratio: '16:9',
      timestamp: Date.now(),
      attachments: attachments.length ? attachments : undefined,
      characterId,
      historyGroupId,
      historyParentId: parent?.id,
    };
    setMediaItems((prev) => [item, ...prev]);
    return { item, done: generateSingleImage(item, text, model.id, '16:9', apiKey, attachments) };
  };
  const startCharacterImage: CharacterHost['generate'] = (req) => {
    const started = launchCharacterImage(req);
    if ('notice' in started) {
      setGenerationError(started.notice);
      return null;
    }
    setGenerationError(null);
    return started.item;
  };
  const formatCharacterPrompt = async (text: string): Promise<string> => {
    const apiKey = apiKeys?.gemini?.[0];
    if (!apiKey) throw new Error('Format needs a Google Gemini API key. Add one in Settings → Models & API.');
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${namingModel}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `Rewrite this into one detailed visual description of a single character for an image generator: face, hair, build, clothing and accessories, in vivid, concrete language. One paragraph of at most 90 words. Return only the description, with no title, quotes or explanation.\n\nDescription: ${text}`,
          }],
        }],
      }),
    });
    if (!res.ok) throw new Error('The description could not be formatted.');
    const data = await res.json();
    const out = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return out ? out.replace(/^["'`\s]+|["'`\s]+$/g, '') : text;
  };
  const characterHost: CharacterHost = {
    ...editorHost,
    close: () => openCharacterPage(null),
    imageModels,
    defaultImageModelId: imageModel,
    notice: visibleGenerationError ? (
      <PromptNotice notice={visibleGenerationError} onDismiss={() => setGenerationError(null)} onOpenSettings={openModelSettings} />
    ) : undefined,
    generate: startCharacterImage,
    formatPrompt: formatCharacterPrompt,
    addToPrompt: (item) => onTileAddToPrompt(item),
  };

  const onTileAnimate = useEventCallback((targetItem: MediaItem) => {
    setModelMode('video');
    setVideoMode('frames');
    if (targetItem.url) {
      setAttachments(prev => {
        if (prev.some(att => att && att.url === targetItem.url)) return prev;
        const next = [...prev, {
          id: targetItem.id,
          url: targetItem.url,
          name: targetItem.shortenedPrompt || targetItem.prompt || 'Attached Media',
          kind: targetItem.kind
        }];
        return next.slice(0, 2);
      });
      setTimeout(() => {
        promptEditorRef.current?.focus();
      }, 50);
    }
  });

  // The grid's frame, shared by All media and the Characters tab (gallery-layout.ts lays both out).
  // Below 961px the rows are shorter (two or three tiles across a phone, three or four across a
  // tablet), the gaps narrower, and the agent's and player's panels overlay the grid instead of
  // narrowing it; `media-main` carries the matching left padding.
  const gallerySidePad = viewport === 'phone' ? 8 : 12;
  const galleryGap = viewport === 'phone' ? 6 : viewport === 'tablet' ? 8 : GALLERY_GAP;
  const galleryTargetH = viewport === 'phone' || isShortNarrow ? 128 : viewport === 'tablet' ? 176 : isSidebarCollapsed ? 230 : 270;
  // Sidebar left edge is 356px from screen edge. We want a 12px gap to images.
  // So total distance from screen edge to images should be 368px.
  // Since scrollbar takes up `scrollbarWidth` space, padding needs to be 368 - scrollbarWidth.
  const galleryPaddingRight = isNarrow ? gallerySidePad : (isAgentSidebarOpen || !!activeMusicItem) ? Math.max(12, 368 - scrollbarWidth) : 12;
  // Subtract 2px of safety margin to absorb browser floating-point rounding errors and prevent accidental wrapping of tiles
  // Subtract 3px for the left padding added to prevent left-side outline clipping
  const galleryWidth = isNarrow
    ? Math.max(1, canvasInnerWidth + 12 - gallerySidePad - galleryPaddingRight - 2)
    : Math.max(1, ((isAgentSidebarOpen || !!activeMusicItem) ? Math.max(1, canvasInnerWidth + 12 - galleryPaddingRight) : Math.max(1, canvasInnerWidth)) - 5);

  const galleryLayoutItems = React.useMemo((): GalleryCell<MediaItem>[] => {
    if (!displayMediaItems.length) return [];
    const sortedMediaItems = [...displayMediaItems].sort(sortFilter.sort === 'oldest'
      ? (a, b) => compareMediaItemsNewestFirst(b, a)
      : compareMediaItemsNewestFirst);
    return layoutGallery(sortedMediaItems.map((item) => ({ item, ar: ratioValue(item.ratio) })), galleryWidth, galleryTargetH, { gap: galleryGap });
  }, [displayMediaItems, galleryWidth, galleryTargetH, galleryGap, sortFilter.sort]);

  // Flow's View mode > Batch (batch/), wherever the gallery grid shows. Music is Willow's own
  // surface and Characters has a page of its own, so both keep the grid.
  const batchMode = viewSettings.viewMode === 'batch' && activeSidebarTab !== 'music' && activeSidebarTab !== 'characters';
  const batchTiles = React.useMemo(() => (batchMode
    ? [...displayMediaItems].sort(sortFilter.sort === 'oldest' ? (a, b) => compareMediaItemsNewestFirst(b, a) : compareMediaItemsNewestFirst)
    : EMPTY_ITEMS), [batchMode, displayMediaItems, sortFilter.sort]);
  const legacyBatches = React.useMemo(() => legacyBatchKeys(batchTiles.filter((m) => !isStandIn(m))), [batchTiles]);
  const batchKeyOf = React.useCallback(
    (m: MediaItem) => (isStandIn(m) ? `unbatched-${m.id}` : m.batchId ?? legacyBatches.get(m.id) ?? `unbatched-${m.id}`),
    [legacyBatches],
  );
  // Flow's G (or Shift+G) switches view mode, and +, - and 0 step and reset the grid size —
  // from the gallery only, not from a field, an editor, a menu or a dialog.
  React.useEffect(() => {
    const SIZES: ViewSettings['gridSize'][] = ['S', 'M', 'L'];
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      // Kept alive off screen while it works, the editor is not what the keys are for; nor is the
      // gallery under the Tools pages.
      if (!window.location.pathname.startsWith('/media') || isToolsPath(window.location.pathname)) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      const search = new URLSearchParams(window.location.search);
      if (selectedItemRef.current || search.has('scene') || search.has('character')) return;
      if (document.querySelector('[role="menu"], [role="dialog"]')) return;
      if (e.key === 'g' || e.key === 'G') {
        setViewSettings((v) => ({ ...v, viewMode: v.viewMode === 'batch' ? 'grid' : 'batch' }));
      } else if (!e.shiftKey && e.key === '0') {
        setViewSettings((v) => ({ ...v, gridSize: 'M' }));
      } else if (!e.shiftKey && (e.key === '=' || e.key === '+' || e.key === '-')) {
        const step = e.key === '-' ? -1 : 1;
        setViewSettings((v) => ({ ...v, gridSize: SIZES[Math.min(SIZES.length - 1, Math.max(0, SIZES.indexOf(v.gridSize) + step))] }));
      } else {
        return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const isContextMenuActive = activeMenuId !== null && activeMenuId.endsWith('-context');

  if (activeSidebarTab === 'music' && isCreatingMusic) {
    return (
      <div className="h-screen w-screen bg-[#000000] overflow-hidden relative">
        <MusicView 
          onBack={() => setIsCreatingMusic(false)} 
          mediaItems={mediaItems} 
          onFileSelect={() => fileInputRef.current?.click()} 
          modelMode={modelMode}
          activeModelId={musicModel}
          onModelChange={(id) => {
            setMusicModel(id as string);
          }}
          availableModels={musicModels}
          onAddModel={openModelSettings}
          coverImageModel={coverImageModel}
          onSongGenerated={(item: MediaItem) => {
            setMediaItems(prev => {
              const updated = [item, ...prev];
              if (projectId && !projectId.startsWith('temp_')) {
                saveProjectMedia(projectId, updated, chatScopeId);
              }
              return updated;
            });
          }}
        />
        {isInitialLoading && (
          <FlowLoadingPage
            isFadingOut={isInitialLoadingFadingOut}
            onFadedOut={() => {
              setIsInitialLoading(false);
              setIsInitialLoadingFadingOut(false);
            }}
          />
        )}
      </div>
    );
  }

  if (fullscreenMusicItem) {
    return (
      <div className="h-screen w-screen bg-[#000000] overflow-hidden relative">
        <MusicView 
          onBack={() => setFullscreenMusicItem(null)} 
          mediaItems={mediaItems} 
          modelMode={modelMode}
          activeModelId={musicModel}
          onModelChange={(id) => {
            setMusicModel(id as string);
          }}
          availableModels={musicModels}
          onAddModel={openModelSettings}
          coverImageModel={coverImageModel}
          initialItem={fullscreenMusicItem}
        />
        {isInitialLoading && (
          <FlowLoadingPage
            isFadingOut={isInitialLoadingFadingOut}
            onFadedOut={() => {
              setIsInitialLoading(false);
              setIsInitialLoadingFadingOut(false);
            }}
          />
        )}
      </div>
    );
  }

  /** One gallery tile at its layout size, with every gallery behaviour: the grid's and batch view's. */
  const renderGalleryTile = ({ item, ar, finalHeight, finalWidth, isLastRow }: { item: MediaItem; ar: number; finalHeight: number; finalWidth: number; isLastRow: boolean }) => {
    if (item.id === 'new-music-button') {
      return (
        <motion.div
          layout
          transition={{ 
            duration: isRightSidebarToggling ? 0.78 : 0, 
            ease: [0.16, 1, 0.3, 1] 
          }}
          key={item.id}
          onClick={() => setIsCreatingMusic(true)}
          style={{
            flexGrow: isLastRow ? 0 : ar,
            flexBasis: `${finalWidth}px`,
            height: `${finalHeight}px`,
          }}
          className={`gallery-tile relative rounded-[16px] bg-[#141517] hover:bg-[#1f2023] transition-colors shadow-2xl flex flex-col items-center justify-center cursor-pointer border-none group overflow-hidden`}
        >
           <Plus size={32} strokeWidth={1.5} className="text-[#a0a0a0] group-hover:text-white transition-colors mb-4" />
           <span className="text-[13px] font-medium text-[#a0a0a0] group-hover:text-white transition-colors tracking-wide">New music</span>
        </motion.div>
      );
    }
    if (item.id.startsWith(CHARACTER_ITEM_PREFIX)) {
      const character = characters.find((c) => `${CHARACTER_ITEM_PREFIX}${c.id}` === item.id);
      if (!character) return null;
      return (
        <CharacterTile
          key={item.id}
          character={character}
          portrait={character.portraitId ? mediaItems.find((m) => m.id === character.portraitId) : undefined}
          box={{ flexGrow: isLastRow ? 0 : ar, flexBasis: `${finalWidth}px`, height: `${finalHeight}px` }}
          layoutDuration={isRightSidebarToggling ? 0.78 : 0}
          onOpen={() => openCharacterPage(character.id)}
          onFavorite={() => favoriteCharacter(character)}
          onAddToPrompt={() => addCharacterToPrompt(character)}
          onCopy={() => copyCharacter(character)}
          onRename={(name) => renameCharacter(character, name)}
          onDelete={() => removeCharacter(character)}
        />
      );
    }
    if (item.id.startsWith(SCENE_ITEM_PREFIX)) {
      const scene = scenesById.get(item.id.slice(SCENE_ITEM_PREFIX.length));
      if (!scene) return null;
      const isTarget = dropTarget?.kind === 'scene' && dropTarget.id === scene.id;
      return (
        <SceneTile
          key={item.id}
          scene={scene}
          ar={ar}
          finalWidth={finalWidth}
          finalHeight={finalHeight}
          isLastRow={isLastRow}
          layoutDuration={isRightSidebarToggling ? 0.78 : 0}
          resolveUrl={resolveSceneMediaUrl}
          dragDimmed={!!draggingItemId && !isTarget}
          dropTarget={isTarget}
        />
      );
    }
    if (item.id.startsWith(COLLECTION_ITEM_PREFIX)) {
      const collection = collections.find((c) => `${COLLECTION_ITEM_PREFIX}${c.id}` === item.id);
      if (!collection) return null;
      const selected = selectedTileIds.has(item.id);
      return (
        <CollectionTile
          key={item.id}
          tileId={item.id}
          collection={collection}
          items={collectionContents.get(collection.id) ?? EMPTY_ITEMS}
          ar={ar}
          finalWidth={finalWidth}
          finalHeight={finalHeight}
          isLastRow={isLastRow}
          layoutDuration={isRightSidebarToggling ? 0.78 : 0}
          isSelected={selected}
          selectionDimmed={!draggingItemId && selectedTileIds.size > 0 && !selected}
          dragDimmed={!!draggingItemId && !dragIdsRef.current.includes(item.id)}
          dropTarget={dropTarget?.kind === 'collection' && dropTarget.id === collection.id}
          onPress={onCollectionPress}
          onSelectionMenu={selected && selectedTileIds.size > 1 ? onSelectionMenu : undefined}
          onOpen={onCollectionOpen}
          onToggleFavorite={toggleCollectionFavorite}
          onRename={renameCollectionTo}
          onDownload={downloadCollectionItems}
          onTrash={requestCollectionTrash}
        />
      );
    }
    return (
        <GalleryTile
          key={item.id}
          item={item}
          projectName={projectName}
          ar={ar}
          finalWidth={finalWidth}
          finalHeight={finalHeight}
          isLastRow={isLastRow}
          layoutDuration={isRightSidebarToggling ? 0.78 : 0}
          isMenuOpen={activeMenuId === item.id || activeMenuId === `${item.id}-context`}
          isHovered={hoveredTileId === item.id && selectionBox === null && draggingItemId === null}
          isRenaming={renamingItemId === item.id}
          isDragging={draggingItemId === item.id}
          isSelected={selectedTileIds.has(item.id)}
          dimmed={Boolean(!draggingItemId && (
            (renamingItemId && renamingItemId !== item.id) ||
            (selectedTileIds.size > 0 && !selectedTileIds.has(item.id))
          ))}
          dragDimmed={!!draggingItemId && !dragIdsRef.current.includes(item.id)}
          hasHistory={historyGroupsWithVersions.has(item.historyGroupId || item.id)}
          interactionsMuted={Boolean(draggingItemId || selectionBox !== null || isContextMenuActive)}
          onTileMouseDown={onTileMouseDown}
          onTileClick={onTileClick}
          onTileMouseEnter={onTileMouseEnter}
          onTileMouseLeave={onTileMouseLeave}
          onMenuOpenChange={onTileMenuOpenChange}
          onCancel={onTileCancel}
          onRefresh={onTileRefresh}
          onRePrompt={onTileRePrompt}
          onDelete={onTileDelete}
          onRename={onTileRename}
          onSetIsRenaming={onTileSetRenaming}
          onSetAsCover={onTileSetAsCover}
          onAddToPrompt={onTileAddToPrompt}
          onAnimate={onTileAnimate}
          onToggleFavorite={onTileToggleFavorite}
          onShare={onTileShare}
          onFlag={onTileFlag}
          onSetCollectionCover={openCollection ? onTileSetCollectionCover : undefined}
          onMoveOutOfCollection={openCollection ? onTileMoveOutOfCollection : undefined}
          onSelectionMenu={selectedTileIds.has(item.id) && selectedTileIds.size > 1 ? onSelectionMenu : undefined}
        />
      );
  };

  const renderBatchTile = (item: MediaItem, width: number, height: number) =>
    renderGalleryTile({ item, ar: tileAspect(item), finalWidth: width, finalHeight: height, isLastRow: true });

  /** Flow reads a batch's info off its first tile; a reference shows its item as it is now. */
  const batchInfoModel = (batch: LaidOutBatch<MediaItem>): BatchInfoModel => {
    const first = batch.tiles[0];
    const pending = batch.tiles.some((m) => m.status === 'generating');
    if (first.id.startsWith(COLLECTION_ITEM_PREFIX)) {
      const collection = getCollection(first.id.slice(COLLECTION_ITEM_PREFIX.length));
      const contents = (collection && collectionContents.get(collection.id)) || EMPTY_ITEMS;
      const count = (kind: MediaItem['kind']) => contents.filter((m) => m.kind === kind).length;
      return { label: collection?.name, ingredients: [], counts: { images: count('image'), videos: count('video'), songs: count('audio') }, canReuse: false, canTrash: !!collection };
    }
    if (first.id.startsWith(SCENE_ITEM_PREFIX)) {
      const scene = scenesById.get(first.id.slice(SCENE_ITEM_PREFIX.length));
      return { label: scene?.name, ingredients: [], created: scene?.createdAt, clips: scene?.clips.length ?? 0, canReuse: false, canTrash: !!scene && !pending };
    }
    if (first.id.startsWith(CHARACTER_ITEM_PREFIX)) {
      const character = getCharacter(first.id.slice(CHARACTER_ITEM_PREFIX.length));
      return { label: character ? characterName(character) : undefined, ingredients: [], created: character?.createdAt, canReuse: false, canTrash: !!character };
    }
    const generated = isGenerated(first);
    return {
      prompt: generated ? first.prompt : undefined,
      ingredients: generated ? (first.attachments ?? []).map((att, i) => {
        const live = mediaItems.find((m) => m.id === att.id);
        const shown = live ? latestVersions.get(live.historyGroupId || live.id) ?? live : undefined;
        return { key: `${att.id}-${i}`, url: shown?.url || att.url || undefined, kind: shown?.kind ?? att.kind ?? 'image', aspect: ratioValue(live?.ratio) };
      }) : [],
      created: first.timestamp,
      model: generated ? first.modelName : undefined,
      uploaded: generated ? undefined : first.kind === 'video' ? 'video' : first.kind === 'image' ? 'image' : undefined,
      videoUrl: first.kind === 'video' && first.status === 'completed' && first.url ? first.url : undefined,
      ratio: first.kind === 'audio' ? undefined : first.ratio,
      canReuse: generated,
      canTrash: !pending,
    };
  };

  /** Flow's Download batch: one zip, a collection's whole contents included; nothing for a scene. */
  const downloadBatch = (batch: LaidOutBatch<MediaItem>) => {
    const files = batch.tiles.flatMap((m) => {
      if (m.id.startsWith(COLLECTION_ITEM_PREFIX)) return collectionContents.get(m.id.slice(COLLECTION_ITEM_PREFIX.length)) ?? EMPTY_ITEMS;
      if (m.id.startsWith(SCENE_ITEM_PREFIX)) return EMPTY_ITEMS;
      if (m.id.startsWith(CHARACTER_ITEM_PREFIX)) return characterImages(m.id.slice(CHARACTER_ITEM_PREFIX.length));
      return [m];
    }).filter((m) => m.status === 'completed' && m.url);
    if (!files.length) return;
    void downloadCollection('download', files).catch(() => {
      showSnack({ icon: 'error', tone: 'error', text: 'Failed to download media', actions: [{ label: 'Dismiss' }] });
    });
  };

  /** A collection asks first, a scene goes with its Undo; the rest go to the trash at once. */
  const trashBatch = (batch: LaidOutBatch<MediaItem>) => {
    const first = batch.tiles[0];
    if (first.id.startsWith(COLLECTION_ITEM_PREFIX)) {
      const collection = getCollection(first.id.slice(COLLECTION_ITEM_PREFIX.length));
      if (collection) requestCollectionTrash(collection);
      return;
    }
    if (first.id.startsWith(SCENE_ITEM_PREFIX)) {
      trashScene(first.id.slice(SCENE_ITEM_PREFIX.length));
      return;
    }
    if (first.id.startsWith(CHARACTER_ITEM_PREFIX)) {
      const character = getCharacter(first.id.slice(CHARACTER_ITEM_PREFIX.length));
      if (character) removeCharacter(character);
      return;
    }
    trashTiles(batch.tiles.map((m) => mediaItemsRef.current.find((x) => x.id === m.id) ?? m));
    movedToTrash(batch.tiles.length);
  };

  /** A reference chip adds that reference to the prompt, as Add to prompt does. */
  const addBatchIngredient = (batch: LaidOutBatch<MediaItem>, index: number) => {
    const att = batch.tiles[0].attachments?.[index];
    if (!att) return;
    const live = mediaItems.find((m) => m.id === att.id);
    if (live) {
      onTileAddToPrompt(latestVersions.get(live.historyGroupId || live.id) ?? live);
      return;
    }
    if (!att.url) return;
    setAttachments((prev) => (prev.some((a) => a && a.url === att.url) ? prev : [...prev, att]));
    setTimeout(() => promptEditorRef.current?.focus(), 50);
  };

  const renderBatchInfo = (batch: LaidOutBatch<MediaItem>) => (
    <BatchInfo
      model={batchInfoModel(batch)}
      onDownload={() => downloadBatch(batch)}
      onReuse={() => onTileRePrompt(batch.tiles[0])}
      onTrash={() => trashBatch(batch)}
      onIngredient={(index) => addBatchIngredient(batch, index)}
    />
  );

  // The header's editable names, drawn by the desktop header or, below 961px, MediaCompactHeader.
  const collectionNameInput = openCollection ? (
    <input
      key={openCollection.id}
      type="text"
      aria-label="Editable text"
      size={(collectionNameDraft ?? openCollection.name).length + 1}
      value={collectionNameDraft ?? openCollection.name}
      readOnly={collectionNameDraft === null}
      onClick={() => { if (collectionNameDraft === null) setCollectionNameDraft(openCollection.name); }}
      onChange={(e) => { if (collectionNameDraft !== null) setCollectionNameDraft(e.target.value); }}
      onKeyDown={(e) => {
        if (collectionNameDraft === null) return;
        if (e.key === 'Enter' && !(e.nativeEvent as any).isComposing) e.currentTarget.blur();
        else if (e.key === 'Escape') setCollectionNameDraft(null);
      }}
      onBlur={() => {
        if (collectionNameDraft === null) return;
        renameCollectionTo(openCollection, collectionNameDraft);
        setCollectionNameDraft(null);
      }}
      className={`bg-transparent border-none outline-none text-base leading-6 font-normal tracking-normal text-white max-w-[500px] p-[1px_2px] cursor-text truncate transition-colors ${
        collectionNameDraft !== null ? 'caret-white' : 'caret-transparent hover:bg-white/10 rounded-lg'
      }`}
      title="Rename collection"
      spellCheck={false}
    />
  ) : null;
  const projectNameInput = (
    <input
      type="text"
      size={Math.max(1, (isEditingProjectName ? editingProjectNameValue : projectName).length)}
      value={isEditingProjectName ? editingProjectNameValue : projectName}
      readOnly={!isEditingProjectName}
      onClick={() => {
        if (!isEditingProjectName) {
          projectRenameResolvedRef.current = false;
          setEditingProjectNameValue(projectName);
          setIsEditingProjectName(true);
        }
      }}
      onChange={(e) => {
        if (isEditingProjectName) setEditingProjectNameValue(e.target.value);
      }}
      onKeyDown={(e) => {
        if (!isEditingProjectName) return;
        // isComposing: an IME (CJK input) Enter confirms the composition,
        // not the rename — committing there would rename to half-typed text.
        if (e.key === 'Enter' && !(e.nativeEvent as any).isComposing) {
          projectRenameResolvedRef.current = true;
          void commitProjectRename(editingProjectNameValue);
        } else if (e.key === 'Escape') {
          projectRenameResolvedRef.current = true;
          setIsEditingProjectName(false);
        }
      }}
      onBlur={() => {
        if (!isEditingProjectName) return;
        // Enter/Escape already resolved this edit — the blur fired by
        // the input unmounting must not commit again (or at all,
        // after a cancel).
        if (projectRenameResolvedRef.current) {
          projectRenameResolvedRef.current = false;
          return;
        }
        void commitProjectRename(editingProjectNameValue);
      }}
      onFocus={(e) => {
        if (isEditingProjectName) {
          e.currentTarget.select();
        }
      }}
      className={`bg-transparent border-none outline-none text-base leading-6 font-normal tracking-normal text-white max-w-[210px] p-[1px_2px] cursor-text truncate transition-colors ${
        isEditingProjectName ? 'caret-white' : 'caret-transparent hover:bg-white/10 rounded-lg'
      }`}
      title="Rename project"
      spellCheck={false}
    />
  );
  const startProjectRename = () => {
    projectRenameResolvedRef.current = false;
    setEditingProjectNameValue(projectName);
    setIsEditingProjectName(true);
  };

  return (
    <div
      className={`media-root relative flex flex-col h-screen w-screen bg-[#000000] text-gray-200 overflow-hidden ${
        selectionBox !== null ? 'selecting-mode' : ''
      }`}
      style={{ fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif" }}
      onContextMenu={handleCanvasContextMenu}
      onMouseDown={(e) => {
        const target = e.target as HTMLElement;
        if (!target?.closest) return;
        if (selectedItem !== null || activeSidebarTab === 'characters') return;
        const isClickable = target.closest('button, .gallery-tile, input, a, [draggable="true"], select, textarea, [role="button"], .interactive-element, .custom-scrollbar-thumb');
        const isExcludedArea = target.closest('.prompt-container-box') || target.closest('.agent-sidebar-container') || target.closest('.asset-menu-modal-container');
        
        if (e.button === 0 && !isClickable && !isExcludedArea && mainRef.current) {
          e.preventDefault(); // Prevents native text selection during drag
          if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur(); // Manually blur since preventDefault stops native blur
          }
          isSelectingRef.current = true;
          setSelectedTileIds(new Set());
          
          // Seed initial mouse viewport position
          mouseViewportPosRef.current = { x: e.clientX, y: e.clientY };
          setDragMousePos({ x: e.clientX, y: e.clientY });
          
          selectionDragStartRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            startScrollTop: mainRef.current.scrollTop,
            startScrollLeft: mainRef.current.scrollLeft
          };

          setSelectionBox({
            startX: e.clientX,
            startY: e.clientY,
            currentX: e.clientX,
            currentY: e.clientY,
            startScrollTop: mainRef.current.scrollTop,
            startScrollLeft: mainRef.current.scrollLeft
          });
          
          // Force initial visual update
          requestAnimationFrame(updateSelectionBoxVisuals);
        }
      }}
    >
      {isInitialLoading && (
        <FlowLoadingPage
          isFadingOut={isInitialLoadingFadingOut}
          onFadedOut={() => {
            setIsInitialLoading(false);
            setIsInitialLoadingFadingOut(false);
          }}
        />
      )}

      {/* Fading Backdrop Blur & Dark Gradient Strip */}
      <div 
        className="absolute inset-x-0 top-0 h-32 pointer-events-none z-[70]"
        style={{
          background: 'linear-gradient(to bottom, rgba(0, 0, 0, 0.95) 0%, rgba(0, 0, 0, 0.6) 40%, rgba(0, 0, 0, 0.15) 75%, transparent 100%)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          maskImage: 'linear-gradient(to bottom, black 0%, rgba(0, 0, 0, 0.9) 35%, rgba(0, 0, 0, 0.3) 70%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 0%, rgba(0, 0, 0, 0.9) 35%, rgba(0, 0, 0, 0.3) 70%, transparent 100%)',
          opacity: (isHeaderVisible && !isAtTop) ? 1 : 0,
          visibility: (isHeaderVisible && !isAtTop) ? 'visible' : 'hidden',
          transition: headerFadeTransition
        }}
      />

      {/* Top Header.
        * In Google Flow, the top area elements simply fade away in place (opacity/visibility)
        * without translating up or down, while the left sidebar elements move up/down.
        * Below 961px it is Willow's own, MediaCompactHeader, opening the same menus. */}
      {isNarrow ? (
        <MediaCompactHeader
          viewport={viewport === 'phone' ? 'phone' : 'tablet'}
          railAsDrawer={railAsDrawer}
          visible={isHeaderVisible}
          transition={headerFadeTransition}
          inCollection={!!openCollection}
          onBack={closeCollectionView}
          onHome={() => navigate('/?mode=media')}
          onOpenDrawer={() => setIsNavDrawerOpen(true)}
          title={(
            <div className="mch-name flex items-center min-w-0" style={{ fontFamily: PROJECT_NAME_FONT }}>
              {openCollection ? collectionNameInput : projectNameInput}
            </div>
          )}
          searchOpen={isSearchOpen}
          searchQuery={searchQuery}
          onSearchQuery={setSearchQuery}
          onOpenSearch={openSearch}
          onCloseSearch={closeSearch}
          searchInputRef={searchInputRef}
          searchFormRef={compactSearchFormRef}
          projectRef={projectMenuButtonRef}
          addRef={addMenuButtonRef}
          filterRef={sortFilterButtonRef}
          settingsRef={viewSettingsButtonRef}
          moreRef={moreMenuButtonRef}
          accountRef={accountButtonRef}
          openMenu={openHeaderMenu}
          onMenu={(menu) => setOpenHeaderMenu((current) => (current === menu ? null : menu))}
          onAccount={() => setIsAccountMenuOpen((open) => !open)}
          accountName={userProfile?.displayName || user?.email}
          accountPhoto={userProfile?.photoURL || user?.photoURL}
        />
      ) : (
      <header 
        ref={headerRef}
        className="absolute top-0 left-0 right-0 h-[76px] flex items-center justify-between pl-5 pr-5 shrink-0 z-[80] bg-transparent pointer-events-none"
        style={{
          opacity: isHeaderVisible ? 1 : 0,
          visibility: isHeaderVisible ? 'visible' : 'hidden',
          transition: headerFadeTransition
        }}
      >
        
        {/* Left Section.
          * Flow spaces this cluster with an 8px flex gap and then insets the name by a further
          * 16px of its own, so the name sits 24px past the back arrow but only 8px before the
          * three-dot button — the two gaps are deliberately unequal.
          *
          * Width is left to the content, which is what puts the search field where Flow puts it:
          * the header is `justify-between` with the field's slot taking the slack, so an auto-width
          * cluster leaves equal gaps either side of the field (Flow's are 233.5px to 0.1px). A fixed
          * reservation here instead pushes the field off that centre by however much the name falls
          * short of it. The name truncates at 210px, so this caps at 306px on its own. */}
        {/* The open field covers this cluster, so it fades out from under it — Flow's does the
          * same, and leaving it lit would show through the field's 10% fill. */}
        <div
          className={`flex items-center shrink-0 transition-opacity duration-200 ${
            isSearchOpen ? 'opacity-0 pointer-events-none' : isHeaderVisible ? 'pointer-events-auto' : 'pointer-events-none'
          }`}
        >
          {/* Navigation header: Home button + Project title (matching Google Flow's flow-navigation-header) */}
          <div className="flex items-center gap-2">
            {/* Flow's header controls are 40x40 with a 12px radius, centered at y=38,
              * with Google Symbols at 24px with `"FILL" 0, "wght" 300`. */}
            {/* Inside a collection Flow's Home becomes the back arrow, and the title is the
              * collection's name, editable the same way. */}
            {openCollection ? (
              <button
                onClick={closeCollectionView}
                className="w-10 h-10 shrink-0 flex items-center justify-center hover:bg-white/10 rounded-xl transition-colors text-white"
                title="Back button to go to previous page"
                aria-label="Back button to go to previous page"
              >
                <FlowIcon name="arrow_back" size={24} weight={300} />
              </button>
            ) : (
            <button 
              onClick={() => navigate('/?mode=media')}
              className="w-10 h-10 shrink-0 flex items-center justify-center hover:bg-white/10 rounded-xl transition-colors text-white"
              title="Home"
            >
              <MaterialSymbol name="home" family="google-symbols" size={24} weight={400} variationSettings='"FILL" 0, "wght" 300' />
            </button>
            )}
            {openCollection && (
              <div className="flex items-center min-w-0" style={{ fontFamily: PROJECT_NAME_FONT }}>
                {collectionNameInput}
              </div>
            )}
            {/* 16px/24px regular Google Sans Text with 8px flex gap from Home button (matching Google Flow).
              * Flow uses an editable-text-input with size={length} giving natural input width (e.g. 104px for 5 chars). */}
            <div className={`flex items-center min-w-0${openCollection ? ' hidden' : ''}`} style={{ fontFamily: PROJECT_NAME_FONT }}>
              {projectNameInput}
            </div>
          </div>
          {/* Flow dims this one to 50% white, unlike the header-right group. Placed directly after flow-navigation-header without gap. */}
          <button
            ref={projectMenuButtonRef}
            onClick={() => setOpenHeaderMenu((m) => (m === 'project' ? null : 'project'))}
            className="w-10 h-10 shrink-0 flex items-center justify-center hover:bg-white/10 rounded-xl transition-colors hover:text-white"
            style={{ color: 'rgba(255, 255, 255, 0.5)' }}
            title="More options"
            aria-label="More options for the project"
          >
            <MaterialSymbol name="more_vert" family="google-symbols" size={24} weight={400} variationSettings='"FILL" 0, "wght" 300' />
          </button>
        </div>

        {/*
          * Center Section: Search.
          *
          * The slot keeps its resting footprint whatever the field is doing; only the row inside it
          * is transformed. That is how Flow does it — open, the field runs the length of the bar
          * and sits *over* the project nav rather than pushing it aside, and the nav simply fades.
          * Animating the slot itself instead would reflow the header and shove the account chip off
          * the right edge, which is the one thing Flow's own layout gets wrong at this width.
          */}
        <div className="flex flex-1 justify-center min-w-0">
          <div
            ref={searchSlotRef}
            className={`relative h-10 w-[480px] max-w-full ${isHeaderVisible ? 'pointer-events-auto' : 'pointer-events-none'}`}
          >
            <div
              ref={searchGroupRef}
              className="absolute left-0 top-0 z-10 flex h-10 items-center"
              style={{
                gap: `${SEARCH_GROUP_GAP}px`,
                width: isSearchOpen && searchGeometryRef.current
                  ? searchGeometryRef.current.width
                  : `min(${SEARCH_GROUP_WIDTH}px, 100%)`,
                transform: `translateX(${isSearchOpen && searchGeometryRef.current ? searchGeometryRef.current.dx : 0}px)`,
                transition: SEARCH_TRANSITION,
              }}
            >
              {/* 40px tall, 16px radius, a 0.8px hairline that never changes — Flow's field has no
                * hover state of its own, only its round buttons do. */}
              <form
                className="flex h-10 min-w-0 flex-1 items-center rounded-2xl border-[0.8px] border-[rgba(218,220,224,0.05)] bg-[rgba(218,220,224,0.1)] px-[10px] backdrop-blur-[80px] search-container"
                style={{ gap: '6px' }}
                onSubmit={(e) => e.preventDefault()}
                onClick={() => { if (!isSearchOpen) openSearch(); }}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isSearchOpen) closeSearch(); else openSearch();
                  }}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[rgba(218,220,224,0.05)] outline-none"
                  style={{ color: isSearchOpen ? '#fff' : 'rgba(218, 220, 224, 0.75)' }}
                  title={isSearchOpen ? 'Close search' : 'Search'}
                >
                  <MaterialSymbol
                    name={isSearchOpen ? 'arrow_back' : 'search'}
                    family="google-symbols"
                    size={20}
                    weight={400}
                    variationSettings={HEADER_ICON_AXES}
                  />
                </button>
                {/* Stretched and padded rather than sized by its line box, which is how Flow's is
                  * built: the input fills the field's 38.4px content height so a click anywhere in
                  * the field lands on the text, not on the form behind it. The text does not move —
                  * a 20px line box centred in the 18.4px left over lands where it did before. */}
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => { if (!isSearchOpen) openSearch(); }}
                  className="min-w-0 flex-1 self-stretch border-none bg-transparent py-[10px] pr-4 text-[16px] font-medium leading-5 text-white outline-none"
                  style={{ fontFamily: PROJECT_NAME_FONT }}
                  placeholder=""
                />
                {isSearchOpen && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSearchQuery('');
                      searchInputRef.current?.focus();
                    }}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white transition-colors hover:bg-[rgba(218,220,224,0.05)] outline-none"
                    title="Clear search"
                  >
                    <MaterialSymbol name="close" family="google-symbols" size={24} weight={400} variationSettings={HEADER_ICON_AXES} />
                  </button>
                )}
              </form>
              {/* The chip shares the field's fill and radius but carries no hairline, and it is the
                * one control that brightens on hover: 0.1 -> 0.15 over 100ms. */}
              <button
                ref={sortFilterButtonRef}
                onClick={() => setOpenHeaderMenu((m) => (m === 'filter' ? null : 'filter'))}
                className="flex h-10 w-[42px] shrink-0 items-center justify-center rounded-2xl bg-[rgba(218,220,224,0.1)] text-white backdrop-blur-[80px] transition-colors duration-100 hover:bg-[rgba(218,220,224,0.15)]"
                title="Filtering and sorting options"
              >
                <MaterialSymbol name="filter_list" family="google-symbols" size={20} weight={400} variationSettings={HEADER_ICON_AXES} />
              </button>
            </div>
          </div>
        </div>

        {/* Right Section. Auto-width for the same reason as the left cluster — the two together are
          * what centre the field. The four icons give way to the open field — Flow pushes them off
          * the right edge instead, with the same result — while the account chip stays put and is
          * what the field stops short of. */}
        <div className={`flex items-center gap-3 shrink-0 justify-end ${isHeaderVisible ? 'pointer-events-auto' : 'pointer-events-none'}`}>
          {/* 40x40 at a 12px radius with 6px between them (a 46px pitch), and 24px glyphs at
            * `"FILL" 0, "wght" 300` — Flow's header group, measured off the live app. */}
          <div className={`flex items-center gap-[6px] transition-opacity duration-200 ${isSearchOpen ? 'opacity-0 pointer-events-none' : ''}`}>
            <button
              ref={addMenuButtonRef}
              onClick={() => setOpenHeaderMenu((m) => (m === 'add' ? null : 'add'))}
              className={HEADER_ICON_BUTTON}
              title="Add media"
              aria-label="Add media menu"
              aria-expanded={openHeaderMenu === 'add'}
            >
              <MaterialSymbol name="add" family="google-symbols" size={24} weight={400} variationSettings={HEADER_ICON_AXES} />
            </button>
            <button className={HEADER_ICON_BUTTON} title="Product help" aria-label="Product help">
              <MaterialSymbol name="help" family="google-symbols" size={24} weight={400} variationSettings={HEADER_ICON_AXES} />
            </button>
            <button
              ref={viewSettingsButtonRef}
              onClick={() => setOpenHeaderMenu((m) => (m === 'settings' ? null : 'settings'))}
              className={HEADER_ICON_BUTTON}
              title="View settings"
              aria-label="Tile grid settings"
            >
              <MaterialSymbol name="settings_2" family="google-symbols" size={24} weight={400} variationSettings={HEADER_ICON_AXES} />
            </button>
            <button
              ref={moreMenuButtonRef}
              onClick={() => setOpenHeaderMenu((m) => (m === 'more' ? null : 'more'))}
              className={HEADER_ICON_BUTTON}
              title="More options"
              aria-label="More options"
            >
              <MaterialSymbol name="more_vert" family="google-symbols" size={24} weight={400} variationSettings={HEADER_ICON_AXES} />
            </button>
          </div>

            <button
              ref={accountButtonRef}
            onClick={() => setIsAccountMenuOpen((open) => !open)}
            className="flex items-center h-11 bg-[#171717] rounded-2xl pl-3 pr-1 gap-2 hover:bg-[#202020] transition-colors border border-transparent hover:border-white/10"
            aria-label="Open account menu"
            >
            <span className="text-xs font-semibold text-gray-300 mr-1 truncate max-w-[100px]">
              {userProfile?.displayName || user?.email?.split('@')[0] || 'Guest'}
            </span>
            <Avatar
              src={userProfile?.photoURL || user?.photoURL}
              name={userProfile?.displayName || user?.email}
              size={32}
            />
          </button>
        </div>
      </header>
      )}

      <AccountMenu
        open={isAccountMenuOpen}
        onClose={() => setIsAccountMenuOpen(false)}
        isAuthenticated={Boolean(user)}
        displayName={userProfile?.displayName || user?.email?.split('@')[0] || 'Guest'}
        email={user?.email || ''}
        photoURL={userProfile?.photoURL || user?.photoURL}
        onSignIn={signInWithGoogle}
        onSignOut={signOut}
      />

      <ViewSettingsMenu
        open={openHeaderMenu === 'settings'}
        onClose={closeHeaderMenu}
        anchorRef={viewSettingsButtonRef}
        settings={viewSettings}
        onChange={setViewSettings}
      />
      <ProjectMenu
        open={openHeaderMenu === 'project'}
        onClose={closeHeaderMenu}
        anchorRef={projectMenuButtonRef}
        onRename={() => {
          projectRenameResolvedRef.current = false;
          setEditingProjectNameValue(projectName);
          setIsEditingProjectName(true);
        }}
        onViewTrash={() => {
          // The Media trash destination is not routed separately yet; keep the menu action
          // explicit and non-destructive until that destination exists.
        }}
        onDelete={() => {
          // Deletion remains owned by the Projects surface, which handles every storage adapter.
        }}
      />
      <MoreMenu
        open={openHeaderMenu === 'more'}
        onClose={closeHeaderMenu}
        anchorRef={moreMenuButtonRef}
        onSettings={() => onOpenSettings?.()}
        leading={viewport === 'phone' ? (
          <>
            {/* keepOpen: the next menu replacing this one is what closes it. */}
            <FlowMatMenuItem icon="settings_2" label="View settings" keepOpen onSelect={() => setOpenHeaderMenu('settings')} />
            <FlowMatMenuItem icon="filter_list" label="Filter and sort" keepOpen onSelect={() => setOpenHeaderMenu('filter')} />
          </>
        ) : undefined}
      />
      {/* Flow's add menu, flush under its button: Upload, New collection, Create character, New scene. */}
      <FlowMatMenu
        open={openHeaderMenu === 'add'}
        onClose={closeHeaderMenu}
        anchor={openHeaderMenu === 'add' && addMenuButtonRef.current ? { kind: 'below', rect: addMenuButtonRef.current.getBoundingClientRect() } : null}
        ignoreRefs={[addMenuButtonRef]}
      >
        <FlowMatMenuItem icon="upload" label="Upload" onSelect={() => fileInputRef.current?.click()} />
        <FlowMatMenuItem icon="folder" label="New collection" onSelect={newCollection} />
        <FlowMatMenuItem icon="account_circle" label="Create character" onSelect={() => openCharacterPage('new')} />
        <FlowMatMenuItem icon="play_movies" label="New scene" onSelect={() => { createEmptyScene(); }} />
      </FlowMatMenu>
      <SortFilterMenu
        open={openHeaderMenu === 'filter'}
        onClose={closeHeaderMenu}
        anchorRef={sortFilterButtonRef}
        value={sortFilter}
        onChange={setSortFilter}
        resultCount={displayMediaItems.length}
      />

      {/* Main Body */}
      <div className="flex flex-1 overflow-hidden relative">
        
        {/* Left Sidebar */}
        {/*
          * Flow's expanded rail: 212x48 rows inset 16px, 16px radius, on a 52.8px pitch, with a
          * 24px glyph 12px in and the label 16px past it at 14px/20px weight 500.
          *
          * Collapsing drops the label and narrows the panel to 80px, which leaves a 48px content
          * column and turns the row into a 48x48 square. The glyph must not move: Flow keeps it
          * at x=28 in both states, so the panel's 16px inset plus half of the 48-24 remainder has
          * to come out at 28 either way. That is why the collapsed row fills its column instead
          * of carrying padding of its own — 8px of side padding would centre the glyph at 37.
          *
          * Those numbers were hard to come by. Flow's row is an icon button with the label as
          * its *sibling*, and the button itself carries a second, screen-reader-only copy of the
          * label — clipped to 1px, at 11px/16px, and worded differently ("View videos" against
          * the visible "Videos"). Every scrape that looked inside the button found the hidden
          * copy and reported an icon-only rail, which is where the earlier 40px rows and 11px
          * text came from. The visible label has to be found by geometry, not by descent.
          */}
        <MediaSidebar
          collapsed={isSidebarCollapsed}
          onToggleCollapsed={handleToggleLeftSidebar}
          activeTab={activeSidebarTab}
          onNavigate={navigateSidebarTab}
          toolsHref={toolsHref}
          toolHref={dockToolHref}
          navStyle={{
            transform: isHeaderVisible ? 'translateY(0)' : 'translateY(-62px)',
            transition: `transform ${currentSidebarTransitionTiming}`,
          }}
          trashDropActive={dropTarget?.kind === 'trash'}
          dock={toolDock}
          dockOpen={toolDockOpen}
          onToggleDock={() => setDockOpen(!toolDockOpen)}
          onOpenTool={openDockTool}
          onTogglePin={(id) => { togglePin(id); }}
          presentation={railPresentation}
          topInset={viewport === 'tablet' ? 72 : undefined}
          drawerOpen={isNavDrawerOpen}
          onDrawerOpenChange={setIsNavDrawerOpen}
          onHome={() => navigate('/?mode=media')}
        />

        {/* Center Canvas */}
        <main
          ref={attachMainRef}
          onScroll={handleScroll}
          className={`media-main flex-1 bg-transparent relative z-[60] -ml-[3px] pl-[3px] no-scrollbar ${
            renamingItemId ? 'overflow-hidden' : 'overflow-y-scroll'
          }`}
          /* Under a full-window editor the grid is not painted at all, as in Flow, where the
           * editors are pages of their own and the grid is gone. It keeps its layout and scroll. */
          style={activeSceneId || (selectedItem && selectedItem.kind !== 'audio') ? { visibility: 'hidden' } : undefined}
        >
          {/* Custom Overlay Scrollbar */}
          <div className="fixed top-0 bottom-0 right-0 w-[4px] z-[100] overflow-visible pointer-events-none">
            <div 
              ref={customScrollbarThumbRef}
              onMouseDown={handleThumbMouseDown}
              className="absolute right-0 w-[4px] bg-white/10 hover:bg-white/25 rounded-full pointer-events-auto transition-colors duration-150"
              style={{ opacity: 0, height: 0, transform: 'translateY(0px)' }}
            />
          </div>

          {renamingItemId && (
            <div 
              className="fixed inset-0 bg-transparent z-40 cursor-default pointer-events-auto"
              onClick={() => setRenamingItemId(null)}
            />
          )}
          {activeSidebarTab === 'characters' && characters.length > 0 && (
            <CharactersGrid
              characters={characters}
              width={galleryWidth}
              targetHeight={galleryTargetH}
              paddingRight={galleryPaddingRight}
              layoutDuration={isRightSidebarToggling ? 0.78 : 0}
              itemById={(id) => mediaItems.find((m) => m.id === id)}
              onNew={() => openCharacterPage('new')}
              onOpen={(id) => openCharacterPage(id)}
              onFavorite={favoriteCharacter}
              onAddToPrompt={addCharacterToPrompt}
              onCopy={copyCharacter}
              onRename={renameCharacter}
              onDelete={removeCharacter}
            />
          )}
          {activeSidebarTab !== 'characters' && displayMediaItems.length > 0 && (batchMode ? (
            <div className="media-gallery-frame pt-[72px] pb-44 w-full" style={{ paddingRight: `${galleryPaddingRight}px` }}>
              <BatchView
                tiles={batchTiles}
                gridSize={viewSettings.gridSize}
                keyOf={batchKeyOf}
                idOf={tileIdOf}
                aspectOf={tileAspect}
                renderTile={renderBatchTile}
                renderInfo={renderBatchInfo}
              />
            </div>
          ) : (
            <div
              className="media-gallery-frame flex flex-wrap gap-3 pt-[72px] pb-44 w-full"
              style={isNarrow ? { paddingRight: `${galleryPaddingRight}px`, gap: `${galleryGap}px` } : { paddingRight: `${galleryPaddingRight}px` }}
            >
              {galleryLayoutItems.map(renderGalleryTile)}
            </div>
          ))}
        </main>
      </div>

      {/* Centered Flower Empty State */}
      {(!isInitialLoading || isInitialLoadingFadingOut) && displayMediaItems.length === 0 && activeSidebarTab !== 'characters' && (
        <div 
          className="media-empty-state absolute top-[48%] flex flex-col items-center justify-center pointer-events-none z-10 transition-all"
          style={{
            left: (isAgentSidebarOpen || !!activeMusicItem) ? 'calc(50% - 178px)' : '50%',
            transform: 'translate(-50%, -50%)',
            transitionDuration: '0.5s',
            transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)'
          }}
        >
          <div className="relative mb-5 text-gray-500/20 w-[110px] h-[149px] flex items-center justify-center overflow-visible">
            <div
              style={{
                position: 'absolute',
                width: '8px',
                height: '8px',
                left: '50%',
                top: '50%',
                transform: 'translate(-97.6px, -98.8px) scale(0.6)',
                boxShadow: SUNFLOWER_BOX_SHADOW
              } as any}
            />
          </div>

          <p className="text-lg text-gray-500 font-medium">
            {activeSidebarTab === 'uploads' ? 'Start uploading or drop media' : 'Start creating or drop media'}
          </p>
        </div>
      )}

      {/* Bottom Prompt Bar */}
      <div 
        className="media-composer absolute bottom-8 left-1/2 w-full max-w-[600px] z-[80] transition-all duration-300 ease-in-out prompt-container-box"
        style={{
          opacity: (isAgentSidebarOpen || !!activeMusicItem) ? 0 : 1,
          transform: 'translate(-50%, 0px)',
          pointerEvents: (isAgentSidebarOpen || !!activeMusicItem) ? 'none' : 'auto'
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <AssetMenuModal
          isOpen={isAssetMenuOpen && assetMenuSource === 'main'}
          onClose={() => setIsAssetMenuOpen(false)}
          buttonRef={assetMenuPlusRef}
          openedFrom="main"
          projectName={projectName}
          mediaItems={mediaItems}
          onFileSelect={() => fileInputRef.current?.click()}
          onAddPrompt={(assetId, assetUrl, assetTitle, assetKind) => {
            if (assetUrl) {
              setAttachments(prev => {
                if (prev.some(att => att && att.url === assetUrl)) return prev;
                const next = [...prev, {
                  id: assetId,
                  url: assetUrl,
                  name: assetTitle || 'Attached Image',
                  kind: assetKind || 'image'
                }];
                return (modelMode === 'video' && videoMode === 'frames') ? next.slice(0, 2) : next;
              });
            } else if (assetTitle) {
              const prev = promptStore.get();
              const separator = prev.trim() ? ' ' : '';
              promptStore.set(`${prev.trim()}${separator}[${assetTitle}]`);
            }
          }}
        />
        <SceneMediaPicker
          open={mentionOpen}
          mode="composer"
          anchor={mentionAnchor}
          items={mentionItems}
          characters={characters}
          itemById={mentionItemById}
          projectName={projectName || 'Untitled project'}
          projectId={persistProjectId || undefined}
          projects={mentionOpen ? sceneHost.listProjects() : []}
          loadProjectMedia={sceneHost.loadProjectMedia}
          adopt={(m) => m}
          onClose={closeMention}
          onImport={importSceneFiles}
          onConfirm={mentionMedia}
          onPickCharacter={mentionCharacter}
        />
        {/*
          * Geometry, colour and type here are measured off Google Flow's composer, not
          * chosen — see tools/ui-research/captures/flow/composer-grid/ (41-composer-grid.cjs).
          * Flow's edge is a real 1px border (0.8px at 1.25x), which is part of its 97.6px
          * resting height: border, 12px, the 36px text row, an 8px gap, the 32px control row,
          * 8px, border.
          */}
        {/* While a tile is dragged, Flow swaps the whole composer for its drop zone (PromptDropZone):
          * the shell goes, and the zone's own slots carry the fill, edge and hover. */}
        <div 
          className={`relative rounded-[24px] flex flex-col prompt-container-box ${
            draggingItemId ? 'bg-transparent border-none shadow-none p-0' : 'backdrop-blur-[40px]'
          }`}
          onFocus={() => setIsComposerFocused(true)}
          onBlur={() => setIsComposerFocused(false)}
          style={{
            ...(draggingItemId ? {} : {
              backgroundColor: 'rgba(22, 23, 24, 0.9)',
              padding: '12px 8px 8px 10px',
              gap: '8px',
              minHeight: '90px',
              maxHeight: '460px',
              overflow: 'hidden',
              /* Focus brightens the edge from 0.05 to 0.15, with no transition and no shadow. */
              border: `1px solid ${isComposerFocused ? 'rgba(218, 220, 224, 0.15)' : 'rgba(218, 220, 224, 0.05)'}`,
            }),
            fontFamily: "'Google Sans Text', 'Inter', system-ui, -apple-system, sans-serif",
          }}
        >
          {!draggingItemId && isAgentActive && agentAnimationKey > 0 && (
            <div 
              key={`toggle-${agentAnimationKey}`}
              className="absolute inset-0 z-30 pointer-events-none rounded-[22px] overflow-hidden"
            >
              <svg width="100%" height="100%" className="absolute inset-0 mix-blend-screen animate-[parent-fade_1.8s_ease-in-out_forwards]">
                <filter id="glow-blur">
                  <feGaussianBlur stdDeviation="11" />
                </filter>
                <g filter="url(#glow-blur)">
                  <rect x="0" y="0" width="100%" height="100%" rx="22" ry="22" fill="none" stroke="#82858b" strokeWidth="13"
                        pathLength="100" strokeDasharray="60 40" className="animate-[snake-stroke_1.8s_linear_forwards]" style={{ animationDelay: '0.1s', opacity: 0.15 }} strokeLinecap="round" />
                  <rect x="0" y="0" width="100%" height="100%" rx="22" ry="22" fill="none" stroke="#82858b" strokeWidth="13"
                        pathLength="100" strokeDasharray="60 40" className="animate-[snake-stroke_1.8s_linear_forwards]" style={{ animationDelay: '0.05s', opacity: 0.4 }} strokeLinecap="round" />
                  <rect x="0" y="0" width="100%" height="100%" rx="22" ry="22" fill="none" stroke="#82858b" strokeWidth="13"
                        pathLength="100" strokeDasharray="60 40" className="animate-[snake-stroke_1.8s_linear_forwards]" style={{ animationDelay: '0s', opacity: 0.9 }} strokeLinecap="round" />
                </g>
              </svg>
            </div>
          )}

          <AnimatePresence>
            {!draggingItemId && isAgentActive && isAgentGenerating && (
              <motion.div 
                key="thinking"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5 }}
                className="absolute inset-0 z-30 pointer-events-none rounded-[22px] overflow-hidden"
              >
                <svg width="100%" height="100%" className="absolute inset-0 mix-blend-screen opacity-80">
                  <filter id="glow-blur-thinking">
                    <feGaussianBlur stdDeviation="11" />
                  </filter>
                  <g filter="url(#glow-blur-thinking)">
                    <rect x="0" y="0" width="100%" height="100%" rx="22" ry="22" fill="none" stroke="#82858b" strokeWidth="13"
                          pathLength="100" strokeDasharray="60 40" className="animate-[btn-snake-dynamic_2.5s_infinite]" style={{ animationDelay: '0.1s', opacity: 0.15 }} strokeLinecap="round" />
                    <rect x="0" y="0" width="100%" height="100%" rx="22" ry="22" fill="none" stroke="#82858b" strokeWidth="13"
                          pathLength="100" strokeDasharray="60 40" className="animate-[btn-snake-dynamic_2.5s_infinite]" style={{ animationDelay: '0.05s', opacity: 0.4 }} strokeLinecap="round" />
                    <rect x="0" y="0" width="100%" height="100%" rx="22" ry="22" fill="none" stroke="#82858b" strokeWidth="13"
                          pathLength="100" strokeDasharray="60 40" className="animate-[btn-snake-dynamic_2.5s_infinite]" style={{ animationDelay: '0s', opacity: 0.9 }} strokeLinecap="round" />
                  </g>
                </svg>
              </motion.div>
            )}
          </AnimatePresence>

          {draggingItemId !== null ? (
            <PromptDropZone frames={isFramesMode} target={dropTarget} count={dragIdsRef.current.length} />
          ) : (
            <>
          {/* The ingredient previews are drawn in the body, outside the shell that clips its
            * overflow. A character ingredient's card sits 6px above its chip; its padding bridges
            * the gap. */}
          {!isBackground && hoveredAttachmentRect && hoveredAttachmentCharacterId && createPortal(
            <div
              style={{
                position: 'fixed',
                left: hoveredAttachmentRect.left + hoveredAttachmentRect.width / 2,
                top: hoveredAttachmentRect.top,
                transform: 'translate(-50%, -100%)',
                zIndex: 1000,
              }}
              className="pointer-events-auto pb-[6px]"
              onMouseEnter={() => {
                if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
              }}
              onMouseLeave={() => {
                setHoveredAttachmentUrl(null);
                setHoveredAttachmentRect(null);
              }}
            >
              <CharacterIngredientCard
                thumbnail={hoveredCharacterImages.find((m) => m.id === hoveredCharacter?.portraitId)?.url ?? (hoveredAttachmentUrl || undefined)}
                imageCount={hoveredCharacterImages.length}
                hasVoice={!!hoveredCharacter?.voice}
              />
            </div>,
            document.body,
          )}
          {!isBackground && hoveredAttachmentUrl && hoveredAttachmentRect && !hoveredAttachmentCharacterId && createPortal(
            <div 
              style={{
                position: 'fixed',
                left: hoveredAttachmentRect.left + hoveredAttachmentRect.width / 2,
                top: hoveredAttachmentRect.shellTop,
                transform: 'translate(-50%, -100%)',
                zIndex: 1000,
              }}
              className="pointer-events-auto"
              onMouseEnter={() => {
                if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
              }}
              onMouseLeave={() => {
                setHoveredAttachmentUrl(null);
                setHoveredAttachmentRect(null);
                setHoveredAttachmentIsEndFrame(false);
              }}
            >
              <div className="shadow-2xl overflow-hidden preview-fade-in relative rounded-[18px] border-[5px] border-[#444c57] bg-[#121214]">
                <img 
                  src={hoveredAttachmentUrl} 
                  className={`max-h-[320px] max-w-[400px] object-contain block ${hoveredAttachmentIsEndFrame && (videoModel === 'omni-flash' || videoModel === 'omni-flash-1.1') ? 'grayscale' : ''}`} 
                />
                {hoveredAttachmentIsEndFrame && (videoModel === 'omni-flash' || videoModel === 'omni-flash-1.1') && (
                  <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center p-4 gap-2 text-center select-none">
                    <div className="w-8 h-8 flex items-center justify-center text-white">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-8 h-8">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" strokeLinecap="round" />
                      </svg>
                    </div>
                    <span className="text-[14px] font-bold text-white tracking-wide">
                      This model doesn't support end frame
                    </span>
                    <span className="text-[11px] font-normal text-white/60 max-w-[200px]">
                      Omni Flash is a conversational model and cannot interpolate between start and end frames.
                    </span>
                  </div>
                )}
              </div>
              {/* Invisible bridge to cover prompt box padding gap */}
              <div className="absolute top-full left-1/2 -translate-x-1/2 w-16 h-[24px] bg-transparent" />
            </div>,
            document.body,
          )}
        

          <input 
            type="file" 
            multiple 
            accept="image/*,video/*,audio/*"
            className="hidden" 
            ref={fileInputRef} 
            onChange={handleFileSelect} 
          />

          {/* Attachments Area */}
          {/* `hidden` when empty, not merely zero-height: the shell is a flex column with an
            * 8px gap, and a collapsed-but-present child still earns its gap — which would make
            * the resting box 8px taller than Flow's 97.6px. */}
          <div className={`grid transition-[grid-template-rows,margin-bottom] duration-[350ms] ease-in-out ${(hasActiveAttachments || (modelMode === 'video' && videoMode === 'frames')) ? 'grid-rows-[1fr] mb-0' : 'grid-rows-[0fr] mb-0 hidden'}`}>
            <div className="overflow-hidden">
              {showFramesPlaceholders ? (
                /* Flow's frame row: 56px Start and End chips 8px in, the swap button between
                 * them, 4px apart, and 4px under them before the box's gap. */
                <div ref={assetMenuPlusRef as React.RefObject<HTMLDivElement>} className="flex items-center gap-[4px]" style={{ padding: '0 8px 4px 8px' }}>
                  {renderFrameSlot(0)}
                  <button
                    type="button"
                    aria-label="Swap frames"
                    title="Swap frames"
                    onClick={() => setAttachments((prev) => (prev[0] || prev[1] ? [prev[1], prev[0]] as ImageAttachment[] : prev))}
                    className="w-[34px] h-[34px] shrink-0 flex items-center justify-center rounded-[12px] text-white bg-transparent hover:bg-white/5 transition-colors outline-none"
                  >
                    <MaterialSymbol name="swap_horiz" family="google-symbols" size={18} weight={400} variationSettings='"FILL" 0, "wght" 400' />
                  </button>
                  {renderFrameSlot(1)}
                </div>
              ) : (
                <div
                  /* 50px thumbs at radius 12 with 4px gaps, wrapping rather than scrolling
                   * sideways — measured off Flow's composer. 4px under the thumbs, then the
                   * box's 8px gap, as Flow's. */
                  className="flex flex-wrap gap-[4px] overflow-y-auto no-scrollbar"
                  style={{ padding: '0 16px 4px 8px' }}
                >
                  {attachments.filter(Boolean).map((att) => (
                    <div 
                      key={att.id} 
                      onMouseEnter={(e) => {
                        if (isModelMenuOpen || isAssetMenuOpen) return;
                        handleAttachmentMouseEnter(e, att.url, false, att.characterId);
                      }}
                      onMouseLeave={handleAttachmentMouseLeave}
                      className={`composer-ingredient relative group flex-shrink-0 transition-all duration-200 ${removingIds.has(att.id) ? 'opacity-0 scale-90' : 'opacity-100 scale-100 animate-in fade-in zoom-in-95'}`}
                    >
                      <div className="relative w-[50px] h-[50px]">
                        <div className="w-[50px] h-[50px] rounded-[12px] overflow-hidden bg-[#1c1c1e]">
                          {att.characterId && !att.url ? (
                            <div className="composer-ingredient-placeholder"><FlowIcon name="face" size={18} /></div>
                          ) : att.kind === 'video' ? (
                            <video src={att.url} className="w-full h-full object-cover" muted loop playsInline />
                          ) : (
                            <img src={att.url} alt={att.name} className="w-full h-full object-cover" />
                          )}
                        </div>
                        {att.characterId && (
                          <span className="composer-type-badge" aria-hidden><FlowIcon name="accessibility_new" size={16} /></span>
                        )}
                        <button 
                          onClick={() => removeAttachment(att.id)}
                          aria-label="Remove ingredient"
                          /* Flow's hover-icon-overlay: background-state-50 and the cancel glyph. */
                          style={{ backgroundColor: 'rgba(22, 23, 24, 0.5)' }}
                          className={`absolute inset-0 w-[50px] h-[50px] flex items-center justify-center rounded-[12px] text-white transition-opacity duration-200 z-[60] ${
                            hoveredAttachmentUrl === att.url ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 hover:opacity-100'
                          }`}
                        >
                          <FlowIcon name="cancel" size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <style>{`
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
            
            /* Suppress hovers and clicks on sidebars, prompt box, links, and buttons while actively drag-selecting */
            .selecting-mode button,
            .selecting-mode aside,
            .selecting-mode a,
            .selecting-mode [role="button"],
            .selecting-mode .prompt-container-box,
            .selecting-mode .gallery-tile {
              pointer-events: none !important;
              user-select: none !important;
            }

            .no-scrollbar::-webkit-scrollbar {
              display: none;
            }
            .sleek-scrollbar::-webkit-scrollbar {
              width: 8px;
              height: 8px;
            }
            .sleek-scrollbar::-webkit-scrollbar-track {
              background: transparent;
            }
            .sleek-scrollbar::-webkit-scrollbar-thumb {
              background: rgba(255, 255, 255, 0.12);
              border-radius: 99px;
              border: 2px solid transparent;
              background-clip: padding-box;
            }
            .sleek-scrollbar::-webkit-scrollbar-thumb:hover {
              background: rgba(255, 255, 255, 0.25);
              border: 2px solid transparent;
              background-clip: padding-box;
            }
            .sleek-scrollbar.hide-scrollbar-thumb::-webkit-scrollbar-thumb {
              background: transparent !important;
            }
            .sleek-scrollbar.hide-scrollbar-thumb::-webkit-scrollbar-thumb:hover {
              background: transparent !important;
            }
            @keyframes quickFadeIn {
              0% { opacity: 0; }
              100% { opacity: 1; }
            }
            .preview-fade-in {
              animation: quickFadeIn 230ms ease-out forwards;
            }
            @keyframes shimmer {
              0% { background-position: 200% 0; }
              100% { background-position: -200% 0; }
            }
            @keyframes snake-stroke {
              0% { 
                stroke-dashoffset: 85;
                animation-timing-function: cubic-bezier(0.4, 0, 0.8, 1);
              }
              29% { 
                stroke-dashoffset: 68;
                animation-timing-function: linear;
              }
              52% { 
                stroke-dashoffset: 13;
                animation-timing-function: cubic-bezier(0.25, 1, 0.5, 1);
              }
              100% { 
                stroke-dashoffset: -42; 
              }
            }
            @keyframes parent-fade {
              0% { opacity: 0; }
              35% { opacity: 0.80; }
              75% { opacity: 0.80; }
              100% { opacity: 0; }
            }
            /* The Agent pill's border light: a conic gradient rotated once every 3.5s,
               running continuously while Agent is active. Three layers at different insets,
               blurs and cone widths; the third inverts the gradient.

               The ::before is 300% of its layer at -100%/-100% so the gradient's centre sits
               on the layer's centre and the rotating square never uncovers a corner. */
            @keyframes cone-spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
            .cone-layer {
              position: absolute;
              border-radius: 15px;
              overflow: hidden;
              pointer-events: none;
              z-index: 0;
              transition: opacity 100ms ease-in-out;
            }
            .cone-layer::before {
              content: '';
              position: absolute;
              top: -100%;
              left: -100%;
              width: 300%;
              height: 300%;
              animation: cone-spin 3.5s linear infinite;
              background: conic-gradient(
                from 0deg,
                transparent calc(180deg - var(--cone-size)),
                var(--cone-color) 180deg,
                transparent calc(180deg + var(--cone-size)),
                transparent 360deg
              );
            }
            .cone-layer--inverted::before {
              background: conic-gradient(
                from 0deg,
                var(--cone-color) calc(180deg - var(--cone-size)),
                transparent 180deg,
                var(--cone-color) calc(180deg + var(--cone-size)),
                var(--cone-color) 360deg
              );
            }
            /*
             * One custom property drives the whole pill. --pill-bg sets the inner fill, and
             * --cone-color derives from it, so the fill, the ring and the glow cannot disagree
             * on colour in any state — which is what stops a boundary appearing between the
             * white centre and the ring when the pill retints.
             */
            .agent-pill {
              --cone-color: var(--pill-bg);
              transition: background-color 100ms ease-in-out;
            }
            .agent-pill > span {
              background-color: var(--pill-bg);
              transition: background-color 100ms ease-in-out, color 100ms ease-in-out,
                box-shadow 100ms ease-in-out;
            }
            /* Idle: the button carries the fill and the inner stays clear, so the 2px ring and
               the centre are one flat tone. */
            .agent-pill--idle {
              --pill-bg: rgba(218, 220, 224, 0.05);
              background-color: var(--pill-bg);
            }
            .agent-pill--idle > span { background-color: transparent; color: rgba(218, 220, 224, 0.75); }
            .agent-pill--idle:hover { --pill-bg: rgba(218, 220, 224, 0.1); }
            /*
             * Active: the button is transparent and the inner is the light shape. The inner's
             * box-shadow — same colour, 1px blur, 1px spread — fills the 2px ring underneath
             * the cone layers, so the ring stays lit through the whole rotation and the cones
             * read as a hotspot travelling around a lit border. Without it the ring is only
             * the cones, and goes black wherever the gradient is transparent, which showed up
             * as a thin rotating streak instead of a glow.
             */
            .agent-pill--active { --pill-bg: #f1f3f4; }
            .agent-pill--active > span { box-shadow: 0 0 1px 1px var(--cone-color); color: rgb(0, 0, 0); }
            /* Hover retints that single variable and drops the cones out, so fill, ring and
               glow all move together. */
            .agent-pill--active:hover {
              --pill-bg: rgba(218, 220, 224, 0.75);
              background-color: var(--pill-bg);
            }
            .agent-pill--active:hover .cone-layer { opacity: 0; }
            @keyframes btn-snake {
              0% { stroke-dashoffset: 0; }
              100% { stroke-dashoffset: -100; }
            }
            @keyframes btn-snake-dynamic {
              0% { 
                stroke-dashoffset: 0;
                animation-timing-function: cubic-bezier(0.7, 0.2, 0.2, 0.8);
              }
              100% { 
                stroke-dashoffset: -100; 
              }
            }
            @keyframes btn-blur-travel {
              0% { left: 18px; top: 0px; }
              30% { left: calc(100% - 18px); top: 0px; }
              34% { left: calc(100% - 5px); top: 5px; }
              38% { left: 100%; top: 18px; }
              42% { left: calc(100% - 5px); top: calc(100% - 5px); }
              46% { left: calc(100% - 18px); top: 100%; }
              76% { left: 18px; top: 100%; }
              80% { left: 5px; top: calc(100% - 5px); }
              84% { left: 0px; top: 18px; }
              88% { left: 5px; top: 5px; }
              92% { left: 18px; top: 0px; }
              100% { left: 18px; top: 0px; }
            }
            .top-fade {
              mask-image: linear-gradient(to bottom, transparent 0%, black 32px, black 100%);
              -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 32px, black 100%);
            }
            .bottom-fade {
              mask-image: linear-gradient(to bottom, black 0%, black calc(100% - 32px), transparent 100%);
              -webkit-mask-image: linear-gradient(to bottom, black 0%, black calc(100% - 32px), transparent 100%);
            }
            .both-fade {
              mask-image: linear-gradient(to bottom, transparent 0%, black 32px, black calc(100% - 32px), transparent 100%);
              -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 32px, black calc(100% - 32px), transparent 100%);
            }
            .gallery-tile {
              will-change: transform;
              contain: layout paint;
            }
            .gallery-tile.overflow-visible {
              contain: none !important;
            }
            .gallery-tile:hover img, .gallery-tile:hover video {
              transform: scale(1) !important;
            }
          `}</style>

          {visibleGenerationError && !selectedItem && (
            <PromptNotice
              notice={visibleGenerationError}
              onDismiss={() => setGenerationError(null)}
              onOpenSettings={openModelSettings}
            />
          )}

          {/* Flow's text row: 4px above, 12px below, 16px to the right of the caret, and a
            * 27px floor. Those paddings are what make the resting box 94px rather than 90. */}
          <div
            className="flex items-start w-full flex-1"
            style={{ padding: '4px 16px 12px 0', minHeight: '27px' }}
          >
            {isAgentGenerating ? (
              <div className="w-full flex items-start min-h-[24px]">
                <AgentStatusText agent={mediaAgent} className="text-[14px] font-medium pl-1 py-0.5" />
              </div>
            ) : (
              <PromptEditor
                ref={promptEditorRef}
                store={promptStore}
                isAgentActive={isAgentActive}
                onSubmit={handleGenerate}
                onPasteFiles={processUploads}
                validMentionIds={validMentionIds}
                onMentionStart={openMention}
              />
            )}
            {isAgentActive ? (
              <div
                /* Flow places these 8px from the shell's top and right edges, above the
                 * ingredient row when there is one: positioned on the shell, not this row.
                 * 4px between them. The clear button is deliberately dimmer than the expand
                 * button. */
                className="absolute right-2 top-2 flex items-center gap-1"
              >
                {/* Clear: the text and the ingredients, shown while either is there. */}
                <PromptValue store={promptStore}>
                  {(prompt) => (prompt || hasActiveAttachments) && !isAgentGenerating && (
                    <button
                      onClick={() => { promptStore.set(''); setAttachments([]); }}
                      style={{ color: 'rgba(218, 220, 224, 0.5)' }}
                      className="w-8 h-8 shrink-0 flex items-center justify-center p-1.5 rounded-full transition-colors hover:text-white hover:bg-white/5 cursor-pointer outline-none focus:outline-none focus:ring-0"
                      title="Clear prompt"
                    >
                      <MaterialSymbol name="close" family="google-symbols" size={16} weight={400} variationSettings='"FILL" 0, "wght" 400' />
                    </button>
                  )}
                </PromptValue>
                
                {/* Expand. Flow's glyph is `expand_content` — two opposed arrows in corner
                  * brackets, not the pair of bare corner brackets this used to draw. */}
                <button 
                  onClick={() => setIsAgentSidebarOpen(true)}
                  style={{ color: 'rgba(218, 220, 224, 0.75)' }}
                  className="w-8 h-8 shrink-0 flex items-center justify-center p-1.5 rounded-full transition-colors hover:text-white hover:bg-white/5 cursor-pointer outline-none focus:outline-none focus:ring-0"
                  title="Expand"
                >
                  <MaterialSymbol name="expand_content" family="google-symbols" size={20} weight={400} variationSettings='"FILL" 1' />
                </button>
              </div>
            ) : (
              <PromptValue store={promptStore}>
                {(prompt) => (prompt || hasActiveAttachments) && (
                  <button
                    onClick={() => { promptStore.set(''); setAttachments([]); }}
                    style={{ color: 'rgba(218, 220, 224, 0.5)' }}
                    /* With the agent off there is no expand button, and Flow does not shift the clear
                      * button left to compensate — it puts it in that same top-right corner slot, 32x32
                      * with both edges 8px inside the shell, above the ingredient row when there is one.
                      * Like Flow's, it clears the ingredients with the text.
                      *
                      * This was an 18px lucide X at right-[-4px], which is the whole bug — a smaller box
                      * pinned to a different edge, so the glyph's centre sat 13px from the right and 17px
                      * down where Flow's is 24 and 24. Same button as the agent-on branch above now, which
                      * is why that one already looked right.
                      *
                      * The textarea's 20px paddingRight is deliberately left alone: it wraps text at 44px
                      * from the shell's right and this button's left edge is at 40px, so there is a 4px
                      * gap. Flow wraps at 32px against the same 40px edge, so Flow's own first line can
                      * slide under its X by up to 8px; copying that would be copying a defect. */
                    className="absolute right-2 top-2 w-8 h-8 shrink-0 flex items-center justify-center p-1.5 rounded-full transition-colors hover:text-white hover:bg-white/5 cursor-pointer outline-none focus:outline-none focus:ring-0"
                    title="Clear prompt"
                  >
                    <MaterialSymbol name="close" family="google-symbols" size={16} weight={400} variationSettings='"FILL" 0, "wght" 400' />
                  </button>
                )}
              </PromptValue>
            )}
          </div>
          
          {/* Control row: 32px tall, Flow's bottom-controls, 8px between the controls on the left
            * and 4px between the settings and the send button. The shell's 8px gap separates it
            * from the text row above, so this carries no top margin of its own. */}
          <div className="flex items-center justify-between h-8">
            
            {/* Left Controls */}
            <div className="flex items-center gap-[8px] relative">
              {/* Flow has no add button in Frames mode: the frame chips open the menu. */}
              {!isFramesMode && (
                <button
                  ref={assetMenuPlusRef as React.RefObject<HTMLButtonElement>}
                  disabled={isAgentGenerating}
                  aria-label="Add ingredients to the prompt box"
                  onClick={(e) => (mentionOpen ? closeMention() : openAddMenu(e.currentTarget))}
                  style={{ color: 'rgba(218, 220, 224, 0.75)' }}
                  /* Flow's add button rests on the 5% foreground fill. */
                  className={`w-8 h-8 shrink-0 flex items-center justify-center rounded-full transition-colors outline-none bg-[rgba(218,220,224,0.05)] ${isAgentGenerating ? 'opacity-40 cursor-not-allowed' : 'hover:text-white hover:bg-[rgba(218,220,224,0.1)] cursor-pointer'}`}
                >
                  {/* Flow's thin 20px add, which turns into close while the add menu is open. */}
                  <MaterialSymbol
                    name={mentionOpen || (isAssetMenuOpen && assetMenuSource === 'main') ? 'close' : 'add'}
                    family="google-symbols"
                    size={20}
                    weight={200}
                    variationSettings='"FILL" 0, "wght" 200'
                  />
                </button>
              )}
              <button 
                onClick={() => {
                  if (isAgentGenerating) return;
                  const nextActive = !isAgentActive;
                  setIsAgentActive(nextActive);
                  if (nextActive) {
                    setAgentAnimationKey(prev => prev + 1);
                  }
                }}
                /* 32px pill holding 2px of padding, with a 28px inner that carries the fill
                 * and 16px of its own horizontal padding around an 11px/16px weight-500
                 * label. Active, the button is transparent and the inner is the light shape;
                 * the 2px gap between them is the ring the cone layers light up. */
                className={`agent-pill inline-flex items-center justify-center h-8 shrink-0 rounded-[15px] border-0 relative z-40 p-[2px] ${
                  isAgentActive ? 'agent-pill--active' : 'agent-pill--idle'
                }`}
              >
                <span
                  /* The cone layers live INSIDE this element, not the button. Their insets
                   * are measured from its box, which is what keeps them 1-2px larger than
                   * the white fill rather than 2px larger than the whole button — off the
                   * button they sat too far out and the blur bled into a halo. */
                  className="relative flex items-center justify-center h-7 gap-[2px] rounded-[15px] px-4 py-1.5 text-[11px] leading-4 font-medium"
                >
                  {isAgentActive && (
                    <>
                      <span className="cone-layer" style={{ inset: '-2px', filter: 'blur(1.5px)', ['--cone-size' as string]: '90deg' }} />
                      <span className="cone-layer" style={{ inset: '-1px', filter: 'blur(1px)', ['--cone-size' as string]: '180deg' }} />
                      <span className="cone-layer cone-layer--inverted" style={{ inset: '-2px', filter: 'blur(0px)', ['--cone-size' as string]: '120deg' }} />
                    </>
                  )}
                  <span className="relative z-[2]">Agent</span>
                </span>
              </button>
            </div>

            {/* Right Controls */}
            <div className="flex items-center gap-[4px] relative">
              {isAgentActive ? (
                /* 5px between these two, so they read as one run of controls with the send
                 * button. Both are 32px squares, the control row's height. */
                <div className="flex items-center gap-[5px]" key="agent-buttons-wrapper">
                  {/* Agent Instructions. `article_spark` is the only glyph here that Flow
                    * draws unfilled, so it takes FILL 0 while the rest take FILL 1. */}
                  <button
                    key="agent-docs-btn"
                    style={{ color: 'rgba(218, 220, 224, 0.75)' }}
                    className="flex items-center justify-center w-8 h-8 shrink-0 p-1.5 rounded-full transition-colors outline-none focus:outline-none focus:ring-0 active:scale-[0.93] hover:bg-white/5 hover:text-white cursor-pointer"
                    title="Agent Instructions"
                  >
                    {/* No variation settings at all, which is what Flow sets here — FILL is 0 by
                      * default, and leaving the property off keeps the two literally identical. */}
                    <MaterialSymbol name="article_spark" family="google-symbols" size={18} weight={400} variationSettings="" />
                  </button>

                  {/* Settings */}
                  <button
                    key="agent-settings-btn"
                    style={{ color: 'rgba(218, 220, 224, 0.75)' }}
                    className="flex items-center justify-center w-8 h-8 shrink-0 p-1.5 rounded-full transition-colors outline-none focus:outline-none focus:ring-0 active:scale-[0.93] hover:bg-white/5 hover:text-white cursor-pointer"
                    title="Settings"
                  >
                    <MaterialSymbol name="tune" family="google-symbols" size={18} weight={400} variationSettings='"FILL" 1' />
                  </button>
                </div>
              ) : (
                <div className="relative" ref={menuRef} key="model-selector-wrapper">
                  <button
                    key="model-selector-btn"
                    onClick={() => (isModelMenuOpen ? setIsModelMenuOpen(false) : openModelMenu())}
                    /* Flow's settings trigger: 32px, label-small at 0.096px tracking, 4px gaps. */
                    className="flex items-center h-8 transition-colors rounded-[15px] px-3 gap-1 outline-none"
                    style={{
                      background: isModelMenuOpen ? 'rgba(218, 220, 224, 0.15)' : 'rgba(218, 220, 224, 0.05)',
                      color: 'rgba(218, 220, 224, 0.75)',
                      fontFamily: '"Google Sans Text", sans-serif',
                      fontSize: '0.688rem',
                      fontWeight: 500,
                      lineHeight: '16px',
                      letterSpacing: '0.096px',
                      transition: 'background-color 100ms ease-in-out, filter 100ms ease-in-out, box-shadow 100ms ease-in-out',
                    }}
                  >
                    {/* One run of text, as Flow's: the banana and the name are a space apart. */}
                    <span className="media-settings-label font-medium leading-4 text-[rgba(218,220,224,0.75)]">
                      {modelMode === 'image'
                        ? `${getImageModelName(imageModel).toLowerCase().includes('banana') ? '🍌 ' : ''}${getImageModelName(imageModel)}`
                        : videoModel ? `${getVideoModelDisplayName(videoModel)} · 720p · ${videoDuration}` : 'No video model'}
                    </span>
                    <MaterialSymbol
                      name={flowRatioGlyph(modelMode === 'image' ? (imageRatio || '16:9') : (videoRatio || '16:9'))}
                      family="google-symbols"
                      size={18}
                      weight={400}
                      variationSettings='"FILL" 0, "wght" 400'
                    />
                    <span className="font-medium leading-4 text-[rgba(218,220,224,0.75)]">
                      {(() => { const b = modelMode === 'image' ? imageBatch : videoBatch; return b === '1x' ? 'x1' : b; })()}
                    </span>
                  </button>

                  {createPortal(
                  isModelMenuOpen && menuRect ? (
                    <>
                    {/* Below 961px the panel is a sheet, over a scrim that a tap closes it from. */}
                    {isNarrow && <div className="media-sheet-backdrop" onClick={() => setIsModelMenuOpen(false)} aria-hidden="true" />}
                    {/* Never clips: a model list opens past the panel's top or bottom edge, and clipped it showed
                      * only the models that happened to land inside. The lists are opaque, as their blur
                      * cannot see past this panel's own backdrop filter. */}
                    <div
                      ref={popupRef}
                      style={{
                        position: 'fixed',
                        bottom: menuRect.bottom,
                        right: menuRect.right,
                        fontFamily: "'Google Sans Text', 'Google Sans', sans-serif",
                      }}
                      className={`${isNarrow ? 'media-settings-sheet ' : ''}w-[296px] bg-[rgba(22,23,24,0.9)] backdrop-blur-[40px] rounded-[18px] p-2 flex flex-col gap-1 shadow-[0_16px_32px_-8px_rgba(0,0,0,0.4)] z-[110]`}
                    >
                      {/* flow-prompt-box-settings, in Flow's order: mode, the video's frames/ingredients,
                        * aspect ratio, a rule, the model, its own options, then the output count.
                        * Toggles are 12px/500 Google Sans Text; a picked one is fg-15, except the two
                        * emphasized rows (mode, video type), which go white. */}

                      {/* Top Tabs */}
                      <div className="flex bg-[rgba(218,220,224,0.05)] backdrop-blur-[40px] rounded-[12px] p-0">
                        <button
                          onClick={() => {
                            setModelMode('image');
                            setIsImageModelDropdownOpen(false);
                            setIsVideoModelDropdownOpen(false);
                          }}
                          className={`flex-1 flex h-[34px] items-center justify-center gap-1 px-3 rounded-[12px] transition-colors font-medium text-xs ${modelMode === 'image' ? 'bg-[#f1f3f4] text-[#202124]' : 'text-white hover:bg-white/5'}`}
                        >
                          <MaterialSymbol name="image" family="google-symbols" size={18} weight={400} variationSettings="" />
                          <span className="text-[12px] font-medium">Image</span>
                        </button>
                        <button
                          onClick={() => {
                            setModelMode('video');
                            setIsImageModelDropdownOpen(false);
                            setIsVideoModelDropdownOpen(false);
                          }}
                          className={`flex-1 flex h-[34px] items-center justify-center gap-1 px-3 rounded-[12px] transition-colors font-medium text-xs ${modelMode === 'video' ? 'bg-[#f1f3f4] text-[#202124]' : 'text-white hover:bg-white/5'}`}
                        >
                          <MaterialSymbol name="videocam" family="google-symbols" size={18} weight={400} variationSettings="" />
                          <span className="text-[12px] font-medium">Video</span>
                        </button>
                      </div>

                      <div className="relative w-full flex flex-col">
                      {modelMode === 'image' ? (
                        <div
                          className="w-full flex flex-col gap-1"
                        >
                          {/* Image Aspect Ratios: 42px, an 18px glyph over a 16px label. */}
                          <div className="order-1 flex h-[42px] bg-[rgba(218,220,224,0.05)] backdrop-blur-[40px] rounded-[12px] p-0">
                            {['16:9', '4:3', '1:1', '3:4', '9:16'].map(ratio => (
                               <button
                                 key={ratio}
                                 onClick={() => setImageRatio(ratio)}
                                 className={`flex-1 flex h-[42px] flex-col items-center justify-center rounded-[12px] transition-colors text-white ${imageRatio === ratio ? 'bg-[rgba(218,220,224,0.15)]' : 'hover:bg-white/5'}`}
                               >
                                 <MaterialSymbol name={flowRatioGlyph(ratio)} family="google-symbols" size={18} weight={400} variationSettings="" />
                                 <span className="text-[12px] font-medium leading-4">{ratio}</span>
                               </button>
                            ))}
                          </div>

                          <div className="order-2 h-0 border-t-[0.8px] border-solid border-[rgb(68,71,70)]" role="separator" />

                          {/* Image Multipliers */}
                          <div className="order-5 flex h-[34px] bg-[rgba(218,220,224,0.05)] backdrop-blur-[40px] rounded-[12px] p-0">
                            {['1x', 'x2', 'x3', 'x4'].map(batch => (
                              <button
                                key={batch}
                                onClick={() => setImageBatch(batch)}
                                className={`flex-1 h-[34px] px-3 rounded-[12px] text-[12px] font-medium transition-colors ${imageBatch === batch ? 'bg-[rgba(218,220,224,0.15)] text-white' : 'text-white hover:bg-white/5'}`}
                              >
                                {batch === '1x' ? 'x1' : batch}
                              </button>
                            ))}
                          </div>

                           {/* Dynamic Effort Level Selector (For Supported Models) */}
                           { (imageModel === 'gemini-nano-banana-2.1' || imageModel === 'gemini-3.1-flash-lite-image' || imageModel === 'gpt-image-2') && (
                             <div className="order-4 flex h-[34px] bg-[rgba(218,220,224,0.05)] backdrop-blur-[40px] rounded-[12px] p-0">
                               { imageModel === 'gpt-image-2' ? (
                                 // OpenAI Effort Levels: Standard, Balanced, Reasoning
                                 [
                                   { id: 'low', name: 'Standard' },
                                   { id: 'medium', name: 'Balanced' },
                                   { id: 'high', name: 'Reasoning' }
                                 ].map(eff => (
                                   <button
                                     key={eff.id}
                                     type="button"
                                     onClick={() => setImageEffort(eff.id as any)}
                                   className={`flex-1 h-[34px] px-3 rounded-[12px] text-xs font-medium transition-colors ${imageEffort === eff.id ? 'bg-[rgba(218,220,224,0.15)] text-white' : 'text-white hover:bg-white/5'}`}
                                   >
                                     {eff.name}
                                   </button>
                                 ))
                               ) : (
                                 // Gemini Effort Levels: Standard, Reasoning
                                 [
                                   { id: 'minimal', name: 'Standard' },
                                   { id: 'high', name: 'Reasoning' }
                                 ].map(eff => (
                                   <button
                                     key={eff.id}
                                     type="button"
                                     onClick={() => setImageEffort(eff.id as any)}
                                     className={`flex-1 h-[34px] px-3 rounded-[12px] text-xs font-medium transition-colors ${imageEffort === eff.id ? 'bg-[rgba(218,220,224,0.15)] text-white' : 'text-white hover:bg-white/5'}`}
                                   >
                                     {eff.name}
                                   </button>
                                 ))
                               )}
                             </div>
                           )}

                           {/* Dynamic Quality Selector (For Supported Models) */}
                           { imageModel === 'gpt-image-2' && (
                             <div className="order-4 flex h-[34px] bg-[rgba(218,220,224,0.05)] backdrop-blur-[40px] rounded-[12px] p-0">
                               {['low', 'medium', 'high'].map(qual => (
                                 <button
                                   key={qual}
                                   type="button"
                                   onClick={() => setImageQuality(qual)}
                                   className={`flex-1 h-[34px] px-3 rounded-[12px] text-xs font-medium capitalize transition-colors ${imageQuality === qual ? 'bg-[rgba(218,220,224,0.15)] text-white' : 'text-white hover:bg-white/5'}`}
                                 >
                                   {qual}
                                 </button>
                               ))}
                             </div>
                           )}

                           {/* Dynamic Resolution Selector (For All Image Models: Google & GPT) */}
                           { (imageModel === 'gemini-3-pro-image' || imageModel === 'gemini-nano-banana-2.1' || imageModel === 'gemini-3.1-flash-lite-image' || imageModel === 'gpt-image-2') && (
                             <div className="order-4 flex h-[34px] bg-[rgba(218,220,224,0.05)] backdrop-blur-[40px] rounded-[12px] p-0">
                               {['1k', '2k', '4k'].map(res => (
                                 <button
                                   key={res}
                                   type="button"
                                   onClick={() => setImageResolution(res)}
                                   className={`flex-1 h-[34px] px-3 rounded-[12px] text-xs font-medium uppercase transition-colors ${imageResolution === res ? 'bg-[rgba(218,220,224,0.15)] text-white' : 'text-white hover:bg-white/5'}`}
                                 >
                                   {res}
                                 </button>
                               ))}
                             </div>
                           )}

                          {/* Model Selector: Flow's model-select trigger, fg-10 at 34px. */}
                          <div className="order-3 relative" ref={imageModelDropdownRef}>
                            <button
                              type="button"
                              ref={imageModelButtonRef}
                              onClick={toggleImageModelDropdown}
                              className="w-full h-[34px] flex items-center justify-between bg-[rgba(218,220,224,0.1)] hover:bg-[rgba(218,220,224,0.15)] backdrop-blur-[40px] transition-colors rounded-[12px] px-3 text-[12px] font-medium leading-5 tracking-[0.096px] text-white"
                            >
                              <span className="flex items-center gap-1">
                                {getImageModelName(imageModel).toLowerCase().includes('banana') && <span>🍌</span>}
                                {getImageModelName(imageModel)}
                              </span>
                              <MaterialSymbol
                                name="arrow_drop_down"
                                family="google-symbols"
                                size={18}
                                weight={400}
                                variationSettings=""
                              />
                            </button>

                            {isImageModelDropdownOpen && (
                              <div ref={revealModelList} className={`media-model-list absolute ${imageModelDropDirection === 'down' ? 'top-[calc(100%+4px)]' : 'bottom-[calc(100%+4px)]'} left-0 right-0 bg-[rgb(22,23,24)] rounded-[12px] p-2 flex flex-col gap-1 shadow-2xl z-[120]`}>
                                {imageModels.map(modelOpt => (
                                  <button
                                    key={modelOpt.id}
                                    type="button"
                                    onClick={() => {
                                      setImageModel(modelOpt.id);
                                      setIsImageModelDropdownOpen(false);
                                    }}
                                    className={`w-full h-[34px] text-left px-4 rounded-[12px] text-xs font-medium transition-colors ${imageModel === modelOpt.id ? 'bg-[rgba(218,220,224,0.25)] text-white' : 'text-white hover:bg-white/5'}`}
                                  >
                                    {modelOpt.name}
                                  </button>
                                ))}
                                {imageModels.length === 0 && (
                                  <>
                                    <span className="h-[28px] px-4 flex items-center text-xs text-[#9aa0a6]">No image models added</span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setIsImageModelDropdownOpen(false);
                                        setIsModelMenuOpen(false);
                                        openModelSettings();
                                      }}
                                      className="w-full h-[34px] flex items-center gap-2 text-left px-4 rounded-[12px] text-xs font-medium transition-colors text-white hover:bg-white/5"
                                    >
                                      <Plus size={14} strokeWidth={2} />
                                      Add a model
                                    </button>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div
                          className="w-full flex flex-col gap-1"
                        >
                          {/* Video Tabs */}
                          <div className="flex h-[34px] bg-[rgba(218,220,224,0.05)] backdrop-blur-[40px] rounded-[12px] p-0">
                            <button
                              onClick={() => setVideoMode('frames')}
                              className={`flex-1 flex h-[34px] items-center justify-center gap-1 px-3 rounded-[12px] transition-colors ${videoMode === 'frames' ? 'bg-[#f1f3f4] text-[#202124]' : 'text-white hover:bg-white/5'}`}
                            >
                              <MaterialSymbol name="crop_free" family="google-symbols" size={18} weight={400} variationSettings="" />
                              <span className="text-[12px] font-medium">Frames</span>
                            </button>
                            <button
                              onClick={() => setVideoMode('ingredients')}
                              className={`flex-1 flex h-[34px] items-center justify-center gap-1 px-3 rounded-[12px] transition-colors ${videoMode === 'ingredients' ? 'bg-[#f1f3f4] text-[#202124]' : 'text-white hover:bg-white/5'}`}
                            >
                              <MaterialSymbol name="chrome_extension" family="google-symbols" size={18} weight={400} variationSettings="" />
                              <span className="text-[12px] font-medium">Ingredients</span>
                            </button>
                          </div>

                          {/* Video Aspect Ratios: 16:9 first, as in Flow. */}
                          <div className="order-1 flex h-[42px] bg-[rgba(218,220,224,0.05)] backdrop-blur-[40px] rounded-[12px] p-0">
                             {['16:9', '9:16'].map(ratio => (
                               <button
                                 key={ratio}
                                 onClick={() => setVideoRatio(ratio)}
                                 className={`flex-1 flex h-[42px] flex-col items-center justify-center rounded-[12px] transition-colors text-white ${videoRatio === ratio ? 'bg-[rgba(218,220,224,0.15)]' : 'hover:bg-white/5'}`}
                               >
                                 <MaterialSymbol name={flowRatioGlyph(ratio)} family="google-symbols" size={18} weight={400} variationSettings="" />
                                 <span className="text-[12px] font-medium leading-4">{ratio}</span>
                               </button>
                             ))}
                          </div>

                          <div className="order-2 h-0 border-t-[0.8px] border-solid border-[rgb(68,71,70)]" role="separator" />

                          {/* Video Multipliers */}
                          <div className="order-5 flex h-[34px] bg-[rgba(218,220,224,0.05)] backdrop-blur-[40px] rounded-[12px] p-0">
                            {['1x', 'x2', 'x3', 'x4'].map(batch => (
                              <button
                                key={batch}
                                onClick={() => setVideoBatch(batch)}
                                className={`flex-1 h-[34px] px-3 rounded-[12px] text-[12px] font-medium transition-colors ${videoBatch === batch ? 'bg-[rgba(218,220,224,0.15)] text-white' : 'text-white hover:bg-white/5'}`}
                              >
                                {batch === '1x' ? 'x1' : batch}
                              </button>
                            ))}
                          </div>

                          {/* Video Model Selector */}
                          <div className="order-3 relative" ref={videoModelDropdownRef}>
                            <button
                              type="button"
                              ref={videoModelButtonRef}
                              onClick={toggleVideoModelDropdown}
                              className="w-full h-[34px] flex items-center justify-between bg-[rgba(218,220,224,0.1)] hover:bg-[rgba(218,220,224,0.15)] backdrop-blur-[40px] transition-colors rounded-[12px] px-3 text-[12px] font-medium leading-5 tracking-[0.096px] text-white"
                            >
                              <span>{getVideoModelName(videoModel)}</span>
                              <MaterialSymbol
                                name="arrow_drop_down"
                                family="google-symbols"
                                size={18}
                                weight={400}
                                variationSettings=""
                              />
                            </button>

                            {isVideoModelDropdownOpen && (
                              <div ref={revealModelList} className={`media-model-list absolute ${videoModelDropDirection === 'down' ? 'top-[calc(100%+4px)]' : 'bottom-[calc(100%+4px)]'} left-0 right-0 bg-[rgb(22,23,24)] rounded-[12px] p-2 flex flex-col gap-1 shadow-2xl z-[120]`}>
                                {VIDEO_MODELS.map(modelOpt => (
                                  <button
                                    key={modelOpt.id}
                                    type="button"
                                    onClick={() => {
                                      setVideoModel(modelOpt.id);
                                      setIsVideoModelDropdownOpen(false);
                                    }}
                                    className={`w-full h-[34px] text-left px-4 rounded-[12px] text-xs font-medium transition-colors ${videoModel === modelOpt.id ? 'bg-[rgba(218,220,224,0.25)] text-white' : 'text-white hover:bg-white/5'}`}
                                  >
                                    {modelOpt.name}
                                  </button>
                                ))}
                                {VIDEO_MODELS.length === 0 && (
                                  <>
                                    <span className="h-[28px] px-4 flex items-center text-xs text-[#9aa0a6]">No video models added</span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setIsVideoModelDropdownOpen(false);
                                        setIsModelMenuOpen(false);
                                        openModelSettings();
                                      }}
                                      className="w-full h-[34px] flex items-center gap-2 text-left px-4 rounded-[12px] text-xs font-medium transition-colors text-white hover:bg-white/5"
                                    >
                                      <Plus size={14} strokeWidth={2} />
                                      Add a model
                                    </button>
                                  </>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Video Duration */}
                          <div className="order-4 flex h-[34px] bg-[rgba(218,220,224,0.05)] backdrop-blur-[40px] rounded-[12px] p-0">
                            {videoDurationOptions(videoModel).map(dur => (
                              <button
                                key={dur}
                                onClick={() => setVideoDuration(dur)}
                                className={`flex-1 h-[34px] px-3 rounded-[12px] text-[12px] font-medium transition-colors ${videoDuration === dur ? 'bg-[rgba(218,220,224,0.15)] text-white' : 'text-white hover:bg-white/5'}`}
                              >
                                {dur}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      </div>
                    </div>
                    </>
                  ) : null,
                document.body
                )}
              </div>
              )}
              
              {/* 32px round. Disabled it is the same 5% fill as the other pills with the arrow at
                * 50%; enabled it flips to solid white with an rgb(32,33,36) arrow — Flow's two
                * states. */}
              <PromptValue store={promptStore}>
                {(prompt) => (
                  <button
                    onClick={isAgentGenerating ? () => mediaAgent.stop() : handleGenerate}
                    title={isAgentGenerating ? 'Stop' : undefined}
                    disabled={!isAgentGenerating && !prompt.trim()}
                    className={`flex items-center justify-center w-8 h-8 shrink-0 rounded-full p-1.5 transition-all border-0 ${
                      (!isAgentGenerating && !prompt.trim())
                        ? 'cursor-not-allowed'
                        : 'bg-white hover:bg-zinc-200 cursor-pointer active:scale-95'
                    }`}
                    style={(!isAgentGenerating && !prompt.trim())
                      ? { backgroundColor: 'rgba(218, 220, 224, 0.05)' }
                      : undefined}
                  >
                    {isAgentGenerating ? (
                      <div className="w-[9px] h-[9px] bg-black rounded-[1px]" />
                    ) : (
                      <MaterialSymbol
                        name="arrow_forward"
                        family="google-symbols"
                        size={18}
                        weight={400}
                        variationSettings='"FILL" 0, "wght" 400'
                        style={{ color: !prompt.trim() ? 'rgba(218, 220, 224, 0.5)' : 'rgb(32, 33, 36)' }}
                      />
                    )}
                  </button>
                )}
              </PromptValue>
            </div>

          </div>
            </>
          )}
        </div>
      </div>

      {/* The Scenebuilder. Portalled out of this container, whose mousedown starts the gallery's
        * marquee selection; React still bubbles synthetic events through a portal, so the editor
        * stops them at its root. */}
      {activeSceneId && createPortal(
        <div
          inert={isBackground}
          style={isBackground ? BACKGROUND_OVERLAY_STYLE : undefined}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            e.stopPropagation();
            const t = e.target as HTMLElement;
            if (!t.closest('input, textarea')) e.preventDefault();
          }}
        >
          <EditorBoundary key={activeSceneId} onError={(error) => onEditorFailed(error, closeSceneEditor)}>
            <React.Suspense fallback={null}>
              <SceneBuilder sceneId={activeSceneId} host={sceneHost} />
            </React.Suspense>
          </EditorBoundary>
        </div>,
        document.body,
      )}
      {/* Flow's character pages: New character and a character's own page. Portalled and stopped at
        * the root like the Scenebuilder; the fallback is the pages' own black, so a chunk still
        * loading never shows the grid underneath. */}
      {characterPage && createPortal(
        <div
          inert={isBackground}
          style={isBackground ? BACKGROUND_OVERLAY_STYLE : undefined}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.stopPropagation()}
        >
          <EditorBoundary key={characterPage} onError={(error) => onEditorFailed(error, () => openCharacterPage(null))}>
            <React.Suspense fallback={<div className="cp-page" aria-hidden />}>
              {characterPage === 'new' ? (
                <NewCharacterPage
                  host={characterHost}
                  onClose={() => {
                    // With no characters to list, Flow's Back leaves the Characters tab altogether.
                    if (activeSidebarTab === 'characters' && $characters.get().length === 0) navigate({ pathname: '/media', search: location.search.replace(/[?&]character=[^&]*/, '').replace(/^&/, '?') });
                    else openCharacterPage(null);
                  }}
                  onCreated={(id) => {
                    setCharacterRequest({ page: id, from: location.key });
                    const next = new URLSearchParams(location.search);
                    next.set('character', id);
                    navigate({ pathname: location.pathname.endsWith('/characters') ? location.pathname : '/media/characters', search: `?${next.toString()}` }, { replace: true });
                  }}
                />
              ) : (
                <CharacterEditPage characterId={characterPage} host={characterHost} onClose={() => openCharacterPage(null)} />
              )}
            </React.Suspense>
          </EditorBoundary>
        </div>,
        document.body,
      )}
      {/* Flow's Tools pages, over the gallery. Portalled and stopped at the root like the
        * Scenebuilder; the fallback is their black, so a chunk still loading never shows the grid. */}
      {toolsRoute && toolsHost && createPortal(
        <div
          inert={isBackground}
          style={isBackground ? BACKGROUND_OVERLAY_STYLE : undefined}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.stopPropagation()}
        >
          <EditorBoundary key="tools" onError={(error) => onEditorFailed(error, () => navigate('/media' + tabSearch))}>
            <React.Suspense fallback={<div style={TOOLS_FALLBACK_STYLE} aria-hidden />}>
              <ToolsSurface route={toolsRoute} host={toolsHost} />
            </React.Suspense>
          </EditorBoundary>
        </div>,
        document.body,
      )}
      {!isBackground && <SceneSnackbarHost />}

      {/* Flow's editors: a gallery image opens in the image editor, a video in the Scenebuilder on a
        * scene of its own. Portalled and stopped at the root like the Scenebuilder above, for the same
        * reason: React bubbles synthetic events through a portal into the gallery's marquee. */}
      {selectedItem && selectedItem.kind !== 'audio' && createPortal(
        <div
          inert={isBackground}
          style={isBackground ? BACKGROUND_OVERLAY_STYLE : undefined}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            e.stopPropagation();
            const t = e.target as HTMLElement;
            if (!t.closest('input, textarea')) e.preventDefault();
          }}
        >
          <EditorBoundary key={selectedItem.id} onError={(error) => onEditorFailed(error, () => setSelectedItem(null))}>
            <React.Suspense fallback={null}>
              {selectedItem.kind === 'video'
                ? <SceneBuilder key={selectedItem.id} sceneId={videoSceneId(selectedItem.id)} host={editorHost} video={videoViewHost} />
                : <ImageEditor itemId={selectedItem.id} host={editorHost} edit={imageEditHost} />}
            </React.Suspense>
          </EditorBoundary>
        </div>,
        document.body,
      )}

      <AgentSidebar 
        isOpen={isAgentSidebarOpen} 
        onClose={() => setIsAgentSidebarOpen(false)} 
        isHeaderVisible={isHeaderVisible}
        mediaItems={mediaItems}
        sidebarTransition={currentSidebarTransitionTiming}
        promptStore={promptStore}
        attachments={attachments.filter(Boolean)}
        setAttachments={setAttachments}
        agent={mediaAgent}
        onSend={sendToAgent}
        userName={agentUserName}
        imageModels={agentImageModels}
        videoModels={agentVideoModels}
        onAddModel={openModelSettings}
        imageRatio={imageRatio}
        setImageRatio={setImageRatio}
        imageBatch={imageBatch}
        setImageBatch={setImageBatch}
        imageModel={imageModel}
        setImageModel={setImageModel}
        videoRatio={videoRatio}
        setVideoRatio={setVideoRatio}
        videoBatch={videoBatch}
        setVideoBatch={setVideoBatch}
        videoModel={videoModel}
        setVideoModel={setVideoModel}
        onPlusClick={(ref, source, instructionId) => {
          setAssetMenuSource(source);
          if (source === 'instruction-reference') {
            setInstructionButtonRef(ref);
            if (instructionId) {
              setActiveInstructionId(instructionId);
            }
          } else {
            setSidebarButtonRef(ref);
          }
          setIsAssetMenuOpen(true);
        }}
      />

      <MusicPlayerSidebar
        isOpen={!!activeMusicItem}
        item={activeMusicItem}
        onClose={() => setActiveMusicItem(null)}
        onExpand={() => {
          if (activeMusicItem) {
            setFullscreenMusicItem(activeMusicItem);
            setActiveMusicItem(null);
          }
        }}
        isHeaderVisible={isHeaderVisible}
        sidebarTransition={currentSidebarTransitionTiming}
      />

      <AssetMenuModal
        isOpen={isAssetMenuOpen && (assetMenuSource === 'sidebar' || assetMenuSource === 'instruction-reference')}
        onClose={() => setIsAssetMenuOpen(false)}
        buttonRef={assetMenuSource === 'instruction-reference' ? instructionButtonRef : (sidebarButtonRef || assetMenuPlusRef)}
        openedFrom={assetMenuSource === 'instruction-reference' ? 'instruction-reference' : 'sidebar'}
        projectName={projectName}
        mediaItems={mediaItems}
        onFileSelect={() => fileInputRef.current?.click()}
        onAddPrompt={(assetId, assetUrl, assetTitle, assetKind) => {
          if (assetMenuSource === 'instruction-reference') {
            if (activeInstructionId) {
              mediaAgent.updateInstruction(activeInstructionId, {
                referenceName: assetTitle || 'Reference',
                ...(assetId ? { referenceId: assetId } : {}),
              });
            }
            setIsAssetMenuOpen(false);
            return;
          }

          if (assetUrl) {
            setAttachments(prev => {
              if (prev.some(att => att && att.url === assetUrl)) return prev;
              return [...prev, {
                id: assetId,
                url: assetUrl,
                name: assetTitle || 'Attached Image',
                kind: assetKind || 'image'
              }];
            });
          } else if (assetTitle) {
            const prev = promptStore.get();
            const separator = prev.trim() ? ' ' : '';
            promptStore.set(`${prev.trim()}${separator}[${assetTitle}]`);
          }
        }}
      />
      
      {/* Flow's drag preview (drag/DragPreview.tsx), moved by the pointer handler. A collection
          shows as its first item's picture, or a blank square when it is empty. */}
      {draggingItemId && (
        <DragPreview
          items={dragIdsRef.current
            .map((id) => {
              const tile = displayMediaItems.find((m) => m.id === id) ?? mediaItems.find((m) => m.id === id);
              if (!tile || !id.startsWith(COLLECTION_ITEM_PREFIX)) return tile;
              const first = collectionContents.get(id.slice(COLLECTION_ITEM_PREFIX.length))?.[0];
              return first ? { ...first, id } : tile;
            })
            .filter((m): m is MediaItem => !!m)}
          target={collectionSlot(dropTarget) ? null : dropTarget}
          anchorRef={dragPreviewRef}
          initial={dragStartPointRef.current}
        />
      )}
      {/* Flow's empty-space menu, at the pointer. */}
      <FlowMatMenu
        open={!!canvasContextMenuCoords}
        onClose={() => setCanvasContextMenuCoords(null)}
        anchor={canvasContextMenuCoords ? { kind: 'point', x: canvasContextMenuCoords.x, y: canvasContextMenuCoords.y } : null}
      >
        <FlowMatMenuItem icon="folder" label="New collection" onSelect={() => { newCollection(); }} />
        <FlowMatMenuItem icon="play_movies" label="New scene" onSelect={() => { createEmptyScene(); }} />
      </FlowMatMenu>
      {/* Flow's menu for a selection, at the pointer. */}
      <FlowMatMenu
        open={!!selectionMenuAt}
        onClose={() => setSelectionMenuAt(null)}
        anchor={selectionMenuAt ? { kind: 'point', x: selectionMenuAt.x, y: selectionMenuAt.y } : null}
      >
        <FlowMatMenuItem icon="create_new_folder" label="New collection" onSelect={() => setCollectRequest(selectedParts())} />
        <FlowMatMenuItem icon="play_movies" label="New scene" onSelect={() => { void selectionToScene(); }} />
        <FlowMatMenuItem icon="download" label="Download" onSelect={downloadSelection} />
        <FlowMatMenuItem icon="content_copy" label="Copy" onSelect={copySelection} />
        <FlowMatDivider />
        <FlowMatMenuItem icon="delete" label="Move to trash" danger onSelect={trashSelection} />
      </FlowMatMenu>

      <ConfirmDialog
        open={!!collectRequest}
        icon="warning"
        message={collectRequest ? collectMessage(collectRequest) : ''}
        confirmLabel="Create collection"
        onConfirm={confirmCollectRequest}
        onClose={() => setCollectRequest(null)}
      />
      <ConfirmDialog
        open={!!trashRequest}
        title="Move collection to trash?"
        message="This will flatten the contents of the collection and delete all internal collections. This action cannot be undone."
        confirmLabel="Move all contents to trash"
        onConfirm={confirmTrashRequest}
        onClose={() => setTrashRequest(null)}
      />
      <ShareDialog
        item={shareItem}
        parent={shareItem?.historyParentId ? mediaItems.find((m) => m.id === shareItem.historyParentId) : undefined}
        onClose={() => setShareItem(null)}
      />
      <FlagDialog open={flagOpen} onClose={() => setFlagOpen(false)} />

      {selectionBox && (
        <div
          ref={selectionBoxRef}
          className="fixed pointer-events-none z-[9999] bg-white/10 border-[1.5px] border-white border-dotted"
          style={{ display: 'none' }}
        />
      )}
    </div>
  );
};

export default MediaView;
