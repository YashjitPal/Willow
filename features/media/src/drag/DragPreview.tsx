// Flow's gallery drag: the preview that follows the pointer (`.drag-preview`), the prompt box's
// drop zone (`flow-prompt-box-drop-zone`), and what each drop target is called.
import React from 'react';
import { createPortal } from 'react-dom';
import { FlowIcon } from '../scenes/flow-ui';
import type { MediaItem } from '../types';
import './drag.css';

/** Where a drop would land, by what is under the pointer. */
export type DropTarget =
  | { kind: 'collection'; id: string }
  | { kind: 'scene'; id: string }
  | { kind: 'prompt' }
  | { kind: 'start' }
  | { kind: 'end' }
  | { kind: 'trash' };

export const sameDropTarget = (a: DropTarget | null, b: DropTarget | null): boolean =>
  a === b || (!!a && !!b && a.kind === b.kind && ('id' in a ? a.id : '') === ('id' in b ? b.id : ''));

/** The label Flow shows under the preview; none over something that takes no drop. */
export function dropLabel(target: DropTarget | null): string | null {
  switch (target?.kind) {
    case 'collection': return 'Add to collection';
    case 'scene': return 'Add to scene';
    case 'prompt':
    case 'start':
    case 'end': return 'Add ingredient';
    case 'trash': return 'Move to trash';
    default: return null;
  }
}

const THUMB_HEIGHT = 128;
const STACK_STEP = 24;
const MAX_STACK = 3;

const aspectOf = (ratio: string | undefined): number => {
  const [w, h] = (ratio || '16:9').split(':').map(Number);
  return w > 0 && h > 0 ? w / h : 16 / 9;
};

/**
 * Fixed at the pointer; MediaView moves it by writing `left`/`top` on `anchorRef` straight from its
 * pointer handler, so following the pointer never re-renders the gallery.
 */
export const DragPreview: React.FC<{
  items: MediaItem[];
  target: DropTarget | null;
  anchorRef: React.RefObject<HTMLDivElement | null>;
  initial: { x: number; y: number };
}> = ({ items, target, anchorRef, initial }) => {
  const stack = items.slice(0, MAX_STACK);
  const single = stack.length === 1;
  const label = dropLabel(target);
  return createPortal(
    <div ref={anchorRef} className="dg-preview" style={{ left: initial.x, top: initial.y }}>
      <div className="dg-thumbs">
        {stack.map((item, i) => {
          const width = single ? THUMB_HEIGHT * aspectOf(item.ratio) : THUMB_HEIGHT;
          return (
            <div
              key={item.id}
              className="dg-thumb"
              style={{
                width,
                zIndex: i === 0 ? undefined : -i,
                transform: `translate(${-width / 2 + i * STACK_STEP}px, ${-THUMB_HEIGHT / 2 + i * STACK_STEP}px)`,
              }}
            >
              {item.url && (item.kind === 'video'
                ? <video className="dg-thumb__media" src={item.url} muted playsInline preload="auto" />
                : <img className="dg-thumb__media" src={item.url} alt="" role="presentation" draggable={false} />)}
            </div>
          );
        })}
      </div>
      {label && <div className="dg-label">{label}</div>}
    </div>,
    document.body,
  );
};

/** The composer while a drag is on: one slot, or Start and End frames in Frames mode. */
export const PromptDropZone: React.FC<{ frames: boolean; target: DropTarget | null; count: number }> = ({ frames, target, count }) => {
  const slot = (zone: 'prompt' | 'start' | 'end', text: string) => (
    <div data-drop-zone={zone} className={`dz-slot${target?.kind === zone ? ' is-active' : ''}`}>
      <div className="dz-slot__content">
        <FlowIcon name="add" size={24} weight={300} style={{ color: '#fff' }} />
        <span className="dz-slot__label">{text}</span>
      </div>
    </div>
  );
  return (
    <div className="dz">
      {frames
        ? <>{slot('start', 'Add start frame')}{slot('end', 'Add end frame')}</>
        : slot('prompt', count > 1 ? `Add ${count} references` : 'Add reference')}
    </div>
  );
};
