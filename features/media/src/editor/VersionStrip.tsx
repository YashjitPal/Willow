// The history of the image editor and the Scenebuilder below 961px: every version in one row of
// thumbnails between the picture and the prompt, where the desktop has a column of cards beside
// it (ImageHistory, SceneHistory). The cards' hotbars only show on hover, so here a version's
// actions are a menu (a sheet at this width): pressing a version opens it, pressing the open one,
// or holding any one, lists what it can do. The newest version scrolls into view as it is added.
import React from 'react';
import type { MediaItem } from '../types';
import { GeneratingLayers, useGenerationProgress } from '../GalleryTile';
import { FlowIcon, FlowMatMenu, FlowMatMenuItem, type MenuAnchor } from '../scenes/flow-ui';
import { useLongPress } from '../use-long-press';
import './editor-responsive.css';

export interface VersionAction {
  icon: string;
  label: string;
  /** The anchor is the version's, for an action that opens a menu of its own (Download). */
  run: (anchor: MenuAnchor) => void;
  danger?: boolean;
}

const ratioOf = (ratio: string | undefined) => {
  const [w, h] = (ratio || '16:9').split(':').map(Number);
  return w && h ? w / h : 16 / 9;
};

const PendingThumb: React.FC<{ item: MediaItem }> = ({ item }) => {
  const progress = useGenerationProgress(item);
  return (
    <GeneratingLayers isRevealing={false}>
      <span className="vs-step__pct">{progress}%</span>
    </GeneratingLayers>
  );
};

const Step: React.FC<{
  item: MediaItem;
  index: number;
  selected: boolean;
  thumb: React.ReactNode;
  onPress: (item: MediaItem, el: HTMLElement) => void;
  onHold: (item: MediaItem, el: HTMLElement) => void;
}> = ({ item, index, selected, thumb, onPress, onHold }) => {
  const ref = React.useRef<HTMLButtonElement>(null);
  const hold = useLongPress(() => { if (ref.current) onHold(item, ref.current); });
  const status = item.status === 'generating' ? ' is-pending' : item.status === 'failed' ? ' is-failed' : '';
  return (
    <button
      ref={ref}
      type="button"
      className={`vs-step${selected ? ' is-selected' : ''}${status}`}
      style={{ aspectRatio: String(Math.min(2, Math.max(0.5, ratioOf(item.ratio)))) }}
      aria-label={`Version ${index + 1}${item.status === 'failed' ? ', failed' : item.status === 'generating' ? ', generating' : ''}`}
      aria-current={selected || undefined}
      onClick={(e) => onPress(item, e.currentTarget)}
      onContextMenu={(e) => { e.preventDefault(); if (!hold.justFired()) onHold(item, e.currentTarget); }}
      {...hold.handlers}
    >
      {item.status === 'generating' ? <PendingThumb item={item} /> : item.status === 'failed' ? <FlowIcon name="warning" size={20} /> : thumb}
    </button>
  );
};

export const VersionStrip: React.FC<{
  steps: MediaItem[];
  selectedId: string | undefined;
  hidden?: boolean;
  /** A finished version's picture: its image, or a video's first frame. */
  renderThumb: (item: MediaItem) => React.ReactNode;
  actionsFor: (item: MediaItem) => VersionAction[];
  onSelect: (item: MediaItem) => void;
}> = ({ steps, selectedId, hidden, renderThumb, actionsFor, onSelect }) => {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [menu, setMenu] = React.useState<{ item: MediaItem; anchor: MenuAnchor } | null>(null);
  const last = steps[steps.length - 1]?.id;
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ left: el.scrollWidth, behavior: 'smooth' });
  }, [last]);

  const openMenu = (item: MediaItem, el: HTMLElement) => {
    if (actionsFor(item).length) setMenu({ item, anchor: { kind: 'above', rect: el.getBoundingClientRect() } });
  };
  const press = (item: MediaItem, el: HTMLElement) => {
    if (item.status === 'completed' && item.id !== selectedId) onSelect(item);
    else openMenu(item, el);
  };

  if (hidden || !steps.length) return null;
  const actions = menu ? actionsFor(menu.item) : [];
  const caption = menu ? (menu.item.status === 'failed' ? menu.item.error || 'This version could not be made.' : menu.item.prompt) : '';
  return (
    <>
      <div ref={scrollRef} className="vs-strip" role="group" aria-label="Versions">
        {steps.map((item, index) => (
          <Step
            key={item.id}
            item={item}
            index={index}
            selected={item.id === selectedId}
            thumb={renderThumb(item)}
            onPress={press}
            onHold={openMenu}
          />
        ))}
      </div>
      <FlowMatMenu open={!!menu} onClose={() => setMenu(null)} anchor={menu?.anchor ?? null} ariaLabel="Version">
        {caption && <div className="vs-menu-caption">{caption}</div>}
        {actions.map((action) => (
          <FlowMatMenuItem
            key={action.label}
            icon={action.icon}
            label={action.label}
            danger={action.danger}
            onSelect={() => { if (menu) action.run(menu.anchor); }}
          />
        ))}
      </FlowMatMenu>
    </>
  );
};
