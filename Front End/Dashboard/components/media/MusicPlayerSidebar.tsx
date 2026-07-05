import React, { useState, useRef, useEffect } from 'react';
import { Maximize2, X, Play, Pause, SkipBack, SkipForward, Volume1, Volume2 } from 'lucide-react';

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
  const [volume, setVolume] = useState(1);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

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
    const time = Number(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleVolumeSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
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
      {/* Dynamic Ambient Background */}
      {item?.url && (
        <>
          <style dangerouslySetInnerHTML={{__html: `
            .ambient-sidebar-container {
              position: absolute;
              inset: 0;
              overflow: hidden;
              z-index: 0;
              pointer-events: none;
              border-radius: 18px;
            }
            
            .ambient-sidebar-layer {
              position: absolute;
              background-size: cover;
              background-repeat: no-repeat;
              filter: blur(80px) saturate(200%);
              opacity: 0;
              transition: opacity 1.5s ease-in-out;
              will-change: transform, border-radius;
              mix-blend-mode: screen;
            }
            
            .ambient-sidebar-layer.visible {
              opacity: 0.50;
            }

            .liquid-s-1 {
              top: -20%; left: -20%; width: 120%; height: 120%;
              background-position: top left;
              animation: blob-morph-1 25s infinite alternate ease-in-out;
            }
            
            .liquid-s-2 {
              bottom: -30%; right: -20%; width: 130%; height: 130%;
              background-position: bottom right;
              animation: blob-morph-2 32s infinite alternate-reverse ease-in-out;
            }
            
            .liquid-s-3 {
              top: 0%; left: 0%; width: 140%; height: 140%;
              background-position: center;
              animation: blob-morph-3 38s infinite alternate ease-in-out;
              opacity: 0;
            }
            .liquid-s-3.visible { opacity: 0.40; }

            .liquid-s-4 {
              top: 20%; right: 20%; width: 100%; height: 100%;
              background-position: top right;
              animation: blob-morph-4 28s infinite alternate-reverse ease-in-out;
              opacity: 0;
            }
            .liquid-s-4.visible { opacity: 0.30; }

            .ambient-sidebar-overlay {
              position: absolute;
              inset: 0;
              background: linear-gradient(to bottom, rgba(23,23,25,0.7) 0%, rgba(23,23,25,0.95) 100%);
              z-index: 1;
            }

            @keyframes blob-morph-1 {
              0% { 
                border-radius: 40% 60% 70% 30% / 40% 50% 60% 50%;
                transform: rotate(0deg) scale(1.1) translate(-5%, -5%); 
              }
              34% { 
                border-radius: 70% 30% 50% 50% / 30% 30% 70% 70%;
                transform: rotate(45deg) scale(1.4) translate(15%, 20%); 
              }
              67% { 
                border-radius: 100% 60% 60% 100% / 100% 100% 60% 60%;
                transform: rotate(-20deg) scale(1.2) translate(-15%, 30%); 
              }
              100% { 
                border-radius: 40% 60% 70% 30% / 40% 50% 60% 50%;
                transform: rotate(10deg) scale(1.1) translate(-5%, -5%); 
              }
            }
            
            @keyframes blob-morph-2 {
              0% { 
                border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%;
                transform: rotate(0deg) scale(1) translate(0, 0); 
              }
              34% { 
                border-radius: 30% 60% 70% 40% / 50% 60% 30% 60%;
                transform: rotate(-30deg) scale(1.3) translate(-20%, -15%); 
              }
              67% { 
                border-radius: 50% 50% 40% 60% / 40% 40% 60% 50%;
                transform: rotate(-60deg) scale(1.1) translate(15%, -25%); 
              }
              100% { 
                border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%;
                transform: rotate(-10deg) scale(1.2) translate(5%, 10%); 
              }
            }
            
            @keyframes blob-morph-3 {
              0% { 
                border-radius: 50% 50% 50% 50% / 50% 50% 50% 50%;
                transform: scale(1) translate(0, 0); 
              }
              34% { 
                border-radius: 80% 20% 40% 60% / 60% 40% 80% 20%;
                transform: scale(1.4) translate(-15%, 15%); 
              }
              67% { 
                border-radius: 30% 70% 60% 40% / 40% 70% 30% 60%;
                transform: scale(1.2) translate(20%, -15%); 
              }
              100% { 
                border-radius: 50% 50% 50% 50% / 50% 50% 50% 50%;
                transform: scale(1.1) translate(-5%, 5%); 
              }
            }

            @keyframes blob-morph-4 {
              0% { 
                border-radius: 30% 70% 70% 30% / 30% 30% 70% 70%;
                transform: rotate(0deg) scale(1) translate(0, 0); 
              }
              50% { 
                border-radius: 70% 30% 30% 70% / 70% 70% 30% 30%;
                transform: rotate(180deg) scale(1.5) translate(30%, 10%); 
              }
              100% { 
                border-radius: 30% 70% 70% 30% / 30% 30% 70% 70%;
                transform: rotate(360deg) scale(1) translate(-10%, -20%); 
              }
            }
          `}} />
          <div className="ambient-sidebar-container">
            <div 
              className={`absolute inset-0 bg-cover bg-center transition-opacity duration-1500 opacity-30`}
              style={{ backgroundImage: `url("${item.url}")`, filter: 'blur(80px) saturate(150%)' }}
            />
            <div className={`ambient-sidebar-layer liquid-s-1 visible`} style={{ backgroundImage: `url("${item.url}")` }} />
            <div className={`ambient-sidebar-layer liquid-s-2 visible`} style={{ backgroundImage: `url("${item.url}")` }} />
            <div className={`ambient-sidebar-layer liquid-s-3 visible`} style={{ backgroundImage: `url("${item.url}")` }} />
            <div className={`ambient-sidebar-layer liquid-s-4 visible`} style={{ backgroundImage: `url("${item.url}")` }} />
            <div className="ambient-sidebar-overlay" />
          </div>
        </>
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
          <div className="w-full aspect-square rounded-[8px] overflow-hidden shadow-2xl mb-8 relative group shrink-0">
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
          <div className="w-full text-left mb-8 shrink-0">
            <h2 className="text-xl font-bold text-white mb-1 line-clamp-1">{title}</h2>
            <p className="text-[17px] text-white/70 line-clamp-1">{artist}</p>
          </div>

          {/* Scrubber */}
          <div className="w-full mb-10 shrink-0">
          <div className="relative w-full h-[6px] bg-white/15 rounded-full group">
            {/* The filled track */}
            <div 
              className="absolute top-0 left-0 h-full bg-white/60 rounded-full pointer-events-none"
              style={{ width: `${(currentTime / (duration || 1)) * 100}%` }}
            />
            {/* The invisible range input to capture clicks and drags */}
            <input 
              type="range"
              min="0"
              max={duration || 100}
              value={currentTime}
              onChange={handleSeek}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer m-0 p-0"
            />
          </div>
            <div className="flex justify-between mt-3 text-[12px] font-medium text-white/50">
              <span>{formatTime(currentTime)}</span>
              <span>-{formatTime(Math.max(0, duration - currentTime))}</span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-center gap-12 w-full shrink-0 mb-12">
            <button className="text-white hover:opacity-80 transition-opacity active:opacity-50" disabled>
              <svg width="42" height="26" viewBox="0 0 42 26" fill="currentColor">
                <path d="M19 4.5C19 2.5 16.5 1.2 14.8 2.5L2.8 11.5C1.2 12.5 1.2 14.5 2.8 15.5L14.8 24.5C16.5 25.8 19 24.5 19 22.5V4.5Z" />
                <path d="M40 4.5C40 2.5 37.5 1.2 35.8 2.5L23.8 11.5C22.2 12.5 22.2 14.5 23.8 15.5L35.8 24.5C37.5 25.8 40 24.5 40 22.5V4.5Z" />
              </svg>
            </button>
            <button 
              onClick={togglePlay}
              className="text-white hover:opacity-80 active:opacity-50 transition-opacity flex items-center justify-center"
            >
              {isPlaying ? (
                <svg width="32" height="38" viewBox="0 0 32 38" fill="currentColor">
                  <rect x="2" y="2" width="10" height="34" rx="4" />
                  <rect x="20" y="2" width="10" height="34" rx="4" />
                </svg>
              ) : (
                <svg width="34" height="40" viewBox="0 0 34 40" fill="currentColor">
                  <path d="M6 5.5C6 2.5 9.2 0.8 11.8 2.5L32.8 17.5C35.2 19.2 35.2 22.8 32.8 24.5L11.8 39.5C9.2 41.2 6 39.5 6 36.5V5.5Z" />
                </svg>
              )}
            </button>
            <button className="text-white hover:opacity-80 transition-opacity active:opacity-50" disabled>
              <svg width="42" height="26" viewBox="0 0 42 26" fill="currentColor">
                <path d="M23 4.5C23 2.5 25.5 1.2 27.2 2.5L39.2 11.5C40.8 12.5 40.8 14.5 39.2 15.5L27.2 24.5C25.5 25.8 23 24.5 23 22.5V4.5Z" />
                <path d="M2 4.5C2 2.5 4.5 1.2 6.2 2.5L18.2 11.5C19.8 12.5 19.8 14.5 18.2 15.5L6.2 24.5C4.5 25.8 2 24.5 2 22.5V4.5Z" />
              </svg>
            </button>
          </div>

          {/* Volume Control */}
          <div className="flex items-center w-full shrink-0">
            <Volume1 className="w-3.5 h-3.5 text-white/50 shrink-0 mr-3" />
            <div className="relative w-full h-[4px] bg-white/15 rounded-full group flex-1">
              {/* The filled track */}
              <div 
                className="absolute top-0 left-0 h-full bg-white/60 rounded-full pointer-events-none"
                style={{ width: `${volume * 100}%` }}
              />
              {/* The thumb */}
              <div 
                className="absolute top-1/2 -translate-y-1/2 w-[16px] h-[16px] bg-white rounded-full shadow-md pointer-events-none"
                style={{ left: `calc(${volume * 100}% - 8px)` }}
              />
              {/* The invisible range input */}
              <input 
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={handleVolumeSeek}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer m-0 p-0"
              />
            </div>
            <Volume2 className="w-4 h-4 text-white/50 shrink-0 ml-4" />
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
