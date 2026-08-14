import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUp,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Workflow,
} from 'lucide-react';
import { AgentIcon } from '@willow/ui/AgentIcon';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { useAuth } from '@willow/auth/AuthContext';
import { useUserDataContext } from '@willow/auth/UserDataContext';
import {
  getAgentBuilderClient,
  type WorkflowSummary,
} from './agent-builder';
import {
  currentWorkflow,
  requestedWorkflowId,
  workflowList,
} from './agent-builder-store';
import { NEW_WORKFLOW } from './use-agent-builder-backend';

const AgentBuilderContent = React.lazy(() =>
  import('./AgentBuilder').then((module) => ({ default: module.AgentBuilderContent })),
);

type AgentsSurface = 'home' | 'builder';

interface AgentsWorkspaceProps {
  isSidebarCollapsed?: boolean;
  onClose?: () => void;
}

function formatUpdatedAt(value: string): string {
  const updatedAt = new Date(value);
  if (Number.isNaN(updatedAt.getTime())) return 'Recently updated';

  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startOfUpdatedDay = new Date(
    updatedAt.getFullYear(),
    updatedAt.getMonth(),
    updatedAt.getDate(),
  ).getTime();
  const daysAgo = Math.round((startOfToday - startOfUpdatedDay) / 86_400_000);

  if (daysAgo === 0) return 'Updated today';
  if (daysAgo === 1) return 'Updated yesterday';
  if (daysAgo > 1 && daysAgo < 7) return `Updated ${daysAgo} days ago`;

  return `Updated ${new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: updatedAt.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  }).format(updatedAt)}`;
}

const AGENT_ICON_BG: Record<string, string> = {
  yellow: '#fddd41', // Original creamy warm yellow
  blue: '#a8c7fa',   // Creamy soft pastel blue
  green: '#9ce4b3',  // Creamy soft pastel mint green
  pink: '#fab2cd',   // Creamy soft pastel pink
  orange: '#ffca8a', // Creamy soft pastel peach orange
};

export const getAgentIconBg = (color?: string): string => {
  if (color && color in AGENT_ICON_BG) {
    return AGENT_ICON_BG[color];
  }
  return AGENT_ICON_BG.yellow;
};

const AgentCard: React.FC<{
  workflow: WorkflowSummary;
  workspaceColor?: string;
  onOpen: (id: string) => void;
}> = ({ workflow, workspaceColor, onOpen }) => {
  const { userProfile } = useAuth();
  const effectiveWorkspaceColor = workspaceColor || userProfile?.workspaceColor || 'green';
  const iconBg = getAgentIconBg(effectiveWorkspaceColor);

  return (
    <button
      type="button"
      onClick={() => onOpen(workflow.id)}
      className="group flex h-[150px] min-w-0 flex-col items-start justify-between rounded-[18px] bg-[#27272a]/50 hover:bg-[#27272a] p-5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 shadow-sm"
      data-testid={`agent-card-${workflow.id}`}
    >
      <div className="flex min-w-0 items-start justify-between gap-3 w-full">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] text-black transition-colors duration-200"
          style={{ backgroundColor: iconBg, willChange: 'transform' }}
        >
          <AgentIcon size={18} className="text-black block" />
        </div>
        <div className="flex items-center justify-center h-8 w-8 rounded-full bg-white/[0.02] opacity-0 group-hover:opacity-100 transition-opacity border border-white/5">
          <ArrowRight
            size={14}
            className="text-[#a1a1aa] transition-all group-hover:text-white"
          />
        </div>
      </div>

      <div className="w-full min-w-0">
        <div className="truncate text-[14.5px] font-semibold text-[#fbfcfe] tracking-tight">
          {workflow.name || 'Untitled agent'}
        </div>
        <div className="mt-1 flex min-w-0 items-center justify-between gap-2 text-[12px] font-medium text-[#a1a1aa] w-full">
          <span className="truncate">{formatUpdatedAt(workflow.updatedAt)}</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
            }}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[#a1a1aa] hover:bg-white/10 hover:text-white transition-colors"
            aria-label="Agent options"
          >
            <MoreHorizontal size={14} />
          </button>
        </div>
      </div>
    </button>
  );
};

const LoadingCard: React.FC = () => (
  <div
    className="h-[150px] animate-pulse bg-[#27272a]/30 p-5 flex flex-col justify-between rounded-[18px]"
    aria-hidden="true"
  >
    <div className="h-8 w-8 rounded-[10px] bg-white/5" />
    <div className="w-full">
      <div className="mt-3 h-4 w-3/4 rounded-md bg-white/5" />
      <div className="mt-2 h-3 w-1/2 rounded-md bg-white/5" />
    </div>
    <div className="mt-4 flex justify-between">
      <div className="h-3 w-1/3 rounded-md bg-white/5" />
      <div className="h-4 w-1/4 rounded-full bg-white/5" />
    </div>
  </div>
);

const AGENT_CATEGORIES = [
  { id: 'agents', label: 'Agents' },
  { id: 'drafts', label: 'Drafts' },
  { id: 'templates', label: 'Templates' }
] as const;

const STARTER_TEMPLATES = [
  {
    id: 'template-file-search',
    name: 'File Search Assistant',
    description: 'Extracts document text and performs fast semantic vector queries.',
    nodeCount: 4,
  },
  {
    id: 'template-code-reviewer',
    name: 'Code Reviewer',
    description: 'Automates code analysis, lint checks, and security scanning.',
    nodeCount: 5,
  },
  {
    id: 'template-web-scraper',
    name: 'Web Content Extractor',
    description: 'Scrapes web pages and converts raw HTML into structured JSON.',
    nodeCount: 3,
  },
  {
    id: 'template-support-bot',
    name: 'Customer Support Bot',
    description: 'Handles incoming user inquiries, FAQs, and ticket categorization.',
    nodeCount: 6,
  },
];

const TemplateCard: React.FC<{
  template: { id: string; name: string; description: string; nodeCount: number };
  workspaceColor?: string;
  onSelect: () => void;
}> = ({ template, workspaceColor, onSelect }) => {
  const { userProfile } = useAuth();
  const effectiveWorkspaceColor = workspaceColor || userProfile?.workspaceColor || 'green';
  const iconBg = getAgentIconBg(effectiveWorkspaceColor);

  return (
    <button
      type="button"
      onClick={onSelect}
      className="group flex h-[150px] min-w-0 flex-col items-start justify-between rounded-[18px] bg-[#27272a]/50 hover:bg-[#27272a] p-5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 shadow-sm"
    >
      <div className="flex min-w-0 items-start justify-between gap-3 w-full">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] text-black transition-colors duration-200"
          style={{ backgroundColor: iconBg, willChange: 'transform' }}
        >
          <AgentIcon size={18} className="text-black block" />
        </div>
        <div className="flex items-center justify-center h-8 w-8 rounded-full bg-white/[0.02] opacity-0 group-hover:opacity-100 transition-opacity border border-white/5">
          <ArrowRight size={14} className="text-[#a1a1aa] transition-all group-hover:text-white" />
        </div>
      </div>

      <div className="w-full min-w-0">
        <div className="truncate text-[14.5px] font-semibold text-[#fbfcfe] tracking-tight">
          {template.name}
        </div>
        <div className="mt-1 flex min-w-0 items-center justify-between gap-2 text-[12px] font-medium text-[#a1a1aa] w-full">
          <span className="truncate">{template.description}</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
            }}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[#a1a1aa] hover:bg-white/10 hover:text-white transition-colors"
            aria-label="Template options"
          >
            <MoreHorizontal size={14} />
          </button>
        </div>
      </div>
    </button>
  );
};

const AGENTS_HOME_GLOW: Record<string, string> = {
  green: 'rgb(6, 78, 59)',
  blue: 'rgb(20, 32, 79)',
  pink: 'rgb(76, 9, 35)',
  yellow: 'rgb(66, 54, 0)',
  orange: 'rgb(72, 34, 0)',
};

const getAgentSubmitColorClass = (color?: string) => {
  switch (color) {
    case 'blue':
      return 'bg-[#1b3f95] hover:bg-[#153277]';
    case 'pink':
      return 'bg-[#8c064b] hover:bg-[#70053c]';
    case 'yellow':
      return 'bg-[#7c6100] hover:bg-[#634e00]';
    case 'orange':
      return 'bg-[#863e00] hover:bg-[#6b3200]';
    case 'green':
    default:
      return 'bg-[#127352] hover:bg-[#0d5c41]';
  }
};

function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  useEffect(() => {
    ref.current = value;
  });
  return ref.current;
}

const AgentsHome: React.FC<{
  workflows: WorkflowSummary[];
  prompt: string;
  loading: boolean;
  error: string | null;
  onPromptChange: (value: string) => void;
  onCreate: () => void;
  onOpen: (id: string) => void;
  onRetry: () => void;
}> = ({ workflows, prompt, loading, error, onPromptChange, onCreate, onOpen, onRetry }) => {
  const { userProfile } = useAuth();
  const effectiveWorkspaceColor = userProfile?.workspaceColor || 'green';
  const glowAccent = AGENTS_HOME_GLOW[effectiveWorkspaceColor] || AGENTS_HOME_GLOW.green;

  const hasContent = Boolean(prompt.trim());
  const previousHasContent = usePrevious(hasContent);
  const [isSubmitControlContentGated, setIsSubmitControlContentGated] = useState(false);

  useEffect(() => {
    if (hasContent && !previousHasContent) {
      setIsSubmitControlContentGated(true);
    } else if (!hasContent) {
      setIsSubmitControlContentGated(false);
    }
  }, [hasContent, previousHasContent]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [activeCategory, setActiveCategory] = useState<'agents' | 'drafts' | 'templates'>('agents');

  const filteredWorkflows = activeCategory === 'agents'
    ? workflows.filter((w) => w.latestVersion > 0)
    : activeCategory === 'drafts'
    ? workflows.filter((w) => !w.latestVersion || w.latestVersion === 0)
    : [];

  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = '42px';
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
  }, [prompt]);

  return (
    <div className="h-full w-full overflow-y-auto bg-[#0f0f0f] text-white no-scrollbar" data-testid="agents-home">
      <div className="mx-auto flex min-h-full w-full max-w-[1080px] flex-col px-6 pb-20 pt-16 sm:px-10 lg:px-12 relative">
        <header className="flex flex-col items-center text-center relative z-10 select-none">
          <h1 
            className="text-[34px] font-bold text-[#ffffff] antialiased drop-shadow-sm select-none"
            style={{ 
              fontFamily: '"Plus Jakarta Sans", "Outfit", "Ginto", "ui-sans-serif", "system-ui", "sans-serif"', 
              lineHeight: '40px', 
              letterSpacing: '-0.035em'
            }}
          >
            Agents
          </h1>
          <p 
            className="mt-2 text-[16px] text-[#a1a1aa] font-medium antialiased select-none"
            style={{ 
              fontFamily: '"Plus Jakarta Sans", "Outfit", "ui-sans-serif", "system-ui", "sans-serif"', 
            }}
          >
            What should your next agent do?
          </p>
        </header>

        <div className="mx-auto mt-8 w-full max-w-[760px] relative z-10">
          {/* Glowing aura matching New Chat / Spark with dynamic workspace color */}
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-[792px] h-[160px] rounded-full pointer-events-none blur-[100px] -z-10"
            style={{
              background: glowAccent,
              animation: 'spark-home-glow-grow 1s cubic-bezier(0.2, 0, 0, 1) both',
            }}
          />

          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (prompt.trim() && !loading) onCreate();
            }}
          >
            <div className="rounded-[20px] bg-[#1e1f21] p-2.5 shadow-2xl backdrop-blur-xl transition-all duration-300">
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(event) => onPromptChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    if (prompt.trim() && !loading) onCreate();
                  }
                }}
                aria-label="Describe an agent you want to build"
                placeholder="Describe an agent you want to build..."
                rows={1}
                className="block min-h-[42px] max-h-[150px] w-full resize-none overflow-y-auto bg-transparent px-3 py-1.5 text-[14.5px] leading-relaxed tracking-normal text-[#fbfcfe] outline-none placeholder:text-[#71717a] font-medium"
                data-testid="agents-prompt"
                style={{ fontFamily: '"Plus Jakarta Sans", "Outfit", "ui-sans-serif", "system-ui", "sans-serif"' }}
              />
              <div className="mt-1 flex h-8 items-center justify-end pr-1 gap-2">
                <button
                  type="button"
                  aria-label="Microphone"
                  title="Microphone"
                  className="relative outline-none flex items-center justify-center w-8 h-8 rounded-full cursor-pointer transition-all duration-200 text-[#e6e6e6] hover:bg-white/[0.08]"
                >
                  <MaterialSymbol
                    family="luminous"
                    name="mic"
                    size={24}
                    weight={300}
                    roundness={100}
                    opticalSize={24}
                  />
                </button>
                {hasContent && (
                  <button
                    type="submit"
                    aria-label="Send agent prompt"
                    title="Submit"
                    disabled={loading}
                    className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-[background-color] duration-200 shadow-sm outline-none cursor-pointer text-white ${getAgentSubmitColorClass(effectiveWorkspaceColor)} ${isSubmitControlContentGated ? 'willow-composer-send-enter' : ''}`}
                  >
                    <MaterialSymbol
                      family="luminous"
                      name="arrow_upward"
                      size={24}
                      weight={300}
                      roundness={100}
                      opticalSize={24}
                      className="text-white"
                    />
                  </button>
                )}
              </div>
            </div>
          </form>
        </div>

        <section className="mt-16 w-full max-w-[1080px] mx-auto relative z-10">
          <div className="mb-6 flex items-center justify-between gap-4 relative">
            <div className="flex-1"></div>
            <div className="flex items-center select-none shrink-0" role="tablist">
              {AGENT_CATEGORIES.map((cat) => {
                const isActive = activeCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setActiveCategory(cat.id as any)}
                    className={`text-[13.5px] font-semibold tracking-normal transition-all duration-200 cursor-pointer h-[32px] w-[90px] flex items-center justify-center rounded-full
                      ${isActive 
                        ? 'bg-white/10 text-white' 
                        : 'text-[#81888f] hover:text-white'
                      }`}
                  >
                    {cat.label}
                  </button>
                );
              })}
            </div>
            <div className="flex-1 flex justify-end">
              {error && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="flex h-9 items-center gap-2 rounded-lg bg-white/5 px-3 text-[12.5px] font-medium text-[#a1a1aa] transition-colors hover:bg-white/10 hover:text-white border border-white/5"
                >
                  <RefreshCw size={14} />
                  Retry
                </button>
              )}
            </div>
          </div>

          {error && (
            <div className="mb-6 flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-[13px] font-medium text-red-200" role="status">
              <span>{error}</span>
            </div>
          )}

          {!loading && !error && activeCategory !== 'templates' && filteredWorkflows.length === 0 ? (
            <div className="mt-8 flex flex-col items-center justify-center text-center py-10">
              <img 
                src="/sculpting.svg" 
                alt="Sculpting your agent workflow" 
                className="w-[260px] h-auto max-w-full opacity-80 mb-6 grayscale contrast-125"
              />
              <h3 className="text-[18px] font-semibold text-[#fbfcfe] tracking-tight">
                {activeCategory === 'agents' ? 'No published agents yet' : 'No draft agents in progress'}
              </h3>
              <p className="mt-2 text-[13.5px] text-[#71717a] max-w-md font-medium leading-relaxed">
                {activeCategory === 'agents'
                  ? "You haven't published any agents to production yet. Build a draft and publish it when it's ready."
                  : "You don't have any saved drafts right now. Start sculpting a new agent workflow to experiment with nodes and logic."}
              </p>
              <button
                type="button"
                onClick={onCreate}
                className="mt-6 flex h-[32px] items-center gap-1.5 rounded-full bg-white text-black px-4 text-[12px] font-semibold whitespace-nowrap hover:bg-zinc-200 transition-all shadow-md hover:scale-105 active:scale-95 cursor-pointer"
              >
                <Plus size={14} strokeWidth={2.5} />
                {activeCategory === 'drafts' ? 'Start new draft' : 'Create agent'}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {activeCategory !== 'templates' && (
                <button
                  type="button"
                  onClick={onCreate}
                  className="group flex h-[150px] flex-col items-start justify-between rounded-[18px] border border-dashed border-white/15 bg-transparent p-5 text-left transition-colors hover:border-white/30 hover:bg-white/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                  data-testid="create-agent"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-white/5 text-[#a1a1aa] transition-colors group-hover:bg-white/10 group-hover:text-white border border-white/5 group-hover:border-white/10">
                    <Plus size={20} strokeWidth={2.5} />
                  </div>
                  <div>
                    <div className="text-[14.5px] font-semibold text-[#fbfcfe] tracking-tight">New agent</div>
                    <div className="mt-1 text-[12px] text-[#a1a1aa] font-medium">Start with a blank workflow</div>
                  </div>
                </button>
              )}

              {activeCategory === 'templates'
                ? STARTER_TEMPLATES.map((tmpl) => (
                    <TemplateCard key={tmpl.id} template={tmpl} onSelect={onCreate} />
                  ))
                : loading && workflows.length === 0
                ? Array.from({ length: 2 }, (_, index) => <LoadingCard key={index} />)
                : filteredWorkflows.map((workflow) => (
                    <AgentCard key={workflow.id} workflow={workflow} onOpen={onOpen} />
                  ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export const AgentsWorkspace: React.FC<AgentsWorkspaceProps> = ({ isSidebarCollapsed }) => {
  const { apiKeys } = useUserDataContext();
  const [surface, setSurface] = useState<AgentsSurface>('home');
  const [prompt, setPrompt] = useState('');
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const pendingBuilderRequestRef = useRef<string | null>(null);

  const clearPendingBuilderRequest = useCallback(() => {
    const pendingRequest = pendingBuilderRequestRef.current;
    if (pendingRequest && requestedWorkflowId.get() === pendingRequest) {
      requestedWorkflowId.set(null);
    }
    pendingBuilderRequestRef.current = null;
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      clearPendingBuilderRequest();
    };
  }, [clearPendingBuilderRequest]);

  const loadWorkflows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getAgentBuilderClient(apiKeys).listWorkflows();
      if (!isMountedRef.current) return;
      const nextWorkflows = [...response.workflows].sort(
        (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
      );
      setWorkflows(nextWorkflows);
      workflowList.set(nextWorkflows.map((workflow) => ({
        id: workflow.id,
        name: workflow.name,
        nodeCount: workflow.nodeCount,
        latestVersion: workflow.latestVersion,
        updatedAt: workflow.updatedAt,
      })));
    } catch {
      if (!isMountedRef.current) return;
      setError('Saved agents could not be loaded.');
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [apiKeys]);

  useEffect(() => {
    if (surface === 'home') void loadWorkflows();
  }, [loadWorkflows, surface]);

  const createAgent = useCallback(() => {
    currentWorkflow.set(null);
    pendingBuilderRequestRef.current = NEW_WORKFLOW;
    requestedWorkflowId.set(NEW_WORKFLOW);
    setSurface('builder');
  }, []);

  const openAgent = useCallback((workflowId: string) => {
    pendingBuilderRequestRef.current = workflowId;
    requestedWorkflowId.set(workflowId);
    setSurface('builder');
  }, []);

  const showAgentsHome = useCallback(() => {
    clearPendingBuilderRequest();
    setSurface('home');
  }, [clearPendingBuilderRequest]);

  if (surface === 'builder') {
    return (
      <React.Suspense
        fallback={(
          <div className="flex h-full w-full items-center justify-center bg-[#0f0f0f] text-[12px] text-[#77777f]">
            Loading agent builder...
          </div>
        )}
      >
        <AgentBuilderContent
          isSidebarCollapsed={isSidebarCollapsed}
          onClose={showAgentsHome}
        />
      </React.Suspense>
    );
  }

  return (
    <AgentsHome
      workflows={workflows}
      prompt={prompt}
      loading={loading}
      error={error}
      onPromptChange={setPrompt}
      onCreate={createAgent}
      onOpen={openAgent}
      onRetry={() => void loadWorkflows()}
    />
  );
};

export default AgentsWorkspace;
