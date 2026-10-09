// Flow's `flow-navigation-rail`: the strip of thumbnails in the middle of an editor's header —
// every scene, image and video in the project, newest first, the open one enlarged and ringed.
// Its arrows show only while there is more to scroll to and the pointer is over the rail.
// Shared by the Scenebuilder and the image editor; styled by `.sb-rail*` in scene-builder.css.
import React from 'react';
import type { MediaItem } from '../types';
import type { Scene } from '../scenes/scene-store';
import { FlowIcon } from '../scenes/flow-ui';
import { useFrames } from '../scenes/scene-host';

export interface RailEntry {
  id: string;
  label: string;
  kind: 'scene' | 'image' | 'video';
  thumb?: string;
  url?: string;
  time: number;
}

/** The rail's entries: live scenes and finished images and videos, newest first. */
export function buildRailEntries(scenes: Scene[], items: MediaItem[]): RailEntry[] {
  const out: RailEntry[] = [];
  for (const s of scenes) if (!s.trashedAt) out.push({ id: s.id, label: s.name, kind: 'scene', thumb: s.poster, time: s.createdAt });
  for (const m of items) {
    if (m.historyParentId || m.status !== 'completed' || !m.url || m.kind === 'audio') continue;
    out.push({ id: m.id, label: m.shortenedPrompt || m.prompt, kind: m.kind === 'video' ? 'video' : 'image', thumb: m.kind === 'image' ? m.url : undefined, url: m.url, time: m.timestamp });
  }
  return out.sort((a, b) => b.time - a.time);
}

const RailThumb: React.FC<{ entry: RailEntry; active: boolean; pending?: boolean; onClick: () => void }> = ({ entry, active, pending, onClick }) => {
  const [frame] = useFrames(entry.kind === 'video' ? entry.url : undefined, React.useMemo(() => [0], []), 64);
  const src = entry.kind === 'video' ? frame : entry.thumb;
  return (
    <div className="sb-rail__slot">
      <button type="button" className={`sb-rail__thumb${active ? ' is-active' : ''}`} aria-label={entry.label} onClick={onClick}>
        {src && !pending ? <img className="sb-rail__img" src={src} alt="" draggable={false} /> : <div className="sb-rail__placeholder" />}
      </button>
    </div>
  );
};

export const NavigationRail: React.FC<{
  entries: RailEntry[];
  activeId: string;
  /** The open entry is being regenerated: Flow greys its thumbnail until the edit lands. */
  activePending?: boolean;
  onPick: (entry: RailEntry) => void;
}> = ({ entries, activeId, activePending, onPick }) => {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [edges, setEdges] = React.useState({ left: false, right: false });
  const measure = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 1, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 });
  }, []);
  React.useEffect(() => { measure(); }, [entries.length, measure]);
  React.useEffect(() => {
    const el = scrollRef.current;
    const i = entries.findIndex((e) => e.id === activeId);
    if (el && i >= 0) {
      const x = 16 + i * 30;
      if (x < el.scrollLeft || x + 30 > el.scrollLeft + el.clientWidth) el.scrollLeft = x - el.clientWidth / 2;
      measure();
    }
  }, [activeId, entries, measure]);
  const step = (dir: number) => {
    scrollRef.current?.scrollBy({ left: dir * 150, behavior: 'smooth' });
    window.setTimeout(measure, 350);
  };
  return (
    <div className="sb-rail">
      <div className="sb-rail__container">
        <button type="button" aria-label="Previous media" className={`sb-icon-btn sb-rail__arrow${edges.left ? ' is-visible' : ''}`} onClick={() => step(-1)}>
          <FlowIcon name="arrow_left" size={16} />
        </button>
        <div ref={scrollRef} className="sb-rail__scroll" style={{ '--tiles-count': entries.length } as React.CSSProperties} onScroll={measure}>
          {entries.map((e) => (
            <RailThumb key={e.id} entry={e} active={e.id === activeId} pending={e.id === activeId && activePending} onClick={() => onPick(e)} />
          ))}
        </div>
        <button type="button" aria-label="Next media" className={`sb-icon-btn sb-rail__arrow${edges.right ? ' is-visible' : ''}`} onClick={() => step(1)}>
          <FlowIcon name="arrow_right" size={16} />
        </button>
      </div>
    </div>
  );
};
