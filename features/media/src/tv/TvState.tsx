// Willow TV's state, as Flow TV's providers hold it: the library (Willow's own, read from storage),
// the remote (what is playing, mute, loop, the prompt toggle), fullscreen, the idle timer that
// hides the remote, the two videos a channel change blends, open dialogs, and the page theme.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLocalFS } from '@willow/storage/local-fs/LocalFSContext';
import { getMediaIndex, loadProjectCover, loadProjectMedia } from '@willow/storage/media-storage';
import { listScenes } from '@willow/storage/media-scenes';
import { collectionPath, listCollections } from '@willow/storage/media-collections';
import { PROJECTS_UPDATED_EVENT, readProjectRegistry } from '@willow/projects/registry';
import { loadTvLibrary, usableUrl, type TvLibrary, type TvMediaRef } from './tv-library';
import { PARAM_FILTER, PARAM_QUERY, PARAM_RANDOM, PARAM_RANDOM_GENERATION, tvClipPath } from './tv-routes';
import type { TvPaletteName } from './tv-theme';

/* ---- the library ---- */

interface LibraryValue {
  library: TvLibrary | null;
  /** A clip's playable URL: its own, or its file read from the project folder. */
  resolveUrl: (media: TvMediaRef) => Promise<string | null>;
}

const LibraryContext = createContext<LibraryValue | null>(null);

export const TvLibraryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { chatScopeId, loadLocalFSMediaUrl, isLocalFolderConnected, isLocalFolderAuthorized, isChatListHydrated, isInitializingLocalFS } = useLocalFS();
  const canReadDisk = isLocalFolderConnected && isLocalFolderAuthorized;
  // The scope is the signed-in account's (and its folder's) only once both have settled; read
  // before then, a signed-in user's projects would look like none at all.
  const settled = isChatListHydrated && !isInitializingLocalFS;
  const [library, setLibrary] = useState<TvLibrary | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener(PROJECTS_UPDATED_EVENT, bump);
    return () => window.removeEventListener(PROJECTS_UPDATED_EVENT, bump);
  }, []);
  useEffect(() => {
    if (!settled) return;
    let live = true;
    const index = getMediaIndex();
    const projects = (readProjectRegistry(chatScopeId) as { id: string; name: string; kind?: string }[])
      .filter((p) => p.kind === 'media' || (index[p.id]?.count || 0) > 0);
    void loadTvLibrary({
      projects,
      canReadDisk,
      loadMedia: (id) => loadProjectMedia(id, chatScopeId),
      loadScenes: (id) => listScenes(id, chatScopeId),
      loadCover: (id) => loadProjectCover(id, chatScopeId),
      loadFolders: async (id) => {
        const stored = await listCollections(id, chatScopeId);
        const byId = new Map(stored.map((c) => [c.id, c]));
        return Object.fromEntries(stored.map((c) => [c.id, collectionPath(c, byId)]));
      },
    }).then((lib) => { if (live) setLibrary(lib); });
    return () => { live = false; };
  }, [settled, chatScopeId, canReadDisk, version]);

  const urls = useRef(new Map<string, Promise<string | null>>());
  const made = useRef<string[]>([]);
  useEffect(() => () => { for (const u of made.current) URL.revokeObjectURL(u); }, []);
  const resolveUrl = useCallback((media: TvMediaRef) => {
    if (usableUrl(media.url)) return Promise.resolve(media.url);
    if (!media.fsName) return Promise.resolve(null);
    let url = urls.current.get(media.id);
    if (!url) {
      url = loadLocalFSMediaUrl(media.projectName, 'video', media.fsName, media.folder)
        .then((u) => { if (u) made.current.push(u); return u; })
        .catch(() => null);
      urls.current.set(media.id, url);
    }
    return url;
  }, [loadLocalFSMediaUrl]);

  const value = useMemo(() => ({ library, resolveUrl }), [library, resolveUrl]);
  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
};

export function useTvLibrary(): LibraryValue {
  const v = useContext(LibraryContext);
  if (!v) throw new Error('useTvLibrary outside TvLibraryProvider');
  return v;
}

/** A clip's URL once it is known (null while it is read from disk, or when it cannot be). */
export function useMediaUrl(media: TvMediaRef | null | undefined): string | null {
  const { resolveUrl } = useTvLibrary();
  const [url, setUrl] = useState<string | null>(() => (media && usableUrl(media.url) ? media.url : null));
  useEffect(() => {
    if (!media) {
      setUrl(null);
      return;
    }
    let live = true;
    void resolveUrl(media).then((u) => { if (live) setUrl(u); });
    return () => { live = false; };
  }, [media, resolveUrl]);
  return url;
}

/* ---- the remote ---- */

export type TvView = 'channel-generation' | 'channel-grid' | 'channel-search-generation' | 'channel-short-film-generation';
export type TvLoop = 'off' | 'loop-channel' | 'loop-generation';
export const LOOP_ORDER: readonly TvLoop[] = ['off', 'loop-channel', 'loop-generation'];

export interface ChannelLink {
  slug: string;
  generationId: string;
  thumb: string | null;
}

/** What the remote shows of the channel playing: Flow TV's channel props. */
export interface ChannelProps {
  slug: string;
  name: string;
  colorTheme: TvPaletteName;
  thumb: string | null;
  /** The clip drawn as the thumbnail when the channel has no cover. */
  thumbMedia: TvMediaRef | null;
  firstGenerationId: string | null;
  lastGenerationId: string | null;
  totalGenerations: number;
  previousChannel: ChannelLink | null;
  nextChannel: ChannelLink | null;
  hasAudio: boolean;
}

/** And of the clip playing: Flow TV's channel-generation props. */
export interface GenerationProps {
  id: string;
  description: string;
  genType: string;
  modelName: string;
  thumb: string | null;
  createdBy: string | null;
  hasFullVideo: boolean;
  videoHasControls: boolean;
  videoHasAudio: boolean;
  previousGenerationId: string | null;
  nextGenerationId: string | null;
  nextRandomChannelGeneration: { slug: string; generationId: string } | null;
  /** The channel it belongs to, when it plays in the search or short-film channel. */
  parentSlug: string;
  projectId: string;
  /** Short films only: its name, shown where a channel's would be. */
  title?: string;
  shareMedia: TvMediaRef | null;
}

interface RemoteValue {
  canPlayAudio: boolean;
  muted: boolean;
  loop: TvLoop;
  isDataVisible: boolean;
  enableAudio: () => void;
  setMuted: React.Dispatch<React.SetStateAction<boolean>>;
  setLoop: React.Dispatch<React.SetStateAction<TvLoop>>;
  setIsDataVisible: React.Dispatch<React.SetStateAction<boolean>>;
  paused: boolean;
  setPaused: React.Dispatch<React.SetStateAction<boolean>>;
  view: TvView | null;
  setView: (v: TvView | null) => void;
  channelProps: ChannelProps | null;
  setChannelProps: (c: ChannelProps | null) => void;
  channelGenerationProps: GenerationProps | null;
  setChannelGenerationProps: (g: GenerationProps | null) => void;
  isTransitioning: boolean;
  setIsTransitioning: (v: boolean) => void;
  isShareDialogOpen: boolean;
  setIsShareDialogOpen: (v: boolean) => void;
  disableChannelNavigation: boolean;
  setDisableChannelNavigation: (v: boolean) => void;
  /** Set while a navigation is under way, so a second press does not start another. */
  blockRoutingRef: React.MutableRefObject<boolean>;
  /** A channel tile's shuffle: how far through the channel it has gone, either way. */
  randomGenerationLoopRef: React.MutableRefObject<{ totalGenerationsZeroIndexed: number; traversedGenerations: number } | null>;
  /** Bumped when Next or Previous lands on the clip already playing, which then starts over. */
  replayToken: number;
  goToNextChannelGeneration: (auto?: boolean) => void;
  goToPreviousChannelGeneration: () => void;
}

const RemoteContext = createContext<RemoteValue | null>(null);

export const TvRemoteProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [canPlayAudio, setCanPlayAudio] = useState(false);
  const [muted, setMutedState] = useState(true);
  const [loop, setLoop] = useState<TvLoop>('off');
  const [isDataVisible, setIsDataVisible] = useState(true);
  const [paused, setPaused] = useState(false);
  const [view, setView] = useState<TvView | null>(null);
  const [channelProps, setChannelProps] = useState<ChannelProps | null>(null);
  const [channelGenerationProps, setChannelGenerationProps] = useState<GenerationProps | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const [disableChannelNavigation, setDisableChannelNavigation] = useState(false);
  const [replayToken, setReplayToken] = useState(0);
  const blockRoutingRef = useRef(false);
  const randomGenerationLoopRef = useRef<RemoteValue['randomGenerationLoopRef']['current']>(null);
  const randomHistoryRef = useRef<string[]>([]);
  const here = `${location.pathname}${location.search}`;

  const enableAudio = useCallback(() => {
    setCanPlayAudio(true);
    setMutedState(false);
  }, []);
  const setMuted = useCallback<React.Dispatch<React.SetStateAction<boolean>>>((next) => {
    setMutedState((prev) => {
      const value = typeof next === 'function' ? next(prev) : next;
      if (!value) setCanPlayAudio(true);
      return value;
    });
  }, []);

  /** Flow TV pushes the route; landing where it already is, the clip starts over instead. */
  const go = useCallback((path: string) => {
    if (path === here) {
      blockRoutingRef.current = false;
      setReplayToken((t) => t + 1);
      return;
    }
    navigate(path);
  }, [here, navigate]);

  const searchOf = (params: URLSearchParams) => (view === 'channel-search-generation'
    ? { query: params.get(PARAM_QUERY), filter: params.get(PARAM_FILTER) }
    : {});

  const goToNextChannelGeneration = useCallback((auto = false) => {
    if (isTransitioning || blockRoutingRef.current) return;
    blockRoutingRef.current = true;
    const ch = channelProps;
    const gen = channelGenerationProps;
    if (!ch || !gen) {
      blockRoutingRef.current = false;
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get(PARAM_RANDOM_GENERATION) === 'true' && ch.totalGenerations) {
      randomGenerationLoopRef.current = { totalGenerationsZeroIndexed: ch.totalGenerations - 1, traversedGenerations: 0 };
    }
    const shuffle = randomGenerationLoopRef.current;
    if (auto && loop === 'off' && gen.nextRandomChannelGeneration && params.get(PARAM_RANDOM) === 'true') {
      const path = tvClipPath(gen.nextRandomChannelGeneration.slug, gen.nextRandomChannelGeneration.generationId, { random: true });
      randomHistoryRef.current.push(path);
      go(path);
      return;
    }
    randomHistoryRef.current = [];
    if (loop !== 'off' || view === 'channel-short-film-generation' || view === 'channel-search-generation'
      || (shuffle && shuffle.traversedGenerations < shuffle.totalGenerationsZeroIndexed)) {
      if (shuffle) shuffle.traversedGenerations += 1;
      const id = gen.nextGenerationId ?? ch.firstGenerationId;
      if (id) go(tvClipPath(ch.slug, id, searchOf(params)));
      else blockRoutingRef.current = false;
      return;
    }
    if (gen.nextGenerationId && !shuffle) {
      go(tvClipPath(ch.slug, gen.nextGenerationId));
      return;
    }
    randomGenerationLoopRef.current = null;
    if (ch.nextChannel) {
      go(tvClipPath(ch.nextChannel.slug, ch.nextChannel.generationId));
      return;
    }
    // Willow's lone channel: Flow TV always has another, so it never runs out like this.
    if (ch.firstGenerationId) go(tvClipPath(ch.slug, ch.firstGenerationId));
    else blockRoutingRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTransitioning, channelProps, channelGenerationProps, loop, view, go]);

  const goToPreviousChannelGeneration = useCallback(() => {
    if (isTransitioning || blockRoutingRef.current) return;
    blockRoutingRef.current = true;
    const ch = channelProps;
    const gen = channelGenerationProps;
    if (!ch || !gen) {
      blockRoutingRef.current = false;
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get(PARAM_RANDOM_GENERATION) === 'true' && ch.totalGenerations) {
      randomGenerationLoopRef.current = { totalGenerationsZeroIndexed: ch.totalGenerations - 1, traversedGenerations: 0 };
    }
    if (loop === 'off' && randomHistoryRef.current.pop()) {
      navigate(-1);
      return;
    }
    randomHistoryRef.current = [];
    const shuffle = randomGenerationLoopRef.current;
    if (loop !== 'off' || view === 'channel-short-film-generation' || view === 'channel-search-generation'
      || (shuffle && shuffle.traversedGenerations > -shuffle.totalGenerationsZeroIndexed)) {
      if (shuffle) shuffle.traversedGenerations -= 1;
      const id = gen.previousGenerationId ?? ch.lastGenerationId;
      if (id) go(tvClipPath(ch.slug, id, searchOf(params)));
      else blockRoutingRef.current = false;
      return;
    }
    if (gen.previousGenerationId && !shuffle) {
      go(tvClipPath(ch.slug, gen.previousGenerationId));
      return;
    }
    randomGenerationLoopRef.current = null;
    if (ch.previousChannel) {
      go(tvClipPath(ch.previousChannel.slug, ch.previousChannel.generationId));
      return;
    }
    if (ch.lastGenerationId) go(tvClipPath(ch.slug, ch.lastGenerationId));
    else blockRoutingRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTransitioning, channelProps, channelGenerationProps, loop, view, go, navigate]);

  const value = useMemo<RemoteValue>(() => ({
    canPlayAudio, muted, loop, isDataVisible, enableAudio, setMuted, setLoop, setIsDataVisible,
    paused, setPaused, view, setView, channelProps, setChannelProps, channelGenerationProps, setChannelGenerationProps,
    isTransitioning, setIsTransitioning, isShareDialogOpen, setIsShareDialogOpen,
    disableChannelNavigation, setDisableChannelNavigation, blockRoutingRef, randomGenerationLoopRef, replayToken,
    goToNextChannelGeneration, goToPreviousChannelGeneration,
  }), [canPlayAudio, muted, loop, isDataVisible, enableAudio, setMuted, paused, view, channelProps, channelGenerationProps,
    isTransitioning, isShareDialogOpen, disableChannelNavigation, replayToken, goToNextChannelGeneration, goToPreviousChannelGeneration]);
  return <RemoteContext.Provider value={value}>{children}</RemoteContext.Provider>;
};

export function useTvRemote(): RemoteValue {
  const v = useContext(RemoteContext);
  if (!v) throw new Error('useTvRemote outside TvRemoteProvider');
  return v;
}

/* ---- fullscreen ---- */

interface FullscreenValue {
  fullscreen: boolean;
  toggleFullscreen: () => void;
}

const FullscreenContext = createContext<FullscreenValue | null>(null);

/** Flow TV's page goes fullscreen; Willow TV's root does, which its stylesheet's `:fullscreen` rules expect. */
export const TvFullscreenProvider: React.FC<{ rootRef: React.RefObject<HTMLElement | null>; children: React.ReactNode }> = ({ rootRef, children }) => {
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement !== null && document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, [rootRef]);
  const toggleFullscreen = useCallback(() => {
    if (fullscreen) void document.exitFullscreen().catch(() => undefined);
    else void rootRef.current?.requestFullscreen().catch(() => undefined);
  }, [fullscreen, rootRef]);
  const value = useMemo(() => ({ fullscreen, toggleFullscreen }), [fullscreen, toggleFullscreen]);
  return <FullscreenContext.Provider value={value}>{children}</FullscreenContext.Provider>;
};

export function useTvFullscreen(): FullscreenValue {
  const v = useContext(FullscreenContext);
  if (!v) throw new Error('useTvFullscreen outside TvFullscreenProvider');
  return v;
}

/* ---- idle ---- */

interface IdleValue {
  isIdle: boolean;
  checkIfIdle: () => void;
}

const IdleContext = createContext<IdleValue | null>(null);

/**
 * Flow TV's idle timer: two seconds without a move, press or key and the player counts as idle
 * (the remote hides in fullscreen). It starts out idle; it never runs on a channel's grid; in
 * fullscreen it waits a second before it starts.
 */
export const TvIdleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { view } = useTvRemote();
  const { fullscreen } = useTvFullscreen();
  const [fullscreenSettled, setFullscreenSettled] = useState(false);
  useEffect(() => {
    if (!fullscreen) return;
    const t = setTimeout(() => setFullscreenSettled(true), 1000);
    return () => {
      setFullscreenSettled(false);
      clearTimeout(t);
    };
  }, [fullscreen]);
  const isEnabled = fullscreen ? fullscreenSettled : view !== 'channel-grid';
  const [idle, setIdle] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wasEnabled = useRef(false);
  const checkIfIdle = useCallback(() => {
    if (!isEnabled) return;
    clearTimeout(timer.current);
    setIdle(false);
    timer.current = setTimeout(() => setIdle(true), 2000);
  }, [isEnabled]);
  useEffect(() => {
    if (!isEnabled) return;
    if (wasEnabled.current) checkIfIdle();
    const events = ['mousemove', 'mousedown', 'focusin', 'keydown'] as const;
    for (const e of events) window.addEventListener(e, checkIfIdle);
    return () => {
      clearTimeout(timer.current);
      for (const e of events) window.removeEventListener(e, checkIfIdle);
      wasEnabled.current = true;
    };
  }, [isEnabled, checkIfIdle]);
  const value = useMemo(() => ({ isIdle: isEnabled ? idle : true, checkIfIdle }), [isEnabled, idle, checkIfIdle]);
  return <IdleContext.Provider value={value}>{children}</IdleContext.Provider>;
};

export function useTvIdle(): IdleValue {
  const v = useContext(IdleContext);
  if (!v) throw new Error('useTvIdle outside TvIdleProvider');
  return v;
}

/* ---- the channel change's two videos ---- */

interface ShaderValue {
  currentVideo: HTMLVideoElement | null;
  nextVideo: HTMLVideoElement | null;
  setCurrentVideo: (v: HTMLVideoElement | null) => void;
  setNextVideo: (v: HTMLVideoElement | null) => void;
}

const ShaderContext = createContext<ShaderValue | null>(null);

export const TvShaderTransitionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentVideo, setCurrentVideo] = useState<HTMLVideoElement | null>(null);
  const [nextVideo, setNextVideo] = useState<HTMLVideoElement | null>(null);
  const value = useMemo(() => ({ currentVideo, nextVideo, setCurrentVideo, setNextVideo }), [currentVideo, nextVideo]);
  return <ShaderContext.Provider value={value}>{children}</ShaderContext.Provider>;
};

export function useTvShaderTransition(): ShaderValue {
  const v = useContext(ShaderContext);
  if (!v) throw new Error('useTvShaderTransition outside TvShaderTransitionProvider');
  return v;
}

/* ---- dialogs and the page theme ---- */

interface ShellValue {
  hasOpenDialog: boolean;
  setHasOpenDialog: (v: boolean) => void;
  pageTheme: TvPaletteName | null;
  setPageTheme: (t: TvPaletteName | null) => void;
}

const ShellContext = createContext<ShellValue | null>(null);

export const TvShellProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [hasOpenDialog, setHasOpenDialog] = useState(false);
  const [pageTheme, setPageTheme] = useState<TvPaletteName | null>(null);
  const value = useMemo(() => ({ hasOpenDialog, setHasOpenDialog, pageTheme, setPageTheme }), [hasOpenDialog, pageTheme]);
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
};

export function useTvShell(): ShellValue {
  const v = useContext(ShellContext);
  if (!v) throw new Error('useTvShell outside TvShellProvider');
  return v;
}

/* ---- Flow TV's hooks ---- */

/** A key (by `KeyboardEvent.code`) anywhere on the page, or on `target` when given. */
export function useHotkey(code: string, handler: (e: KeyboardEvent) => void, opts: { isEnabled?: boolean; target?: React.RefObject<HTMLElement | null> } = {}): void {
  const { isEnabled = true, target } = opts;
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!isEnabled) return;
    const el: HTMLElement | Window | null = target ? target.current : window;
    if (!el) return;
    const onKey = (e: Event) => {
      if ((e as KeyboardEvent).code === code) latest.current(e as KeyboardEvent);
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [code, isEnabled, target]);
}

/** Typing in a field: the remote's keys leave the keyboard alone then. */
export const isTyping = (): boolean => {
  const el = document.activeElement;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
};

/** After a key press the remote drops focus, so no focus ring stays behind. */
export const blurActive = (): void => {
  const el = document.activeElement;
  if (el instanceof HTMLElement) el.blur();
};

const QUERIES: Record<string, string> = {
  mobile: '(max-width: 767px)',
  'mobile-large': '(min-width: 412px)',
  tablet: '(min-width: 768px)',
  laptop: '(min-width: 1280px)',
  desktop: '(min-width: 1600px)',
  coarse: '(pointer: coarse)',
  fine: '(pointer: fine)',
  portrait: '(orientation: portrait)',
  landscape: '(orientation: landscape)',
};

/** Flow TV's breakpoint hook: `mobile` is below the tablet width, the rest are minimum widths. */
export function useMediaQuery(name: keyof typeof QUERIES | string): boolean {
  const query = QUERIES[name] ?? name;
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const sync = () => setMatches(mql.matches);
    sync();
    mql.addEventListener('change', sync);
    return () => mql.removeEventListener('change', sync);
  }, [query]);
  return matches;
}

export { formatChannelName } from './tv-library';
