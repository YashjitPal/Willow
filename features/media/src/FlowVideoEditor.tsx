import React from 'react';
import { Maximize, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX, Plus, ChevronDown, RotateCcw } from 'lucide-react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { MediaVideo } from './GalleryTile';
import type { MediaItem } from './types';

type FlowVideoEditorProps = {
  item: MediaItem;
  promptValue: string;
  onPromptChange: (value: string) => void;
  onGenerate: () => void;
  modelName: string;
};

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00:00';
  const value = Math.floor(seconds);
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = value % 60;
  return [hours, minutes, secs].map(part => String(part).padStart(2, '0')).join(':');
};

/** Flow's video-only viewer surface. Images intentionally stay on MediaView's existing path. */
export const FlowVideoEditor: React.FC<FlowVideoEditorProps> = ({ item, promptValue, onPromptChange, onGenerate, modelName }) => {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = React.useState(true);
  const [muted, setMuted] = React.useState(false);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [promptExpanded, setPromptExpanded] = React.useState(false);
  const [hoveredPrompt, setHoveredPrompt] = React.useState(false);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play();
      setPlaying(true);
    } else {
      video.pause();
      setPlaying(false);
    }
  };

  const seek = (delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + delta));
  };

  const prompt = item.prompt || item.shortenedPrompt || '';
  const promptNeedsExpansion = prompt.length > 95;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden text-white" data-flow-video-editor>
      <div className="flex-1 min-h-0 flex items-center justify-center gap-6 px-8 pt-6 pb-0 overflow-hidden">
        <div className="flex-1 min-w-0 h-full flex flex-col items-center justify-center">
          <div className="w-full max-w-[710px] aspect-video bg-black overflow-hidden rounded-[2px] relative">
            <MediaVideo
              ref={videoRef}
              src={item.url}
              autoPlay
              muted={muted}
              playsInline
              className="w-full h-full object-contain"
              onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
              onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
            />
          </div>

          <div className="w-full max-w-[710px] h-11 mt-4 flex items-center justify-between text-white/80">
            <button type="button" aria-label="Sound" title="Sound" onClick={() => setMuted(value => !value)} className="w-[30px] h-[30px] rounded-full flex items-center justify-center hover:bg-white/10 transition-colors">
              {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
            <span className="text-[12px] tabular-nums text-white/65">{formatTime(currentTime)} / {formatTime(duration)}</span>
            <div className="flex items-center gap-1">
              <button type="button" aria-label="Previous" title="Previous" onClick={() => seek(-5)} className="w-[30px] h-[30px] rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"><SkipBack size={18} /></button>
              <button type="button" aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'pause' : 'play'} onClick={togglePlay} className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors">{playing ? <Pause size={17} /> : <Play size={17} fill="currentColor" />}</button>
              <button type="button" aria-label="Next" title="next" onClick={() => seek(5)} className="w-[30px] h-[30px] rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"><SkipForward size={18} /></button>
            </div>
            <button type="button" aria-label="Fullscreen" title="Fullscreen" onClick={() => videoRef.current?.requestFullscreen?.()} className="w-[30px] h-[30px] rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"><Maximize size={18} /></button>
          </div>

          <div className="w-full max-w-[710px] h-40 mt-6 rounded-[4px] bg-[rgba(22,23,24,0.9)] overflow-hidden px-5 pt-12">
            <div className="relative h-[62px] flex items-center gap-1">
              <div className="absolute left-0 right-0 -top-7 flex justify-between text-[11px] text-white/45 tabular-nums pointer-events-none">
                {['00', '01', '02', '03', '04', '05', '06'].map(label => <span key={label}>{label}</span>)}
              </div>
              <div className="h-[62px] flex-1 rounded-[6px] bg-[#0d0d0d] border border-white/[0.04] relative overflow-hidden">
                <div className="absolute inset-y-0 left-0 w-[28%] bg-white/[0.06]" />
                <div className="absolute inset-y-0 left-[28%] w-px bg-white/80" />
                <div className="absolute inset-y-0 left-[28%] w-1 bg-white/80 rounded-full -translate-x-1/2" />
                <div className="absolute inset-x-2 bottom-2 h-1 rounded-full bg-white/[0.08]">
                  <div className="h-full rounded-full bg-white/70" style={{ width: `${duration ? Math.min(100, (currentTime / duration) * 100) : 0}%` }} />
                </div>
              </div>
              <button type="button" aria-label="Add Clip" title="Add Clip" className="w-7 h-7 rounded-[10px] flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors"><Plus size={18} /></button>
            </div>
          </div>
        </div>

        <aside className="w-[320px] h-full shrink-0 overflow-auto flex flex-col justify-end pb-2" style={{ scrollbarWidth: 'thin' }}>
          <div className="w-[300px] mx-auto rounded-[14px] p-0">
            <div className="w-[248px] aspect-video rounded-[6px] overflow-hidden bg-[#0d0d0d]">
              <MediaVideo src={item.url} muted className="w-full h-full object-cover" />
            </div>
            <div className="mt-3 w-[300px] min-h-[60px] flex gap-1.5 items-start" onMouseEnter={() => setHoveredPrompt(true)} onMouseLeave={() => setHoveredPrompt(false)}>
              <div className={`min-w-0 flex-1 text-[14px] leading-[21px] text-white/85 ${promptExpanded ? '' : 'max-h-[60px] overflow-hidden'}`}>
                {prompt || 'No prompt'}
              </div>
              <div className="w-[18px] shrink-0 flex flex-col items-center gap-1">
                {promptNeedsExpansion && <button type="button" aria-label="Expand prompt" title="Expand prompt" onClick={() => setPromptExpanded(value => !value)} className="w-[18px] h-[18px] p-[3px] rounded-[6px] text-white/70 hover:text-white hover:bg-white/10"><ChevronDown size={12} className={promptExpanded ? 'rotate-180' : ''} /></button>}
                <button type="button" aria-label="Reuse text prompt" title="Reuse text prompt" onClick={() => onPromptChange(prompt)} className={`w-[18px] h-[18px] p-[3px] rounded-[6px] text-white/70 hover:text-white hover:bg-white/10 transition-opacity ${hoveredPrompt ? 'opacity-100' : 'opacity-0'}`}><RotateCcw size={12} /></button>
              </div>
            </div>
          </div>
        </aside>
      </div>
      <div className="shrink-0 h-[108px] pt-4 pb-0 flex justify-center relative z-10">
        <div className="w-[600px] h-[92px] rounded-[24px] bg-[rgba(22,23,24,0.9)] px-[10px] pt-3 pb-2 flex flex-col shadow-2xl" data-flow-video-prompt>
          <textarea
            value={promptValue}
            onChange={(event) => onPromptChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                if (promptValue.trim()) onGenerate();
              }
            }}
            placeholder="Describe your edits"
            rows={1}
            className="min-h-9 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-4 pb-3 pt-1 text-[14px] leading-5 text-white outline-none placeholder-white/35"
          />
          <div className="flex items-center justify-between h-8">
            <button type="button" aria-label="Add" className="w-8 h-8 rounded-full flex items-center justify-center text-white/65 hover:text-white hover:bg-white/10 transition-colors"><Plus size={18} /></button>
            <div className="flex items-center gap-2">
              <span className="px-3.5 h-8 rounded-full bg-[#27282b] flex items-center text-[11px] font-semibold text-[#d0d0d0]">{modelName || 'Omni Flash'}</span>
              <button type="button" aria-label="Create" disabled={!promptValue.trim()} onClick={onGenerate} className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${promptValue.trim() ? 'bg-white text-black hover:bg-zinc-200' : 'bg-[#27282b]/90 text-white/30 cursor-not-allowed'}`}><MaterialSymbol name="arrow_forward" family="google-symbols" size={19} weight={400} variationSettings='"FILL" 1' /></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

