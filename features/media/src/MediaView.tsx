import React, { useState, useRef } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { allocateMediaBatchTimestamps, compareMediaItemsNewestFirst, loadProjectMedia, saveProjectMedia, saveProjectCover } from '@willow/storage/media-storage';
import { readProjectRegistry, writeProjectRegistry } from '@willow/projects/registry';
import { transactionalRenameProject } from '@willow/projects/rename';
import { extractVideoFrame } from '@willow/storage/covers';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, 
  MoreVertical, 
  Search, 
  Plus, 
  HelpCircle, 
  Settings, 
  ArrowRight,
  X,
  Image as ImageIcon,
  PlayCircle,
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
  SortFilterMenu,
  DEFAULT_VIEW_SETTINGS,
  DEFAULT_SORT_FILTER,
  type ViewSettings,
  type SortFilter,
} from './HeaderMenus';

/* Flow's header controls: 32x32 at a 16px radius, glyphs at 24px unfilled with weight axis 300. */
const HEADER_ICON_BUTTON = 'w-8 h-8 shrink-0 flex items-center justify-center rounded-2xl text-white hover:bg-white/10 transition-colors outline-none';
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
import { getGeminiClient } from '@willow/ai/chat';
import { useUserDataContext } from '@willow/auth/UserDataContext';
import { useLocalFS } from '@willow/storage/local-fs/LocalFSContext';
import { AssetMenuModal } from './AssetMenuModal';
import { AgentSidebar, AgentInstruction } from './AgentSidebar';
import { streamChat, ChatMessage, StreamPhase, generateSessionTitle, mockExecuteTool } from '@willow/ai/chat';
import { TextShimmer } from '@willow/ui/text-shimmer';
import { CharactersView } from './characters/CharactersView';
import { MusicView } from './music/MusicView';
import { MusicPlayerSidebar } from './music/MusicPlayerSidebar';
import {
  RatioIcon,
  AllMediaIcon,
  ImagesIcon,
  VideoIcon,
  UploadsIcon,
  CharactersIcon,
  MusicIcon,
  ScenesIcon,
  ToolsIcon,
  TrashIcon,
  CollapseIcon,
} from './media-icons';
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
import { collectSavedModelsInCatalogOrder, getModelCategory } from '@willow/core/model-catalog';

const popupItemVariants = {
  hidden: { opacity: 0, y: 8, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.22, ease: [0.32, 0.72, 0, 1] as const },
  },
  exit: {
    opacity: 0,
    y: -4,
    scale: 0.98,
    transition: { duration: 0.14, ease: [0.32, 0.72, 0, 1] as const },
  },
};

// Returns a function whose identity never changes but which always invokes the
// latest render's implementation. Lets memoized tiles receive stable handler
// props (so React.memo actually holds) without freezing any state they read.
function useEventCallback<T extends (...args: any[]) => any>(fn: T): T {
  const ref = React.useRef(fn);
  React.useLayoutEffect(() => { ref.current = fn; });
  return React.useMemo(() => ((...args: any[]) => ref.current(...args)) as T, []);
}


export const MediaView: React.FC = () => {
  const { user, userProfile } = useAuth();
  const { apiKeys } = useUserDataContext();
  const { chatScopeId, isLocalFolderConnected, isLocalFolderAuthorized, authorizeLocalFolder, saveLocalFSMedia, saveLocalFSCover, refreshLocalMedia, deleteLocalFSMediaFile, renameLocalFSMediaFile, renameLocalFSProject, loadLocalFSMediaUrl } = useLocalFS();

  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const projectId = searchParams.get('projectId') || '';

  const [prompt, setPrompt] = React.useState(() => {
    return searchParams.get('prompt') || '';
  });
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
  const [openHeaderMenu, setOpenHeaderMenu] = React.useState<'settings' | 'more' | 'filter' | null>(null);
  const viewSettingsButtonRef = React.useRef<HTMLButtonElement>(null);
  const moreMenuButtonRef = React.useRef<HTMLButtonElement>(null);
  const sortFilterButtonRef = React.useRef<HTMLButtonElement>(null);
  const [viewSettings, setViewSettings] = React.useState<ViewSettings>(DEFAULT_VIEW_SETTINGS);
  const [sortFilter, setSortFilter] = React.useState<SortFilter>(DEFAULT_SORT_FILTER);
  const closeHeaderMenu = React.useCallback(() => setOpenHeaderMenu(null), []);

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
      if (searchGroupRef.current?.contains(target)) return;
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
      setPrompt(urlPrompt);
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.delete('prompt');
        return next;
      }, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Item ids with a disk write currently in flight. Generation completion
  // (saveGeneratedMedia) and the auto-sync backfill effect can both see the
  // same just-completed unsaved item at the same moment; without this guard
  // both saved it and the collision numbering minted "X.png" + "X (1).png",
  // which the reconciler then ingested as a phantom duplicate tile.
  const fsSaveInFlightRef = React.useRef<Set<string>>(new Set());

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
      const finalName = await saveLocalFSMedia(currentProjectName, item.kind, filename, blob);
      if (finalName) {
        setMediaItems(prev => prev.map(m => m.id === item.id ? { ...m, isSavedToFS: true, fsName: finalName } : m));
      }
    } catch (err) {
      // Ignored to prevent debugging logs in production
    } finally {
      fsSaveInFlightRef.current.delete(item.id);
    }
  }, [isLocalFolderConnected, saveLocalFSMedia]);
  const [isTopFaded, setIsTopFaded] = React.useState(false);
  const [isBottomFaded, setIsBottomFaded] = React.useState(false);
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

  const [chatMessages, setChatMessages] = React.useState<ChatMessage[]>([]);
  const [isAgentGenerating, setIsAgentGenerating] = React.useState(false);
  const [agentStreaming, setAgentStreaming] = React.useState('');
  const [isAgentThinking, setIsAgentThinking] = React.useState(false);
  const [agentThinkingPhase, setAgentThinkingPhase] = React.useState<StreamPhase>('thinking');
  const [sessionName, setSessionName] = React.useState('Untitled session');

  React.useEffect(() => {
    if (chatMessages.length === 0) {
      setSessionName('Untitled session');
    }
  }, [chatMessages]);
  const activeSidebarTab = React.useMemo(() => {
    const parts = location.pathname.split('/');
    const lastPart = parts[parts.length - 1];
    return ['images', 'video', 'characters', 'music', 'scenes', 'uploads', 'tools'].includes(lastPart) ? lastPart : 'all';
  }, [location.pathname]);
  
  const activeSidebarTabRef = React.useRef(activeSidebarTab);
  React.useEffect(() => {
    activeSidebarTabRef.current = activeSidebarTab;
  }, [activeSidebarTab]);
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
  const [dragMousePos, setDragMousePos] = React.useState({ x: 0, y: 0 });
  const [isDragOverPrompt, setIsDragOverPrompt] = React.useState(false);
  /* Focus anywhere inside the composer, not just the textarea: Flow lifts the whole shell, and
   * React's onFocus/onBlur are focusin/focusout, so one pair on the shell covers the controls. */
  const [isComposerFocused, setIsComposerFocused] = React.useState(false);
  const [draggedOverZone, setDraggedOverZone] = React.useState<'start' | 'end' | null>(null);
  
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
      if (selectedItemRef.current !== null || activeSidebarTabRef.current === 'characters') return;
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

  React.useEffect(() => {
    if (!draggingItemId) {
      setDraggedOverZone(null);
    }
  }, [draggingItemId]);

  // Ref to track the mousedown origin for drag threshold detection
  const customDragStartRef = React.useRef<{ itemId: string; startX: number; startY: number } | null>(null);
  // Flag to suppress the click event that fires after mouseup ends a drag
  const wasDraggingRef = React.useRef(false);

  // Custom mouse-based drag system (replaces HTML5 drag to allow mouse wheel scrolling)
  React.useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // Check if we need to activate drag (threshold of 5px)
      if (customDragStartRef.current && !draggingItemId) {
        const dx = e.clientX - customDragStartRef.current.startX;
        const dy = e.clientY - customDragStartRef.current.startY;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
          const itemId = customDragStartRef.current.itemId;

          // If dragging an item that is not part of the selection, clear selection
          if (!selectedTileIds.has(itemId)) {
            setSelectedTileIds(new Set());
          }

          setDraggingItemId(itemId);
          setDragMousePos({ x: e.clientX, y: e.clientY });
          document.body.style.userSelect = 'none';
        }
        return;
      }

      // Update mouse position during active drag
      if (draggingItemId) {
        setDragMousePos({ x: e.clientX, y: e.clientY });

        // Detect hover over drop zones using elementFromPoint
        const elUnder = document.elementFromPoint(e.clientX, e.clientY);
        if (elUnder) {
          const isOverPromptBox = elUnder.closest('.prompt-container-box');
          setIsDragOverPrompt(!!isOverPromptBox);

          const startZone = elUnder.closest('[data-drop-zone="start"]');
          const endZone = elUnder.closest('[data-drop-zone="end"]');
          if (startZone) {
            setDraggedOverZone('start');
          } else if (endZone) {
            setDraggedOverZone('end');
          } else {
            setDraggedOverZone(null);
          }
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

      // Check for drop on zones
      const elUnder = document.elementFromPoint(e.clientX, e.clientY);
      if (elUnder) {
        const isOverPromptBox = elUnder.closest('.prompt-container-box');
        const startZone = elUnder.closest('[data-drop-zone="start"]');
        const endZone = elUnder.closest('[data-drop-zone="end"]');

        if (startZone && isFramesModeRef.current) {
          // Drop on start frame zone
          const draggedItem = mediaItemsRef.current.find(m => m.id === draggingItemId);
          if (draggedItem && draggedItem.url) {
            setAttachments(prev => {
              const next = [...prev];
              next[0] = {
                id: `${draggedItem.id}-${Math.random().toString(36).substring(7)}`,
                url: draggedItem.url,
                name: draggedItem.shortenedPrompt || draggedItem.prompt || 'Attached Media',
                kind: draggedItem.kind
              };
              return next;
            });
          }
        } else if (endZone && isFramesModeRef.current) {
          // Drop on end frame zone
          const draggedItem = mediaItemsRef.current.find(m => m.id === draggingItemId);
          if (draggedItem && draggedItem.url) {
            setAttachments(prev => {
              const next = [...prev];
              next[1] = {
                id: `${draggedItem.id}-${Math.random().toString(36).substring(7)}`,
                url: draggedItem.url,
                name: draggedItem.shortenedPrompt || draggedItem.prompt || 'Attached Media',
                kind: draggedItem.kind
              };
              return next;
            });
          }
        } else if (isOverPromptBox && !isFramesModeRef.current) {
          // Drop on prompt box (non-frames mode)
          const isMultiSelectDrag = selectedTileIds.has(draggingItemId) && selectedTileIds.size > 1;
          const itemsToAdd = isMultiSelectDrag
            ? mediaItemsRef.current.filter(m => selectedTileIds.has(m.id))
            : mediaItemsRef.current.filter(m => m.id === draggingItemId);

          if (itemsToAdd.length > 0) {
            setAttachments(prev => {
              let next = [...prev];
              itemsToAdd.forEach(item => {
                if (item.url && !next.some(att => att && att.url === item.url)) {
                  next.push({
                    id: item.id,
                    url: item.url,
                    name: item.shortenedPrompt || item.prompt || 'Attached Media',
                    kind: item.kind
                  });
                }
              });
              return next;
            });
          }
        }
      }

      setIsDragOverPrompt(false);
      setDraggedOverZone(null);
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
      const mouseY = dragMousePos.y;
      
      const threshold = 140;
      const topBoundary = rect.top + threshold;
      const bottomBoundary = rect.bottom - threshold;
      
      if (mouseY < topBoundary && mouseY > rect.top) {
        const distance = topBoundary - mouseY;
        const speed = Math.min(25, (distance / threshold) * 25);
        el.scrollTop -= speed;
      } else if (mouseY > bottomBoundary && mouseY < rect.bottom) {
        // Don't auto-scroll down when hovering over the prompt box or frame drop zones
        const elUnder = document.elementFromPoint(dragMousePos.x, mouseY);
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
  }, [draggingItemId, selectionBox !== null, dragMousePos]);

  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // Full-screen Image viewer modal states
  const [selectedItem, setSelectedItem] = React.useState<MediaItem | null>(null);
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
  const [viewerModelName, setViewerModelName] = React.useState<string>('');
  const [isViewerModelDropdownOpen, setIsViewerModelDropdownOpen] = React.useState(false);
  const viewerModelDropdownRef = React.useRef<HTMLDivElement>(null);
  const [viewerAttachments, setViewerAttachments] = React.useState<ImageAttachment[]>([]);
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

  // Unified transition timing used by both left sidebar and right agent sidebar
  const sidebarShowTransition = '0.78s cubic-bezier(0.16, 1, 0.3, 1)';
  const sidebarHideTransition = '0.92s cubic-bezier(0.25, 1, 0.5, 1) 120ms';
  const currentSidebarTransitionTiming = isHeaderVisible ? sidebarShowTransition : sidebarHideTransition;

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

  const handleScroll = (e: React.UIEvent<HTMLElement>) => {
    updateCustomScrollbar(e.currentTarget);
    const scrollTop = e.currentTarget.scrollTop;
    if (scrollTop <= 10) {
      setIsHeaderVisible(true);
      setIsAtTop(true);
      maxScrollTop.current = scrollTop;
    } else {
      setIsAtTop(false);
      if (scrollTop > lastScrollTop.current) {
        setIsHeaderVisible(false);
        maxScrollTop.current = scrollTop;
      } else if (scrollTop < lastScrollTop.current) {
        // Reappear only after scrolling up a small distance (45px) from the peak scroll position
        if (maxScrollTop.current - scrollTop >= 45) {
          setIsHeaderVisible(true);
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
  const [hoveredAttachmentRect, setHoveredAttachmentRect] = React.useState<{ left: number; width: number } | null>(null);
  const [hoveredAttachmentIsEndFrame, setHoveredAttachmentIsEndFrame] = React.useState<boolean>(false);
  const hoverTimeoutRef = React.useRef<any>(null);
  const closeTimeoutRef = React.useRef<any>(null);
  
  const handleAttachmentMouseEnter = (e: React.MouseEvent<HTMLDivElement>, url: string, isEndFrame?: boolean) => {
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    
    const rect = e.currentTarget.getBoundingClientRect();
    const parent = e.currentTarget.closest('.prompt-container-box');
    const leftOffset = parent ? rect.left - parent.getBoundingClientRect().left : 0;
    const width = rect.width;
    
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredAttachmentRect({
        left: leftOffset,
        width: width
      });
      setHoveredAttachmentUrl(url);
      setHoveredAttachmentIsEndFrame(!!isEndFrame);
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
              finalFsName = await saveLocalFSMedia(projectName || 'Default', fileKind, filename, file);
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
  const [generationError, setGenerationError] = React.useState<string | null>(null);
  const [mediaItems, setMediaItems] = React.useState<MediaItem[]>([]);
  const displayMediaItems = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    let filtered = mediaItems.filter((item) => {
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
    });

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
    return filtered;
  }, [mediaItems, activeSidebarTab, searchQuery]);

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
  // Mirror of mediaItems for use inside non-reactive listeners.
  const mediaItemsRef = React.useRef<MediaItem[]>([]);
  React.useEffect(() => { mediaItemsRef.current = mediaItems; }, [mediaItems]);
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
  const loadMedia = React.useCallback(async (skipIfGenerating: boolean) => {
    if (!projectId) { revokeMediaBlobUrls(); setMediaItems([]); return; }
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

    // Crash recovery: a freshly loaded record can't legitimately be
    // mid-generation — a stale 'generating' entry (browser closed mid-run)
    // would otherwise show a spinner forever. Surface it as failed instead.
    const loaded = (items || []).map((m: any) =>
      m?.status === 'generating' ? { ...m, status: 'failed' } : m
    );

    const freshBlobUrls: string[] = [];
    // INVARIANT #14: reuse the currently-displayed blob: URL when the same
    // item (id + fsName + kind) is already on screen with a live one. Minting
    // a fresh URL (and revoking the old) forces every <img> to unload and
    // reload, visibly collapsing/reflowing the masonry on each realtime
    // refresh even when nothing changed on disk.
    const prevById = new Map(mediaItemsRef.current.map((i: any) => [i?.id, i]));
    const reusedUrls = new Set<string>();
    const hydrated = await Promise.all(loaded.map(async (m: any) => {
      if (m?.url) return m; // browser-only base64 (or already hydrated) — use as-is
      if (connected && m?.fsName && m?.kind) {
        const isAudioFile = m.kind === 'audio' && /\.(mp3|wav|m4a|ogg|flac|aac)$/i.test(m.fsName);
        const prev = prevById.get(m.id);
        if (prev && prev.fsName === m.fsName && prev.kind === m.kind) {
          if (isAudioFile) {
            // Only when the item doesn't carry real (data:/http) audio of its
            // own — mirrors the keep-real-audio guard below.
            if ((!m.audioUrl || m.audioUrl.startsWith('blob:')) && prev.audioUrl?.startsWith('blob:')) {
              reusedUrls.add(prev.audioUrl);
              return { ...m, audioUrl: prev.audioUrl };
            }
          } else if (prev.url?.startsWith('blob:')) {
            reusedUrls.add(prev.url);
            return { ...m, url: prev.url };
          }
        }
        const blobUrl = await loadLocalFSMediaUrl(projectName, m.kind, m.fsName);
        if (blobUrl) {
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
    }));

    // Bail if a newer load superseded this one, or a generation started meanwhile.
    if (gen !== loadGenRef.current || mediaItemsRef.current.some(i => i.status === 'generating')) {
      for (const u of freshBlobUrls) { try { URL.revokeObjectURL(u); } catch {} }
      return;
    }
    // INVARIANT #15: structural change-only gate. If every item is identical
    // (id/url/status/fsName/kind/prompt/timestamp), skip the setState — each
    // realtime poll otherwise re-renders the whole masonry and tiles visibly
    // reposition even though nothing changed on disk. (With the URL reuse
    // above, unchanged items keep identical blob: urls, so idle refreshes and
    // post-rename reloads actually hit this gate.)
    const itemSig = (m: any) =>
      [m?.id, m?.url ?? '', m?.audioUrl ?? '', m?.status, m?.fsName ?? '', m?.kind, m?.prompt ?? '', m?.timestamp ?? 0].join('\u0000');
    const prevItems = mediaItemsRef.current;
    if (lastLoadedProjectIdRef.current === projectId && prevItems.length === hydrated.length) {
      const prevSigs = new Set(prevItems.map(itemSig));
      if (hydrated.every((m: any) => prevSigs.has(itemSig(m)))) {
        for (const u of freshBlobUrls) { try { URL.revokeObjectURL(u); } catch {} }
        mediaLoadedRef.current = true;
        return;
      }
    }
    const keptUrls = revokeMediaBlobUrls(reusedUrls); // release previous URLs not reused / not held by attachments
    mediaBlobUrlsRef.current = [...freshBlobUrls, ...keptUrls];
    setMediaItems(hydrated);
    lastLoadedProjectIdRef.current = projectId;
    mediaLoadedRef.current = true;
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
  React.useEffect(() => {
    if (!isLocalFolderConnected || !isLocalFolderAuthorized || mediaItems.length === 0) return;

    const unsaved = mediaItems.filter(m => m.status === 'completed' && m.url && !m.isSavedToFS);
    if (unsaved.length === 0) return;

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
          const finalName = await saveLocalFSMedia(projectName, item.kind, filename, blob);
          if (finalName) {
            setMediaItems(prev => prev.map(m => m.id === item.id ? { ...m, isSavedToFS: true, fsName: finalName } : m));
          }
        } catch (e) {
          // Ignore write lock issues
        } finally {
          fsSaveInFlightRef.current.delete(item.id);
        }
      }
    };

    void syncUnsaved();
  }, [isLocalFolderConnected, isLocalFolderAuthorized, mediaItems, projectName, saveLocalFSMedia]);

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
  // Read user saved models from localStorage
  const savedConfigRaw = typeof window !== 'undefined' ? localStorage.getItem('modelConfig') : null;
  const userSavedModels = React.useMemo(() => {
    try {
      const parsed = savedConfigRaw ? JSON.parse(savedConfigRaw) : null;
      if (!parsed) return [];
      return collectSavedModelsInCatalogOrder(parsed);
    } catch {
      return [];
    }
  }, [savedConfigRaw]);

  type ImageModelId = string;
  const [imageModel, setImageModel] = React.useState<ImageModelId>('gemini-3-pro-image-preview');
  const [musicModel, setMusicModel] = React.useState<string>('lyria-3-pro');
  const [isImageModelDropdownOpen, setIsImageModelDropdownOpen] = React.useState(false);
  const [imageModelDropDirection, setImageModelDropDirection] = React.useState<'down' | 'up'>('down');
  const imageModelDropdownRef = React.useRef<HTMLDivElement>(null);
  const imageModelButtonRef = React.useRef<HTMLButtonElement>(null);

  const availableImageModels = React.useMemo(() => {
    const userImageModels = userSavedModels.filter((model: any) => getModelCategory(model) === 'image');
    if (userImageModels.length > 0) {
      return userImageModels.map((m: any) => ({
        id: m.modelId || m.id,
        name: m.name || (m.modelId === 'grok-imagine' ? 'Grok Imagine' : 'Nano Banana')
      }));
    }
    return [{ id: 'none', name: 'No image models configured' }];
  }, [userSavedModels]);

  type VideoModelId = string;
  const DEFAULT_VIDEO_MODELS: { id: VideoModelId; name: string; apiId: string }[] = [
    { id: 'veo-3.1-fast', name: 'Veo 3.1 Fast', apiId: 'veo-3.1-fast-generate-preview' },
    { id: 'veo-3.1', name: 'Veo 3.1', apiId: 'veo-3.1-generate-preview' },
    { id: 'veo-3.1-lite', name: 'Veo 3.1 Lite', apiId: 'veo-3.0-fast-generate-001' },
    { id: 'omni-flash', name: 'Gemini Omni Flash', apiId: 'gemini-omni-flash-preview' },
  ];

  const availableVideoModels = React.useMemo(() => {
    const userVideoModels = userSavedModels.filter((model: any) => getModelCategory(model) === 'video');
    if (userVideoModels.length > 0) {
      return userVideoModels.map((m: any) => {
        const id = m.modelId || m.id;
        const match = DEFAULT_VIDEO_MODELS.find(v => v.id === id);
        return {
          id: id,
          name: m.name || match?.name || 'Video Model',
          apiId: match?.apiId || id
        };
      });
    }
    return [{ id: 'none', name: 'No video models configured', apiId: '' }];
  }, [userSavedModels]);

  const availableMusicModels = React.useMemo(() => {
    const userMusicModels = userSavedModels.filter((m: any) => {
      const id = (m.modelId || m.id || '').toLowerCase();
      const name = (m.name || '').toLowerCase();
      return id.includes('lyria') || id.includes('voice') || name.includes('lyria') || name.includes('voice');
    });
    if (userMusicModels.length > 0) {
      return userMusicModels.map((m: any) => ({
        id: m.modelId || m.id,
        name: m.name || (m.modelId === 'grok-voice' ? 'Grok Voice' : 'Lyria 3 Pro')
      }));
    }
    return [{ id: 'none', name: 'No music models configured' }];
  }, [userSavedModels]);

  const VIDEO_MODELS = availableVideoModels;

  const getVideoApiModelId = (id: VideoModelId) =>
    availableVideoModels.find(m => m.id === id)?.apiId ?? 'veo-3.1-fast-generate-preview';
  const [videoModel, setVideoModel] = React.useState<VideoModelId>('omni-flash');
  const [isVideoModelDropdownOpen, setIsVideoModelDropdownOpen] = React.useState(false);
  const [videoModelDropDirection, setVideoModelDropDirection] = React.useState<'down' | 'up'>('down');
  const videoModelDropdownRef = React.useRef<HTMLDivElement>(null);
  const videoModelButtonRef = React.useRef<HTMLButtonElement>(null);
  const getVideoModelName = (id: VideoModelId) => availableVideoModels.find(m => m.id === id)?.name ?? 'Gemini Omni Flash';

  const toggleImageModelDropdown = () => {
    setIsImageModelDropdownOpen(open => {
      const next = !open;
      if (next) {
        setImageModelDropDirection(
          computeDropDirection(imageModelButtonRef.current, estimateDropdownHeight(2)),
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
          computeDropDirection(videoModelButtonRef.current, estimateDropdownHeight(VIDEO_MODELS.length)),
        );
      }
      return next;
    });
  };

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

  const getImageModelName = (id: string) => {
    const found = availableImageModels.find(m => m.id === id);
    if (found) return found.name;
    if (id === 'gemini-3-pro-image-preview') return 'Nano Banana Pro';
    if (id === 'gemini-3.1-flash-image-preview') return 'Nano Banana 2';
    if (id === 'grok-imagine') return 'Grok Imagine';
    return 'Nano Banana Lite';
  };

  const menuRef = React.useRef<HTMLDivElement>(null);
  const popupRef = React.useRef<HTMLDivElement>(null);
  const activeMenuButtonRef = React.useRef<HTMLElement | null>(null);
  const [menuRect, setMenuRect] = React.useState<{ bottom: number; right: number } | null>(null);

  const openModelMenu = () => {
    if (menuRef.current) {
      activeMenuButtonRef.current = menuRef.current;
      const r = menuRef.current.getBoundingClientRect();
      setMenuRect({
        bottom: window.innerHeight - r.top + 12,
        right: window.innerWidth - r.right,
      });
    }
    setIsModelMenuOpen(true);
  };

  const openModelMenuFromRef = (buttonElement: HTMLElement) => {
    activeMenuButtonRef.current = buttonElement;
    const r = buttonElement.getBoundingClientRect();
    setMenuRect({
      bottom: window.innerHeight - r.top + 12,
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
  const assetMenuPlusRef = useRef<HTMLButtonElement>(null);
  const [assetMenuSource, setAssetMenuSource] = useState<'main' | 'sidebar' | 'instruction-reference'>('main');
  const [sidebarButtonRef, setSidebarButtonRef] = useState<React.RefObject<HTMLButtonElement> | null>(null);
  const [instructions, setInstructions] = useState<AgentInstruction[]>([]);
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
  const [videoDuration, setVideoDuration] = React.useState('10s');
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
    // History thumbnail is bottom-anchored → it drifts up by the full delta.
    // 28px is the original `translate-y-7` resting nudge, folded in here.
    if (historyRailRef.current) {
      historyRailRef.current.style.transform = `translateY(${28 + delta}px)`;
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

  const updateFades = (target: HTMLTextAreaElement) => {
    const scrollHeight = target.scrollHeight;
    const clientHeight = target.clientHeight;
    const scrollTop = target.scrollTop;

    // Use a 4px tolerance to handle fractional browser scaling/zoom & line heights
    const hasScrollableHeight = scrollHeight > clientHeight + 4;
    const scrolledFromTop = scrollTop > 2;
    const canScrollMore = scrollHeight - scrollTop > clientHeight + 4;

    setIsTopFaded(hasScrollableHeight && scrolledFromTop);
    setIsBottomFaded(hasScrollableHeight && canScrollMore);
  };

  React.useEffect(() => {
    const adjustHeight = () => {
      if (textareaRef.current) {
        const el = textareaRef.current;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 384)}px`;
        updateFades(el);
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
  }, [prompt]);

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

      const rephraseResp = await fetchRephrase('gemini-1.5-flash');
      
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
  ) => {
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
        
        // If not found in config, look up from willow:providerState session storage cache
        if (!baseUrl && typeof window !== 'undefined' && user?.uid) {
          try {
            const providerStateKey = `willow:providerState:${user.uid}`;
            const serialized = sessionStorage.getItem(providerStateKey);
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
        return;
      }

      const inlineParts = await Promise.all(activeAttachments.map(getGeminiInlinePart));

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`,
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
    } catch (err: any) {
      console.error(`[image ${item.id}] failed:`, err);
      setMediaItems(prev =>
        prev.map(m =>
          m.id === item.id ? { ...m, status: 'failed', error: err?.message || 'Generation failed.' } : m,
        ),
      );
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
  ) => {
    try {
      const apiModelId = getVideoApiModelId(videoModelKey);
      const durationSec = parseInt(durationStr.replace('s', ''), 10) || 8;

      const inlineParts = await Promise.all(activeAttachments.map(getGeminiInlinePart));
      const firstImagePart = inlineParts[0]?.inlineData;

      if (videoModelKey === 'omni-flash') {
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
        return videoUrl;
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
    } catch (err: any) {
      console.error(`[video ${item.id}] failed:`, err);
      setMediaItems(prev =>
        prev.map(m =>
          m.id === item.id ? { ...m, status: 'failed', error: err?.message || 'Video generation failed.' } : m,
        ),
      );
    }
  };

  const handleAgentSend = async (text: string) => {
    if (!text.trim() && attachments.length === 0) return;
    if (isAgentGenerating) return;

    const activeAttachments = attachments.filter(Boolean);
    const attachmentIds = activeAttachments.map(att => att.id);

    if (attachmentIds.length > 0) {
      setRemovingIds(prev => {
        const next = new Set(prev);
        attachmentIds.forEach(id => next.add(id));
        return next;
      });
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

    setPrompt('');

    setIsAgentGenerating(true);
    setIsAgentThinking(true);
    setAgentThinkingPhase('thinking');
    setAgentStreaming('');

    const convertedAttachments = await Promise.all(
      activeAttachments.map(async (att) => {
        try {
          if (att.url.startsWith('data:')) {
            const match = att.url.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              return {
                type: 'image',
                mimeType: match[1],
                data: match[2],
                name: att.name
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
                    type: 'image',
                    mimeType: match[1],
                    data: match[2],
                    name: att.name
                  });
                } else {
                  reject(new Error('Failed to parse file data'));
                }
              };
              reader.onerror = reject;
              reader.readAsDataURL(att.file);
            });
          }
          const res = await fetch(att.url);
          const blob = await res.blob();
          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const result = reader.result as string;
              const match = result.match(/^data:([^;]+);base64,(.+)$/);
              if (match) {
                resolve({
                  type: 'image',
                  mimeType: match[1],
                  data: match[2],
                  name: att.name
                });
              } else {
                reject(new Error('Failed to parse file data'));
              }
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        } catch (e) {
          return null;
        }
      })
    );

    const activeCanvasImages = mediaItemsRef.current
      .filter(m => m.kind === 'image' && m.status === 'completed' && m.url)
      .slice(0, 10);

    const canvasImageAttachments = await Promise.all(
      activeCanvasImages.map(async (m) => {
        try {
          const res = await fetch(m.url!);
          const blob = await res.blob();
          return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
              const canvas = document.createElement('canvas');
              const MAX_SIZE = 512;
              let width = img.width;
              let height = img.height;
              
              if (width > height) {
                if (width > MAX_SIZE) {
                  height *= MAX_SIZE / width;
                  width = MAX_SIZE;
                }
              } else {
                if (height > MAX_SIZE) {
                  width *= MAX_SIZE / height;
                  height = MAX_SIZE;
                }
              }
              
              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(img, 0, 0, width, height);
              }
              
              const result = canvas.toDataURL('image/jpeg', 0.5);
              const match = result.match(/^data:([^;]+);base64,(.+)$/);
              if (match) {
                resolve({
                  type: 'image',
                  mimeType: match[1],
                  data: match[2],
                  id: m.id,
                  name: `media-id: ${m.id}`
                });
              } else {
                reject(new Error('Failed to parse file data'));
              }
              URL.revokeObjectURL(img.src);
            };
            img.onerror = () => {
              URL.revokeObjectURL(img.src);
              reject(new Error('Failed to load image'));
            };
            img.src = URL.createObjectURL(blob);
          });
        } catch (e) {
          return null;
        }
      })
    );

    const validAttachments = convertedAttachments.filter(Boolean) as any[];

    const userMsg: ChatMessage = {
      role: 'user',
      content: text,
      ...(validAttachments.length > 0 ? { attachments: validAttachments } : {})
    };

    const newMessages: ChatMessage[] = [
      ...chatMessages,
      userMsg,
      { role: 'assistant', content: '' }
    ];

    setChatMessages(newMessages);

    const apiKey = apiKeys?.gemini?.[0];
    if (!apiKey) {
      setChatMessages(prev => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === 'assistant') {
          last.content = 'Google Gemini API Key is missing. Please add it under Settings > Models & API.';
        }
        return next;
      });
      setIsAgentGenerating(false);
      setIsAgentThinking(false);
      return;
    }

    let activeImageModelName = 'Nano Banana Lite';
    if (imageModel === 'gemini-3-pro-image-preview') activeImageModelName = 'Nano Banana Pro';
    if (imageModel === 'gemini-3.1-flash-image-preview') activeImageModelName = 'Nano Banana 2';
    const activeVideoModelName = videoModel === 'veo-3.1-fast' ? 'Veo 3.1 Fast' : videoModel === 'veo-3.1' ? 'Veo 3.1' : videoModel === 'veo-3.1-lite' ? 'Veo 3.1 Lite' : 'Omni Flash';

    const activeGuidelines = instructions
      .filter(i => i.isActive && i.content.trim())
      .map(i => `- [${i.title}]: ${i.content}`)
      .join('\n');

    /* ─────────────────────────────────────────────────────────────────────
     * DEFERRED: media capability self-description
     *
     * SLOTS INTO: `systemPrompt` below, as a trailing section.
     * BLOCKED ON: nothing structural — this agent already sets
     *   `enableMediaTools: true` a few lines down, so it is the one surface
     *   that may honestly claim these. What it needs is a pass to reconcile
     *   the text against what Willow really wires up.
     *
     * This came from the source prompt Chat's `CHAT_SYSTEM_PROMPT` was adapted
     * from, and it is the reason Chat must never carry it: chat turns leave
     * `enableMediaTools` off, so `generate_image` / `generate_video` are never
     * declared to them. A chat model told it can generate video announces a
     * render that never lands. Media is the correct home, which is why the
     * block was parked here rather than in `features/chat`.
     *
     * Reconcile before pasting — the model names here are the source's, while
     * the live ones are resolved just above from `imageModel` / `videoModel`
     * (`activeImageModelName`, `activeVideoModelName`). Prefer those variables
     * over hardcoding, or the prompt will drift from the picker. Willow has no
     * subscription tiers, so the source's per-day allowances are already
     * deleted rather than renumbered.
     *
     * ───8<─────── paste from here ───────
     *
     * The following information block is strictly for answering questions
     * about your capabilities. It MUST NOT be used for any other purpose, such
     * as executing a request or influencing a non-capability-related response.
     * If there are questions about your capabilities, use the following info to
     * answer appropriately:
     *
     * * Generative Abilities: You can generate text, images, videos, music.
     * * Image Tools (image_generation & image_edit):
     *     * Description: Can help generate and edit images. This is powered by
     *       the "Nano Banana 2" model, which has an official name of Gemini 3
     *       Flash Image. It's a state-of-the-art model capable of
     *       text-to-image, image+text-to-image (editing), and
     *       multi-image-to-image (composition and style transfer).
     * * Video Tools (video_generation):
     *     * Description: Can help generate videos. This uses the "Veo" model.
     *       Veo is Google's state-of-the-art model for generating high-fidelity
     *       videos with natively generated audio. Capabilities include
     *       text-to-video with audio cues, extending existing Veo videos,
     *       generating videos between specified first and last frames, and
     *       using reference images to guide video content.
     *     * Constraints: Unsafe content.
     * * Music Tools (music_generation):
     *     * Description: Can help generate high-fidelity music tracks. This is
     *       powered by the "Lyria 3" model. It is a multimodal model capable of
     *       text-to-music, image-to-music, and video-to-music generation. It
     *       supports professional-grade arrangements, including automated lyric
     *       writing and realistic vocal performances in multiple languages.
     *     * Features: Produces 30-second tracks with granular control over
     *       tempo, genre, and emotional mood.
     *     * Constraints: All tracks include SynthID watermarking for
     *       AI-identification.
     * * Willow Live Mode: You have a conversational mode called Willow Live.
     *     * Description: This mode allows for a more natural, real-time voice
     *       conversation. You can be interrupted and engage in free-flowing
     *       dialogue.
     *     * Key Features:
     *         * Natural Voice Conversation: Speak back and forth in real-time.
     *         * Camera Sharing: Share your camera feed to ask questions about
     *           what you see.
     *         * Screen Sharing: Share your screen for contextual help on apps
     *           or content.
     *         * Image/File Discussion: Upload images or files to discuss their
     *           content.
     *     * Use Cases: Real-time assistance, brainstorming, language learning,
     *       translation, getting information about surroundings, help with
     *       on-screen tasks.
     *
     * ───8<─────── to here ───────
     *
     * The Live paragraph is the one part that is already true elsewhere — Chat
     * ships live voice today (`liveSystemPrompt` in `@willow/chat/chat-model`).
     * If any of this is wanted sooner, it is that paragraph, trimmed to the
     * surfaces Willow actually ships, and it belongs to Chat rather than here.
     * ───────────────────────────────────────────────────────────────────── */
    const systemPrompt = `You are a creative co-pilot AI Agent assisting the user in crafting elite-tier media prompts, storytelling, and refining video/image properties.
At any point, you can suggest full storyboard ideas, prompt scripts, or style guidelines. Keep your formatting gorgeous with clean headings and bullets.

Active Workspace Generation Settings:
- Default Image Generator: ${activeImageModelName} (Aspect Ratio: ${imageRatio}, Batch Size: ${imageBatch})
- Default Video Generator: ${activeVideoModelName} (Aspect Ratio: ${videoRatio}, Batch Size: ${videoBatch})

${activeGuidelines ? `Yashjit's custom instructions/guidelines you MUST follow:\n${activeGuidelines}` : ''}`;

    const isFirstPrompt = chatMessages.length === 0;

    if (isFirstPrompt) {
      void (async () => {
        try {
          const title = await generateSessionTitle(text, apiKey);
          if (title && title.trim()) {
            setSessionName(title.trim());
          }
        } catch (e) {
          // ignore
        }
      })();
    }

    const apiValidAttachments = [...validAttachments, ...canvasImageAttachments.filter(Boolean)] as any[];
    const apiUserMsg: ChatMessage = {
      role: 'user',
      content: text,
      ...(apiValidAttachments.length > 0 ? { attachments: apiValidAttachments } : {})
    };
    const apiMessages: ChatMessage[] = [
      ...chatMessages,
      apiUserMsg,
      { role: 'assistant', content: '' }
    ];

    let acc = '';
    try {
      const returnedHistory = await streamChat(
        apiMessages.slice(0, -1),
        {
          provider: 'gemini',
          model: 'gemini-3.5-flash',
          apiKey: apiKey,
          thinkingLevel: 1,
          enableSearch: true,
          enableCodeExecution: true,
          // The media agent is the one caller with a real tool executor, so it is
          // the one caller that may request the generation harness.
          enableMediaTools: true
        },
        (token) => {
          setIsAgentThinking(false);
          acc += token;
          setAgentStreaming(acc);
          setChatMessages(prev => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === 'assistant') {
              last.content = acc;
            }
            return next;
          });
        },
        () => {},
        systemPrompt,
        (phase) => {
          if (phase !== 'responding') {
            setAgentThinkingPhase(phase);
          }
        },
        async (name: string, args: any) => {
          const result = mockExecuteTool(name, args);
          
          if (name === 'generate_image' && result?.media_id) {
            const modelToUse = args.model || imageModel || 'gemini-3.1-flash-image-preview';
            const ratioToUse = args.aspect_ratio || imageRatio || '16:9';
            const isEditing = args.references && Array.isArray(args.references) && args.references.length > 0;
            const batchStr = args.batch_size || (isEditing ? '1x' : imageBatch) || '1x';
            const batchCount = Math.max(1, parseInt(batchStr.replace('x', ''), 10) || 1);
            
            // Resolve any style, composition, or character referenced canvas image IDs requested by the agent
            const refAttachments: ImageAttachment[] = [];
            if (args.references && Array.isArray(args.references)) {
              args.references.forEach((refId: string) => {
                const cleanId = refId.replace(/^media-id:/, '');
                const refItem = mediaItemsRef.current.find(m => m.id === cleanId);
                if (refItem?.url) {
                  refAttachments.push({
                    id: refItem.id,
                    url: refItem.url,
                    name: refItem.prompt || 'Reference Image',
                    kind: refItem.kind
                  });
                }
              });
            }

            // Create a batch of placeholder items in generating state synchronously
            const batchTimestamps = allocateMediaBatchTimestamps(batchCount);
            const newItems: MediaItem[] = Array.from({ length: batchCount }, (_, i) => {
              // Ensure the first item matches result.media_id so the chat sidebar image works,
              // while other items in the batch get unique IDs so they display on the canvas.
              const itemId = i === 0 ? result.media_id : `${result.media_id}_batch_${i}`;
              return {
                id: itemId,
                kind: 'image',
                status: 'generating',
                prompt: args.prompt || 'Agent Generated Image',
                modelId: modelToUse,
                modelName: modelToUse === 'gemini-3-pro-image-preview' ? 'Nano Banana Pro' : 'Nano Banana 2',
                ratio: ratioToUse,
                timestamp: batchTimestamps[i],
                effort: imageEffort,
                quality: imageQuality,
                resolution: imageResolution,
                ...(refAttachments.length > 0 ? { attachments: refAttachments } : {})
              };
            });
            setMediaItems(prev => [...newItems, ...prev]);
            
            // Populate media_ids so the agent sidebar can render all images in the batch
            result.media_ids = newItems.map(item => item.id);
            
            // Await all parallel Gemini/Imagen image generations so that Gemini is blocked and pauses its stream
            // until the images are 100% completed, guaranteeing that paragraphs render in the correct sequential order!
            await Promise.all(
              newItems.map(async (item) => {
                try {
                  const allAttachments = [...refAttachments, ...validAttachments];
                  const inlineParts = await Promise.all(allAttachments.map(getGeminiInlinePart));
                  
                  const response = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/${modelToUse}:generateContent?key=${apiKey}`,
                    {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        contents: [{
                          parts: [
                            { text: args.prompt || 'Agent Generated Image' },
                            ...inlineParts
                          ]
                        }],
                        generationConfig: {
                          responseModalities: ['IMAGE'],
                          imageConfig: { aspectRatio: ratioToUse, imageSize: '1K' },
                        },
                      }),
                    },
                  );
                  
                  if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    throw new Error(errData?.error?.message || `API error (${response.status})`);
                  }
                  
                  const data = await response.json();
                  if (data?.promptFeedback?.blockReason === 'SAFETY' || data?.candidates?.[0]?.finishReason === 'SAFETY') {
                    throw new Error('This prompt might violate our safety policies. Please try a different prompt.');
                  }
                  
                  const parts = data?.candidates?.[0]?.content?.parts || [];
                  const imagePart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith('image/'));
                  if (!imagePart?.inlineData?.data) {
                    throw new Error('The model was unable to generate an image from this prompt.');
                  }
                  
                  const realUrl = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
                  
                  setMediaItems(prev =>
                    prev.map(m => (m.id === item.id ? { ...m, status: 'completed', url: realUrl } : m))
                  );
                  
                  if (item.id === result.media_id) {
                    result.url = realUrl;
                    result.status = 'success';
                  }
                } catch (err: any) {
                  setMediaItems(prev =>
                    prev.map(m => (m.id === item.id ? { ...m, status: 'failed', error: err?.message || 'Generation failed' } : m))
                  );
                  if (item.id === result.media_id) {
                    result.status = 'failed';
                    result.error = err?.message || 'Generation failed';
                  }
                }
              })
            );
            
          } else if (name === 'generate_video_from_text' && result?.media_id) {
            const modelToUse = args.model || videoModel || 'omni-flash';
            const ratioToUse = args.aspect_ratio || videoRatio || '16:9';
            const durationToUse = args.duration || videoDuration || '10s';
            const batchStr = args.batch_size || videoBatch || '1x';
            const batchCount = Math.max(1, parseInt(batchStr.replace('x', ''), 10) || 1);
            
            const batchTimestamps = allocateMediaBatchTimestamps(batchCount);
            const newItems: MediaItem[] = Array.from({ length: batchCount }, (_, i) => {
              const itemId = i === 0 ? result.media_id : `${result.media_id}_batch_${i}`;
              return {
                id: itemId,
                kind: 'video',
                status: 'generating',
                prompt: args.prompt || 'Agent Generated Video',
                modelId: modelToUse,
                modelName: modelToUse === 'omni-flash' ? 'Omni Flash' : 'Veo 3.1 Fast',
                ratio: ratioToUse,
                timestamp: batchTimestamps[i]
              };
            });
            setMediaItems(prev => [...newItems, ...prev]);
            
            // Populate media_ids so the agent sidebar can render all videos in the batch
            result.media_ids = newItems.map(item => item.id);
            
            // Await parallel video generations
            await Promise.all(
              newItems.map(async (item) => {
                try {
                  const durationSec = parseInt(durationToUse.replace('s', ''), 10) || 8;
                  const inlineParts = await Promise.all(validAttachments.map(getGeminiInlinePart));
                  
                  if (modelToUse === 'omni-flash') {
                    const interactionsInput = [
                      { 
                        type: 'text', 
                        text: `${args.prompt || 'Agent Generated Video'}\n\n[System: Please generate this video with an aspect ratio of ${ratioToUse} and a duration of ${durationSec} seconds.]` 
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
                          model: `models/veo-2.0-generate-001`,
                          input: interactionsInput,
                          response_format: {
                            type: 'video',
                            aspect_ratio: ratioToUse
                          }
                        }),
                      }
                    );
                    
                    if (!response.ok) {
                      const errData = await response.json().catch(() => ({}));
                      throw new Error(errData?.error?.message || `API error (${response.status})`);
                    }
                    
                    const data = await response.json();
                    if (data?.promptFeedback?.blockReason === 'SAFETY' || data?.state === 'BLOCKED') {
                      throw new Error('This prompt might violate our safety policies. Please try a different prompt.');
                    }
                    
                    let videoUrl = '';
                    if (data?.steps) {
                      const outputStep = data.steps.find((s: any) => s.type === 'model_output' || s.stepType === 'model_output' || s.step_type === 'model_output');
                      if (outputStep) {
                        const parts = Array.isArray(outputStep.content) ? outputStep.content : (outputStep.content?.parts || []);
                        const videoPart = parts.find((p: any) => p.mime_type?.startsWith('video/') || p.mimeType?.startsWith('video/') || p.inlineData?.mimeType?.startsWith('video/'));
                        if (videoPart) {
                          if (videoPart.inlineData?.data) {
                            videoUrl = `data:${videoPart.inlineData.mimeType};base64,${videoPart.inlineData.data}`;
                          } else if (videoPart.data) {
                            const mime = videoPart.mime_type || videoPart.mimeType || 'video/mp4';
                            videoUrl = `data:${mime};base64,videoPart.data`;
                          }
                        }
                      }
                    }
                    
                    if (!videoUrl) {
                      throw new Error('The model was unable to generate a video from this prompt.');
                    }
                    
                    setMediaItems(prev =>
                      prev.map(m => (m.id === item.id ? { ...m, status: 'completed', url: videoUrl } : m))
                    );
                    
                    if (item.id === result.media_id) {
                      result.url = videoUrl;
                      result.status = 'success';
                    }
                  } else {
                    // For other Veo models, leverage existing predictLongRunning predictive background task helper
                    await generateSingleVideo(item, args.prompt || 'Agent Generated Video', modelToUse as VideoModelId, ratioToUse, durationToUse, apiKey, validAttachments);
                  }
                } catch (err: any) {
                  setMediaItems(prev =>
                    prev.map(m => (m.id === item.id ? { ...m, status: 'failed', error: err?.message || 'Generation failed' } : m))
                  );
                  if (item.id === result.media_id) {
                    result.status = 'failed';
                    result.error = err?.message || 'Generation failed';
                  }
                }
              })
            );
          } else if (name === 'generate_video_with_first_frame' && result?.media_id) {
            const newItem: MediaItem = {
              id: result.media_id,
              kind: 'video',
              status: 'completed',
              prompt: args.prompt || 'First Frame Animation',
              modelId: args.model || 'omni-flash',
              modelName: 'Omni Flash',
              ratio: '16:9',
              url: 'https://assets.mixkit.co/videos/preview/mixkit-stars-in-space-background-1611-large.mp4',
              timestamp: Date.now()
            };
            setMediaItems(prev => [newItem, ...prev]);
          } else if (name === 'generate_video_with_interpolation' && result?.media_id) {
            const newItem: MediaItem = {
              id: result.media_id,
              kind: 'video',
              status: 'completed',
              prompt: args.prompt || 'Interpolated Video',
              modelId: 'veo-3.1',
              modelName: 'Veo 3.1',
              ratio: '16:9',
              url: 'https://assets.mixkit.co/videos/preview/mixkit-stars-in-space-background-1611-large.mp4',
              timestamp: Date.now()
            };
            setMediaItems(prev => [newItem, ...prev]);
          } else if (name === 'generate_video_with_references' && result?.media_id) {
            const newItem: MediaItem = {
              id: result.media_id,
              kind: 'video',
              status: 'completed',
              prompt: args.prompt || 'Reference Guided Video',
              modelId: 'omni-flash',
              modelName: 'Omni Flash',
              ratio: '16:9',
              url: 'https://assets.mixkit.co/videos/preview/mixkit-stars-in-space-background-1611-large.mp4',
              timestamp: Date.now()
            };
            setMediaItems(prev => [newItem, ...prev]);
          } else if (name === 'generate_video_edit_video' && result?.media_id) {
            const newItem: MediaItem = {
              id: result.media_id,
              kind: 'video',
              status: 'completed',
              prompt: args.prompt || 'Video Transformation',
              modelId: 'omni-flash',
              modelName: 'Omni Flash',
              ratio: '16:9',
              url: 'https://assets.mixkit.co/videos/preview/mixkit-stars-in-space-background-1611-large.mp4',
              timestamp: Date.now()
            };
            setMediaItems(prev => [newItem, ...prev]);
          } else if (name === 'get_geo_grounding_image' && result?.streetview_id) {
            const newItem: MediaItem = {
              id: result.streetview_id,
              kind: 'image',
              status: 'completed',
              prompt: `Grounding location: ${args.location || 'US'}`,
              modelId: 'streetview',
              modelName: 'Google Street View',
              ratio: '16:9',
              url: result.image_url,
              timestamp: Date.now()
            };
            setMediaItems(prev => [newItem, ...prev]);
          } else if (name === 'analyze_artifact') {
             const targetItem = mediaItemsRef.current.find(m => m.id === args.media_id);
             if (targetItem && targetItem.url) {
                try {
                   const res = await fetch(targetItem.url);
                   const blob = await res.blob();
                   const base64 = await new Promise<string>((resolve, reject) => {
                       const reader = new FileReader();
                       reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
                       reader.onerror = reject;
                       reader.readAsDataURL(blob);
                   });
                   const visionModel = getGeminiClient(apiKey).getGenerativeModel({ model: 'gemini-3.5-flash' });
                   const visionRes = await visionModel.generateContent([
                       args.query,
                       { inlineData: { mimeType: blob.type, data: base64 } }
                   ]);
                   return {
                       media_id: args.media_id,
                       analysis: visionRes.response.text()
                   };
                } catch (e: any) {
                   return { media_id: args.media_id, error: 'Failed to visually analyze image: ' + e.message };
                }
             }
             return { media_id: args.media_id, error: 'Media not found or has no visual URL.' };
          }
          return result;
        }
      );
      
      setChatMessages(prev => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === 'assistant') {
          last.history = returnedHistory;
        }
        return next;
      });
    } catch (e: any) {
      setChatMessages(prev => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === 'assistant') {
          last.content = `Something went wrong: ${e?.message || 'Unknown error.'}`;
        }
        return next;
      });
    } finally {
      setIsAgentGenerating(false);
      setIsAgentThinking(false);
      setAgentStreaming('');
    }
  };

  const handleGenerate = async () => {
    const activePrompt = prompt.trim();
    if (!activePrompt) return;

    if (isLocalFolderConnected && !isLocalFolderAuthorized) {
      await authorizeLocalFolder();
    }

    if (isAgentActive) {
      void handleAgentSend(activePrompt);
      return;
    }

    setGenerationError(null);

    const activeAttachments = attachments.filter(Boolean);
    const attachmentIds = activeAttachments.map(att => att.id);
    if (attachmentIds.length > 0) {
      setRemovingIds(prev => {
        const next = new Set(prev);
        attachmentIds.forEach(id => next.add(id));
        return next;
      });
    }

    setPrompt('');

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

    const getApiKeyForModel = (modelIdStr: string) => {
      const isGPT = modelIdStr === 'gpt-image-2';
      const isGrok = modelIdStr === 'grok-imagine';
      const provider = isGrok ? 'spacexai' : isGPT ? 'openai' : 'gemini';
      return apiKeys?.[provider]?.[0] || '';
    };

    const activeModelId = modelMode === 'image' ? imageModel : videoModel;
    const apiKey = getApiKeyForModel(activeModelId);
    if (!apiKey) {
      const isGPT = activeModelId === 'gpt-image-2';
      const isGrok = activeModelId === 'grok-imagine';
      const providerName = isGrok ? 'Grok' : isGPT ? 'OpenAI' : 'Google Gemini';
      setGenerationError(`${providerName} API Key is missing. Please add it under Settings > Models & API.`);
      return;
    }

    const batchStr = modelMode === 'image' ? imageBatch : videoBatch;
    const batchCount = Math.max(1, parseInt(batchStr.replace('x', ''), 10) || 1);
    const activeRatio = modelMode === 'image' ? imageRatio : videoRatio;
    const activeModelName =
      modelMode === 'image' ? getImageModelName(imageModel) : getVideoModelName(videoModel);

    const batchTimestamps = allocateMediaBatchTimestamps(batchCount);
    const newItems: MediaItem[] = Array.from({ length: batchCount }, (_, i) => ({
      id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`,
      kind: modelMode,
      status: 'generating',
      prompt: activePrompt,
      modelId: activeModelId,
      modelName: activeModelName,
      ratio: activeRatio,
      timestamp: batchTimestamps[i],
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

    newItems.forEach(item => {
      if (item.kind === 'image') {
        void generateSingleImage(item, activePrompt, item.modelId, item.ratio, apiKey, activeAttachments);
      } else {
        void generateSingleVideo(item, activePrompt, item.modelId as VideoModelId, item.ratio, videoDuration, apiKey, activeAttachments);
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

    if (targetItem.kind === 'image') {
      void generateSingleImage(newItem, newItem.prompt, newItem.modelId, newItem.ratio, apiKey, newItem.attachments || []);
    } else {
      void generateSingleVideo(newItem, newItem.prompt, newItem.modelId as VideoModelId, newItem.ratio, videoDuration, apiKey, newItem.attachments || []);
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
    setPrompt(targetItem.prompt);
    setAttachments(targetItem.attachments || []);

    // 4. Focus the prompt input area
    textareaRef.current?.focus();
  };

  const completedItems = React.useMemo(() => {
    return mediaItems.filter((m) => m.status === 'completed' && m.url);
  }, [mediaItems]);

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
    if (selectedItem) {
      setViewerModelId(selectedItem.modelId);
      setViewerModelName(selectedItem.modelName);
    } else {
      setViewerModelId('');
      setViewerModelName('');
    }
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

  const handleViewerGenerate = async () => {
    if (!editPrompt.trim() || !selectedItem || isAnimating) return;

    const newModelId = viewerModelId || selectedItem.modelId;
    const newModelName = viewerModelName || selectedItem.modelName;
    const isGPT = newModelId === 'gpt-image-2';
    const isGrok = newModelId === 'grok-imagine';
    const provider = isGrok ? 'spacexai' : isGPT ? 'openai' : 'gemini';
    const apiKey = apiKeys?.[provider]?.[0];
    if (!apiKey) {
      const providerName = isGrok ? 'Grok' : isGPT ? 'OpenAI' : 'Google Gemini';
      setGenerationError(`${providerName} API Key is missing. Please add it under Settings > Models & API.`);
      return;
    }

    setSelectedItem(null);

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
      effort: imageEffort,
      quality: imageQuality,
      resolution: imageResolution,
    };

    setIsLayoutSuppressing(true);
    setMediaItems(prev => [newItem, ...prev]);
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
        setSelectedItem(item);
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
  const onTileDelete = useEventCallback((id: string) => {
    const item = mediaItemsRef.current.find(m => m.id === id);
    // If this item was shown via a disk blob: URL, revoke it.
    if (item?.url && item.url.startsWith('blob:')) {
      try { URL.revokeObjectURL(item.url); } catch {}
      mediaBlobUrlsRef.current = mediaBlobUrlsRef.current.filter(u => u !== item.url);
    }
    setMediaItems(prev => {
      const next = prev.filter(m => m.id !== id);
      // Persist removal to IndexedDB (unified on the real project id).
      if (persistProjectId) void saveProjectMedia(persistProjectId, next, chatScopeId);
      return next;
    });
    setAttachments(prev => prev.filter(a => a.id !== id));
    // Remove the actual file from disk (disk = source of truth)
    // so it doesn't reappear on the next reconcile.
    if (item?.fsName && item.kind) {
      void deleteLocalFSMediaFile(projectName, item.kind, item.fsName);
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
        const finalFsName = await renameLocalFSMediaFile(projectNameRef.current, targetKind, targetFsName, uniqueName);
        if (!finalFsName || finalFsName === targetFsName) return; // no folder/file → metadata-only rename
        setMediaItems(prev => {
          const next = prev.map(m => m.id === id ? { ...m, shortenedPrompt: uniqueName, fsName: finalFsName } : m);
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
        textareaRef.current?.focus();
      }, 50);
    }
  });
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
        textareaRef.current?.focus();
      }, 50);
    }
  });

  const galleryLayoutItems = React.useMemo((): Array<{item: MediaItem, ar: number, finalHeight: number, finalWidth: number, isCapped: boolean, isLastRow: boolean}> => {
  if (displayMediaItems.length > 0) {
    const targetH = isSidebarCollapsed ? 230 : 270;
    const gap = 12;
    // Sidebar left edge is 356px from screen edge. We want a 12px gap to images.
    // So total distance from screen edge to images should be 368px.
    // Since scrollbar takes up `scrollbarWidth` space, padding needs to be 368 - scrollbarWidth.
    const activePaddingRight = Math.max(12, 368 - scrollbarWidth);
    // Subtract 2px of safety margin to absorb browser floating-point rounding errors and prevent accidental wrapping of tiles
    // Subtract 3px for the left padding added to prevent left-side outline clipping
    const visibleWidth = Math.max(1, ((isAgentSidebarOpen || !!activeMusicItem) ? Math.max(1, canvasInnerWidth + 12 - activePaddingRight) : Math.max(1, canvasInnerWidth)) - 5);
    
    // We bias the target height up by 20% for layout calculations.
    // This perfectly tunes the algorithm's distance check to match your exact preferred rhythm:
    // It naturally wraps to exactly 2 items when the left sidebar is open, 3 items when full width,
    // and correctly scales them down to fit 2 items when both sidebars are open!
    const layoutTargetH = targetH * 1.2;
    
    const rows: Array<{ items: Array<{item: MediaItem, ar: number}>, sumAR: number, isLast: boolean, height: number }> = [];
    let currentRow: Array<{item: MediaItem, ar: number}> = [];
    let currentRowSumAR = 0;

    const getRowHeight = (sumAR: number, count: number) => {
      if (count === 0) return 0;
      return (visibleWidth - (count - 1) * gap) / sumAR;
    };
    
    // We penalize the difference between the resulting height and our tuned ideal height
    const getDiff = (h: number) => Math.abs(h - layoutTargetH);

      const sortedMediaItems = [...displayMediaItems].sort(compareMediaItemsNewestFirst);
      sortedMediaItems.forEach((item) => {
        const ratio = item.ratio;
        let ar = 16 / 9;
        if (ratio === '4:3') ar = 4 / 3;
        else if (ratio === '1:1') ar = 1;
        else if (ratio === '3:4') ar = 3 / 4;
        else if (ratio === '9:16') ar = 9 / 16;
        else if (ratio.includes(':')) {
          const [w, h] = ratio.split(':').map(Number);
          if (w && h) ar = w / h;
        }
        
        const arWithItem = currentRowSumAR + ar;
      const countWithItem = currentRow.length + 1;
      const heightWithItem = getRowHeight(arWithItem, countWithItem);
      
      if (currentRow.length === 0) {
        currentRow.push({ item, ar });
        currentRowSumAR = ar;
      } else {
        const heightWithoutItem = getRowHeight(currentRowSumAR, currentRow.length);
        if (getDiff(heightWithItem) <= getDiff(heightWithoutItem)) {
          currentRow.push({ item, ar });
          currentRowSumAR = arWithItem;
        } else {
          rows.push({ items: currentRow, height: heightWithoutItem, sumAR: currentRowSumAR, isLast: false });
          currentRow = [{ item, ar }];
          currentRowSumAR = ar;
        }
      }
    });
    
    if (currentRow.length > 0) {
      rows.push({ items: currentRow, height: getRowHeight(currentRowSumAR, currentRow.length), sumAR: currentRowSumAR, isLast: true });
    }

    let sumHeights = 0;
    let fullRowsCount = 0;
    for (let i = 0; i < rows.length; i++) {
      if (!rows[i].isLast) {
        sumHeights += rows[i].height;
        fullRowsCount++;
      }
    }
    const averageFullRowHeight = fullRowsCount > 0 ? sumHeights / fullRowsCount : layoutTargetH;

    const layoutItems: Array<{item: MediaItem, ar: number, finalHeight: number, finalWidth: number, isCapped: boolean, isLastRow: boolean}> = [];
    rows.forEach((row) => {
      let finalRowHeight = row.height;
      let isCapped = false;
      if (row.isLast) {
        const capHeight = fullRowsCount > 0 ? averageFullRowHeight : layoutTargetH;
        if (finalRowHeight > capHeight * 1.5) {
          finalRowHeight = capHeight;
          isCapped = true;
        }
      }
      row.items.forEach(cell => {
        layoutItems.push({
          item: cell.item,
          ar: cell.ar,
          finalHeight: finalRowHeight,
          finalWidth: finalRowHeight * cell.ar,
          isCapped,
          isLastRow: row.isLast
        });
      });
    });
    return layoutItems;
  }
  return [];
  }, [displayMediaItems, isSidebarCollapsed, scrollbarWidth, isAgentSidebarOpen, activeMusicItem, canvasInnerWidth]);

  const isContextMenuActive = activeMenuId !== null && activeMenuId.endsWith('-context');

  if (activeSidebarTab === 'characters') {
    return (
      <div className="h-screen w-screen bg-[#000000] overflow-hidden relative">
        <CharactersView 
          onBack={() => navigate(-1)} 
          mediaItems={mediaItems} 
          onFileSelect={() => fileInputRef.current?.click()} 
          modelMode={modelMode}
          activeModelId={modelMode === 'image' ? imageModel : videoModel}
          onModelChange={(id) => {
            if (modelMode === 'image') {
              setImageModel(id as any);
            } else {
              setVideoModel(id as any);
            }
          }}
        />
      </div>
    );
  }

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
          availableModels={availableMusicModels}
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
          availableModels={availableMusicModels}
          initialItem={fullscreenMusicItem}
        />
      </div>
    );
  }

  return (
    <div
      className={`relative flex flex-col h-screen w-screen bg-[#000000] text-gray-200 overflow-hidden ${
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
      
      {/* Fading Backdrop Blur & Dark Gradient Strip */}
      <div 
        className="absolute inset-x-0 top-0 h-32 pointer-events-none z-[70]"
        style={{
          background: 'linear-gradient(to bottom, rgba(0, 0, 0, 0.95) 0%, rgba(0, 0, 0, 0.6) 40%, rgba(0, 0, 0, 0.15) 75%, transparent 100%)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          maskImage: 'linear-gradient(to bottom, black 0%, rgba(0, 0, 0, 0.9) 35%, rgba(0, 0, 0, 0.3) 70%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 0%, rgba(0, 0, 0, 0.9) 35%, rgba(0, 0, 0, 0.3) 70%, transparent 100%)',
          transform: (isHeaderVisible && !isAtTop) ? 'translateY(0)' : 'translateY(-56px)',
          opacity: (isHeaderVisible && !isAtTop) ? 1 : 0,
          transition: isHeaderVisible
            ? 'transform 0.78s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.78s cubic-bezier(0.16, 1, 0.3, 1)'
            : 'transform 0.68s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.68s cubic-bezier(0.16, 1, 0.3, 1)'
        }}
      />

      {/* Top Header.
        * 76px tall with 24px of left inset and 20px of right, which is what puts every control
        * in the row on Flow's centre line at y=38 and lines the back arrow's glyph up with the
        * rail's glyphs at x=28. The rail below already assumed this height (`pt-[76px]`). */}
      <header 
        ref={headerRef}
        className="absolute top-0 left-0 right-0 h-[76px] flex items-center justify-between pl-6 pr-5 shrink-0 z-[80] bg-transparent pointer-events-none"
        style={{
          transform: isHeaderVisible ? 'translateY(0)' : 'translateY(-56px)',
          opacity: isHeaderVisible ? 1 : 0,
          transition: isHeaderVisible
            // Let the search reach full contrast before the slower backdrop blur finishes revealing.
            ? 'transform 0.78s cubic-bezier(0.16, 1, 0.3, 1), opacity 160ms ease-out'
            : 'transform 0.68s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.68s cubic-bezier(0.16, 1, 0.3, 1)'
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
          className={`flex items-center gap-2 shrink-0 transition-opacity duration-200 ${
            isSearchOpen ? 'opacity-0 pointer-events-none' : isHeaderVisible ? 'pointer-events-auto' : 'pointer-events-none'
          }`}
        >
          {/* Flow's header controls are all 32x32 with a 16px radius, and every glyph in the
            * header and rail is Google Symbols at 24px with `"FILL" 0, "wght" 300`. */}
          <button 
            onClick={() => navigate('/?mode=media')}
            className="w-8 h-8 shrink-0 flex items-center justify-center hover:bg-white/10 rounded-2xl transition-colors text-white"
            title="Go Back"
          >
            <MaterialSymbol name="arrow_back" family="google-symbols" size={24} weight={400} variationSettings='"FILL" 0, "wght" 300' />
          </button>
          {/* 16px/24px regular Google Sans Text, 16px in from the flex gap. Flow's name is an
            * always-live <input> sized by its `size` attribute, so it grows with the title; the
            * span here is Willow's read mode and carries the hover pill that a plain input would
            * not need. Its negative margin cancels the pill's padding, so entering and leaving
            * hover does not shift the three-dot button. */}
          <div className="flex items-center min-w-0 pl-4" style={{ fontFamily: PROJECT_NAME_FONT }}>
            {isEditingProjectName ? (
              <input
                type="text"
                size={Math.max(1, editingProjectNameValue.length)}
                value={editingProjectNameValue}
                onChange={(e) => setEditingProjectNameValue(e.target.value)}
                onKeyDown={(e) => {
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
                  // Enter/Escape already resolved this edit — the blur fired by
                  // the input unmounting must not commit again (or at all,
                  // after a cancel).
                  if (projectRenameResolvedRef.current) {
                    projectRenameResolvedRef.current = false;
                    return;
                  }
                  void commitProjectRename(editingProjectNameValue);
                }}
                onFocus={(e) => e.currentTarget.select()}
                className="bg-transparent border-none outline-none text-base leading-6 font-normal tracking-normal text-white max-w-[210px]"
                autoFocus
                spellCheck={false}
              />
            ) : (
              <span
                className="text-base leading-6 font-normal tracking-normal text-white cursor-text hover:bg-white/10 rounded-lg px-1.5 -mx-1.5 transition-colors truncate max-w-[210px]"
                title="Rename project"
                onClick={() => {
                  projectRenameResolvedRef.current = false;
                  setEditingProjectNameValue(projectName);
                  setIsEditingProjectName(true);
                }}
              >
                {projectName}
              </span>
            )}
          </div>
          {/* Flow dims this one to 50% white, unlike the header-right group. */}
          <button
            className="w-8 h-8 shrink-0 flex items-center justify-center hover:bg-white/10 rounded-2xl transition-colors hover:text-white"
            style={{ color: 'rgba(255, 255, 255, 0.5)' }}
            title="More options"
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
                title="Sort & Filter"
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
          {/* 32x32 at a 16px radius with 12px between them, and 24px glyphs at
            * `"FILL" 0, "wght" 300` — Flow's header group, measured off the live app. */}
          <div className={`flex items-center gap-3 transition-opacity duration-200 ${isSearchOpen ? 'opacity-0 pointer-events-none' : ''}`}>
            <button className={HEADER_ICON_BUTTON} title="Add Media">
              <MaterialSymbol name="add" family="google-symbols" size={24} weight={400} variationSettings={HEADER_ICON_AXES} />
            </button>
            <button className={HEADER_ICON_BUTTON} title="Product Help">
              <MaterialSymbol name="help" family="google-symbols" size={24} weight={400} variationSettings={HEADER_ICON_AXES} />
            </button>
            <button
              ref={viewSettingsButtonRef}
              onClick={() => setOpenHeaderMenu((m) => (m === 'settings' ? null : 'settings'))}
              className={HEADER_ICON_BUTTON}
              title="View Settings"
            >
              <MaterialSymbol name="settings_2" family="google-symbols" size={24} weight={400} variationSettings={HEADER_ICON_AXES} />
            </button>
            <button
              ref={moreMenuButtonRef}
              onClick={() => setOpenHeaderMenu((m) => (m === 'more' ? null : 'more'))}
              className={HEADER_ICON_BUTTON}
              title="More"
            >
              <MaterialSymbol name="more_vert" family="google-symbols" size={24} weight={400} variationSettings={HEADER_ICON_AXES} />
            </button>
          </div>

          <button
            ref={accountButtonRef}
            className="flex items-center h-11 bg-[#171717] rounded-2xl pl-3 pr-1 gap-2 hover:bg-[#202020] transition-colors border border-transparent hover:border-white/10"
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

      <ViewSettingsMenu
        open={openHeaderMenu === 'settings'}
        onClose={closeHeaderMenu}
        anchorRef={viewSettingsButtonRef}
        settings={viewSettings}
        onChange={setViewSettings}
      />
      <MoreMenu open={openHeaderMenu === 'more'} onClose={closeHeaderMenu} anchorRef={moreMenuButtonRef} />
      <SortFilterMenu
        open={openHeaderMenu === 'filter'}
        onClose={closeHeaderMenu}
        anchorRef={sortFilterButtonRef}
        value={sortFilter}
        onChange={setSortFilter}
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
        <aside className={`${isSidebarCollapsed ? 'w-[80px]' : 'w-[244px]'} flex flex-col justify-between pt-[76px] pb-2 px-4 shrink-0 relative z-[75]`}>
          <nav 
            className="flex flex-col gap-[4.8px]"
            style={{
              transform: isHeaderVisible ? 'translateY(0)' : 'translateY(-56px)',
              transition: `transform ${currentSidebarTransitionTiming}`
            }}
          >
            <button 
              onClick={() => navigate('/media' + location.search)}
              className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'gap-4 pl-3 pr-4'} h-12 ${activeSidebarTab === 'all' ? /* `!` because the row's base colour is an arbitrary value; without it the two
                 * classes tie on specificity and Tailwind's output order decides, which put the
                 * dimmed colour on the selected row. */
                'bg-[rgba(218,220,224,0.25)] !text-white' : 'hover:bg-[#171717]'} rounded-2xl text-[#e8eaed] transition-colors group`}
            >
              <AllMediaIcon />
              {!isSidebarCollapsed && <span className="text-[14px] leading-5 font-medium">All Media</span>}
            </button>
            <button 
              onClick={() => navigate('/media/images' + location.search)}
              className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'gap-4 pl-3 pr-4'} h-12 ${activeSidebarTab === 'images' ? /* `!` because the row's base colour is an arbitrary value; without it the two
                 * classes tie on specificity and Tailwind's output order decides, which put the
                 * dimmed colour on the selected row. */
                'bg-[rgba(218,220,224,0.25)] !text-white' : 'hover:bg-[#171717]'} rounded-2xl text-[#e8eaed] transition-colors group`}
            >
              <ImagesIcon />
              {!isSidebarCollapsed && <span className={`text-[14px] leading-5 font-medium`}>Images</span>}
            </button>
            <button 
              onClick={() => navigate('/media/video' + location.search)}
              className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'gap-4 pl-3 pr-4'} h-12 ${activeSidebarTab === 'video' ? /* `!` because the row's base colour is an arbitrary value; without it the two
                 * classes tie on specificity and Tailwind's output order decides, which put the
                 * dimmed colour on the selected row. */
                'bg-[rgba(218,220,224,0.25)] !text-white' : 'hover:bg-[#171717]'} rounded-2xl text-[#e8eaed] transition-colors group`}
            >
              <VideoIcon />
              {!isSidebarCollapsed && <span className={`text-[14px] leading-5 font-medium`}>Video</span>}
            </button>
            <button 
              onClick={() => navigate('/media/characters' + location.search)}
              className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'gap-4 pl-3 pr-4'} h-12 ${activeSidebarTab === 'characters' ? /* `!` because the row's base colour is an arbitrary value; without it the two
                 * classes tie on specificity and Tailwind's output order decides, which put the
                 * dimmed colour on the selected row. */
                'bg-[rgba(218,220,224,0.25)] !text-white' : 'hover:bg-[#171717]'} rounded-2xl text-[#e8eaed] transition-colors group`}
            >
              <CharactersIcon />
              {!isSidebarCollapsed && <span className="text-[14px] leading-5 font-medium">Characters</span>}
            </button>
            <button 
              onClick={() => navigate('/media/music' + location.search)}
              className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'gap-4 pl-3 pr-4'} h-12 ${activeSidebarTab === 'music' ? /* `!` because the row's base colour is an arbitrary value; without it the two
                 * classes tie on specificity and Tailwind's output order decides, which put the
                 * dimmed colour on the selected row. */
                'bg-[rgba(218,220,224,0.25)] !text-white' : 'hover:bg-[#171717]'} rounded-2xl text-[#e8eaed] transition-colors group`}
            >
              <MusicIcon />
              {!isSidebarCollapsed && <span className="text-[14px] leading-5 font-medium">Music</span>}
            </button>
            <button className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'gap-4 pl-3 pr-4'} h-12 hover:bg-[#171717] rounded-2xl text-[#e8eaed] transition-colors group`}>
              <ScenesIcon />
              {!isSidebarCollapsed && <span className="text-[14px] leading-5 font-medium">Scenes</span>}
            </button>
            <button 
              onClick={() => navigate('/media/uploads' + location.search)}
              className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'gap-4 pl-3 pr-4'} h-12 ${activeSidebarTab === 'uploads' ? /* `!` because the row's base colour is an arbitrary value; without it the two
                 * classes tie on specificity and Tailwind's output order decides, which put the
                 * dimmed colour on the selected row. */
                'bg-[rgba(218,220,224,0.25)] !text-white' : 'hover:bg-[#171717]'} rounded-2xl text-[#e8eaed] transition-colors group`}
            >
              <UploadsIcon />
              {!isSidebarCollapsed && <span className={`text-[14px] leading-5 font-medium`}>Uploads</span>}
            </button>

            {/* Flow runs this rule the full width of a row when expanded, and pulls it in to a
              * 32px stub — 8px either side of the 48px column — when collapsed. */}
            <div className={`h-[1px] bg-white/20 ${isSidebarCollapsed ? 'mx-2' : 'mx-0'} my-2`} />

            <button className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'gap-4 pl-3 pr-4'} h-12 hover:bg-[#171717] rounded-2xl text-[#e8eaed] transition-colors group`}>
              <ToolsIcon />
              {!isSidebarCollapsed && <span className="text-[14px] leading-5 font-medium">Tools</span>}
            </button>
          </nav>

          <nav className="flex flex-col gap-[4.8px] mb-2">
            <button className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'gap-4 pl-3 pr-4'} h-12 hover:bg-[#171717] rounded-2xl text-[#e8eaed] transition-colors group`}>
              <TrashIcon />
              {!isSidebarCollapsed && <span className="text-[14px] leading-5 font-medium">Trash</span>}
            </button>
            <button
              onClick={handleToggleLeftSidebar}
              className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'gap-4 pl-3 pr-4'} h-12 hover:bg-[#171717] rounded-2xl text-[#e8eaed] transition-colors group`}
            >
              <CollapseIcon />
              {!isSidebarCollapsed && <span className="text-[14px] leading-5 font-medium">Collapse</span>}
            </button>
          </nav>
        </aside>

        {/* Center Canvas */}
        <main
          ref={attachMainRef}
          onScroll={handleScroll}
          className={`flex-1 bg-transparent relative z-[60] -ml-[3px] pl-[3px] no-scrollbar ${
            renamingItemId ? 'overflow-hidden' : 'overflow-y-scroll'
          }`}
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
          {displayMediaItems.length > 0 && (
            <div
              className="flex flex-wrap gap-3 pt-[72px] pb-44 w-full"
              style={{ 
                paddingRight: (isAgentSidebarOpen || !!activeMusicItem) ? `${Math.max(12, 368 - scrollbarWidth)}px` : '12px'
              }}
            >
              {galleryLayoutItems.map(({ item, ar, finalHeight, finalWidth, isCapped, isLastRow }) => {
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
                      className={`gallery-tile relative rounded-[18px] bg-[#141517] hover:bg-[#1f2023] transition-colors shadow-2xl flex flex-col items-center justify-center cursor-pointer border-none group overflow-hidden`}
                    >
                       <Plus size={32} strokeWidth={1.5} className="text-[#a0a0a0] group-hover:text-white transition-colors mb-4" />
                       <span className="text-[13px] font-medium text-[#a0a0a0] group-hover:text-white transition-colors tracking-wide">New music</span>
                    </motion.div>
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
                      dimmed={Boolean(
                        (renamingItemId && renamingItemId !== item.id) ||
                        (draggingItemId && draggingItemId !== item.id) ||
                        (selectedTileIds.size > 0 && !selectedTileIds.has(item.id))
                      )}
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
                    />
                  );
                })}
            </div>
          )}
        </main>
      </div>

      {/* Centered Flower Empty State */}
      {displayMediaItems.length === 0 && (
        <div 
          className="absolute top-[48%] flex flex-col items-center justify-center pointer-events-none z-10 transition-all"
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
        className="absolute bottom-8 left-1/2 w-full max-w-[600px] z-[80] transition-all duration-300 ease-in-out prompt-container-box"
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
              setPrompt(prev => {
                const separator = prev.trim() ? ' ' : '';
                return `${prev.trim()}${separator}[${assetTitle}]`;
              });
            }
          }}
        />
        {/*
          * Geometry, colour and type here are measured off Google Flow's composer, not
          * chosen — see tools/ui-research/captures/flow/composer/. Flow's edge is an inset
          * shadow rather than a real border, which is why the drag-over emphasis is also an
          * inset shadow: a real border would change the box size and shift the contents.
          */}
        <div 
          className={`relative rounded-[24px] flex flex-col prompt-container-box ${
            (draggingItemId && isFramesMode)
              ? 'bg-transparent border-none shadow-none p-0'
              : 'backdrop-blur-[80px]'
          } ${
            (draggingItemId && !isFramesMode) ? 'transition-all duration-300' : ''
          }`}
          onFocus={() => setIsComposerFocused(true)}
          onBlur={() => setIsComposerFocused(false)}
          style={{
            transform: (isDragOverPrompt && !isFramesMode) ? 'scale(1.015)' : 'scale(1)',
            transition: (draggingItemId && !isFramesMode) ? 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)' : 'none',
            ...((draggingItemId && isFramesMode) ? {} : {
              backgroundColor: 'rgba(22, 23, 24, 0.9)',
              padding: '12px 8px 8px 10px',
              gap: '4px',
              minHeight: '90px',
              maxHeight: '460px',
              overflow: 'hidden',
              /* Focus brightens the inset edge from 0.1 to 0.15 and drops a soft shadow under the
               * shell. Flow applies both with no transition, so they snap in on the click. */
              boxShadow: (isDragOverPrompt && !isFramesMode)
                ? 'inset 0 0 0 1.5px rgba(255, 255, 255, 0.9)'
                : isComposerFocused
                  ? 'inset 0 0 0 1px rgba(218, 220, 224, 0.15), 0 16px 32px -8px rgba(0, 0, 0, 0.4)'
                  : 'inset 0 0 0 1px rgba(218, 220, 224, 0.1)',
            }),
            fontFamily: "'Google Sans Text', 'Inter', system-ui, -apple-system, sans-serif",
          }}
        >
          {(!draggingItemId || !isFramesMode) && isAgentActive && agentAnimationKey > 0 && (
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
            {(!draggingItemId || !isFramesMode) && isAgentActive && isAgentGenerating && (
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
            isFramesMode ? (
              <div className="flex gap-3 w-full h-[96px]">
                {/* Start Frame Dropzone */}
                <div
                  data-drop-zone="start"
                  style={{
                    transform: draggedOverZone === 'start' ? 'scale(1.015)' : 'scale(1)',
                    borderWidth: draggedOverZone === 'start' ? '1.5px' : '1px',
                    borderColor: draggedOverZone === 'start' ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.05)',
                    transition: draggingItemId ? 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)' : 'none',
                  }}
                  className="flex-1 flex items-center justify-center bg-[#18191b] rounded-[22px] select-none cursor-pointer border border-solid"
                >
                  <span className="text-[15px] font-semibold text-white tracking-wide pointer-events-none flex items-center gap-1.5">
                    <span className="text-[17px] font-light leading-none pointer-events-none">+</span> Add start frame
                  </span>
                </div>

                {/* End Frame Dropzone */}
                <div
                  data-drop-zone="end"
                  style={{
                    transform: draggedOverZone === 'end' ? 'scale(1.015)' : 'scale(1)',
                    borderWidth: draggedOverZone === 'end' ? '1.5px' : '1px',
                    borderColor: draggedOverZone === 'end' ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.05)',
                    transition: draggingItemId ? 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)' : 'none',
                  }}
                  className="flex-1 flex items-center justify-center bg-[#18191b] rounded-[22px] select-none cursor-pointer border border-solid"
                >
                  <span className="text-[15px] font-semibold text-white tracking-wide pointer-events-none flex items-center gap-1.5">
                    <span className="text-[17px] font-light leading-none pointer-events-none">+</span> Add end frame
                  </span>
                </div>
              </div>
            ) : (
              <div 
                className="flex items-center justify-center w-full select-none pointer-events-none"
                style={{ height: '76px' }}
              >
                <span className="text-[15px] font-semibold text-white tracking-wide pointer-events-none">
                  + Add Ingredient
                </span>
              </div>
            )
          ) : (
            <>
          {hoveredAttachmentUrl && hoveredAttachmentRect && (
            <div 
              style={{
                left: `${hoveredAttachmentRect.left + hoveredAttachmentRect.width / 2}px`,
                transform: 'translate(-50%, 0)'
              }}
              className="absolute bottom-full z-50 pointer-events-auto pb-0"
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
                  className={`max-h-[320px] max-w-[400px] object-contain block ${hoveredAttachmentIsEndFrame && videoModel === 'omni-flash' ? 'grayscale' : ''}`} 
                />
                {hoveredAttachmentIsEndFrame && videoModel === 'omni-flash' && (
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
            </div>
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
          {/* `hidden` when empty, not merely zero-height: the shell is a flex column with a
            * 4px gap, and a collapsed-but-present child still earns its gap — which made the
            * resting box 98px instead of Flow's 94px. */}
          <div className={`grid transition-[grid-template-rows,margin-bottom] duration-[350ms] ease-in-out ${(hasActiveAttachments || (modelMode === 'video' && videoMode === 'frames')) ? 'grid-rows-[1fr] mb-0' : 'grid-rows-[0fr] mb-0 hidden'}`}>
            <div className="overflow-hidden">
              {showFramesPlaceholders ? (
                <div className="flex items-center gap-2 px-2 pt-2 pb-2.5">
                  {/* Start Frame */}
                  {attachments[0] ? (
                    <div 
                      onMouseEnter={(e) => {
                        if (isModelMenuOpen || isAssetMenuOpen) return;
                        handleAttachmentMouseEnter(e, attachments[0].url);
                      }}
                      onMouseLeave={handleAttachmentMouseLeave}
                      className={`relative group flex-shrink-0 p-1.5 -m-1.5 transition-all duration-200 ${removingIds.has(attachments[0].id) ? 'opacity-0 scale-90' : 'opacity-100 scale-100 animate-in fade-in zoom-in-95'}`}
                    >
                      <div className="relative">
                        <div className="w-16 h-16 rounded-2xl overflow-hidden border border-white/5 bg-[#1c1c1e]">
                          {attachments[0].kind === 'video' ? (
                            <video src={attachments[0].url} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" muted loop playsInline />
                          ) : (
                            <img src={attachments[0].url} alt={attachments[0].name} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                          )}
                        </div>
                        <button 
                          onClick={() => removeAttachment(attachments[0].id)}
                          className={`absolute -top-1.5 -right-1.5 bg-[#27272a] text-gray-400 hover:text-white border border-white/10 rounded-full p-1 transition-all duration-200 shadow-xl z-[60] ${
                            hoveredAttachmentUrl === attachments[0].url ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 hover:opacity-100'
                          }`}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setAssetMenuSource('main');
                        setIsAssetMenuOpen(true);
                      }}
                      className="w-16 h-16 flex items-center justify-center rounded-2xl border border-dashed border-white/20 bg-transparent hover:bg-white/[0.02] hover:border-white/35 transition-all duration-200 cursor-pointer outline-none group"
                    >
                      <span className="text-[12px] font-semibold text-[#909398] group-hover:text-white transition-colors select-none">Start</span>
                    </button>
                  )}

                   {/* Arrow Icon ⇆ */}
                  <div className="flex items-center justify-center select-none text-[#505050] shrink-0">
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                      {/* Top arrow pointing right (distinctly shifted right) */}
                      <path d="M 7,5.5 H 16 V 2.5 L 23,7 L 16,11.5 V 8.5 H 7 Z" />
                      {/* Bottom arrow pointing left (distinctly shifted left) */}
                      <path d="M 17,15.5 H 8 V 12.5 L 1,17 L 8,21.5 V 18.5 H 17 Z" />
                    </svg>
                  </div>

                  {/* End Frame */}
                  {attachments[1] ? (
                    <div 
                      onMouseEnter={(e) => {
                        if (isModelMenuOpen || isAssetMenuOpen) return;
                        handleAttachmentMouseEnter(e, attachments[1].url, true);
                      }}
                      onMouseLeave={handleAttachmentMouseLeave}
                      className={`relative group flex-shrink-0 p-1.5 -m-1.5 transition-all duration-200 ${removingIds.has(attachments[1].id) ? 'opacity-0 scale-90' : 'opacity-100 scale-100 animate-in fade-in zoom-in-95'}`}
                    >
                      <div className="relative">
                        <div className={`w-16 h-16 rounded-2xl overflow-hidden border border-white/5 bg-[#1c1c1e] relative ${videoModel === 'omni-flash' ? 'grayscale' : ''}`}>
                          {attachments[1].kind === 'video' ? (
                            <video src={attachments[1].url} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" muted loop playsInline />
                          ) : (
                            <img src={attachments[1].url} alt={attachments[1].name} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                          )}
                          {videoModel === 'omni-flash' && (
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
                          onClick={() => removeAttachment(attachments[1].id)}
                          className={`absolute -top-1.5 -right-1.5 bg-[#27272a] text-gray-400 hover:text-white border border-white/10 rounded-full p-1 transition-all duration-200 shadow-xl z-[60] ${
                            hoveredAttachmentUrl === attachments[1].url ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 hover:opacity-100'
                          }`}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setAssetMenuSource('main');
                        setIsAssetMenuOpen(true);
                      }}
                      className="w-16 h-16 flex items-center justify-center rounded-2xl border border-dashed border-white/20 bg-transparent hover:bg-white/[0.02] hover:border-white/35 transition-all duration-200 cursor-pointer outline-none group"
                    >
                      <span className="text-[12px] font-semibold text-[#909398] group-hover:text-white transition-colors select-none">End</span>
                    </button>
                  )}
                </div>
              ) : (
                <div
                  /* 50px thumbs at radius 12 with 4px gaps, wrapping rather than scrolling
                   * sideways — measured off Flow's composer. */
                  className="flex flex-wrap gap-[4px] overflow-y-auto no-scrollbar"
                  style={{ padding: '0 16px 4px 8px' }}
                >
                  {attachments.filter(Boolean).map((att) => (
                    <div 
                      key={att.id} 
                      onMouseEnter={(e) => {
                        if (isModelMenuOpen || isAssetMenuOpen) return;
                        handleAttachmentMouseEnter(e, att.url);
                      }}
                      onMouseLeave={handleAttachmentMouseLeave}
                      className={`relative group flex-shrink-0 transition-all duration-200 ${removingIds.has(att.id) ? 'opacity-0 scale-90' : 'opacity-100 scale-100 animate-in fade-in zoom-in-95'}`}
                    >
                      <div className="relative w-[50px] h-[50px]">
                        <div className="w-[50px] h-[50px] rounded-[12px] overflow-hidden bg-[#1c1c1e]">
                          {att.kind === 'video' ? (
                            <video src={att.url} className="w-full h-full object-cover" muted loop playsInline />
                          ) : (
                            <img src={att.url} alt={att.name} className="w-full h-full object-cover" />
                          )}
                        </div>
                        <button 
                          onClick={() => removeAttachment(att.id)}
                          style={{ backgroundColor: 'rgba(27, 27, 27, 0.5)' }}
                          className={`absolute inset-0 w-[50px] h-[50px] flex items-center justify-center rounded-[12px] text-white transition-opacity duration-200 z-[60] ${
                            hoveredAttachmentUrl === att.url ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 hover:opacity-100'
                          }`}
                        >
                          <X size={16} strokeWidth={2} />
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

          {generationError && (
            <div className="p-3 mx-1 bg-red-950/20 border border-red-500/20 rounded-xl text-xs text-red-300 flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-1 duration-200">
              <span className="font-semibold leading-relaxed">{generationError}</span>
              <button onClick={() => setGenerationError(null)} className="p-1 hover:bg-white/5 rounded-full text-red-400 hover:text-white transition-colors shrink-0 cursor-pointer">
                <X size={14} strokeWidth={2.5} />
              </button>
            </div>
          )}

          {/* Flow's text row: 4px above, 12px below, 16px to the right of the caret, and a
            * 27px floor. Those paddings are what make the resting box 94px rather than 90. */}
          <div
            className="relative flex items-start w-full flex-1"
            style={{ padding: '4px 16px 12px 0', minHeight: '27px' }}
          >
            {isAgentGenerating ? (
              <div className="w-full flex items-start min-h-[24px]">
                <TextShimmer className="text-[14px] font-medium pl-1 py-0.5" duration={1.5}>
                  {agentThinkingPhase === 'searching' ? 'Searching...' :
                   agentThinkingPhase === 'executing' ? 'Running code...' : 'Thinking...'}
                </TextShimmer>
              </div>
            ) : (
              <textarea 
                ref={textareaRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onScroll={(e) => updateFades(e.currentTarget)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleGenerate();
                  }
                }}
                onPaste={async (e) => {
                  const items = e.clipboardData?.items;
                  if (!items) return;
                  const files: File[] = [];
                  for (let i = 0; i < items.length; i++) {
                    const type = items[i].type;
                    if (type.startsWith('image/') || type.startsWith('video/') || type.startsWith('audio/')) {
                      const file = items[i].getAsFile();
                      if (file) files.push(file);
                    }
                  }
                  if (files.length > 0) {
                    e.preventDefault();
                    await processUploads(files);
                  }
                }}
                rows={1}
                placeholder="What do you want to create?" 
                /* 14px/20px at weight 400 in white — Flow's values.
                 *
                 * The placeholder is white at 0.333 alpha. Flow's editable is a Slate
                 * contenteditable, so its hint is a positioned span rather than a
                 * ::placeholder, and it carries `opacity: 0.333` over the same white the
                 * typed text uses. Reading ::placeholder off that div returns the div's own
                 * inherited style — solid white — which is where the earlier white/75 came
                 * from, and it rendered far brighter than Flow's. */
                /* No vertical padding: the row above supplies Flow's 4px/12px, and py-0.5
                 * here stacked on top of it and made the resting box 4px too tall. */
                /* pl-2, not pl-1: Flow pads its editable 8px, which with the shell's 10px puts the
                 * first glyph 18px in. At 4px Willow's text started 4px to the left of Flow's. */
                className={`bg-transparent border-none outline-none text-white placeholder-white/[0.333] w-full pl-2 resize-none max-h-[384px] overflow-y-auto no-scrollbar transition-all duration-200 ${
                  isTopFaded && isBottomFaded ? 'both-fade' : 
                  isTopFaded ? 'top-fade' : 
                  isBottomFaded ? 'bottom-fade' : ''
                }`}
                /* Size and weight are set inline, not via the utility class: something in the
                 * cascade was winning over `text-[14px]` and the field measured 16px. */
                style={{ 
                  scrollbarWidth: 'none', 
                  msOverflowStyle: 'none', 
                  fontSize: '14px',
                  lineHeight: '20px',
                  fontWeight: 400,
                  paddingRight: isAgentActive ? (prompt ? '44px' : '24px') : (prompt ? '20px' : '14px') 
                }}
              />
            )}
            {isAgentActive ? (
              <div
                /* Flow places these 8px from the shell's top and right edges. This row sits
                 * inside the text row, which begins 12px down and ends at the shell's 8px
                 * right padding — hence top -4 and right 0, with a 4px gap between them.
                 * The clear button is deliberately dimmer than the expand button. */
                className="absolute right-0 top-[-4px] flex items-center gap-1"
              >
                {/* Clear Button (shown if text is entered and not generating) */}
                {prompt && !isAgentGenerating && (
                  <button 
                    onClick={() => setPrompt('')}
                    style={{ color: 'rgba(218, 220, 224, 0.5)' }}
                    className="w-8 h-8 shrink-0 flex items-center justify-center p-1.5 rounded-full transition-colors hover:text-white hover:bg-white/5 cursor-pointer outline-none focus:outline-none focus:ring-0"
                    title="Clear prompt"
                  >
                    <MaterialSymbol name="close" family="google-symbols" size={16} weight={400} variationSettings='"FILL" 1' />
                  </button>
                )}
                
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
              prompt && (
                <button
                  onClick={() => setPrompt('')}
                  style={{ color: 'rgba(218, 220, 224, 0.5)' }}
                  /* With the agent off there is no expand button, and Flow does not shift the clear
                    * button left to compensate — it puts it in that same top-right corner slot, 32x32
                    * with both edges 8px inside the shell. `right-0 top-[-4px]` IS that corner: this
                    * row's padding box starts at the shell's 8px right inset and 12px below its top.
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
                  className="absolute right-0 top-[-4px] w-8 h-8 shrink-0 flex items-center justify-center p-1.5 rounded-full transition-colors hover:text-white hover:bg-white/5 cursor-pointer outline-none focus:outline-none focus:ring-0"
                  title="Clear prompt"
                >
                  <MaterialSymbol name="close" family="google-symbols" size={16} weight={400} variationSettings='"FILL" 1' />
                </button>
              )
            )}
          </div>
          
          {/* Control row: 34px tall, 5px gaps. The shell's own 4px gap separates it from
            * the textarea above, so this carries no top margin of its own. */}
          <div className="flex items-center justify-between h-[34px]">
            
            {/* Left Controls */}
            <div className="flex items-center gap-[5px] relative">
              <button
                ref={assetMenuPlusRef}
                disabled={isAgentGenerating}
                onClick={() => {
                  setAssetMenuSource('main');
                  setIsAssetMenuOpen(!isAssetMenuOpen);
                }}
                style={{ color: 'rgba(218, 220, 224, 0.75)' }}
                className={`w-8 h-8 shrink-0 flex items-center justify-center rounded-full p-1.5 transition-colors outline-none ${isAgentGenerating ? 'opacity-40 cursor-not-allowed' : 'hover:text-white hover:bg-white/5 cursor-pointer'}`}
              >
                {/* 21.6px is Flow's own size for this one — 1.35rem, not a round pixel value. */}
                <MaterialSymbol name="add_2" family="google-symbols" size={21.6} weight={400} variationSettings='"FILL" 1' />
              </button>
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
            <div className="flex items-center gap-[5px] relative">
              {isAgentActive ? (
                /* 5px between these two and on to the send button, so the three read as one
                 * run of controls. Both buttons are 32 wide and 34 tall — they fill the
                 * control row's height rather than sitting square in it. */
                <div className="flex items-center gap-[5px]" key="agent-buttons-wrapper">
                  {/* Agent Instructions. `article_spark` is the only glyph here that Flow
                    * draws unfilled, so it takes FILL 0 while the rest take FILL 1. */}
                  <button
                    key="agent-docs-btn"
                    style={{ color: 'rgba(218, 220, 224, 0.75)' }}
                    className="flex items-center justify-center w-8 h-[34px] shrink-0 p-1.5 rounded-full transition-colors outline-none focus:outline-none focus:ring-0 active:scale-[0.93] hover:bg-white/5 hover:text-white cursor-pointer"
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
                    className="flex items-center justify-center w-8 h-[34px] shrink-0 p-1.5 rounded-full transition-colors outline-none focus:outline-none focus:ring-0 active:scale-[0.93] hover:bg-white/5 hover:text-white cursor-pointer"
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
                    className={`flex items-center h-9 transition-colors rounded-full px-3.5 gap-1.5 outline-none ${isModelMenuOpen ? 'bg-[#33343a]' : 'bg-[#27282b] hover:bg-[#33343a]'}`}
                  >
                    {(() => {
                      const activeName = modelMode === 'image' ? getImageModelName(imageModel) : getVideoModelName(videoModel);
                      return activeName.toLowerCase().includes('banana') ? (
                        <span className="text-[11px]">🍌</span>
                      ) : null;
                    })()}
                    <span className="text-[11px] font-semibold text-[#d0d0d0]">
                      {modelMode === 'image' ? getImageModelName(imageModel) : getVideoModelName(videoModel)}
                    </span>
                    <div className="text-[#888888] flex items-center justify-center">
                      <RatioIcon ratio={modelMode === 'image' ? imageRatio : videoRatio} className="w-3 h-3" />
                    </div>
                    <span className="text-[11px] font-bold text-[#888888]">
                      {modelMode === 'image' ? imageBatch : videoBatch}
                    </span>
                  </button>

                  {createPortal(
                  <AnimatePresence>
                  {isModelMenuOpen && menuRect && (
                    <motion.div
                      ref={popupRef}
                      layout
                      initial={{ opacity: 0, scale: 0.96, y: 8 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.96, y: 8 }}
                      transition={{
                        layout: { duration: 0.32, ease: [0.32, 0.72, 0, 1] },
                        opacity: { duration: 0.16, ease: 'easeOut' },
                        scale: { duration: 0.22, ease: [0.32, 0.72, 0, 1] },
                        y: { duration: 0.22, ease: [0.32, 0.72, 0, 1] },
                      }}
                      style={{
                        position: 'fixed',
                        bottom: menuRect.bottom,
                        right: menuRect.right,
                        originY: 1,
                        originX: 1,
                        willChange: 'transform, height, opacity',
                      }}
                      className="w-[270px] bg-[#141517]/90 backdrop-blur-xl rounded-[22px] p-1.5 flex flex-col gap-1.5 shadow-2xl border border-white/5 z-[110] overflow-hidden"
                    >

                      {/* Top Tabs */}
                      <motion.div layout="position" className="flex bg-[#1e1f21]/50 backdrop-blur-md rounded-[14px] p-1">
                        <button
                          onClick={() => {
                            setModelMode('image');
                            setIsImageModelDropdownOpen(false);
                            setIsVideoModelDropdownOpen(false);
                          }}
                          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-[10px] transition-colors font-normal ${modelMode === 'image' ? 'bg-[#f4f4f4] text-black' : 'text-[#a0a0a0] hover:text-white hover:bg-white/5'}`}
                        >
                          <ImageIcon size={14} strokeWidth={2} />
                          <span className="text-[13px]">Image</span>
                        </button>
                        <button
                          onClick={() => {
                            setModelMode('video');
                            setIsImageModelDropdownOpen(false);
                            setIsVideoModelDropdownOpen(false);
                          }}
                          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-[10px] transition-colors font-normal ${modelMode === 'video' ? 'bg-[#f4f4f4] text-black' : 'text-[#a0a0a0] hover:text-white hover:bg-white/5'}`}
                        >
                          <PlayCircle size={14} strokeWidth={2} />
                          <span className="text-[13px]">Video</span>
                        </button>
                      </motion.div>

                      <motion.div layout="position" className="relative w-full flex flex-col">
                      <AnimatePresence mode="popLayout" initial={false}>
                      {modelMode === 'image' ? (
                        <motion.div
                          key="image-panel"
                          layout="position"
                          initial="hidden"
                          animate="visible"
                          exit="exit"
                          variants={{
                            hidden: { opacity: 0 },
                            visible: {
                              opacity: 1,
                              transition: { staggerChildren: 0.035 },
                            },
                            exit: {
                              opacity: 0,
                              transition: { staggerChildren: 0.02, staggerDirection: -1 },
                            },
                          }}
                          className="w-full flex flex-col gap-1.5"
                        >
                          {/* Image Aspect Ratios */}
                          <motion.div variants={popupItemVariants} className="flex bg-[#1e1f21]/50 backdrop-blur-md rounded-[14px] p-1 justify-between">
                            {['16:9', '4:3', '1:1', '3:4', '9:16'].map(ratio => (
                               <button
                                 key={ratio}
                                 onClick={() => setImageRatio(ratio)}
                                 className={`flex-1 flex flex-col items-center justify-center gap-1 py-1.5 rounded-[10px] transition-colors ${imageRatio === ratio ? 'bg-[#4a4a4a]' : 'hover:bg-white/5'}`}
                               >
                                 <RatioIcon ratio={ratio} className="w-4 h-4" />
                                 <span className={`text-[11px] font-normal text-white`}>{ratio}</span>
                               </button>
                            ))}
                          </motion.div>

                          {/* Image Multipliers */}
                          <motion.div variants={popupItemVariants} className="flex bg-[#1e1f21]/50 backdrop-blur-md rounded-[14px] p-1">
                            {['1x', 'x2', 'x3', 'x4'].map(batch => (
                              <button
                                key={batch}
                                onClick={() => setImageBatch(batch)}
                                className={`flex-1 py-2 rounded-[10px] text-[12px] font-normal transition-colors ${imageBatch === batch ? 'bg-[#4a4a4a] text-white' : 'text-[#a0a0a0] hover:text-white hover:bg-white/5'}`}
                              >
                                {batch}
                              </button>
                            ))}
                          </motion.div>

                           {/* Dynamic Effort Level Selector (For Supported Models) */}
                           { (imageModel === 'gemini-3.1-flash-image-preview' || imageModel === 'gemini-3.1-flash-lite-image' || imageModel === 'gpt-image-2') && (
                             <motion.div variants={popupItemVariants} className="flex bg-[#1e1f21]/50 backdrop-blur-md rounded-[14px] p-1">
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
                                     className={`flex-1 py-2 rounded-[10px] text-[12px] font-normal transition-colors ${imageEffort === eff.id ? 'bg-[#4a4a4a] text-white' : 'text-[#a0a0a0] hover:text-white hover:bg-white/5'}`}
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
                                     className={`flex-1 py-2 rounded-[10px] text-[12px] font-normal transition-colors ${imageEffort === eff.id ? 'bg-[#4a4a4a] text-white' : 'text-[#a0a0a0] hover:text-white hover:bg-white/5'}`}
                                   >
                                     {eff.name}
                                   </button>
                                 ))
                               )}
                             </motion.div>
                           )}

                           {/* Dynamic Quality Selector (For Supported Models) */}
                           { imageModel === 'gpt-image-2' && (
                             <motion.div variants={popupItemVariants} className="flex bg-[#1e1f21]/50 backdrop-blur-md rounded-[14px] p-1">
                               {['low', 'medium', 'high'].map(qual => (
                                 <button
                                   key={qual}
                                   type="button"
                                   onClick={() => setImageQuality(qual)}
                                   className={`flex-1 py-2 rounded-[10px] text-[12px] font-normal capitalize transition-colors ${imageQuality === qual ? 'bg-[#4a4a4a] text-white' : 'text-[#a0a0a0] hover:text-white hover:bg-white/5'}`}
                                 >
                                   {qual}
                                 </button>
                               ))}
                             </motion.div>
                           )}

                           {/* Dynamic Resolution Selector (For All Image Models: Google & GPT) */}
                           { (imageModel === 'gemini-3-pro-image-preview' || imageModel === 'gemini-3.1-flash-image-preview' || imageModel === 'gemini-3.1-flash-lite-image' || imageModel === 'gpt-image-2') && (
                             <motion.div variants={popupItemVariants} className="flex bg-[#1e1f21]/50 backdrop-blur-md rounded-[14px] p-1">
                               {['1k', '2k', '4k'].map(res => (
                                 <button
                                   key={res}
                                   type="button"
                                   onClick={() => setImageResolution(res)}
                                   className={`flex-1 py-2 rounded-[10px] text-[12px] font-normal uppercase transition-colors ${imageResolution === res ? 'bg-[#4a4a4a] text-white' : 'text-[#a0a0a0] hover:text-white hover:bg-white/5'}`}
                                 >
                                   {res}
                                 </button>
                               ))}
                             </motion.div>
                           )}

                          {/* Model Selector */}
                          <motion.div variants={popupItemVariants} className="relative" ref={imageModelDropdownRef}>
                            <button
                              type="button"
                              ref={imageModelButtonRef}
                              onClick={toggleImageModelDropdown}
                              className="w-full flex items-center justify-between bg-[#1e1f21]/50 backdrop-blur-md hover:bg-[#202020]/50 transition-colors rounded-[14px] px-3 py-3"
                            >
                              <span className="text-[13px] font-normal text-white">{getImageModelName(imageModel)}</span>
                              <ChevronDown
                                size={16}
                                className={`text-[#a0a0a0] transition-transform duration-200 ${isImageModelDropdownOpen ? 'rotate-180' : ''}`}
                              />
                            </button>

                            {isImageModelDropdownOpen && (
                              <div className={`absolute ${imageModelDropDirection === 'down' ? 'top-[calc(100%+6px)]' : 'bottom-[calc(100%+6px)]'} left-0 right-0 bg-[#141517]/90 backdrop-blur-xl rounded-[14px] p-1 flex flex-col shadow-2xl z-[120]`}>
                                {availableImageModels.map(modelOpt => (
                                  <button
                                    key={modelOpt.id}
                                    type="button"
                                    onClick={() => {
                                      setImageModel(modelOpt.id);
                                      setIsImageModelDropdownOpen(false);
                                    }}
                                    className={`w-full text-left px-3 py-2 rounded-[10px] text-[12px] font-normal transition-colors ${imageModel === modelOpt.id ? 'bg-[#4a4a4a] text-white' : 'text-[#a0a0a0] hover:text-white hover:bg-white/5'}`}
                                  >
                                    {modelOpt.name}
                                  </button>
                                ))}
                              </div>
                            )}
                          </motion.div>
                        </motion.div>
                      ) : (
                        <motion.div
                          key="video-panel"
                          layout="position"
                          initial="hidden"
                          animate="visible"
                          exit="exit"
                          variants={{
                            hidden: { opacity: 0 },
                            visible: {
                              opacity: 1,
                              transition: { staggerChildren: 0.035 },
                            },
                            exit: {
                              opacity: 0,
                              transition: { staggerChildren: 0.02, staggerDirection: -1 },
                            },
                          }}
                          className="w-full flex flex-col gap-1.5"
                        >
                          {/* Video Tabs */}
                          <motion.div variants={popupItemVariants} className="flex bg-[#1e1f21]/50 backdrop-blur-md rounded-[14px] p-1">
                            <button
                              onClick={() => setVideoMode('frames')}
                              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-[12px] transition-colors font-normal ${videoMode === 'frames' ? 'bg-[#f4f4f4] text-black' : 'bg-[#1e1f21]/50 backdrop-blur-md text-[#a0a0a0] hover:text-white hover:bg-[#202020]/50'}`}
                            >
                              <Scan size={14} strokeWidth={2} />
                              <span className="text-[12px]">Frames</span>
                            </button>
                            <button
                              onClick={() => setVideoMode('ingredients')}
                              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-[12px] transition-colors font-normal ${videoMode === 'ingredients' ? 'bg-[#f4f4f4] text-black' : 'bg-[#1e1f21]/50 backdrop-blur-md text-[#a0a0a0] hover:text-white hover:bg-[#202020]/50'}`}
                            >
                              <svg 
                                xmlns="http://www.w3.org/2000/svg" 
                                viewBox="0 0 100 100" 
                                className="w-3.5 h-3.5"
                              >
                                <path d="M 26 20 L 42 20 A 8 8 0 0 0 58 20 L 74 20 A 6 6 0 0 1 80 26 L 80 42 A 8 8 0 0 1 80 58 L 80 74 A 6 6 0 0 1 74 80 L 26 80 A 6 6 0 0 1 20 74 L 20 58 A 8 8 0 0 0 20 42 L 20 26 A 6 6 0 0 1 26 20 Z" 
                                      fill="none" 
                                      stroke="currentColor" 
                                      strokeWidth="7.5" 
                                      strokeLinecap="round" 
                                      strokeLinejoin="round" />
                              </svg>
                              <span className="text-[12px]">Ingredients</span>
                            </button>
                          </motion.div>

                          {/* Video Aspect Ratios */}
                          <motion.div variants={popupItemVariants} className="flex bg-[#1e1f21]/50 backdrop-blur-md rounded-[14px] p-1">
                             {['9:16', '16:9'].map(ratio => (
                               <button
                                 key={ratio}
                                 onClick={() => setVideoRatio(ratio)}
                                 className={`flex-1 flex flex-col items-center justify-center gap-1 py-2 rounded-[10px] transition-colors ${videoRatio === ratio ? 'bg-[#4a4a4a]' : 'hover:bg-white/5'}`}
                               >
                                 <RatioIcon ratio={ratio} className={videoRatio === ratio ? "text-white w-3.5 h-3.5" : "text-[#a0a0a0] w-3.5 h-3.5"} />
                                 <span className={`text-[11px] font-normal ${videoRatio === ratio ? 'text-white' : 'text-[#a0a0a0]'}`}>{ratio}</span>
                               </button>
                             ))}
                          </motion.div>

                          {/* Video Multipliers */}
                          <motion.div variants={popupItemVariants} className="flex bg-[#1e1f21]/50 backdrop-blur-md rounded-[14px] p-1">
                            {['1x', 'x2', 'x3', 'x4'].map(batch => (
                              <button
                                key={batch}
                                onClick={() => setVideoBatch(batch)}
                                className={`flex-1 py-2 rounded-[10px] text-[12px] font-normal transition-colors ${videoBatch === batch ? 'bg-[#4a4a4a] text-white' : 'text-[#a0a0a0] hover:text-white hover:bg-white/5'}`}
                              >
                                {batch}
                              </button>
                            ))}
                          </motion.div>

                          {/* Video Model Selector */}
                          <motion.div variants={popupItemVariants} className="relative" ref={videoModelDropdownRef}>
                            <button
                              type="button"
                              ref={videoModelButtonRef}
                              onClick={toggleVideoModelDropdown}
                              className="w-full flex items-center justify-between bg-[#1e1f21]/50 backdrop-blur-md hover:bg-[#202020]/50 transition-colors rounded-[14px] px-3 py-3"
                            >
                              <span className="text-[13px] font-normal text-white">{getVideoModelName(videoModel)}</span>
                              <ChevronDown
                                size={16}
                                className={`text-[#a0a0a0] transition-transform duration-200 ${isVideoModelDropdownOpen ? 'rotate-180' : ''}`}
                              />
                            </button>

                            {isVideoModelDropdownOpen && (
                              <div className={`absolute ${videoModelDropDirection === 'down' ? 'top-[calc(100%+6px)]' : 'bottom-[calc(100%+6px)]'} left-0 right-0 bg-[#141517]/90 backdrop-blur-xl rounded-[14px] p-1 flex flex-col shadow-2xl z-[120]`}>
                                {VIDEO_MODELS.map(modelOpt => (
                                  <button
                                    key={modelOpt.id}
                                    type="button"
                                    onClick={() => {
                                      setVideoModel(modelOpt.id);
                                      setIsVideoModelDropdownOpen(false);
                                    }}
                                    className={`w-full text-left px-3 py-2 rounded-[10px] text-[12px] font-normal transition-colors ${videoModel === modelOpt.id ? 'bg-[#4a4a4a] text-white' : 'text-[#a0a0a0] hover:text-white hover:bg-white/5'}`}
                                  >
                                    {modelOpt.name}
                                  </button>
                                ))}
                              </div>
                            )}
                          </motion.div>

                          {/* Video Duration */}
                          <motion.div variants={popupItemVariants} className="flex bg-[#1e1f21]/50 backdrop-blur-md rounded-[14px] p-1">
                            {['4s', '6s', '8s', '10s'].map(dur => (
                              <button
                                key={dur}
                                onClick={() => setVideoDuration(dur)}
                                className={`flex-1 py-2 rounded-[10px] text-[12px] font-normal transition-colors ${videoDuration === dur ? 'bg-[#4a4a4a] text-white' : 'text-[#a0a0a0] hover:text-white hover:bg-white/5'}`}
                              >
                                {dur}
                              </button>
                            ))}
                          </motion.div>
                        </motion.div>
                      )}
                      </AnimatePresence>
                    </motion.div>
                  </motion.div>
                )}
                </AnimatePresence>,
                document.body
                )}
              </div>
              )}
              
              {/* 32px round. Disabled it is the same 5% fill as the other pills; enabled it
                * flips to solid white with a rgb(48,48,48) arrow — Flow's two states. */}
              <button
                onClick={isAgentGenerating ? undefined : handleGenerate}
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
                    size={20}
                    weight={400}
                    variationSettings='"FILL" 1'
                    /* Disabled is 0.25, not 0.75 — the arrow is nearly gone against the 5%
                     * fill until there is something to send. */
                    style={{ color: !prompt.trim() ? 'rgba(218, 220, 224, 0.25)' : 'rgb(48, 48, 48)' }}
                  />
                )}
              </button>
            </div>

          </div>
            </>
          )}
        </div>
      </div>

      {/* Full-screen Image Viewer / Inpainting Overlay */}
      <AnimatePresence>
        {selectedItem && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-0 bg-black/95 backdrop-blur-2xl z-[100] flex flex-col overflow-hidden text-white select-none"
            style={{ fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}
          >
            {/* Top Bar */}
            <motion.div 
              initial={{ y: -15, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -15, opacity: 0 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="h-16 flex items-center justify-between px-6 shrink-0 z-10 bg-transparent"
            >
              {/* Left controls */}
              <div className="flex items-center gap-4 w-[380px]">
                <button 
                  onClick={() => setSelectedItem(null)}
                  className="p-2 hover:bg-white/10 rounded-full transition-colors text-gray-300 hover:text-white"
                  title="Close viewer"
                >
                  <ArrowLeft size={20} strokeWidth={2.5} />
                </button>
                <span className="text-[14px] font-semibold text-white tracking-wide truncate max-w-[200px]">
                  {selectedItem.shortenedPrompt || selectedItem.prompt}
                </span>
                <button className="p-2 hover:bg-white/10 rounded-full transition-colors text-gray-400 hover:text-white">
                  <Info size={18} strokeWidth={2.5} />
                </button>
              </div>

              {/* Center thumbnail carousel aligned with image */}
              <div 
                className="flex items-center gap-1.5 select-none group"
                style={{
                  marginRight: showHistory ? 208 : 0,
                  transition: 'margin-right 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              >
                {/* Prev Arrow */}
                <button
                  onClick={handlePrevThumb}
                  className={`w-9 h-9 flex items-center justify-center text-white/90 hover:text-white transition-all rounded-[12px] hover:bg-white/10 ${
                    completedItems.length > 1 ? 'opacity-0 group-hover:opacity-100 cursor-pointer' : 'opacity-0 pointer-events-none'
                  }`}
                  style={{ transition: 'opacity 0.2s ease, background-color 0.2s ease' }}
                  title="Previous image"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={18} height={18} fill="currentColor">
                    <path d="M15 6v12l-7-6z" />
                  </svg>
                </button>

                {/* Thumbnails Container */}
                <div 
                  className="flex items-center gap-2 overflow-hidden relative"
                  style={{
                    width: `${K_THUMBS * 36 + (K_THUMBS - 1) * 8}px`,
                    maskImage: completedItems.length > 1
                      ? 'linear-gradient(to right, transparent 0%, black 12%, black 88%, transparent 100%)'
                      : 'none',
                    WebkitMaskImage: completedItems.length > 1
                      ? 'linear-gradient(to right, transparent 0%, black 12%, black 88%, transparent 100%)'
                      : 'none',
                  }}
                >
                  {/* Static highlight frame centered in the viewport */}
                  {completedItems.length > 0 && (
                    <div 
                      className="absolute w-9 h-9 border-2 border-white rounded-[12px] shadow-[0_0_6px_rgba(255,255,255,0.45)] pointer-events-none z-10 left-[132px] top-1/2 -translate-y-1/2"
                    />
                  )}

                  {/* Sliding Inner Row */}
                  <div
                    className="flex items-center gap-2"
                    style={{
                      transform: isAnimating 
                        ? `translateX(${xTranslate}px)` 
                        : 'translateX(-176px)',
                      transition: isAnimating ? 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)' : 'none',
                    }}
                    onTransitionEnd={handleTransitionEnd}
                  >
                    {carouselWindow.items.map((thumbItem, idx) => {
                      return (
                        <button
                          key={`${thumbItem.id}-${idx}`}
                          onClick={() => handleThumbClick(thumbItem, idx)}
                          className="w-9 h-9 rounded-[12px] overflow-hidden border border-white/5 shrink-0 transition-opacity active:scale-[0.95] opacity-80 hover:opacity-100"
                        >
                          {thumbItem.kind === 'video' ? (
                            <MediaVideo src={thumbItem.url} className="w-full h-full object-cover pointer-events-none" muted />
                          ) : (
                            <img src={thumbItem.url} className="w-full h-full object-cover pointer-events-none" alt="" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Next Arrow */}
                <button
                  onClick={handleNextThumb}
                  className={`w-9 h-9 flex items-center justify-center text-white/90 hover:text-white transition-all rounded-[12px] hover:bg-white/10 ${
                    completedItems.length > 1 ? 'opacity-0 group-hover:opacity-100 cursor-pointer' : 'opacity-0 pointer-events-none'
                  }`}
                  style={{ transition: 'opacity 0.2s ease, background-color 0.2s ease' }}
                  title="Next image"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={18} height={18} fill="currentColor">
                    <path d="M9 6v12l7-6z" />
                  </svg>
                </button>
              </div>

              {/* Right controls */}
              <div className="flex items-center gap-3 w-[380px] justify-end">
                <button className="p-2 hover:bg-white/10 rounded-full transition-colors text-gray-300 hover:text-white">
                  <Heart size={20} strokeWidth={2} />
                </button>
                <button 
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (selectedItem.url) {
                      const name = selectedItem.shortenedPrompt || selectedItem.prompt;
                      const ext = selectedItem.kind === 'video' ? 'mp4' : 'png';
                      const cleanName = name.replace(/[\/:*?"<>|]/g, '').trim() || 'media';
                      const filename = `${cleanName}.${ext}`;
                      try {
                        const response = await fetch(selectedItem.url);
                        const blob = await response.blob();
                        // No direct FS save here — the auto-sync backfill effect
                        // already persists unsaved items (with fsName recorded);
                        // saving again minted "name (1).png" duplicates on disk
                        // that reconciled back in as phantom tiles.
                        const blobUrl = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = blobUrl;
                        a.download = filename;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(blobUrl);
                      } catch (err) {
                        const a = document.createElement('a');
                        a.href = selectedItem.url;
                        a.download = filename;
                        a.target = '_blank';
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                      }
                    }
                  }}
                  className="p-2 hover:bg-white/10 rounded-full transition-colors text-gray-300 hover:text-white"
                  title="Download output"
                >
                  <Download size={20} strokeWidth={2} />
                </button>
                <button className="p-2 hover:bg-white/10 rounded-full transition-colors text-gray-300 hover:text-white">
                  <Share2 size={20} strokeWidth={2} />
                </button>
                <button 
                  onClick={() => setShowHistory(!showHistory)}
                  className="flex items-center h-9 bg-[#1c1c1e] hover:bg-[#2c2c2e] text-white rounded-2xl pl-3.5 pr-4 gap-1.5 transition-colors shrink-0"
                >
                  {showHistory ? <EyeOff size={16} strokeWidth={2.5} /> : <Eye size={16} strokeWidth={2.5} />}
                  <span className="text-[12px] font-semibold">
                    {showHistory ? 'Hide history' : 'Show history'}
                  </span>
                </button>
                <button 
                  onClick={() => setSelectedItem(null)}
                  className="flex items-center justify-center h-9 bg-white hover:bg-zinc-200 text-black font-semibold rounded-2xl px-5 transition-colors shrink-0"
                >
                  <span className="text-[12px]">Done</span>
                </button>
              </div>
            </motion.div>

            {/* Main Area */}
            <div className="flex-1 min-h-0 flex items-center justify-between px-8 pt-6 pb-0 overflow-visible relative">
              {/* Left Toolbar */}
              <motion.div 
                ref={toolbarRef} 
                initial={{ x: -20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -20, opacity: 0 }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                className="-ml-3 flex flex-col gap-3 shrink-0 select-none z-30 relative"
              >
                <button 
                  onClick={() => handleToolSwitch('crop')}
                  className={`w-11 h-11 flex items-center justify-center rounded-full text-white transition-all ${
                    activeTool === 'crop' || showCropMenu ? 'bg-[#303030]' : 'bg-transparent hover:bg-white/10'
                  }`}
                >
                  {activeCropRatio === '16:9' ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
                      <rect width="18" height="12" x="3" y="6" rx="1.5" />
                    </svg>
                  ) : activeCropRatio === '9:16' ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
                      <rect width="12" height="18" x="6" y="3" rx="1.5" />
                    </svg>
                  ) : activeCropRatio === '1:1' ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
                      <rect width="16" height="16" x="4" y="4" rx="1.5" />
                    </svg>
                  ) : (
                    <Crop size={22} strokeWidth={2.25} />
                  )}
                </button>
                <button 
                  onClick={() => handleToolSwitch('pen')}
                  className={`w-11 h-11 flex items-center justify-center rounded-full text-white transition-all ${
                    activeTool === 'pen' ? 'bg-[#303030]' : 'bg-transparent hover:bg-white/10'
                  }`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={22} height={22}>
                    <defs>
                      <mask id="pen-mask">
                        <rect width="100%" height="100%" fill="white" />
                        <path d="M 4 20 L 4 16.5 L 15.5 5 A 2.475 2.475 0 0 1 19 8.5 L 7.5 20 Z" 
                              fill="black" stroke="black" stroke-width="2.75" stroke-linejoin="round" />
                      </mask>
                    </defs>
                    <path d="M 4 7 C 4 3, 9 3, 11 6 C 13 9, 13 14, 15 17 C 17 20, 20 19, 21 17" 
                          fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" mask="url(#pen-mask)" />
                    <path d="M 4 20 L 4 16.5 L 15.5 5 A 2.475 2.475 0 0 1 19 8.5 L 7.5 20 Z M 7 16 L 14 9 L 15 10 L 8 17 Z" 
                          fill="currentColor" fill-rule="evenodd" />
                  </svg>
                </button>
                <button 
                  onClick={() => handleToolSwitch('select')}
                  className={`w-11 h-11 flex items-center justify-center rounded-full text-white transition-all ${
                    activeTool === 'select' ? 'bg-[#303030]' : 'bg-transparent hover:bg-white/10'
                  }`}
                >
                  {activeSelectSubTool === 'box' ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
                      <rect width="18" height="18" x="3" y="3" rx="2" stroke-dasharray="3 3" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="7" strokeDasharray="3 3" />
                      <path d="M17 17l4 4M17 17h4M17 17v4" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>

                <AnimatePresence>
                  {showPenMenu && (
                    <motion.div 
                      initial={{ opacity: 0, x: -10, y: "-50%", scale: 0.95 }}
                      animate={{ opacity: 1, x: 0, y: "-50%", scale: 1 }}
                      exit={{ opacity: 0, x: -10, y: "-50%", scale: 0.95 }}
                      transition={{ duration: 0.18, ease: [0.32, 0.94, 0.6, 1] }}
                      className="absolute left-[58px] top-1/2 -translate-y-1/2 z-50 bg-[#141517]/90 backdrop-blur-xl border border-white/10 rounded-[28px] p-3 w-[150px] flex flex-col gap-3.5 shadow-[0_12px_40px_rgba(0,0,0,0.55)]"
                    >
                      <PenMenu
                        activePenSubTool={activePenSubTool}
                        setActivePenSubTool={setActivePenSubTool}
                        activeColor={activeColor}
                        setActiveColor={setActiveColor}
                        showColorPicker={showColorPicker}
                        setShowColorPicker={setShowColorPicker}
                        penSize={penSize}
                        setPenSize={setPenSize}
                        annotationCount={annotations.length}
                        redoCount={redoStack.length}
                        onUndo={handleUndo}
                        onRedo={handleRedo}
                        onReset={handleReset}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence>
                  {showSelectMenu && (
                    <motion.div 
                      initial={{ opacity: 0, x: -10, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                      exit={{ opacity: 0, x: -10, y: 10, scale: 0.95 }}
                      transition={{ duration: 0.18, ease: [0.32, 0.94, 0.6, 1] }}
                      className="absolute left-[58px] bottom-0 z-50 bg-[#141517]/90 backdrop-blur-xl border border-white/10 rounded-[24px] p-1.5 w-[145px] flex flex-col gap-1 shadow-[0_12px_40px_rgba(0,0,0,0.55)]"
                    >
                      <SelectMenu
                        activeSelectSubTool={activeSelectSubTool}
                        setActiveSelectSubTool={setActiveSelectSubTool}
                        setShowSelectMenu={setShowSelectMenu}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence>
                  {showCropMenu && (
                    <motion.div 
                      initial={{ opacity: 0, x: -10, y: -20, scale: 0.95 }}
                      animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                      exit={{ opacity: 0, x: -10, y: -20, scale: 0.95 }}
                      transition={{ duration: 0.18, ease: [0.32, 0.94, 0.6, 1] }}
                      className="absolute left-[58px] top-0 z-50 bg-[#141517]/90 backdrop-blur-xl border border-white/10 rounded-[24px] p-1.5 w-[190px] flex flex-col gap-1 shadow-[0_12px_40px_rgba(0,0,0,0.55)]"
                    >
                      <CropMenu
                        activeTool={activeTool}
                        setActiveTool={setActiveTool}
                        setPreviousTool={setPreviousTool}
                        activeCropRatio={activeCropRatio}
                        setActiveCropRatio={setActiveCropRatio}
                        setShowCropMenu={setShowCropMenu}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>

              {/* Centered Image */}
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                className={`flex-1 h-full min-h-0 flex items-center justify-center relative select-none pl-5 ${showHistory ? 'pr-4' : 'pr-13'}`}
              >
                {(() => {
                  const ratio = selectedItem.ratio;
                  let ar = 16 / 9;
                  if (ratio === '4:3') ar = 4 / 3;
                  else if (ratio === '1:1') ar = 1;
                  else if (ratio === '3:4') ar = 3 / 4;
                  else if (ratio === '9:16') ar = 9 / 16;
                  
                  return (
                    <div 
                      className={`relative max-w-full max-h-full overflow-hidden shadow-2xl border bg-[#141517]/40 flex items-center justify-center ${
                        activeTool === 'crop' ? 'rounded-none' : 'rounded-[32px]'
                      }`}
                      style={{ aspectRatio: ar, borderWidth: '0.5px', borderColor: '#0e0e10', borderStyle: 'solid' }}
                    >
                      {selectedItem.kind === 'video' ? (
                        <MediaVideo
                          src={selectedItem.url}
                          controls
                          autoPlay
                          loop
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <>
                          <img
                            src={selectedItem.url}
                            alt={selectedItem.shortenedPrompt || selectedItem.prompt}
                            className="w-full h-full object-cover pointer-events-none"
                          />
                          {selectedItem.kind === 'audio' && selectedItem.audioUrl && (
                            <audio 
                               src={selectedItem.audioUrl} 
                               controls 
                               autoPlay 
                               className="absolute bottom-4 left-1/2 -translate-x-1/2 w-[80%] max-w-[400px] z-50 rounded-full shadow-2xl"
                            />
                          )}
                        </>
                      )}
                      
                      {/* Crop Box Overlay with Corner Vertices */}
                      {activeTool === 'crop' && (
                        <CropOverlay
                          containerRef={cropContainerRef}
                          cropBox={cropBox}
                          onPointerDown={onCropPointerDown}
                        />
                      )}
                      
                      {/* SVG Canvas overlay */}
                      {(activeTool === 'pen' || activeTool === 'select') && (
                        <AnnotationOverlay
                          svgRef={svgRef}
                          annotations={annotations}
                          currentAnnotation={currentAnnotation}
                          onMouseDown={handleMouseDown}
                        />
                      )}
                      
                      {/* Active Text Input overlay */}
                      {activeTool === 'pen' && textInput && (
                        <input
                          autoFocus
                          type="text"
                          value={textInput.value}
                          onChange={(e) => setTextInput({ ...textInput, value: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              if (textInput.value.trim()) {
                                const newAnn: Annotation = {
                                  id: Math.random().toString(),
                                  type: 'text',
                                  color: activeColor,
                                  size: penSize,
                                  x: textInput.x,
                                  y: textInput.y,
                                  text: textInput.value
                                };
                                setAnnotations([...annotations, newAnn]);
                                setRedoStack([]);
                              }
                              setTextInput(null);
                            } else if (e.key === 'Escape') {
                              setTextInput(null);
                            }
                          }}
                          onBlur={() => {
                            if (textInput.value.trim()) {
                              const newAnn: Annotation = {
                                id: Math.random().toString(),
                                type: 'text',
                                color: activeColor,
                                size: penSize,
                                x: textInput.x,
                                y: textInput.y,
                                text: textInput.value
                              };
                              setAnnotations([...annotations, newAnn]);
                              setRedoStack([]);
                            }
                            setTextInput(null);
                          }}
                          className="absolute bg-[#141517] text-white border border-white/20 px-2 py-1 rounded-[6px] text-[13px] font-sans shadow-lg focus:outline-none focus:border-white/50 z-20 transform -translate-y-1/2"
                          style={{
                            left: `${textInput.x}%`,
                            top: `${textInput.y}%`,
                            color: activeColor,
                            fontSize: `${Math.max(12, penSize * 2.5 + 8)}px`,
                            lineHeight: '1'
                          }}
                        />
                      )}
                    </div>
                  );
                })()}
              </motion.div>

              {/* Right Sidebar - History panel */}
              <AnimatePresence>
                {showHistory && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15, ease: 'easeOut' }}
                    className="h-full flex flex-col justify-end shrink-0 select-none ml-6"
                  >
                    <div ref={setHistoryRail} className="w-[220px] flex flex-col items-start">
                      {(() => {
                        const ratio = selectedItem.ratio;
                        let ar = 16 / 9;
                        if (ratio === '4:3') ar = 4 / 3;
                        else if (ratio === '1:1') ar = 1;
                        else if (ratio === '3:4') ar = 3 / 4;
                        else if (ratio === '9:16') ar = 9 / 16;

                        return (
                          <div className="w-full rounded-[20px] overflow-hidden border-2 border-white bg-[#141517]/40 shadow-xl flex flex-col">
                            <div 
                              className="w-full overflow-hidden bg-zinc-900"
                              style={{ aspectRatio: ar }}
                            >
                              {selectedItem.kind === 'video' ? (
                                <video src={selectedItem.url} className="w-full h-full object-cover" muted />
                              ) : (
                                <img src={selectedItem.url} className="w-full h-full object-cover" alt="" />
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Bottom Area */}
            <motion.div 
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="shrink-0 flex flex-col items-center justify-end relative select-none pt-3 pb-8"
            >


              {activeTool === 'crop' ? (
                <div
                  className="flex items-center gap-3 mt-4"
                  style={{
                    marginRight: showHistory ? 208 : 0,
                    transition: 'margin-right 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                >
                  <button 
                    onClick={() => {
                      setActiveTool(previousTool);
                      setShowCropMenu(false);
                    }}
                    className="flex items-center h-10 px-5 rounded-full bg-[#1c1c1e] hover:bg-[#2c2c2e] border border-white/10 text-white font-medium text-[13px] gap-2 transition-all active:scale-[0.97]"
                  >
                    <X size={15} strokeWidth={2.5} className="text-white/85" />
                    <span>Cancel</span>
                  </button>
                  <button 
                    onClick={() => {
                      setActiveTool(previousTool);
                      setShowCropMenu(false);
                    }}
                    className="flex items-center h-10 px-6 rounded-full bg-white hover:bg-zinc-200 text-black font-semibold text-[13px] gap-2 transition-all active:scale-[0.97]"
                  >
                    <ArrowRight size={15} strokeWidth={2.5} className="text-black" />
                    <span>Crop</span>
                  </button>
                </div>
              ) : (
                <div 
                  className="relative w-full max-w-[600px] flex flex-col z-50"
                  style={{
                    marginRight: showHistory ? 208 : 0,
                    transition: 'margin-right 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                >
                <AssetMenuModal
                  isOpen={isViewerAssetMenuOpen}
                  onClose={() => setIsViewerAssetMenuOpen(false)}
                  buttonRef={viewerAssetMenuPlusRef}
                  projectName={projectName}
                  mediaItems={mediaItems}
                  onFileSelect={() => viewerFileInputRef.current?.click()}
                  onAddPrompt={(assetId, assetUrl, assetTitle, assetKind) => {
                    if (assetUrl) {
                      setViewerAttachments(prev => {
                        if (prev.some(att => att && att.url === assetUrl)) return prev;
                        return [...prev, {
                          id: assetId,
                          url: assetUrl,
                          name: assetTitle || 'Attached Image',
                          kind: assetKind || 'image'
                        }];
                      });
                    } else if (assetTitle) {
                      setEditPrompt(prev => {
                        const separator = prev.trim() ? ' ' : '';
                        return `${prev.trim()}${separator}[${assetTitle}]`;
                      });
                    }
                  }}
                />
                <div
                  ref={measureViewerPromptCard}
                  className="bg-[#141517]/90 backdrop-blur-[80px] rounded-[22px] pt-3 pb-2 px-3 flex flex-col shadow-2xl border border-white/5 w-full"
                >
                  <input 
                    type="file" 
                    multiple 
                    accept="image/*"
                    className="hidden" 
                    ref={viewerFileInputRef} 
                    onChange={handleViewerFileSelect} 
                  />

                  {/* Attachments Area */}
                  {(() => {
                    const hasViewerAttachments = viewerAttachments.length > 0 && !viewerAttachments.every(att => viewerRemovingIds.has(att.id));
                    return (
                      <div className={`grid transition-[grid-template-rows,margin-bottom] duration-[250ms] ease-in-out ${hasViewerAttachments ? 'grid-rows-[1fr] mb-0' : 'grid-rows-[0fr] mb-0'}`}>
                        <div className="overflow-hidden">
                          <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2.5 px-2 pt-2">
                            {viewerAttachments.map((att) => (
                              <div key={att.id} className={`relative group flex-shrink-0 transition-all duration-200 ${viewerRemovingIds.has(att.id) ? 'opacity-0 scale-90' : 'opacity-100 scale-100 animate-in fade-in zoom-in-95'}`}>
                                <div className="relative">
                                  <div className="w-16 h-16 rounded-2xl overflow-hidden border border-white/5 bg-[#1c1c1c]">
                                    <img src={att.url} alt={att.name} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                                  </div>
                                  <button 
                                    onClick={() => removeViewerAttachment(att.id)}
                                    className="absolute -top-1.5 -right-1.5 bg-[#27272a] text-gray-400 hover:text-white border border-white/10 rounded-full p-1 opacity-0 group-hover:opacity-100 hover:opacity-100 transition-all duration-200 shadow-xl z-[60]"
                                  >
                                    <X size={12} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  <div className="relative flex items-start w-full">
                    <textarea 
                      ref={viewerTextareaRef}
                      value={editPrompt}
                      onChange={(e) => setEditPrompt(e.target.value)}
                      onScroll={(e) => updateViewerFades(e.currentTarget)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          void handleViewerGenerate();
                        }
                      }}
                      onPaste={(e) => {
                        const items = e.clipboardData?.items;
                        if (!items) return;
                        const imageFiles: File[] = [];
                        for (let i = 0; i < items.length; i++) {
                          if (items[i].type.startsWith('image/')) {
                            const file = items[i].getAsFile();
                            if (file) imageFiles.push(file);
                          }
                        }
                        if (imageFiles.length > 0) {
                          e.preventDefault();
                          const newAttachments: ImageAttachment[] = imageFiles.map(file => ({
                            id: Math.random().toString(36).substring(7),
                            url: URL.createObjectURL(file),
                            name: file.name || `pasted-image.${file.type.split('/')[1] || 'png'}`,
                            file
                          }));
                          setViewerAttachments(prev => [...prev, ...newAttachments]);
                        }
                      }}
                      rows={1}
                      placeholder="What do you want to change?" 
                      className={`bg-transparent border-none outline-none text-[14px] font-medium text-white placeholder-[#606060] w-full pl-1 py-0.5 resize-none max-h-[384px] overflow-y-auto no-scrollbar transition-all duration-200 ${
                        isViewerTopFaded && isViewerBottomFaded ? 'both-fade' : 
                        isViewerTopFaded ? 'top-fade' : 
                        isViewerBottomFaded ? 'bottom-fade' : ''
                      }`}
                      style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', paddingRight: '14px' }}
                    />
                    {editPrompt && (
                      <button 
                        onClick={() => setEditPrompt('')}
                        className="absolute right-[-4px] top-[-4px] text-gray-500 hover:text-white transition-colors p-0.5 rounded-full hover:bg-white/5 cursor-pointer"
                        title="Clear prompt"
                      >
                        <X size={14} strokeWidth={2.5} />
                      </button>
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-2.5">
                    <div className="flex items-center gap-2.5 relative">
                      <button 
                        ref={viewerAssetMenuPlusRef}
                        onClick={() => setIsViewerAssetMenuOpen(!isViewerAssetMenuOpen)}
                        className="text-[#a0a0a0] hover:text-white transition-colors ml-0 outline-none active:scale-[0.93] cursor-pointer"
                      >
                        <Plus size={22} strokeWidth={1.5} />
                      </button>
                    </div>
                    <div className="flex items-center gap-2.5 relative">
                      <div className="relative" ref={viewerModelDropdownRef}>
                        <button 
                          onClick={() => setIsViewerModelDropdownOpen(!isViewerModelDropdownOpen)}
                          className="flex items-center h-9 bg-[#27282b] hover:bg-[#33343a] transition-colors rounded-full px-3.5 gap-1.5 border border-transparent cursor-pointer select-none"
                        >
                          {viewerModelName.toLowerCase().includes('banana') ? (
                            <span className="text-[11px]">🍌</span>
                          ) : null}
                          <span className="text-[11px] font-semibold text-[#d0d0d0]">
                            {viewerModelName}
                          </span>
                          <ChevronDown size={12} className={`text-[#a0a0a0] transition-transform duration-200 ${isViewerModelDropdownOpen ? 'rotate-180' : ''}`} />
                        </button>
                        
                        {isViewerModelDropdownOpen && (
                          <div className="absolute bottom-[calc(100%+6px)] right-0 bg-[#141517]/95 backdrop-blur-xl rounded-[14px] p-1 flex flex-col shadow-2xl z-50 border border-white/5 min-w-[140px]">
                            {selectedItem.kind === 'image' ? (
                              [
                                { id: 'gemini-3-pro-image-preview', name: 'Nano Banana Pro' },
                                { id: 'gemini-3.1-flash-image-preview', name: 'Nano Banana 2' },
                                { id: 'gemini-3.1-flash-lite-image', name: 'Nano Banana Lite' },
                              ].map(modelOpt => (
                                <button
                                  key={modelOpt.id}
                                  type="button"
                                  onClick={() => {
                                    setViewerModelId(modelOpt.id);
                                    setViewerModelName(modelOpt.name);
                                    setIsViewerModelDropdownOpen(false);
                                  }}
                                  className={`w-full text-left px-3 py-2 rounded-[10px] text-[12px] font-normal transition-colors ${viewerModelId === modelOpt.id ? 'bg-[#4a4a4a] text-white' : 'text-[#a0a0a0] hover:text-white hover:bg-white/5'}`}
                                >
                                  {modelOpt.name}
                                </button>
                              ))
                            ) : (
                              [
                                { id: 'veo-3.1-fast', name: 'Veo 3.1 Fast' },
                                { id: 'veo-3.1', name: 'Veo 3.1' },
                                { id: 'veo-3.1-lite', name: 'Veo 3.1 Lite' },
                                { id: 'omni-flash', name: 'Omni Flash' },
                              ].map(modelOpt => (
                                <button
                                  key={modelOpt.id}
                                  type="button"
                                  onClick={() => {
                                    setViewerModelId(modelOpt.id);
                                    setViewerModelName(modelOpt.name);
                                    setIsViewerModelDropdownOpen(false);
                                  }}
                                  className={`w-full text-left px-3 py-2 rounded-[10px] text-[12px] font-normal transition-colors ${viewerModelId === modelOpt.id ? 'bg-[#4a4a4a] text-white' : 'text-[#a0a0a0] hover:text-white hover:bg-white/5'}`}
                                >
                                  {modelOpt.name}
                                </button>
                              ))
                            )}
                          </div>
                        )}
                      </div>

                      <button 
                        onClick={handleViewerGenerate}
                        disabled={!editPrompt.trim()}
                        className={`flex items-center justify-center w-9 h-9 rounded-full transition-all border border-transparent ${
                          !editPrompt.trim()
                            ? 'bg-[#27282b]/90 cursor-not-allowed'
                            : 'bg-white hover:bg-zinc-200 cursor-pointer active:scale-95'
                        }`}
                      >
                        <ArrowRight size={16} strokeWidth={2.5} className={!editPrompt.trim() ? "text-white/40" : "text-black"} />
                      </button>
                    </div>
                  </div>
                </div>
                </div>
              )}
            </motion.div>

            {/* Warning popup overlay */}
            {pendingTool !== null && (
              <div 
                className="absolute inset-0 z-[100] flex items-center justify-center"
                style={{
                  animation: 'slowBlurFade 1.4s cubic-bezier(0.16, 1, 0.3, 1) forwards',
                }}
              >
                <style>{`
                  @keyframes slowBlurFade {
                    from {
                      backdrop-filter: blur(0px);
                      background-color: rgba(0, 0, 0, 0);
                    }
                    to {
                      backdrop-filter: blur(8px);
                      background-color: rgba(0, 0, 0, 0.45);
                    }
                  }
                `}</style>
                
                {/* Menu Card itself - immediately visible */}
                <div 
                  className="bg-[#141517]/90 backdrop-blur-xl rounded-[22px] pt-3.5 pb-[9px] px-[9px] w-[370px] flex flex-col items-center shadow-[0_20px_45px_rgba(0,0,0,0.65)] animate-none transform -translate-y-12"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" className="text-white opacity-90">
                    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  
                  <p className="text-white text-[11.5px] font-semibold text-center mt-3 tracking-wide select-none">
                    Changing editing modes will discard ungenerated changes!
                  </p>
                  
                  <div className="flex items-center gap-[9px] w-full mt-4">
                    <button
                      onClick={() => setPendingTool(null)}
                      className="flex-1 py-[7px] rounded-[9px] bg-[#2c2c2e] hover:bg-[#3a3a3c] text-white text-[12px] font-semibold transition-colors"
                    >
                      Go Back
                    </button>
                    <button
                      onClick={() => {
                        // Discard changes
                        setAnnotations([]);
                        setRedoStack([]);
                        setCurrentAnnotation(null);
                        setTextInput(null);
                        
                        // Switch tool
                        if (pendingTool === 'crop') {
                          setPreviousTool(activeTool as 'pen' | 'select');
                        }
                        setActiveTool(pendingTool);
                        setShowPenMenu(pendingTool === 'pen');
                        setShowSelectMenu(pendingTool === 'select');
                        setShowCropMenu(pendingTool === 'crop');
                        
                        // Close warning dialog
                        setPendingTool(null);
                      }}
                      className="flex-1 py-[7px] rounded-[9px] bg-white hover:bg-zinc-200 text-black text-[12px] font-semibold transition-colors"
                    >
                      Discard
                    </button>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AgentSidebar 
        isOpen={isAgentSidebarOpen} 
        onClose={() => setIsAgentSidebarOpen(false)} 
        isHeaderVisible={isHeaderVisible}
        mediaItems={mediaItems}
        sidebarTransition={currentSidebarTransitionTiming}
        prompt={prompt}
        setPrompt={setPrompt}
        attachments={attachments.filter(Boolean)}
        setAttachments={setAttachments}
        chatMessages={chatMessages}
        setChatMessages={setChatMessages}
        isGenerating={isAgentGenerating}
        setIsGenerating={setIsAgentGenerating}
        streaming={agentStreaming}
        setStreaming={setAgentStreaming}
        isThinking={isAgentThinking}
        setIsThinking={setIsAgentThinking}
        thinkingPhase={agentThinkingPhase}
        setThinkingPhase={setAgentThinkingPhase}
        sessionName={sessionName}
        setSessionName={setSessionName}
        handleSend={handleAgentSend}
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
        instructions={instructions}
        setInstructions={setInstructions}
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
              setInstructions(prev => prev.map(inst => 
                inst.id === activeInstructionId 
                  ? { ...inst, referenceName: assetTitle || 'reference.pdf' } 
                  : inst
              ));
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
            setPrompt(prev => {
              const separator = prev.trim() ? ' ' : '';
              return `${prev.trim()}${separator}[${assetTitle}]`;
            });
          }
        }}
      />
      
      {/* Custom floating ghost drag image with 100% full opacity, no border, and larger size */}
      {draggingItemId && (() => {
        const item = mediaItems.find(m => m.id === draggingItemId);
        if (!item || !item.url) return null;
        
        const ratio = item.ratio;
        let ar = 16 / 9;
        if (ratio === '4:3') ar = 4 / 3;
        else if (ratio === '1:1') ar = 1;
        else if (ratio === '3:4') ar = 3 / 4;
        else if (ratio === '9:16') ar = 9 / 16;
        
        let ghostWidth = 210; // Reduced base width
        let ghostHeight = ghostWidth / ar;
        
        // Cap the maximum height so 9:16 and 1:1 don't become massive
        const maxHeight = 145;
        if (ghostHeight > maxHeight) {
          ghostHeight = maxHeight;
          ghostWidth = ghostHeight * ar;
        }
        
        const isMultiSelectDrag = selectedTileIds.has(draggingItemId) && selectedTileIds.size > 1;
        let previewItems = [item];
        if (isMultiSelectDrag) {
          const otherSelected = mediaItems.filter(m => selectedTileIds.has(m.id) && m.id !== draggingItemId);
          previewItems = [item, ...otherSelected].slice(0, 3);
        }
        
        return (
          <div
            style={{
              position: 'fixed',
              left: `${dragMousePos.x - ghostWidth / 2}px`,
              top: `${dragMousePos.y - ghostHeight / 2}px`,
              width: `${ghostWidth}px`,
              height: `${ghostHeight}px`,
              pointerEvents: 'none',
              zIndex: 99999,
              opacity: 1, // 100% full opacity
            }}
          >
            {[...previewItems].reverse().map((previewItem, reverseIndex) => {
              const originalIndex = previewItems.length - 1 - reverseIndex;
              const offsetX = originalIndex * 36;
              const offsetY = originalIndex * 36;

              // Calculate aspect ratio specifically for this item
              const pRatio = previewItem.ratio;
              let pAr = 16 / 9;
              if (pRatio === '4:3') pAr = 4 / 3;
              else if (pRatio === '1:1') pAr = 1;
              else if (pRatio === '3:4') pAr = 3 / 4;
              else if (pRatio === '9:16') pAr = 9 / 16;
              
              let itemWidth = 210;
              let itemHeight = itemWidth / pAr;
              
              if (itemHeight > 145) {
                itemHeight = 145;
                itemWidth = itemHeight * pAr;
              }

              // Calculate vertical alignment so the bottom edges step evenly by the offset
              const heightDiff = ghostHeight - itemHeight;
              const alignedTopOffset = offsetY + heightDiff;

              return (
                <div
                  key={previewItem.id}
                  style={{
                    position: 'absolute',
                    top: `${alignedTopOffset}px`,
                    left: `${offsetX}px`,
                    width: `${itemWidth}px`,
                    height: `${itemHeight}px`,
                    borderRadius: '18px',
                    overflow: 'hidden',
                    backgroundColor: '#0c0c0c',
                    border: '1px solid #4A4A4A',
                  }}
                >
                  {previewItem.kind === 'video' ? (
                    <video
                      src={previewItem.url}
                      loop
                      muted
                      autoPlay
                      playsInline
                      style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '18px' }}
                    />
                  ) : (
                    <img
                      src={previewItem.url}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '18px' }}
                      alt=""
                    />
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Characters and Music views have been moved to early returns to completely unmount the canvas when active */}

      {createPortal(
        canvasContextMenuCoords && (
          <div
            ref={canvasMenuRef}
            style={{ ...canvasMenuStyle, WebkitBackfaceVisibility: 'hidden', backfaceVisibility: 'hidden' }}
            className="fixed w-[180px] bg-[#141517]/90 backdrop-blur-[80px] rounded-[20px] py-2 shadow-[0_10px_40px_rgba(0,0,0,0.5)] overflow-hidden text-[#e5e5e5] pointer-events-auto border border-white/5"
          >
            <button 
              onClick={(e) => {
                e.stopPropagation();
                setCanvasContextMenuCoords(null);
              }}
              className="w-full flex items-center gap-3 px-3.5 py-2 hover:bg-white/5 transition-colors text-[12px] font-medium text-zinc-100"
            >
              <Folder size={18} strokeWidth={2.5} className="text-zinc-100" />
              <span>Create Collection</span>
            </button>
            
            <div className="mx-3.5 h-[1px] bg-white/10 my-1" />
            
            <button 
              onClick={(e) => {
                e.stopPropagation();
                setCanvasContextMenuCoords(null);
              }}
              className="w-full flex items-center gap-3 px-3.5 py-2 hover:bg-white/5 transition-colors text-[12px] font-medium text-zinc-100"
            >
              <Film size={18} strokeWidth={2.5} className="text-zinc-100" />
              <span>Create Scene</span>
            </button>
            
            <div className="mx-3.5 h-[1px] bg-white/10 my-1" />
            
            <button 
              className="w-full flex items-center gap-3 px-3.5 py-2 text-[12px] font-medium text-zinc-500 cursor-not-allowed select-none"
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              <Clipboard size={18} strokeWidth={2.5} className="text-zinc-500" />
              <span>Paste</span>
            </button>
          </div>
        ),
        document.body
      )}

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
