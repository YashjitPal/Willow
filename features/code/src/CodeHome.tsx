import React, { useState, useCallback, useEffect, useRef, startTransition } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { useStore } from '@nanostores/react';
import { ArrowUp, Plus, AudioLines, ChevronDown, Paperclip, Globe, X, Wrench, MessageSquare, Image as ImageIcon, Palette, FlaskConical, Check, Sparkles, FileText } from 'lucide-react';
import { useAuth } from '@willow/auth/AuthContext';
import { useUserDataContext } from '@willow/auth/UserDataContext';
import { useLocalFS } from '@willow/storage/local-fs/LocalFSContext';
import { useBackground } from '@willow/studio/shell/BackgroundContext';
import { useAutoSave } from './use-auto-save';
import { workbenchStore } from './runtime/sandpack/index';
import { getCachedFirstName, cacheFirstName } from '@willow/core/display-name';
import { readProjectRegistry, writeProjectRegistry } from '@willow/projects/registry';
import { MessageLoading } from '@willow/ui/message-loading';
import { ModelsMenu } from '@willow/chat/composer/Composer';
import { getThinkingEffortLabel } from '@willow/ai/models/efforts';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { BottomPanel } from '@willow/media/MediaShowcase';
import logoG from '@willow/assets/brand/logo-glyph.png';
import { PROJECT_NAME_MODEL } from '@models';
import newspaperImg from '@willow/assets/prompt-suggestions/Newspaper.png';
import dashboardImg from '@willow/assets/prompt-suggestions/Dashboard.png';
import gameImg from '@willow/assets/prompt-suggestions/game.png';
import crmImg from '@willow/assets/prompt-suggestions/CRM.png';
import teamworkImg from '@willow/assets/prompt-suggestions/Teamwork.png';
import bloggingImg from '@willow/assets/prompt-suggestions/blogging.png';
import chatImg from '@willow/assets/prompt-suggestions/chat.png';
import aichatImg from '@willow/assets/prompt-suggestions/aichat.png';
import aiimageImg from '@willow/assets/prompt-suggestions/aiimage.png';
import cashcounterImg from '@willow/assets/prompt-suggestions/cashcounter.png';
import wealthImg from '@willow/assets/prompt-suggestions/wealth.png';
import bookmarkImg from '@willow/assets/prompt-suggestions/bookmark.png';
import communityImg from '@willow/assets/prompt-suggestions/community.png';
import devcheatsheetImg from '@willow/assets/prompt-suggestions/devcheatsheet.png';
import ecommerceinventoryImg from '@willow/assets/prompt-suggestions/ecommerceinventory.png';
import expenseImg from '@willow/assets/prompt-suggestions/expense.png';
import pomodoroImg from '@willow/assets/prompt-suggestions/pomodoro.png';
import portfolioImg from '@willow/assets/prompt-suggestions/portfolio.png';
import storyboardImg from '@willow/assets/prompt-suggestions/storyboard.png';
import billImg from '@willow/assets/prompt-suggestions/bill.png';
import cryptoImg from '@willow/assets/prompt-suggestions/crypto.png';
import mindmapImg from '@willow/assets/prompt-suggestions/mindmap.png';
import presetImg from '@willow/assets/prompt-suggestions/preset.png';
import themeImg from '@willow/assets/prompt-suggestions/theme.png';
import votingImg from '@willow/assets/prompt-suggestions/voting.png';
import weeklyImg from '@willow/assets/prompt-suggestions/weekly.png';
import aipenImg from '@willow/assets/prompt-suggestions/aipen.png';
import landingImg from '@willow/assets/prompt-suggestions/landing.png';
import pricingImg from '@willow/assets/prompt-suggestions/pricing.png';

const getWideCardImage = (category: string) => {
  switch (category) {
    case 'foryou': return devcheatsheetImg;
    case 'productivity': return bookmarkImg;
    case 'saas': return ecommerceinventoryImg;
    case 'finance': return expenseImg;
    case 'social': return communityImg;
    case 'aiapps': return storyboardImg;
    default: return null;
  }
};

const getSmallCard1Image = (category: string) => {
  switch (category) {
    case 'foryou': return portfolioImg;
    case 'productivity': return mindmapImg;
    case 'saas': return landingImg;
    case 'finance': return cryptoImg;
    case 'social': return themeImg;
    case 'aiapps': return aipenImg;
    default: return null;
  }
};

const getSmallCard2Image = (category: string) => {
  switch (category) {
    case 'foryou': return pomodoroImg;
    case 'productivity': return weeklyImg;
    case 'saas': return pricingImg;
    case 'finance': return billImg;
    case 'social': return votingImg;
    case 'aiapps': return presetImg;
    default: return null;
  }
};

// Warms the default-category ('foryou') card images. App.tsx gates the lazy
// CodeWorkspace chunk on this so the bento grid appears fully formed instead
// of images popping in one by one; capped so a slow image can never block the
// UI for long — the hidden preloader below warms the rest after mount.
export const preloadIdleImages = () => {
  const firstPaintImages = [portfolioImg, pomodoroImg, devcheatsheetImg, newspaperImg, teamworkImg];
  return Promise.race([
    Promise.all(
      firstPaintImages.map(
        (src) =>
          new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => resolve();
            img.onerror = () => resolve();
            img.src = src;
          })
      )
    ),
    new Promise<void>((resolve) => setTimeout(resolve, 800)),
  ]);
};

// Lazy load heavy staging components — they stay in memory once loaded
const StagingSidebar = React.lazy(() => import('./workbench/WorkbenchSidebar'));
const MainPreview = React.lazy(() => import('./workbench/WorkbenchPreview'));

// ── Props ────────────────────────────────────────────────────────────────────

interface CodeWorkspaceProps {
  modelConfig: any;
  setModelConfig: React.Dispatch<React.SetStateAction<any>>;
  selectedModelId: string;
  setSelectedModelId: (id: string) => void;
  isAuthenticated: boolean;
  onAuthRequired?: () => void;
  onSettingsClick?: (tab?: string) => void;
  isSidebarCollapsed?: boolean;
  onWorkspaceActive?: (active: boolean) => void;
  chatResetKey?: number;
}

// ── Component ────────────────────────────────────────────────────────────────

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

const VisualEditsIcon = ({ size = 16, className = "" }: { size?: number, className?: string }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg" 
    className={className}
  >
    <path d="M3 9V6C3 4.344 4.344 3 6 3H9" 
          stroke="currentColor" strokeWidth="2.1" strokeLinecap="round"/>
    <path d="M15 3H18C20.1 3 21 3.9 21 6V9" 
          stroke="currentColor" strokeWidth="2.1" strokeLinecap="round"/>
    <path d="M3 15V18C3 20.1 3.9 21 6 21H9" 
          stroke="currentColor" strokeWidth="2.1" strokeLinecap="round"/>
    <path d="M11.25 11.25L15.75 22.5Q17.25 17.25 22.5 15.75L11.25 11.25Z" 
          stroke="currentColor" strokeWidth="2.1" fill="none"
          strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const CATEGORIES = [
  { id: 'foryou', label: 'For you' },
  { id: 'social', label: 'Social' },
  { id: 'finance', label: 'Finance' },
  { id: 'productivity', label: 'Productivity' },
  { id: 'saas', label: 'SaaS' },
  { id: 'aiapps', label: 'AI Apps' }
] as const;

const SUGGESTIONS: Record<string, string[]> = {
  foryou: [
    "Retro portfolio",
    "Pomodoro app",
    "Build a developer's visual cheat sheet hub with search filters, interactive code snippets, and custom tag organizers",
    "Create a team weekly report compiler with automated Markdown syntax formatting, file attachments, and download options",
    "Create a team collaboration board with drag-and-drop task cards, live user presence dots, and historical event logging"
  ],
  productivity: [
    "Mindmap editor",
    "Weekly standup",
    "Build a visual bookmark manager with auto-generated categories, interactive search filters, and speed-dial card dashboards",
    "Design a personal task dashboard with interactive timeline calendar views, recursive subtask nesting, and automated completion rates",
    "Build an interactive side-scrolling platformer game like Mario where the player is an adorable swimming otter who navigates underwater corals, collects pearls, and dodges mischievous crabs"
  ],
  saas: [
    "Landing builder",
    "Pricing widget",
    "Create an automated e-commerce inventory hub with mock supplier API integrations, low-stock visual alert badges, and CSV report export buttons",
    "Create a CRM pipeline lead manager with customizable pipeline stages, drag-and-drop lead cards, and visual pipeline value counters",
    "Build an analytics dashboard with real-time charting widgets, mock CSV file upload parsing, and custom date range filters"
  ],
  finance: [
    "Live crypto ticker",
    "Bill generator",
    "Build an automated expense report dashboard with custom categories, visual bar charts for monthly trends, and printable financial summaries",
    "Build a personal wealth and expense tracker with customizable budgets, category limits, and interactive progress rings",
    "Create an invoice billing console with automated tax adjustments, customizable logo layouts, and clean print-friendly styles"
  ],
  social: [
    "Chat customizer",
    "Live voting poll",
    "Build an interactive community discussion hub with custom post post categories, live comment threads, and instant search bars",
    "Build a micro-blogging app with interactive markdown rendering, code snippet syntax highlighting, and responsive post feeds",
    "Create a real-time channel chat app with multiple chat rooms, search bars for message history, and animated emoji reactions"
  ],
  aiapps: [
    "AI prompt helper",
    "Style preset picker",
    "Create an AI storyboarding app that generates branching narrative flows, customizable character profile cards, and interactive text-adventure choices",
    "Build an AI image generation playground console with sliders for model variables, aspect ratio grids, and download cards",
    "Create a chatbot console playground with specialized system preset dropdowns, chat history logs, and token cost estimators"
  ]
};

export const CodeWorkspace: React.FC<CodeWorkspaceProps> = ({
  modelConfig,
  setModelConfig,
  selectedModelId,
  setSelectedModelId,
  isAuthenticated,
  onAuthRequired,
  onSettingsClick,
  isSidebarCollapsed: dashboardSidebarCollapsed = false,
  onWorkspaceActive,
  chatResetKey = 0,
}) => {
  const navigate = useNavigate();
  const { user, accessToken } = useAuth();
  const { userProfile } = useAuth();
  const { apiKeys } = useUserDataContext();
  const { background } = useBackground();
  const {
    isLocalFolderConnected,
  } = useLocalFS();

  // ── Phase state ──────────────────────────────────────────────────────────
  // 'idle'   = landing screen with heading + prompt box at the bottom
  // 'active' = StagingView layout inline (chat → workspace morph)
  const [phase, setPhase] = useState<'idle' | 'active'>('idle');

  // ── Saved-projects count (drives the empty-state in the scroll-down panel) ──
  // Cheap localStorage read; stays in sync via the same event the rest of the
  // app dispatches when the project registry changes.
  const [codeProjectCount, setCodeProjectCount] = useState(0);
  useEffect(() => {
    const recount = () => {
      try {
        const list = readProjectRegistry() as any[];
        setCodeProjectCount(Array.isArray(list) ? list.filter((p: any) => p?.kind === 'code').length : 0);
      } catch {
        setCodeProjectCount(0);
      }
    };
    recount();
    window.addEventListener('willow_projects_updated', recount);
    window.addEventListener('willow_media_updated', recount);
    return () => {
      window.removeEventListener('willow_projects_updated', recount);
      window.removeEventListener('willow_media_updated', recount);
    };
  }, []);

  // ── 3D Tilt Hover Effects for Bento Cards ──────────────────────────────────
  const handleMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    const card = e.currentTarget;
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const xc = rect.width / 2;
    const yc = rect.height / 2;
    
    // Smooth responsive tilt up to 6 degrees, scaling slightly to 1.025 for a snug fit
    const tiltX = (yc - y) / yc * 6;
    const tiltY = (x - xc) / xc * 6;
    
    card.style.transition = 'transform 0.1s cubic-bezier(0.25, 1, 0.5, 1)';
    card.style.transform = `perspective(1000px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale(1.025)`;
  };

  const handleMouseLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
    const card = e.currentTarget;
    // Elegant spring-back reset transition
    card.style.transition = 'transform 0.5s cubic-bezier(0.25, 1, 0.5, 1)';
    card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale(1)';
  };

  // Prompt captured from idle phase, passed to StagingSidebar
  const [initialPrompt, setInitialPrompt] = useState('');
  const [initialAttachments, setInitialAttachments] = useState<any[] | undefined>(undefined);

  // ── Idle-phase prompt box state ──────────────────────────────────────────
  const [promptText, setPromptText] = useState('');
  const [attachments, setAttachments] = useState<any[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Attachments unmounting buffer ──
  const [renderedAttachments, setRenderedAttachments] = useState<any[]>([]);

  useEffect(() => {
    if (attachments.length > 0) {
      setRenderedAttachments(attachments);
    } else {
      const timer = setTimeout(() => {
        setRenderedAttachments([]);
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [attachments]);

  // ── Idle-phase snap scrolling (hero ⇄ "Your apps") ───────────────────────
  // Native CSS scroll snapping keeps wheel and trackpad movement directly
  // coupled to the page, then returns to the nearest full-height section.
  const [idleComposerHost, setIdleComposerHost] = useState<HTMLDivElement | null>(null);
  const [scrollRatio, setScrollRatio] = useState(0);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const height = target.clientHeight || window.innerHeight;
    if (height > 0) {
      const ratio = Math.min(target.scrollTop / (height * 0.45), 1);
      setScrollRatio(ratio);
    }
  };

  // ── Active-phase (StagingView) state ─────────────────────────────────────
  const [isChatMode, setIsChatMode] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(400);
  const [lastSidebarWidth, setLastSidebarWidth] = useState(400);
  const [isStagingSidebarCollapsed, setIsStagingSidebarCollapsed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeTab, setActiveTab] = useState('preview');
  const [activeCategory, setActiveCategory] = useState<'foryou' | 'productivity' | 'saas' | 'finance' | 'social' | 'aiapps'>('foryou');
  
  // ── Menu States ────────────────────────────────────────────────────────
  const [isModelsMenuOpen, setIsModelsMenuOpen] = useState(false);
  const [isToolsMenuOpen, setIsToolsMenuOpen] = useState(false);
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);
  const modelsMenuRef = useRef<HTMLDivElement>(null);
  const toolsMenuRef = useRef<HTMLDivElement>(null);
  
  const TOOLS = [
    { id: 'plan', label: 'Plan', icon: FileText },
    { id: 'image', label: 'Image', icon: ImageIcon },
    { id: 'design', label: 'Design', icon: Palette },
    { id: 'annotate', label: 'Annotate', icon: AnnotateIcon },
    { id: 'prototype', label: 'Visual Edits', icon: VisualEditsIcon },
    { id: 'test', label: 'Test', icon: FlaskConical }
  ];
  
  const currentTool = selectedToolId ? TOOLS.find(t => t.id === selectedToolId) : null;

  const ALL_MODELS = [
    ...(modelConfig?.gemini?.savedModels || []).map((m: any) => ({ ...m, provider: 'Google' })),
    ...(modelConfig?.openai?.savedModels || []).map((m: any) => ({ ...m, provider: 'OpenAI' })),
    ...(modelConfig?.anthropic?.savedModels || []).map((m: any) => ({ ...m, provider: 'Anthropic' })),
    ...(modelConfig?.moonshot?.savedModels || []).map((m: any) => ({ ...m, provider: 'Moonshot AI' })),
    ...(modelConfig?.spacexai?.savedModels || []).map((m: any) => ({ ...m, provider: 'SpaceXAI' })),
    ...(modelConfig?.zhipuai?.savedModels || []).map((m: any) => ({ ...m, provider: 'Zhipu AI' }))
  ].filter((m: any) => m.name !== "Nano Banana Pro");

  const activeModel = ALL_MODELS.find((m: any) => m.id === selectedModelId) || ALL_MODELS.find((m: any) => m.id === (selectedModelId ? selectedModelId.split('::effort-')[0] : ''));

  const getShortName = (name: string) => {
    if (!name) return "Model";
    if (name.includes("2.5 Flash Lite")) return "2.5 Lite";
    return name
      .replace(/Gemini\s+/gi, '')
      .replace(/Claude\s+/gi, '')
      .replace(/GPT\s+/gi, '')
      .replace(/\s+Extended$/gi, '')
      .trim();
  };

  let currentThinkingLevel = activeModel?.thinkingLevel ?? 0;
  if (selectedModelId?.includes('::effort-')) {
    currentThinkingLevel = Number(selectedModelId.split('::effort-')[1]);
  }

  const activeModelDisplayLabel = activeModel ? getShortName(activeModel.name) : 'Model';
  const activeEffortDisplayLabel = activeModel && currentThinkingLevel > 0
    ? getThinkingEffortLabel({ ...activeModel, thinkingLevel: currentThinkingLevel }, true)
    : '';
  const activeModelAndEffortLabel = [activeModelDisplayLabel, activeEffortDisplayLabel]
    .filter(Boolean)
    .join(' ');

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelsMenuRef.current && !modelsMenuRef.current.contains(event.target as Node)) {
        setIsModelsMenuOpen(false);
      }
      if (toolsMenuRef.current && !toolsMenuRef.current.contains(event.target as Node)) {
        setIsToolsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Staggers heavy WebContainer bootup until layout morph finishes
  const [isMorphing, setIsMorphing] = useState(false);

  // Project name generation
  const [projectName, setProjectName] = useState('');
  const [isGeneratingName, setIsGeneratingName] = useState(false);
  const nameGeneratedRef = useRef(false);
  const projectRegisteredRef = useRef(false);

  // Watch workbenchStore.hasUserCode to auto-flip isChatMode
  const hasUserCode = useStore(workbenchStore.hasUserCode);

  useEffect(() => {
    if (phase === 'active' && isChatMode && hasUserCode) {
      // Code has been generated — morph the layout!
      setIsMorphing(true);
      setIsChatMode(false);
      // Wait for the 500ms cubic-bezier transition to finish before booting the heavy WebContainer
      setTimeout(() => setIsMorphing(false), 500);
    }
  }, [phase, isChatMode, hasUserCode]);

  useEffect(() => {
    // Hide the dashboard sidebar only when the workspace morphs to the code view
    const isWorkspaceActive = phase === 'active' && !isChatMode;
    onWorkspaceActive?.(isWorkspaceActive);
    
    // Cleanup on unmount to ensure sidebar comes back
    return () => {
      onWorkspaceActive?.(false);
    };
  }, [phase, isChatMode, onWorkspaceActive]);

  // Reset workbenchStore when entering a new session or on chat reset
  useEffect(() => {
    if (phase === 'idle') {
      workbenchStore.reset();
      workbenchStore.resetToTemplate();
    }
  }, [phase]);

  // Handle new chat button
  useEffect(() => {
    if (chatResetKey > 0) {
      setPhase('idle');
      setInitialPrompt('');
      setInitialAttachments(undefined);
      setPromptText('');
      setAttachments([]);
      setIsChatMode(true);
      setProjectName('');
      nameGeneratedRef.current = false;
      projectRegisteredRef.current = false;
      workbenchStore.reset();
      workbenchStore.resetToTemplate();
    }
  }, [chatResetKey]);

  // ── Project name generation (from StagingView) ───────────────────────────
  useEffect(() => {
    if (phase !== 'active' || !initialPrompt || nameGeneratedRef.current) return;
    if (!apiKeys.gemini?.[0] && !apiKeys.openai?.[0] && !apiKeys.anthropic?.[0] && !apiKeys.moonshot?.[0] && !apiKeys.spacexai?.[0] && !apiKeys.zhipuai?.[0]) return;

    const generateProjectName = async () => {
      nameGeneratedRef.current = true;
      setIsGeneratingName(true);
      try {
        const chatNamingSelectionId = modelConfig?.systemDefaults?.chatRenaming || 'gemini-3.1-flash-lite';
        const allModels = [
          ...(modelConfig?.gemini?.savedModels || []).map((m: any) => ({ ...m, provider: 'gemini' as const })),
        ...(modelConfig?.openai?.savedModels || []).map((m: any) => ({ ...m, provider: 'openai' as const })),
        ...(modelConfig?.anthropic?.savedModels || []).map((m: any) => ({ ...m, provider: 'anthropic' as const })),
        ...(modelConfig?.moonshot?.savedModels || []).map((m: any) => ({ ...m, provider: 'moonshot' as const })),
        ...(modelConfig?.spacexai?.savedModels || []).map((m: any) => ({ ...m, provider: 'spacexai' as const })),
        ...(modelConfig?.zhipuai?.savedModels || []).map((m: any) => ({ ...m, provider: 'zhipuai' as const })),
        ...(modelConfig?.moonshot?.savedModels || []).map((m: any) => ({ ...m, provider: 'moonshot' as const })),
        ...(modelConfig?.spacexai?.savedModels || []).map((m: any) => ({ ...m, provider: 'spacexai' as const })),
        ...(modelConfig?.zhipuai?.savedModels || []).map((m: any) => ({ ...m, provider: 'zhipuai' as const })),
        ...(modelConfig?.moonshot?.savedModels || []).map((m: any) => ({ ...m, provider: 'moonshot' as const })),
        ...(modelConfig?.spacexai?.savedModels || []).map((m: any) => ({ ...m, provider: 'spacexai' as const })),
        ...(modelConfig?.zhipuai?.savedModels || []).map((m: any) => ({ ...m, provider: 'zhipuai' as const })),
        ];
        let targetProvider = 'gemini';
        let targetModelId = 'gemini-3.1-flash-lite';
        if (chatNamingSelectionId === 'gemini-3.1-flash-lite') {
          targetProvider = 'gemini';
          targetModelId = 'gemini-3.1-flash-lite';
        } else if (chatNamingSelectionId === 'claude-sonnet-4.5') {
          targetProvider = 'anthropic';
          targetModelId = 'claude-sonnet-4.5';
        } else {
          const sel = allModels.find((m) => m.modelId === chatNamingSelectionId);
          if (sel) { targetProvider = sel.provider; targetModelId = sel.modelId; }
        }
        const apiKey = apiKeys?.[targetProvider]?.[0];
        if (!apiKey) throw new Error('No API key');
        const promptForName = `Generate a creative project name for an app. Use 2-3 words (preferred) or 1 word if catchy. Focus on WHAT the app does, not HOW it's being built. Ignore words like "code", "build", "create", "make" in the request - just name the app itself. Return ONLY the name, no quotes.\n\nApp description: ${initialPrompt}`;
        let name = '';
        if (targetProvider === 'gemini') {
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${targetModelId}:generateContent?key=${apiKey}`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: promptForName }] }] }) }
          );
          const data = await response.json();
          name = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        }
        name = name.replace(/^["']|["']$/g, '').trim() || 'New Project';
        setProjectName(name);
      } catch {
        setProjectName('New Project');
      } finally {
        setIsGeneratingName(false);
      }
    };
    generateProjectName();
  }, [phase, initialPrompt, apiKeys, modelConfig]);

  // A Code-mode conversation remains an inbox chat until the workbench receives
  // its first real file mutation. Only then does it become a project.
  useEffect(() => {
    if (!hasUserCode || !projectName || projectRegisteredRef.current) return;
    try {
      let list = readProjectRegistry() as any[];
      if (!Array.isArray(list)) list = [];

      let finalName = projectName;
      if (list.some((p: any) => p?.name?.toLowerCase() === finalName.toLowerCase())) {
        let counter = 2;
        let candidate = `${finalName} (${counter})`;
        while (list.some((p: any) => p?.name?.toLowerCase() === candidate.toLowerCase())) {
          counter++;
          candidate = `${finalName} (${counter})`;
        }
        finalName = candidate;
        setProjectName(finalName);
      }

      const usedIds = new Set(list.map((p: any) => p?.id).filter(Boolean));
      let newId = `#${Math.floor(1000 + Math.random() * 9000)}`;
      while (usedIds.has(newId)) newId = `#${Math.floor(1000 + Math.random() * 9000)}`;
      list.push({ id: newId, name: finalName, kind: 'code' });
      writeProjectRegistry(list);
      projectRegisteredRef.current = true;
      window.dispatchEvent(new Event('willow_projects_updated'));
    } catch {}
  }, [hasUserCode, projectName]);

  // Project files reach Drive/disk only after promotion.
  const { isSaving } = useAutoSave(
    projectName || 'Untitled',
    hasUserCode && (!!accessToken || isLocalFolderConnected) && !!projectName
  );

  // ── Resize logic (from StagingView) ──────────────────────────────────────
  useEffect(() => { return () => { if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current); }; }, []);

  const setTransitionTimeout = useCallback(() => {
    if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
    transitionTimerRef.current = setTimeout(() => setIsTransitioning(false), 500);
  }, []);

  const toggleSidebar = useCallback(() => {
    setIsTransitioning(true);
    setIsStagingSidebarCollapsed(prev => { if (!prev) setLastSidebarWidth(sidebarWidth); return !prev; });
    setTransitionTimeout();
  }, [sidebarWidth, setTransitionTimeout]);

  const startResizing = useCallback(() => { setIsDragging(true); }, []);
  const stopResizing = useCallback(() => { setIsDragging(false); }, []);

  const isDraggingRef = useRef(isDragging);
  const isStagingSidebarCollapsedRef = useRef(isStagingSidebarCollapsed);
  useEffect(() => { isDraggingRef.current = isDragging; }, [isDragging]);
  useEffect(() => { isStagingSidebarCollapsedRef.current = isStagingSidebarCollapsed; }, [isStagingSidebarCollapsed]);

  const pendingWidthRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  const resize = useCallback((e: MouseEvent) => {
    if (!isDraggingRef.current) return;
    const newWidth = e.clientX;
    const totalWidth = document.body.clientWidth;
    const minWidth = totalWidth / 5;
    const maxWidth = totalWidth * 0.37;
    const collapseThreshold = minWidth * 0.5;
    if (isStagingSidebarCollapsedRef.current) {
      if (newWidth > collapseThreshold) {
        setIsTransitioning(true);
        setIsStagingSidebarCollapsed(false);
        setSidebarWidth(minWidth);
        setIsDragging(false);
        if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
        transitionTimerRef.current = setTimeout(() => setIsTransitioning(false), 500);
      }
    } else {
      if (newWidth < collapseThreshold) {
        setIsTransitioning(true);
        setIsStagingSidebarCollapsed(true);
        setIsDragging(false);
        if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
        transitionTimerRef.current = setTimeout(() => setIsTransitioning(false), 500);
        return;
      }
      let targetWidth = newWidth;
      if (newWidth < minWidth && newWidth >= collapseThreshold) targetWidth = minWidth;
      else if (newWidth > maxWidth) targetWidth = maxWidth;
      else if (newWidth < minWidth) return;
      pendingWidthRef.current = targetWidth;
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          if (pendingWidthRef.current !== null) setSidebarWidth(pendingWidthRef.current);
          rafRef.current = null;
        });
      }
    }
  }, []);

  useEffect(() => {
    if (phase !== 'active') return;
    window.addEventListener('mousemove', resize);
    window.addEventListener('mouseup', stopResizing);
    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [phase, resize, stopResizing]);

  const handleHomeClick = useCallback(() => {
    setPhase('idle');
    workbenchStore.reset();
    nameGeneratedRef.current = false;
    setProjectName('');
  }, []);

  // ── Idle prompt box: auto-expand textarea ────────────────────────────────
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = '44px';
      const scrollHeight = textareaRef.current.scrollHeight;
      if (scrollHeight > 44) {
        textareaRef.current.style.height = `${Math.min(scrollHeight, 300)}px`;
      }
    }
  }, [promptText]);

  // ── Idle prompt submission ───────────────────────────────────────────────
  const handleIdleSubmit = useCallback(() => {
    const text = promptText.trim();
    if (!text && attachments.length === 0) return;
    if (!isAuthenticated) { onAuthRequired?.(); return; }

    startTransition(() => {
      setInitialPrompt(text);
      setInitialAttachments(attachments.length > 0 ? attachments : undefined);
      setPromptText('');
      setAttachments([]);
      setIsChatMode(true);
      setPhase('active');
    });
  }, [promptText, attachments, isAuthenticated, onAuthRequired]);

  // Handle file input for attachments
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const newAttachments = Array.from(files).map(file => ({
      id: Math.random().toString(36).substring(7),
      type: file.type.startsWith('image/') ? 'image' as const : 'file' as const,
      url: URL.createObjectURL(file),
      name: file.name,
      extension: file.name.split('.').pop() || '',
      file,
    }));
    setAttachments(prev => [...prev, ...newAttachments]);
    e.target.value = '';
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  }, []);

  // ── Get user's name for heading ──────────────────────────────────────────
  // Fall back to the locally cached name while the Firestore profile loads so
  // the greeting never flashes "there" → real name; re-cache once known.
  const [cachedFirstName] = useState(getCachedFirstName);
  const profileFirstName = userProfile?.displayName?.split(' ')[0];
  const firstName = profileFirstName || cachedFirstName || 'there';
  useEffect(() => {
    if (profileFirstName) cacheFirstName(profileFirstName);
  }, [profileFirstName]);

  const containerStyle = isChatMode
    ? { width: '100%' }
    : { width: `${isStagingSidebarCollapsed ? 0 : sidebarWidth}px` };

  // ── COMBINED RENDER ────────────────────────────────────────────────────────
  return (
    <div className={`flex h-full w-full bg-[#1c1c1c] overflow-hidden text-sm relative ${phase === 'active' && isDragging ? 'cursor-[ew-resize] select-none' : ''}`}>
      
      {phase === 'idle' && (
        <>
          <div
            onScroll={handleScroll}
            className="absolute inset-0 overflow-y-auto no-scrollbar overscroll-contain snap-y snap-mandatory"
          >
          {/* ── Snap section 1: hero — layout untouched, now the first full-height section ── */}
          <div className="relative h-full snap-start snap-always overflow-hidden">
          <div className="absolute top-14 left-0 right-0 flex flex-col items-center justify-center z-10 pointer-events-none">
            <div className="pointer-events-auto flex flex-col items-center gap-1.5">
              <h2 
                className="text-[#fbfcfe] text-center select-none font-bold antialiased" 
                style={{ 
                  fontFamily: '"Plus Jakarta Sans", "Outfit", "Ginto", "ui-sans-serif", "system-ui", "sans-serif"', 
                  fontSize: '34px', 
                  lineHeight: '48px', 
                  letterSpacing: '-0.035em', 
                  fontWeight: 800 
                }}
              >
                Willow Code
              </h2>
              <p 
                className="text-[#a1a1aa] text-center font-medium antialiased select-none" 
                style={{ 
                  fontFamily: '"Plus Jakarta Sans", "Outfit", "ui-sans-serif", "system-ui", "sans-serif"', 
                  fontSize: '28px', 
                  lineHeight: '32px', 
                  letterSpacing: '-0.28px', 
                  fontWeight: 500 
                }}
              >
                Let's build some apps, {isAuthenticated ? firstName : 'there'}
              </p>

              {/* Horizontal Tabs / Pills */}
              <div className="flex items-center gap-5 mt-7 select-none">
                {CATEGORIES.map((cat) => {
                  const isActive = activeCategory === cat.id;
                  return (
                    <button
                      key={cat.id}
                      onClick={() => setActiveCategory(cat.id as any)}
                      className={`text-[13.5px] font-semibold tracking-normal transition-all duration-200 cursor-pointer h-[32px] flex items-center justify-center rounded-full
                        ${isActive 
                          ? 'bg-white/10 text-white px-5' 
                          : 'text-[#81888f] hover:text-white px-2'
                        }`}
                    >
                      {cat.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[900px] z-30 pointer-events-none">
            <div className="h-8 w-full bg-gradient-to-t from-[#1c1c1c] to-transparent pointer-events-none" />
            
            {/* Bento Grid Prompt Suggestions */}
            <div className="px-[14px] pb-[110px] pointer-events-auto animate-fadeIn duration-200 relative">
              <div className="grid gap-3.5" style={{ gridTemplateColumns: '354px 1fr 1fr' }}>
                
                {/* Column 1: Small cards + Wide card */}
                <div className="flex flex-col gap-3.5 h-[340px]">
                  {/* Row 1: Two small square cards */}
                  <div className="grid grid-cols-2 gap-3.5 h-[170px]">
                    {/* Small Card 1 */}
                    <button
                      onClick={() => {
                        setPromptText(SUGGESTIONS[activeCategory][0]);
                        if (textareaRef.current) {
                          textareaRef.current.focus();
                        }
                      }}
                      className="h-full w-full flex flex-col text-left p-3.5 rounded-[20px] bg-[#27272a]/50 hover:bg-[#27272a] border border-white/5 hover:border-white/10 group cursor-pointer shadow-md justify-between"
                      style={{ transformStyle: 'preserve-3d' }}
                      onMouseMove={handleMouseMove}
                      onMouseLeave={handleMouseLeave}
                    >
                      {getSmallCard1Image(activeCategory) ? (
                        <div className="w-full h-[96px] flex items-center justify-center relative overflow-hidden mb-1.5 flex-shrink-0">
                          <img 
                            key={activeCategory}
                            src={getSmallCard1Image(activeCategory) || undefined} 
                            alt="Small card illustration" 
                            className={`h-full object-contain opacity-90 group-hover:opacity-100 transition-opacity duration-300 ${
                              activeCategory === 'finance' ? 'scale-[0.9]' : ''
                            }`}
                          />
                        </div>
                      ) : (
                        <div className="w-9 h-9 rounded-lg bg-white/[0.03] border border-white/5 flex items-center justify-center flex-shrink-0 mb-1 group-hover:border-white/10 transition-colors relative overflow-hidden">
                          <div className="absolute inset-0 bg-gradient-to-tr from-blue-500/5 via-purple-500/5 to-pink-500/5 opacity-50 group-hover:opacity-100 transition-opacity" />
                          <span className="text-[9px] text-[#81888f] font-mono z-10 group-hover:text-white transition-colors">App</span>
                        </div>
                      )}
                      <span className="text-[12px] text-gray-300 font-semibold leading-snug group-hover:text-white transition-colors line-clamp-2">
                        {SUGGESTIONS[activeCategory][0]}
                      </span>
                    </button>

                    {/* Small Card 2 */}
                    <button
                      onClick={() => {
                        setPromptText(SUGGESTIONS[activeCategory][1]);
                        if (textareaRef.current) {
                          textareaRef.current.focus();
                        }
                      }}
                      className="h-full w-full flex flex-col text-left p-3.5 rounded-[20px] bg-[#27272a]/50 hover:bg-[#27272a] border border-white/5 hover:border-white/10 group cursor-pointer shadow-md justify-between"
                      style={{ transformStyle: 'preserve-3d' }}
                      onMouseMove={handleMouseMove}
                      onMouseLeave={handleMouseLeave}
                    >
                      {getSmallCard2Image(activeCategory) ? (
                        <div className="w-full h-[96px] flex items-center justify-center relative overflow-hidden mb-1.5 flex-shrink-0">
                          <img 
                            key={activeCategory}
                            src={getSmallCard2Image(activeCategory) || undefined} 
                            alt="Small card illustration" 
                            className={`h-full object-contain opacity-90 group-hover:opacity-100 transition-opacity duration-300 ${
                              activeCategory === 'saas'
                                ? 'scale-[0.8]'
                                : activeCategory === 'foryou' || activeCategory === 'aiapps'
                                ? 'scale-[0.9]' 
                                : ''
                            }`}
                          />
                        </div>
                      ) : (
                        <div className="w-9 h-9 rounded-lg bg-white/[0.03] border border-white/5 flex items-center justify-center flex-shrink-0 mb-1 group-hover:border-white/10 transition-colors relative overflow-hidden">
                          <div className="absolute inset-0 bg-gradient-to-tr from-blue-500/5 via-purple-500/5 to-pink-500/5 opacity-50 group-hover:opacity-100 transition-opacity" />
                          <span className="text-[9px] text-[#81888f] font-mono z-10 group-hover:text-white transition-colors">App</span>
                        </div>
                      )}
                      <span className="text-[12px] text-gray-300 font-semibold leading-snug group-hover:text-white transition-colors line-clamp-2">
                        {SUGGESTIONS[activeCategory][1]}
                      </span>
                    </button>
                  </div>

                  {/* Row 2: One wide card */}
                  <button
                    onClick={() => {
                      setPromptText(SUGGESTIONS[activeCategory][2]);
                      if (textareaRef.current) {
                        textareaRef.current.focus();
                      }
                    }}
                    className="flex flex-col p-4 rounded-[20px] bg-[#27272a]/50 hover:bg-[#27272a] border border-white/5 hover:border-white/10 group cursor-pointer shadow-md h-[156px] justify-between text-left relative overflow-hidden"
                    style={{ transformStyle: 'preserve-3d' }}
                    onMouseMove={handleMouseMove}
                    onMouseLeave={handleMouseLeave}
                  >
                    {/* Top: Large 3D Illustration aligned to the left */}
                    <div className="w-[72px] h-[72px] flex items-center justify-start relative overflow-hidden mb-1 flex-shrink-0 z-10">
                      <img 
                        key={activeCategory}
                        src={getWideCardImage(activeCategory) || undefined} 
                        alt="Wide card illustration" 
                        className={`h-full object-contain object-left opacity-90 group-hover:opacity-100 transition-opacity duration-300 ${
                          activeCategory === 'productivity' 
                            ? 'scale-[0.72] origin-left translate-x-[10px]' 
                            : ''
                        }`}
                      />
                    </div>

                    {/* Bottom: Text Info */}
                    <span className="text-[12px] text-gray-300 font-semibold leading-relaxed group-hover:text-white transition-colors line-clamp-2 z-10">
                      {SUGGESTIONS[activeCategory][2]}
                    </span>
                  </button>
                </div>

                {/* Column 2: Large vertical card */}
                <button
                  onClick={() => {
                    setPromptText(SUGGESTIONS[activeCategory][3]);
                    if (textareaRef.current) {
                      textareaRef.current.focus();
                    }
                  }}
                  className="flex flex-col text-left p-4 rounded-[20px] bg-[#27272a]/50 hover:bg-[#27272a] border border-white/5 hover:border-white/10 group cursor-pointer shadow-md h-[340px] justify-between"
                  style={{ transformStyle: 'preserve-3d' }}
                  onMouseMove={handleMouseMove}
                  onMouseLeave={handleMouseLeave}
                >
                  <div className={`w-full h-[170px] flex items-center justify-center flex-shrink-0 relative overflow-hidden ${
                    activeCategory === 'productivity' || activeCategory === 'foryou' || activeCategory === 'social' || activeCategory === 'saas' || activeCategory === 'aiapps' || activeCategory === 'finance' ? '' : 'rounded-xl bg-white/[0.02] border border-white/5 group-hover:border-white/10 transition-colors'
                  }`}>
                    {activeCategory === 'productivity' ? (
                      <img 
                        src={dashboardImg} 
                        alt="Task dashboard" 
                        className="w-full h-full object-contain object-center opacity-90 group-hover:opacity-100 transition-opacity duration-300"
                      />
                    ) : activeCategory === 'saas' ? (
                      <img 
                        src={crmImg} 
                        alt="CRM manager" 
                        className="w-full h-full object-contain object-center opacity-90 group-hover:opacity-100 transition-opacity duration-300"
                      />
                    ) : activeCategory === 'foryou' ? (
                      <img 
                        src={newspaperImg} 
                        alt="Weekly report" 
                        className="w-full h-full object-contain object-center opacity-90 group-hover:opacity-100 transition-opacity duration-300"
                      />
                    ) : activeCategory === 'social' ? (
                      <img 
                        src={bloggingImg} 
                        alt="Blogging app" 
                        className="w-full h-full object-contain object-center opacity-90 group-hover:opacity-100 transition-opacity duration-300"
                      />
                    ) : activeCategory === 'aiapps' ? (
                      <img 
                        src={aiimageImg} 
                        alt="AI Image generation" 
                        className="w-full h-full object-contain object-center opacity-90 group-hover:opacity-100 transition-opacity duration-300"
                      />
                    ) : activeCategory === 'finance' ? (
                      <img 
                        src={wealthImg} 
                        alt="Wealth and expense tracker" 
                        className="w-full h-full object-contain object-center opacity-90 group-hover:opacity-100 transition-opacity duration-300"
                      />
                    ) : (
                      <>
                        <div className="absolute inset-0 bg-gradient-to-tr from-blue-500/5 via-purple-500/5 to-pink-500/5 opacity-50 group-hover:opacity-100 transition-opacity" />
                        <span className="text-[10px] text-[#81888f] font-mono tracking-wider uppercase z-10 opacity-70 group-hover:text-white transition-colors">Image Area</span>
                      </>
                    )}
                  </div>
                  <span className="text-[13px] text-gray-300 font-semibold leading-relaxed group-hover:text-white transition-colors line-clamp-4">
                    {SUGGESTIONS[activeCategory][3]}
                  </span>
                </button>

                {/* Column 3: Large vertical card */}
                <button
                  onClick={() => {
                    setPromptText(SUGGESTIONS[activeCategory][4]);
                    if (textareaRef.current) {
                      textareaRef.current.focus();
                    }
                  }}
                  className="flex flex-col text-left p-4 rounded-[20px] bg-[#27272a]/50 hover:bg-[#27272a] border border-white/5 hover:border-white/10 group cursor-pointer shadow-md h-[340px] justify-between"
                  style={{ transformStyle: 'preserve-3d' }}
                  onMouseMove={handleMouseMove}
                  onMouseLeave={handleMouseLeave}
                >
                  <div className={`w-full h-[170px] flex items-center justify-center flex-shrink-0 relative overflow-hidden ${
                    activeCategory === 'productivity' || activeCategory === 'foryou' || activeCategory === 'saas' || activeCategory === 'social' || activeCategory === 'aiapps' || activeCategory === 'finance' ? '' : 'rounded-xl bg-white/[0.02] border border-white/5 group-hover:border-white/10 transition-colors'
                  }`}>
                    {activeCategory === 'productivity' ? (
                      <img 
                        src={gameImg} 
                        alt="Side-scrolling game" 
                        className="w-full h-full object-contain object-center opacity-90 group-hover:opacity-100 transition-opacity duration-300 scale-[1.12] group-hover:scale-[1.17]"
                      />
                    ) : activeCategory === 'foryou' ? (
                      <img 
                        src={teamworkImg} 
                        alt="Teamwork board" 
                        className="w-full h-full object-contain object-center opacity-90 group-hover:opacity-100 transition-opacity duration-300"
                      />
                    ) : activeCategory === 'saas' ? (
                      <img 
                        src={dashboardImg} 
                        alt="Task dashboard" 
                        className="w-full h-full object-contain object-center opacity-90 group-hover:opacity-100 transition-opacity duration-300"
                      />
                    ) : activeCategory === 'social' ? (
                      <img 
                        src={chatImg} 
                        alt="Chat room" 
                        className="w-full h-full object-contain object-center opacity-90 group-hover:opacity-100 transition-opacity duration-300"
                      />
                    ) : activeCategory === 'aiapps' ? (
                      <img 
                        src={aichatImg} 
                        alt="AI Chatbot console" 
                        className="w-full h-full object-contain object-center opacity-90 group-hover:opacity-100 transition-opacity duration-300"
                      />
                    ) : activeCategory === 'finance' ? (
                      <img 
                        src={cashcounterImg} 
                        alt="Cash counter invoice billing" 
                        className="w-full h-full object-contain object-center opacity-90 group-hover:opacity-100 transition-opacity duration-300"
                      />
                    ) : (
                      <>
                        <div className="absolute inset-0 bg-gradient-to-tr from-blue-500/5 via-purple-500/5 to-pink-500/5 opacity-50 group-hover:opacity-100 transition-opacity" />
                        <span className="text-[10px] text-[#81888f] font-mono tracking-wider uppercase z-10 opacity-70 group-hover:text-white transition-colors">Image Area</span>
                      </>
                    )}
                  </div>
                  <span className="text-[13px] text-gray-300 font-semibold leading-relaxed group-hover:text-white transition-colors line-clamp-4">
                    {SUGGESTIONS[activeCategory][4]}
                  </span>
                </button>

              </div>

              {/* "Your apps" pill button centered below suggestions */}
              <div 
                className="absolute bottom-[18px] left-1/2 z-20 pointer-events-none"
                style={{
                  opacity: (!promptText.trim() && attachments.length === 0) ? (1 - scrollRatio) : 0,
                  transform: `translateX(-50%) scale(${(!promptText.trim() && attachments.length === 0) ? (1 - 0.25 * scrollRatio) : 0.95})`,
                  pointerEvents: (!promptText.trim() && attachments.length === 0 && scrollRatio < 0.9) ? 'auto' : 'none',
                  transition: scrollRatio > 0 ? 'none' : 'opacity 300ms cubic-bezier(0.4, 0, 0.2, 1), transform 300ms cubic-bezier(0.4, 0, 0.2, 1)'
                }}
              >
                <button 
                  onClick={() => {
                    const bottomPanel = document.getElementById('bottom-panel');
                    if (bottomPanel) {
                      bottomPanel.scrollIntoView({ behavior: 'smooth' });
                    } else {
                      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
                    }
                  }}
                  className="flex items-center gap-2 px-5 py-2 bg-[#202023] hover:bg-[#27272a] rounded-full transition-all duration-300 group shadow-[0_8px_10px_-4px_rgba(0,0,0,0.4)] active:scale-95 cursor-pointer border-none"
                >
                  <svg 
                    width="12" 
                    height="12" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="3" 
                    strokeLinecap="round" 
                    strokeLinejoin="round" 
                    className="text-gray-400 group-hover:text-white transition-colors"
                  >
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <polyline points="19 12 12 19 5 12"></polyline>
                  </svg>
                  <span className="text-[12.5px] font-semibold text-gray-300 group-hover:text-white transition-colors tracking-wide">
                    Your apps
                  </span>
                </button>
              </div>
            </div>

            {/* Invisible image preloader to decode all assets into memory */}
            <div className="hidden absolute opacity-0 pointer-events-none w-0 h-0 overflow-hidden" aria-hidden="true">
              <img src={newspaperImg} alt="" />
              <img src={dashboardImg} alt="" />
              <img src={crmImg} alt="" />
              <img src={teamworkImg} alt="" />
              <img src={bloggingImg} alt="" />
              <img src={chatImg} alt="" />
              <img src={aichatImg} alt="" />
              <img src={aiimageImg} alt="" />
              <img src={cashcounterImg} alt="" />
              <img src={wealthImg} alt="" />
              <img src={bookmarkImg} alt="" />
              <img src={communityImg} alt="" />
              <img src={devcheatsheetImg} alt="" />
              <img src={ecommerceinventoryImg} alt="" />
              <img src={expenseImg} alt="" />
              <img src={pomodoroImg} alt="" />
              <img src={portfolioImg} alt="" />
              <img src={storyboardImg} alt="" />
              <img src={billImg} alt="" />
              <img src={cryptoImg} alt="" />
              <img src={mindmapImg} alt="" />
              <img src={presetImg} alt="" />
              <img src={themeImg} alt="" />
              <img src={votingImg} alt="" />
              <img src={weeklyImg} alt="" />
              <img src={aipenImg} alt="" />
              <img src={landingImg} alt="" />
              <img src={pricingImg} alt="" />
              <img src={gameImg} alt="" />
            </div>

            {/* Preserve the hero geometry while the shared composer is rendered
                in the persistent viewport-level host below. */}
            <div className="relative h-[136px] bg-[#1c1c1c] pointer-events-auto z-50">
              {idleComposerHost && createPortal(
                <div className="absolute bottom-0 left-0 right-0 px-[14px] pb-4 pt-0 max-w-[800px] mx-auto pointer-events-auto">
                <div className="bg-[#27272a] rounded-[26px] p-3.5 relative flex flex-col shadow-lg border border-white/5">
                  {/* Attachments Area */}
                  <div className={`grid transition-[grid-template-rows] duration-[250ms] ease-in-out ${attachments.length > 0 ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                    <div className="overflow-hidden">
                      <div className="flex gap-3 overflow-x-auto no-scrollbar pt-2 pb-3 -mx-1 px-1">
                        {renderedAttachments.map((att) => (
                          <div key={att.id} className="relative group flex-shrink-0 animate-in fade-in zoom-in-95 duration-200">
                            {att.type === 'image' ? (
                              <div className="relative">
                                <div className="w-16 h-16 rounded-2xl overflow-hidden border border-white/5 bg-[#1c1c1c]">
                                  <img src={att.url} alt={att.name} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                                </div>
                                <button onClick={() => removeAttachment(att.id)} className="absolute -top-1.5 -right-1.5 bg-[#27272a] text-gray-400 hover:text-white border border-white/10 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-all duration-200 shadow-xl z-10">
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
                                <button onClick={() => removeAttachment(att.id)} className="absolute -top-1.5 -right-1.5 bg-[#27272a] text-gray-400 hover:text-white border border-white/10 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-all duration-200 shadow-xl z-10">
                                  <X size={12} />
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Textarea */}
                  <textarea
                    ref={textareaRef}
                    placeholder="Ask Willow..."
                    onFocus={() => {
                      import('./workbench/WorkbenchSidebar');
                      import('./workbench/WorkbenchPreview');
                    }}
                    className="w-full bg-transparent text-gray-100 placeholder-gray-400 resize-none outline-none min-h-[44px] px-3 py-1.5 text-[16px] leading-relaxed font-normal overflow-y-auto text-lg"
                    style={{ scrollbarGutter: 'stable' }}
                    value={promptText}
                    onChange={(e) => setPromptText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleIdleSubmit(); }
                    }}
                    onPaste={(e) => {
                      const items = e.clipboardData?.items;
                      if (!items) return;
                      const imageFiles: File[] = [];
                      for (let i = 0; i < items.length; i++) {
                        if (items[i].type.startsWith('image/')) { const file = items[i].getAsFile(); if (file) imageFiles.push(file); }
                      }
                      if (imageFiles.length > 0) {
                        e.preventDefault();
                        const newAttachments = imageFiles.map(file => ({
                          id: Math.random().toString(36).substring(7),
                          type: 'image' as const,
                          url: URL.createObjectURL(file),
                          name: file.name || `pasted-image.${file.type.split('/')[1] || 'png'}`,
                          extension: file.name?.split('.').pop() || file.type.split('/')[1] || 'png',
                          file
                        }));
                        setAttachments(prev => [...prev, ...newAttachments]);
                      }
                    }}
                    rows={1}
                  />

                  {/* Bottom toolbar */}
                  <div className="flex items-center justify-between pt-2">
                    <div className="flex items-center gap-2">
                      <input ref={fileInputRef} type="file" multiple accept="image/*,.txt,.md,.json,.js,.ts,.tsx,.jsx,.html,.css,.py,.java,.cpp,.c,.go,.rs,.rb,.php,.swift,.kt" className="hidden" onChange={handleFileSelect} />
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="p-2.5 rounded-full bg-[#3f3f46]/60 text-gray-300 hover:bg-[#3f3f46] hover:text-white transition-all flex-shrink-0"
                      >
                        <Plus size={18} />
                      </button>
                      <div className="relative" ref={toolsMenuRef}>
                        {isToolsMenuOpen && (
                          <div 
                            style={{
                              boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.95), 0 0 40px -10px rgba(0, 0, 0, 0.8), 0 1px 0 0 rgba(255, 255, 255, 0.05) inset',
                            }}
                            className="absolute bottom-full left-0 mb-2 w-40 bg-[#1c1c1c] rounded-xl overflow-hidden z-50 settings-fade-in"
                          >
                            {TOOLS.map((tool) => (
                              <button 
                                key={tool.id}
                                onClick={() => { setSelectedToolId(tool.id); setIsToolsMenuOpen(false); }}
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
                          className={`flex items-center rounded-full transition-all text-[13px] font-medium flex-shrink-0 h-[36px]
                            ${currentTool ? 'bg-[#3b82f6]/20 text-[#3b82f6] hover:bg-[#3b82f6]/30 px-4 pr-2.5 gap-2.5' : 'bg-[#3f3f46]/60 text-gray-300 hover:bg-[#3f3f46] hover:text-white px-4 gap-2'}
                            ${isToolsMenuOpen ? 'bg-[#3f3f46] text-white' : ''}
                            cursor-pointer
                          `} 
                          title="Tools"
                        >
                          {currentTool ? (
                            <>
                              <div className="flex items-center gap-2">
                                <currentTool.icon size={16} />
                                <span>{currentTool.label}</span>
                              </div>
                              <div
                                onClick={(e) => { e.stopPropagation(); setSelectedToolId(null); }}
                                className="p-0.5 hover:bg-[#3b82f6]/30 rounded-full transition-colors cursor-pointer flex items-center justify-center"
                              >
                                <X size={12} />
                              </div>
                            </>
                          ) : (
                            <>
                              <Wrench size={16} />
                              <span className="ml-2">Tools</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="relative flex items-center shrink-0" ref={modelsMenuRef}>
                        <button
                          ref={modelsMenuRef as any}
                          onClick={() => setIsModelsMenuOpen(!isModelsMenuOpen)}
                          aria-label={`Open model picker, currently ${activeModelAndEffortLabel}`}
                          aria-expanded={isModelsMenuOpen}
                          className={`h-10 pl-4 pr-3 rounded-full flex items-center justify-center gap-2 text-[15px] leading-5 font-normal whitespace-nowrap text-[#c4c7c5] hover:text-[#e3e3e3] hover:bg-[#303134] transition-colors outline-none cursor-pointer font-['Google_Sans_Flex','Google_Sans','Helvetica_Neue',sans-serif] ${isModelsMenuOpen ? 'bg-[#303134] text-[#e3e3e3]' : ''}`}
                          style={{ fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 92, "wght" 400' }}
                        >
                          <span className="-mr-1 flex min-w-0 items-center">
                            <span className="text-[#e6e6e6]">{activeModelDisplayLabel}</span>
                            {activeEffortDisplayLabel && (
                              <span className="ml-1 text-white/55">{activeEffortDisplayLabel}</span>
                            )}
                          </span>
                          <MaterialSymbol
                            family="luminous"
                            name="keyboard_arrow_down"
                            size={24}
                            weight={300}
                            roundness={100}
                            opticalSize={24}
                            className={`transition-transform duration-200 ${isModelsMenuOpen ? 'rotate-180' : ''}`}
                          />
                        </button>
                        {isModelsMenuOpen && (
                          <ModelsMenu
                            triggerRef={modelsMenuRef as any}
                            onClose={() => setIsModelsMenuOpen(false)}
                            modelConfig={modelConfig}
                            selectedId={selectedModelId}
                            onSelect={(id) => {
                              setSelectedModelId(id);
                              const sel = ALL_MODELS.find(m => m.id === id);
                              if (sel) {
                                const providerKey = sel.provider === 'Google' ? 'gemini'
                                  : sel.provider === 'OpenAI' ? 'openai'
                                  : sel.provider === 'Anthropic' ? 'anthropic'
                                  : sel.provider === 'Moonshot AI' ? 'moonshot'
                                  : sel.provider === 'SpaceXAI' ? 'spacexai' : 'zhipuai';
                                setModelConfig((prev: any) => ({
                                  ...prev,
                                  [providerKey]: { ...prev[providerKey], model: sel.modelId, thinkingLevel: sel.thinkingLevel }
                                }));
                              }
                            }}
                            onAuthRequired={onAuthRequired}
                            geminiStyle
                          />
                        )}
                      </div>
                      <button
                        onClick={handleIdleSubmit}
                        disabled={!promptText.trim() && attachments.length === 0}
                        className={`w-[38px] h-[38px] rounded-full flex items-center justify-center transition-all duration-200 flex-shrink-0 ${
                          promptText.trim() || attachments.length > 0
                            ? 'bg-white text-black hover:bg-gray-200 cursor-pointer'
                            : 'bg-[#3f3f46] text-gray-500 cursor-not-allowed'
                        }`}
                      >
                        <ArrowUp size={18} strokeWidth={2.5} />
                      </button>
                    </div>
                  </div>
                </div>
                </div>,
                idleComposerHost
              )}
            </div>
          </div>
          </div>

          {/* ── Snap section 2: saved projects ("Your apps") — scroll down to reach ── */}
          <div id="bottom-panel" className="relative h-full snap-start snap-always bg-[#1c1c1c]">
            <div
              className="absolute inset-0 overflow-y-auto no-scrollbar flex flex-col pt-10 pb-[176px]"
            >
              <div className="my-auto w-full">
                {codeProjectCount > 0 ? (
                  <BottomPanel
                    mode="develop"
                    showAll
                    forceVisible
                    onOpenDriveSettings={() => onSettingsClick?.('connectors')}
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center gap-2 text-center px-8">
                    <p className="text-[16px] font-semibold text-gray-300">No apps yet</p>
                    <p className="text-[13px] text-[#71717a] max-w-[360px]">
                      Apps you build with Willow Code are saved here automatically. Head back up and create your first one.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
          </div>
          <div
            ref={setIdleComposerHost}
            className="absolute inset-x-0 bottom-0 h-[136px] z-[60] pointer-events-none"
          />
        </>
      )}

      {/* ── ACTIVE PHASE (Always wrapped in mounted Suspense) ───────────────── */}
      <React.Suspense fallback={<div className="h-full w-full bg-[#1c1c1c]" />}>
        {phase === 'active' && (
          <>
            {/* Chat Mode Header — only shown when centered/chat mode */}
            {isChatMode && (
              <div className="absolute top-0 left-0 right-0 h-14 flex items-center justify-between z-30 bg-[#1c1c1c]">
                <div className="flex items-center min-w-0 h-full" style={{ paddingLeft: '21px' }}>
                  <button
                    onClick={handleHomeClick}
                    className="flex items-center justify-center p-1.5 hover:bg-white/5 transition-colors rounded-xl flex-shrink-0"
                    title="Back to Dashboard"
                  >
                    <img src={logoG} alt="Logo" className="h-[24px] w-auto flex-shrink-0" />
                  </button>
                  <div className="flex-shrink-0 w-[1px]" />
                  <div className="flex items-center gap-2 cursor-pointer hover:bg-white/5 px-2 py-1.5 rounded-xl transition-colors min-w-0" title="Project Settings">
                    {isGeneratingName ? (
                      <MessageLoading className="scale-75" />
                    ) : (
                      <span className="font-semibold text-gray-200 truncate">{projectName || 'New Project'}</span>
                    )}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500">
                      <path d="m6 9 6 6 6-6"/>
                    </svg>
                  </div>
                </div>
              </div>
            )}

            {/* Left Panel — StagingSidebar container */}
            <div
              style={{
                ...containerStyle,
                willChange: isDragging ? 'width' : 'auto',
                ...(!isDragging && {
                  transitionProperty: 'width',
                  transitionDuration: '500ms',
                  transitionTimingFunction: 'cubic-bezier(0.32, 0.72, 0, 1)',
                }),
              }}
              className="flex-shrink-0 overflow-hidden relative z-10 bg-[#1c1c1c]"
            >
              <div
                className="h-full"
                style={{
                  position: 'relative',
                  left: isChatMode ? '50%' : '0',
                  transform: isChatMode ? 'translateX(-50%)' : 'translateX(0)',
                  width: isChatMode ? '800px' : '100%',
                  ...(!isDragging && {
                    transitionProperty: isChatMode ? 'left, transform, width' : 'width',
                    transitionDuration: '500ms',
                    transitionTimingFunction: 'cubic-bezier(0.32, 0.72, 0, 1)',
                  }),
                }}
              >
                <StagingSidebar
                  width={isChatMode ? 800 : sidebarWidth}
                  isCollapsed={isStagingSidebarCollapsed}
                  onToggle={toggleSidebar}
                  prompt={initialPrompt}
                  initialAttachments={initialAttachments}
                  activeTab={activeTab}
                  onTabChange={setActiveTab}
                  isChatMode={isChatMode}
                  onHomeClick={handleHomeClick}
                  modelConfig={modelConfig}
                  setModelConfig={setModelConfig}
                  selectedModelId={selectedModelId}
                  setSelectedModelId={setSelectedModelId}
                  isResizing={isDragging}
                  projectName={projectName}
                  isProjectPromoted={hasUserCode}
                  isGeneratingName={isGeneratingName}
                  onSettingsClick={onSettingsClick}
                />
              </div>
            </div>

            {/* Resizer Handle — hidden in chat mode */}
            <div
              className={`w-0 relative z-50 group flex-shrink-0 transition-opacity duration-300 ${isChatMode ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
              onMouseDown={startResizing}
            >
              <div
                className={`absolute w-[2px] left-0 rounded-full ${isDragging ? '' : 'transition-opacity duration-300 ease-in-out'}
                  bg-gradient-to-b from-transparent via-[#3b82f6] to-transparent
                  ${isDragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                style={{
                  top: '56px',
                  bottom: '16px',
                  transform: isStagingSidebarCollapsed ? 'translate3d(15px, 0, 0)' : 'translate3d(-1px, 0, 0)',
                  willChange: 'transform',
                  maskImage: 'linear-gradient(to bottom, transparent, black 128px, black calc(100% - 128px), transparent)',
                  WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 128px, black calc(100% - 128px), transparent)',
                }}
              />
              <div className={`absolute top-14 bottom-4 -left-1 bg-transparent cursor-[ew-resize] hover:bg-transparent ${isStagingSidebarCollapsed ? '-right-4' : '-right-1'}`} />
            </div>

            {/* Right Panel — MainPreview, slides in from right */}
            <div
              className={`flex-1 min-w-0 bg-[#1c1c1c] ${isChatMode ? 'opacity-0 translate-x-[100px] pointer-events-none' : 'opacity-100 translate-x-0'}`}
              style={{
                ...(!isDragging && {
                  transitionProperty: 'opacity, transform',
                  transitionDuration: '500ms',
                  transitionTimingFunction: 'cubic-bezier(0.32, 0.72, 0, 1)',
                }),
              }}
            >
              {(!isChatMode && !isMorphing) ? (
                <React.Suspense fallback={<div className="h-full w-full bg-[#1c1c1c]" />}>
                  <MainPreview
                    isSidebarCollapsed={isStagingSidebarCollapsed}
                    onToggleSidebar={toggleSidebar}
                    activeTab={activeTab}
                    onTabChange={setActiveTab}
                    onSettingsClick={onSettingsClick}
                    isResizing={isDragging}
                    isTransitioning={isTransitioning}
                    selectedModelId={selectedModelId}
                    modelConfig={modelConfig}
                    projectName={projectName}
                  />
                </React.Suspense>
              ) : (
                <div className="h-full w-full bg-[#1c1c1c]" />
              )}
            </div>
          </>
        )}
      </React.Suspense>
    </div>
  );
};

export default CodeWorkspace;
