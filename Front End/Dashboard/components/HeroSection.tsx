import React, { useState } from 'react';
import { InputBar } from './InputBar';
import { useAuth } from '../context/AuthContext';
import { useBackground } from '../context/BackgroundContext';
import { loadAllProjectCovers, deleteProjectData, getMediaIndex } from '../lib/mediaStorage';
import { renameCodeSessions, deleteCodeSessions } from '../lib/willowDB';
import { useLocalFS } from '../context/LocalFSContext';

// @ts-ignore
import willSmithVideo from '../../Content/Will smith.mp4';
// @ts-ignore
import coffeeVideo from '../../Content/Coffee.mp4';
// @ts-ignore
import alienVideo from '../../Content/Alien.mp4';
// @ts-ignore
import chickenVideo from '../../Content/Chicken.mp4';
// @ts-ignore
import opaliteVideo from '../../Content/Opalite.mp4';
// @ts-ignore
import iceCreamVideo from '../../Content/Ice Cream.mp4';

export type Mode = 'ship' | 'design' | 'proto' | 'chat';

const isCoverVideo = (url: string): boolean => {
  if (!url) return false;
  // For data: URLs trust ONLY the MIME type. Never substring-match the base64
  // payload — random base64 routinely contains "veo"/"/video"/etc., which would
  // mis-render image covers inside a <video> tag (they appear blank/gray).
  if (url.startsWith('data:')) return url.startsWith('data:video');
  const lowercaseUrl = url.toLowerCase();
  return (
    lowercaseUrl.endsWith('.mp4') ||
    lowercaseUrl.endsWith('.webm') ||
    lowercaseUrl.includes('/video') ||
    lowercaseUrl.includes('generatevideo') ||
    lowercaseUrl.includes('veo')
  );
};

export const HeroSection: React.FC<{
  onPromptSubmit?: (prompt: string, mode: string) => void;
  onProjectSelect?: (projectId: string, tempName?: string) => void;
  modelConfig: any;
  selectedModelId: string;
  setSelectedModelId: (id: string) => void;
  onAuthRequired?: () => void;
  isAuthenticated?: boolean;
  agentSwarmEnabled?: boolean;
  onSwarmToggle?: (enabled: boolean) => void;
  initialMode?: Mode;
  /** Chat-mode live-voice toggle. Only provided by DashboardChat; Develop leaves it undefined. */
  onStartLive?: () => void;
  dashboardMode?: 'develop' | 'media';
  isIncognito?: boolean;
  isSidebarCollapsed?: boolean;
}> = ({ onPromptSubmit, onProjectSelect, modelConfig, selectedModelId, setSelectedModelId, onAuthRequired, isAuthenticated, agentSwarmEnabled, onSwarmToggle, initialMode = 'ship', onStartLive, dashboardMode, isIncognito = false, isSidebarCollapsed = false }) => {
  const { userProfile } = useAuth();
  const { deleteLocalFSProject, renameLocalFSProject } = useLocalFS();
  const [mode, setMode] = useState<Mode>(initialMode);

  // Sequential media playlist for the Media tab with slide-specific branding
  const mediaPlaylist = React.useMemo(() => [
    { 
      url: willSmithVideo, 
      type: 'video',
      title: 'Welcome to Media Generation Window',
      description: 'Bring your ideas to life. Instantly generate, edit, and animate cinematic-grade videos and realistic assets using state-of-the-art AI generation tools.',
      buttonText: 'Create a Project'
    },
    { 
      url: coffeeVideo, 
      type: 'video',
      title: 'Create characters and cast them anywhere.',
      description: 'Define their look, voice, and personality once. Reference them anywhere with a simple @tag.',
      buttonText: 'Create a character',
      buttonIcon: 'character'
    },
    { 
      url: alienVideo, 
      type: 'video',
      title: 'A creative partner to help you at every step.',
      description: 'Brainstorming, prompting, batch editing, organizing your media, and more–see what the agent can do for you.',
      buttonText: 'Try the Google Flow Agent'
    },
    { 
      url: chickenVideo, 
      type: 'video',
      title: 'Make your own Tools in Google Flow.',
      description: 'Everyone’s creative workflow is different. Create, remix, and share Tools that you can use seamlessly in your projects.',
      buttonText: 'Explore Tools',
      buttonIcon: 'compass'
    },
    { 
      url: opaliteVideo, 
      type: 'video',
      title: 'Generate songs from lyrics or ask your Producer.',
      description: 'Transform words into high-fidelity music. Compose vocals, arrange instrumentation, or co-create side-by-side with your virtual AI Producer.',
      buttonText: 'Generate Songs'
    },
    { 
      url: iceCreamVideo, 
      type: 'video',
      title: 'Create films by stitching small individual clips.',
      description: 'Seamlessly combine multiple generated shots, orchestrate seamless transitions, and stack timeline tracks to construct complete cinematic short films.',
      buttonText: 'Try Sceness'
    }
  ], []);

  const [currentMediaIndex, setCurrentMediaIndex] = React.useState(0);
  const [isFading, setIsFading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [projectsList, setProjectsList] = React.useState<{ id: string; name: string; hasCover?: boolean; kind?: 'media' | 'code'; coverUrl?: string }[]>(() => {
    const stored = localStorage.getItem('willow_projects_list');
    if (stored) {
      try {
        const allProjects = JSON.parse(stored);
        // Media tab shows projects tagged 'media' OR any project that actually
        // has media (per the realtime media index) — so media you generated into
        // a 'code' project still appears here.
        if (dashboardMode === 'media') {
          const idx = getMediaIndex();
          return allProjects.filter((p: any) => p.kind === 'media' || (idx[p.id]?.count || 0) > 0);
        }
        return allProjects;
      } catch (e) {
        /* ignore fallback */
      }
    }
    const initial: any[] = [];
    try {
      localStorage.setItem('willow_projects_list', JSON.stringify(initial));
    } catch (e) {}
    return initial;
  });

  // Cover images resolved from IndexedDB (heavy base64 data lives here, not localStorage)
  const [coverUrls, setCoverUrls] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    loadAllProjectCovers().then(setCoverUrls);
  }, [projectsList]);

  React.useEffect(() => {
    const handleUpdate = () => {
      const stored = localStorage.getItem('willow_projects_list');
      if (stored) {
        try {
          const allProjects = JSON.parse(stored);
          // Media tab shows 'media'-tagged projects OR any project that has media.
          if (dashboardMode === 'media') {
            const idx = getMediaIndex();
            setProjectsList(allProjects.filter((p: any) => p.kind === 'media' || (idx[p.id]?.count || 0) > 0));
          } else {
            setProjectsList(allProjects);
          }
        } catch (e) {}
      }
    };
    window.addEventListener('willow_projects_updated', handleUpdate);
    // The media index updates in realtime as media is generated/deleted — refresh
    // the Media grid when it changes so "has media" projects appear/disappear live.
    window.addEventListener('willow_media_updated', handleUpdate);
    return () => {
      window.removeEventListener('willow_projects_updated', handleUpdate);
      window.removeEventListener('willow_media_updated', handleUpdate);
    };
  }, [dashboardMode]);

  // NOTE: We deliberately do NOT write `projectsList` back to localStorage here.
  // In Media mode `projectsList` is FILTERED to media-only, so persisting it would
  // wipe code projects from the registry. All mutations (create/rename/delete)
  // operate on the FULL localStorage list directly and then dispatch
  // `willow_projects_updated`, which refreshes the filtered display below.
  const persistProjectRename = React.useCallback((projectId: string, rawName: string) => {
    // Strip filesystem-illegal characters — the name becomes a folder name on
    // disk, and an unusable one silently breaks every later folder operation.
    const baseName = rawName.replace(/[\/:*?"<>|]/g, '').trim();
    if (!baseName) return;
    try {
      const stored = localStorage.getItem('willow_projects_list');
      const list = stored ? JSON.parse(stored) : [];
      if (!Array.isArray(list)) return;
      const oldName = list.find((p: any) => p.id === projectId)?.name;
      // Dedup against the FULL list (not the filtered display list)
      let uniqueName = baseName;
      let counter = 1;
      while (list.some((p: any) => p.id !== projectId && p.name.toLowerCase() === uniqueName.toLowerCase())) {
        uniqueName = `${baseName} (${counter})`;
        counter++;
      }
      if (oldName === uniqueName) return;
      const updated = list.map((p: any) => (p.id === projectId ? { ...p, name: uniqueName } : p));
      localStorage.setItem('willow_projects_list', JSON.stringify(updated));
      window.dispatchEvent(new Event('willow_projects_updated'));
      // Keep the disk folder in lock-step so the disk-authoritative reconciler
      // doesn't revert the rename (and so saves target the right folder).
      if (oldName) {
        void renameLocalFSProject(oldName, uniqueName);
        // Code-editor sessions are keyed by project NAME — migrate them too,
        // or the renamed project opens with an empty chat/snapshot history.
        void renameCodeSessions(`willow_chat_sessions_${oldName}`, `willow_chat_sessions_${uniqueName}`);
      }
    } catch {}
  }, [renameLocalFSProject]);

  const formatProjectDate = (date: Date): string => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[date.getMonth()];
    const day = date.getDate();
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const hoursStr = String(hours).padStart(2, '0');
    // "10.15", not "10:15" — the name becomes the project's disk folder name,
    // and ':' is a reserved character on Windows: getDirectoryHandle threw
    // "Name is not allowed" on every save, so default-named projects silently
    // never appeared in the connected folder until manually renamed.
    return `${month} ${day}, ${hoursStr}.${minutes} ${ampm}`;
  };

  const handleCreateNewProject = () => {
    // Mint an id no existing project already uses — check the FULL registry
    // (the display list here is filtered in Media mode), because the temp id's
    // "#XXXX" suffix becomes the real project id on materialization and a
    // duplicate id cross-links two projects' covers/media in IndexedDB.
    const usedIds = new Set<string>();
    try {
      const stored = localStorage.getItem('willow_projects_list');
      const list = stored ? JSON.parse(stored) : [];
      if (Array.isArray(list)) for (const p of list) if (p?.id) usedIds.add(p.id);
    } catch {}
    let mintedId = `#${Math.floor(1000 + Math.random() * 9000)}`;
    while (usedIds.has(mintedId)) {
      mintedId = `#${Math.floor(1000 + Math.random() * 9000)}`;
    }
    const tempId = `temp_${mintedId}`;
    const dateName = formatProjectDate(new Date());

    // Dedupe the proposed name against the FULL registry, not the filtered
    // display list — in Media mode `projectsList` hides code projects, and a
    // code project created in the same minute shares this exact date-name.
    // A name collision cross-links disk folders and name-keyed session records.
    const allNames = new Set<string>();
    try {
      const storedList = localStorage.getItem('willow_projects_list');
      const full = storedList ? JSON.parse(storedList) : [];
      if (Array.isArray(full)) {
        for (const p of full) if (typeof p?.name === 'string') allNames.add(p.name.toLowerCase());
      }
    } catch {}
    let uniqueName = dateName;
    let counter = 1;
    while (allNames.has(uniqueName.toLowerCase())) {
      uniqueName = `${dateName} (${counter})`;
      counter++;
    }
    
    onProjectSelect?.(tempId, uniqueName);
  };

  const [editingProjectId, setEditingProjectId] = React.useState<string | null>(null);
  const [editingValue, setEditingValue] = React.useState<string>('');
  const activeMedia = mediaPlaylist[currentMediaIndex];

  // Ref to track progress tick intervals & smooth interpolation state
  const progressIntervalRef = React.useRef<number | null>(null);
  const progressStartTimeRef = React.useRef<number>(0);
  const progressDurationRef = React.useRef<number>(0);
  const fallbackRef = React.useRef<number | null>(null);
  const smoothProgressRef = React.useRef(0);

  const handleIncomingReady = React.useCallback(() => {
    if (fallbackRef.current) {
      clearTimeout(fallbackRef.current);
      fallbackRef.current = null;
    }
    // Fade back in once the next slide is fully loaded/buffered
    setIsFading(false);
  }, []);

  // Helper to transition to the next media item sequentially (fade to complete black first, then load and fade in)
  const triggerTransition = React.useCallback((nextIndex: number, fadeOutDuration: number = 800) => {
    if (fallbackRef.current) clearTimeout(fallbackRef.current);

    // Step 1: Start fading out the current slide to black
    setIsFading(true);

    // Step 2: Swap sources exactly when the fade-out completes (after fadeOutDuration)
    setTimeout(() => {
      setCurrentMediaIndex(nextIndex);
      smoothProgressRef.current = 0; // Reset smooth interpolation ref
      setProgress(0);

      // Step 3: Fallback timer to force fade-in if ready events don't fire
      fallbackRef.current = window.setTimeout(() => {
        setIsFading(false);
      }, 1500);
    }, fadeOutDuration); // Dynamic fade-out duration
  }, []);

  const handleMediaEnd = React.useCallback(() => {
    triggerTransition((currentMediaIndex + 1) % mediaPlaylist.length);
  }, [currentMediaIndex, mediaPlaylist.length, triggerTransition]);

  // Clean up timers on unmount
  React.useEffect(() => {
    return () => {
      if (fallbackRef.current) clearTimeout(fallbackRef.current);
    };
  }, []);

  // Butter-smooth 60fps progress tracker and precise transition trigger for videos
  React.useEffect(() => {
    if (dashboardMode !== 'media') return;

    let animFrameId: number;

    const updateSmoothProgress = () => {
      const video = document.querySelector('video') as HTMLVideoElement | null;
      if (video && !video.paused && video.duration) {
        // Cap the maximum playing duration of any video at exactly 6 seconds
        const cappedDuration = Math.min(video.duration, 6);
        const targetPct = (video.currentTime / cappedDuration) * 100;
        
        // Linear Interpolation (LERP) to filter and damp out browser video clock jitter
        const current = smoothProgressRef.current;
        let next = current + (targetPct - current) * 0.15; // 0.15 is the ideal dampening coefficient

        // If we are at the very start of a video or jump to a new progress value, reset state instantly
        if (Math.abs(targetPct - current) > 10) {
          next = targetPct;
        }

        smoothProgressRef.current = next;
        setProgress(next);

        // Precise early-end transition trigger (exactly 800ms before reaching the capped duration)
        const remaining = cappedDuration - video.currentTime;
        if (remaining <= 0.8 && !isFading) {
          setIsFading(true);
          const durationMs = Math.max(100, remaining * 1000 - 50);
          triggerTransition((currentMediaIndex + 1) % mediaPlaylist.length, durationMs);
        }
      }
      animFrameId = requestAnimationFrame(updateSmoothProgress);
    };

    animFrameId = requestAnimationFrame(updateSmoothProgress);

    return () => {
      cancelAnimationFrame(animFrameId);
    };
  }, [currentMediaIndex, dashboardMode, isFading, triggerTransition, mediaPlaylist.length]);

  // Handle progress ticking for static images
  React.useEffect(() => {
    if (dashboardMode !== 'media') return;
    if (activeMedia.type !== 'image') return;

    setProgress(0);
    const duration = (activeMedia as any).duration || 4000;
    progressDurationRef.current = duration;
    progressStartTimeRef.current = Date.now();

    const interval = setInterval(() => {
      const elapsed = Date.now() - progressStartTimeRef.current;
      const pct = Math.min(100, (elapsed / duration) * 100);
      setProgress(pct);
      if (elapsed >= duration) {
        clearInterval(interval);
        handleMediaEnd();
      }
    }, 30);

    return () => clearInterval(interval);
  }, [currentMediaIndex, activeMedia, dashboardMode, handleMediaEnd]);

  // Get user's first name
  const firstName = userProfile?.displayName?.split(' ')[0] || 'there';

  const getHeadingText = () => {
    if (dashboardMode === 'media') {
      return isAuthenticated
        ? `Time to create media, ${firstName}`
        : 'Time to create media';
    }

    // Show generic text when not authenticated
    if (!isAuthenticated) {
      switch (mode) {
        case 'ship':
          return 'Time to build';
        case 'proto':
          return 'Time to prototype';
        case 'design':
          return 'Time to design';
        case 'chat':
          return isIncognito ? "Incognito chat" : "Let's chat";
        default:
          return 'Time to build';
      }
    }
    
    // Show personalized text when authenticated
    switch (mode) {
      case 'ship':
        return `Time to ship, ${firstName}`;
      case 'proto':
        return `Time to prototype, ${firstName}`;
      case 'design':
        return `Time to design, ${firstName}`;
      case 'chat':
        return isIncognito ? `Incognito chat, ${firstName}` : `Let's chat, ${firstName}`;
      default:
        return `Time to ship, ${firstName}`;
    }
  };

  const { background } = useBackground();

  const justifyClass = dashboardMode === 'media' ? 'justify-start pt-8 pb-0' : 'justify-center';
  const minHeightClass = dashboardMode === 'media' ? 'min-h-[74vh]' : 'min-h-[85vh]';
  const pxClass = dashboardMode === 'media' ? 'px-8' : 'px-4';
  const mtClass = background === 'solid' && dashboardMode !== 'media' ? '-mt-20' : '';

  return (
    <div className={`flex-1 flex flex-col items-center ${justifyClass} ${minHeightClass} w-full ${pxClass} relative z-30 ${mtClass}`}>
      {dashboardMode === 'media' ? (
        <>
          {/* Centered Silent Media Player (Video / Image Playlist Carousel) */}
          <div 
            style={{ aspectRatio: '1200 / 350' }}
            className="w-full h-auto rounded-[18px] overflow-hidden border border-white/10 bg-[#0d0d0d] flex items-center justify-center mb-5 transition-all duration-300 select-none relative shrink-0"
          >
            {/* Single player wrapper with smooth CSS transitions */}
            <div 
              className={`w-full h-full ${isFading ? 'opacity-0' : 'opacity-100'}`}
              style={{ transition: 'opacity 800ms ease-in-out' }}
            >
              {activeMedia.type === 'video' ? (
                <video
                  key={currentMediaIndex} // Key ensures React recreates the element to load and autoplay clean on index change
                  src={activeMedia.url}
                  autoPlay
                  loop={false} // Don't loop so we hit handleMediaEnd on video end
                  muted
                  playsInline
                  onLoadedData={handleIncomingReady}
                  onEnded={handleMediaEnd}
                  style={{ objectPosition: '50% 15%' }}
                  className="w-full h-full object-cover rounded-[18px]"
                />
              ) : (
                <img
                  key={currentMediaIndex}
                  src={activeMedia.url}
                  onLoad={handleIncomingReady}
                  style={{ objectPosition: '50% 15%' }}
                  className="w-full h-full object-cover rounded-[18px]"
                />
              )}
            </div>

            {/* Super slight dark tint overlay */}
            <div className="absolute inset-0 bg-black/25 pointer-events-none rounded-[18px] z-20" />

            {/* Premium left-side cinematic vignette shadow (55% width to provide ample readability coverage for text overlays) */}
            <div className="absolute inset-y-0 left-0 w-[55%] bg-gradient-to-r from-black/75 via-black/35 to-transparent pointer-events-none rounded-l-[18px] z-20" />

            {/* Dynamic Branding Text and Button Overlay (Left Side, above Vignette, below story bars) */}
            {activeMedia.title && (
              <div 
                style={{ 
                  transition: 'opacity 800ms ease-in-out, max-width 280ms cubic-bezier(0.32, 0.72, 0, 1)',
                  maxWidth: isSidebarCollapsed ? '38%' : '50%'
                }}
                className={`absolute left-10 bottom-14 z-30 flex flex-col items-start text-left select-text ${isFading ? 'opacity-0' : 'opacity-100'}`}
              >
                {/* Big Title */}
                <h2 className="text-white font-['Google_Sans',_sans-serif] text-[40px] font-medium leading-[1.15] tracking-tight mb-3">
                  {activeMedia.title}
                </h2>

                {/* Description */}
                <p className="text-white/80 font-['Google_Sans',_sans-serif] text-[15px] font-normal leading-relaxed tracking-normal max-w-[540px] mb-6">
                  {activeMedia.description}
                </p>

                {/* Rounded Pill Button */}
                {activeMedia.buttonText && (
                  <button
                    onClick={() => {
                      if (activeMedia.buttonText === 'Create a Project') {
                        handleCreateNewProject();
                      } else {
                        onPromptSubmit?.('', 'design');
                      }
                    }}
                    className="h-11 px-6 bg-white hover:bg-white/90 active:bg-white/80 text-black font-['Google_Sans',_sans-serif] text-[14px] font-medium rounded-full flex items-center justify-center transition-all hover:scale-[1.03] active:scale-[0.97] shadow-lg cursor-pointer"
                  >
                    {activeMedia.buttonIcon === 'character' && (
                      <svg className="w-[14px] h-[14px] text-black mr-2 fill-current" viewBox="9 8 82 82">
                        <circle cx="50" cy="18" r="10" />
                        <path d="M 86 31.5 L 50 36 L 14 31.5 L 14 39.5 L 39 42.625 L 39 90 L 46 90 L 46 62 L 54 62 L 54 90 L 61 90 L 61 42.625 L 86 39.5 Z" />
                      </svg>
                    )}
                    {activeMedia.buttonIcon === 'compass' && (
                      <svg className="w-[14px] h-[14px] text-black mr-2 fill-none stroke-current" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="10" />
                        <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" className="fill-current text-black" />
                      </svg>
                    )}
                    {activeMedia.buttonText}
                  </button>
                )}
              </div>
            )}

            {/* Static Decorative Prompt Box Overlay (Only visible for Slide 3) */}
            {currentMediaIndex === 2 && (
              <div 
                style={{ transition: 'opacity 800ms ease-in-out' }}
                className={`absolute right-10 top-1/2 -translate-y-1/2 w-[420px] bg-[#141517]/90 backdrop-blur-[80px] rounded-[22px] pt-3 pb-2 px-3 shadow-2xl border border-white/5 flex flex-col select-none pointer-events-none z-30 transition-opacity duration-800 ease-in-out ${isFading ? 'opacity-0' : 'opacity-100'}`}
              >
                {/* Top prompt text area resembling textarea */}
                <div className="relative flex items-start w-full">
                  <div className="bg-transparent border-none outline-none text-[14px] font-medium text-white placeholder-[#606060] w-full pl-1 py-0.5 leading-relaxed font-sans">
                    Give me 16 different camera angles of this shot
                  </div>
                </div>

                {/* Bottom row toolbar resembling flex mt-2.5 */}
                <div className="flex items-center justify-between mt-2.5">
                  {/* Left Controls */}
                  <div className="flex items-center gap-2.5 relative">
                    <button className="text-[#a0a0a0] transition-colors ml-0 outline-none flex items-center justify-center">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-[22px] h-[22px]">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                    </button>
                    <button className="flex items-center justify-center h-9 transition-colors rounded-full px-4 border bg-white text-black border-transparent overflow-visible">
                      <span className="text-[11px] font-semibold tracking-wide text-black">Agent</span>
                    </button>
                  </div>

                  {/* Right Controls */}
                  <div className="flex items-center gap-2.5 relative">
                    <div className="flex items-center gap-1">
                      {/* Document with Sparkle Button */}
                      <button className="flex items-center justify-center w-9 h-9 rounded-full text-[#a0a0a0] transition-colors outline-none">
                        <svg viewBox="16 10 76 76" className="w-5 h-5 text-[#a0a0a0]">
                          <path 
                            d="M 52,24 L 28,24 A 4,4 0 0,0 24,28 L 24,72 A 4,4 0 0,0 28,76 L 72,76 A 4,4 0 0,0 76,72 L 76,52" 
                            fill="none" 
                            stroke="currentColor" 
                            strokeWidth="6" 
                            strokeLinecap="round"
                          />
                          <g fill="currentColor">
                            <rect x="34" y="34" width="18" height="6" rx="1" />
                            <rect x="34" y="47" width="30" height="6" rx="1" />
                            <rect x="34" y="60" width="18" height="6" rx="1" />
                            <path d="M 72,16 Q 72,32 56,32 Q 72,32 72,48 Q 72,32 88,32 Q 72,32 72,16 Z" />
                          </g>
                        </svg>
                      </button>

                      {/* Settings Sliders Button */}
                      <button className="flex items-center justify-center w-9 h-9 rounded-full text-[#a0a0a0] transition-colors outline-none">
                        <svg viewBox="0 0 100 100" className="w-5 h-5 text-[#a0a0a0]">
                          <g fill="currentColor">
                            {/* Top Row */}
                            <rect x="14" y="22" width="40" height="8" rx="1.5" />
                            <rect x="62" y="14" width="8" height="24" rx="1.5" />
                            <rect x="70" y="22" width="16" height="8" rx="1.5" />
                            
                            {/* Middle Row */}
                            <rect x="14" y="46" width="16" height="8" rx="1.5" />
                            <rect x="30" y="38" width="8" height="24" rx="1.5" />
                            <rect x="46" y="46" width="40" height="8" rx="1.5" />
                            
                            {/* Bottom Row */}
                            <rect x="14" y="70" width="24" height="8" rx="1.5" />
                            <rect x="46" y="62" width="8" height="24" rx="1.5" />
                            <rect x="54" y="70" width="32" height="8" rx="1.5" />
                          </g>
                        </svg>
                      </button>
                    </div>

                    {/* Circular White Send Arrow Button */}
                    <button className="flex items-center justify-center w-9 h-9 rounded-full transition-all border border-transparent bg-white text-black shadow-md">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-black">
                        <line x1="5" y1="12" x2="19" y2="12" />
                        <polyline points="12 5 19 12 12 19" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Symmetrical Sequential Story Timeline Progress Bars (Lower Left Area) */}
            <div className="absolute bottom-5 left-6 flex items-center gap-[6px] z-40 select-none">
              {mediaPlaylist.map((_, idx) => {
                let fillWidth = '0%';
                if (idx < currentMediaIndex) {
                  fillWidth = '100%';
                } else if (idx === currentMediaIndex) {
                  fillWidth = `${progress}%`;
                }

                return (
                  <div 
                    key={idx}
                    className="w-[60px] h-[3px] bg-white/25 rounded-full overflow-hidden relative cursor-pointer hover:bg-white/40 transition-colors"
                    onClick={() => {
                      if (idx !== currentMediaIndex) {
                        triggerTransition(idx);
                      }
                    }}
                  >
                    <div 
                      style={{ 
                        width: fillWidth,
                        transition: idx === currentMediaIndex 
                          ? 'none' 
                          : 'width 400ms ease-in-out'
                      }}
                      className="h-full bg-white rounded-full"
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-x-4 gap-y-6 w-full mt-6 pb-[179px] shrink-0">
            {projectsList.map((proj, idx) => {
              const isEditing = editingProjectId === proj.id;
              return (
                <div key={proj.id} onClick={() => onProjectSelect?.(proj.id)} className="flex flex-col group cursor-pointer relative">
                  {/* 16:9 Image placeholder container with independent rounded-[18px], border-white/10, and high z-index */}
                  <div className="w-full aspect-video rounded-[18px] border border-white/10 bg-[#2c2c2e] overflow-hidden relative z-10 flex items-center justify-center transition-all duration-300 shadow-md">
                    {(coverUrls[proj.id] || proj.coverUrl) ? (
                      isCoverVideo(coverUrls[proj.id] || proj.coverUrl) ? (
                        <video 
                          src={coverUrls[proj.id] || proj.coverUrl} 
                          className="w-full h-full object-cover" 
                          autoPlay 
                          loop 
                          muted 
                          playsInline 
                        />
                      ) : (
                        <img 
                          src={coverUrls[proj.id] || proj.coverUrl} 
                          className="w-full h-full object-cover" 
                          alt={proj.name} 
                        />
                      )
                    ) : (
                      <div className="w-full h-full bg-[#2c2c2e]" />
                    )}
                  </div>
                  
                  {/* Connected Caption info: extends up under the 16:9 card z-axially (z-0, -mt-[18px], h-[58px], pt-[18px]) to hide top square corners but align seamlessly on hover (using a background-friendly prominent highlight bg-white/[0.06]) */}
                  <div className={`relative z-0 -mt-[18px] h-[58px] pt-[18px] px-4 rounded-b-[18px] flex items-center transition-all duration-300 select-none ${isEditing ? 'bg-white/[0.06]' : 'bg-transparent group-hover:bg-white/[0.06]'}`}>
                    <div className="flex items-center w-full">
                      {isEditing ? (
                        <div className="flex items-center w-full" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="text"
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                if (editingValue.trim()) {
                                  persistProjectRename(proj.id, editingValue);
                                }
                                setEditingProjectId(null);
                              } else if (e.key === 'Escape') {
                                setEditingProjectId(null);
                              }
                            }}
                            className="bg-transparent border-none outline-none text-white font-sans text-[13px] font-medium w-full mr-2"
                            autoFocus
                          />
                          
                          {/* Checkmark Save Button (circle appears on hover) */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (editingValue.trim()) {
                                persistProjectRename(proj.id, editingValue);
                              }
                              setEditingProjectId(null);
                            }}
                            className="w-7 h-7 rounded-full bg-transparent hover:bg-white/10 flex items-center justify-center border-none outline-none cursor-pointer"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 text-white/80 hover:text-white transition-colors">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </button>

                          {/* Cross Cancel Button (circle appears on hover) */}
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingProjectId(null);
                            }}
                            className="w-7 h-7 rounded-full bg-transparent hover:bg-white/10 flex items-center justify-center border-none outline-none cursor-pointer ml-1"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 text-white/80 hover:text-white transition-colors">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </div>
                      ) : (
                        <>
                          <span className="text-white font-sans text-[13px] font-medium no-underline decoration-transparent truncate flex-1 min-w-0 mr-2">{proj.name}</span>
                          
                          {/* Circle Edit Pencil Icon (only visible on hover, circle appears on button hover) */}
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingProjectId(proj.id);
                              setEditingValue(proj.name);
                            }}
                            className="w-7 h-7 rounded-full bg-transparent hover:bg-white/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 ml-2 border-none outline-none cursor-pointer"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 text-white/80 hover:text-white transition-colors">
                              <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                            </svg>
                          </button>

                          {/* Trash Bin Delete Icon (only visible on hover, aligned far right, circle appears on button hover) */}
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();

                              // 1. Delete from IndexedDB (media items + covers)
                              await deleteProjectData(proj.id);

                              // 2. Delete from file system (if connected)
                              await deleteLocalFSProject(proj.id, proj.name);

                              // 3. Delete from localStorage and update UI
                              const stored = localStorage.getItem('willow_projects_list');
                              if (stored) {
                                const list = JSON.parse(stored);
                                const updated = list.filter((p: any) => p.id !== proj.id);
                                localStorage.setItem('willow_projects_list', JSON.stringify(updated));
                                window.dispatchEvent(new Event('willow_projects_updated'));
                              }

                              // 4. Update local component state
                              setProjectsList(prev => prev.filter(p => p.id !== proj.id));
                            }}
                            className="w-7 h-7 rounded-full bg-transparent hover:bg-white/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 ml-auto border-none outline-none cursor-pointer"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 text-white/70 hover:text-white transition-colors">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Fixed Bottom Centered + New project Button */}
          <div 
            style={{
              position: 'fixed',
              bottom: '32px',
              left: isSidebarCollapsed ? 'calc(50vw + 32px)' : 'calc(50vw + 130px)',
              transform: 'translateX(-50%)',
              transition: 'left 280ms cubic-bezier(0.32, 0.72, 0, 1)',
              zIndex: 50
            }}
          >
            <button
              onClick={handleCreateNewProject}
              className="w-[180px] h-[115px] bg-[#38383a]/90 backdrop-blur-md hover:bg-[#48484a] active:bg-[#2c2c2e] border border-white/10 rounded-[1.5rem] flex items-center justify-center shadow-[0_15px_35px_rgba(0,0,0,0.6)] transition-all duration-300 hover:scale-[1.03] active:scale-[0.97] group cursor-pointer"
            >
              <span className="text-[#cacaca] group-hover:text-white transition-colors duration-300 text-[15px] font-semibold tracking-tight flex items-center gap-2 select-none">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-[#cacaca] group-hover:text-white transition-colors duration-300">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                New Project
              </span>
            </button>
          </div>
        </>
      ) : (
        <>
          {/* Main Heading */}
          <h1 className={`text-white text-center transition-all duration-300 ${background === 'solid' ? 'text-[26px] font-medium tracking-normal mb-8' : 'text-2xl md:text-3xl font-bold tracking-tight mb-10 drop-shadow-sm'}`}>
            {getHeadingText()}
          </h1>

          {/* Input Component */}
          <InputBar
            currentMode={mode}
            onModeChange={setMode}
            onSubmit={onPromptSubmit}
            modelConfig={modelConfig}
            selectedModelId={selectedModelId}
            setSelectedModelId={setSelectedModelId}
            onAuthRequired={onAuthRequired}
            isAuthenticated={isAuthenticated}
            agentSwarmEnabled={agentSwarmEnabled}
            onSwarmToggle={onSwarmToggle}
            chatVariant={initialMode === 'chat'}
            onStartLive={onStartLive}
          />
        </>
      )}
    </div>
  );
};