// The Scenebuilder's history sidebar — Flow's `flow-editor-history-panel`: every version of the
// selected clip's video, oldest at the top and pushed down against the timeline, the current one
// ringed in white. Each step is a video tile with a hover hotbar, then its prompt.
import React from 'react';
import { Tooltip } from '@willow/ui/Tooltip';
import type { MediaItem } from '../types';
import { GeneratingLayers, useGenerationProgress } from '../GalleryTile';
import { FlowIcon } from './flow-ui';
import { useFrames } from './scene-host';
import { usePlayableUrl } from './scene-media-url';
import { VersionStrip, type VersionAction } from '../editor/VersionStrip';

const TILE_WIDTH = 248;

const ratioOf = (ratio: string | undefined) => {
  const [w, h] = (ratio || '16:9').split(':').map(Number);
  return w && h ? w / h : 16 / 9;
};

const HotbarButton: React.FC<{ label: string; icon: string; onClick: () => void }> = ({ label, icon, onClick }) => (
  <Tooltip content={label} position="above" className="sb-tooltip">
    <button type="button" aria-label={label} className="sb-hotbar-btn" onClick={(e) => { e.stopPropagation(); onClick(); }}>
      <FlowIcon name={icon} size={18} />
    </button>
  </Tooltip>
);

const StepTile: React.FC<{
  item: MediaItem;
  selected: boolean;
  onSelect: () => void;
  onSave: () => void;
  onDownload: () => void;
  onReuse: () => void;
  onFlag: () => void;
}> = ({ item, selected, onSelect, onSave, onDownload, onReuse, onFlag }) => {
  const [hover, setHover] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const generating = item.status === 'generating';
  const [poster] = useFrames(item.status === 'completed' ? item.url : undefined, React.useMemo(() => [0], []), 496);
  const playable = usePlayableUrl(hover && item.status === 'completed' ? item.url : undefined);
  const genProgress = useGenerationProgress(item);
  const height = Math.min(330, TILE_WIDTH / ratioOf(item.ratio));

  return (
    <div className={`sb-step__tile${selected ? ' is-selected' : ''}`} onClick={() => { if (!generating) onSelect(); }}>
      <div
        className="sb-step__container"
        style={{ width: TILE_WIDTH, height }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => { setHover(false); setProgress(0); }}
      >
        {generating ? (
          <GeneratingLayers isRevealing={false}>
            <div className="absolute inset-0 z-30 pointer-events-none">
              <div className="sb-step__type"><FlowIcon name="play_circle" size={22} /></div>
              <span className="sb-canvas-pct">{genProgress}%</span>
            </div>
          </GeneratingLayers>
        ) : item.status === 'failed' ? (
          <div className="absolute inset-0 flex flex-col items-start gap-1 p-3 bg-gradient-to-b from-[#232323] to-[#171717] text-left">
            <span className="text-[12px] font-semibold text-zinc-200 leading-none">Failed</span>
            <span className="text-[11.5px] text-zinc-300 leading-relaxed line-clamp-4">{item.error || 'This edit could not be generated.'}</span>
          </div>
        ) : (
          <>
            {poster && <img className="sb-step__thumb" src={poster} alt="" draggable={false} />}
            {playable && (
              <video
                className="sb-step__thumb"
                style={{ position: 'absolute', inset: 0 }}
                src={playable}
                autoPlay
                muted
                loop
                playsInline
                onTimeUpdate={(e) => {
                  const v = e.currentTarget;
                  if (v.duration) setProgress(v.currentTime / v.duration);
                }}
              />
            )}
            <div className="sb-step__hover">
              <div className="sb-hotbar-wrap">
                <div className="sb-hotbar">
                  <HotbarButton label="Save to projects" icon="library_add" onClick={onSave} />
                  <HotbarButton label="Download" icon="download" onClick={onDownload} />
                  {/* A generation can be flagged and its prompt reused; an upload has neither. */}
                  {item.modelId !== 'upload' && <HotbarButton label="Flag output" icon="flag" onClick={onFlag} />}
                  {item.modelId !== 'upload' && <HotbarButton label="Reuse prompt" icon="keyboard_return" onClick={onReuse} />}
                </div>
              </div>
            </div>
            <div className="sb-step__progress">
              <div className="sb-step__track"><div className="sb-step__fill" style={{ width: `${progress * 100}%` }} /></div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

/** A video version's first frame, for the narrow strip. */
const StripThumb: React.FC<{ item: MediaItem }> = ({ item }) => {
  const [poster] = useFrames(item.url, React.useMemo(() => [0], []), 192);
  return poster ? <img src={poster} alt="" draggable={false} /> : null;
};

type SceneHistoryProps = {
  steps: MediaItem[];
  selectedId: string | undefined;
  hidden: boolean;
  animatingOut: boolean;
  itemById: (id: string) => MediaItem | undefined;
  onSelect: (item: MediaItem) => void;
  onReuse: (prompt: string) => void;
  onSave: (item: MediaItem) => void;
  onDownload: (item: MediaItem) => void;
  onFlag: (item: MediaItem) => void;
  /** `strip` below 961px: one row of first frames, their actions in a sheet (VersionStrip). */
  layout?: 'column' | 'strip';
};

export const SceneHistory: React.FC<SceneHistoryProps> = ({ layout = 'column', ...props }) => {
  if (layout !== 'strip') return <HistoryColumn {...props} />;
  const { steps, selectedId, hidden, onSelect, onReuse, onSave, onDownload, onFlag } = props;
  const actionsFor = (item: MediaItem): VersionAction[] => {
    const generated = item.modelId !== 'upload';
    const reuse: VersionAction[] = generated && item.prompt ? [{ icon: 'keyboard_return', label: 'Reuse prompt', run: () => onReuse(item.prompt) }] : [];
    if (item.status !== 'completed') return reuse;
    return [
      { icon: 'library_add', label: 'Save to projects', run: () => onSave(item) },
      { icon: 'download', label: 'Download', run: () => onDownload(item) },
      ...reuse,
      ...(generated ? [{ icon: 'flag', label: 'Flag output', run: () => onFlag(item) }] : []),
    ];
  };
  return (
    <VersionStrip
      steps={steps}
      selectedId={selectedId}
      hidden={hidden}
      renderThumb={(item) => <StripThumb item={item} />}
      actionsFor={actionsFor}
      onSelect={onSelect}
    />
  );
};

const HistoryColumn: React.FC<Omit<SceneHistoryProps, 'layout'>> = ({ steps, selectedId, hidden, animatingOut, itemById, onSelect, onReuse, onSave, onDownload, onFlag }) => {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const last = steps[steps.length - 1]?.id;
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [last]);

  return (
    <div className={`sb-history${hidden ? ' is-hidden' : ''}${animatingOut ? ' is-animating-out' : ''}`}>
      <div ref={scrollRef} className="sb-history__scroll">
        <div className="sb-history__content">
          {steps.map((item) => {
            const parent = item.historyParentId ? itemById(item.historyParentId) : undefined;
            return (
              <div key={item.id} className="sb-step">
                <StepTile
                  item={item}
                  selected={item.id === selectedId}
                  onSelect={() => onSelect(item)}
                  onSave={() => onSave(item)}
                  onDownload={() => onDownload(item)}
                  onReuse={() => onReuse(item.prompt)}
                  onFlag={() => onFlag(item)}
                />
                <div className="sb-step__desc">
                  {parent && <ParentChip item={parent} />}
                  <div className="sb-prompt-row">
                    <div className="sb-prompt-row__text">{item.prompt}</div>
                    <div className="sb-prompt-row__actions">
                      <Tooltip content="Reuse prompt" className="sb-tooltip">
                        <button type="button" aria-label="Reuse prompt" className="sb-icon-btn sb-prompt-row__reuse" onClick={() => onReuse(item.prompt)}>
                          <FlowIcon name="keyboard_return" size={18} />
                        </button>
                      </Tooltip>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/** The video an edit was made from, as Flow's 32px ingredient chip. */
const ParentChip: React.FC<{ item: MediaItem }> = ({ item }) => {
  const [frame] = useFrames(item.status === 'completed' ? item.url : undefined, React.useMemo(() => [0], []), 64);
  return (
    <div className="sb-step__chip">
      {frame && <img src={frame} alt="" />}
      <span className="sb-step__chip-badge"><FlowIcon name="videocam" size={12} /></span>
    </div>
  );
};
