import React, { useState, useRef, useEffect } from 'react';
import { Maximize2, X, Play, Pause, SkipBack, SkipForward, Volume1, Volume2, MessageSquareQuote, List } from 'lucide-react';

export interface MusicSidebarItem {
  id: string;
  kind: string;
  url?: string;
  audioUrl?: string;
  prompt: string;
  shortenedPrompt?: string;
  modelName?: string;
  lyrics?: {time: number; text: string}[];
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
  const [showLyrics, setShowLyrics] = useState(false);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const isInitialScrollRef = useRef(true);

  const lyrics = item?.lyrics?.length ? item.lyrics : [
    { time: 0, text: "Wait, the music is starting..." },
    { time: 4, text: "I can feel the rhythm in the air" },
    { time: 8, text: "Tonight is gonna be a good night" },
    { time: 12, text: "Let the bass drop and take control" },
    { time: 16, text: "We're dancing 'til the morning light" },
    { time: 20, text: "(Instrumental Break)" },
    { time: 28, text: "Every time I close my eyes" },
    { time: 32, text: "I see the neon lights shining bright" },
    { time: 36, text: "This feeling is taking over me" },
    { time: 40, text: "I'm floating in the music's flight" }
  ];

  const activeLyricIndex = React.useMemo(() => {
    if (lyrics.length === 0) return -1;
    if (currentTime === 0 || currentTime < lyrics[0].time) return -1;
    return lyrics.findIndex((line, i) => {
      return currentTime >= line.time && (i === lyrics.length - 1 || currentTime < lyrics[i + 1].time);
    });
  }, [currentTime, lyrics]);

  useEffect(() => {
    if (!showLyrics) {
      isInitialScrollRef.current = true;
    }
  }, [showLyrics]);

  useEffect(() => {
    if (lyricsContainerRef.current && showLyrics) {
      const container = lyricsContainerRef.current;
      const isInitial = isInitialScrollRef.current;
      
      const performScroll = () => {
        const activeLyric = container.querySelector('[data-active="true"]') as HTMLElement | null;
        const targetLyric = activeLyric || container.firstElementChild;
        if (targetLyric) {
          targetLyric.scrollIntoView({
            behavior: isInitial ? 'auto' : 'smooth',
            block: 'center'
          });
          
          if (isInitial) {
            isInitialScrollRef.current = false;
          }
        }
      };

      if (isInitial) {
        // Double requestAnimationFrame + setTimeout ensures the browser has fully painted 
        // the new layout and dimensions before we attempt to snap to the center.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setTimeout(performScroll, 50);
          });
        });
      } else {
        performScroll();
      }
    }
  }, [activeLyricIndex, showLyrics]);

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
        <div className="flex-1 w-full relative z-10">
          
          {/* Top Section Wrapper - Absolutely positioned above the controls */}
          <div className={`absolute left-0 right-0 bottom-[280px] px-6 flex flex-col items-center ${showLyrics ? 'top-[-8px] pt-0' : 'top-0 pt-4'}`}>
            {!showLyrics ? (
              <div className="w-full flex flex-col items-center animate-in fade-in zoom-in-95 duration-500">
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
                <div className="w-full text-left shrink-0">
                  <h2 className="text-xl font-bold text-white mb-1 line-clamp-1">{title}</h2>
                  <p className="text-[17px] text-white/70 line-clamp-1">{artist}</p>
                </div>
              </div>
            ) : (
              <div className="w-full h-full flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-500">
                {/* Mini Header for Lyrics Mode */}
                <div className="w-full flex items-center gap-4 mb-4 shrink-0 animate-in fade-in duration-500">
                  <div className="w-12 h-12 rounded-md overflow-hidden shadow-lg shrink-0 relative">
                    {item.url ? (
                      <img src={item.url} alt={title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-white/5 flex items-center justify-center">
                        <Volume2 className="w-6 h-6 text-white/20" />
                      </div>
                    )}
                    <div className="absolute inset-0 ring-1 ring-inset ring-white/10 rounded-md pointer-events-none" />
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col justify-center text-left">
                    <h2 className="text-[15px] font-bold text-white leading-tight truncate">{title}</h2>
                    <p className="text-[13px] text-white/70 leading-tight truncate">{artist}</p>
                  </div>
                </div>

                {/* Scrollable Lyrics Container */}
                <div 
                  ref={lyricsContainerRef}
                  className="relative flex-1 w-full overflow-y-auto min-h-0 no-scrollbar flex flex-col items-start gap-5 pb-[40vh] pt-4 animate-in fade-in duration-500"
                  style={{ 
                     maskImage: 'linear-gradient(to bottom, transparent 0%, black 15%, black 65%, transparent 95%)',
                     WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 15%, black 65%, transparent 95%)'
                  }}
                >
                  {lyrics.map((line, i) => {
                    const isPast = activeLyricIndex > i;
                    const isCurrent = activeLyricIndex === i;
                    
                    return (
                      <div 
                        key={i}
                        data-active={isCurrent}
                        onClick={() => {
                          if (audioRef.current) {
                            audioRef.current.currentTime = line.time;
                            if (!isPlaying) togglePlay();
                          }
                        }}
                        className={`text-left cursor-pointer transition-all duration-500 ease-out w-full origin-left font-bold tracking-tight text-[26px] ${
                          isCurrent ? 'text-white opacity-100 scale-100 blur-none' : 
                          isPast ? 'text-white opacity-40 scale-[0.85] blur-[0.5px]' : 
                          'text-white opacity-60 scale-[0.85] blur-[0.5px]'
                        }`}
                      >
                        {line.text}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Controls Wrapper - Absolutely positioned at the bottom so it never shifts */}
          <div className="absolute bottom-8 left-6 right-6 flex flex-col justify-end">
            
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
              className="w-[34px] h-[40px] text-white hover:opacity-80 active:opacity-50 transition-opacity flex items-center justify-center"
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

          {/* Bottom Actions (Lyrics & List) */}
          <div className="flex items-center justify-between w-full shrink-0 mt-10 mb-2 px-4">
            <button 
              onClick={() => setShowLyrics(!showLyrics)}
              className={`transition-colors active:opacity-50 flex items-center justify-center ${showLyrics ? 'text-white' : 'text-white/50 hover:text-white'}`}
            >
              <svg width="24" height="24" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                {/* Hollow Speech Bubble Outline */}
                <path 
                  fill="none" 
                  stroke="currentColor" 
                  strokeWidth="3.2" 
                  strokeLinejoin="round" 
                  strokeLinecap="round" 
                  d="M 36 10 L 12 10 C 10.343 10 9 11.343 9 13 L 9 30 C 9 31.657 10.343 33 12 33 L 17 33 C 17.56 33 18 33.45 18 34 L 18 37.564 C 18 37.735 18.201 37.827 18.331 37.716 L 22.68 33.971 C 23.41 33.341 24.34 33 25.29 33 L 36 33 C 37.657 33 39 31.658 39 30 L 39 13 C 39 11.343 37.657 10 36 10 Z" 
                />
                
                {/* Left Quote Mark */}
                <path 
                  fill="currentColor" 
                  d="M 17.74 27 C 17.33 27 17 26.67 17 26.27 C 17 25.86 17.33 25.54 17.74 25.54 C 19.3 25.54 20.45 24.66 21.16 23.38 C 20.66 23.66 20.1 23.83 19.49 23.83 C 17.61 23.83 16.08 22.3 16.08 20.41 C 16.08 18.53 17.46 17 19.35 17 C 20.66 17 21.73 17.93 22.36 19 C 22.6 19.41 23 20.28 23 21.54 C 23 24.63 20.83 27 17.74 27 Z" 
                />
                
                {/* Right Quote Mark */}
                <path 
                  fill="currentColor" 
                  d="M 26.74 27 C 26.33 27 26 26.67 26 26.27 C 26 25.86 26.33 25.54 26.74 25.54 C 28.3 25.54 29.45 24.66 30.16 23.38 C 29.66 23.66 29.1 23.83 28.49 23.83 C 26.61 23.83 25.08 22.3 25.08 20.41 C 25.08 18.53 26.46 17 28.35 17 C 29.66 17 30.73 17.93 31.36 19 C 31.6 19.41 32 20.28 32 21.54 C 32 24.63 29.83 27 26.74 27 Z" 
                />
              </svg>
            </button>
            <button className="text-white/50 hover:text-white transition-colors active:opacity-50 flex items-center justify-center">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <circle cx="5" cy="7" r="1.5" />
                <rect x="9" y="5.5" width="11" height="3" rx="1.5" />
                <circle cx="5" cy="12" r="1.5" />
                <rect x="9" y="10.5" width="11" height="3" rx="1.5" />
                <circle cx="5" cy="17" r="1.5" />
                <rect x="9" y="15.5" width="11" height="3" rx="1.5" />
              </svg>
            </button>
          </div>
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
