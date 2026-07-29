import React, { useState, useRef, useEffect } from 'react';
import { Menu, Edit, X, Plus, ArrowRight, ArrowLeft, ChevronDown, Trash2, Check, FileText, Lightbulb, Search, Terminal, ThumbsUp, ThumbsDown, Copy, AudioLines } from 'lucide-react';
import { motion } from 'framer-motion';
import { useUserDataContext } from '../../context/UserDataContext';
import { streamChat, ChatMessage, StreamPhase, generateSessionTitle } from '../../lib/ai';
import { StreamingMarkdown } from '../ui/StreamingMarkdown';
import { TextShimmer } from '../ui/text-shimmer';

interface ImageAttachment {
  id: string;
  url: string;
  name: string;
  file?: File;
  kind?: 'image' | 'video' | 'audio';
}

export interface AgentInstruction {
  id: string;
  title: string;
  isActive: boolean;
  content: string;
  referenceName?: string;
  isEditingTitle?: boolean;
}

const SidebarRatioIcon = ({ ratio, className }: { ratio: string, className?: string }) => {
  const getProps = () => {
    switch (ratio) {
      case '16:9': return { x: 2, y: 6, width: 20, height: 12, rx: 2 };
      case '4:3':  return { x: 4, y: 5, width: 16, height: 14, rx: 2 };
      case '1:1':  return { x: 5, y: 5, width: 14, height: 14, rx: 2 };
      case '3:4':  return { x: 5, y: 4, width: 14, height: 16, rx: 2 };
      case '9:16': return { x: 6, y: 2, width: 12, height: 20, rx: 2 };
      default:     return { x: 2, y: 6, width: 20, height: 12, rx: 2 };
    }
  };
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect {...getProps()} />
    </svg>
  );
};

const ToggleSwitch = ({ checked, onChange }: { checked: boolean; onChange: () => void }) => {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`w-9 h-5 rounded-full p-0.5 transition-colors duration-200 focus:outline-none cursor-pointer flex items-center shrink-0 ${checked ? 'bg-[#c2c2c3]' : 'bg-white/10'}`}
    >
      <div
        className={`w-4 h-4 rounded-full transition-transform duration-200 ${checked ? 'bg-black translate-x-4' : 'bg-zinc-400 translate-x-0'}`}
      />
    </button>
  );
};

interface InstructionCardProps {
  inst: AgentInstruction;
  toggleActive: () => void;
  updateTitle: (title: string) => void;
  updateContent: (content: string) => void;
  setEditingTitle: (isEditing: boolean) => void;
  deleteSelf: () => void;
  toggleReference: (ref: React.RefObject<HTMLDivElement>) => void;
  clearReference: () => void;
}

const InstructionCard: React.FC<InstructionCardProps> = ({
  inst,
  toggleActive,
  updateTitle,
  updateContent,
  setEditingTitle,
  deleteSelf,
  toggleReference,
  clearReference
}) => {
  const [tempTitle, setTempTitle] = useState(inst.title);
  const referenceBtnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTempTitle(inst.title);
  }, [inst.title]);

  return (
    <div className="bg-[#2a2b2d] border border-white/[0.04] backdrop-blur-md rounded-[16px] p-4 flex flex-col gap-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <ToggleSwitch checked={inst.isActive} onChange={toggleActive} />
          {inst.isEditingTitle ? (
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={tempTitle}
                onChange={(e) => setTempTitle(e.target.value)}
                className="bg-transparent text-white font-medium text-[13px] outline-none border-b border-white/20 w-32 py-0.5"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    updateTitle(tempTitle);
                    setEditingTitle(false);
                  } else if (e.key === 'Escape') {
                    setTempTitle(inst.title);
                    setEditingTitle(false);
                  }
                }}
              />
              <button 
                onClick={() => {
                  updateTitle(tempTitle);
                  setEditingTitle(false);
                }}
                className="text-emerald-400 hover:text-emerald-300 p-0.5 cursor-pointer"
              >
                <Check size={14} strokeWidth={2.5} />
              </button>
              <button 
                onClick={() => {
                  setTempTitle(inst.title);
                  setEditingTitle(false);
                }}
                className="text-rose-400 hover:text-rose-300 p-0.5 cursor-pointer"
              >
                <X size={14} strokeWidth={2.5} />
              </button>
            </div>
          ) : (
            <span 
              onClick={() => setEditingTitle(true)}
              className="text-white font-medium text-[13px] tracking-wide cursor-pointer hover:text-zinc-200 select-none"
            >
              {inst.title}
            </span>
          )}
        </div>
        <button 
          onClick={deleteSelf}
          className="text-[#8e8e93] hover:text-red-400 transition-colors p-1 rounded hover:bg-white/5 cursor-pointer"
        >
          <Trash2 size={15} />
        </button>
      </div>

      <div className="flex items-center gap-3">
        <div 
          ref={referenceBtnRef}
          onClick={() => toggleReference(referenceBtnRef)}
          className={`w-[72px] h-[72px] rounded-[12px] border flex flex-col items-center justify-center gap-1 transition-colors duration-200 cursor-pointer select-none shrink-0 relative group ${
            inst.referenceName 
              ? 'border-white bg-[#2a2b2d] text-white hover:border-white' 
              : 'border-dashed border-white/10 bg-[#2a2b2d] hover:border-white/40 hover:bg-[#333437] text-[#a0a0a0] hover:text-white'
          }`}
        >
          {inst.referenceName ? (
            <>
              <FileText size={18} strokeWidth={2} />
              <span className="text-[8px] font-medium tracking-tight truncate max-w-[60px] px-1">{inst.referenceName}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  clearReference();
                }}
                className="absolute -top-1.5 -right-1.5 bg-[#27272a] text-gray-400 hover:text-white border border-white/10 rounded-full p-0.5 shadow-xl cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity z-10"
              >
                <X size={8} />
              </button>
            </>
          ) : (
            <>
              <Plus size={16} strokeWidth={2.5} />
              <span className="text-[10px] font-medium tracking-tight">Reference</span>
            </>
          )}
        </div>
        <textarea
          value={inst.content}
          onChange={(e) => updateContent(e.target.value)}
          placeholder="Create a guideline for your agent"
          className={`flex-1 h-[72px] rounded-[12px] bg-[#2a2b2d] border transition-colors duration-200 p-2.5 text-[12px] text-white placeholder-[#606060] outline-none resize-none no-scrollbar ${
            inst.content ? 'border-white/20' : 'border-white/[0.04]'
          } hover:border-white/40 focus:border-white`}
        />
      </div>
    </div>
  );
};

interface AgentSidebarProps {
  onClose: () => void;
  isOpen: boolean;
  isHeaderVisible: boolean;
  sidebarTransition?: string;
  prompt: string;
  setPrompt: React.Dispatch<React.SetStateAction<string>>;
  attachments: ImageAttachment[];
  setAttachments: React.Dispatch<React.SetStateAction<ImageAttachment[]>>;
  
  chatMessages: ChatMessage[];
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  isGenerating: boolean;
  setIsGenerating: React.Dispatch<React.SetStateAction<boolean>>;
  streaming: string;
  setStreaming: React.Dispatch<React.SetStateAction<string>>;
  isThinking: boolean;
  setIsThinking: React.Dispatch<React.SetStateAction<boolean>>;
  thinkingPhase: StreamPhase;
  setThinkingPhase: React.Dispatch<React.SetStateAction<StreamPhase>>;
  sessionName: string;
  setSessionName: React.Dispatch<React.SetStateAction<string>>;
  handleSend: (text: string) => Promise<void>;

  imageRatio: string;
  setImageRatio: React.Dispatch<React.SetStateAction<string>>;
  imageBatch: string;
  setImageBatch: React.Dispatch<React.SetStateAction<string>>;
  imageModel: string;
  setImageModel: React.Dispatch<React.SetStateAction<string>>;
  videoRatio: string;
  setVideoRatio: React.Dispatch<React.SetStateAction<string>>;
  videoBatch: string;
  setVideoBatch: React.Dispatch<React.SetStateAction<string>>;
  videoModel: string;
  setVideoModel: React.Dispatch<React.SetStateAction<string>>;
  onPlusClick?: (
    ref: React.RefObject<any>,
    source: 'sidebar' | 'instruction-reference',
    instructionId?: string
  ) => void;
  instructions: AgentInstruction[];
  setInstructions: React.Dispatch<React.SetStateAction<AgentInstruction[]>>;
  isLive?: boolean;
  onStartLive?: () => void;
  onStopLive?: () => void;
  mediaItems?: any[];
}

export const AgentSidebar: React.FC<AgentSidebarProps> = ({ 
  onClose, 
  isOpen, 
  isHeaderVisible,
  sidebarTransition = '0.5s cubic-bezier(0.16, 1, 0.3, 1)',
  prompt,
  setPrompt,
  attachments,
  setAttachments,
  isLive,
  onStartLive,
  onStopLive,
  chatMessages,
  setChatMessages,
  isGenerating,
  setIsGenerating,
  streaming,
  setStreaming,
  mediaItems,
  isThinking,
  setIsThinking,
  thinkingPhase,
  setThinkingPhase,
  sessionName,
  setSessionName,
  handleSend,
  imageRatio,
  setImageRatio,
  imageBatch,
  setImageBatch,
  imageModel,
  setImageModel,
  videoRatio,
  setVideoRatio,
  videoBatch,
  setVideoBatch,
  videoModel,
  setVideoModel,
  onPlusClick,
  instructions,
  setInstructions
}) => {
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());


  const sidebarTextareaRef = useRef<HTMLTextAreaElement>(null);
  const sidebarFileInputRef = useRef<HTMLInputElement>(null);
  const sidebarPlusButtonRef = useRef<HTMLButtonElement>(null);

  const [sidebarView, setSidebarView] = useState<'main' | 'settings' | 'instructions'>('main');
  const [confirmBeforeGen, setConfirmBeforeGen] = useState<'always' | 'never'>('always');
  const [isImgDropdownOpen, setIsImgDropdownOpen] = useState(false);
  const [isVidDropdownOpen, setIsVidDropdownOpen] = useState(false);
  const [lastSubView, setLastSubView] = useState<'settings' | 'instructions'>('instructions');

  // Synchronous render-phase state update to completely eliminate any 1-frame transition lag or flash
  if ((sidebarView === 'settings' || sidebarView === 'instructions') && lastSubView !== sidebarView) {
    setLastSubView(sidebarView);
  }

  const { apiKeys } = useUserDataContext();

  const [reactions, setReactions] = useState<Record<number, 'like' | 'dislike' | null>>({});
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const handleCopy = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedId(idx);
    setTimeout(() => {
      setCopiedId(prev => prev === idx ? null : prev);
    }, 1600);
  };

  const chatScrollRef = useRef<HTMLDivElement>(null);

  const prevMessagesLength = useRef(0);
  const [collapsedSpacerHeight, setCollapsedSpacerHeight] = useState(32);

  useEffect(() => {
    if (isGenerating) return;

    const updateSpacerHeight = () => {
      if (!chatScrollRef.current || chatMessages.length < 2) {
        setCollapsedSpacerHeight(32);
        return;
      }
      
      const container = chatScrollRef.current;
      const userMessageEl = document.getElementById(`message-${chatMessages.length - 2}`);
      const assistantMessageEl = document.getElementById(`message-${chatMessages.length - 1}`);
      
      if (userMessageEl && assistantMessageEl) {
        const requiredHeightBelowUser = container.clientHeight;
        const actualHeightBelowUserStart = (assistantMessageEl.offsetTop + assistantMessageEl.offsetHeight) - userMessageEl.offsetTop;
        const calculatedSpacerHeight = requiredHeightBelowUser - actualHeightBelowUserStart - 24;
        
        setCollapsedSpacerHeight(Math.max(32, calculatedSpacerHeight));
      } else {
        setCollapsedSpacerHeight(32);
      }
    };

    // Run once when generation finishes, with a small delay for DOM to settle
    const timer = setTimeout(updateSpacerHeight, 100);

    // Run on window resize for complete responsiveness
    window.addEventListener('resize', updateSpacerHeight);
    
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updateSpacerHeight);
    };
  }, [isGenerating, chatMessages]);

  const handleScroll = () => {
    if (!chatScrollRef.current) return;
    const container = chatScrollRef.current;

    if (isGenerating && chatMessages.length >= 2) {
      const userMessageEl = document.getElementById(`message-${chatMessages.length - 2}`);
      const assistantMessageEl = document.getElementById(`message-${chatMessages.length - 1}`);
      
      if (userMessageEl && assistantMessageEl) {
        const snapPosition = Math.max(0, userMessageEl.offsetTop - 24);
        const bottomOfMessage = assistantMessageEl.offsetTop + assistantMessageEl.offsetHeight;
        const maxAllowedScroll = Math.max(snapPosition, bottomOfMessage - container.clientHeight + 32);
        
        if (container.scrollTop > maxAllowedScroll) {
          container.scrollTop = maxAllowedScroll;
        }
      }
    }
  };

  // Smart Snap-to-Top scroll behavior
  useEffect(() => {
    if (!chatScrollRef.current) return;
    
    const isNewMessage = chatMessages.length > prevMessagesLength.current;
    prevMessagesLength.current = chatMessages.length;

    if (isNewMessage && isGenerating) {
      // Wait for DOM to render the new messages
      setTimeout(() => {
        if (!chatScrollRef.current) return;
        const userMessageEl = document.getElementById(`message-${chatMessages.length - 2}`);
        if (userMessageEl) {
          const isFirstPair = chatMessages.length === 2;
          // Snap the user message to near the top (instant for the first message, smooth for history)
          chatScrollRef.current.scrollTo({
            top: Math.max(0, userMessageEl.offsetTop - 24),
            behavior: isFirstPair ? 'auto' : 'smooth'
          });
        }
      }, 50);
      return;
    }
  }, [chatMessages, isGenerating]);

  // Prevent elastic overscroll bounce/jitter on wheel & touch while locked during generation
  useEffect(() => {
    const container = chatScrollRef.current;
    if (!container || !isGenerating || chatMessages.length < 2) return;

    let touchStartY = 0;

    const handleWheelNative = (e: WheelEvent) => {
      const userMessageEl = document.getElementById(`message-${chatMessages.length - 2}`);
      const assistantMessageEl = document.getElementById(`message-${chatMessages.length - 1}`);
      
      if (userMessageEl && assistantMessageEl) {
        const snapPosition = Math.max(0, userMessageEl.offsetTop - 24);
        const bottomOfMessage = assistantMessageEl.offsetTop + assistantMessageEl.offsetHeight;
        const maxAllowedScroll = Math.max(snapPosition, bottomOfMessage - container.clientHeight + 32);

        if (container.scrollTop >= maxAllowedScroll - 1 && e.deltaY > 0) {
          e.preventDefault();
          container.scrollTop = maxAllowedScroll;
        }
      }
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        touchStartY = e.touches[0].clientY;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      const userMessageEl = document.getElementById(`message-${chatMessages.length - 2}`);
      const assistantMessageEl = document.getElementById(`message-${chatMessages.length - 1}`);
      
      if (userMessageEl && assistantMessageEl) {
        const snapPosition = Math.max(0, userMessageEl.offsetTop - 24);
        const bottomOfMessage = assistantMessageEl.offsetTop + assistantMessageEl.offsetHeight;
        const maxAllowedScroll = Math.max(snapPosition, bottomOfMessage - container.clientHeight + 32);

        const currentY = e.touches[0].clientY;
        const isSwipingUp = currentY < touchStartY;

        if (container.scrollTop >= maxAllowedScroll - 1 && isSwipingUp) {
          e.preventDefault();
          container.scrollTop = maxAllowedScroll;
        }
      }
    };

    container.addEventListener('wheel', handleWheelNative, { passive: false });
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleWheelNative);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
    };
  }, [isGenerating, chatMessages]);

  const convertToAiAttachment = async (att: ImageAttachment): Promise<any> => {
    if (att.url.startsWith('data:')) {
      const match = att.url.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        return {
          type: 'image',
          mimeType: match[1],
          data: match[2],
          name: att.name
        };
      }
    }

    if (att.file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          const match = result.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            resolve({
              type: 'image',
              mimeType: match[1],
              data: match[2],
              name: att.name
            });
          } else {
            reject(new Error('Failed to parse file data'));
          }
        };
        reader.onerror = reject;
        reader.readAsDataURL(att.file);
      });
    }

    try {
      const res = await fetch(att.url);
      const blob = await res.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          const match = result.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            resolve({
              type: 'image',
              mimeType: match[1],
              data: match[2],
              name: att.name
            });
          } else {
            reject(new Error('Failed to parse file data'));
          }
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      throw new Error(`Failed to process attachment: ${att.name}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(prompt);
    }
  };

  const addInstruction = () => {
    const newInst: AgentInstruction = {
      id: Math.random().toString(36).substring(7),
      title: 'Instruction title',
      isActive: true,
      content: '',
      isEditingTitle: true
    };
    setInstructions(prev => [...prev, newInst]);
  };

  const deleteInstruction = (id: string) => {
    setInstructions(prev => prev.filter(inst => inst.id !== id));
  };

  const toggleInstructionActive = (id: string) => {
    setInstructions(prev => prev.map(inst => inst.id === id ? { ...inst, isActive: !inst.isActive } : inst));
  };

  const updateInstructionTitle = (id: string, title: string) => {
    setInstructions(prev => prev.map(inst => inst.id === id ? { ...inst, title } : inst));
  };

  const updateInstructionContent = (id: string, content: string) => {
    setInstructions(prev => prev.map(inst => inst.id === id ? { ...inst, content } : inst));
  };

  const setEditingTitle = (id: string, isEditingTitle: boolean) => {
    setInstructions(prev => prev.map(inst => inst.id === id ? { ...inst, isEditingTitle } : inst));
  };

  const handleClearReference = (id: string) => {
    setInstructions(prev => prev.map(inst => inst.id === id ? { ...inst, referenceName: undefined } : inst));
  };

  const hasActiveAttachments = attachments.length > 0 && !attachments.every(att => removingIds.has(att.id));

  useEffect(() => {
    const adjustHeight = () => {
      if (sidebarTextareaRef.current) {
        const el = sidebarTextareaRef.current;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
      }
    };

    adjustHeight();

    const raf = requestAnimationFrame(adjustHeight);
    
    if (typeof document !== 'undefined' && 'fonts' in document) {
      document.fonts.ready.then(adjustHeight);
    }

    const timer = setTimeout(adjustHeight, 200);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [prompt, isOpen, sidebarView]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);
    const newAttachments = files.map(file => ({
      id: Math.random().toString(36).substring(7),
      url: URL.createObjectURL(file),
      name: file.name || `attached-image.png`,
      file
    }));
    setAttachments(prev => [...prev, ...newAttachments]);
    e.target.value = '';
  };

  const removeAttachment = (id: string) => {


    setRemovingIds(prev => new Set(prev).add(id));
    setTimeout(() => {
      setAttachments(prev => prev.filter(att => att.id !== id));
      setRemovingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 200);
  };

  return (
    <div 
      className="fixed right-2 w-[348px] bg-[#171719] rounded-[18px] shadow-2xl z-[70] flex flex-col overflow-hidden agent-sidebar-container"
      style={{
        top: isHeaderVisible ? '72px' : '16px',
        bottom: '8px',
        transform: isOpen ? 'translateX(0)' : 'translateX(calc(100% + 24px))',
        transition: `transform 0.5s cubic-bezier(0.16, 1, 0.3, 1), top ${sidebarTransition}, visibility 0.5s`,
        visibility: isOpen ? 'visible' : 'hidden'
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Sliding Viewport Container */}
      <div 
        className="flex-1 flex w-[200%] min-h-0"
        style={{
          transform: sidebarView === 'main'
            ? 'translateX(0%)' 
            : 'translateX(-50%)',
          transition: 'transform 500ms cubic-bezier(0.16, 1, 0.3, 1)'
        }}
      >
        {/* Main Panel */}
        <div className="w-1/2 h-full flex flex-col relative shrink-0">
          {/* Top Bar */}
          <div className="flex items-center justify-between pl-6 pr-4 py-5 relative z-10 shrink-0">
            <div className="flex items-center gap-4">
              <button className="text-[#a0a0a0] hover:text-white transition-colors outline-none cursor-pointer">
                <Menu size={18} strokeWidth={2} />
              </button>
              <span className="text-white font-medium text-[15px] tracking-wide">{sessionName}</span>
            </div>
            <div className="flex items-center gap-4">
              <button 
                onClick={() => {
                  setChatMessages([]);
                  setStreaming('');
                  setIsGenerating(false);
                  setSessionName('Untitled session');
                }}
                className="text-[#a0a0a0] hover:text-white transition-colors outline-none cursor-pointer p-1 rounded hover:bg-white/5"
                title="New chat"
              >
                <Edit size={16} strokeWidth={2} />
              </button>
              <button onClick={onClose} className="text-[#a0a0a0] hover:text-white transition-colors outline-none cursor-pointer">
                <X size={18} strokeWidth={2} />
              </button>
            </div>
          </div>

          {/* Main Content Area */}
          <div className="flex-1 min-h-0 relative flex flex-col">
            {chatMessages.length === 0 && !isGenerating ? (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
                className="absolute inset-0 flex flex-col items-center justify-start p-6 pt-[136px] select-none"
              >
                <div className="text-center space-y-4 mb-8" style={{ fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}>
                  <h2 className="text-[#8c8c8c] text-[22px] font-medium tracking-tight">Hi Yashjit</h2>
                  <h1 className="text-[#e2e2e2] text-[26px] font-medium leading-[1.15] tracking-tight">
                    What would you like to<br />do?
                  </h1>
                </div>

                <div className="flex flex-col items-center gap-3 w-full">
                  <button 
                    onClick={() => handleSend("Edit an image with Nano Banana")}
                    className="w-fit py-3 px-5 rounded-full border border-white/10 hover:bg-white/5 transition-colors text-[#d0d0d0] hover:text-white text-[13px] font-medium tracking-wide cursor-pointer outline-none"
                  >
                    Edit an image with Nano Banana
                  </button>
                  <button 
                    onClick={() => handleSend("Develop a storyboard")}
                    className="w-fit py-3 px-5 rounded-full border border-white/10 hover:bg-white/5 transition-colors text-[#d0d0d0] hover:text-white text-[13px] font-medium tracking-wide cursor-pointer outline-none"
                  >
                    Develop a storyboard
                  </button>
                  <button 
                    onClick={() => handleSend("Generate concept art")}
                    className="w-fit py-3 px-5 rounded-full border border-white/10 hover:bg-white/5 transition-colors text-[#d0d0d0] hover:text-white text-[13px] font-medium tracking-wide cursor-pointer outline-none"
                  >
                    Generate concept art
                  </button>
                </div>
              </motion.div>
            ) : (
              <div 
                ref={chatScrollRef}
                onScroll={handleScroll}
                className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-6 min-h-0 no-scrollbar"
                style={{ scrollbarWidth: 'none' }}
              >
                {chatMessages.map((msg, idx) => {
                  if (msg.role === 'user') {
                    return (
                      <div key={idx} id={`message-${idx}`} className="flex justify-end shrink-0 animate-in fade-in slide-in-from-bottom-2 duration-200">
                        <div className="max-w-[85%] bg-[#2b2c2e] text-[#f4f4f5] px-4 py-2.5 rounded-[20px] text-[13px] leading-relaxed whitespace-pre-wrap break-words border border-white/[0.04]">
                          {msg.attachments && msg.attachments.length > 0 && (
                            <div className="flex gap-1.5 flex-wrap mb-2">
                              {msg.attachments.map((att: any, attIdx: number) => (
                                <div key={attIdx} className="w-10 h-10 rounded-lg overflow-hidden border border-white/10">
                                  <img 
                                    src={`data:${att.mimeType};base64,${att.data}`} 
                                    alt={att.name || "attached"} 
                                    className="w-full h-full object-cover"
                                  />
                                </div>
                              ))}
                            </div>
                          )}
                          {msg.content}
                        </div>
                      </div>
                    );
                  } else {
                    const isLast = idx === chatMessages.length - 1;
                    const isPlaceholderAndGenerating = isLast && isGenerating && !msg.content;
                    const bodyText = isPlaceholderAndGenerating ? streaming : msg.content || streaming;
                    const generating = isLast && isGenerating;
                    const showActions = !generating && bodyText.trim().length > 0;
                    
                    return (
                      <div key={idx} id={`message-${idx}`} className="flex flex-col gap-2 shrink-0 animate-in fade-in duration-300">
                        {isLast && isGenerating && isThinking && (
                          <div className="flex items-center gap-2 text-zinc-500 text-[12px] font-medium">
                            <Lightbulb size={14} className="animate-pulse text-zinc-400" />
                            <TextShimmer className="text-[12px] font-medium" duration={1.5}>
                              {thinkingPhase === 'searching' ? 'Searching...' :
                               thinkingPhase === 'executing' ? 'Running code...' : 'Thinking...'}
                            </TextShimmer>
                          </div>
                        )}
                        
                        <div className="text-[#e2e2e2] text-[13.5px] leading-relaxed max-w-full overflow-hidden">
                          <StreamingMarkdown
                            text={bodyText}
                            isStreaming={isLast && isGenerating}
                            animate={true}
                            mediaItems={mediaItems}
                          />
                        </div>

                        {/* Action row — fades in only after completion to avoid layout jump */}
                        <motion.div
                          initial={false}
                          animate={{
                            opacity: showActions ? 1 : 0,
                            height: showActions ? 'auto' : 0,
                            marginTop: showActions ? '8px' : '0px'
                          }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="flex items-center justify-between pt-2 border-t border-white/[0.04]">
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() =>
                                  setReactions((r) => ({ ...r, [idx]: r[idx] === 'like' ? null : 'like' }))
                                }
                                className={`p-1 transition-colors rounded hover:bg-white/5 cursor-pointer outline-none ${
                                  reactions[idx] === 'like' ? 'text-white' : 'text-gray-500 hover:text-gray-300'
                                }`}
                                title="Like response"
                              >
                                <ThumbsUp size={14.5} fill={reactions[idx] === 'like' ? 'currentColor' : 'none'} />
                              </button>
                              <button
                                onClick={() =>
                                  setReactions((r) => ({ ...r, [idx]: r[idx] === 'dislike' ? null : 'dislike' }))
                                }
                                className={`p-1 transition-colors rounded hover:bg-white/5 cursor-pointer outline-none ${
                                  reactions[idx] === 'dislike' ? 'text-white' : 'text-gray-500 hover:text-gray-300'
                                }`}
                                title="Dislike response"
                              >
                                <ThumbsDown size={14.5} fill={reactions[idx] === 'dislike' ? 'currentColor' : 'none'} />
                              </button>
                            </div>
                            <button
                              onClick={() => handleCopy(bodyText, idx)}
                              className="p-1 text-gray-500 hover:text-gray-300 transition-colors rounded hover:bg-white/5 cursor-pointer outline-none"
                              title="Copy response"
                            >
                              {copiedId === idx ? <Check size={14.5} className="text-emerald-400" /> : <Copy size={14.5} />}
                            </button>
                          </div>
                        </motion.div>
                      </div>
                    );
                  }
                })}
                <div 
                  className={`flex-shrink-0 ${!isGenerating ? 'transition-[height] duration-500 ease-out' : ''}`} 
                  style={{ height: isGenerating ? '60vh' : `${collapsedSpacerHeight}px` }}
                />
              </div>
            )}
          </div>

          {/* Bottom Input Area */}
          <div className="p-3 mt-auto mb-0 shrink-0 relative z-20 bg-[#171719]">
            <style>{`
              @keyframes quickFadeIn {
                0% { opacity: 0; }
                100% { opacity: 1; }
              }
              .preview-fade-in {
                animation: quickFadeIn 230ms ease-out forwards;
              }
            `}</style>
            <input 
              type="file" 
              multiple 
              accept="image/*"
              className="hidden" 
              ref={sidebarFileInputRef} 
              onChange={handleFileSelect} 
            />
            <div className="bg-transparent border border-white/[0.08] hover:border-white/[0.12] transition-colors rounded-[24px] px-3 pt-1.5 pb-2.5 flex flex-col gap-1.5 relative prompt-container-box">

              {/* Attachments Area */}
              <div className={`grid transition-[grid-template-rows] duration-[250ms] ease-in-out ${hasActiveAttachments ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                <div className="overflow-hidden">
                  <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2 pt-1.5 pl-0 pr-1.5 w-full">
                    {attachments.map((att) => (
                      <div 
                        key={att.id} 
                        className={`relative group flex-shrink-0 p-1.5 -m-1.5 transition-all duration-200 ${removingIds.has(att.id) ? 'opacity-0 scale-90' : 'opacity-100 scale-100 animate-in fade-in zoom-in-95'}`}
                      >
                        <div className="relative">
                          <div className="w-12 h-12 rounded-xl overflow-hidden border border-white/5 bg-[#1c1c1e]">
                            {att.kind === 'video' ? (
                              <video src={att.url} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" muted loop playsInline />
                            ) : (
                              <img src={att.url} alt={att.name} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                            )}
                          </div>
                          <button 
                            onClick={() => removeAttachment(att.id)}
                            className="absolute -top-1.5 -right-1.5 bg-[#27272a] text-gray-400 hover:text-white border border-white/10 rounded-full p-0.5 shadow-xl cursor-pointer z-[60]"
                          >
                            <X size={10} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <textarea 
                ref={sidebarTextareaRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={(e) => {
                  const items = e.clipboardData?.items;
                  if (!items) return;
                  const imageFiles: File[] = [];
                  for (let i = 0; i < items.length; i++) {
                    if (items[i].type.startsWith('image/')) {
                      const file = items[i].getAsFile();
                      if (file) imageFiles.push(file);
                    }
                  }
                  if (imageFiles.length > 0) {
                    e.preventDefault();
                    const newAttachments = imageFiles.map(file => ({
                      id: Math.random().toString(36).substring(7),
                      url: URL.createObjectURL(file),
                      name: file.name || `pasted-image.${file.type.split('/')[1] || 'png'}`,
                      file
                    }));
                    setAttachments(prev => [...prev, ...newAttachments]);
                  }
                }}
                placeholder="What do you want to create?"
                rows={1}
                className="bg-transparent border-none outline-none text-[#e2e2e2] text-[14px] font-medium placeholder-[#606060] w-full px-2 pt-0.5 pb-1.5 resize-none overflow-y-auto no-scrollbar"
                style={{
                  scrollbarWidth: 'none',
                  msOverflowStyle: 'none'
                }}
              />
              <div className="flex items-center justify-between px-1 mt-1">
                <button 
                  ref={sidebarPlusButtonRef}
                  onClick={() => {
                    if (onPlusClick) {
                      onPlusClick(sidebarPlusButtonRef, 'sidebar');
                    } else {
                      sidebarFileInputRef.current?.click();
                    }
                  }}
                  className="text-[#a0a0a0] hover:text-white transition-colors cursor-pointer outline-none"
                >
                  <Plus size={20} strokeWidth={2} />
                </button>
                <div className="flex items-center gap-1.5">
                  <button 
                    onClick={() => setSidebarView('instructions')}
                    className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/5 text-[#a0a0a0] hover:text-white transition-colors cursor-pointer outline-none"
                  >
                    <svg viewBox="16 10 76 76" className="w-[18px] h-[18px]">
                      <path d="M 52,24 L 28,24 A 4,4 0 0,0 24,28 L 24,72 A 4,4 0 0,0 28,76 L 72,76 A 4,4 0 0,0 72,72 L 76,52" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
                      <g fill="currentColor">
                        <rect x="34" y="34" width="18" height="6" rx="1" />
                        <rect x="34" y="47" width="30" height="6" rx="1" />
                        <rect x="34" y="60" width="18" height="6" rx="1" />
                        <path d="M 72,16 Q 72,32 56,32 Q 72,32 72,48 Q 72,32 88,32 Q 72,32 72,16 Z" />
                      </g>
                    </svg>
                  </button>
                  <button 
                    onClick={() => setSidebarView('settings')}
                    className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/5 text-[#a0a0a0] hover:text-white transition-colors cursor-pointer outline-none"
                  >
                    <svg viewBox="0 0 100 100" className="w-[18px] h-[18px]">
                      <g fill="currentColor">
                        <rect x="14" y="22" width="40" height="8" rx="1.5" />
                        <rect x="62" y="14" width="8" height="24" rx="1.5" />
                        <rect x="70" y="22" width="16" height="8" rx="1.5" />
                        <rect x="14" y="46" width="16" height="8" rx="1.5" />
                        <rect x="30" y="38" width="8" height="24" rx="1.5" />
                        <rect x="46" y="46" width="40" height="8" rx="1.5" />
                        <rect x="14" y="70" width="24" height="8" rx="1.5" />
                        <rect x="46" y="62" width="8" height="24" rx="1.5" />
                        <rect x="54" y="70" width="32" height="8" rx="1.5" />
                      </g>
                    </svg>
                  </button>
                  <button 
                    onClick={() => {
                      if (isGenerating) return;
                      if (!prompt.trim() && !hasActiveAttachments) {
                        isLive ? onStopLive?.() : onStartLive?.();
                      } else {
                        handleSend(prompt);
                      }
                    }}
                    className={`w-[30px] h-[30px] flex items-center justify-center rounded-full ml-1 transition-colors cursor-pointer outline-none ${!isGenerating ? (isLive ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse' : 'bg-white text-black hover:bg-gray-200') : 'bg-white/5 text-[#606060]'}`}
                  >
                    {!isGenerating && !prompt.trim() && !hasActiveAttachments ? (
                      isLive ? (
                        <div className="w-2.5 h-2.5 bg-current rounded-[1px]" />
                      ) : (
                        <AudioLines size={15} strokeWidth={2.2} />
                      )
                    ) : (
                      <ArrowRight size={15} strokeWidth={2.5} />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Sub-View Container (Slot 1) */}
        <div className="w-1/2 h-full relative shrink-0">
          {/* Settings Panel */}
          <div 
            className="absolute inset-0 h-full flex flex-col"
            style={{
              display: lastSubView === 'settings' ? 'flex' : 'none',
              pointerEvents: lastSubView === 'settings' ? 'auto' : 'none'
            }}
          >
          {/* Settings Top Bar */}
          <div className="flex items-center justify-between pl-4 pr-4 pt-[18px] pb-[14px] relative z-10 border-none shrink-0">
            <div className="flex items-center gap-3">
              <button 
                onClick={() => {
                  setSidebarView('main');
                  setIsImgDropdownOpen(false);
                  setIsVidDropdownOpen(false);
                }}
                className="text-[#a0a0a0] hover:text-white transition-colors outline-none cursor-pointer p-1 rounded-full hover:bg-white/5"
              >
                <ArrowLeft size={18} strokeWidth={2} />
              </button>
              <span className="text-white font-medium text-[15px] tracking-wide" style={{ fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}>Agent settings</span>
            </div>
            <button 
              onClick={() => {
                onClose();
                setSidebarView('main');
                setIsImgDropdownOpen(false);
                setIsVidDropdownOpen(false);
              }}
              className="text-[#a0a0a0] hover:text-white transition-colors outline-none cursor-pointer p-1 rounded-full hover:bg-white/5"
            >
              <X size={18} strokeWidth={2} />
            </button>
          </div>

          {/* Settings Content */}
          <div className="flex-1 overflow-y-auto no-scrollbar px-6 pt-3 pb-4 space-y-4 min-h-0 select-none">
              
              {/* Section 1: Confirm before generating */}
              <div className="space-y-2">
                <h3 className="text-[#8c8c8c] text-[12px] font-semibold uppercase tracking-wider" style={{ fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}>Confirm before generating</h3>
                <div className="space-y-2">
                  <button 
                    onClick={() => setConfirmBeforeGen('always')}
                    className={`w-full flex items-center gap-3.5 p-3.5 rounded-[14px] border-none text-left transition-all duration-200 cursor-pointer outline-none ${confirmBeforeGen === 'always' ? 'bg-[#4a4a4a] text-white' : 'bg-[#1e1f21]/50 text-gray-400 hover:bg-white/5 hover:text-white'}`}
                  >
                    <div className="flex-shrink-0">
                      <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors duration-200 ${confirmBeforeGen === 'always' ? 'border-white' : 'border-gray-500'}`}>
                        {confirmBeforeGen === 'always' && <div className="w-2 h-2 rounded-full bg-white animate-in zoom-in-50 duration-150" />}
                      </div>
                    </div>
                    <div className="space-y-0.5">
                      <div className={`text-[13px] font-medium transition-colors ${confirmBeforeGen === 'always' ? 'text-white' : 'text-gray-200'}`}>Always</div>
                      <div className={`text-[11px] leading-relaxed transition-colors ${confirmBeforeGen === 'always' ? 'text-gray-200' : 'text-[#8c8c8c]'}`}>Agent will ask for confirmation before generating media.</div>
                    </div>
                  </button>

                  <button 
                    onClick={() => setConfirmBeforeGen('never')}
                    className={`w-full flex items-center gap-3.5 p-3.5 rounded-[14px] border-none text-left transition-all duration-200 cursor-pointer outline-none ${confirmBeforeGen === 'never' ? 'bg-[#4a4a4a] text-white' : 'bg-[#1e1f21]/50 text-gray-400 hover:bg-white/5 hover:text-white'}`}
                  >
                    <div className="flex-shrink-0">
                      <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors duration-200 ${confirmBeforeGen === 'never' ? 'border-white' : 'border-gray-500'}`}>
                        {confirmBeforeGen === 'never' && <div className="w-2 h-2 rounded-full bg-white animate-in zoom-in-50 duration-150" />}
                      </div>
                    </div>
                    <div className="space-y-0.5">
                      <div className={`text-[13px] font-medium transition-colors ${confirmBeforeGen === 'never' ? 'text-white' : 'text-gray-200'}`}>Never</div>
                      <div className={`text-[11px] leading-relaxed transition-colors ${confirmBeforeGen === 'never' ? 'text-gray-200' : 'text-[#8c8c8c]'}`}>Agent will generate media and spend credits automatically.</div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Section 2: Image generation default */}
              <div className="space-y-2">
                <h3 className="text-[#8c8c8c] text-[12px] font-semibold uppercase tracking-wider" style={{ fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}>Image generation default</h3>
                <div className="space-y-2">
                  
                  {/* Ratios */}
                  <div className="flex bg-[#1e1f21]/50 backdrop-blur-md rounded-[14px] p-1 justify-between w-full">
                    {['16:9', '4:3', '1:1', '3:4', '9:16'].map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setImageRatio(r)}
                        className={`flex-1 flex flex-col items-center justify-center gap-1 py-1.5 rounded-[10px] transition-colors cursor-pointer outline-none ${imageRatio === r ? 'bg-[#4a4a4a]' : 'hover:bg-white/5'}`}
                      >
                        <SidebarRatioIcon ratio={r} className={imageRatio === r ? "w-4 h-4 text-white" : "w-4 h-4 text-[#a0a0a0]"} />
                        <span className="text-[11px] font-normal text-white">{r}</span>
                      </button>
                    ))}
                  </div>

                  {/* Scale / Batches */}
                  <div className="flex bg-[#1e1f21]/50 backdrop-blur-md rounded-[14px] p-1 w-full">
                    {['1x', 'x2', 'x3', 'x4'].map((b) => (
                      <button
                        key={b}
                        type="button"
                        onClick={() => setImageBatch(b)}
                        className={`flex-1 py-2 rounded-[10px] text-[12px] font-normal transition-colors cursor-pointer outline-none ${imageBatch === b ? 'bg-[#4a4a4a] text-white' : 'text-[#a0a0a0] hover:text-white hover:bg-white/5'}`}
                      >
                        {b}
                      </button>
                    ))}
                  </div>

                  {/* Image Model Dropdown */}
                  <div className="relative w-full">
                    <button 
                      type="button"
                      onClick={() => {
                        setIsImgDropdownOpen(!isImgDropdownOpen);
                        setIsVidDropdownOpen(false);
                      }}
                      className="w-full flex items-center justify-between bg-[#1e1f21]/50 backdrop-blur-md hover:bg-[#202020]/50 transition-colors rounded-[14px] px-3 py-3 text-white text-[13px] font-normal cursor-pointer outline-none"
                    >
                      <span className="flex items-center gap-2">
                        {imageModel === 'gemini-3-pro-image-preview' ? 'Nano Banana Pro' :
                         imageModel === 'gemini-3.1-flash-lite-image' ? 'Nano Banana Lite' :
                         imageModel === 'grok-imagine' ? 'Grok Imagine' : 'Nano Banana 2'}
                      </span>
                      <ChevronDown size={16} className={`text-[#a0a0a0] transition-transform duration-200 ${isImgDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {isImgDropdownOpen && (
                      <div className="absolute top-[calc(100%+6px)] left-0 right-0 bg-[#141517]/90 backdrop-blur-xl border border-white/5 rounded-[14px] p-1 flex flex-col shadow-2xl z-50">
                        {[
                          { id: 'gemini-3-pro-image-preview', name: 'Nano Banana Pro' },
                          { id: 'gemini-3.1-flash-image-preview', name: 'Nano Banana 2' },
                          { id: 'gemini-3.1-flash-lite-image', name: 'Nano Banana Lite' },
                          { id: 'grok-imagine', name: 'Grok Imagine' }
                        ].map((modelOpt) => (
                          <button 
                            key={modelOpt.id}
                            type="button"
                            onClick={() => {
                              setImageModel(modelOpt.id as any);
                              setIsImgDropdownOpen(false);
                            }}
                            className={`w-full text-left px-3 py-2 rounded-[10px] text-[12px] font-normal transition-colors cursor-pointer ${imageModel === modelOpt.id ? 'bg-[#4a4a4a] text-white' : 'text-[#a0a0a0] hover:text-white hover:bg-white/5'}`}
                          >
                            {modelOpt.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                </div>
              </div>

              {/* Section 3: Video generation default */}
              <div className="space-y-2">
                <h3 className="text-[#8c8c8c] text-[12px] font-semibold uppercase tracking-wider" style={{ fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}>Video generation default</h3>
                <div className="space-y-2">
                  
                  {/* Ratios */}
                  <div className="flex bg-[#1e1f21]/50 backdrop-blur-md rounded-[14px] p-1 justify-between w-full">
                    {['9:16', '16:9'].map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setVideoRatio(r)}
                        className={`flex-1 flex flex-col items-center justify-center gap-1 py-2 rounded-[10px] transition-colors cursor-pointer outline-none ${videoRatio === r ? 'bg-[#4a4a4a]' : 'hover:bg-white/5'}`}
                      >
                        <SidebarRatioIcon ratio={r} className={videoRatio === r ? "w-3.5 h-3.5 text-white" : "w-3.5 h-3.5 text-[#a0a0a0]"} />
                        <span className={`text-[11px] font-normal ${videoRatio === r ? 'text-white' : 'text-[#a0a0a0]'}`}>{r}</span>
                      </button>
                    ))}
                  </div>

                  {/* Scale / Batches */}
                  <div className="flex bg-[#1e1f21]/50 backdrop-blur-md rounded-[14px] p-1 w-full">
                    {['1x', 'x2', 'x3', 'x4'].map((b) => (
                      <button
                        key={b}
                        type="button"
                        onClick={() => setVideoBatch(b)}
                        className={`flex-1 py-2 rounded-[10px] text-[12px] font-normal transition-colors cursor-pointer outline-none ${videoBatch === b ? 'bg-[#4a4a4a] text-white' : 'text-[#a0a0a0] hover:text-white hover:bg-white/5'}`}
                      >
                        {b}
                      </button>
                    ))}
                  </div>

                  {/* Video Model Dropdown */}
                  <div className="relative w-full">
                    <button 
                      type="button"
                      onClick={() => {
                        setIsVidDropdownOpen(!isVidDropdownOpen);
                        setIsImgDropdownOpen(false);
                      }}
                      className="w-full flex items-center justify-between bg-[#1e1f21]/50 backdrop-blur-md hover:bg-[#202020]/50 transition-colors rounded-[14px] px-3 py-3 text-white text-[13px] font-normal cursor-pointer outline-none"
                    >
                      <span className="flex items-center gap-2">
                        {videoModel === 'veo-3.1-fast' ? 'Veo 3.1 Fast' :
                         videoModel === 'veo-3.1' ? 'Veo 3.1' :
                         videoModel === 'veo-3.1-lite' ? 'Veo 3.1 Lite' : 'Omni Flash'}
                      </span>
                      <ChevronDown size={16} className={`text-[#a0a0a0] transition-transform duration-200 ${isVidDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {isVidDropdownOpen && (
                      <div className="absolute top-[calc(100%+6px)] left-0 right-0 bg-[#141517]/90 backdrop-blur-xl border border-white/5 rounded-[14px] p-1 flex flex-col shadow-2xl z-50">
                        {[
                          { id: 'veo-3.1-fast', name: 'Veo 3.1 Fast' },
                          { id: 'veo-3.1', name: 'Veo 3.1' },
                          { id: 'veo-3.1-lite', name: 'Veo 3.1 Lite' },
                          { id: 'omni-flash', name: 'Omni Flash' }
                        ].map((modelOpt) => (
                          <button 
                            key={modelOpt.id}
                            type="button"
                            onClick={() => {
                              setVideoModel(modelOpt.id as any);
                              setIsVidDropdownOpen(false);
                            }}
                            className={`w-full text-left px-3 py-2 rounded-[10px] text-[12px] font-normal transition-colors cursor-pointer ${videoModel === modelOpt.id ? 'bg-[#4a4a4a] text-white' : 'text-[#a0a0a0] hover:text-white hover:bg-white/5'}`}
                          >
                            {modelOpt.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                </div>
              </div>

          </div>

          {/* Settings Footer (Fixed at the bottom) */}
          <div className="px-2 pb-2 pt-1 shrink-0 bg-[#171719]">
            <button 
              onClick={() => {
                setSidebarView('main');
                setIsImgDropdownOpen(false);
                setIsVidDropdownOpen(false);
              }}
              className="w-full bg-white hover:bg-zinc-200 text-black py-2 rounded-xl font-semibold text-[13px] transition-colors cursor-pointer text-center outline-none"
            >
              Save
            </button>
          </div>
          </div>

          {/* Instructions Panel */}
          <div 
            className="absolute inset-0 h-full flex flex-col"
            style={{
              display: lastSubView === 'instructions' ? 'flex' : 'none',
              pointerEvents: lastSubView === 'instructions' ? 'auto' : 'none'
            }}
          >
          {/* Instructions Top Bar */}
          <div className="flex items-center justify-between pl-4 pr-4 pt-[18px] pb-[14px] relative z-10 border-none shrink-0">
            <div className="flex items-center gap-3">
              <button 
                onClick={() => {
                  setSidebarView('main');
                }}
                className="text-[#a0a0a0] hover:text-white transition-colors outline-none cursor-pointer p-1 rounded-full hover:bg-white/5"
              >
                <ArrowLeft size={18} strokeWidth={2} />
              </button>
              <span className="text-white font-medium text-[15px] tracking-wide" style={{ fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}>Agent Instructions</span>
            </div>
            <button 
              onClick={() => {
                onClose();
                setSidebarView('main');
              }}
              className="text-[#a0a0a0] hover:text-white transition-colors outline-none cursor-pointer p-1 rounded-full hover:bg-white/5"
            >
              <X size={18} strokeWidth={2} />
            </button>
          </div>

          {/* Instructions Content */}
          <div className="flex-1 overflow-y-auto no-scrollbar px-4 pt-3 pb-4 space-y-4 min-h-0 select-none">
            {instructions.length > 0 && (
              <div className="space-y-3">
                {instructions.map((inst) => (
                  <InstructionCard
                    key={inst.id}
                    inst={inst}
                    toggleActive={() => toggleInstructionActive(inst.id)}
                    updateTitle={(title) => updateInstructionTitle(inst.id, title)}
                    updateContent={(content) => updateInstructionContent(inst.id, content)}
                    setEditingTitle={(isEditing) => setEditingTitle(inst.id, isEditing)}
                    deleteSelf={() => deleteInstruction(inst.id)}
                    toggleReference={(ref) => {
                      if (onPlusClick) {
                        onPlusClick(ref, 'instruction-reference', inst.id);
                      }
                    }}
                    clearReference={() => handleClearReference(inst.id)}
                  />
                ))}
              </div>
            )}

            {/* Add Instruction Button */}
            <button
              onClick={addInstruction}
              className="w-full border border-white/10 hover:border-white/20 hover:bg-white/5 transition-colors py-3.5 rounded-xl text-white font-semibold text-[13px] flex items-center justify-center gap-2 cursor-pointer outline-none mt-2"
            >
              <Plus size={16} strokeWidth={2.5} />
              <span>Add Instruction</span>
            </button>
          </div>

          {/* Instructions Footer (Fixed at the bottom) */}
          <div className="px-2 pb-2 pt-1 shrink-0 bg-[#171719]">
            <button 
              onClick={() => {
                setSidebarView('main');
              }}
              className="w-full bg-white hover:bg-zinc-200 text-black py-2 rounded-xl font-semibold text-[13px] transition-colors cursor-pointer text-center outline-none"
            >
              Done
            </button>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
};
