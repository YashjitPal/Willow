import React from 'react';
import { MediaVideo } from './GalleryTile';
import type { MediaItem } from './types';

type FlowVideoEditorProps = {
  item: MediaItem;
  promptValue: string;
  onPromptChange: (value: string) => void;
  onGenerate: () => void;
  modelName: string;
};

const flowIcon = (name: string, size = 20) => (
  <span
    aria-hidden="true"
    className="flow-google-symbols inline-flex shrink-0 select-none items-center justify-center overflow-hidden align-middle"
    style={{ width: size, height: size, fontSize: size, lineHeight: `${size}px`, fontVariationSettings: `"FILL" ${name === 'play_arrow' || name === 'add_photo_alternate' || name === 'add_2' ? 1 : 0}, "wght" 300` }}
  >{name}</span>
);

const formatTime = (seconds: number) => {
  const value = Number.isFinite(seconds) && seconds >= 0 ? Math.floor(seconds) : 0;
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = value % 60;
  return [hours, minutes, secs].map(part => String(part).padStart(2, '0')).join(':');
};

const controlButton = 'flex items-center justify-center w-[30px] h-[30px] rounded-[10px] p-[6px] text-white transition-colors hover:bg-white/[0.08]';

const TimelineFrame: React.FC<{ src?: string; fraction: number }> = ({ src, fraction }) => {
  const [frame, setFrame] = React.useState<string>();
  const ref = React.useRef<HTMLVideoElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  return (
    <>
      <MediaVideo
        ref={ref}
        src={src}
        muted
        preload="auto"
        className={frame ? 'absolute inset-0 block w-full h-full object-cover opacity-0 pointer-events-none' : 'absolute inset-0 block w-full h-full object-cover pointer-events-none'}
        onLoadedMetadata={event => {
          const video = event.currentTarget;
          video.currentTime = Math.max(0, Math.min(video.duration || 0, video.duration * fraction));
        }}
        onSeeked={event => {
          const video = event.currentTarget;
          const canvas = canvasRef.current;
          if (!canvas || !video.videoWidth || !video.videoHeight) return;
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const context = canvas.getContext('2d');
          if (!context) return;
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          setFrame(canvas.toDataURL('image/jpeg', 0.84));
        }}
      />
      <canvas ref={canvasRef} className="hidden" />
      {frame && <img src={frame} alt="" className="block w-full h-full object-cover" />}
    </>
  );
};

const HistoryFrame: React.FC<{ src?: string }> = ({ src }) => {
  const [frame, setFrame] = React.useState<string>();
  const ref = React.useRef<HTMLVideoElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  return (
    <>
      <MediaVideo
        ref={ref}
        src={src}
        muted
        preload="auto"
        className={frame ? 'absolute inset-0 block w-full h-full object-cover opacity-0 pointer-events-none' : 'absolute inset-0 block w-full h-full object-cover'}
        onLoadedMetadata={event => {
          const video = event.currentTarget;
          video.currentTime = 0;
        }}
        onSeeked={event => {
          const video = event.currentTarget;
          const canvas = canvasRef.current;
          if (!canvas || !video.videoWidth || !video.videoHeight) return;
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const context = canvas.getContext('2d');
          if (!context) return;
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          setFrame(canvas.toDataURL('image/jpeg', 0.84));
        }}
      />
      <canvas ref={canvasRef} className="hidden" />
      {frame && <img src={frame} alt="" className="block w-full h-full object-cover" />}
    </>
  );
};

/** Video-only editor matching Flow's measured fullscreen hierarchy. */
export const FlowVideoEditor: React.FC<FlowVideoEditorProps> = ({
  item,
  promptValue,
  onPromptChange,
  onGenerate,
  modelName,
}) => {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = React.useState(true);
  const [muted, setMuted] = React.useState(false);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [expandedPrompt, setExpandedPrompt] = React.useState(false);
  const [promptHovered, setPromptHovered] = React.useState(false);
  const [timelineScale, setTimelineScale] = React.useState(1);

  const sourcePrompt = item.prompt || item.shortenedPrompt || '';
  const truncated = sourcePrompt.length > 175;
  const effectiveModelName = modelName && modelName !== 'External Source' ? modelName : 'Omni Flash';
  const timelineLabelCount = Math.max(7, Math.ceil(duration) + 2);
  const timelineContentWidth = 21 + Math.max(0, timelineLabelCount - 1) * 100;

  const seek = (delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + delta));
  };

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  };

  return (
    <div className="relative flex-1 min-h-0 overflow-hidden bg-black text-white flex flex-col" data-flow-video-editor>
      <style>{`@font-face{font-family:"Flow Google Symbols";font-style:normal;font-weight:100 700;font-display:block;src:url("https://fonts.gstatic.com/s/googlesymbols/v454/HhzMU5Ak9u-oMExPeInvcuEmPosC9zyteYEFU68cPrjdKM1XLPTxlGmzczpgWvF1d8Yp7AudBnt3CPar1JFWjoLAUv3G-tSNljixIIGUsC62cYrKiAk.ttf") format("truetype");}.flow-google-symbols{font-family:"Flow Google Symbols";font-style:normal;font-weight:normal;letter-spacing:0;text-transform:none;white-space:nowrap;word-wrap:normal;direction:ltr;-webkit-font-feature-settings:"liga";-webkit-font-smoothing:antialiased;font-feature-settings:"liga";}.flow-video-prompt-card{backdrop-filter:blur(80px);box-sizing:border-box;}.flow-video-prompt-card::after{content:"";position:absolute;inset:0;box-shadow:rgba(218,220,224,.1) 0 0 0 1px inset;border-radius:inherit;pointer-events:none;z-index:1}.flow-video-prompt-card:focus-within{box-shadow:rgba(0,0,0,.4) 0 16px 32px -8px;backdrop-filter:blur(80px)}.flow-video-prompt-card:focus-within::after{box-shadow:rgba(218,220,224,.15) 0 0 0 1px inset}.flow-video-prompt-input-shell{position:relative;display:block;width:100%;height:20px;overflow:hidden;color:#fff;font:400 14px/20px "Google Sans Text",sans-serif}.flow-video-prompt-input{position:absolute;inset:0;display:block;box-sizing:border-box;width:100%;height:100%;resize:none;overflow:hidden;border:0;background:transparent;padding:0 8px;outline:0;color:#fff;caret-color:#fff;font:400 14px/20px "Google Sans Text",sans-serif}.flow-video-prompt-placeholder{position:absolute;inset:0;display:block;overflow:visible;padding:0 8px;color:rgba(255,255,255,.333);font:400 14px/20px "Google Sans Text",sans-serif}.flow-history-scroll{display:flex;flex-direction:column-reverse;gap:24px;align-items:center;width:100%;height:100%;padding:8px;overflow-y:scroll;overflow-x:hidden;scrollbar-width:thin}.flow-history-scroll:focus{outline:none}.flow-history-scroll::-webkit-scrollbar{width:4px}.flow-history-scroll::-webkit-scrollbar-thumb{background:#3c4043;border-radius:8px;border:4px solid transparent}.flow-history-item{display:flex;flex-direction:column;gap:12px;justify-content:center;align-items:flex-start;width:100%;cursor:pointer}.flow-history-preview{max-height:200px;overflow:hidden;border-radius:17px;outline:2px solid #fff;aspect-ratio:16/9;width:248px;height:auto}.flow-history-prompt-row{display:flex;gap:2px;border-radius:0;background:transparent;padding:0;position:relative;overflow:hidden;width:100%;height:60px}.flow-history-prompt-text{flex:1 1 0%;overflow:auto hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;white-space:pre-wrap;word-break:break-word;padding:6px 36px 0 0;margin-bottom:6px;margin-right:2.5px;font-family:"Google Sans Text",sans-serif;font-size:12px;font-weight:400;line-height:16px}.flow-history-actions{display:flex;flex-direction:column;justify-content:space-between;position:absolute;right:6px;top:5.2px;bottom:4px}.flow-history-actions button{width:18px;height:18px;padding:6px;border-radius:6px}.flow-history-reuse{opacity:0;transition:opacity .15s;transform:rotate(180deg)}.flow-history-prompt-row:hover .flow-history-reuse{opacity:1}.flow-history-fade{position:absolute;left:4px;right:4px;height:1px;z-index:2;pointer-events:none;background:linear-gradient(to top,transparent,#0d0d0d)}.flow-history-fade::before,.flow-history-fade::after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(#000,transparent 50%)}`}</style>
      <div className="flex-1 min-h-0 py-4 flex relative" data-flow-video-stage>
        <div className="w-12 shrink-0 relative">
          <button type="button" aria-label="16:9" className="absolute top-[173.6px] left-2 w-8 h-8 rounded-full p-[6px] flex flex-col items-center justify-center text-white hover:bg-white/[0.08] transition-colors">
            {flowIcon('crop_landscape', 20)}
            <span className="absolute top-[36px] text-[11px] leading-4 font-medium text-white/75">16:9</span>
          </button>
        </div>

        <div className="min-w-0 flex-1 h-full flex relative overflow-hidden">
          <div className="flex-1 min-w-0 pr-5 flex items-center justify-center relative">
            <div className="relative h-full max-w-full aspect-video overflow-hidden rounded-[10px] bg-black" data-flow-video-frame>
              <MediaVideo
                ref={videoRef}
                src={item.url}
                autoPlay
                muted={muted}
                playsInline
                className="block w-full h-full object-cover"
                onLoadedMetadata={event => setDuration(event.currentTarget.duration || 0)}
                onTimeUpdate={event => setCurrentTime(event.currentTarget.currentTime)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
              />
              <button type="button" aria-label="Save Frame" title="Save Frame" className="absolute right-3 top-3 w-7 h-7 rounded-[10px] p-2 flex items-center justify-center bg-black/50 text-white hover:bg-black/70 transition-colors">{flowIcon('add_photo_alternate', 16)}</button>
            </div>
          </div>

          <aside className="w-[320px] shrink-0 h-full relative flex flex-col items-center justify-center overflow-hidden transition-[width] duration-200" data-flow-history-rail>
            <div className="flow-history-scroll absolute inset-0" data-flow-history-scroll tabIndex={0}>
              <div className="flow-history-fade top-0" aria-hidden="true" />
              <div className="flow-history-item shrink-0" data-flow-history-step>
                <div className="flow-history-preview relative">
                  <HistoryFrame src={item.url} />
                </div>
                <div className={`flow-history-prompt-row ${expandedPrompt ? 'h-auto overflow-visible' : ''}`} onMouseEnter={() => setPromptHovered(true)} onMouseLeave={() => setPromptHovered(false)}>
                  <div
                    className="flow-history-prompt-text"
                    data-flow-history-prompt
                    style={expandedPrompt ? { overflowY: 'auto', WebkitLineClamp: 'unset', paddingBottom: '6px', marginBottom: 0 } : undefined}
                  >{sourcePrompt || 'No prompt'}</div>
                  <div className="flow-history-actions">
                    <button type="button" aria-label="Reuse text prompt" title="Reuse text prompt" onClick={() => onPromptChange(sourcePrompt)} className={`flow-history-reuse flex items-center justify-center text-white ${promptHovered ? 'opacity-100' : ''}`}>{flowIcon('redo', 13)}</button>
                    {truncated && <button type="button" aria-label={expandedPrompt ? 'Collapse prompt' : 'Expand prompt'} title={expandedPrompt ? 'Collapse prompt' : 'Expand prompt'} onClick={() => setExpandedPrompt(value => !value)} className="flex items-center justify-center text-white hover:bg-white/[0.08] transition-colors">{flowIcon(expandedPrompt ? 'keyboard_arrow_up' : 'keyboard_arrow_down', 13)}</button>}
                  </div>
                </div>
              </div>
              <div className="flow-history-fade bottom-0" aria-hidden="true" />
            </div>
          </aside>
        </div>
      </div>

      <div className="shrink-0 h-11 flex items-center pr-[320px]" data-flow-playback-controls>
        <div className="w-12 shrink-0" />
        <div className="flex-1 min-w-0 h-11 pr-5 flex items-center justify-center relative">
          <div className="relative left-2.5 w-[710px] max-w-full h-11">
            <button type="button" aria-label="Sound" title="Sound" onClick={() => setMuted(value => !value)} className={`${controlButton} absolute left-[197px] top-[7px]`}>{flowIcon(muted ? 'volume_off' : 'volume_up', 18)}</button>
            <span className="absolute left-[243px] top-[10px] text-[14px] leading-5 font-medium text-white tabular-nums pointer-events-none">{formatTime(currentTime)}</span>
            <button type="button" aria-label="Previous" title="Previous" onClick={() => seek(-5)} className={`${controlButton} absolute left-[318px] top-[7px]`}>{flowIcon('skip_previous', 18)}</button>
            <button type="button" aria-label={playing ? 'pause' : 'play'} title={playing ? 'pause' : 'play'} onClick={togglePlayback} className="absolute left-[357px] top-[10px] w-6 h-6 flex items-center justify-center rounded-full text-white hover:bg-white/[0.08] transition-colors">{flowIcon(playing ? 'pause' : 'play_arrow', 22)}</button>
            <button type="button" aria-label="next" title="next" onClick={() => seek(5)} className={`${controlButton} absolute left-[390px] top-[7px]`}>{flowIcon('skip_next', 18)}</button>
            <span className="absolute left-[436px] top-[10px] text-[14px] leading-5 font-medium text-white/35 tabular-nums">{formatTime(duration)}</span>
            <button type="button" aria-label="Fullscreen" title="Fullscreen" onClick={() => videoRef.current?.requestFullscreen?.()} className={`${controlButton} absolute left-[502px] top-[7px]`}>{flowIcon('fullscreen', 18)}</button>
          </div>
        </div>
      </div>

      <div className="shrink-0 h-7" />

      <div
        className="shrink-0 h-40 relative bg-[rgba(22,23,24,0.9)] overflow-auto text-white/60"
        data-flow-timeline
        style={{
          boxShadow: 'rgba(218, 220, 224, 0.1) -1px 0 0 1px inset',
          fontFamily: '"Google Sans Text", sans-serif',
        }}
      >
        <div
          className="relative flex h-40 text-[16px] leading-6 font-normal text-white/60 tabular-nums"
          style={{ width: '100%', minWidth: `${timelineContentWidth}px`, fontFamily: '"Google Sans Text", sans-serif' }}
        >
          {Array.from({ length: timelineLabelCount }, (_, index) => String(index).padStart(2, '0')).map((label, index) => (
            <div
              key={label}
              className="shrink-0 h-40 flex items-start justify-end"
              style={{
                width: index === 0 ? 21 : 100,
                flex: '0 0 auto',
                padding: '2px 4px',
                boxShadow: 'rgba(218, 220, 224, 0.1) -1px 0 0 0 inset',
              }}
            >
              <span
                className="block"
                style={{
                  color: 'rgba(255, 255, 255, 0.25)',
                  fontFamily: '"Google Sans Text", sans-serif',
                  fontSize: 11,
                  fontWeight: 500,
                  lineHeight: '16px',
                }}
              >
                {label}
              </span>
            </div>
          ))}
        <div className="absolute left-[21px] right-0 top-[49px] flex h-[62px] items-center z-[2]" data-flow-track-row>
          <div className="relative z-[3] h-[62px] w-[401px] rounded-[6px] bg-[#0d0d0d] overflow-visible" data-flow-track>
            <div className="absolute inset-0 rounded-[6px] overflow-hidden flex">{[0, 1, 2, 3].map(index => <div key={index} className="h-full flex-1 overflow-hidden"><TimelineFrame src={item.url} fraction={index / 4} /></div>)}</div>
            <div
              className="absolute inset-0 rounded-[6px] pointer-events-none z-[5]"
              style={{ boxShadow: 'rgb(255, 255, 255) 0 0 0 2px inset' }}
              data-flow-track-outline
              aria-hidden="true"
            />
            <div className="absolute left-0 top-0 flex w-4 h-full pointer-events-none" aria-hidden="true">
              <div className="absolute left-0 top-0 w-3 h-[58px] translate-y-0.5 bg-white rounded-l-[6px]" />
              <div className="absolute left-[4.5px] top-[31px] w-[1.5px] h-7 -translate-x-[0.75px] -translate-y-1/2 rounded-[1px] bg-[rgba(22,23,24,0.15)]" />
            </div>
            <div className="absolute right-0 top-0 flex w-4 h-full pointer-events-none" aria-hidden="true">
              <div className="absolute left-1 top-0 w-3 h-[58px] translate-y-0.5 bg-white rounded-r-[6px]" />
              <div className="absolute left-[10.75px] top-[31px] w-[1.5px] h-7 -translate-x-[0.75px] -translate-y-1/2 rounded-[1px] bg-[rgba(22,23,24,0.15)]" />
            </div>
          </div>
          <button
            type="button"
            aria-label="Add Clip"
            title="Add Clip"
            className="absolute left-[406px] top-[17px] z-[10] w-7 h-7 rounded-[10px] bg-white text-[#303030] flex items-center justify-center transition-shadow hover:shadow-[0_0_0_4px_rgba(255,255,255,0.12)]"
            style={{ boxShadow: 'rgba(0, 0, 0, 0.5) 0 12px 16px -8px' }}
          >
            {flowIcon('add', 20)}
          </button>
        </div>
        <div
          data-playhead="true"
          className="absolute top-0 bottom-0 w-1 -translate-x-1/2 pointer-events-none z-[8] flex flex-col items-center"
          style={{ left: `${21 + (duration ? Math.min(1, Math.max(0, currentTime / duration)) * 401 : 0)}px` }}
        >
          <svg width="17" height="160" viewBox="0 0 17 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="block overflow-hidden shrink-0 text-[#f1f3f4]" aria-hidden="true">
            <path d="M 0 0 L 17 0 C 13.5 2 9.5 5 9.5 23 C 8.3 23 7.83 23 7.5 23 C 7.5 5 4 2.2 0 0 Z" fill="currentColor" />
            <rect x="7.5" y="23" width="2" height="137" fill="currentColor" />
          </svg>
        </div>
        </div>
        <div className="absolute right-2 top-[-28px] flex gap-1"><button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => setTimelineScale(value => Math.max(0.75, value - 0.1))} className="w-7 h-7 rounded-full p-[6px] text-white/60 hover:text-white transition-colors">{flowIcon('zoom_out', 16)}</button><button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => setTimelineScale(value => Math.min(2, value + 0.1))} className="w-7 h-7 rounded-full p-[6px] text-white/60 hover:text-white transition-colors" style={{ transform: `scale(${timelineScale})` }}>{flowIcon('zoom_in', 16)}</button></div>
      </div>

      <div className="shrink-0 h-[108px] pt-4 flex justify-center" data-flow-prompt-band>
        <div className="flow-video-prompt-card relative z-[1] w-full max-w-[600px] h-[92px] max-h-[min(28.75rem,65vh)] rounded-[24px] flex flex-col gap-1 bg-[rgba(22,23,24,0.9)] p-[12px_8px_8px_10px] overflow-hidden" data-flow-prompt-card>
          <div className="relative z-[3] flex-1 min-h-[27px] overflow-auto pt-1 pb-3 pr-4 text-[16px] leading-6 font-normal text-white">
            <div
              role="textbox"
              aria-label="Describe your edits"
              className="flow-video-prompt-input-shell"
            >
              <textarea
                value={promptValue}
                onChange={event => onPromptChange(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (promptValue.trim()) onGenerate(); } }}
                rows={1}
                aria-label="Describe your edits"
                className="flow-video-prompt-input"
              />
              {!promptValue && <p className="flow-video-prompt-placeholder pointer-events-none m-0">Describe your edits</p>}
            </div>
          </div>
          <div className="h-8 flex items-center justify-between"><button type="button" aria-label="Create" title="Create" className="w-8 h-8 rounded-full p-[6px] flex items-center justify-center text-white/75 hover:bg-white/[0.08] transition-colors">{flowIcon('add_2', 21)}</button><div className="flex items-center gap-[5px]"><button type="button" className="h-[30px] rounded-[15px] px-3 py-1.5 flex items-center gap-1.5 bg-[rgba(218,220,224,0.05)] text-[11px] leading-4 font-medium text-[rgba(218,220,224,0.75)]">{flowIcon('pen_magic', 16)}<span>{effectiveModelName}</span></button><button type="button" aria-label="Create" title="Create" disabled={!promptValue.trim()} onClick={onGenerate} className={`w-8 h-8 rounded-full p-[6px] flex items-center justify-center transition-colors ${promptValue.trim() ? 'bg-white text-black hover:bg-zinc-200' : 'bg-[rgba(218,220,224,0.05)] text-white/25 cursor-not-allowed'}`}>{flowIcon('arrow_forward', 20)}</button></div></div>
        </div>
      </div>
      <div className="absolute left-10 bottom-1 text-[13px] leading-4 font-medium text-white/60">Google Flow can make mistakes, so double check it</div>
      <div className="shrink-0 h-4" />
    </div>
  );
};
