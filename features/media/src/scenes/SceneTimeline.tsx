// The Scenebuilder's timeline — Flow's `flow-scene-timeline`.
//
// A ruler of 102px units (1/2/4/8 seconds each, by zoom), the clips laid end to end from x=21,
// and a playhead whose 16px hit target is centred on its time. Clips select on click, reorder by
// drag (Angular CDK's, as Flow runs it: the dragged clip lifts into a translucent copy, a grey
// placeholder holds its slot, the clip under the pointer trades places with it, all sliding
// 250ms), and trim from either edge with a live duration badge. The selected clip carries the
// springy white Add clip button.
//
// On a touch screen a finger scrolls the timeline and a tap seeks; only the playhead and the trim
// handles take a drag. Holding a clip opens its menu, where a touch screen moves clips (a drag
// there would be a scroll).
import React from 'react';
import { createPortal } from 'react-dom';
import type { ReadableAtom } from 'nanostores';
import { Tooltip } from '@willow/ui/Tooltip';
import { FlowIcon, FlowMatMenu, FlowMatMenuItem, type MenuAnchor } from './flow-ui';
import { useLongPress } from '../use-long-press';
import {
  FIRST_UNIT_WIDTH,
  MIN_CLIP_SECONDS,
  PLAYHEAD_HALF,
  ZOOM_LEVELS,
  clipDuration,
  filmstripCount,
  formatTrimSeconds,
  placeInOrder,
  pxPerSecond,
  rulerLabel,
  rulerUnitCount,
  sortDragOrder,
  type DragSwap,
} from './scene-format';
import { useFrames } from './scene-host';
import type { SceneClip } from './scene-store';

const TRIM_PATH = 'M6 57L3.38574 57C3.75841 56.4134 4 55.7261 4 55C4 33.3049 4.02917 24.697 4 2.99902C3.99979 2.27329 3.75825 1.58637 3.38575 0.999999L6 1C7.65686 1 9 2.34314 9 4L9 54C9 55.6569 7.65685 57 6 57Z';
const PLAYHEAD_PATH = 'M 0 0 L 16 0 C 12.5 2 9 5 9 23 L 7 23 C 7 5 3.5 2 0 0 Z';
/** CDK starts a drag only after the pointer has moved this far. */
const DRAG_THRESHOLD = 5;
/** ...and takes the pointer as going the other way only once it has come back this far. */
const DIRECTION_THRESHOLD = 5;
const DROP_MS = 250;
/**
 * Held this close to the timeline's left or right edge, a dragged clip scrolls it, faster the
 * deeper in (Flow's doesn't scroll: a clip off screen can't be reached without zooming out).
 */
const AUTO_SCROLL_ZONE = 64;
const AUTO_SCROLL_MAX_STEP = 24;

interface TrimState {
  clipId: string;
  side: 'left' | 'right';
  startX: number;
  orig: { trimStart: number; trimEnd: number };
  cur: { trimStart: number; trimEnd: number };
}

interface DragState {
  clipId: string;
  /**
   * Every clip's id in the order the drag has them, the dragged one where its placeholder is. Ids,
   * not indexes: when the drop's reorder lands, the clips already stand in this order and nothing
   * is shifted, whichever of the two renders first.
   */
  order: string[];
  /** Where in the clip it was picked up, so the preview keeps that point under the pointer. */
  offsetX: number;
  offsetY: number;
  x: number;
  y: number;
  width: number;
  height: number;
  dropping: { left: number; top: number } | null;
}

const ClipStrip: React.FC<{ clip: SceneClip; url?: string; width: number }> = ({ clip, url, width }) => {
  const count = filmstripCount(width);
  const dur = clipDuration(clip);
  const times = React.useMemo(
    () => Array.from({ length: count }, (_, i) => clip.trimStart + (i * dur) / count),
    [count, clip.trimStart, dur],
  );
  const frames = useFrames(url, times, 200);
  const placeholder = { '--clip-thumbnail-url': clip.thumb ? `url("${clip.thumb}")` : 'none' } as React.CSSProperties;
  return (
    <div className="sb-strip">
      {frames.map((f, i) => (f
        ? <img key={i} className="sb-strip__img" src={f} alt="" draggable={false} />
        : <div key={i} className="sb-strip__placeholder" style={placeholder} />))}
    </div>
  );
};

const TrimHandle: React.FC<{ side: 'left' | 'right'; onPointerDown: (e: React.PointerEvent) => void }> = ({ side, onPointerDown }) => (
  <div className={`sb-trim sb-trim--${side}`} onPointerDown={onPointerDown} onClick={(e) => e.stopPropagation()}>
    <svg className="sb-trim__svg" width="10" height="58" viewBox="0 0 10 58" fill="none" preserveAspectRatio="none" aria-hidden="true">
      <path d={TRIM_PATH} fill="currentColor" stroke="currentColor" strokeWidth="2" />
    </svg>
    <div className="sb-trim__marker" />
  </div>
);

export const SceneTimeline: React.FC<{
  clips: SceneClip[];
  urlOf: (clip: SceneClip) => string | undefined;
  pendingClipIds: Set<string>;
  /** Clips whose video isn't in the gallery: they play as a gap. */
  missingClipIds?: Set<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  zoom: number;
  onZoom: (zoom: number) => void;
  /** The playhead's store. It moves every frame, so it places the playhead without a render. */
  time: ReadableAtom<number>;
  onSeek: (t: number) => void;
  onTrim: (clipId: string, trimStart: number, trimEnd: number) => void;
  /** Move the clip to index `to` (of the clips as they will be). */
  onReorder: (clipId: string, to: number) => void;
  onAddClip: () => void;
  onClipMenu: (clipId: string, x: number, y: number) => void;
}> = ({ clips, urlOf, pendingClipIds, missingClipIds, selectedId, onSelect, zoom, onZoom, time, onSeek, onTrim, onReorder, onAddClip, onClipMenu }) => {
  const areaRef = React.useRef<HTMLDivElement>(null);
  const tracksRef = React.useRef<HTMLDivElement>(null);
  const addBtnRef = React.useRef<HTMLButtonElement>(null);
  const clipRefs = React.useRef(new Map<string, HTMLDivElement>());
  const previewRef = React.useRef<HTMLDivElement | null>(null);
  /** The dragged clip's body, copied into the preview as CDK clones the element. */
  const previewSourceRef = React.useRef<HTMLElement | null>(null);
  const suppressClick = React.useRef(false);
  const [trim, setTrim] = React.useState<TrimState | null>(null);
  const [drag, setDrag] = React.useState<DragState | null>(null);
  const [scrubbing, setScrubbing] = React.useState(false);
  const [addMenu, setAddMenu] = React.useState<MenuAnchor | null>(null);

  const secondsPerUnit = ZOOM_LEVELS[zoom];
  const pps = pxPerSecond(secondsPerUnit);
  const total = clips.reduce((sum, c) => sum + clipDuration(c), 0);
  const units = rulerUnitCount(total, secondsPerUnit);

  const widthOf = (clip: SceneClip) => {
    if (trim && trim.clipId === clip.id) {
      const start = Math.min(trim.orig.trimStart, trim.cur.trimStart);
      const end = Math.max(trim.orig.trimEnd, trim.cur.trimEnd);
      return (end - start) * pps;
    }
    return clipDuration(clip) * pps;
  };

  // Where each clip rests, and, while one is dragged, how far the drag has shifted it.
  const lefts: number[] = [];
  {
    let x = 0;
    for (const clip of clips) { lefts.push(x); x += widthOf(clip); }
  }
  /** Each clip's width by id: the drag's handlers outlive the render they started in. */
  const widthsRef = React.useRef(new Map<string, number>());
  widthsRef.current = new Map(clips.map((c) => [c.id, widthOf(c)]));
  const dragLefts = (() => {
    if (!drag) return null;
    const ids = clips.map((c) => c.id);
    const order = [...drag.order.filter((id) => ids.includes(id)), ...ids.filter((id) => !drag.order.includes(id))];
    return placeInOrder(order, (id) => widthsRef.current.get(id) ?? 0);
  })();
  const shiftOf = (clip: SceneClip, i: number) => (dragLefts ? (dragLefts.get(clip.id) ?? lefts[i]) - lefts[i] : 0);

  const timeFromClientX = (clientX: number) => {
    const area = areaRef.current;
    if (!area) return 0;
    const r = area.getBoundingClientRect();
    return Math.max(0, (clientX - r.left + area.scrollLeft - FIRST_UNIT_WIDTH) / pps);
  };

  /* ---- playhead + ruler scrubbing ---- */
  const startScrub = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('.sb-clip, .sb-add-clip, button')) return;
    // A finger anywhere but the playhead may be scrolling: seek only if it lifts where it landed.
    if (e.pointerType === 'touch' && !target.closest('.sb-playhead-hit')) {
      const { clientX: x0, clientY: y0 } = e;
      const lift = (ev: PointerEvent) => {
        stop();
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 10) onSeek(timeFromClientX(ev.clientX));
      };
      const stop = () => {
        window.removeEventListener('pointerup', lift);
        window.removeEventListener('pointercancel', stop);
      };
      window.addEventListener('pointerup', lift);
      window.addEventListener('pointercancel', stop);
      return;
    }
    e.preventDefault();
    onSeek(timeFromClientX(e.clientX));
    setScrubbing(true);
    const move = (ev: PointerEvent) => onSeek(timeFromClientX(ev.clientX));
    const up = () => {
      setScrubbing(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  /* ---- trimming ---- */
  const startTrim = (clip: SceneClip, side: 'left' | 'right') => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect(clip.id);
    const orig = { trimStart: clip.trimStart, trimEnd: clip.trimEnd };
    let state: TrimState = { clipId: clip.id, side, startX: e.clientX, orig, cur: orig };
    setTrim(state);
    const move = (ev: PointerEvent) => {
      const dt = (ev.clientX - state.startX) / pps;
      const cur = side === 'left'
        ? { trimStart: Math.min(Math.max(0, orig.trimStart + dt), orig.trimEnd - MIN_CLIP_SECONDS), trimEnd: orig.trimEnd }
        : { trimStart: orig.trimStart, trimEnd: Math.max(Math.min(clip.sourceDuration, orig.trimEnd + dt), orig.trimStart + MIN_CLIP_SECONDS) };
      state = { ...state, cur };
      setTrim(state);
    };
    const finish = (commit: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      setTrim(null);
      if (commit && (state.cur.trimStart !== orig.trimStart || state.cur.trimEnd !== orig.trimEnd)) {
        onTrim(clip.id, state.cur.trimStart, state.cur.trimEnd);
      }
    };
    const up = () => finish(true);
    // The pointer taken (a finger's gesture claimed by the browser): the clip keeps its length.
    const cancel = () => finish(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  };

  /* ---- reordering: Angular CDK's single-axis sort, as Flow's timeline runs it ---- */
  const startDrag = (clip: SceneClip) => (e: React.PointerEvent) => {
    // A finger dragging a clip is scrolling the timeline; its menu moves the clip instead.
    if (e.pointerType === 'touch') return;
    if (e.button !== 0 || clips.length < 2 || pendingClipIds.has(clip.id)) return;
    const el = clipRefs.current.get(clip.id);
    const area = areaRef.current;
    const tracks = tracksRef.current;
    if (!el || !area || !tracks) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const startOrder = clips.map((c) => c.id);
    const widthOfId = (id: string) => widthsRef.current.get(id) ?? 0;
    let state: DragState | null = null;
    let pointer = { x: startX, y: startY };
    // The way the pointer is going changes only after it has come back DIRECTION_THRESHOLD px.
    const direction = { x: 0, at: startX };
    let lastSwap: DragSwap = { id: '', delta: 0, overlaps: false };
    let raf = 0;

    const sort = () => {
      if (!state) return;
      const r = tracks.getBoundingClientRect();
      // Only with the pointer near the track: within 5% of its size around it, as CDK has it.
      const near = pointer.x > r.left - r.width * 0.05 && pointer.x < r.right + r.width * 0.05
        && pointer.y > r.top - r.height * 0.05 && pointer.y < r.bottom + r.height * 0.05;
      if (!near) return;
      const step = sortDragOrder(state.order, state.clipId, pointer.x - r.left, widthOfId, direction.x, lastSwap);
      if (!step) return;
      lastSwap = step.lastSwap;
      state = { ...state, order: step.order };
    };

    const placePreview = () => {
      const preview = previewRef.current;
      if (!state || !preview || state.dropping) return;
      preview.style.left = `${state.x - state.offsetX}px`;
      preview.style.top = `${state.y - state.offsetY}px`;
    };

    // The timeline scrolls under a clip held at its edge, which then sorts against what came in.
    const autoScroll = () => {
      raf = requestAnimationFrame(autoScroll);
      if (!state || state.dropping) return;
      const r = area.getBoundingClientRect();
      if (pointer.y < r.top - AUTO_SCROLL_ZONE || pointer.y > r.bottom + AUTO_SCROLL_ZONE) return;
      const depth = (d: number) => Math.min(AUTO_SCROLL_MAX_STEP, 2 + (d / AUTO_SCROLL_ZONE) * (AUTO_SCROLL_MAX_STEP - 2));
      const max = area.scrollWidth - area.clientWidth;
      let step = 0;
      if (pointer.x < r.left + AUTO_SCROLL_ZONE && area.scrollLeft > 0) step = -depth(r.left + AUTO_SCROLL_ZONE - pointer.x);
      else if (pointer.x > r.right - AUTO_SCROLL_ZONE && area.scrollLeft < max) step = depth(pointer.x - (r.right - AUTO_SCROLL_ZONE));
      if (step) area.scrollLeft = Math.max(0, Math.min(max, area.scrollLeft + step));
    };

    const onScroll = () => {
      const before = state?.order;
      sort();
      if (state && state.order !== before) setDrag(state);
    };

    const move = (ev: PointerEvent) => {
      pointer = { x: ev.clientX, y: ev.clientY };
      if (!state) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
        suppressClick.current = true;
        const r = el.getBoundingClientRect();
        previewSourceRef.current = el.querySelector('.sb-clip__body');
        state = { clipId: clip.id, order: startOrder, offsetX: startX - r.left, offsetY: startY - r.top, x: ev.clientX, y: ev.clientY, width: r.width, height: r.height, dropping: null };
        area.addEventListener('scroll', onScroll);
        raf = requestAnimationFrame(autoScroll);
      }
      if (Math.abs(ev.clientX - direction.at) > DIRECTION_THRESHOLD) {
        direction.x = ev.clientX > direction.at ? 1 : -1;
        direction.at = ev.clientX;
      }
      const before = state.order;
      state = { ...state, x: ev.clientX, y: ev.clientY };
      sort();
      // A move that changes no slot only moves the preview; React renders when a slot changes.
      if (state.order !== before || !previewRef.current) setDrag(state);
      else placePreview();
    };

    const finish = (commit: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
      area.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
      if (!state) return;
      // A cancelled drag (the window lost, the pointer taken) settles back where it started.
      const final: DragState = commit ? state : { ...state, order: startOrder };
      const left = placeInOrder(final.order, widthOfId).get(final.clipId) ?? 0;
      setDrag({ ...final, dropping: { left: tracks.getBoundingClientRect().left + left, top: el.getBoundingClientRect().top } });
      window.setTimeout(() => {
        const to = final.order.indexOf(final.clipId);
        setDrag(null);
        if (to !== startOrder.indexOf(final.clipId)) onReorder(final.clipId, to);
        window.setTimeout(() => { suppressClick.current = false; }, 0);
      }, DROP_MS);
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
  };

  const attachPreview = React.useCallback((node: HTMLDivElement | null) => {
    previewRef.current = node;
    const body = previewSourceRef.current;
    if (node && body && !node.firstChild) node.appendChild(body.cloneNode(true));
  }, []);

  /* ---- a touch screen's right-click: holding a clip ---- */
  const clipHold = useLongPress((x, y, target) => {
    const id = target.closest<HTMLElement>('[data-clip-id]')?.dataset.clipId;
    if (!id || target.closest('.sb-trim, .sb-add-clip')) return;
    onSelect(id);
    onClipMenu(id, x, y);
  });

  const draggedClip = drag ? clips.find((c) => c.id === drag.clipId) : undefined;
  const trimClipIndex = trim ? clips.findIndex((c) => c.id === trim.clipId) : -1;

  const playheadRef = React.useRef<HTMLDivElement>(null);
  const playheadHitRef = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const place = (t: number) => {
      const left = `${FIRST_UNIT_WIDTH + t * pps - PLAYHEAD_HALF}px`;
      if (playheadRef.current) playheadRef.current.style.left = left;
      if (playheadHitRef.current) playheadHitRef.current.style.left = left;
    };
    place(time.get());
    return time.listen(place);
  }, [time, pps]);

  const addClipButton = (
    <Tooltip content="Add clip" className="sb-tooltip">
      <button
        ref={addBtnRef}
        type="button"
        aria-label="Add clip"
        className={`sb-icon-btn sb-add-clip__btn${addMenu ? ' is-open' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          if (addMenu) { setAddMenu(null); return; }
          setAddMenu({ kind: 'above', rect: e.currentTarget.getBoundingClientRect() });
        }}
      >
        <FlowIcon name="add_2" size={15.2} className="sb-add-clip__icon" />
      </button>
    </Tooltip>
  );

  return (
    <div className="sb-timeline">
      <div className="sb-timeline__controls">
        <div
          ref={areaRef}
          className={`sb-timeline__area${scrubbing ? ' is-dragging-playhead' : ''}`}
          onPointerDown={startScrub}
        >
          <div className="sb-ruler">
            {Array.from({ length: units }, (_, i) => (
              <div key={i} className="sb-unit">
                <span className="sb-unit__label">{rulerLabel(i, secondsPerUnit)}</span>
              </div>
            ))}
          </div>

          <div ref={playheadHitRef} className="sb-playhead-hit" />

          <div ref={tracksRef} className={`sb-tracks${drag ? ' is-reordering' : ''}${clips.length ? '' : ' is-empty'}`} {...clipHold.handlers}>
            {!clips.length && (
              <div className="sb-tracks__empty" onPointerDown={(e) => e.stopPropagation()}>
                {addClipButton}
              </div>
            )}
            {clips.map((clip, i) => {
              const width = widthOf(clip);
              const isTrimmed = trim?.clipId === clip.id;
              const spanStart = isTrimmed ? Math.min(trim.orig.trimStart, trim.cur.trimStart) : clip.trimStart;
              const leftCut = isTrimmed ? (trim.cur.trimStart - spanStart) * pps : 0;
              const rightCut = isTrimmed ? width - (trim.cur.trimEnd - spanStart) * pps : 0;
              const selected = clip.id === selectedId;
              const pending = pendingClipIds.has(clip.id);
              const isPlaceholder = drag?.clipId === clip.id;
              const shift = shiftOf(clip, i);
              const stripClip = isTrimmed ? { ...clip, trimStart: spanStart, trimEnd: spanStart + width / pps } : clip;
              return (
                <div
                  key={clip.id}
                  data-clip-id={clip.id}
                  ref={(el) => { if (el) clipRefs.current.set(clip.id, el); else clipRefs.current.delete(clip.id); }}
                  className={[
                    'sb-clip',
                    i === 0 ? 'is-first' : '',
                    i === clips.length - 1 ? 'is-last' : '',
                    selected ? 'is-selected' : '',
                    pending ? 'is-pending' : '',
                    isPlaceholder ? 'is-placeholder' : '',
                  ].filter(Boolean).join(' ')}
                  style={{ width, transform: shift ? `translateX(${shift}px)` : undefined }}
                  onPointerDown={startDrag(clip)}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (suppressClick.current) return;
                    onSelect(clip.id);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    clipHold.cancel();
                    if (clipHold.justFired()) return;
                    onSelect(clip.id);
                    onClipMenu(clip.id, e.clientX, e.clientY);
                  }}
                >
                  <div className="sb-clip__body">
                    {pending ? (
                      <div className="sb-shimmer" />
                    ) : (
                      <div className="sb-strip-box">
                        <ClipStrip clip={stripClip} url={urlOf(clip)} width={width} />
                      </div>
                    )}
                    {missingClipIds?.has(clip.id) && (
                      <Tooltip content={clip.file ? `Not found: ${clip.file}` : 'Video not found'} className="sb-tooltip">
                        <div className="sb-clip-missing" aria-label="Video not found">
                          <FlowIcon name="error" size={18} />
                          {width >= 96 && <span>Missing</span>}
                        </div>
                      </Tooltip>
                    )}
                  </div>
                  {isTrimmed && leftCut > 0.5 && <div className="sb-trimmed sb-trimmed--left" style={{ width: leftCut }} />}
                  {isTrimmed && rightCut > 0.5 && <div className="sb-trimmed sb-trimmed--right" style={{ width: rightCut }} />}
                  {!pending && (
                    <div className={`sb-selected-overlay${isTrimmed ? ' is-trimming' : ''}`} style={{ left: leftCut, right: rightCut }}>
                      <TrimHandle side="left" onPointerDown={startTrim(clip, 'left')} />
                      <TrimHandle side="right" onPointerDown={startTrim(clip, 'right')} />
                    </div>
                  )}
                  {selected && !drag && (
                    <div className="sb-add-clip" onPointerDown={(e) => e.stopPropagation()}>
                      {addClipButton}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {trim && trimClipIndex >= 0 && (() => {
            const clip = clips[trimClipIndex];
            const width = widthOf(clip);
            const spanStart = Math.min(trim.orig.trimStart, trim.cur.trimStart);
            const edge = trim.side === 'left'
              ? (trim.cur.trimStart - spanStart) * pps
              : (trim.cur.trimEnd - spanStart) * pps;
            const x = FIRST_UNIT_WIDTH + lefts[trimClipIndex] + Math.min(edge, width);
            return (
              <div className="sb-trim-indicator" style={{ left: x }}>
                <div className="sb-trim-badge">{formatTrimSeconds(trim.cur.trimEnd - trim.cur.trimStart)}</div>
              </div>
            );
          })()}

          <div ref={playheadRef} className="sb-playhead">
            <svg className="sb-playhead__svg" width="16" height="23" viewBox="0 0 16 23" fill="none" aria-hidden="true">
              <path d={PLAYHEAD_PATH} fill="currentColor" />
            </svg>
            <div className="sb-playhead__line" />
          </div>
        </div>

        <div className="sb-zoom">
          <Tooltip content="Zoom out" className="sb-tooltip">
            <button type="button" aria-label="Zoom out" className="sb-icon-btn" disabled={zoom >= ZOOM_LEVELS.length - 1} onClick={() => onZoom(zoom + 1)}>
              <FlowIcon name="zoom_out" size={18} />
            </button>
          </Tooltip>
          <Tooltip content="Zoom in" className="sb-tooltip">
            <button type="button" aria-label="Zoom in" className="sb-icon-btn" disabled={zoom <= 0} onClick={() => onZoom(zoom - 1)}>
              <FlowIcon name="zoom_in" size={18} />
            </button>
          </Tooltip>
        </div>
      </div>

      <FlowMatMenu open={!!addMenu} onClose={() => setAddMenu(null)} anchor={addMenu} variant="popover" ignoreRefs={[addBtnRef]}>
        <FlowMatMenuItem icon="add" label="Add clip" onSelect={onAddClip} />
        <FlowMatMenuItem icon="keyboard_double_arrow_right" label="Extend (Veo 3.1 - Lite)" disabled />
      </FlowMatMenu>

      {/* The preview is a copy of the clip as it was picked up (CDK clones the element): its
        * frames are on screen already, where a strip built anew would load them again. */}
      {drag && draggedClip && createPortal(
        <div
          ref={attachPreview}
          className={`sb-clip sb-clip-preview${drag.clipId === selectedId ? ' is-selected' : ''}${drag.dropping ? ' is-dropping' : ''}`}
          style={{
            left: drag.dropping ? drag.dropping.left : drag.x - drag.offsetX,
            top: drag.dropping ? drag.dropping.top : drag.y - drag.offsetY,
            width: drag.width,
            height: drag.height,
          }}
        />,
        document.body,
      )}
    </div>
  );
};
