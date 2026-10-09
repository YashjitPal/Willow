// A scene in the gallery: Flow's `flow-scene-tile`.
//
// At rest it shows the scene's first frame, a `movie` badge and a footer with the name, the clip
// count and a filmstrip. Hovering plays the scene clip by clip with a white playhead over the
// filmstrip. While the scene is being created it is the gallery's generating tile with Flow's
// `movie_edit` badge, and it reveals the way a finished generation does.
import React from 'react';
import { motion } from 'framer-motion';
import { useStore } from '@nanostores/react';
import { GeneratingLayers } from '../GalleryTile';
import { $scenePhases, copyClips, openScene, trashScene, updateScene, type Scene } from './scene-store';
import { clipDuration, clipStarts, locateTime } from './scene-format';
import { usePlayableUrls } from './scene-media-url';
import { exportScene } from './scene-export';
import { Tooltip } from '@willow/ui/Tooltip';
import { FlowIcon, FlowMatDivider, FlowMatMenu, FlowMatMenuItem, FlowRenameOverlay, type MenuAnchor } from './flow-ui';
import { useLongPress } from '../use-long-press';
import { TouchMoreButton } from '../TouchMoreButton';
import './scene-tile.css';

export const SceneTile = React.memo(({
  scene,
  ar,
  finalWidth,
  finalHeight,
  isLastRow,
  layoutDuration,
  resolveUrl,
  dragDimmed = false,
  dropTarget = false,
}: {
  scene: Scene;
  ar: number;
  finalWidth: number;
  finalHeight: number;
  isLastRow: boolean;
  layoutDuration: number;
  resolveUrl: (mediaId: string) => string | undefined;
  /** A gallery drag is on and the pointer is elsewhere (drag/drag.css). */
  dragDimmed?: boolean;
  /** A dragged video would land in this scene. */
  dropTarget?: boolean;
}) => {
  const phase = useStore($scenePhases)[scene.id];
  const [hover, setHover] = React.useState(false);
  const [menu, setMenu] = React.useState<MenuAnchor | null>(null);
  /** The tile's box while its Rename overlay is up. */
  const [renaming, setRenaming] = React.useState<DOMRect | null>(null);
  const [progress, setProgress] = React.useState(0);
  const [active, setActive] = React.useState(0);
  const tileRef = React.useRef<HTMLDivElement>(null);
  const moreRef = React.useRef<HTMLButtonElement>(null);
  const videoRefs = React.useRef<(HTMLVideoElement | null)[]>([]);
  const timeRef = React.useRef(0);

  // Flow's tile works from the first two clips only: the filmstrip shows them and counts the rest
  // as "+N", and hovering plays just those two.
  const clipCount = scene.clips.length;
  const clips = React.useMemo(() => scene.clips.slice(0, 2), [scene.clips]);
  const total = clipStarts(clips).total;
  const urls = usePlayableUrls(hover ? clips.map((c) => resolveUrl(c.mediaId)) : []);

  // The menu and the Rename overlay cover the page, so in Flow the tile loses hover under them:
  // playback holds its frame and the scrubber goes. They portal from inside this tile, where
  // React would still count the pointer as over it.
  const playing = hover && !menu && !renaming;

  // Hover playback: the clips play one after another and loop, the playhead tracking the whole.
  // The scrubber drives it through `playback`: Flow pauses on press, seeks as the pointer moves
  // (into whichever clip that lands in) and plays again on release.
  const playback = React.useRef<{ seek(t: number): void; hold(): void; release(): void } | null>(null);
  React.useEffect(() => {
    if (!playing || !clips.length) return undefined;
    let raf = 0;
    let index = 0;
    let held = false;
    const show = (i: number, at: number) => {
      index = i;
      setActive(i);
      videoRefs.current.forEach((v, j) => { if (v && j !== i) v.pause(); });
      const v = videoRefs.current[i];
      if (v) v.currentTime = at;
      return v;
    };
    const start = (i: number, at?: number) => {
      const v = show(i, at ?? clips[i].trimStart);
      if (v && !held) void v.play().catch(() => undefined);
    };
    playback.current = {
      seek: (t) => {
        const loc = locateTime(clips, t);
        if (loc) show(loc.index, loc.sourceTime);
      },
      hold: () => { held = true; videoRefs.current[index]?.pause(); },
      release: () => { held = false; void videoRefs.current[index]?.play().catch(() => undefined); },
    };
    const loc = locateTime(clips, timeRef.current);
    start(loc?.index ?? 0, loc?.sourceTime);
    const tick = () => {
      const v = videoRefs.current[index];
      const clip = clips[index];
      if (v && clip && !held) {
        if (v.currentTime >= clip.trimEnd - 0.03 || v.ended) {
          start(index + 1 < clips.length ? index + 1 : 0);
        } else {
          const t = clipStarts(clips).starts[index] + Math.max(0, v.currentTime - clip.trimStart);
          timeRef.current = t;
          setProgress(total ? t / total : 0);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      playback.current = null;
      cancelAnimationFrame(raf);
      videoRefs.current.forEach((v) => v?.pause());
    };
  }, [playing, clips, total, urls]);

  React.useEffect(() => {
    if (!hover) { timeRef.current = 0; setProgress(0); setActive(0); }
  }, [hover]);

  const seekTo = (fraction: number) => {
    const t = Math.min(Math.max(0, fraction), 1) * total;
    timeRef.current = t;
    setProgress(total ? t / total : 0);
    playback.current?.seek(t);
  };

  const creating = phase === 'creating';
  const revealing = phase === 'revealing';
  const openMenuBelow = () => {
    if (moreRef.current) setMenu({ kind: 'below', rect: moreRef.current.getBoundingClientRect() });
  };
  // A touch screen's right-click.
  const hold = useLongPress((x, y) => { if (!creating) setMenu({ kind: 'point', x, y }); });

  return (
    <motion.div
      ref={tileRef}
      layout
      transition={{ duration: layoutDuration, ease: [0.16, 1, 0.3, 1] }}
      style={{ flexGrow: isLastRow ? 0 : ar, flexBasis: `${finalWidth}px`, height: `${finalHeight}px` }}
      className={`gallery-tile sb-scene-tile-host dg-tile${dragDimmed ? ' is-drag-dimmed' : ''} relative rounded-[16px] bg-[#0c0c0c] shadow-2xl ${menu ? 'overflow-visible z-40' : 'overflow-hidden z-10'}`}
      aria-label={creating ? 'Creating...' : scene.name}
      data-drop-scene={creating ? undefined : scene.id}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => { if (!creating && !renaming) openScene(scene.id); }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        hold.cancel();
        if (hold.justFired()) return;
        if (!creating) setMenu({ kind: 'point', x: e.clientX, y: e.clientY });
      }}
      {...hold.handlers}
    >
      {!creating && (
        <div className={`gallery-tile-glass ${revealing ? 'gallery-tile-glass--revealing' : 'gallery-tile-glass--settled'}`}>
          <div className="sb-scene-tile">
            <div className={`sb-scene-tile__container${playing ? ' is-hover' : ''}${menu ? ' is-menu-open' : ''}`}>
              {!clips.length ? (
                <div className="sb-scene-tile__empty">
                  <FlowIcon name="movie_edit" size={40} weight={300} />
                  <span className="sb-scene-tile__empty-label">{scene.name}</span>
                </div>
              ) : scene.poster && <img className="sb-scene-tile__poster" src={scene.poster} alt="" draggable={false} />}
              {hover && clips.map((clip, i) => (
                <video
                  key={clip.id}
                  ref={(el) => { videoRefs.current[i] = el; }}
                  className={`sb-scene-tile__video${i === active ? ' is-active' : ''}`}
                  src={urls[i]}
                  muted
                  playsInline
                  preload="auto"
                  aria-label="Video preview"
                />
              ))}
              <div className="sb-scene-tile__pre">
                <div className="sb-scene-tile__type"><FlowIcon name="movie" size={22} /></div>
              </div>
              <div className="sb-scene-tile__hover">
                <div className="sb-hotbar-wrap">
                  <div className="sb-hotbar" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                    <Tooltip content="Favorite" position="above" className="sb-tooltip">
                      <button
                        type="button"
                        className="sb-hotbar-btn"
                        aria-label={scene.favorite ? 'Remove favorite' : 'Favorite'}
                        onClick={() => updateScene(scene.id, { favorite: !scene.favorite })}
                      >
                        <FlowIcon name="favorite" size={18} fill={!!scene.favorite} />
                      </button>
                    </Tooltip>
                    <Tooltip content="More" position="above" className="sb-tooltip">
                      <button
                        ref={moreRef}
                        type="button"
                        className="sb-hotbar-btn"
                        aria-label="More options"
                        aria-expanded={!!menu}
                        onClick={() => (menu ? setMenu(null) : openMenuBelow())}
                      >
                        <FlowIcon name="more_vert" size={18} />
                      </button>
                    </Tooltip>
                  </div>
                </div>
              </div>
              {clips.length > 0 && <div className="sb-scene-tile__footer">
                <div className="sb-scene-tile__meta">
                  <span className="sb-scene-tile__title">{scene.name}</span>
                  <span className="sb-scene-tile__counts">
                    <FlowIcon name="play_circle" size={16} />
                    <span>{clipCount}</span>
                  </span>
                </div>
                <div className="sb-filmstrip">
                  {clips.map((clip) => (
                    <div
                      key={clip.id}
                      className="sb-filmstrip__clip"
                      role="img"
                      aria-label="Clip thumbnail"
                      style={{
                        '--clip-flex-grow': String(clipDuration(clip) || 1),
                        '--clip-thumbnail-url': clip.thumb ? `url("${clip.thumb}")` : 'none',
                      } as React.CSSProperties}
                    />
                  ))}
                  {clipCount > 2 && (
                    <div className="sb-filmstrip__overflow">
                      <FlowIcon name="add" size={16} />
                      <span>{clipCount - 2}</span>
                    </div>
                  )}
                </div>
              </div>}
              {clips.length > 0 && <div
                className={`sb-scene-tile__scrubber${clipCount > 2 ? ' has-overflow' : ''}`}
                role="slider"
                aria-label="Scrub scene"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress * 100)}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  const el = e.currentTarget;
                  el.setPointerCapture(e.pointerId);
                  playback.current?.hold();
                  const at = (x: number) => { const r = el.getBoundingClientRect(); seekTo((x - r.left) / r.width); };
                  at(e.clientX);
                  const move = (ev: PointerEvent) => at(ev.clientX);
                  const up = () => {
                    el.removeEventListener('pointermove', move);
                    el.removeEventListener('pointerup', up);
                    el.removeEventListener('pointercancel', up);
                    playback.current?.release();
                  };
                  el.addEventListener('pointermove', move);
                  el.addEventListener('pointerup', up);
                  el.addEventListener('pointercancel', up);
                }}
              >
                <div className="sb-scene-tile__handle" style={{ left: `${progress * 100}%` }} />
              </div>}
            </div>
          </div>
        </div>
      )}

      {(creating || revealing) && (
        <GeneratingLayers isRevealing={revealing}>
          <div className={`sb-pending__chrome ${revealing ? 'mesh-chrome--revealing' : ''}`}>
            <div className="sb-pending__header"><FlowIcon name="movie_edit" size={24} weight={300} /></div>
            <div className="sb-pending__footer">
              <div className="sb-pending__title">{creating ? 'Creating...' : scene.name}</div>
            </div>
          </div>
        </GeneratingLayers>
      )}

      <div className={`dg-ring${dropTarget ? ' is-active' : ''}`} />

      {!creating && (
        <TouchMoreButton
          corner="top"
          open={!!menu}
          hidden={!!renaming}
          onToggle={(rect) => setMenu(menu ? null : { kind: 'below', rect })}
        />
      )}

      <FlowRenameOverlay
        open={!!renaming}
        anchor={renaming}
        value={scene.name}
        onCommit={(name) => updateScene(scene.id, { name })}
        onClose={() => setRenaming(null)}
      />

      <FlowMatMenu open={!!menu} onClose={() => setMenu(null)} anchor={menu} ignoreRefs={[moreRef]}>
        <FlowMatMenuItem
          icon="favorite"
          iconFill={!!scene.favorite}
          label="Favorite"
          onSelect={() => updateScene(scene.id, { favorite: !scene.favorite })}
        />
        <FlowMatMenuItem icon="edit" label="Rename" onSelect={() => setRenaming(tileRef.current?.getBoundingClientRect() ?? null)} />
        <FlowMatDivider />
        <FlowMatMenuItem icon="content_copy" label="Copy" onSelect={() => copyClips(scene.clips)} />
        <FlowMatDivider />
        <FlowMatMenuItem icon="download" label="Download" onSelect={() => { void exportScene(scene, resolveUrl).catch(() => undefined); }} />
        <FlowMatDivider />
        <FlowMatMenuItem icon="delete" label="Move to trash" danger onSelect={() => trashScene(scene.id)} />
      </FlowMatMenu>
    </motion.div>
  );
});
SceneTile.displayName = 'SceneTile';
