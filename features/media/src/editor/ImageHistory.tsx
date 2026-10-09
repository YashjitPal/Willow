// The history column of the image editor and the character page — Flow's
// `flow-editor-history-panel` of `flow-editor-history-step-image`s. Every version of the image,
// oldest at the top and pushed down to the bottom of the column; an edit appends its card at the
// bottom the moment it starts. The open version is ringed in white. Under a version made from a
// prompt: its ingredients as 40px chips and its prompt with a Reuse button, and its hotbar adds
// Flag output and Reuse prompt. An upload or a crop shows neither.
import React from 'react';
import { Tooltip } from '@willow/ui/Tooltip';
import type { MediaItem } from '../types';
import { GeneratingLayers, useGenerationProgress } from '../GalleryTile';
import { FlowIcon, type MenuAnchor } from '../scenes/flow-ui';
import { VersionStrip, type VersionAction } from './VersionStrip';

/** Flow's history tiles are 248px wide and at most 192px tall: a square crop is 192 × 192. */
const TILE_WIDTH = 248;
const TILE_MAX_HEIGHT = 192;

const ratioOf = (ratio: string | undefined) => {
  const [w, h] = (ratio || '16:9').split(':').map(Number);
  return w && h ? w / h : 16 / 9;
};

/** Flow's `source === prompt`: the version came from a prompt, not a file. */
const fromPrompt = (item: MediaItem) => !!item.prompt && item.modelId !== 'upload' && item.modelId !== 'external' && item.modelId !== 'crop';

/** The references a version was made with; an edit made before references were kept shows its source. */
const ingredientsOf = (item: MediaItem, itemById: (id: string) => MediaItem | undefined): MediaItem[] => {
  if (!fromPrompt(item)) return [];
  if (item.attachments?.length) {
    return item.attachments.filter((a) => a.url).map((a) => itemById(a.id) ?? { id: a.id, kind: a.kind ?? 'image', status: 'completed', url: a.url, prompt: a.name, modelId: 'upload', modelName: 'Upload', ratio: '16:9', timestamp: 0 });
  }
  const parent = item.historyParentId ? itemById(item.historyParentId) : undefined;
  return parent?.url ? [parent] : [];
};

const HotbarButton: React.FC<{ label: string; icon: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; expanded?: boolean }> = ({ label, icon, onClick, expanded }) => (
  <Tooltip content={label} position="above" className="sb-tooltip">
    <button
      type="button"
      aria-label={label}
      aria-expanded={expanded}
      className="sb-hotbar-btn"
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
    >
      <FlowIcon name={icon} size={18} />
    </button>
  </Tooltip>
);

export interface ImageHistoryActions {
  onSelect: (item: MediaItem) => void;
  onSave: (item: MediaItem) => void;
  onDownload: (item: MediaItem, anchor: MenuAnchor) => void;
  onFlag: (item: MediaItem) => void;
  onReuse: (item: MediaItem) => void;
  onRetry: (item: MediaItem) => void;
  onDelete: (item: MediaItem) => void;
  onAddIngredient: (item: MediaItem) => void;
}

const Pending: React.FC<{ item: MediaItem; onReuse: () => void }> = ({ item, onReuse }) => {
  const progress = useGenerationProgress(item);
  return (
    <div className="ie-pending">
      <GeneratingLayers isRevealing={false}>
        <div className="ie-pending__inner">
          <div className="ie-pending__header">
            <FlowIcon name="image" size={24} />
            <span className="ie-pending__pct">{progress}%</span>
          </div>
          <div className="ie-pending__footer">
            <span className="ie-pending__subtitle">{item.prompt}</span>
            <Tooltip content="Reuse prompt" className="sb-tooltip">
              <button type="button" aria-label="Reuse prompt" className="sb-icon-btn ie-pending__reuse" onClick={(e) => { e.stopPropagation(); onReuse(); }}>
                <FlowIcon name="keyboard_return" size={18} />
              </button>
            </Tooltip>
          </div>
        </div>
      </GeneratingLayers>
    </div>
  );
};

const Failed: React.FC<{ item: MediaItem; onRetry: () => void; onReuse: () => void; onDelete: () => void }> = ({ item, onRetry, onReuse, onDelete }) => (
  <div className="ie-error">
    <div className="ie-error__message">
      <FlowIcon name="warning" size={16} />
      <div className="ie-error__title">Failed</div>
      <div className="ie-error__subtitle">
        <span>{item.error || 'Something went wrong. Please try again.'}</span>
      </div>
    </div>
    <div className="ie-error__buttons">
      <Tooltip content="Retry" className="sb-tooltip">
        <button type="button" aria-label="Retry" className="sb-icon-btn" onClick={(e) => { e.stopPropagation(); onRetry(); }}>
          <FlowIcon name="refresh" size={18} />
        </button>
      </Tooltip>
      <Tooltip content="Reuse prompt" className="sb-tooltip">
        <button type="button" aria-label="Reuse prompt" className="sb-icon-btn" onClick={(e) => { e.stopPropagation(); onReuse(); }}>
          <FlowIcon name="undo" size={18} />
        </button>
      </Tooltip>
      <Tooltip content="Delete" className="sb-tooltip">
        <button type="button" aria-label="Delete" className="sb-icon-btn" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
          <FlowIcon name="delete_forever" size={18} />
        </button>
      </Tooltip>
    </div>
  </div>
);

const Step: React.FC<{
  item: MediaItem;
  itemById: (id: string) => MediaItem | undefined;
  selected: boolean;
  actions: ImageHistoryActions;
  downloadOpen: boolean;
}> = ({ item, itemById, selected, actions, downloadOpen }) => {
  const ar = ratioOf(item.ratio);
  const width = Math.min(TILE_WIDTH, TILE_MAX_HEIGHT * ar);
  const isCrop = item.modelId === 'crop';
  const generated = fromPrompt(item);
  const ingredients = ingredientsOf(item, itemById);
  return (
    <div className="sb-step">
      <div className={`sb-step__tile${selected ? ' is-selected' : ''}`}>
        <div className="sb-step__container" style={{ width, height: width / ar }}>
          {item.status === 'generating' ? (
            <Pending item={item} onReuse={() => actions.onReuse(item)} />
          ) : item.status === 'failed' ? (
            <Failed item={item} onRetry={() => actions.onRetry(item)} onReuse={() => actions.onReuse(item)} onDelete={() => actions.onDelete(item)} />
          ) : (
            <>
              <img className="ie-step__image" src={item.url} alt="" draggable={false} onClick={() => actions.onSelect(item)} />
              <div className="sb-step__hover">
                <div className="sb-hotbar-wrap">
                  <div className="sb-hotbar">
                    <HotbarButton label="Save to projects" icon="library_add" onClick={() => actions.onSave(item)} />
                    <HotbarButton
                      label="Download"
                      icon="download"
                      expanded={downloadOpen}
                      onClick={(e) => actions.onDownload(item, { kind: 'below', rect: e.currentTarget.getBoundingClientRect() })}
                    />
                    {generated && <HotbarButton label="Flag output" icon="flag" onClick={() => actions.onFlag(item)} />}
                    {generated && <HotbarButton label="Reuse prompt" icon="keyboard_return" onClick={() => actions.onReuse(item)} />}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      {ingredients.length > 0 && (
        <div className="ie-ingredients">
          {ingredients.map((ingredient) => (
            <Tooltip key={ingredient.id} content="Add to prompt" className="sb-tooltip">
              <button type="button" aria-label="Ingredient" className="ie-chip" onClick={() => actions.onAddIngredient(ingredient)}>
                <img src={ingredient.url} alt="" draggable={false} />
                <span className="ie-chip__hover"><FlowIcon name="add" size={16} /></span>
              </button>
            </Tooltip>
          ))}
        </div>
      )}
      {isCrop ? (
        <FlowIcon name="crop" size={24} weight={300} className="ie-crop-step" />
      ) : generated ? (
        <div className="sb-prompt-row">
          <div className="sb-prompt-row__text">{item.prompt}</div>
          <div className="sb-prompt-row__actions">
            <Tooltip content="Reuse prompt" className="sb-tooltip">
              <button type="button" aria-label="Reuse prompt" className="sb-icon-btn sb-prompt-row__reuse" onClick={() => actions.onReuse(item)}>
                <FlowIcon name="keyboard_return" size={18} />
              </button>
            </Tooltip>
          </div>
        </div>
      ) : null}
    </div>
  );
};

/** A version's actions as the narrow strip lists them: its hotbar's, then what its card shows. */
const stripActions = (item: MediaItem, itemById: (id: string) => MediaItem | undefined, actions: ImageHistoryActions): VersionAction[] => {
  const generated = fromPrompt(item);
  if (item.status === 'generating') return [{ icon: 'keyboard_return', label: 'Reuse prompt', run: () => actions.onReuse(item) }];
  if (item.status === 'failed') {
    return [
      { icon: 'refresh', label: 'Retry', run: () => actions.onRetry(item) },
      ...(item.prompt ? [{ icon: 'undo', label: 'Reuse prompt', run: () => actions.onReuse(item) }] : []),
      { icon: 'delete_forever', label: 'Delete', danger: true, run: () => actions.onDelete(item) },
    ];
  }
  const ingredients = ingredientsOf(item, itemById);
  return [
    { icon: 'library_add', label: 'Save to projects', run: () => actions.onSave(item) },
    { icon: 'download', label: 'Download', run: (anchor) => actions.onDownload(item, anchor) },
    ...(generated ? [{ icon: 'keyboard_return', label: 'Reuse prompt', run: () => actions.onReuse(item) }] : []),
    ...(ingredients.length
      ? [{ icon: 'add', label: ingredients.length > 1 ? 'Add its ingredients to the prompt' : 'Add its ingredient to the prompt', run: () => ingredients.forEach((i) => actions.onAddIngredient(i)) }]
      : []),
    ...(generated ? [{ icon: 'flag', label: 'Flag output', run: () => actions.onFlag(item) }] : []),
  ];
};

export const ImageHistory: React.FC<{
  steps: MediaItem[];
  selectedId: string | undefined;
  hidden: boolean;
  itemById: (id: string) => MediaItem | undefined;
  downloadFor: string | null;
  actions: ImageHistoryActions;
  /** `strip` below 961px: one row of thumbnails, their actions in a sheet (VersionStrip). */
  layout?: 'column' | 'strip';
}> = ({ steps, selectedId, hidden, itemById, downloadFor, actions, layout = 'column' }) => {
  if (layout === 'strip') {
    return (
      <VersionStrip
        steps={steps}
        selectedId={selectedId}
        hidden={hidden}
        renderThumb={(item) => <img src={item.url} alt="" draggable={false} />}
        actionsFor={(item) => stripActions(item, itemById, actions)}
        onSelect={actions.onSelect}
      />
    );
  }
  return <HistoryColumn steps={steps} selectedId={selectedId} hidden={hidden} itemById={itemById} downloadFor={downloadFor} actions={actions} />;
};

const HistoryColumn: React.FC<{
  steps: MediaItem[];
  selectedId: string | undefined;
  hidden: boolean;
  itemById: (id: string) => MediaItem | undefined;
  downloadFor: string | null;
  actions: ImageHistoryActions;
}> = ({ steps, selectedId, hidden, itemById, downloadFor, actions }) => {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [fades, setFades] = React.useState({ top: false, bottom: false });
  const measure = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setFades({ top: el.scrollTop > 1, bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 1 });
  }, []);
  const last = steps[steps.length - 1]?.id;
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    measure();
  }, [last, measure]);

  return (
    <div className={`ie-history${hidden ? ' is-hidden' : ''}`}>
      <div ref={scrollRef} className="ie-history__scroll" onScroll={measure}>
        <div className="sb-history__content">
          {steps.map((item) => (
            <Step
              key={item.id}
              item={item}
              itemById={itemById}
              selected={item.id === selectedId}
              actions={actions}
              downloadOpen={downloadFor === item.id}
            />
          ))}
        </div>
      </div>
      <div className={`ie-history__fade ie-history__fade--top${fades.top ? ' is-visible' : ''}`} />
      <div className={`ie-history__fade ie-history__fade--bottom${fades.bottom ? ' is-visible' : ''}`} />
    </div>
  );
};
