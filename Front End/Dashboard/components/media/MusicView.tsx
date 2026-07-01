import React, { useState, useRef } from 'react';
import { ArrowLeft, ArrowRight, Plus, Upload, X, ChevronDown, Heart, Trash2, History, Pencil, Wand2 } from 'lucide-react';
import { AssetMenuModal } from '../AssetMenuModal';
import { Avatar } from '../ui/Avatar';
import { useAuth } from '../../context/AuthContext';
import { useUserDataContext } from '../../context/UserDataContext';
import { getGeminiClient } from '../../lib/ai';
 
interface MusicViewProps {
  onBack: () => void;
  mediaItems: any[];
  onFileSelect?: () => void;
  modelMode: 'image' | 'video'; // might need to remove this or keep it if passed from parent
  activeModelId: string;
  onModelChange: (id: any) => void;
}

const sampleMusic = [
  {
    title: 'The Anthem',
    description: 'An uplifting, cinematic orchestral piece perfect for big reveals and triumphant moments.',
    image: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&q=80'
  },
  {
    title: 'Neon Nights',
    description: 'A synthwave banger with driving bass and retro-futuristic melodies. Ideal for action or driving scenes.',
    image: 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=400&q=80'
  },
  {
    title: 'Quiet Rain',
    description: 'A soft, contemplative piano track that sets a melancholic or peaceful mood.',
    image: 'https://images.unsplash.com/photo-1520523839897-bd0b52f945a0?w=400&q=80'
  },
  {
    title: 'Urban Groove',
    description: 'A funky, upbeat hip-hop beat with a strong rhythm section. Great for energetic montages.',
    image: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=400&q=80'
  }
];

export const MusicView: React.FC<MusicViewProps> = ({ 
  onBack, 
  mediaItems, 
  onFileSelect, 
  modelMode,
  activeModelId,
  onModelChange
}) => {
  const { userProfile, user } = useAuth();
  const { apiKeys } = useUserDataContext();
  
  // Core View State: 'initial' = Grid view, 'editor' = Creating/Editing a track
  const [viewState, setViewState] = useState<'initial' | 'editor'>('initial');
  
  // Generation State inside Editor
  const [coverStatus, setCoverStatus] = useState<'idle' | 'generating' | 'completed'>('idle');
  const [musicStatus, setMusicStatus] = useState<'idle' | 'generating' | 'completed'>('idle');
  const [progress, setProgress] = useState(0);

  // Prompt states
  const [prompt, setPrompt] = useState('');
  const [editPrompt, setEditPrompt] = useState('');
  
  // Editor UI states
  const [isProducerActive, setIsProducerActive] = useState(true);
  const [isAssetMenuOpen, setIsAssetMenuOpen] = useState(false);
  const assetMenuPlusRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const localFileInputRef = useRef<HTMLInputElement>(null);

  const [isLocalDropdownOpen, setIsLocalDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Editor Music Info
  const [musicInfo, setMusicInfo] = useState('');
  const [musicImage, setMusicImage] = useState<string | null>(null);

  // Lyrics & Audio State
  const [lyrics, setLyrics] = useState<{text: string; time: number}[]>([]);
  const [songTitle, setSongTitle] = useState('Untitled Music');
  const [songArtist, setSongArtist] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const leftBlockRef = useRef<HTMLDivElement>(null);
  const editorContentRef = useRef<HTMLDivElement>(null);
  const [leftGap, setLeftGap] = useState(64);

  React.useEffect(() => {
    if (viewState !== 'editor' || musicStatus !== 'completed') return;

    const calculateGap = () => {
      if (leftBlockRef.current && editorContentRef.current) {
        const coverRect = leftBlockRef.current.getBoundingClientRect();
        const T = coverRect.top;
        if (T > 0) {
          setLeftGap(T);
        }
      }
    };

    calculateGap();
    
    const intervals = [50, 100, 300, 500, 1000];
    const timers = intervals.map(delay => setTimeout(calculateGap, delay));

    window.addEventListener('resize', calculateGap);
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener('resize', calculateGap);
    };
  }, [viewState, musicStatus, lyrics]);

  // Calculate active lyric index to prevent scroll jank
  const activeLyricIndex = React.useMemo(() => {
    return lyrics.findIndex((line, i) => {
      return currentTime >= line.time && (i === lyrics.length - 1 || currentTime < lyrics[i + 1].time);
    });
  }, [currentTime, lyrics]);

  // Auto-scroll lyrics only when the active line changes
  React.useEffect(() => {
    if (lyricsContainerRef.current && activeLyricIndex !== -1) {
      const activeLyric = lyricsContainerRef.current.querySelector('[data-active="true"]');
      if (activeLyric) {
        activeLyric.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
      }
    }
  }, [activeLyricIndex]);

  const handleExitEditor = () => {
    setIsPlaying(false);
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setViewState('initial');
  };

  // Synchronize dynamic time updates via audio element directly
  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
      setDuration(audioRef.current.duration || 0);
    }
  };

  const models = [
    { id: 'lyria-3-pro', name: 'Lyria 3 Pro' },
    { id: 'lyria-3', name: 'Lyria 3' },
    { id: 'lyria-realtime', name: 'Lyria RealTime' }
  ];

  const getActiveModelName = () => {
    return models.find(m => m.id === activeModelId)?.name || 'Lyria 3 Pro';
  };

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsLocalDropdownOpen(false);
      }
    };
    if (isLocalDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isLocalDropdownOpen]);

  React.useEffect(() => {
    const adjustHeight = () => {
      if (textareaRef.current) {
        const el = textareaRef.current;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 384)}px`;
      }
    };
    adjustHeight();
    const timer = setTimeout(adjustHeight, 200);
    return () => clearTimeout(timer);
  }, [prompt, editPrompt]);

  const hasActiveAttachments = attachments.length > 0 && !attachments.every(att => removingIds.has(att.id));

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const newAttachments = Array.from(e.target.files)
      .filter(file => file.type.startsWith('image/'))
      .map(file => ({
        id: Math.random().toString(36).substring(7),
        url: URL.createObjectURL(file),
        name: file.name,
        file,
        kind: 'image'
      }));
    setAttachments(prev => [...prev, ...newAttachments]);
    if (localFileInputRef.current) localFileInputRef.current.value = '';
  };

  const removeAttachment = (id: string) => {
    setRemovingIds(prev => new Set(prev).add(id));
    setTimeout(() => {
      setAttachments(prev => {
        const item = prev.find(att => att.id === id);
        if (item?.url?.startsWith('blob:')) {
          try { URL.revokeObjectURL(item.url); } catch {}
        }
        return prev.filter(att => att.id !== id);
      });
      setRemovingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 200);
  };

  const handleUploadClick = () => {
    if (localFileInputRef.current) {
      localFileInputRef.current.click();
    } else if (onFileSelect) {
      onFileSelect();
    }
  };

  const handleAddPrompt = (assetId: string, assetUrl?: string, assetTitle?: string, assetKind?: 'image' | 'video') => {
    if (assetUrl) {
      setAttachments(prev => {
        if (prev.some(att => att.url === assetUrl)) return prev;
        return [...prev, {
          id: assetId,
          url: assetUrl,
          name: assetTitle || 'Attached Asset',
          kind: assetKind || 'image'
        }];
      });
    } else if (assetTitle) {
      setPrompt(prev => {
        const separator = prev.trim() ? ' ' : '';
        return `${prev.trim()}${separator}[${assetTitle}]`;
      });
    }
  };

  // Simulate Dual Generation process & fetch real lyrics + real Imagen cover
  const startGeneration = async () => {
    const finalPrompt = editPrompt.trim() || prompt.trim();
    if (!finalPrompt) return;
    setViewState('editor');
    setCoverStatus('generating');
    setMusicStatus('generating');
    setProgress(0);
    setMusicImage(null);
    setLyrics([]);
    setSongTitle('Generating...');
    setSongArtist('');
    setIsPlaying(false);
    setCurrentTime(0);
    setAudioSrc(null);
    
    // Start interval for progress bar
    const totalDuration = 6000;
    const coverDuration = 3000; 
    const interval = 100;
    let elapsed = 0;
    
    const timer = setInterval(() => {
      elapsed += interval;
      const pct = Math.min(99, Math.floor((elapsed / totalDuration) * 100));
      setProgress(pct);
    }, interval);

    // Local prompt-based title generator as a robust dynamic fallback
    const getFallbackTitle = (userPrompt: string) => {
      const words = userPrompt
        .replace(/generate|song|music|lyrics|track|write|make|create|lyria|vocal|vocals|with/gi, '')
        .trim()
        .split(/\s+/)
        .filter(w => w.length > 0)
        .slice(0, 4)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
      return words.length > 0 ? words.join(' ') : 'Vibrant Melodies';
    };

    let activeLyrics = [];
    let activeTitle = getFallbackTitle(finalPrompt);
    let activeArtist = 'Lyria';
    let generatedAudioUrl = null;

    let lyriaLyrics = "";
    
    // Call Google Lyria 3 Pro API via recommended Interactions endpoint using user's active API key!
    try {
      if (apiKeys?.gemini?.[0]) {
        const apiModelId = activeModelId === 'lyria-3' ? 'lyria-3-clip-preview' : 'lyria-3-pro-preview';
        const musicResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/interactions?key=${apiKeys.gemini[0]}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: apiModelId,
              input: `Generate a complete song with vocals and backing tracks based on the prompt: "${finalPrompt}". Format the response with lyrics structure and high-quality stereo audio.`
            })
          }
        );

        if (musicResponse.ok) {
          const musicData = await musicResponse.json();
          // Parse Lyria Interactions output steps
          let audioBase64 = null;
          
          if (musicData?.steps) {
            for (const step of musicData.steps) {
              if (step.type === 'model_output' && step.content) {
                for (const contentBlock of step.content) {
                  if (contentBlock.type === 'audio') {
                    audioBase64 = contentBlock.data;
                  } else if (contentBlock.type === 'text') {
                    lyriaLyrics += contentBlock.text + "\\n";
                  }
                }
              }
            }
          }
          if (audioBase64) {
            generatedAudioUrl = `data:audio/mp3;base64,${audioBase64}`;
            setAudioSrc(generatedAudioUrl);
          }
        }
      }
    } catch (e) {
      console.error("Lyria API call failed:", e);
    }

    if (!generatedAudioUrl) {
      console.error("Lyria generation failed. No audio returned.");
      alert("Lyria 3 Generation Failed: Please check your API key and quotas.");
      setMusicStatus('idle');
      setCoverStatus('idle');
      setProgress(0);
      clearInterval(timer);
      return;
    }

    // Parse timestamps locally from Lyria output for 100% accurate syncing
    if (lyriaLyrics.trim()) {
       const rawLines = lyriaLyrics.split('\n');
       let fallbackTime = 0;
       
       rawLines.forEach(line => {
         const txt = line.trim();
         if (!txt) return;
         
         // Match formats like [00:15.50], [0:15], [15.5]
         const timeMatch = txt.match(/^\[(?:(\d+):)?(\d+(?:\.\d+)?)\]\s*(.*)/);
         if (timeMatch) {
           const mins = timeMatch[1] ? parseInt(timeMatch[1], 10) : 0;
           const secs = parseFloat(timeMatch[2]);
           let text = timeMatch[3].replace(/\\n/g, '').trim();
           const timeInSeconds = mins * 60 + secs;
           
           if (text) {
             activeLyrics.push({ time: timeInSeconds, text });
             fallbackTime = timeInSeconds + 4;
           }
         } else {
           let text = txt.replace(/^\[.*?\]\s*/, '').replace(/\\n/g, '').trim();
           if (text) {
             activeLyrics.push({ time: fallbackTime, text });
             fallbackTime += 4;
           }
         }
       });
    }

    // Call Gemini strictly to analyze lyrics and invent a highly creative Song Title
    try {
      if (apiKeys?.gemini?.[0]) {
        const titlePrompt = `You are an elite music creative director. Analyze the user's prompt and the complete song lyrics below:

User Prompt: "${finalPrompt}"
Complete Song Lyrics:
${lyriaLyrics}

TASK:
Your task is to select/invent a highly creative, catchy, and cinematic song title based on the following prioritizations:

1. FIRST PRIORITY: Check the User Prompt. If the user explicitly requested or named a specific title (e.g., "called 'My Song'", "titled 'Summer Vibe'", "song called 'X'"), extract and use that exact title name!
2. SECOND PRIORITY: If no specific title was requested in the prompt, analyze the "Chorus" section of the lyrics. Prioritize finding a strong, repeating, or iconic phrase from the chorus to use as the title.
3. THIRD PRIORITY: If there is no chorus or a title cannot be found there, search the other lines of the lyrics. The title MUST be a phrase present verbatim (or extremely close) in the lyrics.

CRITICAL RULES:
- The title should feel natural and fit standard song naming conventions.
- Do NOT include any genre descriptors or style tags (such as "synthwave", "lofi", "acoustic", "rock", "pop", "metal", "electronic", "instrumental", "rap", "jazz", "vocals", "tempo") unless it was part of the user's explicit requested title name in Priority 1.
- Return ONLY the clean plain text title itself, with NO quotes, NO explanation, NO introduction, and NO punctuation.`;

        const titleResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKeys.gemini[0]}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [{ text: titlePrompt }]
              }],
              generationConfig: {
                thinkingConfig: {
                  thinkingLevel: 'medium'
                }
              }
            })
          }
        );

        if (titleResponse.ok) {
          const titleData = await titleResponse.json();
          let generatedTitle = titleData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (generatedTitle) {
            generatedTitle = generatedTitle.replace(/^["'`\s\.]+|["'`\s\.]+$/g, '');
            if (generatedTitle && generatedTitle !== 'Untitled' && !generatedTitle.includes('{')) {
              activeTitle = generatedTitle;
            }
          }
        }
      }
    } catch (e) {
      console.error("Failed to fetch track title via Gemini API:", e);
    }

    setSongTitle(activeTitle);
    setSongArtist(activeArtist);
    setLyrics(activeLyrics);

    // Generate real cover art via Google Imagen API using the dynamic title!
    let generatedImage = null;
    try {
      if (apiKeys?.gemini?.[0]) {
        const imgResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:predict?key=${apiKeys.gemini[0]}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              instances: [
                { prompt: `A professional music album cover art for an album track titled "${activeTitle}" by "${activeArtist}" based on the vibe: "${finalPrompt}". Highly detailed, cinematic, premium album cover design.` }
              ],
              parameters: {
                sampleCount: 1
              }
            })
          }
        );
        
        if (imgResponse.ok) {
          const data = await imgResponse.json();
          if (data?.predictions?.[0]?.bytesBase64Encoded) {
             generatedImage = `data:image/jpeg;base64,${data.predictions[0].bytesBase64Encoded}`;
          }
        }
      }
    } catch (e) {
      console.error("Failed real image generation via API:", e);
    }

    let finalImageUrl = "";
    if (generatedImage) {
      finalImageUrl = generatedImage;
    } else {
      const encodedPrompt = encodeURIComponent(finalPrompt + ' music album cover art masterpiece');
      finalImageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=800&height=800&nologo=true&seed=${Math.floor(Math.random() * 1000)}`;
    }

    // Preload the image fully in background before transitioning state, ensuring perfectly synced loading
    await new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = () => resolve();
      img.src = finalImageUrl;
    });

    setMusicImage(finalImageUrl);
    clearInterval(timer);
    setProgress(100);
    setCoverStatus('completed');
    setMusicStatus('completed');
  };

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

  const formatTime = (time: number) => {
    if (isNaN(time)) return '0:00';
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (viewState === 'editor') {
    return (
      <div 
        className="relative flex flex-col h-screen w-screen bg-[#000000] text-gray-200 overflow-hidden"
        style={{ fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif" }}
      >
        {/* Editor Header */}
        <header className="absolute top-0 left-0 right-0 h-16 flex items-center justify-between px-4 shrink-0 z-[80] bg-transparent">
          <div className="flex items-center gap-4">
            <button 
              onClick={handleExitEditor}
              className="p-3 hover:bg-white/10 rounded-full transition-colors flex items-center gap-3 group cursor-pointer"
            >
              <ArrowLeft size={22} className="text-white group-hover:-translate-x-1 transition-transform" />
              <span className="text-sm font-medium text-white tracking-wide">{songTitle}</span>
            </button>
          </div>

          <div className="flex items-center gap-4">
            <button className="p-2 hover:bg-white/10 rounded-full transition-colors cursor-pointer text-gray-300 hover:text-white">
              <Heart size={18} strokeWidth={2} />
            </button>
            <button className="p-2 hover:bg-white/10 rounded-full transition-colors cursor-pointer text-gray-300 hover:text-white">
              <Trash2 size={18} strokeWidth={2} />
            </button>
            <button className="flex items-center gap-2 h-9 px-4 rounded-full bg-white/5 hover:bg-white/10 transition-colors border border-white/5 cursor-pointer">
              <History size={16} className="text-gray-300" />
              <span className="text-sm font-medium text-white">Show history</span>
            </button>
            <button onClick={handleExitEditor} className="h-9 px-5 rounded-full bg-white hover:bg-gray-200 text-black font-semibold text-sm transition-colors cursor-pointer">
              Done
            </button>
          </div>
        </header>

        {/* Editor Main Content: Three Column Layout when completed or generating */}
        <div 
          ref={editorContentRef}
          className={`absolute top-16 bottom-[40px] left-0 right-0 flex ${(musicStatus === 'completed' || musicStatus === 'generating') ? 'flex-row items-center justify-start px-0 gap-0' : 'flex-col items-center justify-center px-8'}`}
        >
          
          {/* Left Column / Center generating block */}
          <div 
            ref={leftBlockRef}
            style={(musicStatus === 'completed' || musicStatus === 'generating') ? { 
              paddingLeft: `${leftGap}px`, 
              paddingRight: `${leftGap}px`,
              width: `${450 + leftGap * 2}px`
            } : {}}
            className={`flex flex-col ${(musicStatus === 'completed' || musicStatus === 'generating') ? 'items-start shrink-0 mb-0' : 'items-center mb-8'} animate-in fade-in duration-700`}
          >

            {/* 1:1 Cover Art Container */}
            <div className={`relative ${(musicStatus === 'completed' || musicStatus === 'generating') ? 'w-[450px] h-[450px]' : 'w-[400px] h-[400px]'} shrink-0 rounded-[16px] bg-[#1a1b1f] overflow-hidden shadow-2xl border border-white/5 mb-8 transition-all duration-700`}>
              {coverStatus === 'generating' ? (
                <div className="absolute inset-0 z-10 mesh-container-generating">
                  <style dangerouslySetInnerHTML={{ __html: `
                    .mesh-container-generating {
                      position: absolute;
                      inset: 0;
                      border-radius: 24px;
                      background-color: #1a1b1f;
                      overflow: hidden;
                    }
                    .mesh-blob {
                      position: absolute;
                      border-radius: 50%;
                      filter: blur(45px); 
                      opacity: 0.85;
                      will-change: transform;
                    }
                    .blob-1 { top: -20%; left: -20%; width: 80%; height: 80%; background-color: #a3a8b5; animation: move1 8s infinite ease-in-out; }
                    .blob-2 { bottom: -20%; right: -20%; width: 70%; height: 70%; background-color: #757a87; animation: move2 9s infinite ease-in-out; }
                    .blob-3 { top: -15%; left: -15%; width: 65%; height: 65%; background-color: #12141a; animation: move3 13s infinite ease-in-out; }
                    .blob-4 { bottom: 10%; left: 10%; width: 60%; height: 60%; background-color: #c2c6d1; animation: move4 15s infinite ease-in-out; z-index: 2; }
                    .blob-5 { bottom: -15%; right: -15%; width: 70%; height: 70%; background-color: #0d0f14; animation: move5 17s infinite ease-in-out; }
                    @keyframes move1 { 0% { transform: translate(0, 0) scale(1); } 33% { transform: translate(25%, 15%) scale(1.05); } 66% { transform: translate(-10%, 25%) scale(0.95); } 100% { transform: translate(0, 0) scale(1); } }
                    @keyframes move2 { 0% { transform: translate(0, 0) scale(1); } 33% { transform: translate(-25%, -15%) scale(0.95); } 66% { transform: translate(15%, -25%) scale(1.05); } 100% { transform: translate(0, 0) scale(1); } }
                    @keyframes move3 { 0% { transform: translate(0, 0) scale(1); } 33% { transform: translate(70%, 20%) scale(1.15); } 66% { transform: translate(20%, 70%) scale(0.85); } 100% { transform: translate(0, 0) scale(1); } }
                    @keyframes move4 { 0% { transform: translate(0, 0) scale(1); } 33% { transform: translate(-20%, 20%) scale(1.1); } 66% { transform: translate(30%, -15%) scale(0.9); } 100% { transform: translate(0, 0) scale(1); } }
                    @keyframes move5 { 0% { transform: translate(0, 0) scale(1); } 33% { transform: translate(-80%, -30%) scale(1.1); } 66% { transform: translate(-10%, -80%) scale(0.9); } 100% { transform: translate(0, 0) scale(1); } }
                  `}} />
                  <div className="mesh-blob blob-1"></div>
                  <div className="mesh-blob blob-2"></div>
                  <div className="mesh-blob blob-3"></div>
                  <div className="mesh-blob blob-4"></div>
                  <div className="mesh-blob blob-5"></div>
                  {/* No intrusive text overlays on liquidy animation */}
                </div>
              ) : (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#1c1c1e]">
                   {musicImage && (
                     <img src={musicImage} alt="Music Cover" className="w-full h-full object-cover transition-opacity duration-1000" />
                   )}
                </div>
              )}
            </div>

            {/* Left Column Controls & Info */}
            {(musicStatus === 'completed' || musicStatus === 'generating') && (
               <div className={`w-full flex flex-col gap-4 px-2 ${musicStatus === 'generating' ? 'opacity-40 pointer-events-none' : ''}`}>
                  <style dangerouslySetInnerHTML={{ __html: `
                    .shimmer-container {
                      background: rgba(255, 255, 255, 0.03);
                    }
                    .shimmer-sweep {
                      position: absolute;
                      inset: 0;
                      transform: translateX(-100%);
                      background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.05) 50%, transparent);
                      animation: shimmer-anim 1.6s infinite;
                    }
                    @keyframes shimmer-anim {
                      100% { transform: translateX(100%); }
                    }
                  `}} />
                  <div className="flex flex-col">
                     <h1 className="text-[32px] font-bold text-white flex items-center gap-3 leading-tight tracking-tight" style={{ fontFamily: '"Google Sans", sans-serif' }}>
                        {musicStatus === 'generating' ? (
                           <div className="w-56 h-[38px] bg-white/5 rounded-lg overflow-hidden relative shimmer-container">
                              <div className="shimmer-sweep"></div>
                           </div>
                        ) : (
                           <>
                              {songTitle}
                              <button className="text-gray-500 hover:text-white transition-colors cursor-pointer"><Pencil size={20} /></button>
                           </>
                        )}
                     </h1>
                     <span className="text-[20px] text-gray-400 font-medium mt-1 tracking-tight">
                        {musicStatus === 'generating' ? (
                           <div className="w-36 h-6 bg-white/5 rounded-md mt-2 overflow-hidden relative shimmer-container">
                              <div className="shimmer-sweep"></div>
                           </div>
                        ) : (
                           songArtist
                        )}
                     </span>
                  </div>
                 
                 {/* Progress Bar */}
                 <div className="w-full flex items-center gap-4 mt-2">
                    <span className="text-xs text-gray-400 font-semibold w-8 text-right">{formatTime(currentTime)}</span>
                    <div 
                      className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden relative cursor-pointer group"
                      onClick={(e) => {
                        if (audioRef.current && duration) {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const pct = (e.clientX - rect.left) / rect.width;
                          audioRef.current.currentTime = pct * duration;
                        }
                      }}
                    >
                      <div 
                        className="absolute top-0 left-0 bottom-0 bg-white rounded-full transition-all duration-100 group-hover:bg-[#a0a0a0]"
                        style={{ width: `${(currentTime / (duration || 1)) * 100}%` }}
                      ></div>
                    </div>
                    <span className="text-xs text-gray-400 font-semibold w-8">{formatTime(duration)}</span>
                 </div>
                 {/* Controls underneath the progress bar */}
                 <div className="w-full flex items-center justify-between mt-6 px-2">
                    <button className="text-gray-400 hover:text-white transition-colors cursor-pointer">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 3 21 3 21 8"></polyline><line x1="4" y1="20" x2="21" y2="3"></line><polyline points="21 16 21 21 16 21"></polyline><line x1="15" y1="15" x2="21" y2="21"></line><line x1="4" y1="4" x2="9" y2="9"></line></svg>
                    </button>
                    
                    <div className="flex items-center gap-6">
                      <button className="text-gray-400 hover:text-white transition-colors cursor-pointer">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="19 20 9 12 19 4 19 20"></polygon><line x1="5" y1="19" x2="5" y2="5"></line></svg>
                      </button>
                      
                      <button 
                        onClick={togglePlay}
                        className="w-16 h-16 rounded-full flex items-center justify-center transition-all cursor-pointer shadow-[0_10px_25px_rgba(0,0,0,0.6),inset_0_2px_4px_rgba(255,255,255,0.7),inset_0_-4px_8px_rgba(0,0,0,0.4)] border-[3px] border-[#8a8d91] hover:scale-105 active:scale-95 focus:outline-none outline-none group relative overflow-hidden"
                        style={{
                          background: 'radial-gradient(circle at 30% 30%, #f0f2f5 0%, #b0b4ba 40%, #70757d 80%, #4a4d52 100%)',
                          color: '#1a1c20'
                        }}
                      >
                        <div className="absolute inset-0 rounded-full bg-[linear-gradient(135deg,rgba(255,255,255,0.6)_0%,rgba(255,255,255,0)_50%,rgba(0,0,0,0.2)_100%)] mix-blend-overlay"></div>
                        <div className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.4),transparent_60%)]"></div>
                        
                        {isPlaying ? (
                          <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" className="relative z-10 drop-shadow-[0_2px_3px_rgba(255,255,255,0.5)]"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
                        ) : (
                          <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" className="ml-1 relative z-10 drop-shadow-[0_2px_3px_rgba(255,255,255,0.5)]"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                        )}
                      </button>
                      
                      <button className="text-gray-400 hover:text-white transition-colors cursor-pointer">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19"></line></svg>
                      </button>
                    </div>

                    <button className="text-gray-400 hover:text-white transition-colors cursor-pointer">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>
                    </button>
                 </div>
              </div>
            )}
          </div>

          {/* Audio Player Content Split */}
          {(musicStatus === 'completed' || musicStatus === 'generating') && (
             <>
               {audioSrc && (
                 <audio 
                   ref={audioRef}
                   src={audioSrc}
                   onTimeUpdate={handleTimeUpdate}
                   onLoadedMetadata={handleTimeUpdate}
                   onEnded={() => setIsPlaying(false)}
                 />
               )}

               {/* Right Column Lyrics Container */}
               <div className="flex-1 h-full flex items-center justify-center px-8">
                  <div ref={lyricsContainerRef} className="w-full max-w-[600px] h-[600px] overflow-y-auto no-scrollbar flex flex-col items-start gap-8 py-32 px-8 mask-image-linear-gradient animate-in fade-in slide-in-from-right-4 duration-700">
                     <style dangerouslySetInnerHTML={{__html: `
                       .mask-image-linear-gradient {
                         mask-image: linear-gradient(to bottom, transparent, black 25%, black 75%, transparent);
                         -webkit-mask-image: linear-gradient(to bottom, transparent, black 25%, black 75%, transparent);
                       }
                     `}} />
                     {musicStatus === 'generating' ? (
                        <>
                           <style dangerouslySetInnerHTML={{__html: `
                             .skeleton-lyric-line {
                               height: 24px;
                               position: relative;
                               border-radius: 6px;
                               background-image: radial-gradient(circle, rgba(255,255,255,0.12) 1.5px, transparent 1.5px);
                               background-size: 8px 8px;
                               opacity: 0.5;
                               animation: shimmer-glitter 3s infinite ease-in-out;
                             }
                             @keyframes shimmer-glitter {
                               0%, 100% { opacity: 0.3; transform: scale(0.99); filter: brightness(0.8); }
                               50% { opacity: 0.7; transform: scale(1.01); filter: brightness(1.2); }
                             }
                           `}} />
                           <div className="skeleton-lyric-line w-[85%]" style={{ animationDelay: '0s' }}></div>
                           <div className="skeleton-lyric-line w-[70%]" style={{ animationDelay: '0.2s' }}></div>
                           <div className="skeleton-lyric-line w-[90%]" style={{ animationDelay: '0.4s' }}></div>
                           <div className="skeleton-lyric-line w-[65%]" style={{ animationDelay: '0.6s' }}></div>
                           <div className="skeleton-lyric-line w-[80%]" style={{ animationDelay: '0.8s' }}></div>
                           <div className="skeleton-lyric-line w-[75%]" style={{ animationDelay: '1s' }}></div>
                           <div className="skeleton-lyric-line w-[85%]" style={{ animationDelay: '1.2s' }}></div>
                           <div className="skeleton-lyric-line w-[60%]" style={{ animationDelay: '1.4s' }}></div>
                        </>
                     ) : (
                        lyrics.map((line, i) => {
                           const isPast = currentTime > line.time;
                           const isCurrent = currentTime >= line.time && (i === lyrics.length - 1 || currentTime < lyrics[i + 1].time);
                           
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
                               className={`text-left cursor-pointer transition-all duration-[800ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] w-full origin-left text-[32px] font-bold tracking-tight ${
                                 isCurrent ? 'text-white opacity-100 translate-y-0 scale-100' : 
                                 isPast ? 'text-white opacity-30 -translate-y-2 scale-[0.95]' : 
                                 'text-white opacity-50 translate-y-2 scale-[0.95]'
                               }`}
                             >
                               {line.text}
                             </div>
                           );
                        })
                     )}
                     {musicStatus !== 'generating' && lyrics.length === 0 && (
                       <div className="text-gray-500 italic text-[24px] font-semibold">No lyrics available</div>
                     )}
                  </div>
               </div>
             </>
          )}

          {/* Prompt Box */}
          {musicStatus === 'idle' && (
          <div className="w-full max-w-[600px] flex justify-center">
             <div className="bg-[#141517]/90 backdrop-blur-[80px] rounded-[22px] pt-3 pb-2 px-3 flex flex-col shadow-2xl border border-white/5 w-full">
              <div className="relative flex items-start w-full">
                <textarea 
                  ref={textareaRef}
                  value={editPrompt}
                  onChange={(e) => setEditPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (editPrompt.trim() && musicStatus !== 'generating' && coverStatus !== 'generating') startGeneration();
                    }
                  }}
                  rows={1}
                  placeholder="What do you want to hear?" 
                  className="bg-transparent border-none outline-none text-[14px] font-medium text-white placeholder-[#606060] w-full pl-2 py-1 resize-none max-h-[384px] overflow-y-auto no-scrollbar transition-all duration-200"
                />
              </div>
              
              <div className="flex items-center justify-between mt-2">
                <div className="flex items-center gap-2 relative">
                  <button className="w-8 h-8 flex items-center justify-center rounded-full text-[#a0a0a0] hover:text-white hover:bg-white/5 transition-colors cursor-pointer outline-none">
                    <Plus size={20} strokeWidth={1.5} />
                  </button>
                  <button className="flex items-center gap-1.5 px-3 h-8 rounded-full text-[#a0a0a0] hover:text-white hover:bg-white/5 transition-colors cursor-pointer outline-none border border-transparent">
                    <Wand2 size={14} />
                    <span className="text-[12px] font-medium">Format</span>
                  </button>
                </div>

                <div className="flex items-center gap-2.5 relative">
                  <div className="relative" ref={dropdownRef}>
                    <button 
                      onClick={() => setIsLocalDropdownOpen(!isLocalDropdownOpen)}
                      className="flex items-center h-8 bg-[#27282b] hover:bg-[#33343a] transition-colors rounded-full px-3.5 gap-1.5 border border-transparent cursor-pointer select-none"
                    >
                      {getActiveModelName().toLowerCase().includes('banana') ? (
                        <span className="text-[11px]">🍌</span>
                      ) : null}
                      <span className="text-[11px] font-semibold text-[#d0d0d0]">
                        {getActiveModelName()}
                      </span>
                      <ChevronDown size={12} className={`text-[#a0a0a0] transition-transform duration-200 ${isLocalDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>
                    
                    {isLocalDropdownOpen && (
                      <div className="absolute bottom-[calc(100%+6px)] right-0 bg-[#141517]/95 backdrop-blur-xl rounded-[14px] p-1 flex flex-col shadow-2xl z-50 border border-white/5 min-w-[140px]">
                        {models.map(modelOpt => (
                          <button
                            key={modelOpt.id}
                            type="button"
                            onClick={() => {
                          onModelChange(modelOpt.id);
                          setIsLocalDropdownOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2 rounded-[10px] text-[12px] font-normal transition-colors ${activeModelId === modelOpt.id ? 'bg-[#4a4a4a] text-white' : 'text-[#a0a0a0] hover:text-white hover:bg-white/5'}`}
                      >
                        {modelOpt.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <button 
              onClick={() => {
                  if (editPrompt.trim() && musicStatus !== 'generating' && coverStatus !== 'generating') startGeneration();
                }}
                className={`flex items-center justify-center w-8 h-8 rounded-full bg-[#27282b] hover:bg-[#40424a] transition-all cursor-pointer ${
                  (musicStatus === 'generating' || coverStatus === 'generating') ? 'opacity-50 cursor-not-allowed' : ''
                }`}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                  <polyline points="12 5 19 12 12 19"></polyline>
                </svg>
              </button>
            </div>
          </div>
         </div>
         )}
        </div>
      </div>
    );
  }

  // Handle active audio triggers on initial view
  return (
    <div 
      className="relative flex flex-col h-screen w-screen bg-[#000000] text-gray-200 overflow-hidden"
      style={{ fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif" }}
    >
      {/* Header */}
      <header className="absolute top-0 left-0 right-0 h-16 flex items-center justify-between px-4 shrink-0 z-[80] bg-transparent">
        <div className="flex items-center gap-4 w-[330px]">
          <button 
            onClick={onBack}
            className="p-3 hover:bg-white/10 rounded-full transition-colors flex items-center gap-3 group"
          >
            <ArrowLeft size={22} className="text-white group-hover:-translate-x-1 transition-transform" />
            <span className="text-sm font-medium text-white tracking-wide">New music</span>
          </button>
        </div>

        <div className="flex items-center gap-5 w-[330px] justify-end">
          <button className="flex items-center h-11 bg-[#171717] rounded-2xl pl-3 pr-1 gap-2 hover:bg-[#202020] transition-colors border border-transparent hover:border-white/10">
            <span className="text-xs font-semibold text-gray-300 mr-1 truncate max-w-[100px]">
              {userProfile?.displayName || user?.email?.split('@')[0] || 'Guest'}
            </span>
            <Avatar
              src={userProfile?.photoURL || user?.photoURL}
              name={userProfile?.displayName || user?.email}
              size={32}
            />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="absolute top-16 bottom-[212px] left-1/2 -translate-x-1/2 px-6 max-w-[960px] w-full flex flex-col justify-evenly items-center">
        {/* Headings */}
        <div className="text-center space-y-4">
          <h1 
            style={{ 
              fontFamily: '"Google Sans", sans-serif',
              fontSize: '2.25rem',
              fontWeight: 400,
              lineHeight: 1.3,
              color: 'rgba(218, 220, 224, 0.5)'
            }}
          >
            Generate and reuse music for consistent videos.<br/>
            Use a sample prompt below, or create from scratch.
          </h1>
        </div>

        {/* Music Cards */}
        <div className="grid grid-cols-4 gap-4 px-12 pb-12 w-full max-w-[1400px]">
          {sampleMusic.map((music, i) => (
            <button 
              key={i}
              onClick={() => {
                setPrompt(music.title);
                startGeneration();
              }}
              className="flex items-center gap-4 p-3.5 rounded-[20px] bg-[#141517] hover:bg-[#1f2023] transition-colors text-left border-none cursor-pointer"
            >
              <div className="w-[60px] h-[60px] shrink-0 rounded-[12px] overflow-hidden bg-[#2a2b2f]">
                <img 
                  src={music.image} 
                  alt={music.title} 
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="flex flex-col gap-1 overflow-hidden">
                <h3 className="text-sm font-semibold text-white">{music.title}</h3>
                <p className="text-[11px] text-white/45 leading-relaxed pr-2">{music.description}</p>
              </div>
            </button>
          ))}
        </div>
      </main>

      {/* Prompt Input & Buttons Container fixed absolutely at the bottom */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-full max-w-[600px] z-[80] flex flex-col gap-4">
        <AssetMenuModal
          isOpen={isAssetMenuOpen}
          onClose={() => setIsAssetMenuOpen(false)}
          buttonRef={assetMenuPlusRef}
          openedFrom="main"
          mediaItems={mediaItems}
          onFileSelect={handleUploadClick}
          onAddPrompt={handleAddPrompt}
        />
        <div className="relative rounded-[22px] bg-[#141517]/90 backdrop-blur-[80px] pt-3 pb-2 px-3 shadow-2xl border border-white/5 flex flex-col w-full">
          <input 
            type="file" 
            multiple 
            accept="image/*"
            className="hidden" 
            ref={localFileInputRef} 
            onChange={handleFileSelect} 
          />

          {/* Local Attachments Area */}
          <div className={`grid transition-[grid-template-rows,margin-bottom] duration-[350ms] ease-in-out ${hasActiveAttachments ? 'grid-rows-[1fr] mb-0' : 'grid-rows-[0fr] mb-0'}`}>
            <div className="overflow-hidden">
              <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2.5 px-2 pt-2">
                {attachments.map((att) => (
                  <div 
                    key={att.id} 
                    className={`relative group flex-shrink-0 p-1.5 -m-1.5 transition-all duration-200 ${removingIds.has(att.id) ? 'opacity-0 scale-90' : 'opacity-100 scale-100 animate-in fade-in zoom-in-95'}`}
                  >
                    <div className="relative">
                      <div className="w-16 h-16 rounded-2xl overflow-hidden border border-white/5 bg-[#1c1c1e]">
                        {att.kind === 'video' ? (
                          <video src={att.url} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" muted loop playsInline />
                        ) : (
                          <img src={att.url} alt={att.name} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                        )}
                      </div>
                      <button 
                        onClick={() => removeAttachment(att.id)}
                        className="absolute -top-1.5 -right-1.5 bg-[#27272a] text-gray-400 hover:text-white border border-white/10 rounded-full p-1 transition-all duration-200 shadow-xl z-[60] opacity-100 group-hover:opacity-100 hover:opacity-100 cursor-pointer"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="relative flex items-start w-full">
            <textarea 
              ref={textareaRef}
              rows={1}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  startGeneration();
                }
              }}
              placeholder="What do you want to create?" 
              className="bg-transparent border-none outline-none text-[14px] font-medium text-white placeholder-[#606060] w-full pl-1 py-0.5 resize-none max-h-[384px] overflow-y-auto no-scrollbar transition-all duration-200"
            />
          </div>
          
          <div className="flex items-center justify-between mt-2.5">
            {/* Left Controls */}
            <div className="flex items-center gap-2.5 relative">
              <button
                ref={assetMenuPlusRef}
                onClick={() => setIsAssetMenuOpen(!isAssetMenuOpen)}
                className="text-[#a0a0a0] hover:text-white transition-colors ml-0 outline-none cursor-pointer"
              >
                <Plus size={22} strokeWidth={1.5} />
              </button>
              <button 
                onClick={() => setIsProducerActive(!isProducerActive)}
                className={`flex items-center justify-center h-9 transition-colors rounded-full px-4 border relative cursor-pointer ${
                  isProducerActive 
                    ? 'bg-white hover:bg-gray-200 border-transparent text-black' 
                    : 'bg-[#27282b] hover:bg-[#33343a] border-transparent text-[#d0d0d0]'
                }`}
              >
                <span className={`text-[11px] font-semibold tracking-wide relative z-10 ${isProducerActive ? 'text-black' : 'text-[#d0d0d0]'}`}>Producer</span>
              </button>
            </div>

            {/* Right Controls */}
            <div className="flex items-center gap-2.5 relative">
              <div className="flex items-center gap-2.5">
                <div className="relative" ref={dropdownRef}>
                  <button
                    onClick={() => setIsLocalDropdownOpen(!isLocalDropdownOpen)}
                    className={`flex items-center h-9 transition-colors rounded-full px-3.5 gap-1.5 outline-none cursor-pointer ${
                      isLocalDropdownOpen ? 'bg-[#33343a]' : 'bg-[#27282b] hover:bg-[#33343a]'
                    }`}
                  >
                    {getActiveModelName().toLowerCase().includes('banana') && (
                      <span className="text-[11px]">🍌</span>
                    )}
                    <span className="text-[11px] font-semibold text-[#d0d0d0]">
                      {getActiveModelName()}
                    </span>
                    <ChevronDown size={14} className="text-[#888888] ml-0.5" />
                  </button>

                  {isLocalDropdownOpen && (
                    <div className="absolute bottom-[calc(100%+6px)] left-0 bg-[#141517]/95 backdrop-blur-xl rounded-[14px] p-1 flex flex-col shadow-2xl z-[120] w-[160px] border border-white/5 animate-in fade-in slide-in-from-bottom-1 duration-150">
                      {models.map(modelOpt => (
                        <button
                          key={modelOpt.id}
                          type="button"
                          onClick={() => {
                            onModelChange(modelOpt.id);
                            setIsLocalDropdownOpen(false);
                          }}
                          className={`w-full text-left px-3 py-2 rounded-[10px] text-[12px] font-medium transition-colors cursor-pointer ${
                            activeModelId === modelOpt.id 
                              ? 'bg-[#4a4a4a] text-white' 
                              : 'text-[#a0a0a0] hover:text-white hover:bg-white/5'
                          }`}
                        >
                          {modelOpt.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                
                <button 
                  onClick={() => {
                    if (prompt.trim()) startGeneration();
                  }}
                  className={`flex items-center justify-center w-9 h-9 rounded-full transition-all border border-transparent cursor-pointer ${
                    !prompt.trim()
                      ? 'bg-[#27282b]/90 cursor-not-allowed'
                      : 'bg-white hover:bg-zinc-200 cursor-pointer active:scale-95'
                  }`}
                >
                  <ArrowRight size={16} strokeWidth={2.5} className={!prompt.trim() ? "text-white/40" : "text-black"} />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-3 justify-center w-full max-w-[600px]">
          <button 
            style={{ paddingTop: '13px', paddingBottom: '13px' }}
            className="flex-1 flex items-center justify-center gap-2 bg-[#141517]/90 backdrop-blur-[80px] rounded-[18px] text-sm font-medium text-gray-300 transition-colors border border-white/5 hover:bg-[#1f2023]/90 cursor-pointer"
            onClick={handleUploadClick}
          >
            <Upload size={18} />
            <span>Upload</span>
          </button>
          <button 
            style={{ paddingTop: '13px', paddingBottom: '13px' }}
            className="flex-1 flex items-center justify-center gap-2 bg-[#141517]/90 backdrop-blur-[80px] rounded-[18px] text-sm font-medium text-gray-300 transition-colors border border-white/5 hover:bg-[#1f2023]/90 cursor-pointer"
            onClick={() => setIsAssetMenuOpen(true)}
          >
            <Plus size={18} />
            <span>Add from Project</span>
          </button>
        </div>
      </div>

    </div>
  );
};
