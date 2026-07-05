import React, { useState, useRef, useEffect } from 'react';
import { Maximize2, X, Play, Pause, SkipBack, SkipForward, Volume2 } from 'lucide-react';

export interface MusicSidebarItem {
  id: string;
  kind: string;
  url?: string;
  audioUrl?: string;
  prompt: string;
  shortenedPrompt?: string;
  modelName?: string;
}

interface MusicPlayerSidebarProps {
  isOpen: boolean;
  item: MusicSidebarItem | null;
  onClose: () => void;
  onExpand: () => void;
  isHeaderVisible: boolean;
}

export const MusicPlayerSidebar: React.FC<MusicPlayerSidebarProps> = ({
  isOpen,
  item,
  onClose,
  onExpand,
  isHeaderVisible
}) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Auto-play when item changes and is open
  useEffect(() => {
    if (isOpen && item?.audioUrl && audioRef.current) {
      audioRef.current.play().then(() => {
        setIsPlaying(true);
      }).catch(err => {
        console.warn("Auto-play prevented", err);
        setIsPlaying(false);
      });
    } else if (!isOpen && audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  }, [item, isOpen]);

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
      setDuration(audioRef.current.duration || 0);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
  };

  const formatTime = (time: number) => {
    if (isNaN(time)) return '0:00';
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const sidebarTransition = "500ms cubic-bezier(0.16, 1, 0.3, 1)";
  
  const title = item?.shortenedPrompt || item?.prompt || 'Unknown Title';
  const artist = item?.modelName || 'Unknown Artist';

  return (
    <div 
      className="fixed right-2 w-[348px] bg-[#171719] rounded-[18px] shadow-2xl z-[70] flex flex-col overflow-hidden"
      style={{
        top: isHeaderVisible ? '72px' : '16px',
        bottom: '8px',
        transform: isOpen ? 'translateX(0)' : 'translateX(calc(100% + 24px))',
        transition: `transform 0.5s cubic-bezier(0.16, 1, 0.3, 1), top ${sidebarTransition}, visibility 0.5s`,
        visibility: isOpen ? 'visible' : 'hidden'
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Background blur/tint from cover */}
      {item?.url && (
        <div className="absolute inset-0 z-0 overflow-hidden rounded-[18px]">
          <div 
            className="absolute inset-0 bg-cover bg-center opacity-30"
            style={{ 
              backgroundImage: `url(${item.url})`,
              filter: 'blur(40px) saturate(150%)',
              transform: 'scale(1.2)'
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[#171719]/80 via-[#171719]/95 to-[#171719] z-1" />
        </div>
      )}

      {/* Top Bar */}
      <div className="flex items-center justify-between px-4 py-4 relative z-10 shrink-0">
        <button 
          onClick={onExpand}
          className="p-2 rounded-full hover:bg-white/10 text-gray-400 hover:text-white transition-colors flex items-center justify-center gap-2 group"
          title="Expand to Fullscreen"
        >
          <Maximize2 className="w-5 h-5" />
          <span className="text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">Full Player</span>
        </button>
        
        <button 
          onClick={onClose}
          className="p-2 rounded-full bg-black/20 hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Main Content Area */}
      {item && (
        <div className="flex-1 flex flex-col items-center px-6 pb-8 pt-4 relative z-10 overflow-y-auto custom-scrollbar">
          
          {/* Cover Art */}
          <div className="w-full aspect-square rounded-2xl overflow-hidden shadow-2xl mb-8 relative group shrink-0">
            {item.url ? (
              <img src={item.url} alt={title} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-white/5 flex items-center justify-center">
                <Volume2 className="w-16 h-16 text-white/20" />
              </div>
            )}
            <div className="absolute inset-0 ring-1 ring-inset ring-white/10 rounded-2xl pointer-events-none" />
          </div>

          {/* Track Info */}
          <div className="w-full text-center mb-8 shrink-0">
            <h2 className="text-xl font-bold text-white mb-1 line-clamp-1">{title}</h2>
            <p className="text-sm text-gray-400 line-clamp-1">{artist}</p>
          </div>

          {/* Scrubber */}
          <div className="w-full mb-8 shrink-0">
            <input 
              type="range"
              min="0"
              max={duration || 100}
              value={currentTime}
              onChange={handleSeek}
              className="w-full h-1.5 bg-white/20 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
              style={{
                background: `linear-gradient(to right, white ${(currentTime / (duration || 1)) * 100}%, rgba(255,255,255,0.2) ${(currentTime / (duration || 1)) * 100}%)`
              }}
            />
            <div className="flex justify-between mt-2 text-[11px] font-medium text-gray-400">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-center gap-6 w-full shrink-0">
            <button className="text-gray-400 hover:text-white transition-colors" disabled>
              <SkipBack className="w-6 h-6 fill-current" />
            </button>
            <button 
              onClick={togglePlay}
              className="w-16 h-16 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-lg"
            >
              {isPlaying ? (
                <Pause className="w-7 h-7 fill-current" />
              ) : (
                <Play className="w-7 h-7 fill-current translate-x-0.5" />
              )}
            </button>
            <button className="text-gray-400 hover:text-white transition-colors" disabled>
              <SkipForward className="w-6 h-6 fill-current" />
            </button>
          </div>
          
        </div>
      )}

      {/* Hidden Audio Element */}
      {item?.audioUrl && (
        <audio
          ref={audioRef}
          src={item.audioUrl}
          onTimeUpdate={handleTimeUpdate}
          onEnded={() => setIsPlaying(false)}
          onLoadedMetadata={handleTimeUpdate}
        />
      )}
    </div>
  );
};
