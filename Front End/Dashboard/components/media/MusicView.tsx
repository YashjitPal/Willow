import React, { useState, useRef } from 'react';
import { ArrowLeft, ArrowRight, Plus, Upload, X, ChevronDown, Heart, Trash2, History, Pencil, Wand2, Droplet, Download } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
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
  onSongGenerated?: (item: any) => void;
  initialItem?: any;
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
  onModelChange,
  onSongGenerated,
  initialItem
}) => {
  const { userProfile, user } = useAuth();
  const { apiKeys } = useUserDataContext();
  
  // Core View State: 'initial' = Grid view, 'editor' = Creating/Editing a track
  const [viewState, setViewState] = useState<'initial' | 'editor'>(initialItem ? 'editor' : 'initial');
  
  // Generation State inside Editor
  const [coverStatus, setCoverStatus] = useState<'idle' | 'generating' | 'completed'>(initialItem ? 'completed' : 'idle');
  const [musicStatus, setMusicStatus] = useState<'idle' | 'generating' | 'completed'>(initialItem ? 'completed' : 'idle');
  const [progress, setProgress] = useState(initialItem ? 100 : 0);

  // Prompt states
  const [prompt, setPrompt] = useState(initialItem?.prompt || '');
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
  const [musicImage, setMusicImage] = useState<string | null>(initialItem?.url || null);

  // Lyrics & Audio State
  const [lyrics, setLyrics] = useState<{text: string; time: number}[]>([]);
  const [songTitle, setSongTitle] = useState(initialItem?.shortenedPrompt || initialItem?.prompt || 'Untitled Music');
  const [songArtist, setSongArtist] = useState(initialItem?.modelName || 'Unknown Artist');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioSrc, setAudioSrc] = useState<string | null>(initialItem?.audioUrl || null);
  const [showAmbientBackground, setShowAmbientBackground] = useState(true);
  const audioRef = useRef<HTMLAudioElement>(null);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const leftBlockRef = useRef<HTMLDivElement>(null);
  const editorContentRef = useRef<HTMLDivElement>(null);
  const [leftGap, setLeftGap] = useState(64);
  const [isDownloading, setIsDownloading] = useState(false);
  const [spacerHeight, setSpacerHeight] = useState(172);
  const [isTitleOverflowing, setIsTitleOverflowing] = useState(false);
  const titleContainerRef = useRef<HTMLDivElement>(null);
  const titleTextRef = useRef<HTMLSpanElement>(null);

  const [isLayoutCalculated, setIsLayoutCalculated] = useState(false);

  // Use effects for other initial setup if needed
  React.useEffect(() => {
    if (initialItem && viewState !== 'editor') {
      setViewState('editor');
      setCoverStatus('completed');
      setMusicStatus('completed');
      setMusicImage(initialItem.url || null);
      setSongTitle(initialItem.shortenedPrompt || initialItem.prompt || 'Untitled Music');
      setSongArtist(initialItem.modelName || 'Unknown Artist');
      setAudioSrc(initialItem.audioUrl || null);
      setPrompt(initialItem.prompt || '');
      setProgress(100);
    }
  }, [initialItem]);

  const handleLyricClick = React.useCallback((time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      audioRef.current.play();
      setIsPlaying(true);
    }
  }, []);

  const handleDownload = async () => {
    if (!audioSrc || isDownloading) return;
    setIsDownloading(true);
    try {
      const ID3WriterModule = await import('browser-id3-writer');
      const ID3Writer = (ID3WriterModule.default || ID3WriterModule) as any;
      
      const audioResponse = await fetch(audioSrc);
      const audioBuffer = await audioResponse.arrayBuffer();
      
      const writer = new ID3Writer(audioBuffer);
      writer.setFrame('TIT2', songTitle)
            .setFrame('TPE1', [songArtist]);
            
      if (musicImage) {
        try {
          const imageResponse = await fetch(musicImage);
          const imageBuffer = await imageResponse.arrayBuffer();
          writer.setFrame('APIC', {
            type: 3,
            data: imageBuffer,
            description: 'Cover',
            useUnicodeEncoding: false
          });
        } catch (e) {
          console.warn("Could not fetch cover image for ID3 tag:", e);
        }
      }

      if (lyrics && lyrics.length > 0) {
        const plainLyrics = lyrics.map(l => l.text).join('\n');
        writer.setFrame('USLT', {
          description: '',
          lyrics: plainLyrics,
        });
      }
      
      writer.addTag();
      const taggedSongBuffer = writer.arrayBuffer;
      
      const blob = new Blob([taggedSongBuffer], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${songTitle} - ${songArtist}.mp3`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      console.error("Failed to download song:", e);
    } finally {
      setIsDownloading(false);
    }
  };

  React.useLayoutEffect(() => {
    if (viewState !== 'editor' || (musicStatus !== 'completed' && musicStatus !== 'generating')) {
      setIsLayoutCalculated(false);
      return;
    }

    const calculateLayout = () => {
      if (leftBlockRef.current && editorContentRef.current) {
        // Derive the gap from heights instead of the block's live rect.top, so a
        // mid-settle measurement can't bake a wrong horizontal offset into state.
        const containerRect = editorContentRef.current.getBoundingClientRect();
        const blockHeight = leftBlockRef.current.offsetHeight;
        const T = containerRect.top + Math.max(0, (containerRect.height - blockHeight) / 2);
        setLeftGap(Math.max(32, Math.round(T)));
      }
      if (lyricsContainerRef.current) {
        const containerHeight = lyricsContainerRef.current.clientHeight;
        // The container has py-32 (128px padding).
        // We subtract an additional 40px to account for half of the lyric's visual line-height (which now includes py-2).
        setSpacerHeight(Math.max(0, (containerHeight / 2) - 128 - 40));
      }
      setIsLayoutCalculated(true);
    };

    calculateLayout();

    // Re-derive whenever the container or block size settles late (fonts, content
    // swaps, window changes) — a one-shot measurement is what caused the skeleton
    // to land offset and only sometimes recover.
    const observer = new ResizeObserver(calculateLayout);
    if (editorContentRef.current) observer.observe(editorContentRef.current);
    if (leftBlockRef.current) observer.observe(leftBlockRef.current);
    if (lyricsContainerRef.current) observer.observe(lyricsContainerRef.current);

    window.addEventListener('resize', calculateLayout);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', calculateLayout);
    };
  }, [viewState, musicStatus, lyrics]);

  React.useEffect(() => {
    const checkOverflow = () => {
      if (titleContainerRef.current && titleTextRef.current) {
        const hasMinusMargin = titleContainerRef.current.classList.contains('-mx-4');
        const containerWidth = titleContainerRef.current.clientWidth - (hasMinusMargin ? 32 : 0);
        setIsTitleOverflowing(titleTextRef.current.scrollWidth > containerWidth);
      }
    };
    checkOverflow();
    window.addEventListener('resize', checkOverflow);
    return () => window.removeEventListener('resize', checkOverflow);
  }, [songTitle, viewState, musicStatus]);

  // Calculate active lyric index based on lyrics to prevent scroll jank
  const activeLyricIndex = React.useMemo(() => {
    if (lyrics.length === 0) return -1;
    if (currentTime === 0 || currentTime < lyrics[0].time) return -1;

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
    if (initialItem) {
      onBack();
    } else {
      setViewState('initial');
    }
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
    
    // Determine the exact artist name based on the active model
    const activeModelObj = models.find(m => m.id === activeModelId);
    let activeArtist = activeModelObj ? activeModelObj.name : 'Lyria';
    
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
      setMusicStatus('idle'); // The main view condition uses `musicStatus === 'idle'` to show the prompt input
      setCoverStatus('idle');
      setViewState('initial'); // Reset viewState so it returns to the prompt screen instead of the editor screen
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

    if (onSongGenerated) {
      onSongGenerated({
        id: 'song-' + Date.now() + '-' + Math.random().toString(36).substring(7),
        kind: 'audio',
        status: 'completed',
        url: finalImageUrl,
        audioUrl: generatedAudioUrl,
        prompt: finalPrompt,
        modelId: activeModelId,
        modelName: activeArtist,
        ratio: '1:1',
        timestamp: Date.now(),
        shortenedPrompt: activeTitle,
      });
    }
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
        {/* Dynamic Ambient Background */}
        <style dangerouslySetInnerHTML={{__html: `
          .ambient-background-container {
            position: absolute;
            inset: 0;
            overflow: hidden;
            z-index: 0;
            pointer-events: none;
            background: #000;
          }
          
          .ambient-liquid-layer {
            position: absolute;
            background-size: cover;
            background-repeat: no-repeat;
            filter: blur(140px) saturate(200%);
            opacity: 0;
            transition: opacity 2s ease-in-out;
            will-change: transform, border-radius;
            mix-blend-mode: screen;
          }
          
          .ambient-liquid-layer.visible {
            opacity: 0.60;
          }

          /* Layer 1: Top Left colors */
          .liquid-1 {
            top: -20%; left: -20%; width: 120%; height: 120%;
            background-position: top left;
            animation: blob-morph-1 25s infinite alternate ease-in-out;
          }
          
          /* Layer 2: Bottom Right colors */
          .liquid-2 {
            bottom: -30%; right: -20%; width: 130%; height: 130%;
            background-position: bottom right;
            animation: blob-morph-2 32s infinite alternate-reverse ease-in-out;
          }
          
          /* Layer 3: Center colors sweeping across */
          .liquid-3 {
            top: 0%; left: 0%; width: 140%; height: 140%;
            background-position: center;
            animation: blob-morph-3 38s infinite alternate ease-in-out;
            opacity: 0;
          }
          .liquid-3.visible { opacity: 0.50; }

          /* Layer 4: Additional accent blob */
          .liquid-4 {
            top: 20%; right: 20%; width: 100%; height: 100%;
            background-position: top right;
            animation: blob-morph-4 28s infinite alternate-reverse ease-in-out;
            opacity: 0;
          }
          .liquid-4.visible { opacity: 0.40; }

          .ambient-overlay {
            position: absolute;
            inset: 0;
            background: linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.9) 100%);
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
        <div className="ambient-background-container">
          {/* Base full blur to prevent dark spots */}
          <div 
            className={`absolute inset-0 bg-cover bg-center transition-opacity duration-2000 ${musicStatus === 'completed' && musicImage && showAmbientBackground ? 'opacity-30' : 'opacity-0'}`}
            style={{ backgroundImage: musicImage ? `url("${musicImage}")` : 'none', filter: 'blur(140px) saturate(150%)' }}
          />
          <div className={`ambient-liquid-layer liquid-1 ${musicStatus === 'completed' && musicImage && showAmbientBackground ? 'visible' : ''}`} style={{ backgroundImage: musicImage ? `url("${musicImage}")` : 'none' }} />
          <div className={`ambient-liquid-layer liquid-2 ${musicStatus === 'completed' && musicImage && showAmbientBackground ? 'visible' : ''}`} style={{ backgroundImage: musicImage ? `url("${musicImage}")` : 'none' }} />
          <div className={`ambient-liquid-layer liquid-3 ${musicStatus === 'completed' && musicImage && showAmbientBackground ? 'visible' : ''}`} style={{ backgroundImage: musicImage ? `url("${musicImage}")` : 'none' }} />
          <div className={`ambient-liquid-layer liquid-4 ${musicStatus === 'completed' && musicImage && showAmbientBackground ? 'visible' : ''}`} style={{ backgroundImage: musicImage ? `url("${musicImage}")` : 'none' }} />
          <div className="ambient-overlay" />
        </div>

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
          className={`absolute z-10 top-16 bottom-[40px] left-0 right-0 flex ${(musicStatus === 'completed' || musicStatus === 'generating') ? 'flex-row items-center justify-start px-0 gap-0' : 'flex-col items-center justify-center px-8'} transition-opacity duration-300 ${((musicStatus === 'generating' || musicStatus === 'completed') && !isLayoutCalculated) ? 'opacity-0' : 'opacity-100'}`}
        >
          
          {/* Left Column / Center generating block */}
          <div 
            ref={leftBlockRef}
            style={(musicStatus === 'completed' || musicStatus === 'generating') ? { 
              paddingLeft: `${leftGap}px`, 
              paddingRight: `${leftGap}px`,
              width: `${450 + leftGap * 2}px`
            } : {}}
            className={`flex flex-col ${(musicStatus === 'completed' || musicStatus === 'generating') ? 'items-start shrink-0 mb-0' : 'items-center mb-8'}`}
          >

            {/* 1:1 Cover Art Container */}
            <div className={`relative ${(musicStatus === 'completed' || musicStatus === 'generating') ? 'w-[450px] h-[450px]' : 'w-[400px] h-[400px]'} shrink-0 rounded-lg bg-[#1a1b1f] overflow-hidden shadow-2xl border border-white/5 mb-8`}>
              <AnimatePresence>
                {coverStatus === 'generating' && (
                  <motion.div 
                    key="generating"
                    className="absolute inset-0 z-10 mesh-container-generating"
                    initial={{ opacity: 1, backdropFilter: 'blur(0px)' }}
                    exit={{ opacity: 0, backdropFilter: 'blur(24px)' }}
                    transition={{ duration: 1.5, ease: "easeInOut" }}
                  >
                    <style dangerouslySetInnerHTML={{ __html: `
                      .mesh-container-generating {
                        position: absolute;
                        inset: 0;
                        border-radius: inherit;
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
                  </motion.div>
                )}
              </AnimatePresence>
              
              <div className="absolute inset-0 z-0 flex items-center justify-center bg-[#1c1c1e]">
                 {musicImage && (
                   <img src={musicImage} alt="Music Cover" className="w-full h-full object-cover transition-opacity duration-1000" />
                 )}
              </div>
            </div>

            {/* Left Column Controls & Info */}
            {(musicStatus === 'completed' || musicStatus === 'generating') && (
               <div className={`w-full flex flex-col gap-4 px-2 ${musicStatus === 'generating' ? 'opacity-40 pointer-events-none' : ''}`}>
                   <style dangerouslySetInnerHTML={{ __html: `
                     .shimmer-container {
                       position: relative;
                       background-color: rgba(160, 160, 160, 0.15);
                       background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.25'/%3E%3C/svg%3E");
                       overflow: hidden;
                       transform-origin: left center;
                       animation: title-glitter-breathe 2.4s infinite ease-in-out;
                     }
                     .shimmer-container::after {
                       content: "";
                       position: absolute;
                       top: 0; left: -100%; width: 50%; height: 100%;
                       background: linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent);
                       animation: skeleton-shimmer 2s infinite;
                     }
                     .animate-title-marquee {
                       display: flex;
                       width: max-content;
                       animation: title-marquee 15s linear infinite;
                     }
                     @keyframes title-marquee {
                       0%, 20% { transform: translateX(0); }
                       100% { transform: translateX(-50%); }
                     }
                     @keyframes skeleton-shimmer {
                       100% { left: 200%; }
                     }
                     @keyframes title-glitter-breathe {
                       0%, 100% { 
                         opacity: 0.85; 
                         transform: scaleY(0.96) scaleX(0.995); 
                       }
                       50% { 
                         opacity: 1; 
                         transform: scaleY(1.04) scaleX(1.005);
                         filter: drop-shadow(0 0 6px rgba(255,255,255,0.15));
                       }
                     }
                   `}} />
                  <div className="flex flex-col">
                     <h1 className="text-[32px] font-bold text-white flex items-center leading-tight tracking-tight w-full max-w-[450px]" style={{ fontFamily: '"Google Sans", sans-serif' }}>
                        {musicStatus === 'generating' ? (
                           <div className="w-56 h-[38px] rounded-lg shimmer-container" style={{ animationDelay: '0s' }}></div>
                        ) : (
                           <div className="flex items-center w-full min-w-0">
                               <div 
                                 ref={titleContainerRef} 
                                 className={`relative overflow-hidden flex items-center ${isTitleOverflowing ? '-mx-4 w-[calc(100%+32px)] shrink-0' : 'flex-1 min-w-0'}`}
                                 style={isTitleOverflowing ? {
                                   maskImage: 'linear-gradient(to right, transparent, black 16px, black calc(100% - 16px), transparent)',
                                   WebkitMaskImage: 'linear-gradient(to right, transparent, black 16px, black calc(100% - 16px), transparent)'
                                 } : {}}
                               >
                                 <div className={isTitleOverflowing ? 'px-4' : ''}>
                                   <div className={`flex items-center whitespace-nowrap ${isTitleOverflowing ? 'animate-title-marquee' : ''}`}>
                                     <span ref={titleTextRef} className={isTitleOverflowing ? "pr-12" : "truncate"}>{songTitle}</span>
                                     {isTitleOverflowing && <span className="pr-12">{songTitle}</span>}
                                   </div>
                                 </div>
                               </div>
                           </div>
                        )}
                     </h1>
                     <span className="text-[20px] text-gray-400 font-medium mt-1 tracking-tight">
                        {musicStatus === 'generating' ? (
                           <div className="w-36 h-6 rounded-md mt-2 shimmer-container" style={{ animationDelay: '-0.3s' }}></div>
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
                 <div className="w-full flex items-center justify-between mt-6 px-2 relative">
                    <button className="text-gray-400 hover:text-white transition-colors cursor-pointer w-10 h-10 flex items-center justify-center">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 3 21 3 21 8"></polyline><line x1="4" y1="20" x2="21" y2="3"></line><polyline points="21 16 21 21 16 21"></polyline><line x1="15" y1="15" x2="21" y2="21"></line><line x1="4" y1="4" x2="9" y2="9"></line></svg>
                    </button>
                    
                    <button 
                      onClick={() => setShowAmbientBackground(!showAmbientBackground)}
                      className="transition-colors cursor-pointer relative w-10 h-10 flex items-center justify-center text-gray-400 hover:text-white"
                    >
                      <Droplet size={20} strokeWidth={2} />
                      {!showAmbientBackground && (
                        <svg className="absolute inset-0 w-full h-full text-current opacity-70" viewBox="0 0 24 24">
                          <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                      )}
                    </button>
                    
                    <button className="text-gray-400 hover:text-white transition-colors cursor-pointer w-10 h-10 flex items-center justify-center">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="19 20 9 12 19 4 19 20"></polygon><line x1="5" y1="19" x2="5" y2="5"></line></svg>
                    </button>
                    
                    <button 
                      onClick={togglePlay}
                      className="w-16 h-16 rounded-full flex items-center justify-center transition-all cursor-pointer shadow-[0_10px_25px_rgba(0,0,0,0.6),inset_0_2px_4px_rgba(255,255,255,0.7),inset_0_-4px_8px_rgba(0,0,0,0.4)] border-[3px] border-[#8a8d91] focus:outline-none outline-none group relative overflow-hidden shrink-0"
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
                    
                    <button className="text-gray-400 hover:text-white transition-colors cursor-pointer w-10 h-10 flex items-center justify-center">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19"></line></svg>
                    </button>

                    <button 
                      onClick={handleDownload}
                      disabled={isDownloading}
                      className={`transition-colors relative w-10 h-10 flex items-center justify-center ${isDownloading ? 'text-gray-600 cursor-not-allowed' : 'text-gray-400 hover:text-white cursor-pointer'}`}
                    >
                      <Download size={20} strokeWidth={2} />
                    </button>

                    <button className="text-gray-400 hover:text-white transition-colors cursor-pointer w-10 h-10 flex items-center justify-center">
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
                  <div ref={lyricsContainerRef} className="w-full max-w-[600px] h-[600px] overflow-y-auto no-scrollbar flex flex-col items-start gap-4 py-32 px-8 mask-image-linear-gradient animate-in fade-in duration-700">
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
                                 height: 80px;
                                 position: relative;
                                 border-radius: 12px;
                                 background-color: rgba(160, 160, 160, 0.15);
                                 background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.25'/%3E%3C/svg%3E");
                                 overflow: hidden;
                                 transform-origin: left center;
                                 animation: glitter-breathe 2.4s infinite ease-in-out;
                               }
                               .skeleton-lyric-line::after {
                                 content: "";
                                 position: absolute;
                                 top: 0; left: -100%; width: 50%; height: 100%;
                                 background: linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent);
                                 animation: skeleton-shimmer 2s infinite;
                               }
                               @keyframes skeleton-shimmer {
                                 100% { left: 200%; }
                               }
                               @keyframes glitter-breathe {
                                 0%, 100% { 
                                   opacity: 0.85; 
                                   transform: scaleY(0.96) scaleX(0.995); 
                                 }
                                 50% { 
                                   opacity: 1; 
                                   transform: scaleY(1.04) scaleX(1.005);
                                   filter: drop-shadow(0 0 6px rgba(255,255,255,0.15));
                                 }
                               }
                             `}} />
                            <div className="skeleton-lyric-line w-[85%]" style={{ animationDelay: '0s' }}></div>
                            <div className="skeleton-lyric-line w-[70%]" style={{ animationDelay: '-0.3s' }}></div>
                            <div className="skeleton-lyric-line w-[90%]" style={{ animationDelay: '-0.6s' }}></div>
                            <div className="skeleton-lyric-line w-[65%]" style={{ animationDelay: '-0.9s' }}></div>
                            <div className="skeleton-lyric-line w-[80%]" style={{ animationDelay: '-1.2s' }}></div>
                            <div className="skeleton-lyric-line w-[75%]" style={{ animationDelay: '-1.5s' }}></div>
                            <div className="skeleton-lyric-line w-[85%]" style={{ animationDelay: '-1.8s' }}></div>
                            <div className="skeleton-lyric-line w-[60%]" style={{ animationDelay: '-2.1s' }}></div>
                        </>
                     ) : (
                        <div 
                          className="w-full flex flex-col items-start gap-4 animate-in fade-in zoom-in-[0.98] slide-in-from-bottom-6 duration-[1200ms]"
                          style={{ animationTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)' }}
                        >
                          {lyrics.length > 0 && <div style={{ height: `${spacerHeight}px` }} className="shrink-0 w-full pointer-events-none" />}
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
                                 className={`text-left cursor-pointer transition-all duration-[800ms] ease-[cubic-bezier(0.22,1,0.36,1)] w-full py-2 origin-left text-[32px] font-bold tracking-tight ${
                                   isCurrent ? 'text-white opacity-100 translate-y-0 scale-100' : 
                                   isPast ? 'text-white opacity-30 -translate-y-2 scale-[0.95]' : 
                                   'text-white opacity-50 translate-y-2 scale-[0.95]'
                                 }`}
                               >
                                 {line.text}
                               </div>
                             );
                          })}
                          {lyrics.length > 0 && <div style={{ height: `${spacerHeight}px` }} className="shrink-0 w-full pointer-events-none" />}
                        </div>
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
                      if (editPrompt.trim() && coverStatus !== 'generating') startGeneration();
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
                  if (editPrompt.trim() && coverStatus !== 'generating') startGeneration();
                }}
                className={`flex items-center justify-center w-8 h-8 rounded-full bg-[#27282b] hover:bg-[#40424a] transition-all cursor-pointer ${
                  (coverStatus === 'generating') ? 'opacity-50 cursor-not-allowed' : ''
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
