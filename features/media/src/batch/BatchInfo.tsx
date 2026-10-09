// Flow's flow-batch-info: the column beside a batch's tiles. A toolbar (Download batch, Reuse
// prompt, Trash batch), then what the batch is: a collection's name and counts, a scene's name,
// date and clip count, or a generation's prompt, its ingredients and its metadata.
import React from 'react';
import { createPortal } from 'react-dom';
import { Tooltip } from '@willow/ui/Tooltip';
import { FlowIcon } from '../scenes/flow-ui';
import type { MediaKind } from '../types';
import { useVideoStill } from '../video-still';
import { aspectLabel, createdLabel, formatDuration, resolutionLabel } from './batch-layout';
import { useVideoMeta } from './video-meta';

export interface BatchIngredient {
  key: string;
  /** Its file now, when it can still be shown. */
  url?: string;
  kind: MediaKind;
  /** Width over height, for the hover preview until the picture has loaded. */
  aspect: number;
}

export interface BatchInfoModel {
  /** A collection's or a scene's name. */
  label?: string;
  /** A generation's prompt. */
  prompt?: string;
  ingredients: BatchIngredient[];
  created?: number;
  /** A collection's contents, nested ones included. */
  counts?: { images: number; videos: number; songs: number };
  /** A scene's clips. */
  clips?: number;
  model?: string;
  uploaded?: 'image' | 'video';
  /** The batch's first video, read for its resolution and length. */
  videoUrl?: string;
  ratio?: string;
  canReuse: boolean;
  canTrash: boolean;
}

/** Flow's host stops these so a press here starts no marquee or drag and clears no selection. */
const stop = (e: React.SyntheticEvent) => e.stopPropagation();

const ToolbarButton: React.FC<{ label: string; icon: string; onClick: () => void }> = ({ label, icon, onClick }) => (
  <Tooltip content={label} position="above" className="sb-tooltip">
    <button type="button" className="sb-hotbar-btn" aria-label={label} onClick={onClick}>
      <FlowIcon name={icon} size={18} />
    </button>
  </Tooltip>
);

/** flow-expandable-prompt, inline: three lines, then Expand prompt; the reuse button shows on hover. */
const BatchPrompt: React.FC<{ prompt: string; reusable: boolean; onReuse: () => void }> = ({ prompt, reusable, onReuse }) => {
  const textRef = React.useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = React.useState(false);
  const [overflows, setOverflows] = React.useState(false);
  React.useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return undefined;
    const check = () => setOverflows(el.scrollHeight > el.clientHeight);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [prompt]);
  React.useEffect(() => {
    if (!expanded && textRef.current) textRef.current.scrollTop = 0;
  }, [expanded]);
  const toggle = expanded ? 'Collapse prompt' : 'Expand prompt';
  return (
    <div className="bv-prompt">
      <div className={`bv-prompt__container${expanded ? ' is-expanded' : ''}`}>
        <div ref={textRef} className={`bv-prompt__text${expanded ? ' is-expanded' : ''}`}>
          <span>{prompt}</span>
        </div>
        <div className="bv-prompt__actions">
          {reusable && (
            <Tooltip content="Reuse prompt" className="sb-tooltip">
              <button type="button" className="sb-icon-btn bv-prompt__reuse" aria-label="Reuse prompt" onClick={(e) => { e.stopPropagation(); onReuse(); }}>
                <FlowIcon name="keyboard_return" size={18} />
              </button>
            </Tooltip>
          )}
          {(overflows || expanded) && (
            <Tooltip content={toggle} className="sb-tooltip">
              <button type="button" className="sb-icon-btn" aria-label={toggle} onClick={(e) => { e.stopPropagation(); setExpanded((x) => !x); }}>
                <FlowIcon name={expanded ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} size={18} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
};

const PREVIEW_HEIGHT = 200;

/** The card an ingredient chip opens above itself: centred on the chip, kept on screen. */
const ChipPreview: React.FC<{ anchor: DOMRect; url: string; aspect: number }> = ({ anchor, url, aspect: initial }) => {
  const [aspect, setAspect] = React.useState(initial);
  const width = PREVIEW_HEIGHT * aspect + 8;
  const left = Math.min(Math.max(0, anchor.left + anchor.width / 2 - width / 2), window.innerWidth - width);
  return createPortal(
    <div className="bv-chip-preview" style={{ left, bottom: window.innerHeight - anchor.top + 10 }}>
      <div className="bv-chip-preview__image" style={{ width: PREVIEW_HEIGHT * aspect, height: PREVIEW_HEIGHT }}>
        <img
          src={url}
          alt=""
          role="presentation"
          draggable={false}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth && img.naturalHeight) setAspect(img.naturalWidth / img.naturalHeight);
          }}
        />
      </div>
    </div>,
    document.body,
  );
};

/** flow-image-ingredient-chip: the picture, a scrim with "add" on hover, and its preview card. */
const IngredientChip: React.FC<{ ingredient: BatchIngredient; onClick: () => void }> = ({ ingredient, onClick }) => {
  const ref = React.useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = React.useState<DOMRect | null>(null);
  const [broken, setBroken] = React.useState(false);
  const hideTimer = React.useRef<number | null>(null);
  const still = useVideoStill(ingredient.kind === 'video' ? ingredient.url : undefined);
  const picture = broken ? undefined : ingredient.kind === 'video' ? still || undefined : ingredient.kind === 'image' ? ingredient.url : undefined;
  React.useEffect(() => setBroken(false), [ingredient.url]);
  React.useEffect(() => () => { if (hideTimer.current) window.clearTimeout(hideTimer.current); }, []);
  const enter = () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
    if (ref.current) setAnchor(ref.current.getBoundingClientRect());
  };
  const leave = () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => { setAnchor(null); hideTimer.current = null; }, 200);
  };
  return (
    <>
      <button ref={ref} type="button" className="bv-chip" aria-label="Ingredient" onClick={onClick} onMouseEnter={enter} onMouseLeave={leave}>
        <div className="bv-chip__image">
          {picture
            ? <img className="bv-chip__img" src={picture} alt="" draggable={false} onError={() => setBroken(true)} />
            : <div className="bv-chip__placeholder" />}
        </div>
        <div className="bv-chip__scrim">
          <FlowIcon name="add" size={16} className="bv-chip__icon" />
        </div>
      </button>
      {anchor && picture && <ChipPreview anchor={anchor} url={picture} aspect={ingredient.aspect} />}
    </>
  );
};

const VideoFacts: React.FC<{ url: string; children: (facts: { resolution?: string; duration?: string }) => React.ReactNode }> = ({ url, children }) => {
  const meta = useVideoMeta(url);
  return <>{children({
    resolution: meta ? resolutionLabel(meta.width, meta.height) : undefined,
    duration: meta && Number.isFinite(meta.duration) ? formatDuration(meta.duration) : undefined,
  })}</>;
};

/** The model (or "Uploaded image"), a video's resolution and length, then the aspect ratio. */
const MediaFacts: React.FC<{ model: BatchInfoModel; resolution?: string; duration?: string }> = ({ model, resolution, duration }) => {
  const source = model.model ?? (model.uploaded === 'image' ? 'Uploaded image' : model.uploaded === 'video' ? 'Uploaded video' : undefined);
  const aspect = model.ratio ? aspectLabel(model.ratio) : undefined;
  if (!source && !resolution && !duration && !aspect) return null;
  return (
    <div className="bv-meta__row">
      {source && <span>{source}</span>}
      {source && resolution && <span aria-hidden="true">•</span>}
      {resolution && <span>{resolution}</span>}
      {(source || resolution) && duration && <span aria-hidden="true">•</span>}
      {duration && <span>{duration}</span>}
      {aspect && (
        <>
          <FlowIcon name={aspect.icon} size={14} className="bv-meta__icon" />
          <span>{aspect.label}</span>
        </>
      )}
    </div>
  );
};

export const BatchInfo: React.FC<{
  model: BatchInfoModel;
  onDownload: () => void;
  onReuse: () => void;
  onTrash: () => void;
  onIngredient: (index: number) => void;
}> = ({ model, onDownload, onReuse, onTrash, onIngredient }) => (
  <div className="bv-info" onMouseDown={stop} onPointerDown={stop} onContextMenu={stop}>
    <div className="bv-toolbar">
      <ToolbarButton label="Download batch" icon="download" onClick={onDownload} />
      {model.canReuse && <ToolbarButton label="Reuse prompt" icon="undo" onClick={onReuse} />}
      {model.canTrash && <ToolbarButton label="Trash batch" icon="delete" onClick={onTrash} />}
    </div>
    <div className="bv-below">
      {model.label && <div className="bv-label">{model.label}</div>}
      {model.prompt && <BatchPrompt prompt={model.prompt} reusable={model.canReuse} onReuse={onReuse} />}
      {model.counts ? (
        <div className="bv-counts">
          <div className="bv-count">
            <FlowIcon name="image" size={16} className="bv-count__icon" />
            <span aria-label="Number of images in the collection">{model.counts.images}</span>
          </div>
          <div className="bv-count">
            <FlowIcon name="videocam" size={16} className="bv-count__icon" />
            <span aria-label="Number of videos in the collection">{model.counts.videos}</span>
          </div>
          {model.counts.songs > 0 && (
            <div className="bv-count">
              <FlowIcon name="music_note" size={16} className="bv-count__icon" />
              <span aria-label="Number of songs in the collection">{model.counts.songs}</span>
            </div>
          )}
        </div>
      ) : model.clips !== undefined ? (
        <div className="bv-meta">
          {model.created !== undefined && <div className="bv-meta__row">{createdLabel(model.created)}</div>}
          <div className="bv-meta__row">
            <FlowIcon name="play_circle" size={16} className="bv-count__icon" />
            <span aria-label="Number of clips in the scene">{model.clips}</span>
          </div>
        </div>
      ) : (
        <>
          {model.ingredients.length > 0 && (
            <div className="bv-chips">
              {model.ingredients.map((ingredient, i) => (
                <IngredientChip key={ingredient.key} ingredient={ingredient} onClick={() => onIngredient(i)} />
              ))}
            </div>
          )}
          <div className="bv-meta">
            {model.created !== undefined && <div className="bv-meta__row">{createdLabel(model.created)}</div>}
            {model.videoUrl
              ? <VideoFacts url={model.videoUrl}>{(facts) => <MediaFacts model={model} {...facts} />}</VideoFacts>
              : <MediaFacts model={model} />}
          </div>
        </>
      )}
    </div>
  </div>
);
