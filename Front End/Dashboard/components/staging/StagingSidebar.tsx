
import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ChevronDown, 
  Clock, 
  PanelLeftClose, 
  Lightbulb, 
  FileCode2, 
  Plus, 
  MessageSquare, 
  MoreHorizontal,
  ThumbsUp,
  ThumbsDown,
  Copy,
  AudioLines,
  ArrowUp,
  ArrowLeft,
  Sparkles,
  Check,
  Wrench,
  Palette,
  Beaker,
  Image as ImageIcon,
  FlaskConical,
  X,
  Globe,
  FileCode,
  Terminal,
  Loader2,
  Square,
  Play
} from 'lucide-react';
import { useStore } from '@nanostores/react';
import { TextShimmer } from '../ui/text-shimmer';
import logoG from '../../src/assets/logog.png';
import { ALL_TOOLS } from './StagingTopBar';
import '../SettingsModal.css';
import { useUserData } from '../../hooks/useUserData';
import { streamChat, ChatMessage as AiChatMessage, prewarmClient } from '../../lib/ai';
import { runComputerUseTest, type TestUpdate } from '../../lib/computer-use';
import { sandpackStore } from '../../lib/sandpack/sandpack-store';
import { workbenchStore, parseAIResponse, parseResponseForDisplay, type ChatSegment } from '../../lib/sandpack';
import { BOLT_SYSTEM_PROMPT } from '../../lib/sandpack/system-prompt';
import { testStore } from '../../lib/test-store';
import { TestingIndicator, TestResultIndicator } from './TestingIndicator';

const GeminiLogo = ({ size = 16, className = "" }: { size?: number, className?: string }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 512 512" 
    fill="currentColor" 
    className={className}
  >
    <path d="M256 0C256 0 292 200 512 256C292 312 256 512 256 512C256 512 220 312 0 256C220 200 256 0 256 0Z" />
  </svg>
);

const AnnotateIcon = ({ size = 16, className = "" }: { size?: number, className?: string }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2.2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <path d="M4 12c0-4 4-7 8-7s8 3 8 7-4 7-8 7-8-3-8-7Z" className="opacity-40" strokeWidth="1.5" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

// Collapsible File Indicator Component
const CollapsibleFileIndicator: React.FC<{ 
  files: any[], 
  lastFileName: string, 
  isGenerating?: boolean, 
  isStreaming?: boolean,
  isExpanded?: boolean,
  setIsExpanded?: (expanded: boolean) => void 
}> = ({ files, lastFileName, isGenerating = false, isStreaming = false, isExpanded: externalExpanded, setIsExpanded: externalSetExpanded }) => {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const [displayedFileName, setDisplayedFileName] = useState(lastFileName);
  const [isTransitioning, setIsTransitioning] = useState(false);
  
  // Use external state if provided, otherwise use internal
  const isExpanded = externalExpanded !== undefined ? externalExpanded : internalExpanded;
  const setIsExpanded = externalSetExpanded || setInternalExpanded;
  
  // Only animate file name changes during streaming
  useEffect(() => {
    if (lastFileName !== displayedFileName) {
      if (isStreaming) {
        // Start fade out
        setIsTransitioning(true);
        // After fade out, update displayed name and fade in
        const timer = setTimeout(() => {
          setDisplayedFileName(lastFileName);
          setIsTransitioning(false);
        }, 150); // Half of the transition duration
        return () => clearTimeout(timer);
      } else {
        // Not streaming, just update immediately
        setDisplayedFileName(lastFileName);
      }
    }
  }, [lastFileName, displayedFileName, isStreaming]);
  
  // Determine the status text for the current (top) file
  const statusText = isGenerating ? 'Editing' : 'Edited';
  
  // Animation class - only during streaming
  const animClass = isStreaming ? ' animate-textFadeIn' : '';
  
  // Shimmer only when actively streaming AND generating (prevents glow in saved messages)
  const shouldShimmer = isStreaming && isGenerating;
  
  // Render the status text with or without shimmer animation
  const renderStatusText = () => {
    const shimmerClass = shouldShimmer ? "animate-shimmer bg-clip-text text-transparent bg-[length:200%_100%]" : "";
    const shimmerStyle = shouldShimmer ? { backgroundImage: 'linear-gradient(90deg, #81888f 0%, #ffffff 50%, #81888f 100%)', animationDuration: '1.5s' } : {};
    
    return (
      <span className="text-[15.15px] inline-flex items-center gap-1">
        <span className={shimmerClass} style={shimmerStyle}>
          {statusText}
        </span>
        <span className="relative inline-block">
          {/* Background box - always visible */}
          <span 
            className="font-mono bg-white/5 px-1.5 py-0.5 rounded inline-block transition-opacity duration-300 ease-out"
            style={{ opacity: isTransitioning ? 0 : 1 }}
          >
            {/* Text with optional shimmer */}
            <span 
              className={shouldShimmer ? shimmerClass : ""}
              style={shouldShimmer ? shimmerStyle : { color: '#81888f' }}
            >
              {displayedFileName}
            </span>
          </span>
        </span>
      </span>
    );
  };
  
  if (files.length === 1) {
    // Single file - just show it directly
    return (
      <div className={`flex items-center gap-2.5${animClass}`} style={{ color: '#81888f' }}>
        <FileCode2 size={18} />
        {renderStatusText()}
      </div>
    );
  }
  
  return (
    <div className={`space-y-0${animClass}`}>
      {/* Header row with chevron pushed to far right */}
      <div className="flex items-center justify-between" style={{ color: '#81888f' }}>
        <div className="flex items-center gap-2.5">
          <FileCode2 size={18} />
          {renderStatusText()}
        </div>
        <button 
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-1.5 hover:bg-white/10 rounded transition-colors"
        >
          <ChevronDown 
            size={16} 
            className={`transition-transform duration-300 ease-out ${isExpanded ? 'rotate-180' : ''}`} 
          />
        </button>
      </div>
      
      {/* Expanded files list with smooth animation */}
      <div 
        className={`overflow-hidden transition-all duration-300 ease-out ${
          isExpanded ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="pt-4 space-y-4">
          {files.slice(0, -1).map((file, i) => {
            const fileName = file.filePath?.split('/').pop() || file.content;
            return (
              <div 
                key={i} 
                className="flex items-center gap-2.5 transition-all duration-200"
                style={{ 
                  color: '#81888f',
                  opacity: isExpanded ? 1 : 0,
                  transform: isExpanded ? 'translateY(0)' : 'translateY(-8px)',
                  transitionDelay: `${i * 30}ms`
                }}
              >
                <FileCode2 size={18} />
                <span className="text-[15.15px]">Edited <span className="font-mono bg-white/5 px-1.5 py-0.5 rounded" style={{ color: '#81888f' }}>{fileName}</span></span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// Helper to strip code blocks and bolt artifact tags for clean text copying
const stripCodeAndIndicators = (content: string): string => {
  let text = content;
  // Remove boltArtifact and boltAction tags and their contents
  text = text.replace(/<boltArtifact[^>]*>[\s\S]*?<\/boltArtifact>/gi, '');
  text = text.replace(/<boltAction[^>]*>[\s\S]*?<\/boltAction>/gi, '');
  // Remove markdown code blocks
  text = text.replace(/```[\s\S]*?```/g, '');
  // Remove inline code
  text = text.replace(/`[^`]+`/g, '');
  // Clean up extra whitespace
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text;
};


interface SidebarProps {
  width: number;
  isCollapsed: boolean;
  onToggle: () => void;
  prompt?: string;
  activeTab: string;
  onTabChange: (id: string) => void;
  isChatMode?: boolean;
  modelConfig: any;
  setModelConfig: React.Dispatch<React.SetStateAction<any>>;
  selectedModelId: string;
  setSelectedModelId: (id: string) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ width, isCollapsed, onToggle, prompt, activeTab, onTabChange, isChatMode, modelConfig, setModelConfig, selectedModelId, setSelectedModelId }) => {
  const navigate = useNavigate();
  console.log('🔵🔵🔵 [Sidebar] COMPONENT RENDERING 🔵🔵🔵');
  const isCompact = width < 405;
  const [promptValue, setPromptValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const tabsScrollRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const streamingContentRef = useRef<HTMLDivElement>(null);
  const [dynamicBottomPadding, setDynamicBottomPadding] = useState<number | null>(null);
  const [canScrollDuringGeneration, setCanScrollDuringGeneration] = useState(false);
  const [showLeftGradient, setShowLeftGradient] = useState(false);
  const [messageReactions, setMessageReactions] = useState<{ [key: string]: 'like' | 'dislike' | null }>({});
  const [fileListExpanded, setFileListExpanded] = useState(false); // Lifted state for file list expansion
  
  // Test mode state
  const isTestMode = useStore(testStore.isTestMode);
  const testStatus = useStore(testStore.status);
  
  // Debug: Log test mode changes
  useEffect(() => {
    console.log('[Sidebar] isTestMode changed to:', isTestMode);
  }, [isTestMode]);
  
  // Attachments State
  interface Attachment {
    id: string;
    type: 'image' | 'file';
    url?: string;
    name: string;
    extension?: string;
  }
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newAttachments: Attachment[] = Array.from(e.target.files).map(file => {
        const isImage = file.type.startsWith('image/');
        return {
          id: Math.random().toString(36).substring(7),
          type: isImage ? 'image' : 'file',
          url: isImage ? URL.createObjectURL(file) : undefined,
          name: file.name,
          extension: file.name.split('.').pop() || 'FILE'
        };
      });
      setAttachments(prev => [...prev, ...newAttachments]);
      // Reset input
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeAttachment = (id: string) => {
    // Mark as removing first (triggers fade-out animation)
    setRemovingIds(prev => new Set(prev).add(id));
    
    // Remove from DOM after animation completes
    setTimeout(() => {
      setAttachments(prev => prev.filter(att => att.id !== id));
      setRemovingIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(id);
        return newSet;
      });
    }, 200); // Match animation duration
  };

  // Check if any attachments are visible (not all being removed)
  const hasVisibleAttachments = attachments.length > 0 && !attachments.every(att => removingIds.has(att.id));
  const [showRightGradient, setShowRightGradient] = useState(true);

  // Chat/Messaging State
  interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    thinkingTime?: number;
    isGenerating?: boolean;
    isThinking?: boolean;
    timestamp: number;
  }
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentStreamingResponse, setCurrentStreamingResponse] = useState('');
  const [currentThinkingTime, setCurrentThinkingTime] = useState(0);
  const thinkingTimeRef = useRef(0); // Ref to capture accurate final thinking time
  const [isCurrentlyGenerating, setIsCurrentlyGenerating] = useState(false);
  const [isCurrentlyThinking, setIsCurrentlyThinking] = useState(false);
  const { apiKeys, loading: userDataLoading } = useUserData();
  const thinkingTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Pre-warm SDK clients as soon as API keys are available
  useEffect(() => {
    if (apiKeys.gemini?.[0]) prewarmClient('gemini', apiKeys.gemini[0]);
    if (apiKeys.openai?.[0]) prewarmClient('openai', apiKeys.openai[0]);
    if (apiKeys.anthropic?.[0]) prewarmClient('anthropic', apiKeys.anthropic[0]);
  }, [apiKeys]);

  // Helper to process bold text
  // Process inline formatting: bold (**text**) and inline code (`code`)
  const processInlineFormatting = (text: string): React.ReactNode[] => {
    // 1. Extract code blocks and replace with unique placeholders
    const codeBlocks: string[] = [];
    const placeholderPrefix = '___CODE_BLOCK_';
    const placeholderSuffix = '___';
    
    const textWithPlaceholders = text.replace(/(`[^`]+`)/g, (match) => {
      const index = codeBlocks.length;
      codeBlocks.push(match);
      return `${placeholderPrefix}${index}${placeholderSuffix}`;
    });

    // 2. Split by bold markers
    const parts = textWithPlaceholders.split(/(\*\*.*?\*\*)/g);

    // 3. Render parts and restore code blocks
    return parts.map((part, partIdx) => {
      const restoreCode = (content: string) => {
        // Split by placeholders to find where code codes go
        const subParts = content.split(new RegExp(`(${placeholderPrefix}\\d+${placeholderSuffix})`, 'g'));
        
        return subParts.map((subPart, subIdx) => {
          if (subPart.startsWith(placeholderPrefix) && subPart.endsWith(placeholderSuffix)) {
            const indexStr = subPart.substring(placeholderPrefix.length, subPart.length - placeholderSuffix.length);
            const index = parseInt(indexStr, 10);
            if (!isNaN(index) && codeBlocks[index]) {
              // Render the code block
              return (
                <code key={`code-${partIdx}-${subIdx}`} className="font-mono bg-white/10 px-1.5 py-0.5 rounded text-[13px] text-gray-200">
                  {codeBlocks[index].slice(1, -1)}
                </code>
              );
            }
          }
          // Return plain text
          return subPart;
        });
      };

      // Check if this part is a bold block
      if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
        return (
          <strong key={`bold-${partIdx}`} className="text-white font-semibold">
            {restoreCode(part.slice(2, -2))}
          </strong>
        );
      }
      
      // Normal text
      return <React.Fragment key={`text-${partIdx}`}>{restoreCode(part)}</React.Fragment>;
    });
  };

  // Keep processBold as alias for backward compatibility
  const processBold = processInlineFormatting;

  // Helper to render plain text with formatting
  // isStreaming: when true, applies fade animation; when false, no animation (prevents flash)
  const renderTextContent = (text: string, isStreaming: boolean = false) => {
    if (!text) return null;
    
    const animClass = isStreaming ? ' animate-textFadeIn' : '';
    
    const lines = text.split('\n');
    return (
      <>
        {lines.map((line, idx) => {
          const trimmedLine = line.trim();
          if (!trimmedLine) return null;

          // Handle Headers
          if (trimmedLine.startsWith('#')) {
            const headerMatch = trimmedLine.match(/^(#{1,6})\s+(.*)$/);
            if (headerMatch) {
              const level = headerMatch[1].length;
              const headerText = headerMatch[2];
              
              const baseHeaderClasses = {
                1: "text-[22px] font-bold text-white mt-6 mb-2",
                2: "text-[19px] font-bold text-white mt-5 mb-1",
                3: "text-[17px] font-bold text-white mt-4 mb-1",
                4: "text-[15px] font-bold text-white mt-3",
                5: "text-[15px] font-bold text-white mt-3",
                6: "text-[15px] font-bold text-white mt-3",
              }[level as 1|2|3|4|5|6];

              return (
                <div key={idx} className={baseHeaderClasses + animClass}>
                  {processBold(headerText)}
                </div>
              );
            }
          }

          // Handle Bullet Points
          if (trimmedLine.startsWith('*') || trimmedLine.startsWith('-')) {
            const bulletContent = trimmedLine.replace(/^[\*\-]\s*/, '');
            return (
              <div key={idx} className={`flex gap-3 pl-4 items-start${animClass}`}>
                <div className="w-1.5 h-1.5 rounded-full bg-zinc-600 mt-[9px] shrink-0" />
                <div className="text-gray-400 text-[15px] leading-relaxed">
                  {processBold(bulletContent)}
                </div>
              </div>
            );
          }

          // Normal Paragraph
          return (
            <p key={idx} className={`text-gray-300 text-[15px] leading-[1.65]${animClass}`}>
              {processBold(line)}
            </p>
          );
        })}
      </>
    );
  };

  // Helper to render conversational AI content with file indicators
  // isStreaming: when true, applies fade animation to text
  const renderFormattedContent = (content: string, isStreaming: boolean = false) => {
    if (!content) return null;
    
    try {
      // Parse response into segments (text + file indicators)
      const segments = parseResponseForDisplay(content);
      console.log('[Render] Segments parsed:', segments.length, 'segments, types:', segments.map(s => s.type).join(', '));
      
      // If no segments found (plain text response), render normally
      if (!segments || segments.length === 0) {
        console.log('[Render] No segments, rendering as plain text');
        return <div className="space-y-4">{renderTextContent(content, isStreaming)}</div>;
      }
      
    // Group consecutive file indicators together
    const groupedSegments: (ChatSegment | { type: 'file-group', files: ChatSegment[] })[] = [];
    let currentFileGroup: ChatSegment[] = [];
    
    segments.forEach((seg, i) => {
      if (seg.type === 'file-indicator') {
        currentFileGroup.push(seg);
      } else {
        if (currentFileGroup.length > 0) {
          groupedSegments.push({ type: 'file-group', files: [...currentFileGroup] });
          currentFileGroup = [];
        }
        groupedSegments.push(seg);
      }
    });
    // Handle remaining file group
    if (currentFileGroup.length > 0) {
      groupedSegments.push({ type: 'file-group', files: currentFileGroup });
    }
    
    return (
      <div className="space-y-4">
        {groupedSegments.map((segment, idx) => {
          if (segment.type === 'text') {
            return (
              <div key={idx} className="space-y-2">
                {renderTextContent(segment.content, isStreaming)}
              </div>
            );
          }
          
          if (segment.type === 'file-group') {
            const files = segment.files;
            const lastFile = files[files.length - 1];
            const lastFileName = lastFile.filePath?.split('/').pop() || lastFile.content;
            
            // Only show as "Editing" (with shimmer) if this is the last segment and still generating
            const isLastSegment = idx === groupedSegments.length - 1;
            const isActivelyEditing = isCurrentlyGenerating && isLastSegment;
            
            // Collapsible file indicator component - uses internal state for independent expand/collapse
            return (
              <CollapsibleFileIndicator 
                key={idx} 
                files={files} 
                lastFileName={lastFileName} 
                isGenerating={isActivelyEditing} 
                isStreaming={isStreaming}
              />
            );
          }
          
          if (segment.type === 'shell-indicator') {
            // Only show "Running" if this is the last segment and still generating
            const isLastSegment = idx === groupedSegments.length - 1;
            const isRunning = isCurrentlyGenerating && isLastSegment;
            const shimmerClass = isRunning ? "animate-shimmer bg-clip-text text-transparent bg-[length:200%_100%]" : "";
            const shimmerStyle = isRunning ? { backgroundImage: 'linear-gradient(90deg, #81888f 0%, #ffffff 50%, #81888f 100%)', animationDuration: '1.5s' } : { color: '#81888f' };
            const animClass = isStreaming ? ' animate-textFadeIn' : '';
            return (
              <div key={idx} className={`flex items-center gap-2.5${animClass}`} style={{ color: '#81888f' }}>
                <Terminal size={18} />
                <span className={`text-[15.15px] ${shimmerClass}`} style={shimmerStyle}>
                  {isRunning ? 'Running' : 'Ran'}{' '}
                  <span className="font-mono bg-white/5 px-1.5 py-0.5 rounded">npm install</span>
                </span>
              </div>
            );
          }
          
          if (segment.type === 'start-indicator') {
            // Only show "Starting" if this is the last segment and still generating
            const isLastSegment = idx === groupedSegments.length - 1;
            const isStarting = isCurrentlyGenerating && isLastSegment;
            const shimmerClass = isStarting ? "animate-shimmer bg-clip-text text-transparent bg-[length:200%_100%]" : "";
            const shimmerStyle = isStarting ? { backgroundImage: 'linear-gradient(90deg, #81888f 0%, #ffffff 50%, #81888f 100%)', animationDuration: '1.5s' } : { color: '#81888f' };
            const animClass = isStreaming ? ' animate-textFadeIn' : '';
            return (
              <div key={idx} className={`flex items-center gap-2.5${animClass}`} style={{ color: '#81888f' }}>
                <Terminal size={18} />
                <span className={`text-[15.15px] ${shimmerClass}`} style={shimmerStyle}>
                  {isStarting ? 'Starting' : 'Started'}{' '}
                  <span className="font-mono bg-white/5 px-1.5 py-0.5 rounded">npm run dev</span>
                </span>
              </div>
            );
          }
          
          return null;
        })}
      </div>
    );
    } catch (error) {
      console.error('[Sidebar] Error parsing AI response for display:', error);
      // Fallback: just render as plain text without parsing
      return <div className="space-y-4">{renderTextContent(content)}</div>;
    }
  };

  // Handle Initial Prompt Display & UI Status
  const initialPromptDisplayed = useRef(false);
  useEffect(() => {
    if (prompt && !initialPromptDisplayed.current && isChatMode) {
      initialPromptDisplayed.current = true;
      
      // Show user message immediately
      const userMessage: ChatMessage = {
        id: 'initial-prompt',
        role: 'user',
        content: prompt,
        timestamp: Date.now()
      };
      setMessages([userMessage]);

      // Set generating/thinking status immediately
      setIsCurrentlyGenerating(true);
      setIsCurrentlyThinking(true);
      setCurrentThinkingTime(0);
      thinkingTimeRef.current = 0;

      // Start timer immediately
      if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
      thinkingTimerRef.current = setInterval(() => {
        thinkingTimeRef.current += 1;
        setCurrentThinkingTime(thinkingTimeRef.current);
      }, 1000);
    }
  }, [prompt, isChatMode]);

  // Handle Initial AI Generation - Fire immediately since keys are loaded synchronously
  const initialAiTriggered = useRef(false);
  useEffect(() => {
    if (prompt && !initialAiTriggered.current && isChatMode && messages.length > 0) {
      initialAiTriggered.current = true;
      startAiGeneration(prompt, [], true); // true = UI already started
    }
  }, [prompt, isChatMode, messages]);

  const handleSendMessage = async (text: string) => {
    if (!text.trim()) return;

    const userMessage: ChatMessage = {
      id: Math.random().toString(36).substring(7),
      role: 'user',
      content: text,
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMessage]);
    setPromptValue('');
    
    // Route based on activeTab (use prop directly for reliability)
    // activeTab === 'test' means test mode is active
    if (activeTab === 'test') {
      // In test mode, run the test
      await startTestGeneration(text);
    } else {
      // Normal code generation - Trigger generation with history
      const history: AiChatMessage[] = messages.map(m => ({
          role: m.role,
          content: m.content
      }));
      
      await startAiGeneration(text, history, false);
    }
  };

  const startAiGeneration = async (text: string, history: AiChatMessage[], uiAlreadyStarted: boolean) => {
    if (!uiAlreadyStarted) {
      setIsCurrentlyGenerating(true);
      setIsCurrentlyThinking(true);
      setCurrentThinkingTime(0);
      thinkingTimeRef.current = 0;
      setCurrentStreamingResponse('');

      if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
      thinkingTimerRef.current = setInterval(() => {
        thinkingTimeRef.current += 1;
        setCurrentThinkingTime(thinkingTimeRef.current);
      }, 1000);
    }

    try {
      // Find selected provider and model
      let provider: 'gemini' | 'openai' | 'anthropic' = 'gemini';
      let modelId = '';

      const allSavedModels = [
        ...(modelConfig.gemini?.savedModels || []).map((m: any) => ({ ...m, provider: 'gemini' })),
        ...(modelConfig.openai?.savedModels || []).map((m: any) => ({ ...m, provider: 'openai' })),
        ...(modelConfig.anthropic?.savedModels || []).map((m: any) => ({ ...m, provider: 'anthropic' }))
      ];

      const selected = allSavedModels.find(m => m.id === selectedModelId);
      if (selected) {
        provider = selected.provider as 'gemini' | 'openai' | 'anthropic';
        modelId = selected.modelId;
      } else {
        // Fallback to default
        provider = 'gemini';
        modelId = (modelConfig.gemini?.model) || 'gemini-3-pro-preview';
      }

      console.log(`Starting AI generation with ${provider} (${modelId})`);

      const apiKey = apiKeys[provider]?.[0];
      if (!apiKey) {
        console.error(`Missing API key for provider ${provider}. Available keys:`, apiKeys);
        throw new Error(`API Key for ${provider} is missing. Please add it in settings.`);
      }

      // Add system prompt for Ship mode to get boltArtifact format
      const systemMessage: AiChatMessage = {
        role: 'user',
        content: `<system>${BOLT_SYSTEM_PROMPT}</system>\n\nRemember: Always respond with <boltArtifact> tags containing <boltAction> tags for files and commands.`
      };
      const fullHistory = [systemMessage, ...history, { role: 'user' as const, content: text }];

      let responseText = '';
      
      // Create streaming parser for realtime file creation
      const messageParser = workbenchStore.createMessageParser();
      workbenchStore.isGenerating.set(true);
      
      await streamChat(
        fullHistory,
        { provider, model: modelId, apiKey, thinkingLevel: selected?.thinkingLevel || 0 },
        (token) => {
          if (isCurrentlyThinking) {
            setIsCurrentlyThinking(false);
            if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
          }
          responseText += token;
          setCurrentStreamingResponse(responseText);
          
          // Parse streaming content - this triggers file creation in realtime
          messageParser.parse(token);
        },
        () => {
          // onStart logic handled above
        }
      );

      const assistantMessage: ChatMessage = {
        id: Math.random().toString(36).substring(7),
        role: 'assistant',
        content: responseText,
        thinkingTime: thinkingTimeRef.current, // Use ref for accurate value
        timestamp: Date.now()
      };

      setMessages(prev => [...prev, assistantMessage]);
      setCurrentStreamingResponse('');
      setCurrentThinkingTime(0);
      setIsCurrentlyGenerating(false);
      setIsCurrentlyThinking(false);

      // Process AI response with bolt.diy workbench
      workbenchStore.isGenerating.set(true);
      try {
        await workbenchStore.processAIResponse(responseText);
        console.log('[Sidebar] Processed AI response with workbenchStore');
      } catch (err) {
        console.error('[Sidebar] Error processing response:', err);
      }
      
      // Flush any pending file edits (for batched edits during subsequent generations)
      await workbenchStore.flushPendingEdits();
      
      workbenchStore.isGenerating.set(false);

    } catch (error: any) {
      console.error('Chat error:', error);
      const errorMessage: ChatMessage = {
        id: Math.random().toString(36).substring(7),
        role: 'assistant',
        content: `Error: ${error.message || 'Failed to get response.'}`,
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, errorMessage]);
      setIsCurrentlyGenerating(false);
      setIsCurrentlyThinking(false);
      if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
    }
  };

  // === TEST MODE FUNCTIONS ===
  const startTestGeneration = async (testPrompt: string) => {
    // Get iframe from testStore
    const iframe = testStore.getIframeRef();
    if (!iframe) {
      // Add error message - no preview available
      const errorMessage: ChatMessage = {
        id: Math.random().toString(36).substring(7),
        role: 'assistant',
        content: '⚠️ Cannot run test: Preview not available. Please generate some code first, then try testing again.',
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, errorMessage]);
      return;
    }

    // Create the assistant message immediately with a unique ID
    const messageId = Math.random().toString(36).substring(7);
    const initialMessage: ChatMessage = {
      id: messageId,
      role: 'assistant',
      content: '🧪 Starting Computer Use test agent...',
      timestamp: Date.now()
    };
    setMessages(prev => [...prev, initialMessage]);

    // Start test state
    testStore.startTest();
    setIsCurrentlyGenerating(true);
    setIsCurrentlyThinking(true);
    setCurrentThinkingTime(0);
    thinkingTimeRef.current = 0;
    setCurrentStreamingResponse('');

    if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
    thinkingTimerRef.current = setInterval(() => {
      thinkingTimeRef.current += 0.1;
      setCurrentThinkingTime(thinkingTimeRef.current);
    }, 100);

    try {
      // Get API key from useUserData
      if (!apiKeys?.gemini?.[0]) {
        throw new Error('Gemini API Key missing. Please add it in Settings -> Models & API.');
      }
      const apiKey = apiKeys.gemini[0];

      // Update status to testing
      testStore.setStatus('testing');
      
      console.log('[Test] Starting Computer Use agent loop...');
      
      // Track current message content
      let currentContent = '';
      const actionsLog: string[] = [];
      
      // Run the Computer Use agent loop
      const result = await runComputerUseTest(
        apiKey,
        testPrompt,
        iframe,
        (update: TestUpdate) => {
          console.log('[Test] Update:', update.type, update.message);
          
          // Stop thinking animation on first real update
          if (update.type !== 'thinking' && thinkingTimerRef.current) {
            clearInterval(thinkingTimerRef.current);
            setIsCurrentlyThinking(false);
          }
          
          // Build up the message content based on update type
          switch (update.type) {
            case 'thinking':
              currentContent = `🧠 ${update.message}`;
              break;
            case 'screenshot':
              testStore.setStatus('capturing');
              currentContent = `📸 ${update.message}`;
              break;
            case 'action':
              testStore.setStatus('executing-action');
              testStore.setCurrentAction(update.actionName || update.message);
              actionsLog.push(update.actionName || 'action');
              currentContent = `👆 ${update.message}`;
              break;
            case 'text':
              // This is the model's actual response text
              testStore.setStatus('testing');
              currentContent = update.message;
              break;
            case 'complete':
              testStore.setStatus('complete');
              break;
            case 'error':
              currentContent = `❌ Error: ${update.message}`;
              break;
          }
          
          // Update the message in real-time
          setMessages(prev => prev.map(msg => 
            msg.id === messageId 
              ? { ...msg, content: currentContent, thinkingTime: thinkingTimeRef.current }
              : msg
          ));
          setCurrentStreamingResponse(currentContent);
        }
      );

      console.log('[Test] Agent loop complete:', result);

      // Build final message with actions summary
      let finalContent = result.explanation || 'Test completed.';
      
      // Add actions summary if any were performed
      if (result.actionsPerformed.length > 0) {
        finalContent += `\n\n📋 **Actions performed:** ${result.actionsPerformed.join(' → ')}`;
      }
      
      // Add clear result indicator
      if (result.passed) {
        if (!finalContent.includes('✅')) {
          finalContent = `✅ **YES** - ${finalContent}`;
        }
      } else {
        if (!finalContent.includes('❌')) {
          finalContent = `❌ **NO** - ${finalContent}`;
        }
      }

      // Set result in store
      testStore.setResult({
        passed: result.passed,
        summary: result.explanation.substring(0, 200) + '...',
        suggestion: result.passed ? undefined : 'Review the test output for details.',
      });

      // Final message update
      setMessages(prev => prev.map(msg => 
        msg.id === messageId 
          ? { ...msg, content: finalContent, thinkingTime: thinkingTimeRef.current }
          : msg
      ));
      
      setCurrentStreamingResponse('');
      setIsCurrentlyGenerating(false);
      testStore.setStatus('complete');
      testStore.setCurrentAction(null);
      
    } catch (error: any) {
      console.error('[Test] Error:', error);
      
      // Update the message with error state
      setMessages(prev => prev.map(msg => 
        msg.id === messageId 
          ? { ...msg, content: `❌ Test Error: ${error.message || 'Failed to run test.'}` }
          : msg
      ));

      setIsCurrentlyGenerating(false);
      setIsCurrentlyThinking(false);
      if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
      testStore.setStatus('idle');
      testStore.setCurrentAction(null);
    }
  };

  // Modified handleSendMessage to route to test or code based on mode
  const handleSendMessageWithMode = async (text: string) => {
    if (!text.trim()) return;

    const userMessage: ChatMessage = {
      id: Math.random().toString(36).substring(7),
      role: 'user',
      content: text,
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMessage]);
    setPromptValue('');

    if (isTestMode) {
      // In test mode, run the test
      await startTestGeneration(text);
    } else {
      // Normal code generation
      const history: AiChatMessage[] = messages.map(m => ({
        role: m.role,
        content: m.content
      }));
      
      await startAiGeneration(text, history, false);
    }
  };

  useEffect(() => {
    return () => {
      if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
    };
  }, []);

  // Scroll logic
  const lastPromptId = useRef<string | null>(null);
  const isScrollingToTop = useRef(false);

  useEffect(() => {
    if (chatScrollRef.current) {
        const container = chatScrollRef.current;
        const lastMessage = messages[messages.length - 1];

        if (lastMessage && lastMessage.role === 'user' && lastMessage.id !== lastPromptId.current) {
            lastPromptId.current = lastMessage.id;
            isScrollingToTop.current = true;
            
            // CRITICAL: Temporarily force overflow to auto so scroll can work
            container.style.overflow = 'auto';
            
            // Use requestAnimationFrame instead of setTimeout for immediate start
            requestAnimationFrame(() => {
                const msgEl = messageRefs.current[lastMessage.id];
                
                if (msgEl && container) {
                    // Capture initial state for smooth animation
                    const containerRect = container.getBoundingClientRect();
                    const msgRect = msgEl.getBoundingClientRect();
                    const targetVisualOffset = isChatMode ? 76 : 20;
                    const initialOffset = msgRect.top - containerRect.top;
                    const totalScrollNeeded = initialOffset - targetVisualOffset;
                    const startScrollTop = container.scrollTop;
                    const targetScrollTop = startScrollTop + totalScrollNeeded;
                    
                    const startTime = Date.now();
                    const duration = 400;
                    
                    // Ease-out cubic function for smooth deceleration
                    const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
                    
                    const animateScroll = () => {
                        if (!container) return;
                        
                        // Keep overflow auto during scroll
                        container.style.overflow = 'auto';
                        
                        const elapsed = Date.now() - startTime;
                        const progress = Math.min(elapsed / duration, 1);
                        const easedProgress = easeOutCubic(progress);
                        
                        // Smoothly interpolate scroll position
                        container.scrollTop = startScrollTop + (totalScrollNeeded * easedProgress);
                        
                        if (progress < 1) {
                            requestAnimationFrame(animateScroll);
                        } else {
                            // Ensure we land exactly on target
                            container.scrollTop = targetScrollTop;
                            isScrollingToTop.current = false;
                        }
                    };
                    
                    requestAnimationFrame(animateScroll);
                }
            });
        }
    }
  }, [messages, isChatMode]);

  // Tabs scroll check (renamed from scrollContainerRef)
  const handleScroll = () => {
    if (tabsScrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = tabsScrollRef.current;
      setShowLeftGradient(scrollLeft > 5);
      setShowRightGradient(scrollLeft < scrollWidth - clientWidth - 5);
    }
  };

  // Dynamic padding and scroll control during generation
  // - Initially: Large padding (85vh) to guarantee scroll-to-top works (Phase 1)
  // - After scroll (500ms): Switch to smart dynamic padding (Phase 2)
  const scrollLockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialBoostRef = useRef(false);
  
  // Trigger initial boost when generation starts
  useEffect(() => {
    if (isCurrentlyGenerating) {
      initialBoostRef.current = true;
      // Disable boost after scroll animation allows logic to take over
      setTimeout(() => {
        initialBoostRef.current = false;
      }, 550);
    }
  }, [isCurrentlyGenerating]);

  useEffect(() => {
    if (!isCurrentlyGenerating) {
      // Reset when generation ends
      setDynamicBottomPadding(null);
      setCanScrollDuringGeneration(true);
      if (scrollLockTimerRef.current) {
        clearTimeout(scrollLockTimerRef.current);
        scrollLockTimerRef.current = null;
      }
      return;
    }

    const streamingEl = streamingContentRef.current;
    const scrollContainer = chatScrollRef.current;
    if (!scrollContainer) return;

    const targetGap = 210; // Same as pb-[210px] for static content
    const topPadding = isChatMode ? 76 : 20;

    // Always allow scrolling initially
    setCanScrollDuringGeneration(true);
    
    const calculatePaddingAndScroll = () => {
      if (!scrollContainer) return;
      
      // PHASE 1: Initial Boost
      // Force huge padding so scroll-to-top ALWAYS works
      if (initialBoostRef.current || isScrollingToTop.current) {
        setDynamicBottomPadding(window.innerHeight * 0.85); // 85vh equivalent
        return;
      }

      // PHASE 2: Smart Dynamic Padding
      // We must ensure padding is large enough to SUPPORT the current scroll position
      // otherwise the browser forces the view to jump down.
      const currentScrollTop = scrollContainer.scrollTop;
      const viewportHeight = scrollContainer.clientHeight;
      
      // Get total content height (excluding current padding)
      const contentWrapper = scrollContainer.firstElementChild;
      if (!contentWrapper) return;
      
      const contentHeight = contentWrapper.scrollHeight;
      
      // Minimum padding needed to maintain the current scroll position
      // ScrollHeight must be >= scrollTop + viewportHeight
      // contentHeight + padding >= scrollTop + viewportHeight
      const minPaddingForScroll = currentScrollTop + viewportHeight - contentHeight;
      
      // Also apply the target gap rule
      // content fills viewport when: contentHeight > viewportHeight - targetGap
      const fillsViewport = contentHeight > (viewportHeight - targetGap);
      
      if (fillsViewport && minPaddingForScroll <= targetGap) {
        // Content is big enough AND we don't need extra padding to hold scroll
        setCanScrollDuringGeneration(true);
        setDynamicBottomPadding(targetGap);
      } else {
        // We need extra padding to hold the scroll position OR to keep prompt at top
        // Use the larger of: 
        // 1. Padding to hold current scroll (prevents jump)
        // 2. Target gap (minimum aesthetic spacing)
        // 3. (Optional) Padding to keep prompt exactly at top if we're not quite there?
        //    Actually, minPaddingForScroll covers this if we are already scrolled there!
        
        const safePadding = Math.max(minPaddingForScroll, targetGap);
        setDynamicBottomPadding(safePadding);
      }
      
    };

    // Observe content changes
    const resizeObserver = new ResizeObserver(() => {
      calculatePaddingAndScroll();
    });
    
    // Observe the content wrapper
    const contentWrapper = scrollContainer.firstElementChild;
    if (contentWrapper) {
      resizeObserver.observe(contentWrapper);
    }
    
    // Also observe streaming element if present
    if (streamingEl) {
      resizeObserver.observe(streamingEl);
    }
    
    // Initial calculation
    calculatePaddingAndScroll();
    
    // After 500ms check for scroll lock (only if we are in Phase 2)
    scrollLockTimerRef.current = setTimeout(() => {
      if (isScrollingToTop.current || initialBoostRef.current) return;
      
      const viewportHeight = scrollContainer.clientHeight;
      const cw = scrollContainer.firstElementChild;
      if (cw) {
        const contentHeight = cw.scrollHeight;
        const fillsViewport = contentHeight > (viewportHeight - targetGap);
        if (!fillsViewport) {
          setCanScrollDuringGeneration(false);
        }
      }
    }, 600);

    return () => {
      resizeObserver.disconnect();
      if (scrollLockTimerRef.current) {
        clearTimeout(scrollLockTimerRef.current);
      }
    };
  }, [isCurrentlyGenerating, isChatMode]);

  // Tools Menu State
  const [isToolsMenuOpen, setIsToolsMenuOpen] = useState(false);
  const [shouldRenderToolsMenu, setShouldRenderToolsMenu] = useState(false);
  const [isClosingToolsMenu, setIsClosingToolsMenu] = useState(false);
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);
  const toolsMenuRef = useRef<HTMLDivElement>(null);

  // Models Menu State
  const [isModelsMenuOpen, setIsModelsMenuOpen] = useState(false);
  const [shouldRenderModelsMenu, setShouldRenderModelsMenu] = useState(false);
  const [isClosingModelsMenu, setIsClosingModelsMenu] = useState(false);
  const modelsMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isModelsMenuOpen) {
      setShouldRenderModelsMenu(true);
      setIsClosingModelsMenu(false);
    } else if (shouldRenderModelsMenu) {
      setIsClosingModelsMenu(true);
      const timer = setTimeout(() => {
        setShouldRenderModelsMenu(false);
        setIsClosingModelsMenu(false);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isModelsMenuOpen, shouldRenderModelsMenu]);

  // Sync selection with available models on refresh/load
  useEffect(() => {
    const allSavedModels = [
      ...(modelConfig.gemini?.savedModels || []),
      ...(modelConfig.openai?.savedModels || []),
      ...(modelConfig.anthropic?.savedModels || [])
    ];
    
    if (allSavedModels.length > 0 && !selectedModelId) {
      setSelectedModelId(allSavedModels[0].id);
    }
  }, [modelConfig, selectedModelId, setSelectedModelId]);

  useEffect(() => {
    if (isToolsMenuOpen) {
      setShouldRenderToolsMenu(true);
      setIsClosingToolsMenu(false);
    } else if (shouldRenderToolsMenu) {
      setIsClosingToolsMenu(true);
      const timer = setTimeout(() => {
        setShouldRenderToolsMenu(false);
        setIsClosingToolsMenu(false);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isToolsMenuOpen, shouldRenderToolsMenu]);

  const TOOLS = [
    { id: 'image', label: 'Image', icon: ImageIcon },
    { id: 'design', label: 'Design', icon: Palette },
    { id: 'annotate', label: 'Annotate', icon: AnnotateIcon },
    { id: 'prototype', label: 'Proto', icon: Beaker },
    { id: 'test', label: 'Test', icon: FlaskConical }
  ];

  const currentTool = selectedToolId ? TOOLS.find(t => t.id === selectedToolId) : null;

  const handleToolSelect = (toolId: string) => {
    console.log('[Sidebar] handleToolSelect called with:', toolId);
    setSelectedToolId(toolId);
    setIsToolsMenuOpen(false);
    // Update tab state for tools that need special handling
    if (toolId === 'design') onTabChange('design');
    if (toolId === 'prototype') onTabChange('prototype');
    if (toolId === 'test') {
      console.log('[Sidebar] Calling onTabChange("test")');
      onTabChange('test');
    }
  };

  const handleToolReset = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedToolId(null);
    onTabChange('preview');
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (toolsMenuRef.current && !toolsMenuRef.current.contains(event.target as Node)) {
        setIsToolsMenuOpen(false);
      }
    };
    if (isToolsMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isToolsMenuOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelsMenuRef.current && !modelsMenuRef.current.contains(event.target as Node)) {
        setIsModelsMenuOpen(false);
      }
    };
    if (isModelsMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isModelsMenuOpen]);

  const activeTool = ALL_TOOLS.find(t => t.id === activeTab);
  const showContextHeader = activeTool && activeTool.id !== 'preview';


  const handleTabsScroll = () => {
    if (tabsScrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = tabsScrollRef.current;
      setShowLeftGradient(scrollLeft > 5);
      setShowRightGradient(scrollLeft < scrollWidth - clientWidth - 5);
    }
  };

  useEffect(() => {
    // Small timeout to allow layout transitions to complete
    const timer = setTimeout(handleTabsScroll, 100);
    handleTabsScroll();
    return () => clearTimeout(timer);
  }, [width, isChatMode]);

  // Auto-expand textarea upwards
  useEffect(() => {
    if (textareaRef.current) {
      // Base height for single line is 44px
      textareaRef.current.style.height = '44px';
      const scrollHeight = textareaRef.current.scrollHeight;
      
      if (scrollHeight > 44) {
        // Expand up to 270px before scrolling
        const newHeight = Math.min(scrollHeight, 270);
        textareaRef.current.style.height = `${newHeight}px`;
      }
    }
  }, [promptValue]);
  return (
    <div 
      style={{ width: isChatMode ? '100%' : `${width}px` }} 
      className="flex flex-col h-full overflow-hidden relative bg-[#1c1c1c]"
    >
      {/* Header - Hidden in Chat Mode since StagingView renders it at root level */}
      {!isChatMode && (
        <div className={`h-14 flex items-center justify-between z-20 flex-shrink-0 bg-[#1c1c1c]`}>
          <div className="flex items-center min-w-0 h-full" style={{ paddingLeft: '10px' }}>
            {/* Logo Button - Squircle hover background, Dashboard link */}
            <button 
              onClick={() => navigate('/')}
              className="flex items-center justify-center p-1.5 hover:bg-white/5 transition-colors rounded-xl flex-shrink-0"
              title="Back to Dashboard"
            >
              <img src={logoG} alt="Logo" className="h-[24px] w-auto flex-shrink-0" />
            </button>
            
            <div className="flex-shrink-0" style={{ width: '1px' }} />
            
            {/* Project Title and Toggle - Separate squircle hover */}
            <div 
              className="flex items-center gap-2 cursor-pointer hover:bg-white/5 px-2 py-1.5 rounded-xl transition-colors min-w-0"
              title="Project Settings"
            >
              <span className="font-semibold text-gray-200 truncate">Melody Maker Studio</span>
              <ChevronDown size={14} className="text-gray-500 flex-shrink-0" />
            </div>
          </div>
          <div className="flex items-center gap-3 text-gray-400 flex-shrink-0" style={{ paddingRight: '16px' }}>
            <div className="flex items-center gap-1">
              <button className="p-1.5 hover:text-white transition-colors"><Clock size={16} /></button>
              <button onClick={onToggle} className="p-1.5 hover:text-white transition-colors"><PanelLeftClose size={16} /></button>
            </div>
          </div>
        </div>
      )}

      <div 
        ref={chatScrollRef}
        className={`flex-1 space-y-8 min-h-0 hover-scrollbar
          ${isCurrentlyGenerating 
            ? (canScrollDuringGeneration ? 'overflow-y-auto' : 'overflow-hidden')
            : 'overflow-y-auto'
          }
          ${!dynamicBottomPadding && (showContextHeader ? 'pb-[290px]' : 'pb-[210px]')}
          ${isChatMode 
            ? 'pl-0 pr-0 pt-[76px] scroll-pt-[76px]' // Scrollbar at far right in Chat Mode
            : 'pl-[27px] pr-[18.5px] mr-[8.5px] pt-5 scroll-pt-5'
          }`}
        style={{ 
          transition: 'padding-bottom 300ms cubic-bezier(0.4, 0, 0.2, 1)',
          ...(dynamicBottomPadding ? { paddingBottom: dynamicBottomPadding } : {})
        }}
      >
        <div className={isChatMode ? 'max-w-[800px] mx-auto px-[27px] pr-[40px]' : ''}>
          <div className="space-y-12">
            {/* Render Static Placeholder for "Ship" mode */}
            {!isChatMode && messages.length === 0 && (
              <div className="space-y-8">
                {prompt && (
                  <div className="flex justify-end -mr-[6px]">
                    <div className="bg-[#27272a] text-gray-200 px-4 py-3 rounded-2xl max-w-[78%] text-[15px] leading-relaxed shadow-sm">
                      {prompt}
                    </div>
                  </div>
                )}

                <div className="space-y-4">
                  <div className="flex items-center gap-2.5" style={{ color: '#81888f' }}>
                    <Lightbulb size={18} />
                    <span className="text-[15.15px] font-medium">Thought for 12s</span>
                  </div>

                  <div className="text-gray-300 text-[15px] leading-[1.65] space-y-5">
                    <p>
                      I'll build a sleek music creation app with a dark, neon-synth aesthetic inspired by DAWs and drum machines.
                    </p>

                    <div className="space-y-2">
                      <p className="font-semibold text-white">First version features:</p>
                      <ul className="list-disc pl-5 space-y-1 text-gray-400 marker:text-gray-600">
                        <li>Beat sequencer grid (4 tracks × 16 steps)</li>
                        <li>Tempo and volume controls</li>
                        <li>Play/pause functionality</li>
                        <li>Visual beat indicators with animations</li>
                        <li>Different synth sounds per track</li>
                      </ul>
                    </div>

                    <div className="space-y-1">
                      <p><strong className="text-white">Design:</strong> Dark cyberpunk theme with glowing cyan/teal accents, warm amber highlights, smooth animations, and a futuristic feel.</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5" style={{ color: '#81888f' }}>
                    <FileCode2 size={18} />
                    <span className="text-[15.15px]">Editing <span className="font-mono bg-white/5 px-1.5 py-0.5 rounded" style={{ color: '#81888f' }}>index.css</span></span>
                  </div>
                  
                  <div className="flex items-center gap-3 pt-4 border-t border-white/5 flex-wrap shrink-0">
                    <div className="flex items-center gap-1 shrink-0">
                      <button 
                        onClick={() => setMessageReactions(prev => ({ ...prev, placeholder: prev.placeholder === 'like' ? null : 'like' }))}
                        className={`p-1.5 transition-colors flex-shrink-0 ${messageReactions.placeholder === 'like' ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`}
                      >
                        <ThumbsUp size={14} fill={messageReactions.placeholder === 'like' ? 'currentColor' : 'none'} />
                      </button>
                      <button 
                        onClick={() => setMessageReactions(prev => ({ ...prev, placeholder: prev.placeholder === 'dislike' ? null : 'dislike' }))}
                        className={`p-1.5 transition-colors flex-shrink-0 ${messageReactions.placeholder === 'dislike' ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`}
                      >
                        <ThumbsDown size={14} fill={messageReactions.placeholder === 'dislike' ? 'currentColor' : 'none'} />
                      </button>
                    </div>
                    <button 
                      onClick={() => navigator.clipboard.writeText('Perfect! I\'ll create a beat maker studio with a dark cyberpunk aesthetic...')}
                      className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors flex-shrink-0"
                    >
                      <Copy size={14} />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <div 
                key={msg.id} 
                ref={el => { messageRefs.current[msg.id] = el; }}
                className="space-y-8"
              >
                {msg.role === 'user' ? (
                  <div className="flex justify-end -mr-[6px]">
                    <div className="bg-[#27272a] text-gray-200 px-4 py-3 rounded-2xl max-w-[78%] text-[15px] leading-relaxed shadow-sm">
                      {msg.content}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {msg.thinkingTime !== undefined && (
                      <div className="flex items-center gap-2.5" style={{ color: '#81888f' }}>
                        <Lightbulb size={18} />
                        <span className="text-[15.15px] font-medium">Thought for {msg.thinkingTime}s</span>
                      </div>
                    )}

                    <div className="text-gray-300 text-[15px] leading-[1.65]">
                      {renderFormattedContent(msg.content)}
                    </div>

                    <div className="flex items-center gap-3 pt-4 border-t border-white/5 flex-wrap shrink-0">
                      <div className="flex items-center gap-1 shrink-0">
                        <button 
                          onClick={() => setMessageReactions(prev => ({ ...prev, [msg.id]: prev[msg.id] === 'like' ? null : 'like' }))}
                          className={`p-1.5 transition-colors flex-shrink-0 ${messageReactions[msg.id] === 'like' ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`}
                        >
                          <ThumbsUp size={14} fill={messageReactions[msg.id] === 'like' ? 'currentColor' : 'none'} />
                        </button>
                        <button 
                          onClick={() => setMessageReactions(prev => ({ ...prev, [msg.id]: prev[msg.id] === 'dislike' ? null : 'dislike' }))}
                          className={`p-1.5 transition-colors flex-shrink-0 ${messageReactions[msg.id] === 'dislike' ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`}
                        >
                          <ThumbsDown size={14} fill={messageReactions[msg.id] === 'dislike' ? 'currentColor' : 'none'} />
                        </button>
                      </div>
                      <button 
                        onClick={() => navigator.clipboard.writeText(stripCodeAndIndicators(msg.content))}
                        className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors flex-shrink-0"
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Current Streaming / Thinking UI */}
            {isCurrentlyGenerating && (
              <div ref={streamingContentRef} className="space-y-4 animate-in fade-in duration-300">
                <div className="flex items-center gap-2.5" style={{ color: '#81888f' }}>
                  <Lightbulb size={18} />
                  <TextShimmer className="text-[15.15px] font-medium" duration={1.5}>
                    {isCurrentlyThinking ? `Thinking` : `Thought for ${currentThinkingTime}s`}
                  </TextShimmer>
                </div>

                {currentStreamingResponse && (
                  <div className="text-gray-300 text-[15px] leading-[1.65]">
                    {renderFormattedContent(currentStreamingResponse, true)}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
    </div>

      {/* Footer Container */}
      <div className="absolute bottom-0 left-0 w-full z-30 pointer-events-none">
        <div className="h-4 w-full bg-gradient-to-t from-[#1c1c1c] via-[#1c1c1c]/90 to-transparent" />
        <div className="bg-[#1c1c1c] pointer-events-auto">
          <div className="relative">
            <div 
              ref={tabsScrollRef}
              onScroll={handleTabsScroll}
              className="flex gap-2 overflow-x-auto no-scrollbar px-[14px] scroll-smooth"
            >
               {['Add preset patterns', 'Add audio effects', 'Add MIDI support', 'Customize synth', 'Add more'].map((text, i) => (
                 <button key={i} className="whitespace-nowrap px-4 py-2 rounded-xl bg-[#27272a] text-sm text-gray-200 hover:bg-[#3f3f46] transition-colors font-medium border border-transparent">
                    {text}
                 </button>
               ))}
            </div>
            <div className={`absolute top-0 right-0 w-12 h-full bg-gradient-to-l from-[#1c1c1c] to-transparent pointer-events-none transition-opacity duration-200 ${showRightGradient ? 'opacity-100' : 'opacity-0'}`} />
            <div className={`absolute top-0 left-0 w-12 h-full bg-gradient-to-r from-[#1c1c1c] to-transparent pointer-events-none transition-opacity duration-200 ${showLeftGradient ? 'opacity-100' : 'opacity-0'}`} />
          </div>

          <div className="px-[14px] pb-4 pt-4">
            <div className={`bg-[#27272a] rounded-[26px] p-3.5 relative flex flex-col shadow-lg border border-white/5 transition-all duration-300 ease-in-out`}>
               <div 
                 className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${showContextHeader ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
               >
                 <div className="overflow-hidden">
                   <div className={`flex flex-col gap-3 pb-2 transition-opacity duration-300 ${showContextHeader ? 'opacity-100' : 'opacity-0'}`}>
                     {activeTool && (
                       <>
                         <button 
                           onClick={() => onTabChange('preview')}
                           className="flex items-center gap-2 text-[#a1a1aa] hover:text-white transition-colors text-sm font-medium self-start ml-1"
                         >
                           <ArrowLeft size={14} />
                           <span>Back to Preview</span>
                         </button>
                         
                         <div className="flex items-center gap-2 bg-[#3f3f46]/50 rounded-xl px-4 py-3 text-white">
                           <activeTool.icon size={18} />
                           <span className="font-medium">{activeTool.label}</span>
                         </div>
                       </>
                     )}
                   </div>
                 </div>
               </div>

               {/* Attachments Area */}
               <div className={`grid transition-[grid-template-rows] duration-[250ms] ease-in-out ${hasVisibleAttachments ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                 <div className="overflow-hidden">
                   <div className={`flex gap-3 overflow-x-auto no-scrollbar pb-3 -mx-1 px-1 transition-all duration-[250ms] ease-in-out ${showContextHeader ? 'pt-2' : 'pt-0'}`}>
                     {attachments.map((att) => (
                       <div key={att.id} className={`relative group flex-shrink-0 transition-all duration-200 ${removingIds.has(att.id) ? 'opacity-0 scale-90' : 'opacity-100 scale-100 animate-in fade-in zoom-in-95'}`}>
                         {att.type === 'image' ? (
                           <div className="relative">
                             <div className="w-16 h-16 rounded-2xl overflow-hidden border border-white/5 bg-[#1c1c1c]">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={att.url} alt={att.name} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                             </div>
                             <button 
                               onClick={() => removeAttachment(att.id)}
                               className="absolute -top-1.5 -right-1.5 bg-[#27272a] text-gray-400 hover:text-white border border-white/10 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-all duration-200 shadow-xl z-10"
                             >
                                 <X size={12} />
                             </button>
                           </div>
                         ) : (
                           <div className="h-16 min-w-[180px] bg-[#1c1c1c] rounded-2xl flex items-center px-4 gap-3.5 relative border border-white/5 hover:border-white/10 transition-colors">
                              <div className="text-gray-400">
                                 <Globe size={24} strokeWidth={1.5} />
                              </div>
                              <div className="flex flex-col min-w-0">
                                 <span className="text-[13px] font-semibold text-gray-200 truncate max-w-[120px] leading-tight">{att.name}</span>
                                 <span className="text-[11px] text-gray-500 font-medium uppercase tracking-wide">{att.extension}</span>
                              </div>
                              <button 
                                onClick={() => removeAttachment(att.id)}
                                className="absolute -top-1.5 -right-1.5 bg-[#27272a] text-gray-400 hover:text-white border border-white/10 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-all duration-200 shadow-xl z-10"
                              >
                                 <X size={12} />
                              </button>
                           </div>
                         )}
                       </div>
                     ))}
                   </div>
                 </div>
               </div>

               <textarea 
                  ref={textareaRef}
                  placeholder="Ask Lovable..." 
                  className={`w-full bg-transparent text-gray-100 placeholder-gray-400 resize-none outline-none min-h-[44px] px-3 py-1.5 mb-2 text-[16px] leading-relaxed font-normal overflow-y-auto ${isChatMode ? 'text-lg' : ''}`}
                  value={promptValue}
                  onChange={(e) => setPromptValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage(promptValue);
                    }
                  }}
                  rows={1}
               />
               <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                     <input 
                        type="file" 
                        multiple 
                        className="hidden" 
                        ref={fileInputRef} 
                        onChange={handleFileSelect} 
                     />
                     <button 
                        onClick={() => fileInputRef.current?.click()}
                        className="p-2.5 rounded-full bg-[#3f3f46]/60 text-gray-300 hover:bg-[#3f3f46] hover:text-white transition-colors flex-shrink-0"
                     >
                        <Plus size={18} />
                     </button>
                     <div className="relative" ref={toolsMenuRef}>
                        {shouldRenderToolsMenu && (
                          <div className={`absolute bottom-full left-0 mb-2 w-40 bg-[#1c1c1c] border border-[#2e2e2e] rounded-xl shadow-2xl overflow-hidden z-50 ${isClosingToolsMenu ? 'settings-fade-out' : 'settings-fade-in'}`}>
                             {TOOLS.map((tool) => (
                               <button 
                                  key={tool.id}
                                  onClick={() => handleToolSelect(tool.id)}
                                  className="flex items-center gap-2.5 w-full px-3 py-2.5 hover:bg-[#27272a] text-gray-300 hover:text-white transition-colors text-[13px] font-medium text-left"
                               >
                                  <tool.icon size={16} className={tool.id === 'design' || tool.id === 'prototype' ? 'text-gray-400' : ''} />
                                  <span>{tool.label}</span>
                               </button>
                             ))}
                          </div>
                        )}
                        <button 
                           onClick={() => !currentTool && setIsToolsMenuOpen(!isToolsMenuOpen)}
                           className={`flex items-center rounded-full bg-[#3f3f46]/60 text-gray-300 hover:bg-[#3f3f46] hover:text-white transition-colors text-[13px] font-medium flex-shrink-0 h-[36px]
                             ${isCompact 
                                ? (currentTool ? 'px-2.5 gap-2.5' : 'px-2.5') 
                                : (currentTool ? 'pl-4 pr-2.5 gap-2.5' : 'px-4 gap-2')
                             }
                             ${isToolsMenuOpen ? 'bg-[#3f3f46] text-white' : ''}
                           `}
                           title="Tools"
                        >
                           {currentTool ? (
                             <>
                               <div className="flex items-center gap-2">
                                 <currentTool.icon size={16} />
                                 {!isCompact && <span>{currentTool.label}</span>}
                               </div>
                               <div 
                                  onClick={handleToolReset}
                                  className="p-0.5 hover:bg-white/20 rounded-full transition-colors cursor-pointer flex items-center justify-center"
                               >
                                 <X size={12} />
                               </div>
                             </>
                           ) : (
                             <>
                               <Wrench size={16} />
                               {!isCompact && <span className="ml-2">Tools</span>}
                             </>
                           )}
                        </button>
                     </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                     <button 
                        className={`flex items-center gap-2 rounded-full bg-[#3f3f46]/60 text-gray-300 hover:bg-[#3f3f46] hover:text-white transition-colors text-[13px] font-medium flex-shrink-0 h-[36px]
                          ${isCompact ? 'px-2.5 justify-center' : 'px-4'}
                        `}
                        title="Chat"
                     >
                        <MessageSquare size={16} />
                        {!isCompact && <span>Chat</span>}
                     </button>
                      <div className="relative" ref={modelsMenuRef}>
                        {shouldRenderModelsMenu && (
                          <div className={`absolute bottom-full right-0 mb-2 w-44 bg-[#1c1c1c] border border-[#2e2e2e] rounded-xl shadow-2xl overflow-hidden z-50 ${isClosingModelsMenu ? 'settings-fade-out' : 'settings-fade-in'}`}>
                             {/* Provider Groups */}
                             {['gemini', 'openai', 'anthropic'].map((provider) => {
                               const providerModels = modelConfig[provider]?.savedModels || [];
                               if (providerModels.length === 0) return null;
                               
                               return (
                                 <div key={provider} className="border-b border-white/5 last:border-0">
                                   <div className="px-3 py-2 text-[10px] font-bold text-gray-500 uppercase tracking-wider bg-white/[0.02]">
                                     MODELS
                                   </div>
                                   {providerModels.map((model: any) => {
                                     const shortenName = (name: string) => {
                                       return name
                                         .replace(/Gemini\s+/i, '')
                                         .replace(/flash\s+lite/i, 'Lite')
                                         .replace(/gpt-/i, '')
                                         .replace(/claude\s+/i, '');
                                     };
                                     
                                     const isSelected = selectedModelId === model.id;
                                     
                                     return (
                                       <button 
                                          key={model.id}
                                          onClick={() => {
                                            setSelectedModelId(model.id);
                                            setModelConfig((prev: any) => ({
                                              ...prev,
                                              [provider]: { ...prev[provider], model: model.modelId, thinkingLevel: model.thinkingLevel }
                                            }));
                                            setIsModelsMenuOpen(false);
                                          }}
                                          className={`flex items-center justify-between w-full px-3 py-2.5 transition-colors text-[13px] font-medium text-left
                                            ${isSelected ? 'bg-[#1e2b48] text-[#58a1ff]' : 'hover:bg-[#27272a] text-gray-300 hover:text-white'}
                                          `}
                                       >
                                          <div className="flex items-center gap-2.5">
                                            <GeminiLogo size={14} className={isSelected ? 'text-[#58a1ff]' : (provider === 'gemini' ? 'text-blue-400' : provider === 'openai' ? 'text-green-400' : 'text-orange-400')} />
                                            <span className="truncate max-w-[110px]">{shortenName(model.name)}</span>
                                          </div>
                                          <div className="flex items-center gap-2">
                                            <div className="flex items-center gap-1">
                                               {Array.from({ length: model.thinkingLevel }).map((_, i) => (
                                                 <div key={i} className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-[#58a1ff]' : 'bg-[#fbbf24]'}`} />
                                               ))}
                                            </div>
                                            {isSelected && <Check size={14} className="text-[#58a1ff]" />}
                                          </div>
                                       </button>
                                     );
                                   })}
                                 </div>
                               );
                             })}
                             
                             {/* If no models saved, show a placeholder or link to settings */}
                             {!(modelConfig.gemini.savedModels.length || modelConfig.openai.savedModels.length || modelConfig.anthropic.savedModels.length) && (
                               <div className="px-4 py-6 text-center text-gray-500">
                                  <Sparkles size={24} className="mx-auto mb-2 opacity-20" />
                                  <p className="text-[12px]">No model presets added.</p>
                                  <button 
                                    onClick={() => {
                                      setIsModelsMenuOpen(false);
                                      // Trigger settings opening logic if possible, or just guide user
                                    }}
                                    className="mt-2 text-[#58a1ff] hover:underline text-[11px]"
                                  >
                                    Configure in Settings
                                  </button>
                               </div>
                             )}
                          </div>
                        )}
                        <button 
                           onClick={() => setIsModelsMenuOpen(!isModelsMenuOpen)}
                           className={`p-2.5 rounded-full bg-[#3f3f46]/60 text-gray-300 hover:bg-[#3f3f46] hover:text-white transition-colors flex-shrink-0 ${isModelsMenuOpen ? 'bg-[#3f3f46] text-white' : ''}`}
                        >
                           <GeminiLogo size={18} />
                        </button>
                      </div>
                       {isCurrentlyGenerating ? (
                         <button 
                           onClick={() => {
                             // TODO: Add stop generation logic here
                             workbenchStore.stopGeneration?.();
                           }}
                           className="w-[38px] h-[38px] rounded-full bg-[#3b82f6]/20 text-[#3b82f6] hover:bg-[#3b82f6]/30 transition-colors flex items-center justify-center shadow-md flex-shrink-0"
                         >
                           <div className="w-[14px] h-[14px] bg-current rounded-[3px]" />
                         </button>
                       ) : (
                         <button 
                           onClick={() => handleSendMessage(promptValue)}
                           className="w-[38px] h-[38px] rounded-full bg-[#d4d4d8] text-black hover:bg-white transition-colors flex items-center justify-center shadow-md flex-shrink-0"
                         >
                           {(promptValue.trim().length > 0 || attachments.length > 0) ? (
                              <ArrowUp size={18} strokeWidth={2.5} />
                           ) : (
                              <AudioLines size={18} />
                           )}
                         </button>
                       )}
                  </div>
               </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
