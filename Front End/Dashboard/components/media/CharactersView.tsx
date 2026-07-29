import React, { useState, useRef } from 'react';
import { ArrowLeft, ArrowRight, Plus, Upload, X, ChevronDown, Heart, Trash2, History, Pencil, Wand2 } from 'lucide-react';
import { AssetMenuModal } from '../AssetMenuModal';
import { Avatar } from '../ui/Avatar';
import { useAuth } from '../../context/AuthContext';
 
interface CharactersViewProps {
  onBack: () => void;
  mediaItems: any[];
  onFileSelect?: () => void;
  modelMode: 'image' | 'video';
  activeModelId: string;
  onModelChange: (id: any) => void;
}

const sampleCharacters = [
  {
    title: 'The Familiar',
    description: 'Grounded cinematic realism. The relatable anchor of your story. Authentic, striking, and designed with the natural presence of a lead character.',
    image: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400&q=80'
  },
  {
    title: 'The Eccentric',
    description: 'Unforgettable quirky humans. Magnetic scene-stealers with offbeat charm. They bring a unique, unforgettable energy to every frame.',
    image: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&q=80'
  },
  {
    title: 'The Wicked',
    description: 'Powerful antagonistic presences. Intense figures that command the screen. From cold zealots to shadowy threats, they bring the perfect edge.',
    image: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&q=80'
  },
  {
    title: 'The Fantastical',
    description: 'High-concept visionary beings. A surreal fusion of the human and the mythical. Ethereal, dreamlike, and rooted in the textures of another reality.',
    image: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&q=80'
  }
];

export const CharactersView: React.FC<CharactersViewProps> = ({ 
  onBack, 
  mediaItems, 
  onFileSelect, 
  modelMode,
  activeModelId,
  onModelChange
}) => {
  const { userProfile, user } = useAuth();
  
  // Core View State: 'initial' = Grid view, 'editor' = Creating/Editing a character
  const [viewState, setViewState] = useState<'initial' | 'editor'>('initial');
  
  // Generation State inside Editor: 'generating' = mesh animation, 'completed' = image ready
  const [genStatus, setGenStatus] = useState<'generating' | 'completed'>('generating');
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

  // Editor Character Info
  const [characterInfo, setCharacterInfo] = useState('');
  const [characterImage, setCharacterImage] = useState<string | null>(null);

  const models = modelMode === 'image' ? [
    { id: 'gemini-3-pro-image-preview', name: 'Nano Banana Pro' },
    { id: 'gemini-3.1-flash-image-preview', name: 'Nano Banana 2' },
    { id: 'gemini-3.1-flash-lite-image', name: 'Nano Banana Lite' },
    { id: 'grok-imagine', name: 'Grok Imagine' }
  ] : [
    { id: 'veo-3.1-fast', name: 'Veo 3.1 Fast' },
    { id: 'veo-3.1', name: 'Veo 3.1' },
    { id: 'veo-3.1-lite', name: 'Veo 3.1 Lite' },
    { id: 'omni-flash', name: 'Omni Flash' }
  ];

  const getActiveModelName = () => {
    return models.find(m => m.id === activeModelId)?.name || (modelMode === 'image' ? 'Nano Banana 2' : 'Omni Flash');
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

  // Adjust textarea height for prompt box
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

  // Simulate Generation process
  const startGeneration = () => {
    setViewState('editor');
    setGenStatus('generating');
    setProgress(0);
    
    // Simulate generation over 5 seconds
    const duration = 5000;
    const interval = 200;
    let elapsed = 0;
    
    const timer = setInterval(() => {
      elapsed += interval;
      const pct = Math.min(99, Math.floor((elapsed / duration) * 100));
      setProgress(pct);
      
      if (elapsed >= duration) {
        clearInterval(timer);
        setProgress(100);
        setGenStatus('completed');
        setCharacterImage('https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800&q=80'); // Sample generated image
      }
    }, interval);
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
              onClick={() => setViewState('initial')}
              className="p-3 hover:bg-white/10 rounded-full transition-colors flex items-center gap-3 group cursor-pointer"
            >
              <ArrowLeft size={22} className="text-white group-hover:-translate-x-1 transition-transform" />
              <span className="text-sm font-medium text-white tracking-wide">Untitled Character</span>
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
            <button className="h-9 px-5 rounded-full bg-white hover:bg-gray-200 text-black font-semibold text-sm transition-colors cursor-pointer">
              Done
            </button>
          </div>
        </header>

        {/* Editor Main Content: 2 Columns */}
        <div className="absolute top-16 bottom-[100px] left-0 right-0 flex justify-center px-12 pt-12 pb-4 gap-12 translate-x-6">
          
          {/* Left Column: Info & Voice */}
          <div className="w-[360px] flex flex-col shrink-0 mt-8">
            <div className="flex items-center justify-between mb-8">
              <h1 
                style={{
                  fontFamily: '"Google Sans", sans-serif',
                  fontSize: '2rem',
                  fontWeight: 400,
                  lineHeight: '2.5rem',
                  color: 'rgb(255, 255, 255)'
                }}
              >
                Untitled Character
              </h1>
              <button className="text-[#141517]/90 hover:text-[#1f2023]/90 transition-colors">
                <Pencil size={18} />
              </button>
            </div>

            <button 
              style={{ paddingTop: '13px', paddingBottom: '13px' }}
              className="w-full flex items-center justify-center gap-2 bg-[#141517]/90 backdrop-blur-[80px] rounded-[18px] text-sm font-medium text-gray-300 transition-colors border border-white/5 hover:bg-[#1f2023]/90 cursor-pointer mb-8"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-300">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" x2="12" y1="19" y2="22" />
                <path d="M8 22h8" />
              </svg>
              <span>Select a voice</span>
            </button>

            <div className="flex flex-col">
              <label 
                style={{
                  fontFamily: '"Google Sans Text", sans-serif',
                  fontSize: '13px',
                  fontWeight: 600,
                  lineHeight: '1rem',
                  color: 'rgba(218, 220, 224, 0.75)'
                }}
                className="mb-3 ml-1"
              >
                Character Info (optional)
              </label>
              <textarea 
                value={characterInfo}
                onChange={(e) => setCharacterInfo(e.target.value)}
                placeholder="Describe how your character acts..."
                style={{
                  height: '325.2px',
                  padding: '1rem',
                  boxSizing: 'border-box',
                  color: 'rgb(255, 255, 255)',
                  fontSize: '0.875rem',
                  fontFamily: '"Google Sans Text", sans-serif',
                  lineHeight: '1.25rem'
                }}
                className="w-full bg-[#141517]/50 border-[1.5px] border-white/15 rounded-[16px] resize-none outline-none focus:border-white/75 transition-colors placeholder-[#757575]"
              />
              <p className="mt-4 px-1" style={{ lineHeight: '16px' }}>
                <span 
                  style={{
                    color: 'rgba(218, 220, 224, 0.5)',
                    fontSize: '12px',
                    fontFamily: '"Google Sans Text", sans-serif',
                    lineHeight: '16px'
                  }}
                >
                  The agent can use this information to help craft scenes with your character.
                </span>
              </p>
            </div>
          </div>

          {/* Right Column: Generation Window & Controls */}
          <div className="flex-1 w-full max-w-[880px] flex flex-col items-center shrink-0 mt-8 translate-y-4">
            {/* Keeping 16:9 aspect ratio */}
            <div 
              style={{ aspectRatio: '16/9' }}
              className="relative w-full max-w-[860px] h-auto shrink-0 rounded-[24px] bg-[#2a2b2f] overflow-hidden shadow-2xl -translate-y-2"
            >
              {genStatus === 'generating' ? (
                <div className="absolute inset-0 z-10 mesh-container-generating">
                  <style dangerouslySetInnerHTML={{ __html: `
                    .mesh-container-generating {
                      position: absolute;
                      inset: 0;
                      border-radius: 24px;
                      background-color: #1a1b1f;
                      overflow: hidden;
                    }
                    .mesh-container-generating::after {
                      content: '';
                      position: absolute;
                      inset: 0;
                      border-radius: 24px;
                      pointer-events: none;
                      z-index: 30;
                    }
                    .mesh-blob {
                      position: absolute;
                      border-radius: 50%;
                      filter: blur(45px); 
                      opacity: 0.85;
                      will-change: transform;
                    }
                    .blob-1 {
                      top: -20%; left: -20%; width: 80%; height: 80%;
                      background-color: #a3a8b5;
                      animation: move1 8s infinite ease-in-out;
                    }
                    .blob-2 {
                      bottom: -20%; right: -20%; width: 70%; height: 70%;
                      background-color: #757a87;
                      animation: move2 9s infinite ease-in-out;
                    }
                    .blob-3 {
                      top: -15%; left: -15%; width: 65%; height: 65%;
                      background-color: #12141a;
                      animation: move3 13s infinite ease-in-out; 
                    }
                    .blob-4 {
                      bottom: 10%; left: 10%; width: 60%; height: 60%;
                      background-color: #c2c6d1;
                      animation: move4 15s infinite ease-in-out;
                      z-index: 2;
                    }
                    .blob-5 {
                      bottom: -15%; right: -15%; width: 70%; height: 70%;
                      background-color: #0d0f14;
                      animation: move5 17s infinite ease-in-out; 
                    }
                    @keyframes move1 {
                      0% { transform: translate(0, 0) scale(1); }
                      33% { transform: translate(25%, 15%) scale(1.05); }
                      66% { transform: translate(-10%, 25%) scale(0.95); }
                      100% { transform: translate(0, 0) scale(1); }
                    }
                    @keyframes move2 {
                      0% { transform: translate(0, 0) scale(1); }
                      33% { transform: translate(-25%, -15%) scale(0.95); }
                      66% { transform: translate(15%, -25%) scale(1.05); }
                      100% { transform: translate(0, 0) scale(1); }
                    }
                    @keyframes move3 {
                      0% { transform: translate(0, 0) scale(1); }
                      33% { transform: translate(70%, 20%) scale(1.15); }
                      66% { transform: translate(20%, 70%) scale(0.85); }
                      100% { transform: translate(0, 0) scale(1); }
                    }
                    @keyframes move4 {
                      0% { transform: translate(0, 0) scale(1); }
                      33% { transform: translate(-20%, 20%) scale(1.1); }
                      66% { transform: translate(30%, -15%) scale(0.9); }
                      100% { transform: translate(0, 0) scale(1); }
                    }
                    @keyframes move5 {
                      0% { transform: translate(0, 0) scale(1); }
                      33% { transform: translate(-80%, -30%) scale(1.1); }
                      66% { transform: translate(-10%, -80%) scale(0.9); }
                      100% { transform: translate(0, 0) scale(1); }
                    }
                    .noise-layer {
                      position: absolute;
                      inset: 0;
                      z-index: 10;
                      opacity: 0.045;
                      mix-blend-mode: overlay;
                      pointer-events: none;
                      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.7' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
                    }
                  `}} />
                  <div className="mesh-blob blob-1"></div>
                  <div className="mesh-blob blob-2"></div>
                  <div className="mesh-blob blob-3"></div>
                  <div className="mesh-blob blob-4"></div>
                  <div className="mesh-blob blob-5"></div>
                  <div className="noise-layer"></div>
                </div>
              ) : (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#1c1c1e]">
                   {characterImage && (
                     <img src={characterImage} alt="Character" className="w-full h-full object-cover rounded-[24px]" />
                   )}
                </div>
              )}
            </div>

            {/* Action Pills */}
            <div className="flex items-center gap-2 mt-6 translate-y-2">
              <button 
                style={{
                  backgroundColor: 'rgba(218, 220, 224, 0.9)',
                  borderRadius: '12px',
                  padding: '4px 12px 4px 4px',
                  height: '40px'
                }}
                className="flex items-center gap-2 transition-all cursor-pointer"
                aria-label="Portrait"
              >
                {characterImage ? (
                  <img src={characterImage} alt="Generated image" className="w-[32px] h-[32px] rounded-[8px] object-cover" />
                ) : (
                  <div className="w-[32px] h-[32px] rounded-[8px]" style={{ backgroundColor: 'rgba(22, 23, 24, 0.15)' }}></div>
                )}
                <span
                  style={{
                    color: '#000000',
                    fontFamily: '"Google Sans Text", sans-serif',
                    fontSize: '12px',
                    fontWeight: 500,
                    lineHeight: '16px'
                  }}
                >
                  Portrait
                </span>
              </button>
              
              <button 
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.15)',
                  borderRadius: '12px',
                  padding: '4px 12px 4px 4px',
                  height: '40px'
                }}
                className="flex items-center gap-2 hover:bg-white/20 transition-colors cursor-pointer"
                aria-label="Create Body"
              >
                <div className="flex items-center justify-center w-[32px] h-[32px] rounded-[8px]" style={{ backgroundColor: 'rgba(218, 220, 224, 0.15)' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ color: 'rgba(218, 220, 224, 0.9)' }}>
                    <circle cx="12" cy="4" r="3"/>
                    <path d="M12 9 L12 16 M8 9 L16 9 M12 16 L9 22 M12 16 L15 22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <span
                  style={{
                    color: 'rgba(218, 220, 224, 0.9)',
                    fontFamily: '"Google Sans Text", sans-serif',
                    fontSize: '12px',
                    fontWeight: 500,
                    lineHeight: '16px'
                  }}
                >
                  Create Body
                </span>
              </button>
            </div>

            {/* Editor Bottom Prompt Box - Now ALIGNED UNDER the image container, fixed length */}
            <div className="w-full max-w-[600px] mt-6 translate-y-[16px] flex justify-center">
               <div className="bg-[#141517]/90 backdrop-blur-[80px] rounded-[22px] pt-3 pb-2 px-3 flex flex-col shadow-2xl border border-white/5 w-full">
                <div className="relative flex items-start w-full">
                  <textarea 
                    ref={textareaRef}
                    value={editPrompt}
                    onChange={(e) => setEditPrompt(e.target.value)}
                    rows={1}
                    placeholder="What do you want to change?" 
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

                <button 
                  onClick={() => {
                    if (editPrompt.trim()) startGeneration();
                  }}
                  className={`flex items-center justify-center w-8 h-8 rounded-full bg-[#27282b] hover:bg-[#40424a] transition-all cursor-pointer`}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                    <polyline points="12 5 19 12 12 19"></polyline>
                  </svg>
                </button>
              </div>
            </div>
           </div>
        </div>
      </div>
    </div>
  </div>
    );
  }

  // Initial Grid View
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
            <span className="text-sm font-medium text-white tracking-wide">New character</span>
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
            Build and reuse characters for consistent videos.<br/>
            Use a sample prompt below, or create from scratch.
          </h1>
        </div>

        {/* Character Cards */}
        <div className="grid grid-cols-2 gap-4 w-full">
          {sampleCharacters.map((char, i) => (
            <button 
              key={i}
              onClick={() => {
                setPrompt(char.title);
                startGeneration();
              }}
              className="flex items-center gap-4 p-3.5 rounded-[20px] bg-[#141517] hover:bg-[#1f2023] transition-colors text-left border-none cursor-pointer"
            >
              <img 
                src={char.image} 
                alt={char.title} 
                className="w-[100px] h-[100px] rounded-xl object-cover shrink-0"
              />
              <div className="flex flex-col gap-1.5">
                <h3 className="text-sm font-semibold text-white">{char.title}</h3>
                <p className="text-[11px] text-white/45 leading-relaxed pr-2">{char.description}</p>
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
