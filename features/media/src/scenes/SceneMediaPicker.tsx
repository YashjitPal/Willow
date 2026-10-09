// Flow's media picker dialog (`flow-media-picker-dialog` / `flow-add-menu-popover-content`): what
// the timeline's Add clip and the edit prompt's + open. A video gets Flow's trimmer — preview,
// play/mute, and a filmstrip with grip handles — and is added with the chosen in/out points.
import React from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@nanostores/react';
import type { MediaItem } from '../types';
import { characterName, type Character } from '../characters/character-store';
import { VOICE_SAMPLE_URL, voiceByName, type CharacterVoice } from '../characters/voices';
import { FlowIcon, usePresence } from './flow-ui';
import { $scenes, type Scene } from './scene-store';
import { formatTimecode, MIN_CLIP_SECONDS } from './scene-format';
import { captureFrame, probeVideo } from './scene-frames';
import { useFrames } from './scene-host';
import { usePlayableUrl } from './scene-media-url';
import { useTouchScreen } from '../use-media-viewport';
import './scene-picker.css';

/**
 * `image` is the Characters' picker: images only, under Images and Uploads, confirmed with Add
 * media. `composer` is the All media prompt box's add menu: media and characters. Given an
 * `anchor` the content is Flow's add menu as that box opens it on "@": a popover 8px above the box
 * and centred on it, over Flow's dark backdrop, where one click adds an asset. Either way the
 * arrows move through the list and Enter adds the highlighted one. `tool` is what a Tool's
 * `Flow.media.select` opens for any kind of media; with `multiple`, Shift/Ctrl/Cmd-click adds to
 * a selection (Flow's selection bar shows from two) and the button reads Confirm.
 */
export type PickerMode = 'clip' | 'prompt' | 'image' | 'composer' | 'tool';
type Category = 'all' | 'images' | 'videos' | 'characters' | 'uploads';

/** The project select's value for a scene whose project has no saved id yet. */
const CURRENT_PROJECT = '__current__';

const CATEGORIES: Record<PickerMode, { id: Category; label: string; icon: string }[]> = {
  clip: [
    { id: 'videos', label: 'Videos', icon: 'videocam' },
    { id: 'uploads', label: 'Uploads', icon: 'drive_folder_upload' },
  ],
  prompt: [
    { id: 'all', label: 'All', icon: 'dashboard' },
    { id: 'images', label: 'Images', icon: 'image' },
    { id: 'videos', label: 'Videos', icon: 'videocam' },
    { id: 'uploads', label: 'Uploads', icon: 'drive_folder_upload' },
  ],
  image: [
    { id: 'images', label: 'Images', icon: 'image' },
    { id: 'uploads', label: 'Uploads', icon: 'drive_folder_upload' },
  ],
  // Flow also lists Voices and Avatars here; Willow has neither as assets.
  composer: [
    { id: 'all', label: 'All', icon: 'dashboard' },
    { id: 'images', label: 'Images', icon: 'image' },
    { id: 'videos', label: 'Videos', icon: 'videocam' },
    { id: 'characters', label: 'Characters', icon: 'accessibility_new' },
    { id: 'uploads', label: 'Uploads', icon: 'drive_folder_upload' },
  ],
  tool: [
    { id: 'all', label: 'All', icon: 'dashboard' },
    { id: 'images', label: 'Images', icon: 'image' },
    { id: 'videos', label: 'Videos', icon: 'videocam' },
    { id: 'uploads', label: 'Uploads', icon: 'drive_folder_upload' },
  ],
};

const firstCategory = (mode: PickerMode): Category => CATEGORIES[mode][0].id;

/** The add menu keeps the category it was left on, as Flow's does. */
let composerCategory: Category = 'all';

type Entry =
  | { key: string; kind: 'media'; item: MediaItem; at: number }
  | { key: string; kind: 'character'; character: Character; portrait?: MediaItem; body?: MediaItem; at: number };

const SELECT_ARROW = <svg className="sb-select__arrow" viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M7 10l5 5 5-5z" /></svg>;

/**
 * Flow's `mat-select`: a trigger, and a panel of options on a transparent backdrop. Escape and
 * a press outside close it without closing the dialog under it.
 */
function PickerSelect<T extends string>({ value, options, onChange, ariaLabel, className }: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const [open, setOpen] = React.useState(false);
  const { mounted, closing } = usePresence(open, 100);
  const [pos, setPos] = React.useState<{ left: number; top: number } | null>(null);
  React.useLayoutEffect(() => {
    const r = open ? triggerRef.current?.getBoundingClientRect() : undefined;
    if (r) setPos({ left: r.left + 12, top: r.bottom + 2 });
  }, [open]);
  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);
  const current = options.find((o) => o.value === value);
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`sb-select${className ? ` ${className}` : ''}${open ? ' is-open' : ''}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="sb-select__value">{current?.label}</span>
        {SELECT_ARROW}
      </button>
      {mounted && createPortal(
        <>
          {open && (
            <div
              className="sb-menu-backdrop"
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onClick={(e) => { e.stopPropagation(); setOpen(false); }}
            />
          )}
          <div
            role="listbox"
            aria-label={ariaLabel}
            className={`sb-select-panel${closing ? ' is-closing' : ''}`}
            style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {options.map((o) => (
              <div
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                className={`sb-select-option${o.value === value ? ' is-selected' : ''}`}
                onClick={() => { onChange(o.value); setOpen(false); }}
              >
                {o.label}
              </div>
            ))}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

type SortOrder = 'recent' | 'most-used' | 'newest' | 'oldest';

const SORT_OPTIONS: { value: SortOrder; label: string }[] = [
  { value: 'recent', label: 'Recent' },
  { value: 'most-used', label: 'Most used' },
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
];

/**
 * Willow keeps no record of views, so "used" means used in a scene: Most used counts the clips
 * that cut from an item, and Recent orders by the last time a scene holding it changed, falling
 * back to when the item was made.
 */
function sortAssets(items: MediaItem[], order: SortOrder, scenes: Scene[]): MediaItem[] {
  const uses = new Map<string, number>();
  const lastUsed = new Map<string, number>();
  for (const scene of scenes) {
    if (scene.trashedAt) continue;
    for (const clip of scene.clips) {
      uses.set(clip.mediaId, (uses.get(clip.mediaId) ?? 0) + 1);
      lastUsed.set(clip.mediaId, Math.max(lastUsed.get(clip.mediaId) ?? 0, scene.updatedAt));
    }
  }
  const by = (key: (m: MediaItem) => number) => [...items].sort((a, b) => key(b) - key(a) || b.timestamp - a.timestamp);
  switch (order) {
    case 'recent': return by((m) => Math.max(m.timestamp, lastUsed.get(m.id) ?? 0));
    case 'most-used': return by((m) => uses.get(m.id) ?? 0);
    case 'newest': return by((m) => m.timestamp);
    case 'oldest': return [...items].sort((a, b) => a.timestamp - b.timestamp);
  }
}

/** Flow's `flower_placeholder` svgIcon, the empty asset list's illustration. */
const FLOWER_PLACEHOLDER = (
  <span className="sb-picker__empty-art" role="img" aria-hidden="true">
    <svg viewBox="0 0 28 45" fill="currentColor" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" focusable="false">
      <path d="M16 28H15V34H17V36H15V38H20V40H15V45H13V42H8V40H13V38H11V36H13V28H12V26H16V28ZM8 40H6V38H8V40ZM6 38H4V36H6V38ZM22 38H20V36H22V38ZM4 36H2V34H4V36ZM11 36H9V34H11V36ZM24 36H22V34H24V36ZM9 34H4V32H9V34ZM19 34H17V32H19V34ZM26 34H24V32H26V34ZM24 32H19V30H24V32ZM8 26H4V24H8V26ZM12 26H10V24H12V26ZM18 26H16V24H18V26ZM24 26H20V24H24V26ZM4 24H2V20H4V24ZM10 24H8V22H10V24ZM20 24H18V22H20V24ZM26 24H24V20H26V24ZM12 22H10V20H12V22ZM18 22H16V20H18V22ZM6 20H4V18H6V20ZM16 20H12V18H16V20ZM24 20H22V18H24V20ZM4 18H2V16H4V18ZM8 18H6V16H8V18ZM22 18H20V16H22V18ZM26 18H24V16H26V18ZM2 16H0V12H2V16ZM10 16H8V12H10V16ZM16 16H12V12H16V16ZM20 16H18V12H20V16ZM28 16H26V12H28V16ZM4 12H2V10H4V12ZM8 12H6V10H8V12ZM22 12H20V10H22V12ZM26 12H24V10H26V12ZM6 10H4V8H6V10ZM16 10H12V8H16V10ZM24 10H22V8H24V10ZM4 8H2V4H4V8ZM12 8H10V6H12V8ZM18 8H16V6H18V8ZM26 8H24V4H26V8ZM10 6H8V4H10V6ZM20 6H18V4H20V6ZM8 4H4V2H8V4ZM12 4H10V2H12V4ZM18 4H16V2H18V4ZM24 4H20V2H24V4ZM16 2H12V0H16V2Z" />
    </svg>
  </span>
);

const AssetThumb: React.FC<{ item: MediaItem }> = ({ item }) => {
  const [frame, setFrame] = React.useState<string | undefined>(item.kind === 'image' ? item.url : undefined);
  React.useEffect(() => {
    if (item.kind !== 'video' || !item.url) return undefined;
    let cancelled = false;
    void captureFrame(item.url, 0, 96).then((f) => { if (!cancelled) setFrame(f); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [item.kind, item.url]);
  return <div className="sb-asset__thumb">{frame && <img src={frame} alt="" draggable={false} />}</div>;
};

const SLOTS = 8;

/** Flow's `flow-video-trimmer`: preview, controls, and the trim filmstrip. */
const VideoTrimmer: React.FC<{
  item: MediaItem;
  trim: { start: number; end: number } | null;
  onTrim: (t: { start: number; end: number }) => void;
  onDuration: (d: number) => void;
}> = ({ item, trim, onTrim, onDuration }) => {
  const url = usePlayableUrl(item.url);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const tlRef = React.useRef<HTMLDivElement>(null);
  const [duration, setDuration] = React.useState(0);
  const [time, setTime] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [muted, setMuted] = React.useState(true);
  const [flag, setFlag] = React.useState<{ at: number; side: 'start' | 'end' } | null>(null);

  React.useEffect(() => {
    if (!item.url) return;
    let cancelled = false;
    void probeVideo(item.url).then(({ duration: d }) => {
      if (cancelled) return;
      setDuration(d);
      onDuration(d);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [item.url]); // eslint-disable-line react-hooks/exhaustive-deps

  const times = React.useMemo(() => (duration ? Array.from({ length: SLOTS }, (_, i) => (i * duration) / SLOTS) : []), [duration]);
  const frames = useFrames(item.url, times, 120);
  const t = trim ?? { start: 0, end: duration };

  React.useEffect(() => {
    const v = videoRef.current;
    if (!v || !playing) return undefined;
    let raf = 0;
    const tick = () => {
      if (v.currentTime >= t.end - 0.02) { v.pause(); v.currentTime = t.start; setPlaying(false); }
      setTime(v.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, t.start, t.end]);

  const pct = (s: number) => (duration ? (s / duration) * 100 : 0);
  const fromClientX = (x: number) => {
    const r = tlRef.current?.getBoundingClientRect();
    if (!r || !duration) return 0;
    return Math.min(Math.max(0, ((x - r.left) / r.width) * duration), duration);
  };

  const drag = (side: 'start' | 'end' | 'playhead') => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const v = videoRef.current;
    v?.pause();
    setPlaying(false);
    const cur = { start: t.start, end: t.end };
    const move = (ev: PointerEvent) => {
      const at = fromClientX(ev.clientX);
      if (side === 'playhead') {
        const clamped = Math.min(Math.max(at, cur.start), cur.end);
        if (v) v.currentTime = clamped;
        setTime(clamped);
        return;
      }
      const next = side === 'start'
        ? { start: Math.min(at, cur.end - MIN_CLIP_SECONDS), end: cur.end }
        : { start: cur.start, end: Math.max(at, cur.start + MIN_CLIP_SECONDS) };
      cur.start = next.start;
      cur.end = next.end;
      onTrim({ ...next });
      setFlag({ at: side === 'start' ? next.start : next.end, side });
      if (v) v.currentTime = side === 'start' ? next.start : next.end;
    };
    const up = () => {
      setFlag(null);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    move(e.nativeEvent);
  };

  return (
    <div className="sb-trimmer">
      <div className="sb-trimmer__inner">
        <div className="sb-trimmer__preview">
          <video
            ref={videoRef}
            className="sb-trimmer__video"
            src={url}
            muted={muted}
            playsInline
            preload="auto"
            aria-label="Video preview"
            onLoadedData={(e) => { e.currentTarget.currentTime = t.start; }}
          />
        </div>
        <div className="sb-trimmer__controls">
          <div className="sb-trimmer__spacer" />
          <div className="sb-trimmer__center">
            <span className="sb-trimmer__time">{formatTimecode(Math.max(0, time - t.start))}</span>
            <button
              type="button"
              className="sb-icon-btn sb-trimmer__play"
              aria-label={playing ? 'Pause' : 'Play'}
              disabled={!url}
              onClick={() => {
                const v = videoRef.current;
                if (!v) return;
                if (playing) { v.pause(); setPlaying(false); return; }
                if (v.currentTime < t.start || v.currentTime >= t.end - 0.05) v.currentTime = t.start;
                void v.play().then(() => setPlaying(true)).catch(() => undefined);
              }}
            >
              <FlowIcon name={playing ? 'pause' : 'play_arrow'} size={18} />
            </button>
            <span className="sb-trimmer__dur">{formatTimecode(t.end - t.start)}</span>
          </div>
          <button type="button" className="sb-icon-btn" aria-label={muted ? 'Unmute' : 'Mute'} onClick={() => setMuted(!muted)}>
            <FlowIcon name={muted ? 'no_sound' : 'volume_up'} size={18} />
          </button>
        </div>
        <div ref={tlRef} className="sb-trim-tl">
          {!duration ? <div className="sb-trim-tl__skeleton" /> : (
            <>
              <div className="sb-trim-tl__bg">
                {Array.from({ length: Math.max(1, Math.ceil(duration)) + 1 }, (_, i) => <div key={i} className="sb-trim-tl__seg" />)}
              </div>
              <div className="sb-trim-tl__strip" onPointerDown={drag('playhead')}>
                {frames.map((f, i) => <div key={i} className="sb-trim-tl__slot">{f && <img src={f} alt="" draggable={false} />}</div>)}
              </div>
              {t.start > 0.01 && <div className="sb-trim-tl__dim sb-trim-tl__dim--start" style={{ left: 0, width: `${pct(t.start)}%` }} />}
              {t.end < duration - 0.01 && <div className="sb-trim-tl__dim sb-trim-tl__dim--end" style={{ left: `${pct(t.end)}%`, width: `${100 - pct(t.end)}%` }} />}
              <div className="sb-trim-tl__box" style={{ left: `${pct(t.start)}%`, width: `${pct(t.end - t.start)}%` }}>
                <div className="sb-trim-tl__handle sb-trim-tl__handle--start" onPointerDown={drag('start')}><div className="sb-trim-tl__grip" /></div>
                <div className="sb-trim-tl__handle sb-trim-tl__handle--end" onPointerDown={drag('end')}><div className="sb-trim-tl__grip" /></div>
              </div>
              <div className="sb-trim-tl__playhead" style={{ left: `${pct(flag ? flag.at : time)}%` }} onPointerDown={drag('playhead')}>
                {flag && <div className="sb-trim-tl__flag">{formatTimecode(flag.at)}</div>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

/** The voice card under a character's preview: Flow's, its sample played from the button. */
const PreviewVoice: React.FC<{ voice: CharacterVoice }> = ({ voice }) => {
  const audioRef = React.useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = React.useState(false);
  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) audio.pause();
    else void audio.play().catch(() => setPlaying(false));
  };
  return (
    <div className="sb-character-voice">
      <div className="sb-character-voice__left">
        <div className="sb-character-voice__chip" style={{ background: `linear-gradient(${voice.from} 0%, ${voice.to} 100%)` }}>
          <FlowIcon name="voice_selection" size={20} />
        </div>
        <div className="sb-character-voice__info">
          <span className="sb-character-voice__name">{voice.name}</span>
          <span className="sb-character-voice__description">{voice.description}</span>
        </div>
      </div>
      <button type="button" className="sb-character-voice__play" aria-label={playing ? 'Pause preview' : 'Play preview'} title={playing ? 'Pause preview' : 'Play preview'} onClick={toggle}>
        <FlowIcon name={playing ? 'pause' : 'play_arrow'} size={20} />
      </button>
      <audio
        ref={audioRef}
        src={VOICE_SAMPLE_URL(voice.name)}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => setPlaying(false)}
      />
    </div>
  );
};

/**
 * Flow's `flow-character-preview-pane`: the chosen image, its slot thumbnails when there are two,
 * and the voice card when the character has one. The hero is 16:9, the shape characters are made
 * in, and the image fills it whatever its own shape.
 */
const CharacterPreview: React.FC<{ entry: Extract<Entry, { kind: 'character' }> }> = ({ entry }) => {
  const slots = [entry.portrait, entry.body].filter((m): m is MediaItem => !!m?.url);
  const [slotId, setSlotId] = React.useState(slots[0]?.id);
  const shown = slots.find((m) => m.id === slotId) ?? slots[0];
  const voice = voiceByName(entry.character.voice?.name);
  return (
    <div className="sb-character-preview">
      <div className="sb-character-preview__hero">
        {shown ? <img className="sb-character-preview__image" src={shown.url} alt="" draggable={false} /> : (
          <div className="sb-character-preview__placeholder"><FlowIcon name="person" size={48} weight={300} /></div>
        )}
      </div>
      {slots.length > 1 && (
        <div className="sb-character-preview__thumbs">
          {slots.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-label={m.id === entry.body?.id ? 'Body' : 'Portrait'}
              className={`sb-character-preview__thumb${m.id === shown?.id ? ' is-active' : ''}`}
              onClick={() => setSlotId(m.id)}
            >
              <img src={m.url} alt="" draggable={false} />
            </button>
          ))}
        </div>
      )}
      {voice && <PreviewVoice voice={voice} />}
    </div>
  );
};

export const SceneMediaPicker: React.FC<{
  open: boolean;
  mode: PickerMode;
  items: MediaItem[];
  projectName: string;
  /** The project this scene is saved in; the picker browses the user's other Media projects too. */
  projectId?: string;
  projects: { id: string; name: string }[];
  loadProjectMedia: (projectId: string) => Promise<MediaItem[]>;
  /** Copies an item from another project into this one, returning the copy. */
  adopt: (item: MediaItem) => MediaItem;
  onClose: () => void;
  onImport: (files: File[]) => Promise<MediaItem[]>;
  onConfirm: (item: MediaItem, trim: { start: number; end: number } | null) => void;
  /** `composer` lists these too, under All and Characters. */
  characters?: Character[];
  itemById?: (id: string) => MediaItem | undefined;
  onPickCharacter?: (character: Character) => void;
  /** The prompt box the add menu opens over: it becomes Flow's popover. */
  anchor?: DOMRect | null;
  /** A Tool's multiple select: modifier-clicks gather a selection, confirmed together. */
  multiple?: boolean;
  /** The most a multiple select takes. */
  maxCount?: number;
  onConfirmMany?: (items: MediaItem[]) => void;
}> = ({ open, mode, items, projectName, projectId, projects, loadProjectMedia, adopt, onClose, onImport, onConfirm, characters, itemById, onPickCharacter, anchor, multiple = false, maxCount, onConfirmMany }) => {
  const popover = !!anchor;
  // On a touch screen a focused search would raise the keyboard over the list before anything is typed.
  const touch = useTouchScreen();
  const { mounted, closing } = usePresence(open, 400);
  const [category, setCategory] = React.useState<Category>(firstCategory(mode));
  const [query, setQuery] = React.useState('');
  const [sort, setSort] = React.useState<SortOrder>('recent');
  const [activeKey, setActiveKey] = React.useState<string | null>(null);
  const [trim, setTrim] = React.useState<{ start: number; end: number } | null>(null);
  const [duration, setDuration] = React.useState(0);
  /** A multiple select's picks, in the order made; `foreign` ones are adopted on Confirm. */
  const [selected, setSelected] = React.useState<{ key: string; item: MediaItem; foreign: boolean }[]>([]);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const scenes = useStore($scenes);

  const here = projectId ?? CURRENT_PROJECT;
  const [source, setSource] = React.useState(here);
  const [foreign, setForeign] = React.useState<{ id: string; items: MediaItem[] } | null>(null);
  const projectOptions = React.useMemo(() => {
    const listed = projects.map((p) => ({ value: p.id, label: p.name }));
    return listed.some((p) => p.value === here) ? listed : [{ value: here, label: projectName }, ...listed];
  }, [projects, here, projectName]);

  // Flow builds the dialog anew on every open, so nothing chosen last time carries over; the add
  // menu keeps only its category.
  React.useEffect(() => {
    if (!open) return;
    setCategory(mode === 'composer' ? composerCategory : firstCategory(mode));
    setQuery('');
    setSort('recent');
    setSource(here);
    setSelected([]);
  }, [open, mode, here]);
  const chooseCategory = (next: Category) => {
    setCategory(next);
    if (mode === 'composer') composerCategory = next;
  };

  React.useEffect(() => {
    if (source === here || foreign?.id === source) return undefined;
    let cancelled = false;
    void loadProjectMedia(source).then((loaded) => { if (!cancelled) setForeign({ id: source, items: loaded }); }).catch(() => {
      if (!cancelled) setForeign({ id: source, items: [] });
    });
    return () => { cancelled = true; };
  }, [source, here, foreign, loadProjectMedia]);

  const browsingElsewhere = source !== here;
  const loadingSource = browsingElsewhere && foreign?.id !== source;
  const sourceItems = browsingElsewhere ? (foreign?.id === source ? foreign.items : []) : items;

  const list = React.useMemo((): Entry[] => {
    const q = query.trim().toLowerCase();
    const media: Entry[] = category === 'characters' ? [] : sortAssets(sourceItems
      .filter((m) => m.status === 'completed' && !!m.url && !m.historyParentId && m.kind !== 'audio')
      .filter((m) => (mode === 'clip' ? m.kind === 'video' : mode === 'image' ? m.kind === 'image' : true))
      .filter((m) => {
        if (category === 'images') return m.kind === 'image';
        if (category === 'videos') return m.kind === 'video' && m.modelId !== 'upload';
        if (category === 'uploads') return m.modelId === 'upload';
        return true;
      })
      .filter((m) => !q || (m.shortenedPrompt || m.prompt || '').toLowerCase().includes(q)), sort, scenes)
      .map((item) => ({ key: `m:${item.id}`, kind: 'media', item, at: item.timestamp }));
    if (mode !== 'composer' || browsingElsewhere || (category !== 'all' && category !== 'characters')) return media;
    const people: Entry[] = (characters ?? [])
      .filter((c) => !q || characterName(c).toLowerCase().includes(q))
      .map((c) => ({
        key: `c:${c.id}`,
        kind: 'character',
        character: c,
        portrait: c.portraitId ? itemById?.(c.portraitId) : undefined,
        body: c.bodyId ? itemById?.(c.bodyId) : undefined,
        at: c.createdAt,
      }));
    const oldest = sort === 'oldest';
    people.sort((a, b) => (oldest ? a.at - b.at : b.at - a.at));
    if (category === 'characters') return people;
    // All: the characters merged into the media by when they were made.
    const merged: Entry[] = [];
    let i = 0;
    for (const entry of media) {
      while (i < people.length && (oldest ? people[i].at <= entry.at : people[i].at >= entry.at)) merged.push(people[i++]);
      merged.push(entry);
    }
    return [...merged, ...people.slice(i)];
  }, [sourceItems, mode, category, query, sort, scenes, characters, itemById, browsingElsewhere]);

  React.useEffect(() => {
    if (!open) return;
    if (!list.some((e) => e.key === activeKey)) setActiveKey(list[0]?.key ?? null);
  }, [open, list, activeKey]);

  const active = list.find((e) => e.key === activeKey);
  React.useEffect(() => { setTrim(null); setDuration(0); }, [activeKey]);

  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      // An open select closes first: its own listener, added after this one, takes the key.
      if (e.key !== 'Escape' || document.querySelector('.sb-picker .sb-select.is-open')) return;
      e.stopPropagation();
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!mounted) return null;
  const take = (entry: Entry, t: { start: number; end: number } | null) => {
    if (entry.kind === 'character') { onPickCharacter?.(entry.character); return; }
    onConfirm(browsingElsewhere ? adopt(entry.item) : entry.item, t);
  };
  const confirm = () => {
    if (multiple && selected.length > 1) {
      onConfirmMany?.(selected.map((s) => (s.foreign ? adopt(s.item) : s.item)));
      return;
    }
    if (!active) return;
    const t = active.kind === 'media' && active.item.kind === 'video' && trim && duration && (trim.start > 0.01 || trim.end < duration - 0.01) ? trim : null;
    take(active, t);
  };
  // Flow's multiple select: the first modifier-click also takes the highlighted asset; a picked
  // one is dropped again; no more than `maxCount`.
  const toggleSelected = (entry: Entry) => {
    if (entry.kind !== 'media') return;
    setSelected((prev) => {
      let next = prev;
      if (next.length === 0 && active?.kind === 'media' && active.key !== entry.key) {
        next = [{ key: active.key, item: active.item, foreign: browsingElsewhere }];
      }
      if (next.some((s) => s.key === entry.key)) return next.filter((s) => s.key !== entry.key);
      if (maxCount && next.length >= maxCount) return next;
      return [...next, { key: entry.key, item: entry.item, foreign: browsingElsewhere }];
    });
    setActiveKey(entry.key);
  };
  // Flow's keys: Up and Down move the highlight (it stops at the ends), Enter adds it.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (document.querySelector('.sb-picker .sb-select.is-open')) return;
    if (e.key === 'Enter') { e.preventDefault(); confirm(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const at = list.findIndex((x) => x.key === activeKey);
    const next = list[Math.max(0, Math.min(list.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (!next) return;
    setActiveKey(next.key);
    listRef.current?.querySelector(`[data-entry="${CSS.escape(next.key)}"]`)?.scrollIntoView({ block: 'nearest' });
  };
  const showType = mode === 'prompt' || ((mode === 'composer' || mode === 'tool') && category === 'all');
  const actionLabel = multiple ? 'Confirm' : mode === 'prompt' || mode === 'composer' ? 'Add to prompt' : 'Add media';

  const panel = (
    <div
      className={`sb-picker${popover ? ' sb-picker--popover' : ''}${closing ? ' is-closing' : ''}`}
      role="dialog"
      aria-label="Select media"
      style={popover ? { left: anchor.left + anchor.width / 2, bottom: window.innerHeight - anchor.top + 8 } : undefined}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
    >
      <div className="sb-picker__panels">
        <div className="sb-picker__nav">
          <PickerSelect value={source} options={projectOptions} onChange={setSource} ariaLabel="Project" />
          <div className="sb-picker__tabs" role="tablist" aria-label="Category navigation">
            {CATEGORIES[mode].map((c) => (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={category === c.id}
                className={`sb-picker__tab${category === c.id ? ' is-active' : ''}`}
                onClick={() => chooseCategory(c.id)}
              >
                <FlowIcon name={c.icon} size={18} className="sb-picker__tab-icon" />
                <span className="sb-picker__tab-label">{c.label}</span>
              </button>
            ))}
          </div>
          <div>
            <button type="button" className="sb-btn sb-picker__upload" onClick={() => fileRef.current?.click()}>
              <span className="sb-picker__upload-inner">
                <FlowIcon name="upload" size={18} />
                <span>Upload media</span>
              </span>
            </button>
            <input
              ref={fileRef}
              type="file"
              hidden
              multiple
              accept={mode === 'clip' ? 'video/*' : mode === 'image' ? 'image/*' : 'image/*,video/*'}
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                e.target.value = '';
                if (!files.length) return;
                void onImport(files).then((added) => {
                  if (!added.length) return;
                  setSource(here);
                  chooseCategory('uploads');
                  setActiveKey(`m:${added[0].id}`);
                });
              }}
            />
          </div>
        </div>
        <div className="sb-picker__right">
          <header className="sb-picker__search-row">
            <div className="sb-picker__search">
              <FlowIcon name="search" size={17.6} className="sb-picker__search-icon" />
              <input
                className="sb-picker__search-input"
                type="text"
                placeholder="Search assets"
                aria-label="Search assets"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
            </div>
            <PickerSelect<SortOrder> value={sort} options={SORT_OPTIONS} onChange={setSort} ariaLabel="Sort assets" className="sb-picker__sort" />
          </header>
          <div className="sb-picker__content">
            <div ref={listRef} className="sb-picker__list" role="listbox" aria-label="Asset list">
              {loadingSource ? null : list.length === 0 ? (
                <div className="sb-picker__empty">{FLOWER_PLACEHOLDER}<span>No assets found.</span></div>
              ) : list.map((entry) => {
                const picked = multiple && selected.some((s) => s.key === entry.key);
                return (
                  <button
                    key={entry.key}
                    data-entry={entry.key}
                    type="button"
                    role="option"
                    aria-selected={multiple ? picked : entry.key === activeKey}
                    className={`sb-asset${entry.key === activeKey ? ' is-active' : ''}${picked ? ' is-multi-selected' : ''}`}
                    // A multiple select's modifier-click gathers, and the plain click below never sees it.
                    onClickCapture={multiple ? (e) => {
                      if (!e.shiftKey && !e.metaKey && !e.ctrlKey) return;
                      e.stopPropagation();
                      toggleSelected(entry);
                    } : undefined}
                    onClick={() => { setActiveKey(entry.key); if (popover) take(entry, null); }}
                    onDoubleClick={() => { if (selected.length > 0) return; setActiveKey(entry.key); take(entry, null); }}
                  >
                    {entry.kind === 'media' ? <AssetThumb item={entry.item} /> : entry.portrait ? <AssetThumb item={entry.portrait} /> : <div className="sb-asset__thumb" />}
                    <div className="sb-asset__text">
                      <span className="sb-asset__title">{entry.kind === 'media' ? entry.item.shortenedPrompt || entry.item.prompt : characterName(entry.character)}</span>
                      {showType && <span className="sb-asset__type">{entry.kind === 'character' ? 'Character' : entry.item.kind === 'video' ? 'Video' : 'Image'}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="sb-detail">
              {active?.kind === 'character' ? (
                <CharacterPreview key={active.key} entry={active} />
              ) : active?.item.kind === 'video' ? (
                <VideoTrimmer key={active.item.id} item={active.item} trim={trim} onTrim={setTrim} onDuration={setDuration} />
              ) : active ? (
                <div className="sb-detail__image-box"><img className="sb-detail__image" src={active.item.url} alt="" /></div>
              ) : null}
              {(active || selected.length > 1) && (
                <div className="sb-detail__actions">
                  {multiple && selected.length > 1 && (
                    <div className="sb-selection-bar">
                      <button type="button" className="sb-icon-btn sb-selection-bar__clear" aria-label="Clear selection" title="Clear selection" onClick={() => setSelected([])}>
                        <FlowIcon name="close" size={20} />
                      </button>
                      <span className="sb-selection-bar__count">{selected.length} items selected</span>
                    </div>
                  )}
                  <button type="button" className="sb-btn sb-btn--tonal" onClick={confirm}>
                    <span>{actionLabel}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(
    popover ? (
      <>
        <div className={`sb-popover-backdrop${closing ? ' is-closing' : ''}`} onMouseDown={onClose} />
        {!closing && panel}
      </>
    ) : (
      <>
        <div className={`sb-dialog-backdrop${closing ? ' is-closing' : ''}`} onMouseDown={onClose} />
        <div className="sb-dialog-wrap">{panel}</div>
      </>
    ),
    document.body,
  );
};
