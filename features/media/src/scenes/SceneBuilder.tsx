// Flow's Scenebuilder, the editor a scene opens into. One full-window surface:
//
//   header    back · editable name │ navigation rail │ favorite · download · trash · history · ⋮ · Done
//   editor    aspect toggle │ canvas + playback │ history sidebar
//   timeline  ruler, clips, playhead, zoom
//   prompt    "Describe how to edit this video…" on Omni 1.1 Flash
//
// Layout, type, colour and every animation are Flow's (see scene-builder.css for where each was
// read). Behaviour was recorded the same way: e.g. Escape with nothing open leaves the editor,
// Move to trash asks nothing and offers Undo, and an edit turns its clip into a shimmering
// placeholder until the new version lands in the clip's history.
import React from 'react';
import { useStore } from '@nanostores/react';
import type { ReadableAtom } from 'nanostores';
import { Tooltip } from '@willow/ui/Tooltip';
import type { MediaItem } from '../types';
import { GeneratingLayers, useGenerationProgress } from '../GalleryTile';
import { MusicIcon } from '../media-icons';
import { openWillowTv } from '../tv/tv-routes';
import {
  $pendingEdits,
  $sceneClipboard,
  $scenes,
  $videoScenes,
  isVideoScene,
  copyClips,
  getScene,
  newClipId,
  openScene,
  pasteClips,
  setPendingEdit,
  showSnack,
  trashScene,
  updateScene,
  updateSnack,
  type Scene,
  type SceneClip,
} from './scene-store';
import { clipDuration, clipStarts, formatTimecode, locateTime, ZOOM_LEVELS } from './scene-format';
import { captureFrame, captureFullFrame, probeVideo } from './scene-frames';
import { usePlayableUrls } from './scene-media-url';
import { ScenePlayer } from './scene-player';
import { exportScene, isExporting } from './scene-export';
import { requestSceneEdit } from './scene-edit';
import { historyOf, type SceneHost } from './scene-host';
import { buildRailEntries, NavigationRail } from '../editor/NavigationRail';
import { DownloadMenu, FlagDialog, ShareDialog } from '../editor/editor-overlays';
import { SceneTimeline } from './SceneTimeline';
import { SceneHistory } from './SceneHistory';
import { SceneMediaPicker, type PickerMode } from './SceneMediaPicker';
import { FlowEditableText, FlowIcon, FlowMatDivider, FlowMatMenu, FlowMatMenuItem, type MenuAnchor } from './flow-ui';
import { useMediaViewport, useTouchScreen } from '../use-media-viewport';
import './scene-builder.css';
import '../editor/editor-responsive.css';

const SIDEBAR_EASE = 'cubic-bezier(0.2, 0, 0, 1)';
const SIDEBAR_MS = 300;
/** Flow drops `animating-out` 322ms after the hide starts, then the panel is display:none. */
const SIDEBAR_OUT_MS = 322;

/**
 * The clips while there is no scene yet (a video's is built after the view first renders). One
 * array, not a fresh `[]` per render: the player effect depends on it, and a new one each render
 * re-ran it, which re-rendered this, without end.
 */
const NO_CLIPS: SceneClip[] = [];

const MORE_ITEMS: { icon: React.ReactNode; label: string; onSelect?: () => void }[] = [
  { icon: 'download', label: 'Download project' },
  { icon: 'help', label: 'Product help' },
  { icon: 'help', label: 'Willow help center' },
  { icon: 'list_alt', label: 'View all changelogs' },
  { icon: <MusicIcon />, label: 'Willow Music' },
  { icon: 'tv', label: 'Willow TV', onSelect: openWillowTv },
  { icon: 'info', label: 'About Willow' },
  { icon: 'smart_display', label: 'Learn Willow' },
  { icon: 'feedback', label: 'Send app feedback' },
  { icon: 'flag', label: 'Report legal issue' },
  { icon: 'info', label: 'Privacy notice' },
];

const uid = () => `${Date.now()}-scene-${Math.random().toString(36).slice(2, 8)}`;

function download(url: string, filename: string): void {
  void fetch(url).then((r) => r.blob()).then((blob) => {
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
  }).catch(() => window.open(url, '_blank'));
}

const safeName = (name: string) => name.replace(/[\\/:*?"<>|]/g, '').trim() || 'Scene';

/**
 * The index of the clip under the playhead (-1 for none), read from the player's per-frame
 * `$time` but changing only at a cut. Its caller renders at every cut, mid-playback: keep it in
 * something small (CanvasOverlays), not the editor.
 */
function usePlayheadClip(player: ScenePlayer, clips: SceneClip[]): number {
  const indexAt = React.useCallback((t: number) => locateTime(clips, t)?.index ?? -1, [clips]);
  const [index, setIndex] = React.useState(() => indexAt(player.$time.get()));
  React.useEffect(() => {
    setIndex(indexAt(player.$time.get()));
    return player.$time.listen((t) => setIndex(indexAt(t)));
  }, [player, indexAt]);
  return index;
}

/**
 * What sits on the canvas and depends on the clip under the playhead: an edit in progress on it,
 * the poster, Save frame. Its own component, so that a cut renders this and not the editor: a
 * render of the whole editor takes ~60ms, and the canvas stood still for it at every cut.
 */
const CanvasOverlays: React.FC<{
  player: ScenePlayer;
  clips: SceneClip[];
  pendingEdits: Record<string, string>;
  itemById: (id: string) => MediaItem | undefined;
  poster?: string;
  ready: boolean;
  savingFrame: boolean;
  onSaveFrame: () => void;
}> = ({ player, clips, pendingEdits, itemById, poster, ready, savingFrame, onSaveFrame }) => {
  const playheadIndex = usePlayheadClip(player, clips);
  const clipAtPlayhead = playheadIndex >= 0 ? clips[playheadIndex] : undefined;
  const pendingId = clipAtPlayhead ? pendingEdits[clipAtPlayhead.id] : undefined;
  const pendingItem = pendingId ? itemById(pendingId) : undefined;
  const missing = clipAtPlayhead && !pendingId && !itemById(clipAtPlayhead.mediaId) ? clipAtPlayhead : undefined;
  return (
    <>
      {!ready && poster && !pendingItem && !missing && <img className="sb-canvas-poster" src={poster} alt="" />}
      {pendingItem && <CanvasPending item={pendingItem} />}
      {missing && (
        <div className="sb-canvas-missing" role="status">
          <FlowIcon name="error" size={24} />
          <span>Video not found</span>
          {missing.file && <span className="sb-canvas-missing__file">{missing.file}</span>}
        </div>
      )}
      {clips.length > 0 && (
        <Tooltip content="Save frame" className="sb-tooltip" disabled={savingFrame}>
          <button type="button" aria-label="Save frame" className="sb-icon-btn sb-save-frame" disabled={!!pendingItem} onClick={onSaveFrame}>
            <FlowIcon name="add_photo_alternate" size={18} />
          </button>
        </Tooltip>
      )}
    </>
  );
};

/** The playhead's timecode, written straight into the DOM: it changes every frame while playing. */
const PlayheadTimecode: React.FC<{ time: ReadableAtom<number> }> = ({ time }) => {
  const ref = React.useRef<HTMLSpanElement>(null);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    // One text node changed in place. A new node each frame is a childList mutation, which the
    // Tailwind CDN's MutationObserver answers by rescanning the whole page for classes.
    const text = document.createTextNode(formatTimecode(time.get()));
    el.replaceChildren(text);
    return time.listen((t) => { text.data = formatTimecode(t); });
  }, [time]);
  return <span ref={ref} />;
};

/* ------------------------------------------------------------------ *
 * The editor
 * ------------------------------------------------------------------ */

/**
 * What the video view adds: Flow opens a gallery video in this same editor (/edit/<videoId>), with
 * the header acting on the video rather than on a scene.
 */
export interface VideoViewHost {
  rename(item: MediaItem, name: string): void;
  toggleFavorite(item: MediaItem): void;
  trash(item: MediaItem): void;
}

export const SceneBuilder: React.FC<{ sceneId: string; host: SceneHost; video?: VideoViewHost }> = ({ sceneId, host, video }) => {
  const scenes = useStore($scenes);
  const videoScenes = useStore($videoScenes);
  const pendingEdits = useStore($pendingEdits);
  const clipboard = useStore($sceneClipboard);
  const scene = isVideoScene(sceneId) ? videoScenes[sceneId] : scenes.find((s) => s.id === sceneId);

  const itemById = React.useCallback((id: string) => host.mediaItems.find((m) => m.id === id), [host.mediaItems]);
  const clips = scene?.clips ?? NO_CLIPS;
  const [selectedId, setSelectedId] = React.useState<string | null>(clips[0]?.id ?? null);
  React.useEffect(() => {
    if (!clips.length) { setSelectedId(null); return; }
    if (!selectedId || !clips.some((c) => c.id === selectedId)) setSelectedId(clips[0].id);
  }, [clips, selectedId]);
  const selectedClip = clips.find((c) => c.id === selectedId);

  /* ---- playback ---- */
  const [player] = React.useState(() => new ScenePlayer());
  React.useEffect(() => () => player.dispose(), [player]);
  const playback = useStore(player.$state);
  const playable = usePlayableUrls(clips.map((c) => (pendingEdits[c.id] ? undefined : itemById(c.mediaId)?.url)));
  React.useEffect(() => {
    player.setClips(clips.map((c, i) => ({ id: c.id, trimStart: c.trimStart, trimEnd: c.trimEnd, url: playable[i] })));
  }, [player, clips, playable]);
  React.useEffect(() => { player.setAspect(scene?.aspectRatio ?? '16:9'); }, [player, scene?.aspectRatio]);
  const attachCanvas = React.useCallback((el: HTMLCanvasElement | null) => player.attach(el), [player]);

  /* ---- canvas box: the aspect-ratio box that fits the space between the toolbar and sidebar ---- */
  const hostRef = React.useRef<HTMLDivElement>(null);
  const [box, setBox] = React.useState({ w: 0, h: 0 });
  React.useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return undefined;
    const ar = scene?.aspectRatio === '9:16' ? 9 / 16 : 16 / 9;
    const fit = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      setBox(w / h > ar ? { w: h * ar, h } : { w, h: w / ar });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scene?.aspectRatio]);

  /* ---- narrow screens (editor-responsive.css) ---- */
  const viewport = useMediaViewport();
  const narrow = viewport !== 'desktop';
  const phone = viewport === 'phone';
  const touch = useTouchScreen();

  /* ---- history sidebar, with Flow's choreography ---- */
  const [historyShown, setHistoryShown] = React.useState(true);
  const [historyLeaving, setHistoryLeaving] = React.useState(false);
  const sidebarRef = React.useRef<HTMLDivElement>(null);
  const canvasColRef = React.useRef<HTMLDivElement>(null);
  const flipFrom = React.useRef<number | null>(null);
  const toggleHistory = () => {
    const col = canvasColRef.current;
    if (col) { const r = col.getBoundingClientRect(); flipFrom.current = r.left + r.width / 2; }
    if (historyShown) {
      setHistoryShown(false);
      setHistoryLeaving(true);
      sidebarRef.current?.animate(
        [{ opacity: 1, transform: 'translateX(0px)' }, { opacity: 0, transform: 'translateX(50%)' }],
        { duration: SIDEBAR_MS, easing: SIDEBAR_EASE, fill: 'forwards' },
      );
      window.setTimeout(() => setHistoryLeaving(false), SIDEBAR_OUT_MS);
    } else {
      setHistoryShown(true);
      setHistoryLeaving(false);
    }
  };
  React.useLayoutEffect(() => {
    const col = canvasColRef.current;
    if (flipFrom.current === null || !col) return;
    const r = col.getBoundingClientRect();
    const dx = flipFrom.current - (r.left + r.width / 2);
    flipFrom.current = null;
    if (Math.abs(dx) > 0.5) {
      col.animate([{ transform: `translate(${dx}px, 0px)` }, { transform: 'none' }], { duration: SIDEBAR_MS, easing: SIDEBAR_EASE });
    }
    if (historyShown && sidebarRef.current) {
      sidebarRef.current.getAnimations().forEach((a) => a.cancel());
      sidebarRef.current.animate(
        [{ opacity: 0, transform: 'translateX(100%)' }, { opacity: 1, transform: 'none' }],
        { duration: SIDEBAR_MS, easing: SIDEBAR_EASE },
      );
    }
  }, [historyShown]);

  /* ---- timeline ---- */
  const [zoom, setZoom] = React.useState(0);
  const pendingClipIds = React.useMemo(() => new Set(Object.keys(pendingEdits).filter((id) => clips.some((c) => c.id === id))), [pendingEdits, clips]);
  // A clip whose video isn't in the gallery: deleted, or its file renamed or moved outside Willow.
  const missingClipIds = React.useMemo(() => new Set(clips.filter((c) => !pendingEdits[c.id] && !itemById(c.mediaId)).map((c) => c.id)), [clips, pendingEdits, itemById]);
  const commitClips = (next: SceneClip[], patch?: Partial<Scene>) => {
    if (!scene) return;
    updateScene(scene.id, { clips: next, ...patch });
  };

  // The gallery tile's poster is the scene's opening frame, so it follows whatever clip is first
  // and where that clip's trim starts.
  const firstClip = clips[0];
  const firstUrl = firstClip && !pendingEdits[firstClip.id] ? itemById(firstClip.mediaId)?.url : undefined;
  React.useEffect(() => {
    if (!firstClip) {
      if (getScene(sceneId)?.poster) updateScene(sceneId, { poster: undefined });
      return undefined;
    }
    if (!firstUrl) return undefined;
    let cancelled = false;
    void captureFrame(firstUrl, firstClip.trimStart, 640).then((poster) => {
      if (!cancelled && poster && getScene(sceneId)?.poster !== poster) updateScene(sceneId, { poster });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [sceneId, firstClip?.id, firstClip?.trimStart, firstUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- menus and dialogs ---- */
  const [moreMenu, setMoreMenu] = React.useState<MenuAnchor | null>(null);
  const moreRef = React.useRef<HTMLButtonElement>(null);
  const [clipMenu, setClipMenu] = React.useState<{ clipId: string; anchor: MenuAnchor } | null>(null);
  const [picker, setPicker] = React.useState<PickerMode | null>(null);
  // The host is rebuilt on every MediaView render; the picker gets steady handles onto it.
  const latestHost = React.useRef(host);
  latestHost.current = host;
  const pickerProjects = React.useMemo(() => (picker ? latestHost.current.listProjects() : []), [picker]);
  const loadProjectMedia = React.useCallback((id: string) => latestHost.current.loadProjectMedia(id), []);
  /** A copy of another project's item, made this project's own and saved with it. */
  const adoptMedia = React.useCallback((item: MediaItem): MediaItem => {
    const copy: MediaItem = {
      ...item,
      id: uid(),
      timestamp: Date.now(),
      historyGroupId: undefined,
      historyParentId: undefined,
      isSavedToFS: false,
      fsName: undefined,
    };
    latestHost.current.addMediaItem(copy);
    if (copy.url) latestHost.current.saveGenerated(copy, copy.url);
    return copy;
  }, []);
  const [exporting, setExporting] = React.useState(() => isExporting(sceneId));
  const downloadRef = React.useRef<HTMLButtonElement>(null);
  const [downloadMenu, setDownloadMenu] = React.useState<MenuAnchor | null>(null);
  const [shareItem, setShareItem] = React.useState<MediaItem | null>(null);
  const [flagOpen, setFlagOpen] = React.useState(false);

  /* ---- edit prompt ---- */
  const [prompt, setPrompt] = React.useState('');
  const [refs, setRefs] = React.useState<MediaItem[]>([]);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  React.useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 240)}px`;
  }, [prompt]);

  const closeEditor = React.useCallback(() => { player.pause(); host.close(); }, [player, host]);

  /* Escape with nothing open leaves the editor; Space plays. Menus and the picker stop their own Escape. */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (e.key === 'Escape' && !typing) { e.preventDefault(); closeEditor(); }
      else if (e.key === ' ' && !typing) { e.preventDefault(); player.toggle(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeEditor, player]);

  /* ---- rail ---- */
  const railEntries = React.useMemo(() => buildRailEntries(scenes, host.mediaItems), [scenes, host.mediaItems]);

  // Flow drops the Save frame tooltip as the save starts, and it stays down until the pointer
  // re-enters the button.
  const [savingFrame, setSavingFrame] = React.useState(false);

  // Every hook is above this: a video's scene is built after the view first renders, and a hook
  // below would change their number between renders, which React refuses.
  if (!scene) {
    return (
      <div className="sb-editor">
        <header className="sb-header">
          <div className="sb-header__left">
            <button type="button" aria-label="Back button to go to previous page" className="sb-icon-btn sb-icon-btn--lg sb-back-btn" onClick={closeEditor}>
              <FlowIcon name="arrow_back" size={24} weight={300} />
            </button>
          </div>
        </header>
      </div>
    );
  }

  const selectedItem = selectedClip ? itemById(selectedClip.mediaId) : undefined;
  const pendingItemId = selectedClip ? pendingEdits[selectedClip.id] : undefined;
  const steps = historyOf(selectedItem, host.mediaItems);

  const saveFrame = async () => {
    const src = player.currentSource();
    const clip = src ? clips.find((c) => c.id === src.clipId) : undefined;
    const media = clip ? itemById(clip.mediaId) : undefined;
    if (!src || !media?.url) return;
    setSavingFrame(true);
    const snackId = showSnack({ icon: 'spinner', text: 'Saving frame...', actions: [{ label: 'Dismiss' }] });
    try {
      const { dataUrl, width, height } = await captureFullFrame(media.url, src.sourceTime);
      const item: MediaItem = {
        id: uid(),
        kind: 'image',
        status: 'completed',
        url: dataUrl,
        prompt: `Saved frame from ${scene.name}`,
        modelId: 'upload',
        modelName: 'Frame',
        ratio: `${width}:${height}`,
        timestamp: Date.now(),
      };
      host.addMediaItem(item);
      host.saveGenerated(item, dataUrl);
      updateSnack(snackId, { icon: 'check_circle', text: 'Frame saved', actions: [{ label: 'View image', run: () => host.openMedia(item) }, { label: 'Dismiss' }] });
    } catch {
      updateSnack(snackId, { icon: 'error', tone: 'error', text: 'The frame could not be saved.', actions: [{ label: 'Dismiss' }] });
    } finally {
      setSavingFrame(false);
    }
  };

  const runExport = () => {
    setExporting(true);
    void exportScene(scene, (id) => itemById(id)?.url, () => setExporting(isExporting(scene.id))).catch(() => undefined);
  };

  const addToProject = (item: MediaItem) => {
    if (!item.url) return;
    host.addMediaItem({ ...item, id: uid(), historyGroupId: undefined, historyParentId: undefined, timestamp: Date.now(), isSavedToFS: false, fsName: undefined });
    showSnack({ icon: 'check_circle', text: 'Added to project', actions: [{ label: 'Dismiss' }] });
  };

  const insertAfterSelected = (newClips: SceneClip[]) => {
    const at = selectedClip ? clips.findIndex((c) => c.id === selectedClip.id) + 1 : clips.length;
    const next = [...clips.slice(0, at), ...newClips, ...clips.slice(at)];
    commitClips(next);
    setSelectedId(newClips[newClips.length - 1]?.id ?? selectedId);
  };

  const onPickClip = async (item: MediaItem, trim: { start: number; end: number } | null) => {
    setPicker(null);
    if (!item.url) return;
    try {
      const { duration } = await probeVideo(item.url);
      const start = trim?.start ?? 0;
      const end = trim?.end ?? duration;
      const thumb = await captureFrame(item.url, start, 192).catch(() => undefined);
      insertAfterSelected([{ id: newClipId(), mediaId: item.id, trimStart: start, trimEnd: end, sourceDuration: duration, thumb }]);
    } catch {
      showSnack({ icon: 'error', tone: 'error', text: 'That video could not be added.', actions: [{ label: 'Dismiss' }] });
    }
  };

  const selectStep = async (item: MediaItem) => {
    if (!selectedClip || !item.url || item.id === selectedClip.mediaId) return;
    const clipId = selectedClip.id;
    const { duration } = await probeVideo(item.url).catch(() => ({ duration: selectedClip.sourceDuration }));
    const thumb = await captureFrame(item.url, 0, 192).catch(() => undefined);
    updateScene(scene.id, (s) => ({ clips: s.clips.map((c) => (c.id === clipId ? { ...c, mediaId: item.id, trimStart: 0, trimEnd: duration, sourceDuration: duration, thumb } : c)) }));
  };

  const submitEdit = async () => {
    const text = prompt.trim();
    if (!text || !selectedClip || !selectedItem?.url || pendingItemId) return;
    const apiKey = host.geminiKey();
    if (!apiKey) {
      showSnack({ icon: 'error', tone: 'error', text: 'Editing a video needs a Google Gemini API key. Add one in Settings > Models & API.', actions: [{ label: 'Dismiss' }] });
      return;
    }
    const clipId = selectedClip.id;
    const source = selectedItem;
    const sourceUrl = source.url as string;
    const loc = locateTime(clips, player.$time.get());
    const sourceTime = Math.max(selectedClip.trimStart, Math.min(loc && clips[loc.index]?.id === clipId ? loc.sourceTime : selectedClip.trimStart, selectedClip.trimEnd));
    const historyGroupId = source.historyGroupId || source.id;
    if (!source.historyGroupId) host.updateMediaItem(source.id, { historyGroupId });
    const item: MediaItem = {
      id: uid(),
      kind: 'video',
      status: 'generating',
      prompt: text,
      modelId: 'omni-flash-1.1',
      modelName: host.omniModelName,
      ratio: source.ratio,
      timestamp: Date.now(),
      historyGroupId,
      historyParentId: source.id,
      collectionId: source.collectionId,
    };
    host.addMediaItem(item);
    setPendingEdit(clipId, item.id);
    setPrompt('');
    const references = refs.map((r) => r.url).filter((u): u is string => !!u);
    setRefs([]);
    try {
      const url = await requestSceneEdit({
        apiKey,
        apiModelId: host.omniApiModelId,
        prompt: text,
        ratio: source.ratio || '16:9',
        clipUrl: sourceUrl,
        frame: () => captureFullFrame(sourceUrl, sourceTime).then((f) => f.dataUrl),
        references,
      });
      host.updateMediaItem(item.id, { status: 'completed', url });
      host.saveGenerated({ ...item, status: 'completed', url }, url);
      const { duration } = await probeVideo(url).catch(() => ({ duration: 8 }));
      const thumb = await captureFrame(url, 0, 192).catch(() => undefined);
      updateScene(scene.id, (s) => ({
        clips: s.clips.map((c) => (c.id === clipId ? { ...c, mediaId: item.id, trimStart: 0, trimEnd: duration, sourceDuration: duration, thumb } : c)),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The edit could not be generated.';
      host.updateMediaItem(item.id, { status: 'failed', error: message });
      showSnack({ icon: 'error', tone: 'error', text: message, actions: [{ label: 'Dismiss' }] });
    } finally {
      setPendingEdit(clipId, null);
    }
  };

  const clipForMenu = clipMenu ? clips.find((c) => c.id === clipMenu.clipId) : undefined;
  const clipForMenuIndex = clipForMenu ? clips.indexOf(clipForMenu) : -1;
  const sceneDuration = clipStarts(clips).total;
  const moveClip = (clipId: string, to: number) => {
    const from = clips.findIndex((c) => c.id === clipId);
    if (from < 0 || from === to) return;
    const next = [...clips];
    const [moved] = next.splice(from, 1);
    next.splice(Math.min(to, next.length), 0, moved);
    commitClips(next);
  };
  const historyProps = {
    steps,
    selectedId: pendingItemId ?? selectedClip?.mediaId,
    hidden: !historyShown,
    animatingOut: historyLeaving,
    itemById,
    onSelect: (item: MediaItem) => void selectStep(item),
    onReuse: (text: string) => { setPrompt(text); textareaRef.current?.focus(); },
    onSave: addToProject,
    onDownload: (item: MediaItem) => { if (item.url) download(item.url, `${safeName(item.prompt)}.mp4`); },
    onFlag: () => setFlagOpen(true),
  };
  // In the video view the header acts on the video under the first clip, and names it by its
  // original: like the image editor, Flow keeps an asset's name across its edits.
  const viewedVersion = video ? itemById(clips[0]?.mediaId ?? '') : undefined;
  const viewed = viewedVersion ? (itemById(viewedVersion.historyGroupId || viewedVersion.id) ?? viewedVersion) : undefined;
  const railActiveId = viewed ? viewed.id : scene.id;

  return (
    <div className="sb-editor" role="region" aria-label="SceneBuilder">
      <header className="sb-header">
        <div className="sb-header__left">
          <nav className="sb-nav-header">
            <Tooltip content="Back" className="sb-tooltip">
              <button type="button" aria-label="Back button to go to previous page" className="sb-icon-btn sb-icon-btn--lg sb-back-btn" onClick={closeEditor}>
                <FlowIcon name="arrow_back" size={24} weight={300} />
              </button>
            </Tooltip>
            <span className="sb-title">
              {video && viewed
                ? <FlowEditableText value={viewed.shortenedPrompt || viewed.prompt} onCommit={(name) => video.rename(viewed, name)} />
                : <FlowEditableText value={scene.name} onCommit={(name) => updateScene(scene.id, { name })} />}
            </span>
          </nav>
        </div>
        <div className="sb-header__center">
          <NavigationRail
            entries={railEntries}
            activeId={railActiveId}
            onPick={(entry) => {
              if (entry.id === railActiveId) return;
              if (entry.kind === 'scene') {
                player.pause();
                // The video view is the media editor, not a scene: leave it before the scene opens.
                if (video) host.close();
                openScene(entry.id);
                return;
              }
              const item = itemById(entry.id);
              if (item) { player.pause(); host.openMedia(item); }
            }}
          />
        </div>
        <div className="sb-header__right">
          <div className="sb-cta">
            {video && viewed ? (
              <>
                <Tooltip content={viewed.favorite ? 'Remove favorite' : 'Favorite'} className="sb-tooltip">
                  <button type="button" aria-label={viewed.favorite ? 'Remove favorite' : 'Favorite'} className="sb-icon-btn" onClick={() => video.toggleFavorite(viewed)}>
                    <FlowIcon name="favorite" size={18} fill={!!viewed.favorite} />
                  </button>
                </Tooltip>
                {!phone && (
                  <Tooltip content="Share" className="sb-tooltip">
                    <button type="button" aria-label="Share" className="sb-icon-btn" onClick={() => setShareItem(viewedVersion ?? viewed)}>
                      <FlowIcon name="share" size={18} />
                    </button>
                  </Tooltip>
                )}
                <Tooltip content="Download media" className="sb-tooltip">
                  <button
                    ref={downloadRef}
                    type="button"
                    aria-label="Download media"
                    aria-expanded={!!downloadMenu}
                    className="sb-icon-btn"
                    onClick={() => setDownloadMenu(downloadMenu ? null : { kind: 'below', rect: downloadRef.current!.getBoundingClientRect() })}
                  >
                    <FlowIcon name="download" size={18} />
                  </button>
                </Tooltip>
                {!phone && (
                  <Tooltip content="Move to trash" className="sb-tooltip">
                    <button type="button" aria-label="Move to trash" className="sb-icon-btn" onClick={() => { player.pause(); video.trash(viewed); }}>
                      <FlowIcon name="delete" size={18} />
                    </button>
                  </Tooltip>
                )}
              </>
            ) : (
              <>
                <Tooltip content={scene.favorite ? 'Remove favorite' : 'Favorite'} className="sb-tooltip">
                  <button
                    type="button"
                    aria-label={scene.favorite ? 'Remove favorite' : 'Favorite'}
                    className="sb-icon-btn"
                    onClick={() => updateScene(scene.id, { favorite: !scene.favorite })}
                  >
                    <FlowIcon name="favorite" size={18} fill={!!scene.favorite} />
                  </button>
                </Tooltip>
                <Tooltip content="Download scene" className="sb-tooltip">
                  <button type="button" aria-label="Download scene" className="sb-icon-btn" disabled={!clips.length} onClick={() => { if (!exporting) runExport(); }}>
                    {exporting
                      ? <FlowIcon name="progress_activity" size={18} className="sb-spin" />
                      : <FlowIcon name="download" size={18} />}
                  </button>
                </Tooltip>
                {!phone && (
                  <Tooltip content="Move to trash" className="sb-tooltip">
                    <button type="button" aria-label="Move to trash" className="sb-icon-btn" onClick={() => trashScene(scene.id)}>
                      <FlowIcon name="delete" size={18} />
                    </button>
                  </Tooltip>
                )}
              </>
            )}
            <button type="button" className="sb-btn" onClick={toggleHistory}>
              <FlowIcon name="history" size={18} className="sb-btn__icon" />
              <span>{historyShown ? 'Hide history' : 'Show history'}</span>
            </button>
            <Tooltip content="More options" className="sb-tooltip">
              <button
                ref={moreRef}
                type="button"
                aria-label="More options"
                className="sb-icon-btn"
                onClick={() => (moreMenu ? setMoreMenu(null) : setMoreMenu({ kind: 'below', rect: moreRef.current!.getBoundingClientRect() }))}
              >
                <FlowIcon name="more_vert" size={18} />
              </button>
            </Tooltip>
            {/* A phone's back arrow already leaves; Done would only crowd its header. */}
            {!phone && (
              <button type="button" aria-label="Done editing scene" className="sb-btn sb-btn--tonal" onClick={closeEditor}>
                <span>Done</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="sb-content">
        <div className="sb-area">
          {/* Flow's video view has no aspect toggle: the video keeps its own shape. */}
          {!video && <div className="sb-left-toolbar">
            <Tooltip content="Toggle aspect ratio" position="right" className="sb-tooltip">
              <button
                type="button"
                aria-label="Toggle aspect ratio"
                className="sb-btn sb-aspect-btn"
                onClick={() => updateScene(scene.id, { aspectRatio: scene.aspectRatio === '9:16' ? '16:9' : '9:16' })}
              >
                <span className="sb-aspect-btn__content">
                  <FlowIcon name={scene.aspectRatio === '9:16' ? 'crop_portrait' : 'crop_landscape'} size={18} />
                  <span>{scene.aspectRatio}</span>
                </span>
              </button>
            </Tooltip>
          </div>}

          <div ref={canvasColRef} className="sb-canvas-col">
            <div ref={hostRef} className="sb-canvas-host">
              <div className="sb-canvas-box" style={{ width: box.w, height: box.h, aspectRatio: scene.aspectRatio === '9:16' ? '9 / 16' : '16 / 9' }}>
                <canvas ref={attachCanvas} className="sb-canvas" role="img" aria-label="Scene video preview" />
                <CanvasOverlays
                  player={player}
                  clips={clips}
                  pendingEdits={pendingEdits}
                  itemById={itemById}
                  poster={scene.poster}
                  ready={playback.ready}
                  savingFrame={savingFrame}
                  onSaveFrame={() => void saveFrame()}
                />
              </div>
            </div>
            <div className="sb-playback">
              <div className="sb-playback__row">
                <Tooltip content={playback.muted ? 'Unmute' : 'Mute'} className="sb-tooltip">
                  <button type="button" aria-label={playback.muted ? 'Unmute' : 'Mute'} className="sb-icon-btn sb-icon-btn--30" onClick={() => player.setMuted(!playback.muted)}>
                    <FlowIcon name={playback.muted ? 'no_sound' : 'volume_up'} size={18} />
                  </button>
                </Tooltip>
                <span className="sb-timecode"><span className="sb-visually-hidden">Current time:</span><PlayheadTimecode time={player.$time} /></span>
                <Tooltip content="Skip to previous clip" className="sb-tooltip">
                  <button type="button" aria-label="Skip to previous clip" className="sb-icon-btn sb-icon-btn--30" onClick={() => player.skipPrevious()}>
                    <FlowIcon name="skip_previous" size={24} weight={300} fill />
                  </button>
                </Tooltip>
                <Tooltip content={playback.playing ? 'Pause' : 'Play'} className="sb-tooltip">
                  <button type="button" aria-label={playback.playing ? 'Pause' : 'Play'} className="sb-icon-btn sb-icon-btn--secondary sb-playback__play" onClick={() => player.toggle()}>
                    <FlowIcon name={playback.playing ? 'pause' : 'play_arrow'} size={24} weight={300} fill />
                  </button>
                </Tooltip>
                <Tooltip content="Skip to next clip" className="sb-tooltip">
                  <button type="button" aria-label="Skip to next clip" className="sb-icon-btn sb-icon-btn--30" onClick={() => player.skipNext()}>
                    <FlowIcon name="skip_next" size={24} weight={300} fill />
                  </button>
                </Tooltip>
                <span className="sb-timecode--duration"><span className="sb-visually-hidden">Total duration:</span>{formatTimecode(sceneDuration)}</span>
                <Tooltip content="Full screen" className="sb-tooltip">
                  <button
                    type="button"
                    aria-label="Full screen"
                    className="sb-icon-btn sb-icon-btn--30"
                    onClick={() => {
                      const area = canvasColRef.current?.parentElement;
                      if (document.fullscreenElement) void document.exitFullscreen();
                      else void area?.requestFullscreen?.();
                    }}
                  >
                    <FlowIcon name="fullscreen" size={18} />
                  </button>
                </Tooltip>
                <Tooltip content={playback.loop ? 'Disable loop' : 'Loop video'} className="sb-tooltip">
                  <button
                    type="button"
                    aria-label={playback.loop ? 'Disable loop' : 'Loop video'}
                    className={`sb-icon-btn sb-icon-btn--30${playback.loop ? ' sb-icon-btn--selected' : ''}`}
                    onClick={() => player.setLoop(!playback.loop)}
                  >
                    <FlowIcon name="repeat" size={18} />
                  </button>
                </Tooltip>
              </div>
            </div>
            {narrow && <SceneHistory layout="strip" {...historyProps} />}
          </div>

          {!narrow && (
            <div
              ref={sidebarRef}
              className="sb-sidebar"
              style={historyLeaving ? { position: 'absolute', top: 0, right: 0, bottom: 0 } : undefined}
              hidden={!historyShown && !historyLeaving}
            >
              <SceneHistory {...historyProps} />
            </div>
          )}
        </div>

        <SceneTimeline
          clips={clips}
          urlOf={(clip) => playable[clips.indexOf(clip)]}
          pendingClipIds={pendingClipIds}
          missingClipIds={missingClipIds}
          selectedId={selectedId}
          onSelect={setSelectedId}
          zoom={zoom}
          onZoom={(z) => setZoom(Math.min(Math.max(0, z), ZOOM_LEVELS.length - 1))}
          time={player.$time}
          onSeek={(t) => player.seek(t)}
          onTrim={(clipId, trimStart, trimEnd) => commitClips(clips.map((c) => (c.id === clipId ? { ...c, trimStart, trimEnd } : c)))}
          onReorder={moveClip}
          onAddClip={() => setPicker('clip')}
          onClipMenu={(clipId, x, y) => setClipMenu({ clipId, anchor: { kind: 'point', x, y } })}
        />

        <div className="sb-prompt-container">
          <div className="sb-prompt-wrapper">
            <div className="sb-prompt-box">
              {refs.length > 0 && (
                <div className="sb-prompt-ingredients">
                  {refs.map((r) => (
                    <div key={r.id} className="sb-ingredient">
                      <img src={r.url} alt="" />
                      <button type="button" aria-label="Remove" className="sb-ingredient__remove" onClick={() => setRefs(refs.filter((x) => x.id !== r.id))}>
                        <FlowIcon name="close" size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="sb-prompt-top">
                <div className="sb-prompt-input" onClick={() => textareaRef.current?.focus()}>
                  {!prompt && <span className="sb-prompt-input__placeholder">{clips.length ? 'Describe how to edit this video…' : 'Select a clip to edit'}</span>}
                  <textarea
                    ref={textareaRef}
                    className="sb-prompt-input__textarea"
                    rows={1}
                    readOnly={!clips.length}
                    value={prompt}
                    aria-label="Describe how to edit this video"
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submitEdit(); }
                      if (e.key === 'Escape') textareaRef.current?.blur();
                    }}
                  />
                </div>
                {/* Flow keeps the actions slot when empty, so the row's 4px gap is always there. */}
                <div className="sb-prompt-actions">
                  {prompt && (
                    <Tooltip content="Clear prompt" className="sb-tooltip">
                      <button type="button" aria-label="Clear prompt" className="sb-icon-btn sb-prompt-clear" onClick={() => setPrompt('')}>
                        <FlowIcon name="close" size={16} />
                      </button>
                    </Tooltip>
                  )}
                </div>
              </div>
              <div className="sb-prompt-bottom">
                <Tooltip content="Add ingredients to the prompt box" className="sb-tooltip">
                  <button
                    type="button"
                    aria-label="Add ingredients to the prompt box"
                    className={`sb-icon-btn sb-prompt-add${picker === 'prompt' ? ' is-active' : ''}`}
                    onClick={() => setPicker(picker === 'prompt' ? null : 'prompt')}
                  >
                    <FlowIcon name="add" size={20} weight={200} />
                  </button>
                </Tooltip>
                <div className="sb-prompt-submit">
                  <div className="sb-model-chip">
                    <FlowIcon name="pen_magic" size={16} />
                    <span>Omni 1.1 Flash</span>
                  </div>
                  <Tooltip content="Start generation" className="sb-tooltip">
                    <button
                      type="submit"
                      aria-label="Start generation"
                      className="sb-icon-btn sb-generate"
                      disabled={!prompt.trim() || !selectedItem?.url || !!pendingItemId}
                      onClick={() => void submitEdit()}
                    >
                      <FlowIcon name="arrow_forward" size={18} />
                    </button>
                  </Tooltip>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <p className="sb-footer-disclaimer">Willow can make mistakes, so double check it</p>

      <FlowMatMenu open={!!moreMenu} onClose={() => setMoreMenu(null)} anchor={moreMenu} ignoreRefs={[moreRef]}>
        {/* What a phone's header has no room for. */}
        {phone && (
          <>
            {video && viewed && <FlowMatMenuItem icon="share" label="Share" onSelect={() => setShareItem(viewedVersion ?? viewed)} />}
            <FlowMatMenuItem
              icon="delete"
              label="Move to trash"
              onSelect={() => {
                if (video && viewed) { player.pause(); video.trash(viewed); } else trashScene(scene.id);
              }}
            />
            <FlowMatDivider />
          </>
        )}
        {MORE_ITEMS.map((m) => <FlowMatMenuItem key={m.label} icon={m.icon} label={m.label} onSelect={m.onSelect} />)}
      </FlowMatMenu>

      {video && (
        <>
          <DownloadMenu item={viewedVersion ?? null} anchor={downloadMenu} onClose={() => setDownloadMenu(null)} ignoreRefs={[downloadRef]} />
          <ShareDialog item={shareItem} parent={shareItem?.historyParentId ? itemById(shareItem.historyParentId) : undefined} onClose={() => setShareItem(null)} />
        </>
      )}
      <FlagDialog open={flagOpen} onClose={() => setFlagOpen(false)} />

      <FlowMatMenu open={!!clipMenu} onClose={() => setClipMenu(null)} anchor={clipMenu?.anchor ?? null}>
        {/* A finger can't drag a clip (that scrolls the timeline), so a touch screen moves it here. */}
        {touch && clips.length > 1 && (
          <>
            <FlowMatMenuItem icon="arrow_back" label="Move earlier" disabled={clipForMenuIndex <= 0} onSelect={() => { if (clipForMenu) moveClip(clipForMenu.id, clipForMenuIndex - 1); }} />
            <FlowMatMenuItem icon="arrow_forward" label="Move later" disabled={clipForMenuIndex >= clips.length - 1} onSelect={() => { if (clipForMenu) moveClip(clipForMenu.id, clipForMenuIndex + 1); }} />
            <FlowMatDivider />
          </>
        )}
        <FlowMatMenuItem icon="content_copy" label="Copy" onSelect={() => { if (clipForMenu) copyClips([clipForMenu]); }} />
        <FlowMatMenuItem icon="content_paste" label="Paste" disabled={!clipboard?.length} onSelect={() => insertAfterSelected(pasteClips())} />
        <FlowMatMenuItem
          icon="save"
          label="Save to Project"
          onSelect={() => { const m = clipForMenu ? itemById(clipForMenu.mediaId) : undefined; if (m) addToProject(m); }}
        />
        <FlowMatMenuItem
          icon="download"
          label="Download"
          onSelect={() => {
            if (!clipForMenu) return;
            void exportScene({ ...scene, id: `${scene.id}:${clipForMenu.id}`, clips: [clipForMenu] }, (id) => itemById(id)?.url).catch(() => undefined);
          }}
        />
        <FlowMatMenuItem
          icon="delete"
          label="Delete"
          danger
          onSelect={() => {
            if (!clipForMenu) return;
            commitClips(clips.filter((c) => c.id !== clipForMenu.id));
          }}
        />
      </FlowMatMenu>

      <SceneMediaPicker
        open={picker !== null}
        mode={picker ?? 'clip'}
        items={host.mediaItems}
        projectName={host.projectName}
        projectId={host.projectId}
        projects={pickerProjects}
        loadProjectMedia={loadProjectMedia}
        adopt={adoptMedia}
        onClose={() => setPicker(null)}
        onImport={(files) => host.importFiles(files)}
        onConfirm={(item, trim) => {
          if (picker === 'prompt') {
            setPicker(null);
            if (item.url && !refs.some((r) => r.id === item.id)) setRefs([...refs, item]);
            return;
          }
          void onPickClip(item, trim);
        }}
      />
    </div>
  );
};

/** The canvas while the clip under the playhead is being edited: the generating liquid and %. */
const CanvasPending: React.FC<{ item: MediaItem }> = ({ item }) => {
  const progress = useGenerationProgress(item);
  return (
    <div className="sb-canvas-pending">
      <GeneratingLayers isRevealing={false} />
      <span className="sb-canvas-pct">{progress}%</span>
    </div>
  );
};

export default SceneBuilder;
