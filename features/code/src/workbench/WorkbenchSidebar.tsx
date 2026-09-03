
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { flushSync, createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  ChevronDown,
  ChevronRight,
  Clock,
  PanelLeftClose,
  Lightbulb,
  Plus,
  ThumbsUp,
  ThumbsDown,
  Copy,
  Pencil,
  Trash2,
  AudioLines,
  ArrowUp,
  ArrowLeft,
  Check,
  Wrench,
  Palette,
  Image as ImageIcon,
  FlaskConical,
  Target,
  X,
  Globe,
  Terminal,
  Loader2,
  CornerUpLeft,
  Scan,
  Type,
  CornerLeftUp,
  Library,
  Layout,
  Component,
  FileText
} from 'lucide-react';
import { AgentIcon } from '@willow/ui/AgentIcon';
import {
  enterVisualEdit,
  exitVisualEdit,
  isVisualEditMode,
  selectedElement,
  selectedElements,
  type SelectedElement,
  hoveredElement,
  visualEditQueue,
  canUndo,
  undoLastVisualEdit,
  selectParentElement,
  setSelectedElements,
  navigateToCode,
  isAtRootLevel,
  hasUnsavedChanges,
  discardVisualChanges,
} from '../visual-editing/engine/index';
import { useStore } from '@nanostores/react';
import { TextShimmer } from '@willow/ui/text-shimmer';
import { MessageLoading } from '@willow/ui/message-loading';
import { ModelsMenu } from '@willow/ui/models/ModelsMenu';
import { getThinkingEffortLabel, isNonThinkingEffort } from '@willow/ai/models/efforts';
import { apiKeysForBinding, resolveProviderBinding } from '@willow/ai/providers/profiles';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
// Chat mode's renderer, used verbatim so the two tabs format identically:
// headings, bold/italic/strike, tables, lists, blockquotes, links, inline and
// fenced code, math. It also owns the word reveal, so Code no longer reproduces
// that separately -- the animation now IS Chat's rather than a copy of it.
import { StreamingMarkdown } from '@willow/ui/StreamingMarkdown';
import logoG from '@willow/assets/brand/logo-glyph.png';
import { ALL_TOOLS } from './WorkbenchTopBar';
import '@willow/studio/settings/SettingsModal.css';
import { useUserDataContext } from '@willow/auth/UserDataContext';
import { streamChat, ChatMessage as AiChatMessage, prewarmClient, isAbortError } from '@willow/ai/chat';
import { runComputerUseTest, type TestUpdate, type ConversationMessage } from '@willow/ai/computer-use/session';
import { sandpackStore } from '../runtime/sandpack/sandpack-store';
import { workbenchStore, parseAIResponse, parseResponseForDisplay, type ChatSegment } from '../runtime/sandpack/index';
import { saveCodeSessions, loadCodeSessions, renameCodeSessions } from '@willow/storage/indexeddb/willow-db';
import { BOLT_SYSTEM_PROMPT } from '../runtime/sandpack/system-prompt';
import { testStore } from '@willow/ai/computer-use/test-store';
import { VisualEditMenu } from './visual-edit-menu';
import { UnsavedChangesBar } from './UnsavedChangesBar';
import { UnsavedChangesModal } from './UnsavedChangesModal';
import { workflowList as agentWorkflowList, requestedWorkflowId, backendStatus as abBackendStatus } from '@willow/agent-builder/agent-builder-store';
import { newChatSignal } from '@willow/core/new-chat-signal';
import { deriveFallbackTitle, FALLBACK_CHAT_TITLE } from '@willow/core/fallback-title';
import { addDesignNode, focusDesignNode, selectedDesignNodeIds, designNodesStore } from '@willow/design/design-store';
import { useLocalFS } from '@willow/storage/local-fs/LocalFSContext';
import { useDrive } from '@willow/storage/adapters/use-drive';
import { markCodeChat, renameCodeChat, unmarkCodeChat } from '@willow/storage/code-chat-storage';

// ── The Agent tool ───────────────────────────────────────────────────────
// An optional second generation path: the vendored Codex harness, reached by
// selecting "Agent" in the Tools menu. Everything below is inert while
// `agentEngaged` is false — the legacy loop above is untouched and still runs
// every turn by default. See features/code/src/agent/harness/AGENTS.md.
import { runCodexTurn, type WorkbenchFiles } from '../agent/harness-bridge';
import {
  agentEngaged,
  collaborationMode,
  dismissUserInput,
  effectiveEffort,
  goalIsRunning,
  nextTurnId,
  requestUserInputSink,
  setAgentEngaged,
  setCollaborationMode,
  setThreadGoal,
  setUltraEngaged,
  threadGoal,
  turnCalls,
  ultraEngaged,
} from '../agent/agent-store';
import type { Message } from '../agent/harness/runtime/protocol';
import { LiveTurnActivity, SettledTurnActivity } from '../agent/ui/TurnActivity';
import {
  expandCommand,
  matchCommandSubmission,
  matchSlashCommands,
  type SlashCommand,
} from '../agent/slash-commands';
import { EFFORT_LABEL } from '../agent/harness/overlay/effort';
import { enabledSkills } from '@willow/core/skill-library';
import { boundMcpTools, connectEnabledMcpServers } from '@willow/ai/mcp/mcp-store';
// Every rule in here is scoped under `.cb-root`, which only the harness's own
// components render — so importing it unconditionally changes nothing when the
// Agent tool is off.
import '../agent/agent.css';


import { GeminiLogo, AnnotateIcon, VisualEditsIcon } from './sidebar-icons';
import { CollapsibleFileIndicator, CollapsibleTestIndicator } from './collapsible-indicators';
import { stripCodeAndIndicators } from './message-text';
import { DESIGN_SYSTEM_PROMPT, extractDesignCode, generateDesignFileName } from './design-generation';
import { buildFollowUpSuggestionsPrompt, buildSessionTitlePrompt } from './sidebar-prompts';
import { GlobalErrorToasts } from './GlobalErrorToasts';
import { MAX_IMAGE_SIZE_BYTES, fileToBase64, getUniqueImagePath, readFileText } from './attachment-files';
import { collectSavedModels, getShortName } from './model-labels';

interface SidebarProps {
  width: number;
  isCollapsed: boolean;
  onToggle: () => void;
  prompt?: string;
  initialAttachments?: any[];
  activeTab: string;
  onTabChange: (id: string) => void;
  isChatMode?: boolean;
  onHomeClick?: () => void;
  modelConfig: any;
  setModelConfig: React.Dispatch<React.SetStateAction<any>>;
  selectedModelId: string;
  setSelectedModelId: (id: string) => void;
  isResizing?: boolean;
  projectName?: string;
  isProjectPromoted?: boolean;
  isGeneratingName?: boolean;
  onSettingsClick?: (tab?: string) => void;
  onProjectHydrated?: () => void;
}


/**
 * The empty slash-command result, hoisted so its identity is stable.
 *
 * `matchSlashCommands` is skipped entirely when the Agent tool is off, and a
 * fresh `[]` there would be a new array on every keystroke.
 */
const EMPTY_SLASH_MATCHES: SlashCommand[] = [];


const Sidebar: React.FC<SidebarProps> = ({ width, isCollapsed, onToggle, prompt, initialAttachments, activeTab, onTabChange, isChatMode, onHomeClick, modelConfig, setModelConfig, selectedModelId, setSelectedModelId, isResizing, projectName, isProjectPromoted = true, isGeneratingName, onSettingsClick, onProjectHydrated }) => {
  const navigate = useNavigate();
  const location = useLocation();
  console.log('🔵🔵🔵 [Sidebar] COMPONENT RENDERING 🔵🔵🔵');
  const isCompact = width < 405;
  /*
   * The Agent tool's master switch.
   *
   * Declared up here because almost everything harness-related reads it — the
   * slash menu, the send routing, the model menu's Ultra rung — and they are
   * spread the length of this component.
   *
   * Read from the store rather than compared against `selectedToolId` so a pick
   * made on the landing composer, where the first prompt is usually typed, is
   * authoritative on the very first render here.
   */
  const isAgent = useStore(agentEngaged);

  /*
   * Bring up MCP servers the user has enabled.
   *
   * Config survives a reload but connections do not, so without this a user who
   * switched a server on yesterday would send a message today and silently get
   * none of its tools. Fired once on mount and only for servers that are idle,
   * so it neither re-connects a live server nor keeps retrying a failed one —
   * a failure is shown in Settings → Connectors → MCP servers, which is also
   * where it can be retried.
   */
  useEffect(() => {
    void connectEnabledMcpServers();
  }, []);

  const [sidebarView, setSidebarViewRaw] = useState<'chat' | 'visual-edit'>('chat');
  const hasUnsaved = useStore(hasUnsavedChanges);
  const [showExitModal, setShowExitModal] = useState(false);
  // Agent Builder: saved-workflow list + backend status for the Library card
  const abWorkflows = useStore(agentWorkflowList);
  const abStatus = useStore(abBackendStatus);
  const [showAgentLibrary, setShowAgentLibrary] = useState(false);
  const [editingWorkflowId, setEditingWorkflowId] = useState<string | null>(null);
  const [editingWorkflowName, setEditingWorkflowName] = useState('');
  const [workflowActionBusy, setWorkflowActionBusy] = useState<string | null>(null);
  const [workflowActionError, setWorkflowActionError] = useState<string | null>(null);

  const [pendingExitAction, setPendingExitAction] = useState<(() => void) | null>(null);

  // Guarded setSidebarView: prevent any view switch while the exit modal is open
  const showExitModalRef = useRef(showExitModal);
  useEffect(() => { showExitModalRef.current = showExitModal; }, [showExitModal]);
  const setSidebarView = useCallback((view: 'chat' | 'visual-edit') => {
    if (showExitModalRef.current) return; // Block state changes while modal is open
    setSidebarViewRaw(view);
  }, []);

  const handleExitVisualEdit = (action?: () => void) => {
    if (hasUnsaved) {
      if (action) setPendingExitAction(() => action);
      setShowExitModal(true);
    } else {
      setSidebarViewRaw('chat');
      exitVisualEdit();
      action?.();
    }
  };


  const [promptValue, setPromptValue] = useState('');

  /*
   * Agent tool: the collaboration mode and the thread goal.
   *
   * Both are sticky, as upstream's are: a mode holds until it is changed, and a
   * goal persists across turns — which is the entire point of one, since the
   * harness keeps steering turns at it until the objective is true.
   */
  const mode = useStore(collaborationMode);
  const goal = useStore(threadGoal);

  /**
   * An objective typed this turn, before the goal exists.
   *
   * `/goal <objective>` has to reach `startCodexGeneration`, which runs after
   * several `await`s — so it cannot be read back off the composer, which has
   * already been cleared. A ref rather than state because nothing renders from
   * it and a re-render between the two would be wasted.
   */
  const pendingGoalObjectiveRef = useRef<string | null>(null);
  const setPendingGoalObjective = (objective: string | null): void => {
    pendingGoalObjectiveRef.current = objective;
  };

  /*
   * Agent tool: slash commands.
   *
   * Most expand into the composer rather than doing anything themselves, so the
   * user can edit before sending and the harness stays the only thing deciding
   * what runs. Four are actions: `/clear`, and the three that change mode.
   *
   * Gated on the Agent tool. With it off `slashMatches` is always empty, which
   * makes both the menu and the keydown interception below dead code — typing a
   * `/` in the legacy composer behaves exactly as it always has.
   */
  const slashMatches = isAgent ? matchSlashCommands(promptValue) : EMPTY_SLASH_MATCHES;
  const [slashIndex, setSlashIndex] = useState(0);
  useEffect(() => setSlashIndex(0), [promptValue]);

  const applySlashCommand = useCallback((command: SlashCommand) => {
    if (command.action === 'clear') {
      setPromptValue('');
      handleNewChat();
      return;
    }

    /*
     * The mode commands, which are not templates.
     *
     * `/plan` and `/code` take effect immediately — there is nothing to send,
     * the mode *is* the change. `/goal` needs an objective, so it leaves the
     * composer primed for one and `handleSendMessage` picks it up.
     */
    if (command.action === 'plan-mode' || command.action === 'default-mode') {
      setCollaborationMode(command.action === 'plan-mode' ? 'plan' : 'default');
      setPromptValue('');
      return;
    }

    if (command.action === 'goal-mode') {
      setPromptValue('/goal ');
      requestAnimationFrame(() => {
        const node = textareaRef.current;
        if (!node) return;
        node.focus();
        node.setSelectionRange(node.value.length, node.value.length);
      });
      return;
    }

    const { text, caret } = expandCommand(command);
    setPromptValue(text);

    // The caret goes where the user has to type next; without this it lands at
    // the end and they have to click back into the middle of the template.
    requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(caret, caret);
    });
  }, []);

  // Visual edit queue subscription
  const editQueue = useStore(visualEditQueue);

  // Deferred activeTab state - updates one frame after activeTab changes
  // This staggers the suggestions grid animation to avoid layout thrashing
  const [deferredActiveTab, setDeferredActiveTab] = useState(activeTab);
  useEffect(() => {
    if (activeTab !== deferredActiveTab) {
      requestAnimationFrame(() => {
        setDeferredActiveTab(activeTab);
      });
    }
  }, [activeTab, deferredActiveTab]);

  // Automatically exit visual edit view when navigating away from design tab
  // Use requestAnimationFrame to defer state change and avoid interrupting CSS animations
  // Automatically exit visual edit view when navigating away from design tab
  // Use requestAnimationFrame to defer state change and avoid interrupting CSS animations
  useEffect(() => {
    if (activeTab !== 'design' && sidebarView === 'visual-edit') {
      if (hasUnsaved) {
        // Intercept tab switch if there are unsaved changes
        const targetTab = activeTab; // Capture the intended destination
        setPendingExitAction(() => () => onTabChange(targetTab));
        // IMMEDIATELY revert to design tab to preserve the view
        onTabChange('design');
        setShowExitModal(true);
      } else {
        requestAnimationFrame(() => {
          setSidebarViewRaw('chat');
          exitVisualEdit();
        });
      }
    }
  }, [activeTab, sidebarView, hasUnsaved, onTabChange]);

  // Robust Visual Edit Exit: Ensure we exit mode whenever sidebar view changes OR on unmount
  useEffect(() => {
    // Skip if the exit modal is open - we don't want to exit while confirming
    if (showExitModal) return;
    // If we are NOT in visual edit view, force exit mode
    // This catches cases like switching tools, clicking "Design" text, etc.
    if (sidebarView !== 'visual-edit') {
       if (isVisualEditMode.get()) {
         exitVisualEdit();
       }
    }
  }, [sidebarView, showExitModal]);

  // Cleanup on unmount to ensure mode doesn't persist if component destroyed
  useEffect(() => {
    return () => {
       if (isVisualEditMode.get()) {
         exitVisualEdit();
       }
    };
  }, []);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const tabsScrollRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const streamingContentRef = useRef<HTMLDivElement>(null);
  const [responseAreaMinHeight, setResponseAreaMinHeight] = useState<number | undefined>(undefined);
  const [needsScrollPadding, setNeedsScrollPadding] = useState(false);
  const [showLeftGradient, setShowLeftGradient] = useState(false);
  const [messageReactions, setMessageReactions] = useState<{ [key: string]: 'like' | 'dislike' | null }>({});
  const [fileListExpanded, setFileListExpanded] = useState(false); // Lifted state for file list expansion
  
  // Test mode state
  const isTestMode = useStore(testStore.isTestMode);
  const testStatus = useStore(testStore.status);
  const $hoveredElement = useStore(hoveredElement);
  const $selectedElement = useStore(selectedElement);
  const selectedEls = useStore(selectedElements);
  
  // Selected tool state (independent from tabs)
  //
  // Seeded from the Agent store so a pick made on the landing composer — which
  // is where the first prompt is usually typed — is still selected once the
  // workbench takes over. Any other tool starts unselected, as before.
  const [selectedToolId, setSelectedToolId] = useState<string | null>(
    () => (agentEngaged.get() ? 'agent' : null),
  );

  /*
   * ...and kept in step with it afterwards, for the same reason the landing
   * composer is: the two hold separate tool state, so whichever one the user did
   * not touch would otherwise show a pill that disagrees with what actually runs.
   */
  useEffect(() => {
    setSelectedToolId((current) => {
      if (isAgent) return 'agent';
      return current === 'agent' ? null : current;
    });
  }, [isAgent]);
  const [globalErrors, setGlobalErrors] = useState<{id: string; message: string; isClosing: boolean; action?: 'set-api-key'}[]>([]);

  const addGlobalError = useCallback((message: string, action?: 'set-api-key') => {
    setGlobalErrors(prev => [...prev, { id: Date.now().toString(), message, isClosing: false, action }]);
  }, []);

  const dismissGlobalError = useCallback((id: string) => {
    setGlobalErrors(prev => prev.map(e => e.id === id ? { ...e, isClosing: true } : e));
    setTimeout(() => {
      setGlobalErrors(prev => prev.filter(e => e.id !== id));
    }, 250);
  }, []);
  
  // Debug: Log test mode changes
  useEffect(() => {
    console.log('[Sidebar] isTestMode changed to:', isTestMode);
  }, [isTestMode]);

  // Listen for build/runtime errors from the preview iframe and show as popup
  const lastPreviewErrorRef = useRef<string>('');
  useEffect(() => {
    const handlePreviewError = (event: MessageEvent) => {
      if (event.data?.type === 'PREVIEW_ERROR' && event.data.message) {
        if (event.data.message === lastPreviewErrorRef.current) return;
        lastPreviewErrorRef.current = event.data.message;
        addGlobalError(`${event.data.errorType || 'Build Error'}: ${event.data.message}`);
        setTimeout(() => { lastPreviewErrorRef.current = ''; }, 3000);
      }
    };
    window.addEventListener('message', handlePreviewError);
    return () => window.removeEventListener('message', handlePreviewError);
  }, [addGlobalError]);
  
  // Attachments State
  interface Attachment {
    id: string;
    type: 'image' | 'file';
    url?: string;
    name: string;
    extension?: string;
    file?: File;
  }

  // Visual Editor State
  const selection = useStore(selectedElement);
  const hasUndo = useStore(canUndo);
  const atRoot = useStore(isAtRootLevel);

  // Enable select parent when there's a selection and we're not at root
  const canSelectParent = !!selection && !atRoot;

  // Design canvas screen selection (for screen attachments in prompt)
  const selectedDesignIds = useStore(selectedDesignNodeIds);
  const allDesignNodes = useStore(designNodesStore);
  const selectedScreens = allDesignNodes.filter(n => selectedDesignIds.includes(n.id));

  // Track displayed screen attachments with animated removal for ALL deselect paths
  const [displayedScreenIds, setDisplayedScreenIds] = useState<string[]>([]);
  const [fadingOutScreenIds, setFadingOutScreenIds] = useState<Set<string>>(new Set());
  const fadingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const displayedScreenIdsRef = useRef<string[]>([]);
  displayedScreenIdsRef.current = displayedScreenIds;

  useEffect(() => {
    const currentIds = activeTab === 'canvas-screens' ? selectedDesignIds : [];
    const prevIds = displayedScreenIdsRef.current;
    const added = currentIds.filter(id => !prevIds.includes(id));
    const removed = prevIds.filter(id => !currentIds.includes(id));

    if (removed.length > 0) {
      // Start fade-out for removed items
      setFadingOutScreenIds(prev => {
        const next = new Set(prev);
        removed.forEach(id => next.add(id));
        return next;
      });
      // After animation, remove them from displayed list
      removed.forEach(id => {
        const existing = fadingTimersRef.current.get(id);
        if (existing) clearTimeout(existing);

        const timer = setTimeout(() => {
          setDisplayedScreenIds(prev => prev.filter(x => x !== id));
          setFadingOutScreenIds(prev => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          fadingTimersRef.current.delete(id);
        }, 200);
        fadingTimersRef.current.set(id, timer);
      });
    }

    if (added.length > 0) {
      // Cancel any pending fade-out for items being re-added
      added.forEach(id => {
        const existing = fadingTimersRef.current.get(id);
        if (existing) {
          clearTimeout(existing);
          fadingTimersRef.current.delete(id);
        }
      });
      setFadingOutScreenIds(prev => {
        const next = new Set(prev);
        added.forEach(id => next.delete(id));
        return next;
      });
      setDisplayedScreenIds(prev => [...prev.filter(id => !added.includes(id)), ...added]);
    }
  }, [selectedDesignIds, activeTab]);

  // The screens to render = currently displayed (includes fading-out ones)
  const displayedScreens = allDesignNodes.filter(n => displayedScreenIds.includes(n.id));

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
          extension: file.name.split('.').pop() || 'FILE',
          file
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

  // Check if any attachments are visible — includes screen selections
  // hasVisibleScreens stays true while items are fading out so the grid container doesn't collapse mid-animation
  // Only true when at least one screen is NOT fading out — mirrors file attachment logic
  // so the last screen removal lets the grid collapse directly instead of squeeze-then-collapse
  const hasVisibleScreens = activeTab === 'canvas-screens' && displayedScreenIds.some(id => !fadingOutScreenIds.has(id));
  const hasVisibleAttachments = (attachments.length > 0 && !attachments.every(att => removingIds.has(att.id))) || hasVisibleScreens;
  const [showRightGradient, setShowRightGradient] = useState(true);

  const activeSnapshotId = useStore(workbenchStore.activeSnapshotId);
  const previewSnapshot = useStore(workbenchStore.previewSnapshot);

  // Chat/Messaging State
  interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    thinkingTime?: number;
    isGenerating?: boolean;
    isThinking?: boolean;
    hasCodeChanges?: boolean;
    filesSnapshot?: Record<string, string>; // State of codebase immediately after this message
    /**
     * Agent tool only: the Codex harness turn that produced this message.
     *
     * The harness keeps its tool calls and sub-agents in `agent-store` rather
     * than on the message, because they stream in while the message body is
     * still empty. This id is the join between the two. Absent on every message
     * the legacy loop produced, which is what makes the timeline components
     * fall back to plain rendering.
     */
    codexTurnId?: string;

    timestamp: number;
    attachments?: { type: 'image' | 'text' | 'file'; mimeType: string; data: string; name?: string }[];
    designNodeId?: string; // Links to a design node on the canvas
  }
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentStreamingResponse, setCurrentStreamingResponse] = useState('');
  /**
   * The Codex turn in flight, or null when the Agent tool is not driving.
   *
   * Held separately from `messages` because the assistant message is only
   * appended once the turn settles, while its tool cards need to render from
   * the first patch onward.
   */
  const [activeCodexTurn, setActiveCodexTurn] = useState<string | null>(null);

  // Design mode (canvas-screens) — separate chat state
  const [designMessages, setDesignMessages] = useState<ChatMessage[]>([]);
  const [designStreamingResponse, setDesignStreamingResponse] = useState('');

  // Session IDs for local file system auto-saving
  const [codeChatSessionId] = useState(() => {
    const dateStr = new Date().toISOString().slice(0, 19).replace(/[:]/g, '-');
    return `${dateStr}_${Math.random().toString(36).slice(2, 8)}`;
  });
  const [designChatSessionId] = useState(() => {
    const dateStr = new Date().toISOString().slice(0, 19).replace(/[:]/g, '-');
    return `${dateStr}_${Math.random().toString(36).slice(2, 8)}`;
  });

  // Project-specific Multi-Session Chat History
  interface ChatSession {
    id: string;                 // Unique UUID for the session
    name: string;               // Summarized session name (defaults to 'New Chat')
    messages: ChatMessage[];    // Chat messages list
    filesSnapshot: any; // Files snapshot state for this session
    activeSnapshotId: string | null;       // Active snapshot ID
    createdAt: number;          // Creation timestamp
    updatedAt: number;          // Last updated timestamp
  }

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  // Tracks whether this mount has persisted any session under the transient
  // `willow_chat_sessions_default` bucket — i.e. the user typed a follow-up
  // during the async project-naming window (see the load effect below). When
  // the AI name lands we migrate that bucket to the named key so the brand-new
  // project doesn't reopen empty.
  const wroteToDefaultRef = useRef(false);
  const migratedDefaultRef = useRef(false);
  const [namingSessionIds, setNamingSessionIds] = useState<Set<string>>(new Set());
  // Session ids naming has already been started for. The naming effect depends
  // on `messages`, which changes on every streamed token, and its own "still
  // called New Chat" gate stays open until the rename commits — so without this
  // one session fires a naming request per token.
  const namingStartedRef = useRef<Set<string>>(new Set());
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [shouldRenderHistory, setShouldRenderHistory] = useState(false);
  const [isClosingHistory, setIsClosingHistory] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const [codeChatTitle, setCodeChatTitle] = useState<string | null>(null);
  const [designChatTitle, setDesignChatTitle] = useState<string | null>(null);
  const inboxSaveRef = useRef<Promise<unknown>>(Promise.resolve());

  const { chatScopeId, isLocalFolderConnected, loadLocalFSProject, saveLocalFSChat, deleteLocalFSChat, saveLocalFSProjectChat, generateChatTitle } = useLocalFS();
  const { loadLatestProject } = useDrive();

  // Generate chat title using Gemini 3.1 Flash Lite once we have user and assistant responses (Code Chat)
  useEffect(() => {
    if (messages.length >= 2 && !codeChatTitle) {
      const userMsg = messages[0].content;
      const assistantMsg = messages[1].content;
      
      const fetchTitle = async () => {
        let title = '';
        try {
          title = await generateChatTitle(userMsg, assistantMsg);
        } catch {
          title = '';
        }
        // Naming used to stop here when the model gave nothing back, so a quota
        // error left the chat on its session id for the rest of the session.
        if (!title) title = deriveFallbackTitle(userMsg, FALLBACK_CHAT_TITLE);
        let uniqueTitle = title;
        let counter = 1;
        while (sessions.some(s => s.name.toLowerCase() === uniqueTitle.toLowerCase())) {
          uniqueTitle = `${title} (${counter})`;
          counter++;
        }
        renameCodeChat(chatScopeId, codeChatTitle || codeChatSessionId, uniqueTitle);
        setCodeChatTitle(uniqueTitle);
      };
      void fetchTitle();
    }
  }, [messages, codeChatTitle, generateChatTitle, sessions, chatScopeId]);

  // Before the first file mutation, Code mode is an inbox chat. Promotion moves
  // the same messages into the project folder and removes the standalone copy.
  useEffect(() => {
    if (messages.length === 0) return;
    const activeId = codeChatTitle || codeChatSessionId;

    if (!isProjectPromoted) {
      markCodeChat(chatScopeId, activeId);
      const inboxMessages = messages.map((message) => ({ ...message, willowMode: 'code' }));
      inboxSaveRef.current = inboxSaveRef.current
        .catch(() => {})
        .then(() => saveLocalFSChat(activeId, inboxMessages, codeChatTitle ? codeChatSessionId : null));
      return;
    }

    if (!projectName) return;
    void (async () => {
      await inboxSaveRef.current.catch(() => {});
      if (isLocalFolderConnected) {
        await saveLocalFSProjectChat(projectName, activeId, messages);
      }
      unmarkCodeChat(chatScopeId, activeId);
      await deleteLocalFSChat(activeId);
    })();
  }, [messages, codeChatTitle, codeChatSessionId, isProjectPromoted, projectName, isLocalFolderConnected, saveLocalFSChat, deleteLocalFSChat, saveLocalFSProjectChat, chatScopeId]);

  // Generate chat title using Gemini 3.1 Flash Lite once we have user and assistant responses (Design Chat)
  useEffect(() => {
    if (isLocalFolderConnected && designMessages.length >= 2 && !designChatTitle) {
      const userMsg = designMessages[0].content;
      const assistantMsg = designMessages[1].content;
      
      const fetchTitle = async () => {
        let title = '';
        try {
          title = await generateChatTitle(userMsg, assistantMsg);
        } catch {
          title = '';
        }
        if (!title) title = deriveFallbackTitle(userMsg, FALLBACK_CHAT_TITLE);
        let uniqueTitle = title;
        let counter = 1;
        while (sessions.some(s => s.name.toLowerCase() === uniqueTitle.toLowerCase())) {
          uniqueTitle = `${title} (${counter})`;
          counter++;
        }
        setDesignChatTitle(uniqueTitle);
      };
      void fetchTitle();
    }
  }, [designMessages, designChatTitle, isLocalFolderConnected, generateChatTitle, sessions]);

  // Auto-save design chat sessions
  useEffect(() => {
    if (isLocalFolderConnected && designMessages.length > 0 && projectName) {
      const activeId = designChatTitle || designChatSessionId;
      void saveLocalFSProjectChat(projectName, activeId, designMessages, designChatTitle ? designChatSessionId : null);
    }
  }, [designMessages, designChatTitle, designChatSessionId, isLocalFolderConnected, projectName, saveLocalFSProjectChat]);

  const [currentThinkingTime, setCurrentThinkingTime] = useState(0);
  const thinkingTimeRef = useRef(0); // Ref to capture accurate final thinking time
  const thinkingStartTimeRef = useRef<number | null>(null); // Timestamp when thinking started
  const [isCurrentlyGenerating, setIsCurrentlyGenerating] = useState(!!prompt);
  const [isCurrentlyThinking, setIsCurrentlyThinking] = useState(!!prompt);
  const isCurrentlyThinkingRef = useRef(false); // Ref to avoid stale closure in streaming callback
  const { apiKeys, loading: userDataLoading } = useUserDataContext();
  const thinkingTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Abort provider requests when the Code mode stop button is pressed.
  const generationAbortControllerRef = useRef<AbortController | null>(null);
  // Monotonic guard so an older run cannot clear state or append output after
  // a newer prompt has started.
  const generationRunIdRef = useRef(0);

  const renameAgentWorkflow = useCallback(async (id: string) => {
    const name = editingWorkflowName.trim();
    if (!name) return;
    setWorkflowActionBusy(id);
    setWorkflowActionError(null);
    try {
      const { getAgentBuilderClient } = await import('@willow/agent-builder/agent-builder');
      const { workflow } = await getAgentBuilderClient(apiKeys).updateWorkflow(id, { name });
      agentWorkflowList.set(agentWorkflowList.get().map((item) => item.id === id ? { ...item, name: workflow.name, updatedAt: workflow.updatedAt } : item));
      setEditingWorkflowId(null);
    } catch (error) {
      setWorkflowActionError((error as Error).message);
    } finally {
      setWorkflowActionBusy(null);
    }
  }, [apiKeys, editingWorkflowName]);

  const duplicateAgentWorkflow = useCallback(async (id: string) => {
    setWorkflowActionBusy(id);
    setWorkflowActionError(null);
    try {
      const { getAgentBuilderClient } = await import('@willow/agent-builder/agent-builder');
      const { workflow } = await getAgentBuilderClient(apiKeys).duplicateWorkflow(id);
      agentWorkflowList.set([{
        id: workflow.id,
        name: workflow.name,
        nodeCount: workflow.draft.nodes.length,
        latestVersion: workflow.latestVersion,
        updatedAt: workflow.updatedAt,
      }, ...agentWorkflowList.get()]);
    } catch (error) {
      setWorkflowActionError((error as Error).message);
    } finally {
      setWorkflowActionBusy(null);
    }
  }, [apiKeys]);

  const deleteAgentWorkflow = useCallback(async (id: string, name: string) => {
    if (!window.confirm(`Delete workflow "${name}"? This cannot be undone.`)) return;
    setWorkflowActionBusy(id);
    setWorkflowActionError(null);
    try {
      const { getAgentBuilderClient } = await import('@willow/agent-builder/agent-builder');
      await getAgentBuilderClient(apiKeys).deleteWorkflow(id);
      agentWorkflowList.set(agentWorkflowList.get().filter((item) => item.id !== id));
      if (editingWorkflowId === id) setEditingWorkflowId(null);
    } catch (error) {
      setWorkflowActionError((error as Error).message);
    } finally {
      setWorkflowActionBusy(null);
    }
  }, [apiKeys, editingWorkflowId]);



  // Prompt Suggestions State
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionsVisible, setSuggestionsVisible] = useState(false); // Start hidden
  const suggestionsGeneratedRef = useRef(false);
  const prevGeneratingRef = useRef(false);
  const initialLoadCompleteRef = useRef(false); // Track if first generation from the studio home is done

  // Helper to extract a clean serializable snapshot of the sandpack files
  const getFilesSnapshot = useCallback(() => {
    const snapshot: Record<string, string> = {};
    const filesMap = workbenchStore.files.get();
    Object.entries(filesMap).forEach(([path, file]: [string, any]) => {
      snapshot[path] = file.content;
    });
    return snapshot;
  }, []);

  // Helper to format human-readable relative dates
  const formatRelativeTime = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    if (diff < 60000) return 'Just now';
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(diff / 3600000);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(diff / 86400000);
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  // Manage delayed unmount for fade-out transitions
  useEffect(() => {
    if (isHistoryOpen) {
      setShouldRenderHistory(true);
      setIsClosingHistory(false);
    } else if (shouldRenderHistory) {
      setIsClosingHistory(true);
      const timer = setTimeout(() => {
        setShouldRenderHistory(false);
        setIsClosingHistory(false);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isHistoryOpen, shouldRenderHistory]);

  // Recalculate popover screen position dynamically
  const updatePosition = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPopoverPosition({
        top: rect.bottom + window.scrollY,
        left: rect.left + window.scrollX,
      });
    }
  }, []);

  useEffect(() => {
    if (!shouldRenderHistory) return;
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [shouldRenderHistory, updatePosition]);

  // Close history popover when clicking outside (Portal compatible)
  useEffect(() => {
    if (!isHistoryOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const popover = document.getElementById('history-popover-portal');
      const isInsideTrigger = triggerRef.current?.contains(e.target as Node);
      const isInsidePopover = popover?.contains(e.target as Node);
      if (!isInsideTrigger && !isInsidePopover) {
        setIsHistoryOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isHistoryOpen]);

  // Persist sessions, remembering when a write lands in the transient
  // `_default` bucket (the project-naming window) so the load effect can
  // migrate it to the named key once the AI name resolves. All session saves
  // go through here instead of calling saveCodeSessions directly.
  const persistSessions = useCallback((key: string, sessionsToSave: ChatSession[]) => {
    if (key === 'willow_chat_sessions_default') {
      wroteToDefaultRef.current = true;
    }
    void saveCodeSessions(key, sessionsToSave);
  }, [chatScopeId]);

  // Load sessions from localStorage whenever projectName changes
  useEffect(() => {
    // If a prompt is present in the URL and we are on initial mount (projectName is empty),
    // we are starting a brand new project. We must skip loading any saved sessions (like willow_chat_sessions_default)
    // so that we start with a clean slate (empty messages, reset stores, etc.).
    if (prompt && !projectName) {
      setSessions([]);
      const initialId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      setCurrentSessionId(initialId);
      return;
    }

    let cancelled = false;
    const storageKey = projectName ? `willow_chat_sessions_${projectName}` : 'willow_chat_sessions_default';

    (async () => {
      const restorePersistedProject = async (): Promise<boolean> => {
        if (!projectName) return false;
        let files = isLocalFolderConnected ? await loadLocalFSProject(projectName) : null;
        if (files === null) files = await loadLatestProject(projectName);
        if (files === null) return false;
        const snapshot = Object.fromEntries(files.map((file) => [
          file.name.startsWith('/') ? file.name : `/${file.name}`,
          file.content,
        ]));
        workbenchStore.restoreFromSnapshot('persisted_latest', snapshot);
        return true;
      };

      // A brand-new project's name resolves asynchronously (the AI naming
      // fetch). If the user sent a follow-up during that window, its session(s)
      // were persisted under `willow_chat_sessions_default`. Now that we have a
      // real name, migrate that transient bucket into the named key BEFORE
      // loading — otherwise the load below reads an empty named key and the
      // project reopens with no history or file snapshots. renameCodeSessions
      // is a no-op if `_default` is empty and won't clobber an existing named
      // key. Done at most once per mount.
      if (projectName && wroteToDefaultRef.current && !migratedDefaultRef.current) {
        migratedDefaultRef.current = true;
        try {
          await renameCodeSessions('willow_chat_sessions_default', storageKey);
        } catch {}
        if (cancelled) return;
      }

      // loadCodeSessions migrates any legacy localStorage value into IndexedDB on first read.
      const parsed = (await loadCodeSessions(storageKey)) as ChatSession[] | null;
      if (cancelled) return;

      if (parsed && parsed.length > 0) {
        setSessions(parsed);
        const sorted = [...parsed].sort((a, b) => b.updatedAt - a.updatedAt);
        setCurrentSessionId(sorted[0].id);
        setMessages(sorted[0].messages);
        // Durable local/Drive state is the current project generation. Session
        // snapshots are chat-history checkpoints and can be older or omit files
        // added on another device (especially binary assets). Restoring the
        // snapshot first made the next autosave prune those durable-only files.
        const restoredDurableProject = await restorePersistedProject();
        if (!restoredDurableProject && sorted[0].filesSnapshot && Object.keys(sorted[0].filesSnapshot).length > 0) {
          workbenchStore.restoreFromSnapshot(sorted[0].activeSnapshotId || '', sorted[0].filesSnapshot);
        }
        if (!cancelled) onProjectHydrated?.();
        return;
      }

      await restorePersistedProject();
      if (cancelled) return;

      // No sessions found, create an initial one only if we already have messages
      const initialId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      if (messages && messages.length > 0) {
        const currentFiles = getFilesSnapshot();
        const initialSession: ChatSession = {
          id: initialId,
          name: 'Initial Chat',
          messages: messages,
          filesSnapshot: Object.keys(currentFiles).length > 0 ? currentFiles : {},
          activeSnapshotId: activeSnapshotId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        setSessions([initialSession]);
      } else {
        setSessions([]);
      }
      setCurrentSessionId(initialId);
      onProjectHydrated?.();
    })();

    return () => { cancelled = true; };
  }, [projectName, prompt, chatScopeId, isLocalFolderConnected, loadLocalFSProject, loadLatestProject, onProjectHydrated]);

  // Auto-save current session state when messages or activeSnapshotId change
  useEffect(() => {
    if (!currentSessionId) return;

    const currentFiles = getFilesSnapshot();

    setSessions(prev => {
      const idx = prev.findIndex(s => s.id === currentSessionId);
      if (idx === -1) return prev;

      const session = prev[idx];
      const hasMessagesChanged = JSON.stringify(session.messages) !== JSON.stringify(messages);
      const hasActiveSnapshotChanged = session.activeSnapshotId !== activeSnapshotId;
      
      if (!hasMessagesChanged && !hasActiveSnapshotChanged) {
        return prev;
      }

      const updatedSession = {
        ...session,
        messages,
        filesSnapshot: Object.keys(currentFiles).length > 0 ? currentFiles : session.filesSnapshot,
        activeSnapshotId: activeSnapshotId,
        updatedAt: Date.now(),
      };

      const next = [...prev];
      next[idx] = updatedSession;

      const storageKey = projectName ? `willow_chat_sessions_${projectName}` : 'willow_chat_sessions_default';
      persistSessions(storageKey, next);

      return next;
    });
  }, [messages, activeSnapshotId, currentSessionId, projectName, getFilesSnapshot]);

  // Automated session naming.
  useEffect(() => {
    if (!currentSessionId || namingStartedRef.current.has(currentSessionId)) return;
    // Any provider key will do. This gated on a Gemini key specifically, so a
    // user whose System-defaults naming model is Claude or GPT never had a
    // session named at all — the provider is resolved from that setting below.
    const hasNamingKey = !!(
      apiKeys.gemini?.[0] || apiKeys.openai?.[0] || apiKeys.anthropic?.[0]
      || apiKeys.moonshot?.[0] || apiKeys.spacexai?.[0] || apiKeys.zhipuai?.[0]
    );
    if (!hasNamingKey) return;

    const currentSession = sessions.find(s => s.id === currentSessionId);
    if (!currentSession) return;

    const hasDefaultName = currentSession.name === 'New Chat' || currentSession.name === 'Initial Chat';
    if (hasDefaultName && messages.length >= 1) {
      const userMessage = messages.find(m => m.role === 'user');
      if (!userMessage) return;

      const userPrompt = userMessage.content;
      namingStartedRef.current.add(currentSessionId);

      const nameSession = async () => {
        let summaryTitle = '';
        try {
          setNamingSessionIds(prev => {
            const next = new Set(prev);
            next.add(currentSessionId);
            return next;
          });

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
              const sel = allModels.find((m: any) => m.modelId === chatNamingSelectionId);
              if (sel) {
                targetProvider = sel.provider;
                targetModelId = sel.modelId;
              }
          }
          
          const apiKey = apiKeys?.[targetProvider]?.[0];
          if (!apiKey) throw new Error('No API key for configured chat naming provider');

          const promptText = buildSessionTitlePrompt(userPrompt);

          if (targetProvider === 'gemini') {
              const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${targetModelId}:generateContent?key=${apiKey}`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    contents: [{ parts: [{ text: promptText }] }]
                  })
                }
              );
              if (response.ok) {
                const data = await response.json();
                summaryTitle = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
              }
          } else if (targetProvider === 'openai') {
              const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                  model: targetModelId,
                  messages: [{ role: 'user', content: promptText }]
                })
              });
              if (response.ok) {
                  const data = await response.json();
                  summaryTitle = data?.choices?.[0]?.message?.content?.trim() || '';
              }
          } else if (targetProvider === 'anthropic') {
              const response = await fetch('https://api.anthropic.com/v1/messages', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                    'anthropic-cors-bypass': 'true'
                  },
                  body: JSON.stringify({
                    model: targetModelId,
                    max_tokens: 50,
                    messages: [{ role: 'user', content: promptText }]
                  })
                });
                if (response.ok) {
                    const data = await response.json();
                    summaryTitle = data?.content?.[0]?.text?.trim() || '';
                }
          }
          
          summaryTitle = summaryTitle
            .replace(/^["'-\s•]+|["'-\s•]+$/g, '')
            .replace(/[\n\r]+/g, ' ')
            .trim();

          // A model that replied with a paragraph is as unusable as one that did
          // not reply, so both take the fallback below rather than only the
          // empty case being handled.
          if (summaryTitle.length >= 40) summaryTitle = '';
        } catch (error) {
          console.error('[Sessions] Failed to auto-name session:', error);
          summaryTitle = '';
        }

        // The naming model is the user's own pick from System defaults, so it
        // fails for reasons this surface cannot fix: quota, a revoked key, a
        // retired model id. The prompt it was given names the session instead —
        // which is what guarantees the skeleton resolves to a real label rather
        // than leaving the session called "New Chat" forever.
        if (!summaryTitle) summaryTitle = deriveFallbackTitle(userPrompt, FALLBACK_CHAT_TITLE);

        setSessions(prev => {
          const idx = prev.findIndex(s => s.id === currentSessionId);
          if (idx === -1) return prev;

          // Ensure name is unique among other sessions in the same project list
          let uniqueTitle = summaryTitle;
          let counter = 1;
          while (prev.some((s, sIdx) => sIdx !== idx && s.name.toLowerCase() === uniqueTitle.toLowerCase())) {
            uniqueTitle = `${summaryTitle} (${counter})`;
            counter++;
          }

          const updated = {
            ...prev[idx],
            name: uniqueTitle,
            updatedAt: Date.now(),
          };
          const next = [...prev];
          next[idx] = updated;
          const storageKey = projectName ? `willow_chat_sessions_${projectName}` : 'willow_chat_sessions_default';
          persistSessions(storageKey, next);
          return next;
        });

        setNamingSessionIds(prev => {
          const next = new Set(prev);
          next.delete(currentSessionId);
          return next;
        });
      };

      void nameSession();
    }
  }, [messages, currentSessionId, apiKeys, projectName]);

  // Switch to a different chat session
  const handleSwitchSession = useCallback((sessionId: string) => {
    if (isCurrentlyGenerating) return;

    const currentFiles = getFilesSnapshot();
    if (currentSessionId) {
      setSessions(prev => {
        const idx = prev.findIndex(s => s.id === currentSessionId);
        if (idx === -1) return prev;
        const updated = {
          ...prev[idx],
          messages,
          filesSnapshot: Object.keys(currentFiles).length > 0 ? currentFiles : prev[idx].filesSnapshot,
          activeSnapshotId: activeSnapshotId,
          updatedAt: Date.now(),
        };
        const next = [...prev];
        next[idx] = updated;
        const storageKey = projectName ? `willow_chat_sessions_${projectName}` : 'willow_chat_sessions_default';
        persistSessions(storageKey, next);
        return next;
      });
    }

    const targetSession = sessions.find(s => s.id === sessionId);
    if (targetSession) {
      setCurrentSessionId(sessionId);
      setMessages(targetSession.messages);
      
      setCurrentStreamingResponse('');
      setIsCurrentlyGenerating(false);
      setIsCurrentlyThinking(false);
      isCurrentlyThinkingRef.current = false;
      setCurrentThinkingTime(0);
      thinkingTimeRef.current = 0;
      thinkingStartTimeRef.current = null;
      if (thinkingTimerRef.current) {
        clearInterval(thinkingTimerRef.current);
        thinkingTimerRef.current = null;
      }
      
    }
    
    setIsHistoryOpen(false);
  }, [currentSessionId, messages, activeSnapshotId, sessions, isCurrentlyGenerating, projectName, getFilesSnapshot]);

  // Delete a chat session
  const handleDeleteSession = useCallback((sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    setSessions(prev => {
      const next = prev.filter(s => s.id !== sessionId);
      const storageKey = projectName ? `willow_chat_sessions_${projectName}` : 'willow_chat_sessions_default';
      persistSessions(storageKey, next);
      
      if (currentSessionId === sessionId) {
        if (next.length > 0) {
          const sorted = [...next].sort((a, b) => b.updatedAt - a.updatedAt);
          setTimeout(() => {
            setCurrentSessionId(sorted[0].id);
            setMessages(sorted[0].messages);
          }, 0);
        } else {
          const newId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const newSession: ChatSession = {
            id: newId,
            name: 'Initial Chat',
            messages: [],
            filesSnapshot: getFilesSnapshot(),
            activeSnapshotId: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          setTimeout(() => {
            setSessions([newSession]);
            setCurrentSessionId(newId);
            setMessages([]);
            workbenchStore.reset();
          }, 0);
        }
      }
      return next;
    });
  }, [currentSessionId, projectName, getFilesSnapshot]);

  const activeConversationMode = activeTab === 'canvas-screens' ? 'design' : 'default';
  const activeConversationMessages = activeConversationMode === 'design' ? designMessages : messages;
  const currentTargetVisualOffset = isChatMode
    ? 76
    : (activeTab === 'agent-builder' ||
       sidebarView === 'visual-edit' ||
       activeTab === 'canvas-screens' ||
       activeTab === 'canvas-elements')
      ? 56
      : 20;

  const responseHasCodeChanges = (response: string) => parseAIResponse(response).length > 0;

  // Generate prompt suggestions based on conversation
  const generateSuggestions = useCallback(async () => {
    if (!apiKeys.gemini?.[0]) return;

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
          const sel = allModels.find((m: any) => m.modelId === chatNamingSelectionId);
          if (sel) {
            targetProvider = sel.provider;
            targetModelId = sel.modelId;
          }
      }
      
      const apiKey = apiKeys?.[targetProvider]?.[0];
      if (!apiKey) throw new Error('No API key for configured chat naming provider');

      // Build context from recent messages
      const recentMessages = messages.slice(-4).map(m =>
        `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.substring(0, 200)}`
      ).join('\n');

      const promptText = buildFollowUpSuggestionsPrompt(recentMessages);

      let text = '';

      if (targetProvider === 'gemini') {
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${targetModelId}:generateContent?key=${apiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: promptText }] }]
              })
            }
          );
          if (response.ok) {
            const data = await response.json();
            text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
          }
      } else if (targetProvider === 'openai') {
          const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
              model: targetModelId,
              messages: [{ role: 'user', content: promptText }]
            })
          });
          if (response.ok) {
              const data = await response.json();
              text = data?.choices?.[0]?.message?.content?.trim() || '';
          }
      } else if (targetProvider === 'anthropic') {
          const response = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-cors-bypass': 'true'
              },
              body: JSON.stringify({
                model: targetModelId,
                max_tokens: 150,
                messages: [{ role: 'user', content: promptText }]
              })
            });
            if (response.ok) {
                const data = await response.json();
                text = data?.content?.[0]?.text?.trim() || '';
            }
      }
      const newSuggestions = text.split('\n')
        .map(s => s.trim().replace(/\?+$/, '')) // Remove trailing question marks
        .filter(s => s.length > 0 && s.length <= 30)
        .slice(0, 5);

      if (newSuggestions.length > 0) {
        setSuggestions(newSuggestions);
      }
    } catch (error) {
      console.error('[Sidebar] Failed to generate suggestions:', error);
    }
  }, [apiKeys.gemini, messages]);

  // Handle suggestion generation when AI completes
  useEffect(() => {
    // Detect transition from generating → not generating
    if (prevGeneratingRef.current && !isCurrentlyGenerating) {
      // AI just finished generating
      // Mark initial load as complete (first generation done)
      const wasInitialLoad = !initialLoadCompleteRef.current;
      initialLoadCompleteRef.current = true;

      // Generate new suggestions then show
      generateSuggestions().then(() => {
        // Reset scroll position to leftmost before showing
        if (tabsScrollRef.current) {
          tabsScrollRef.current.scrollLeft = 0;
        }
        // Small delay to let suggestions update, then slide up
        setTimeout(() => setSuggestionsVisible(true), 50);
      });
    } else if (!prevGeneratingRef.current && isCurrentlyGenerating) {
      // AI just started generating - hide suggestions only if initial load is complete
      // (don't hide on initial load since they're already hidden)
      if (initialLoadCompleteRef.current) {
        setSuggestionsVisible(false);
      }
    }
    prevGeneratingRef.current = isCurrentlyGenerating;
  }, [isCurrentlyGenerating, generateSuggestions]);

  // Generate initial suggestions when first message is sent
  useEffect(() => {
    if (messages.length >= 2 && !suggestionsGeneratedRef.current) {
      suggestionsGeneratedRef.current = true;
      generateSuggestions();
    }
  }, [messages, generateSuggestions]);

  // Keep thinking ref in sync with state
  useEffect(() => {
    isCurrentlyThinkingRef.current = isCurrentlyThinking;
  }, [isCurrentlyThinking]);
  
  // Pre-warm SDK clients as soon as API keys are available
  useEffect(() => {
    if (apiKeys.gemini?.[0]) prewarmClient('gemini', apiKeys.gemini[0]);
    if (apiKeys.openai?.[0]) prewarmClient('openai', apiKeys.openai[0]);
    if (apiKeys.anthropic?.[0]) prewarmClient('anthropic', apiKeys.anthropic[0]);
    if (apiKeys.moonshot?.[0]) prewarmClient('moonshot', apiKeys.moonshot[0]);
    if (apiKeys.spacexai?.[0]) prewarmClient('spacexai', apiKeys.spacexai[0]);
    if (apiKeys.zhipuai?.[0]) prewarmClient('zhipuai', apiKeys.zhipuai[0]);
  }, [apiKeys]);


  // New Chat — clears all chat context while preserving the codebase
  const handleNewChat = useCallback(() => {
    // Don't allow new chat while generating
    if (isCurrentlyGenerating) return;

    // Save outgoing session state first
    const currentFiles = getFilesSnapshot();
    if (currentSessionId) {
      setSessions(prev => {
        const idx = prev.findIndex(s => s.id === currentSessionId);
        if (idx === -1) return prev;
        const updated = {
          ...prev[idx],
          messages,
          filesSnapshot: Object.keys(currentFiles).length > 0 ? currentFiles : prev[idx].filesSnapshot,
          activeSnapshotId: activeSnapshotId,
          updatedAt: Date.now(),
        };
        const next = [...prev];
        next[idx] = updated;
        const storageKey = projectName ? `willow_chat_sessions_${projectName}` : 'willow_chat_sessions_default';
        persistSessions(storageKey, next);
        return next;
      });
    }

    // Clear chat messages
    setMessages([]);
    setCurrentStreamingResponse('');
    setPromptValue('');

    /*
     * A goal belongs to a thread, not to the app.
     *
     * Upstream's `ThreadGoal` carries a `thread_id` and its runtime is
     * registered per thread. Left standing across a new chat, a goal about the
     * previous conversation's work would keep starting continuation turns
     * against a project it no longer describes — and the objective is what
     * those turns are steered by, so they would pursue the wrong thing
     * confidently.
     *
     * The collaboration mode is deliberately *not* reset. It is a preference
     * rather than thread data, upstream persists it across sessions, and the
     * composer shows which one is active.
     */
    setThreadGoal(null);
    setPendingGoalObjective(null);
    dismissUserInput();

    // Clear thinking state
    setIsCurrentlyGenerating(false);
    setIsCurrentlyThinking(false);
    isCurrentlyThinkingRef.current = false;
    setCurrentThinkingTime(0);
    thinkingTimeRef.current = 0;
    thinkingStartTimeRef.current = null;
    if (thinkingTimerRef.current) {
      clearInterval(thinkingTimerRef.current);
      thinkingTimerRef.current = null;
    }

    // Keep suggestions (do not clear them)
    // Removed: setSuggestions([]);
    // Removed: setSuggestionsVisible(false);
    suggestionsGeneratedRef.current = false;
    prevGeneratingRef.current = false;
    initialLoadCompleteRef.current = false;

    // Clear file list expansion state
    setFileListExpanded(false);

    // Reset attachments
    setAttachments([]);
    setRemovingIds(new Set());

    // Switch to chat view if in visual edit
    if (sidebarView === 'visual-edit') {
      setSidebarViewRaw('chat');
      exitVisualEdit();
    }

    // Just generate a temporary new session ID and set it as active, but do not create a blank session in sessions list yet
    const newSessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    setCurrentSessionId(newSessionId);

    // Switch to preview tab
    onTabChange('preview');
  }, [isCurrentlyGenerating, sidebarView, onTabChange, currentSessionId, messages, activeSnapshotId, projectName, getFilesSnapshot]);

  // Listen for new chat signal from collapsed TopBar
  useEffect(() => {
    const unsub = newChatSignal.listen(() => {
      handleNewChat();
    });
    return unsub;
  }, [handleNewChat]);

  // Assistant prose. Chat mode's renderer is used as-is rather than mirrored,
  // so every rule it supports lands here for free -- and the word reveal is now
  // literally the same component rather than a reimplementation that has to be
  // kept in step. isStreaming/animate both take the message's own generating
  // flag, which is what ChatView passes; a settled message therefore renders
  // without animating, exactly as before.
  const renderTextContent = (text: string, isAnimating: boolean = false) => {
    if (!text) return null;
    return <StreamingMarkdown text={text} isStreaming={isAnimating} animate={isAnimating} />;
  };

  // Helper to render conversational AI content with file indicators
  // isStreaming: when true, applies fade animation to text
  const renderFormattedContent = (content: string, isStreaming: boolean = false) => {
    // Check for <test-indicator> block (format: <test-indicator>{"actions":["A","B"],"current":"B"}</test-indicator>)
    if (content.includes('<test-indicator>')) {
      const match = content.match(/<test-indicator>([^<]+)<\/test-indicator>/);
      let actions: string[] = ['Analysis'];
      let currentAction = 'Analysis';
      
      try {
        if (match && match[1]) {
          const data = JSON.parse(match[1]);
          actions = data.actions || ['Analysis'];
          currentAction = data.current || actions[actions.length - 1] || 'Analysis';
        }
      } catch (e) {
        console.error('Failed to parse test indicator', e);
      }
      
      // Get text before and after the tag
      const parts = content.split(/<test-indicator>[^<]+<\/test-indicator>/);
      const beforeText = parts[0] || '';
      const afterText = parts[1] || '';
      
      return (
        <div className="space-y-4">
          {/* Intro text */}
          {beforeText.trim() && renderTextContent(beforeText.trim(), isStreaming)}
          
          {/* Test Action Indicator (matches file indicator exactly) */}
          <CollapsibleTestIndicator 
            actions={actions} 
            currentAction={currentAction} 
            isGenerating={isStreaming}  // Use message's own state, not global
            isStreaming={isStreaming}
          />
          
          {/* Conclusion text (if any) */}
          {afterText.trim() && renderTextContent(afterText.trim(), isStreaming)}
        </div>
      );
    }

    

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
            return (
              <div key={idx} className="flex items-center gap-2.5" style={{ color: '#81888f' }}>
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
            return (
              <div key={idx} className="flex items-center gap-2.5" style={{ color: '#81888f' }}>
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

  // Handle Initial Prompt Display & UI Status (both chat mode and workbench mode)
  const initialPromptDisplayed = useRef(false);
  // True only when THIS mount is starting a genuinely fresh generation (a brand
  // new project). Stays false when we're merely returning to an existing project
  // from another page (e.g. /media) with ?prompt= still in the URL — which must
  // NOT re-trigger generation. Guards the fire-generation effect below so the
  // preview never re-enters the generation animation on back-navigation.
  const shouldFireInitialGenRef = useRef(false);
  useEffect(() => {
    if (prompt && !initialPromptDisplayed.current) {
      initialPromptDisplayed.current = true;

      const isNewProject = location.state?.isNewProject;
      
      // If we are returning from another page (like /media) to an existing session,
      // don't reset the stores and don't re-trigger the initial generation.
      if (isNewProject === false) {
        return;
      }

      // If it is a new project, clear the state flag so navigating away/back later doesn't reset it again
      if (isNewProject) {
        navigate(location.pathname + location.search, { replace: true, state: { ...location.state, isNewProject: false } });
      }

      // This mount is performing a genuine fresh generation (not a return to an
      // existing project) — allow the fire-generation effect below to run once.
      shouldFireInitialGenRef.current = true;

      // Reset stores for fresh session
      sandpackStore.reset();
      testStore.reset();

      // Clear animation tracking refs

      // Process initial attachments for display in user message
      const processInitialAttachments = async () => {
        const processedAttachments: { type: 'image' | 'text' | 'file'; mimeType: string; data: string; name?: string }[] = [];

        if (initialAttachments && initialAttachments.length > 0) {
          for (const att of initialAttachments) {
            if (!att.file) continue;
            try {
              if (att.type === 'image') {
                const base64 = await fileToBase64(att.file);
                processedAttachments.push({
                  type: 'image',
                  mimeType: att.file.type,
                  data: base64,
                  name: att.name
                });
              } else {
                const content = await readFileText(att.file);
                processedAttachments.push({
                  type: 'text',
                  mimeType: att.file.type || 'text/plain',
                  data: content,
                  name: att.name
                });
              }
            } catch (e) {
              // Skip failed attachment
            }
          }
        }

        // Show user message immediately (with attachments if any)
        const userMessage: ChatMessage = {
          id: 'initial-prompt',
          role: 'user',
          content: prompt,
          timestamp: Date.now(),
          attachments: processedAttachments.length > 0 ? processedAttachments : undefined
        };
        setMessages([userMessage]);

        // Clear attachments from the input area since they've been sent
        setAttachments([]);

        // Set generating/thinking status immediately
        setIsCurrentlyGenerating(true);
        setIsCurrentlyThinking(true);
        isCurrentlyThinkingRef.current = true;
        setCurrentThinkingTime(0);
        thinkingTimeRef.current = 0;
        thinkingStartTimeRef.current = Date.now();

        // Start timer immediately
        if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
        thinkingTimerRef.current = setInterval(() => {
          thinkingTimeRef.current += 1;
          setCurrentThinkingTime(thinkingTimeRef.current);
        }, 1000);
      };

      processInitialAttachments();
    }
  }, [prompt]);

  // Handle Initial AI Generation - Fire immediately since keys are loaded synchronously
  const initialAiTriggered = useRef(false);
  useEffect(() => {
    // shouldFireInitialGenRef gates out back-navigation returns: on a return to an
    // existing project the display effect above early-returns without setting it,
    // so we must not re-fire generation (which would show the stuck animation).
    if (prompt && !initialAiTriggered.current && messages.length > 0 && shouldFireInitialGenRef.current) {
      initialAiTriggered.current = true;

      // Process initial attachments for sending to AI
      const fireInitialGeneration = async () => {
        const processedAttachments: { type: 'image' | 'text' | 'file'; mimeType: string; data: string; name?: string }[] = [];

        if (initialAttachments && initialAttachments.length > 0) {
          for (const att of initialAttachments) {
            if (!att.file) continue;
            try {
              if (att.type === 'image') {
                const base64 = await fileToBase64(att.file);
                processedAttachments.push({
                  type: 'image',
                  mimeType: att.file.type,
                  data: base64,
                  name: att.name
                });
              } else {
                const content = await readFileText(att.file);
                processedAttachments.push({
                  type: 'text',
                  mimeType: att.file.type || 'text/plain',
                  data: content,
                  name: att.name
                });
              }
            } catch (e) {
              // Skip failed attachment
            }
          }
        }

        /*
         * The opening turn takes the same fork as every later one.
         *
         * This is the handoff from the landing composer, and it does not go
         * through `handleSendMessage`, so the routing there does not cover it.
         * Missing this is invisible in the worst way: the Agent tool reads as
         * selected, and the first prompt — the one that builds the project —
         * quietly runs the legacy loop instead.
         *
         * Read from the store rather than the `isAgent` render value: this fires
         * from an effect whose deps do not include it, so the closure could be
         * a render behind.
         */
        if (agentEngaged.get()) {
          startCodexGeneration(prompt, []);
        } else {
          startAiGeneration(prompt, [], true, processedAttachments); // true = UI already started
        }
      };

      fireInitialGeneration();
    }
  }, [prompt, messages]);

  const handleSendMessage = async (text: string) => {
    if (hasUnsaved) return; // Block sending when unsaved changes exist
    if (!text.trim() && attachments.length === 0) return;

    /*
     * Agent tool: a mode command submitted as a whole line.
     *
     * `/goal ship the checkout flow` is a complete instruction someone can type
     * and send without touching the menu, and `matchSlashCommands` stops
     * matching at the first space — so submission is the only place it can be
     * caught. Handled before anything else because a mode change is not a
     * message: nothing is added to the transcript and no turn starts.
     */
    if (isAgent) {
      const submitted = matchCommandSubmission(text);
      if (submitted?.command.action === 'plan-mode') {
        setCollaborationMode('plan');
        setPromptValue('');
        return;
      }
      if (submitted?.command.action === 'default-mode') {
        setCollaborationMode('default');
        setPromptValue('');
        return;
      }
      if (submitted?.command.action === 'goal-mode') {
        // A bare `/goal` with no objective is a request for the affordance, not
        // a goal. Leave the composer primed rather than starting an empty one —
        // upstream's `validate_thread_goal_objective` rejects it anyway.
        if (!submitted.argument) {
          setPromptValue('/goal ');
          return;
        }
        setPendingGoalObjective(submitted.argument);
        setPromptValue('');
        // Fall through with the objective as the prompt: the first goal turn is
        // an ordinary turn that happens to have a goal attached.
        text = submitted.argument;
      }
    }

    // Process attachments
    const processedAttachments: { type: 'image' | 'text' | 'file'; mimeType: string; data: string; name?: string }[] = [];
    
    for (const att of attachments) {
        if (!att.file) continue;
        
        try {
            if (att.type === 'image') {
                const base64 = await fileToBase64(att.file);
                processedAttachments.push({
                    type: 'image',
                    mimeType: att.file.type,
                    data: base64,
                    name: att.name
                });
            } else {
                // For text files
                const content = await readFileText(att.file);
                 processedAttachments.push({
                    type: 'text',
                    mimeType: att.file.type || 'text/plain',
                    data: content,
                    name: att.name
                });
            }
        } catch (e) {
            console.error('Failed to process file:', att.name, e);
        }
    }

    // Prepare image asset paths (don't store yet - only store if AI uses them in code)
    const imageAssetPaths: { name: string; path: string; dataUrl: string }[] = [];
    const currentFiles = workbenchStore.files.get();

    for (const att of processedAttachments) {
      if (att.type === 'image' && att.data) {
        const approxBytes = att.data.length * 0.75;
        if (approxBytes > MAX_IMAGE_SIZE_BYTES) {
          console.warn(`[Sidebar] Image ${att.name} too large (${(approxBytes / 1024 / 1024).toFixed(1)} MB), skipping`);
          continue;
        }

        const dataUrl = `data:${att.mimeType};base64,${att.data}`;
        const imagePath = getUniqueImagePath(att.name || 'image.png', currentFiles);
        imageAssetPaths.push({ name: att.name || 'image.png', path: imagePath, dataUrl });
        console.log(`[Sidebar] Prepared image asset path: ${att.name} -> ${imagePath}`);
      }
    }

    const userMessage: ChatMessage = {
      id: Math.random().toString(36).substring(7),
      role: 'user',
      content: text,
      timestamp: Date.now(),
      attachments: processedAttachments
    };

    // Batch ALL state updates in flushSync to prevent multiple re-renders
    // that would interfere with the scroll animation
    flushSync(() => {
      // In design mode, user message is added via startDesignGeneration instead
      if (activeTab !== 'canvas-screens') {
        setMessages(prev => [...prev, userMessage]);
      }

      // If the current session doesn't exist in sessions yet, create it on the first message
      if (currentSessionId && !sessions.some(s => s.id === currentSessionId)) {
        const newSession: ChatSession = {
          id: currentSessionId,
          name: 'New Chat',
          messages: [userMessage],
          filesSnapshot: currentFiles,
          activeSnapshotId: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        setSessions(prev => {
          const next = [newSession, ...prev];
          const storageKey = projectName ? `willow_chat_sessions_${projectName}` : 'willow_chat_sessions_default';
          persistSessions(storageKey, next);
          return next;
        });
      }

      setPromptValue('');
      setAttachments([]); // Clear attachments
      setRemovingIds(new Set());
      setIsCurrentlyGenerating(true);
      setIsCurrentlyThinking(true);
      setCurrentThinkingTime(0);
      setCurrentStreamingResponse('');
    });

    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';

    // Set refs directly (these don't cause re-renders)
    isCurrentlyThinkingRef.current = true;
    thinkingTimeRef.current = 0;
    thinkingStartTimeRef.current = Date.now();

    if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
    thinkingTimerRef.current = setInterval(() => {
      thinkingTimeRef.current += 1;
      setCurrentThinkingTime(thinkingTimeRef.current);
    }, 1000);

    // Route based on activeTab, selectedToolId, or isTestMode
    if (activeTab === 'canvas-screens') {
      // Design mode — isolated design generation
      await startDesignGeneration(text);
    } else if (selectedToolId === 'test' || isTestMode) {
      // In test mode, run the test
      await startTestGeneration(text);
    } else if (isAgent) {
      /*
       * Agent tool: the Codex harness runs this turn instead of the loop below.
       *
       * The only place the two paths diverge. Everything before this point —
       * the user message, the attachments, the thinking timer — is shared, and
       * with the tool off this branch is skipped entirely.
       */
      await startCodexGeneration(text, imageAssetPaths);
    } else {
      // Normal code generation - Trigger generation with history
      const history: AiChatMessage[] = messages.map(m => ({
          role: m.role,
          content: m.content
      }));
      // Pass processedAttachments for the NEW message
      await startAiGeneration(text, history, true, processedAttachments, imageAssetPaths);
    }
  };

  /**
   * Runs one turn on the Codex harness — the Agent tool's generation path.
   *
   * A sibling of `startAiGeneration`, not a replacement for it. Everything the
   * legacy loop does here — the bolt system prompt, the codebase context block,
   * the streaming artifact parser — belongs to that loop and is deliberately
   * absent: the harness builds its own prompt from the vendored Codex text,
   * sends a file manifest rather than the whole codebase, and applies edits as
   * V4A patches instead of whole-file rewrites.
   *
   * Attachments are not forwarded. `runCodexTurn` has no channel for them, so a
   * turn started with images attached sends the prose only. Images the user
   * dropped are still written into the project as assets below, exactly as in
   * the legacy path.
   *
   * See features/code/src/agent/harness/AGENTS.md.
   */
  const startCodexGeneration = async (
    text: string,
    imageAssetPaths: { name: string; path: string; dataUrl: string }[] = [],
  ) => {
    generationAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    generationAbortControllerRef.current = abortController;
    const runId = ++generationRunIdRef.current;
    const isCurrentRun = () => generationRunIdRef.current === runId;

    const turnId = nextTurnId();
    setActiveCodexTurn(turnId);

    let responseText = '';
    const assistantId = Math.random().toString(36).substring(7);

    workbenchStore.isGenerating.set(true);

    // The harness owns the turn; the sidebar owns the message body. Prose
    // arrives through `onText` and everything else lands in the activity store.
    const harnessHistory: Message[] = messages.map((message) => ({
      id: message.id,
      role: message.role,
      blocks: [{ type: 'text' as const, id: message.id, content: message.content }],
      createdAt: message.timestamp,
    }));

    await runCodexTurn({
      turnId,
      prompt: text,
      history: harnessHistory,
      workbench: workbenchStore as unknown as WorkbenchFiles,
      modelConfig,
      selectedModelId,
      apiKeys,
      effort: codexEffort,
      /*
       * Plan mode and Goal mode, as upstream defines them.
       *
       * `mode` selects the vendored `<collaboration_mode>` document and, with
       * it, the whole of Plan mode's behaviour: `update_plan` refused, mutation
       * declined, `request_user_input` available, the plan delivered as a
       * `<proposed_plan>` block.
       *
       * `goal` is separate and composes with the mode — a goal is normally
       * pursued in Default mode. `resume` is what makes continuations survive a
       * reload, and it is only passed while the goal is still live: handing
       * back a `complete` goal would let `create_goal` fire against a finished
       * one.
       */
      mode,
      goal:
        pendingGoalObjectiveRef.current || goalIsRunning(goal)
          ? {
              objective: pendingGoalObjectiveRef.current ?? undefined,
              resume: goalIsRunning(goal) ? goal : null,
            }
          : undefined,
      onGoal: setThreadGoal,
      requestUserInput: requestUserInputSink,
      /*
       * The shared skill library — the skills the user added in Spark → Skills.
       *
       * Read at send time rather than through `useStore`: this is not rendered,
       * and subscribing would re-render the whole sidebar every time Spark
       * touched its state. The harness wants a snapshot for the turn anyway.
       *
       * The scope is passed because the library loads itself on first read.
       * Spark's own state is only hydrated by `SparkWorkspace`, so without this
       * the Agent would silently get no skills in any session where the user
       * had not opened the Spark tab — and would start working later for no
       * visible reason.
       */
      skills: enabledSkills(chatScopeId || 'guest'),
      /*
       * Tools from MCP servers the user has connected and enabled.
       *
       * Read at send time, like the skills above: this is not rendered, and a
       * subscription would re-render the sidebar on every connection status
       * change. A turn wants a snapshot anyway.
       */
      mcpTools: boundMcpTools(),
      signal: abortController.signal,
      onText: (chunk) => {
        if (abortController.signal.aborted || !isCurrentRun()) return;

        // The first token ends the thinking phase, exactly as in the legacy loop.
        if (isCurrentlyThinkingRef.current) {
          const elapsedMs = thinkingStartTimeRef.current
            ? Date.now() - thinkingStartTimeRef.current
            : 0;
          thinkingTimeRef.current = Math.ceil(elapsedMs / 1000);
          setCurrentThinkingTime(thinkingTimeRef.current);
          isCurrentlyThinkingRef.current = false;
          setIsCurrentlyThinking(false);
          if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
        }

        responseText += chunk;
        setCurrentStreamingResponse(responseText);
      },
      onDone: ({ reason, error, text: finalText }) => {
        if (!isCurrentRun()) return;

        // Consumed. Leaving it set would start a *second* goal on the next
        // ordinary message, with the previous turn's objective.
        setPendingGoalObjective(null);

        // The harness's cleaned transcript, not the raw stream: file contents
        // the model wrote as prose have been re-sent as a patch, and the
        // original block is replaced so the message does not show the same file
        // twice.
        responseText = finalText || responseText;

        if (reason === 'cancelled') {
          // A question left outstanding would block every later turn behind a
          // prompt whose card is no longer on screen.
          dismissUserInput();
          setCurrentStreamingResponse('');
          setIsCurrentlyGenerating(false);
          setIsCurrentlyThinking(false);
          setActiveCodexTurn(null);
          if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
          workbenchStore.isGenerating.set(false);
          return;
        }

        if (reason === 'error' && error) {
          const isApiKeyError = /api.?key/i.test(error) && /missing|not configured/i.test(error);
          addGlobalError(error, isApiKeyError ? 'set-api-key' : undefined);
        }

        // A turn changed code if the harness emitted an edit, which is more
        // reliable than pattern-matching the prose for artifact tags.
        const edits = turnCalls(turnId).filter(
          (call) => call.kind === 'edit' || call.kind === 'create' || call.kind === 'delete',
        );

        const assistantMessage: ChatMessage = {
          id: assistantId,
          role: 'assistant',
          content: responseText,
          thinkingTime: thinkingTimeRef.current,
          hasCodeChanges: edits.length > 0,
          codexTurnId: turnId,
          timestamp: Date.now(),
        };

        setMessages((prev) => [...prev, assistantMessage]);
        setCurrentStreamingResponse('');
        setCurrentThinkingTime(0);
        setIsCurrentlyGenerating(false);
        setIsCurrentlyThinking(false);
        setActiveCodexTurn(null);

        // Only keep images the model actually referenced.
        for (const img of imageAssetPaths) {
          if (responseText.includes(img.path)) workbenchStore.setFile(img.path, img.dataUrl);
        }

        if (assistantMessage.hasCodeChanges) {
          const snapshot: Record<string, string> = {};
          Object.entries(workbenchStore.files.get()).forEach(([path, file]: [string, any]) => {
            snapshot[path] = file.content;
          });
          setMessages((prev) =>
            prev.map((msg) => (msg.id === assistantId ? { ...msg, filesSnapshot: snapshot } : msg)),
          );
          workbenchStore.activeSnapshotId.set(assistantId);
        }

        workbenchStore.isGenerating.set(false);
      },
    });

    if (generationAbortControllerRef.current === abortController) {
      generationAbortControllerRef.current = null;
    }
  };

  const startAiGeneration = async (text: string, history: AiChatMessage[], uiAlreadyStarted: boolean, currentAttachments: { type: 'image' | 'text' | 'file'; mimeType: string; data: string; name?: string }[] = [], imageAssetPaths: { name: string; path: string; dataUrl: string }[] = []) => {
    generationAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    generationAbortControllerRef.current = abortController;
    const runId = ++generationRunIdRef.current;
    const isCurrentRun = () => generationRunIdRef.current === runId;

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
      let provider: 'gemini' | 'openai' | 'anthropic' | 'moonshot' | 'spacexai' | 'zhipuai' = 'gemini';
      let modelId = '';

      const allSavedModels = [
        ...(modelConfig.gemini?.savedModels || []).map((m: any) => ({ ...m, provider: 'gemini' })),
        ...(modelConfig.openai?.savedModels || []).map((m: any) => ({ ...m, provider: 'openai' })),
        ...(modelConfig.anthropic?.savedModels || []).map((m: any) => ({ ...m, provider: 'anthropic' })),
        ...(modelConfig.moonshot?.savedModels || []).map((m: any) => ({ ...m, provider: 'moonshot' })),
        ...(modelConfig.spacexai?.savedModels || []).map((m: any) => ({ ...m, provider: 'spacexai' })),
        ...(modelConfig.zhipuai?.savedModels || []).map((m: any) => ({ ...m, provider: 'zhipuai' }))
      ];

      const selected = allSavedModels.find(m => m.id === selectedModelId);
      if (selected) {
        provider = selected.provider as 'gemini' | 'openai' | 'anthropic' | 'moonshot' | 'spacexai' | 'zhipuai';
        modelId = selected.modelId;
      } else {
        // Fallback to default
        provider = 'gemini';
        modelId = (modelConfig.gemini?.model) || 'gemini-3.6-flash';
      }

      console.log(`Starting AI generation with ${provider} (${modelId})`);

      /* Endpoint, wire format and tool policy come from the live profile, never
         from the saved model — see `resolveProviderBinding`. */
      const binding = resolveProviderBinding(modelConfig, provider, selected);
      const bucketKeys = apiKeysForBinding(binding, provider, apiKeys);
      const apiKey = bucketKeys[0];
      if (!apiKey) {
        console.error(`Missing API key for provider ${provider}. Available keys:`, apiKeys);
        throw new Error(`API Key for ${provider} is missing. Please add it in settings.`);
      }

      // Add system prompt for Ship mode to get boltArtifact format
      const systemMessage: AiChatMessage = {
        role: 'user',
        content: `<system>${BOLT_SYSTEM_PROMPT}</system>\n\nRemember: Always respond with <boltArtifact> tags containing <boltAction> tags for files and commands.`
      };
      
      // Update history to match new AiChatMessage structure if needed, but for now just casting/passing
      // effectively, we want to construct the FINAL history that streamChat uses.
      
      // Build user content with image asset context if images were stored
      let userContent = text;
      if (imageAssetPaths.length > 0) {
        const imageLines = imageAssetPaths.map(img =>
          `- "${img.name}" is available at import path "${img.path}"`
        ).join('\n');
        userContent += `\n\n[Available image assets in the project - use these import paths to reference the attached images in code:\n${imageLines}\nUsage: import variableName from '${imageAssetPaths[0].path}'; then use variableName as the src value or in url().]`;
      }

      // Build codebase context from current project files so AI knows existing code
      const currentFiles = workbenchStore.files.get();
      const fileEntries = Object.entries(currentFiles);
      let codebaseContext = '';
      if (fileEntries.length > 0) {
        // Keep prompts bounded. Sending an entire growing workbench eventually
        // causes provider truncation/400s and makes reopening a mature project
        // unreliable. Prefer source files, cap each file, then cap the total.
        const MAX_CONTEXT_CHARS = 180_000;
        const MAX_FILE_CHARS = 40_000;
        const rankedEntries = fileEntries
          .filter(([, file]: [string, any]) => file?.content !== undefined)
          .sort(([a], [b]) => {
            const score = (path: string) => /(^|[\\/])(src|app|components|lib)([\\/]|$)/i.test(path) ? 0 : /(^|[\\/])(public|assets|node_modules)([\\/]|$)/i.test(path) ? 2 : 1;
            return score(a) - score(b);
          });
        let contextChars = 0;
        const fileContents = rankedEntries.map(([path, file]: [string, any]) => {
          if (contextChars >= MAX_CONTEXT_CHARS) return '';
          const source = String(file.content);
          const content = source.length > MAX_FILE_CHARS
            ? `${source.slice(0, MAX_FILE_CHARS)}\n/* ...file truncated for context... */`
            : source;
          const entry = `### ${path}\n\`\`\`\n${content}\n\`\`\``;
          const remaining = MAX_CONTEXT_CHARS - contextChars;
          contextChars += Math.min(entry.length, remaining);
          return entry.length <= remaining
            ? entry
            : `${entry.slice(0, Math.max(0, remaining))}\n/* ...remaining files omitted for context... */`;
        }).filter(Boolean).join('\n\n');
        if (fileContents) {
          codebaseContext = `\n\nHere is the current project codebase. When the user asks for changes, ONLY modify the files and sections they mention. Do NOT rewrite or re-output files that don't need changes.\n\n${fileContents}`;
        }
      }

      const fullHistory = [
          systemMessage,
          // Inject codebase context so AI always knows existing code (even after "new chat")
          ...(codebaseContext ? [{
            role: 'user' as const,
            content: `[EXISTING PROJECT FILES — for reference only, do not rewrite unless asked]${codebaseContext}`
          }, {
            role: 'assistant' as const,
            content: 'I can see the existing project files. I\'ll only modify what you ask for and keep everything else intact. What would you like me to change?'
          }] : []),
          ...history,
          {
              role: 'user' as const,
              content: userContent,
              attachments: currentAttachments
          }
      ];

      let responseText = '';
      
      // Create streaming parser for realtime file creation
      const messageParser = workbenchStore.createMessageParser();
      workbenchStore.isGenerating.set(true);
      
      await streamChat(
        fullHistory,
        {
          provider,
          model: modelId,
          apiKey,
          thinkingLevel: selected?.thinkingLevel || 0,
          signal: abortController.signal,
          apiKeyFallbacks: bucketKeys.slice(1),
          ...binding,
        },
        (token) => {
          if (abortController.signal.aborted || !isCurrentRun()) return;
          // Use ref to avoid stale closure - state may not be updated yet
          if (isCurrentlyThinkingRef.current) {
            // Calculate actual elapsed time from start timestamp (more accurate than interval)
            const elapsedMs = thinkingStartTimeRef.current ? Date.now() - thinkingStartTimeRef.current : 0;
            const elapsedSeconds = Math.ceil(elapsedMs / 1000); // Round up to nearest second
            thinkingTimeRef.current = elapsedSeconds;
            setCurrentThinkingTime(elapsedSeconds);

            // Update ref and state
            isCurrentlyThinkingRef.current = false;
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

      if (!isCurrentRun()) return;
      const assistantMessage: ChatMessage = {
        id: Math.random().toString(36).substring(7),
        role: 'assistant',
        content: responseText,
        thinkingTime: thinkingTimeRef.current, // Use ref for accurate value
        hasCodeChanges: responseHasCodeChanges(responseText),
        timestamp: Date.now()
      };

      setMessages(prev => [...prev, assistantMessage]);
      setCurrentStreamingResponse('');
      setCurrentThinkingTime(0);
      setIsCurrentlyGenerating(false);
      setIsCurrentlyThinking(false);

      // Store only images that the AI actually referenced in its code
      if (imageAssetPaths.length > 0) {
        for (const img of imageAssetPaths) {
          if (responseText.includes(img.path)) {
            workbenchStore.setFile(img.path, img.dataUrl);
            console.log(`[Sidebar] Stored referenced image asset: ${img.path}`);
          }
        }
      }

      // Process AI response with bolt.diy workbench
      if (!isCurrentRun()) return;
      workbenchStore.isGenerating.set(true);
      try {
        await workbenchStore.processAIResponse(responseText);
        console.log('[Sidebar] Processed AI response with workbenchStore');
      } catch (err) {
        console.error('[Sidebar] Error processing response:', err);
      }
      if (!isCurrentRun()) return;

      // Flush any pending file edits (for batched edits during subsequent generations)
      await workbenchStore.flushPendingEdits();
      if (!isCurrentRun()) return;

      if (assistantMessage.hasCodeChanges) {
        const snapshot: Record<string, string> = {};
        Object.entries(workbenchStore.files.get()).forEach(([path, file]: [string, any]) => {
          snapshot[path] = file.content;
        });
        setMessages(prev => prev.map(msg => 
          msg.id === assistantMessage.id ? { ...msg, filesSnapshot: snapshot } : msg
        ));
        workbenchStore.activeSnapshotId.set(assistantMessage.id);
      }

      workbenchStore.isGenerating.set(false);

    } catch (error: any) {
      if (!isCurrentRun()) return;
      console.error('Chat error:', error);
      const errMsg = error.message || 'An error occurred during generation';
      if (isAbortError(error)) {
        setCurrentStreamingResponse('');
        setIsCurrentlyGenerating(false);
        setIsCurrentlyThinking(false);
        if (thinkingTimerRef.current) {
          clearInterval(thinkingTimerRef.current);
          thinkingTimerRef.current = null;
        }
        return;
      }
      const isApiKeyError = /api.?key/i.test(errMsg) && /missing/i.test(errMsg);
      addGlobalError(errMsg, isApiKeyError ? 'set-api-key' : undefined);
      setIsCurrentlyGenerating(false);
      setIsCurrentlyThinking(false);
      setNeedsScrollPadding(true);
      if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
    } finally {
      // Always clear the global generating flag so the preview can never get
      // stuck on the loading animation after a stream error/abort. Without this,
      // a failed generation left isGenerating=true forever (showFullLoading).
      if (isCurrentRun()) workbenchStore.isGenerating.set(false);
      if (generationAbortControllerRef.current === abortController) {
        generationAbortControllerRef.current = null;
      }
    }
  };

  const startDesignGeneration = async (text: string) => {
    generationAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    generationAbortControllerRef.current = abortController;
    const runId = ++generationRunIdRef.current;
    const isCurrentRun = () => generationRunIdRef.current === runId;
    // Build screen context from selected screens on the canvas
    let screenContext = '';
    if (selectedScreens.length > 0) {
      const screenParts = selectedScreens.map(s =>
        `Screen: "${s.fileName || 'App'}.tsx"\n\`\`\`tsx\n${s.code}\n\`\`\``
      );
      screenContext = `[The user has attached the following screen(s) from the canvas — they want to edit, reference, or build upon them:]\n${screenParts.join('\n\n')}\n\n`;
    }

    const userMessage: ChatMessage = {
      id: Math.random().toString(36).substring(7),
      role: 'user',
      content: text,
      timestamp: Date.now()
    };

    flushSync(() => {
      setDesignMessages(prev => [...prev, userMessage]);
      setDesignStreamingResponse('');
    });

    const assistantId = Math.random().toString(36).substring(7);
    let fullResponse = '';

    const aiMessages: AiChatMessage[] = designMessages.concat(userMessage).map(m => {
      let contentForAI = m.content;
      
      // If this was a past assistant message where we stripped the code, 
      // explicitly inject a massive fake code block to prove to the LLM that it generated code.
      // Otherwise, the LLM looks at its history, sees no code, and stops generating code!
      if (m.role === 'assistant' && m.designNodeId) {
        contentForAI = `\`\`\`tsx\n// Code generated successfully\n\`\`\`\n${m.content}`;
      } else {
        // Strip out any real code blocks from user/other to just a placeholder to save context
        contentForAI = contentForAI.replace(/```[\s\S]*?```/g, '```tsx\n// Code generated successfully\n```');
      }

      return {
        role: m.role,
        content: contentForAI
      };
    });

    // Prepend screen context to the last user message so the AI knows which screens are attached
    if (screenContext && aiMessages.length > 0) {
      const lastMsg = aiMessages[aiMessages.length - 1];
      if (lastMsg.role === 'user') {
        lastMsg.content = screenContext + lastMsg.content;
      }
    }

    try {
      let provider: 'gemini' | 'openai' | 'anthropic' | 'moonshot' | 'spacexai' | 'zhipuai' = 'gemini';
      let modelId = '';

      const allSavedModels = [
        ...(modelConfig.gemini?.savedModels || []).map((m: any) => ({ ...m, provider: 'gemini' })),
        ...(modelConfig.openai?.savedModels || []).map((m: any) => ({ ...m, provider: 'openai' })),
        ...(modelConfig.anthropic?.savedModels || []).map((m: any) => ({ ...m, provider: 'anthropic' })),
        ...(modelConfig.moonshot?.savedModels || []).map((m: any) => ({ ...m, provider: 'moonshot' })),
        ...(modelConfig.spacexai?.savedModels || []).map((m: any) => ({ ...m, provider: 'spacexai' })),
        ...(modelConfig.zhipuai?.savedModels || []).map((m: any) => ({ ...m, provider: 'zhipuai' }))
      ];

      const selected = allSavedModels.find((m: any) => m.id === selectedModelId);
      if (selected) {
        provider = selected.provider as 'gemini' | 'openai' | 'anthropic' | 'moonshot' | 'spacexai' | 'zhipuai';
        modelId = selected.modelId;
      } else {
        provider = 'gemini';
        modelId = (modelConfig.gemini?.model) || 'gemini-2.5-pro';
      }

      /* Endpoint, wire format and tool policy come from the live profile, never
         from the saved model — see `resolveProviderBinding`. */
      const binding = resolveProviderBinding(modelConfig, provider, selected);
      const bucketKeys = apiKeysForBinding(binding, provider, apiKeys);
      const apiKey = bucketKeys[0];
      if (!apiKey) {
        throw new Error(`API Key for ${provider} is missing. Please add it in settings.`);
      }

      // Stream silently — don't show streaming response in the chat.
      // User will only see a thinking indicator until generation completes.
      await streamChat(
        aiMessages,
        {
          provider: provider as any,
          model: modelId,
          apiKey: apiKey,
          thinkingLevel: selected?.thinkingLevel || 1,
          signal: abortController.signal,
          apiKeyFallbacks: bucketKeys.slice(1),
          ...binding,
        },
        (token) => {
          if (abortController.signal.aborted || !isCurrentRun()) return;
          if (isCurrentlyThinkingRef.current) {
            const elapsedMs = thinkingStartTimeRef.current ? Date.now() - thinkingStartTimeRef.current : 0;
            const elapsedSeconds = Math.ceil(elapsedMs / 1000);
            thinkingTimeRef.current = elapsedSeconds;
            setCurrentThinkingTime(elapsedSeconds);

            isCurrentlyThinkingRef.current = false;
            setIsCurrentlyThinking(false);
            if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
          }
          fullResponse += token;
          // Don't update designStreamingResponse — we show the response only once complete
        },
        () => { /* onStart */ },
        DESIGN_SYSTEM_PROMPT
      );

      if (!isCurrentRun()) return;
      // Extract code and add to canvas
      const code = extractDesignCode(fullResponse);
      let designNodeId: string | null = null;
      if (code) {
        // Save to codebase
        const fileName = generateDesignFileName(text);
        sandpackStore.setFile(`/Designs/${fileName}.tsx`, code);

        const node = addDesignNode({ prompt: text, code, fileName });
        designNodeId = node.id;
      }

      // Strip code blocks from the displayed message — only show the summary
      const summaryContent = fullResponse.replace(/```[\s\S]*?```/g, '').trim();

      // Add completed response to design messages with the linked design node ID
      flushSync(() => {
        setDesignMessages(prev => [...prev, {
          id: assistantId,
          role: 'assistant',
          content: summaryContent,
          thinkingTime: thinkingTimeRef.current,
          hasCodeChanges: !!code,
          timestamp: Date.now(),
          // Store the design node ID so we can render a clickable indicator
          designNodeId: designNodeId ?? undefined
        }]);
        setDesignStreamingResponse('');
        setCurrentThinkingTime(0);
        setIsCurrentlyGenerating(false);
        setIsCurrentlyThinking(false);
        if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
      });
      if (generationAbortControllerRef.current === abortController) {
        generationAbortControllerRef.current = null;
      }

    } catch (error: any) {
      if (!isCurrentRun()) return;
      const errMsg = error.message || 'Design generation failed';
      if (!isAbortError(error)) addGlobalError(errMsg);
      setCurrentThinkingTime(0);
      setIsCurrentlyGenerating(false);
      setIsCurrentlyThinking(false);
      setNeedsScrollPadding(true);
      if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
      if (generationAbortControllerRef.current === abortController) {
        generationAbortControllerRef.current = null;
      }
    }
  };

  // === TEST MODE FUNCTIONS ===
  const startTestGeneration = async (testPrompt: string) => {
    console.log('Starting Test Mode generation with:', testPrompt);
    const iframe = testStore.getIframeRef();
    if (!iframe) {
      // Add error message - no preview available
      const errorMessage: ChatMessage = {
        id: Math.random().toString(36).substring(7),
        role: 'assistant',
        hasCodeChanges: false,
        content: '⚠️ Cannot run test: Preview not available. Please generate some code first, then try testing again.',
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, errorMessage]);
      return;
    }

    // Create the assistant message immediately with a unique ID
    const messageId = Math.random().toString(36).substring(7);
    
    // Track plan text (shown first, before indicators)
    let planText = '';
    
    // Track whether testing has started (after plan is complete)
    let testingStarted = false;
    
    // Track actions for the indicator (starts empty, populated when testing begins)
    const actionsLog: string[] = [];
    let currentAction = '';
    
    // Helper to build the indicator JSON (only shown after testing starts)
    const buildIndicator = () => {
      if (!testingStarted || actionsLog.length === 0) return '';
      return `<test-indicator>${JSON.stringify({ actions: actionsLog, current: currentAction })}</test-indicator>`;
    };
    
    // Initial message is empty - plan text will be added
    const initialMessage: ChatMessage = {
      id: messageId,
      role: 'assistant',
      content: '',  // Will be populated by plan
      timestamp: Date.now(),
      isGenerating: true,  // Mark as generating to hide action buttons
      hasCodeChanges: false
    };
    
    // Smoothly add the assistant message without waiting (states already handled in handleSendMessage)
    setMessages(prev => [...prev, initialMessage]);

    // Start test state
    testStore.enterTestMode();
    testStore.startTest();

    try {
      if (!apiKeys?.gemini?.[0]) {
        throw new Error('Gemini API Key missing. Please add it in Settings -> Models & API.');
      }
      const apiKey = apiKeys.gemini[0];

      testStore.setStatus('testing');
      console.log('[Test] Starting Computer Use agent loop...');
      
      // Run the Computer Use agent loop
      const result = await runComputerUseTest(
        apiKey,
        testPrompt,
        iframe,
        (update: TestUpdate) => {
          console.log('[Test] Update:', update.type, update.message);
          
          // NOTE: Don't stop thinking animation here - keep it running until test is complete
          
          // Update action based on update type
          switch (update.type) {
            case 'plan':
              // Intro text received - show it WITHOUT indicator
              planText = update.message;
              // Keep thinking animation running!
              break;
              
            case 'thinking':
              // Only update indicator if testing has started
              if (testingStarted) {
                if (currentAction !== 'Analysis') {
                  currentAction = 'Analysis';
                  if (actionsLog[actionsLog.length - 1] !== 'Analysis') {
                    actionsLog.push('Analysis');
                  }
                }
              }
              break;
              
            case 'screenshot':
              // Screenshot means testing has started
              if (!testingStarted) {
                testingStarted = true;
                currentAction = 'Analysis';
                actionsLog.push('Analysis');
                
              }
              testStore.setStatus('capturing');
              currentAction = 'Capture';
              if (actionsLog[actionsLog.length - 1] !== 'Capture') {
                actionsLog.push('Capture');
              }
              break;
              
            case 'action':
              testingStarted = true;
              testStore.setStatus('executing-action');
              testStore.setCurrentAction(update.actionName || update.message);
              currentAction = update.actionType || 'Action';
              actionsLog.push(currentAction);
              break;
              
            case 'complete':
              testStore.setStatus('complete');
              testStore.setThought(null);
              break;
              
            case 'error':
              currentAction = 'Error';
              actionsLog.push('Error');
              testStore.setThought('Error!');
              break;
              
            case 'text':
              // AI commentary during testing - ignore for now
              break;
          }
          
          // Update message: Plan text + indicator (if testing started)
          const updatedContent = planText + (testingStarted ? '\n\n' + buildIndicator() : '');
          
          setMessages(prev => prev.map(msg =>
            msg.id === messageId
              ? { ...msg, content: updatedContent, thinkingTime: thinkingTimeRef.current, isGenerating: true, hasCodeChanges: false }
              : msg
          ));
        },
        // Pass conversation history for context (exclude the current message being built)
        messages.map(msg => ({ role: msg.role, content: msg.content })) as ConversationMessage[],
        () => testStore.isCancelled.get(),
        testStore.getAbortSignal()
      );

      console.log('[Test] Agent loop complete:', result);

      // Build final message: Intro + Indicator (persists!) + Conclusion
      // Just use the AI's natural explanation (it already states pass/fail)
      
      // Strip emojis from the model's explanation to keep it clean
      const cleanExplanation = (result.explanation || 'Test completed.')
        .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');

      const conclusionText = '\n\n' + cleanExplanation.trim();

      // Set result in store
      testStore.setResult({
        passed: result.passed,
        summary: result.explanation.substring(0, 200) + '...',
        suggestion: result.passed ? undefined : 'Review the test output for details.',
      });

      // Final message: Plan + Indicator (stays visible!) + Conclusion
      const finalContent = planText + '\n\n' + buildIndicator() + conclusionText;
      
      // Update message with isGenerating: false to show action buttons
      setMessages(prev => prev.map(msg => 
        msg.id === messageId 
          ? { ...msg, content: finalContent, thinkingTime: thinkingTimeRef.current, isGenerating: false, hasCodeChanges: false }
          : msg
      ));
      
      setCurrentStreamingResponse('');
      setIsCurrentlyGenerating(false);
      
      // Stop thinking animation now that test is complete
      if (thinkingTimerRef.current) {
        clearInterval(thinkingTimerRef.current);
      }
      setIsCurrentlyThinking(false);
      
      testStore.setStatus('complete');
      testStore.setCurrentAction(null);
      testStore.exitTestMode();
      
    } catch (error: any) {
      console.error('[Test] Error:', error);
      
      // Check if this was an abort/cancellation
      const wasCancelled = error.name === 'AbortError' || testStore.isCancelled.get();
      
      // Update the message with error state (same pattern as successful completion)
      setMessages(prev => prev.map(msg => 
        msg.id === messageId 
          ? { 
              ...msg, 
              content: wasCancelled 
                ? '*Test cancelled by user.*' 
                : `❌ Test Error: ${error.message || 'Failed to run test.'}`,
              thinkingTime: thinkingTimeRef.current,
              isGenerating: false,
              hasCodeChanges: false
            }
          : msg
      ));

      setIsCurrentlyGenerating(false);
      setIsCurrentlyThinking(false);
      setNeedsScrollPadding(true);
      if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
      testStore.setStatus('idle');
      testStore.setCurrentAction(null);
      testStore.exitTestMode(); // Disable test mode on error too
    }
  };


  useEffect(() => {
    return () => {
      if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
    };
  }, []);

  // Scroll logic - useLayoutEffect runs BEFORE browser paint, eliminating flash
  const lastPromptIds = useRef<{ default: string | null; design: string | null }>({ default: null, design: null });
  const isScrollingToTop = useRef(false);

  // True while the thread is still parked on the send anchor -- scrollTop sitting
  // at the bottom of a page the reserve is holding open. Updated on every scroll,
  // ours and the user's alike, so scrolling away by hand clears it and the resize
  // handler below leaves that position alone.
  const isPinnedToAnchor = useRef(false);

  // Last width the resize observer saw. Lives outside that effect because the
  // effect re-subscribes whenever the reserve changes, and a fresh observe()
  // delivers an immediate callback -- with the width kept per-observer, every send
  // would look like a width change on that first delivery.
  const lastObservedWidth = useRef<number | null>(null);

  useEffect(() => {
    const container = chatScrollRef.current;
    if (!container) return;
    const onScroll = () => {
      isPinnedToAnchor.current =
        container.scrollHeight - container.clientHeight - container.scrollTop <= 1;
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, []);

  // Park a prompt bubble on the send anchor. block:'start' aligns to the
  // scrollport's scroll-padding edge, which the container already sets per tab,
  // so scroll-margin only has to supply whatever that padding does not.
  const parkOnAnchor = React.useCallback((
    container: HTMLElement,
    msgEl: HTMLElement,
    offset: number,
    behavior: ScrollBehavior,
  ) => {
    const scrollPadTop = parseFloat(getComputedStyle(container).scrollPaddingTop) || 0;
    msgEl.style.scrollMarginTop = `${Math.max(0, offset - scrollPadTop)}px`;
    msgEl.scrollIntoView({ behavior, block: 'start', inline: 'nearest' });
  }, []);


  useEffect(() => {
    if (activeConversationMessages.length === 0) {
      setResponseAreaMinHeight(undefined);
      setNeedsScrollPadding(false);
      lastPromptIds.current[activeConversationMode] = null;
    }
  }, [activeConversationMessages.length, activeConversationMode]);

  React.useLayoutEffect(() => {
    if (chatScrollRef.current) {
        const container = chatScrollRef.current;
        const userMessages = activeConversationMessages.filter(m => m.role === 'user');
        const lastUserMessage = userMessages[userMessages.length - 1];

        if (lastUserMessage && lastUserMessage.id !== lastPromptIds.current[activeConversationMode]) {
            lastPromptIds.current[activeConversationMode] = lastUserMessage.id;
            isScrollingToTop.current = true;

            // Re-reserve for the NEW turn synchronously. Everything below happens in a
            // rAF, and until that frame runs the previous turn's reserve is still applied
            // -- sized for the previous bubble. If the frame never runs (a backgrounded
            // tab throttles rAF to zero), that stale height would be all we ever get.
            const syncMsgEl = messageRefs.current[lastUserMessage.id];
            if (syncMsgEl) {
              const syncGap = 48; // space-y-12 between message groups
              setResponseAreaMinHeight(Math.max(
                0,
                container.clientHeight - currentTargetVisualOffset - syncMsgEl.offsetHeight - syncGap,
              ));
              setNeedsScrollPadding(false);
            }

            // CRITICAL: Temporarily force overflow to auto so scroll can work
            container.style.overflow = 'auto';

            // Wait one frame for DOM to fully settle after state changes
            // (streaming div, suggestions collapse, etc.)
            requestAnimationFrame(() => {
                const msgEl = messageRefs.current[lastUserMessage.id];

                if (!msgEl || !container) {
                    isScrollingToTop.current = false;
                    return;
                }
                {
                    const targetVisualOffset = currentTargetVisualOffset;

                    // Reserve the response area BEFORE scrolling. The page has to
                    // already be tall enough or the scroll is clamped against a
                    // too-short page and the bubble never reaches the anchor.
                    // flushSync commits the height synchronously so the scroll
                    // below is measured against the reserved layout, not the old one.
                    const gap = 48; // space-y-12 between message groups
                    const preMinH =
                      container.clientHeight - targetVisualOffset - msgEl.offsetHeight - gap;
                    flushSync(() => {
                      setResponseAreaMinHeight(Math.max(0, preMinH));
                      setNeedsScrollPadding(false);
                    });

                    // Hand the movement to the browser, exactly as Chat does. The
                    // old path jumped 85% of the distance instantly and eased only
                    // the last 15% over a fixed 200ms, so a short scroll looked
                    // like a snap and a long one still took 200ms -- native smooth
                    // scrolling is distance-aware, which is the difference you see.
                    //
                    // block:'start' aligns to the scrollport's scroll-padding edge,
                    // and the container already carries scroll-pt-* for this tab
                    // (see the chatScrollRef className), so the anchor offset is
                    // applied for free. scroll-margin-top would stack on top of it
                    // and land the bubble at twice the offset. Where the two ever
                    // disagree, the margin makes up only the difference.
                    parkOnAnchor(container, msgEl, targetVisualOffset, 'smooth');
                    // Claim the anchor for this turn up front: a layout change
                    // during the scroll must still count as parked, and the
                    // landing scroll event will confirm it either way.
                    isPinnedToAnchor.current = true;
                    isScrollingToTop.current = false;
                }
            });
        }
    }
  }, [activeConversationMessages, activeConversationMode, currentTargetVisualOffset]);

  // Recalculate response area min-height when container resizes
  useEffect(() => {
    if (!chatScrollRef.current) return;
    const container = chatScrollRef.current;

    const observer = new ResizeObserver(() => {
      // Border box, not clientWidth: a scrollbar appearing when the reserve makes
      // the page scrollable changes clientWidth without the sidebar having moved,
      // and that must not read as a layout change.
      const width = container.offsetWidth;
      const widthChanged = lastObservedWidth.current !== null && width !== lastObservedWidth.current;
      lastObservedWidth.current = width;

      // Only recalculate if we have a previous value (scroll animation has run)
      if (responseAreaMinHeight === undefined) return;

      const userMessages = activeConversationMessages.filter(m => m.role === 'user');
      const lastUserMsg = userMessages[userMessages.length - 1];
      if (!lastUserMsg) return;

      const msgEl = messageRefs.current[lastUserMsg.id];
      if (!msgEl) return;

      const targetVisualOffset = currentTargetVisualOffset;

      const gap = 48;
      const minH = container.clientHeight - targetVisualOffset - msgEl.offsetHeight - gap;

      // A width change re-wraps every bubble and moves the anchor, but it leaves
      // scrollTop exactly where it was. That is the chat -> code morph: the
      // sidebar goes from 800px to the workbench width mid-turn, the prompt grows
      // taller as it re-wraps, and the turn that was parked on the anchor ends up
      // hundreds of pixels short of it with that much dead space underneath. The
      // reserve alone cannot fix it -- the scroll position has to move too.
      //
      // flushSync commits the new reserve first, so the re-park is measured
      // against the page it is about to land on rather than the old one, exactly
      // as the send path does. Instant, not smooth: the observer fires on every
      // frame of the morph, so per-frame parking keeps the bubble glued to the
      // anchor while the layout animates instead of chasing it.
      //
      // Gated on the width having actually changed, because this observer watches
      // the footer too and the footer's height animates on every send. Re-parking
      // on those frames issued an instant scroll into the middle of the send's
      // smooth one, which cancels it -- the bubble reached the anchor in a single
      // frame and the slide-up was gone. Height changes never move the anchor
      // sideways, so they need the reserve recomputed and nothing else.
      const repark = widthChanged && isPinnedToAnchor.current && !needsScrollPadding;
      flushSync(() => {
        setResponseAreaMinHeight(Math.max(0, minH));
      });
      if (repark) parkOnAnchor(container, msgEl, targetVisualOffset, 'instant');
    });

    observer.observe(container);
    if (footerRef.current) observer.observe(footerRef.current);
    return () => observer.disconnect();
  }, [
    activeConversationMessages,
    currentTargetVisualOffset,
    responseAreaMinHeight,
    needsScrollPadding,
    parkOnAnchor,
  ]);

  // Detect when response content overflows the allocated min-height.
  // When it does, re-enable bottom padding so the user can scroll past the input box.
  useEffect(() => {
    if (responseAreaMinHeight === undefined || needsScrollPadding) return;

    const checkOverflow = () => {
      // Check streaming content during generation
      const streamingEl = streamingContentRef.current;
      if (streamingEl && streamingEl.scrollHeight > responseAreaMinHeight + 5) {
        setNeedsScrollPadding(true);
        return;
      }

      // Check last assistant message after generation completes
      const lastMsg = activeConversationMessages[activeConversationMessages.length - 1];
      if (lastMsg?.role === 'assistant') {
        const el = messageRefs.current[lastMsg.id];
        if (el && el.scrollHeight > responseAreaMinHeight + 5) {
          setNeedsScrollPadding(true);
        }
      }
    };

    const observer = new ResizeObserver(checkOverflow);

    if (streamingContentRef.current) {
      observer.observe(streamingContentRef.current);
    }

    const lastMsg = activeConversationMessages[activeConversationMessages.length - 1];
    if (lastMsg?.role === 'assistant' && messageRefs.current[lastMsg.id]) {
      observer.observe(messageRefs.current[lastMsg.id]!);
    }

    // Initial check
    checkOverflow();

    return () => observer.disconnect();
  }, [responseAreaMinHeight, needsScrollPadding, activeConversationMessages, isCurrentlyGenerating]);

  // Tabs scroll check (renamed from scrollContainerRef)
  const handleScroll = () => {
    if (tabsScrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = tabsScrollRef.current;
      setShowLeftGradient(scrollLeft > 5);
      setShowRightGradient(scrollLeft < scrollWidth - clientWidth - 5);
    }
  };

  // Tools Menu State
  const [isToolsMenuOpen, setIsToolsMenuOpen] = useState(false);
  const [shouldRenderToolsMenu, setShouldRenderToolsMenu] = useState(false);
  const [isClosingToolsMenu, setIsClosingToolsMenu] = useState(false);
  // selectedToolId is declared at top of component (near line 260)
  const toolsMenuRef = useRef<HTMLDivElement>(null);

  // Models Menu State
  const [isModelsMenuOpen, setIsModelsMenuOpen] = useState(false);
  const [shouldRenderModelsMenu, setShouldRenderModelsMenu] = useState(false);
  const [isClosingModelsMenu, setIsClosingModelsMenu] = useState(false);
  const modelsMenuRef = useRef<HTMLDivElement>(null);

  const ALL_MODELS = collectSavedModels(modelConfig);

  const activeModel = ALL_MODELS.find((m: any) => m.id === selectedModelId);

  /*
   * Agent tool: reasoning effort on Codex's own ladder.
   *
   * Effort is part of the harness — upstream carries it as
   * `model_reasoning_effort` — and its ladder ends one rung past Willow's, at
   * Ultra. The numeric levels are still chosen through the shared model menu;
   * the menu's `extraEfforts` prop adds the Ultra row.
   *
   * Only the Ultra flag is stored — the numeric levels already live on the
   * selected model — and it is stored rather than held locally because the
   * landing composer offers the same choice. Both are `&& isAgent`: with the
   * tool off there is no Codex ladder, so the row is hidden and the pill shows
   * whatever it always showed.
   */
  const isUltra = useStore(ultraEngaged) && isAgent;
  const codexEffort = effectiveEffort(isUltra, activeModel?.thinkingLevel);

  const activeModelDisplayLabel = activeModel ? getShortName(activeModel.name) : 'Model';
  // No-thinking selections add nothing to the pill — see use-composer-models.
  // Ultra is not a level on `activeModel`, so it is named here instead; without
  // this the pill would keep showing whichever level Ultra was chosen over.
  const activeEffortDisplayLabel = isUltra
    ? EFFORT_LABEL.ultra
    : activeModel && !isNonThinkingEffort(activeModel)
      ? getThinkingEffortLabel(activeModel)
      : '';
  const activeModelAndEffortLabel = [activeModelDisplayLabel, activeEffortDisplayLabel]
    .filter(Boolean)
    .join(' ');

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
        ...(modelConfig.anthropic?.savedModels || []),
        ...(modelConfig.moonshot?.savedModels || []),
        ...(modelConfig.spacexai?.savedModels || []),
        ...(modelConfig.zhipuai?.savedModels || [])
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
    { id: 'plan', label: 'Plan', icon: FileText },
    { id: 'image', label: 'Image', icon: ImageIcon },
    { id: 'design', label: 'Design', icon: Palette },
    { id: 'annotate', label: 'Annotate', icon: AnnotateIcon },
    { id: 'prototype', label: 'Visual Edits', icon: VisualEditsIcon },
    { id: 'test', label: 'Test', icon: FlaskConical },
    /*
     * The Codex harness.
     *
     * Selecting it swaps this turn's generation path — `startCodexGeneration`
     * instead of `startAiGeneration` — and turns on the composer affordances
     * that only mean something to the harness: slash commands and the Ultra
     * effort rung. Tools are single-select, so picking Agent clears Test, and
     * clearing Agent puts the composer back exactly as it was.
     */
    { id: 'agent', label: 'Agent', icon: AgentIcon }
  ];

  const currentTool = selectedToolId ? TOOLS.find(t => t.id === selectedToolId) : null;

  const handleToolSelect = (toolId: string) => {
    console.log('[Sidebar] handleToolSelect called with:', toolId);
    setSelectedToolId(toolId);
    // Mirror into the store the harness and the landing composer both read.
    setAgentEngaged(toolId === 'agent');
    setIsToolsMenuOpen(false);
    // Note: Tools are now independent from tabs - no onTabChange calls
    // Design and Prototype still change tabs since they have dedicated panels
    if (toolId === 'design') onTabChange('design');
    if (toolId === 'prototype') onTabChange('design');
    // Test tool: test mode activates when AI starts analyzing (not on tool select)
    // So we don't call enterTestMode() here
  };

  const handleToolReset = (e: React.MouseEvent) => {
    e.stopPropagation();
    // If test is actively running, cancel it properly
    if (testStore.isTestMode.get()) {
      testStore.cancelTest(); // This sets isCancelled flag and exits test mode
    }
    setSelectedToolId(null);
    setAgentEngaged(false);
    // Don't change tabs - tools are independent from tabs
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

  // Display tool for the context header - strictly keeps the last non-preview tool to prevent "Preview" text during close animation
  const headerTool = React.useMemo(() => {
    const tool = ALL_TOOLS.find(t => t.id === activeTab);
    return tool && tool.id !== 'preview' ? tool : null;
  }, [activeTab]);

  // Use a ref to persist the tool info even when headerTool becomes null (during closing)
  const lastHeaderToolRef = useRef(headerTool);
  useEffect(() => {
    if (headerTool) {
      lastHeaderToolRef.current = headerTool;
    }
  }, [headerTool]);

  const showContextHeader = !!headerTool;
  const displayTool = headerTool || lastHeaderToolRef.current;


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

  // Cancel pending exit action if modal is closed via cancel
  useEffect(() => {
    if (!showExitModal) {
      setPendingExitAction(null);
    }
  }, [showExitModal]);

  // Auto-expand textarea upwards - throttled with RAF to prevent lag
  const textareaResizeRafRef = useRef<number | null>(null);
  useEffect(() => {
    if (textareaRef.current) {
      // Cancel any pending resize to avoid stacking
      if (textareaResizeRafRef.current) {
        cancelAnimationFrame(textareaResizeRafRef.current);
      }

      // Throttle resize to once per frame
      textareaResizeRafRef.current = requestAnimationFrame(() => {
        if (textareaRef.current) {
          // Batch reads first, then writes (avoid layout thrashing)
          textareaRef.current.style.height = 'auto';
          const scrollHeight = textareaRef.current.scrollHeight;
          const targetHeight = Math.max(44, Math.min(scrollHeight, 270));
          textareaRef.current.style.height = `${targetHeight}px`;
        }
        textareaResizeRafRef.current = null;
      });
    }

    return () => {
      if (textareaResizeRafRef.current) {
        cancelAnimationFrame(textareaResizeRafRef.current);
      }
    };
  }, [promptValue]);

  // Focus textarea on mount to keep keyboard/glowing ring active during swap
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, []);

  return (
    <>
      <UnsavedChangesModal 
        isOpen={showExitModal}
        onCancel={() => {
          setShowExitModal(false);
          setPendingExitAction(null);
          // Only revert if we are somehow not in design tab (failsafe)
          if (activeTab !== 'design' && sidebarView === 'visual-edit') {
            onTabChange('design');
          }
        }}
        onConfirm={() => {
          discardVisualChanges();
          setShowExitModal(false);
          setSidebarViewRaw('chat');
          exitVisualEdit();
          if (pendingExitAction) {
            // Execute the stored action (e.g. switch tab or toggle sidebar)
            // Use setTimeout to allow state updates to flush and prevent state clashes
            setTimeout(() => {
               pendingExitAction();
            }, 0);
            setPendingExitAction(null);
          }
        }}
      />
    <div 
      style={{ width: isChatMode ? '100%' : `${width}px` }} 
      className="flex flex-col h-full overflow-hidden relative bg-[#1c1c1c]"
    >
      {/* Design Header - Persistent across Design Tab and Visual Edit Mode */}
      {/* Renders when in Design tab OR within visual edit mode */}
      {(activeTab === 'design' || sidebarView === 'visual-edit') && !isChatMode && (
        <>
          {/* Background layer: sits at z-20, behind the scrolling menu (z-30) */}
          <div className="absolute inset-x-0 top-14 z-20 h-[40px] bg-[#1c1c1c] pointer-events-none">
          </div>

          {/* Content layer: sits at z-40, above the scrolling menu (z-30) to keep header text always on top */}
          <div className="absolute inset-x-0 top-14 z-40 px-6 pt-0 pb-3.5 flex items-center justify-between h-[52px] pointer-events-none">
             {/* Left side: Breadcrumbs */}
             <div className="flex items-center h-[32px] pointer-events-auto overflow-hidden">
                <button 
                  className={`text-base transition-colors duration-300 ${sidebarView === 'visual-edit' ? 'text-[#81888f] hover:text-white cursor-pointer' : 'text-white cursor-default'}`}
                  onClick={() => sidebarView === 'visual-edit' && handleExitVisualEdit()}
                >
                  Edit
                </button>
                
                <div className={`flex items-center transition-all duration-300 ease-out origin-left ${sidebarView === 'visual-edit' ? 'w-[105px] opacity-100 translate-x-0' : 'w-0 opacity-0 -translate-x-4'}`}>
                   <span className="text-[#81888f] mx-2">/</span>
                   <span className="text-white font-medium whitespace-nowrap">Visual edits</span>
                </div>
             </div>

             {/* Right side: Action Buttons (Only visible in Visual Edit) */}
             <div className={`flex items-center gap-2 pointer-events-auto transition-opacity duration-300 ${sidebarView === 'visual-edit' ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                 <button
                   className={`flex items-center gap-2 h-[32px] rounded-lg transition-colors text-[13px] font-medium ${isCompact ? 'w-[32px] justify-center' : 'px-3'} ${
                     canSelectParent
                       ? 'bg-[#27272a] hover:bg-[#3f3f46] text-gray-300 hover:text-white cursor-pointer'
                       : 'bg-[#27272a]/50 text-gray-500 cursor-not-allowed'
                   }`}
                   onClick={selectParentElement}
                   disabled={!canSelectParent}
                 >
                    <CornerLeftUp size={14} className="flex-shrink-0" />
                    {!isCompact && <span>Select parent</span>}
                 </button>
                 <button
                   className={`w-[32px] h-[32px] flex items-center justify-center rounded-lg transition-colors ${
                     hasUndo
                       ? 'bg-[#27272a] hover:bg-[#3f3f46] text-gray-300 hover:text-white cursor-pointer'
                       : 'bg-[#27272a]/50 text-gray-500 cursor-not-allowed'
                   }`}
                   onClick={undoLastVisualEdit}
                   disabled={!hasUndo}
                 >
                    <CornerUpLeft size={16} />
                 </button>
             </div>
          </div>
        </>
      )}

      {/* Agents Header - Persistent across Agents Tab and Agent Builder Mode */}
      {(activeTab === 'agents' || activeTab === 'agent-builder') && !isChatMode && (
        <>
          {/* Background layer: sits at z-20, behind the scrolling menu (z-30) */}
          <div className="absolute inset-x-0 top-14 z-20 h-[40px] bg-[#1c1c1c] pointer-events-none">
          </div>

          {/* Content layer: sits at z-40, above the scrolling menu (z-30) to keep header text always on top */}
          <div className="absolute inset-x-0 top-14 z-40 px-6 pt-0 pb-3.5 flex items-center justify-between h-[52px] pointer-events-none">
             {/* Left side: Breadcrumbs */}
             <div className="flex items-center h-[32px] pointer-events-auto overflow-hidden">
                <button 
                  className={`text-base transition-colors duration-300 ${activeTab === 'agent-builder' ? 'text-[#81888f] hover:text-white cursor-pointer' : 'text-white cursor-default'}`}
                  onClick={() => activeTab === 'agent-builder' && onTabChange('agents')}
                >
                  Agents
                </button>
                
                <div className={`flex items-center transition-all duration-300 ease-out origin-left ${activeTab === 'agent-builder' ? 'w-[105px] opacity-100 translate-x-0' : 'w-0 opacity-0 -translate-x-4'}`}>
                   <span className="text-[#81888f] mx-2">/</span>
                   <span className="text-white font-medium whitespace-nowrap">Builder</span>
                </div>
             </div>
          </div>
        </>
      )}

      {/* Canvas Header - Persistent across Canvas Tab and its sub-modes */}
      {(activeTab === 'canvas' || activeTab === 'canvas-screens' || activeTab === 'canvas-elements') && !isChatMode && (
        <>
          {/* Background layer: sits at z-20, behind the scrolling menu (z-30) */}
          <div className="absolute inset-x-0 top-14 z-20 h-[40px] bg-[#1c1c1c] pointer-events-none">
          </div>

          {/* Content layer: sits at z-40, above the scrolling menu (z-30) to keep header text always on top */}
          <div className="absolute inset-x-0 top-14 z-40 px-6 pt-0 pb-3.5 flex items-center justify-between h-[52px] pointer-events-none">
             {/* Left side: Breadcrumbs */}
             <div className="flex items-center h-[32px] pointer-events-auto overflow-hidden">
                <button 
                  className={`text-base transition-colors duration-300 ${(activeTab === 'canvas-screens' || activeTab === 'canvas-elements') ? 'text-[#81888f] hover:text-white cursor-pointer' : 'text-white cursor-default'}`}
                  onClick={() => (activeTab === 'canvas-screens' || activeTab === 'canvas-elements') && onTabChange('canvas')}
                >
                  Design
                </button>
                
                <div className={`flex items-center transition-all duration-300 ease-out origin-left ${(activeTab === 'canvas-screens' || activeTab === 'canvas-elements') ? 'w-[105px] opacity-100 translate-x-0' : 'w-0 opacity-0 -translate-x-4'}`}>
                   <span className="text-[#81888f] mx-2">/</span>
                   <span className="text-white font-medium whitespace-nowrap">
                     {activeTab === 'canvas-screens' ? 'Screens' : 'Elements'}
                   </span>
                </div>
             </div>
          </div>
        </>
      )}

      {/* Header - Hidden in Chat Mode since WorkbenchView renders it at root level */}
      {!isChatMode && (
        <div className={`h-14 flex items-center justify-between z-20 flex-shrink-0 bg-[#1c1c1c]`}>
          <div className="flex items-center min-w-0 h-full" style={{ paddingLeft: '10px' }}>
            {/* Logo Button — Squircle hover background, studio home link */}
            <button 
              onClick={() => onHomeClick ? onHomeClick() : navigate('/')}
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
              {isGeneratingName ? (
                <MessageLoading className="scale-75" />
              ) : (
                <span className="font-semibold text-gray-200 truncate">{projectName || 'New Project'}</span>
              )}
              <ChevronDown size={14} className="text-gray-500 flex-shrink-0" />
            </div>
          </div>
          <div className="flex items-center gap-3 text-gray-400 flex-shrink-0" style={{ paddingRight: '16px' }}>
            <div className="flex items-center gap-1">
              <button onClick={handleNewChat} className="p-1.5 hover:text-white transition-colors" title="New Chat">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
              </button>
              <div className="relative flex items-center">
                <button 
                  ref={triggerRef}
                  onClick={() => setIsHistoryOpen(!isHistoryOpen)} 
                  className={`p-1.5 transition-colors relative flex items-center justify-center rounded-lg ${isHistoryOpen ? 'text-white bg-white/10' : 'hover:text-white'}`}
                  title="Chat History"
                >
                  <Clock size={16} />
                </button>
                {shouldRenderHistory && createPortal(
                  <div 
                    id="history-popover-portal"
                    style={{
                      position: 'fixed',
                      top: `${popoverPosition.top + 8}px`,
                      left: `${popoverPosition.left}px`,
                      boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.95), 0 0 40px -10px rgba(0, 0, 0, 0.8), 0 1px 0 0 rgba(255, 255, 255, 0.05) inset',
                    }}
                    className={`w-72 max-h-[400px] z-[1000] bg-[#1c1c1c] rounded-xl p-2 flex flex-col gap-1 ${isClosingHistory ? 'settings-fade-out' : 'settings-fade-in'}`}
                  >
                    <div className="px-3 py-2 flex items-center justify-between text-zinc-400">
                      <span className="text-[11px] font-semibold tracking-wider uppercase">History</span>
                      <span className="text-[10px] bg-[#27272a] px-1.5 py-0.5 rounded-full text-zinc-300 font-medium">{sessions.length} sessions</span>
                    </div>
                    <div className="flex flex-col gap-0.5 max-h-[300px] overflow-y-auto py-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                      {sessions.length === 0 ? (
                        <div className="p-4 text-center text-xs text-zinc-500 italic">
                          No history sessions
                        </div>
                      ) : (
                        [...sessions]
                          .sort((a, b) => b.updatedAt - a.updatedAt)
                          .map((session) => (
                            <div 
                              key={session.id}
                              onClick={() => handleSwitchSession(session.id)}
                              className={`group relative flex items-center justify-between p-2.5 rounded-lg transition-all duration-200 cursor-pointer select-none
                                ${session.id === currentSessionId 
                                  ? 'bg-[#27272a] text-white' 
                                  : 'hover:bg-[#27272a]/55 text-zinc-400 hover:text-white'
                                }`}
                            >
                              <div className="flex items-center gap-2 min-w-0 flex-1 pr-2">
                                <div className="w-3 flex items-center justify-center shrink-0 transition-all duration-300">
                                  {session.id === currentSessionId ? (
                                    <span className="text-[#2563eb] font-bold text-[14px] select-none leading-none">›</span>
                                  ) : (
                                    <div className="w-3 shrink-0" />
                                  )}
                                </div>
                                <div className="flex flex-col min-w-0">
                                  {namingSessionIds.has(session.id) ? (
                                    <div className="flex flex-col gap-1 w-28 py-0.5">
                                      <div className="h-3 bg-white/10 rounded animate-pulse w-full" />
                                      <div className="h-2 bg-white/5 rounded animate-pulse w-2/3" />
                                    </div>
                                  ) : (
                                    <span className="text-[13px] font-medium truncate">
                                      {session.name || 'New Chat'}
                                    </span>
                                  )}
                                  <span className="text-[10px] text-zinc-500 mt-0.5">
                                    {formatRelativeTime(session.updatedAt)}
                                  </span>
                                </div>
                              </div>
                              <button
                                onClick={(e) => handleDeleteSession(session.id, e)}
                                className="p-1 text-zinc-500 hover:text-red-400 rounded-lg hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all duration-200 shrink-0"
                                title="Delete Session"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M3 6h18"></path>
                                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                                </svg>
                              </button>
                            </div>
                          ))
                      )}
                    </div>
                  </div>,
                  document.body
                )}
              </div>
              <button onClick={() => sidebarView === 'visual-edit' ? handleExitVisualEdit(onToggle) : onToggle()} className="p-1.5 hover:text-white transition-colors"><PanelLeftClose size={16} /></button>
            </div>
          </div>
        </div>
      )}

      <div
        ref={chatScrollRef}
        className={`flex-1 space-y-8 min-h-0 hover-scrollbar overflow-y-auto
          ${responseAreaMinHeight !== undefined && !needsScrollPadding
            ? 'pb-0'
            : (showContextHeader ? 'pb-[290px]' : 'pb-[210px]')
          }
          ${isChatMode
            ? 'pl-0 pr-0 pt-[76px] scroll-pt-[76px]' // Scrollbar at far right in Chat Mode
            : (activeTab === 'design' || activeTab === 'agents' || activeTab === 'canvas')
              ? 'pl-[8px] pr-[2px] mr-[8.5px] pt-0 scroll-pt-0' // Zero padding-top to align header perfectly with absolute overlays
              : (activeTab === 'agent-builder' || sidebarView === 'visual-edit' || activeTab === 'canvas-screens' || activeTab === 'canvas-elements')
                ? 'pl-[27px] pr-[18.5px] mr-[8.5px] pt-[56px] scroll-pt-[56px]' // Standard chat padding, 56px pt to clear 40px header + 16px gap
                : 'pl-[27px] pr-[18.5px] mr-[8.5px] pt-5 scroll-pt-5'
          }`}
        style={{
          // During resize or when not generating: let browser maintain scroll position (auto)
          // During active scroll animation or when generating: disable anchoring (none)
          overflowAnchor: (isResizing || !isCurrentlyGenerating) ? 'auto' : 'none'
        }}
      >
        <div className={isChatMode ? 'max-w-[800px] mx-auto px-[27px] pr-[40px]' : ''}>
          {activeTab === 'design' && !isChatMode ? (
            <div className="space-y-4">
               {/* Spacer to maintain vertical position of cards precisely matching Visual Edits header height */}
               <div className="h-[40px]" />

               {/* Visual Edits Card */}
                <div
                  onClick={() => {
                    enterVisualEdit();
                    setSidebarView('visual-edit');
                    // onTabChange('preview'); // Keep preview switch to ensure elements are visible
                  }}
                  className="group bg-[#27272a] rounded-2xl p-[18px] cursor-pointer hover:ring-1 hover:ring-white/20 transition-shadow duration-200"
                >
                  <div className="flex flex-col gap-[14px]">
                     <div className="text-white">
                        <VisualEditsIcon size={20} />
                     </div>
                     <div className="flex items-end justify-between">
                        <div>
                           <div className="text-[16px] font-semibold text-white mb-1">Visual edits</div>
                           <div className="text-[14px] text-gray-400 font-medium">Select elements to edit and style visually</div>
                        </div>
                        <ChevronRight size={20} className="text-gray-500 group-hover:text-white transition-colors translate-y-[1px]" />
                     </div>
                  </div>
               </div>

               {/* Themes Card */}
               <div className="group bg-[#27272a] rounded-2xl p-[18px] cursor-pointer hover:ring-1 hover:ring-white/20 transition-shadow duration-200">
                  <div className="flex flex-col gap-[14px]">
                     <div className="text-white">
                        <Palette size={20} strokeWidth={1.5} />
                     </div>
                     <div className="flex items-end justify-between">
                        <div>
                           <div className="text-[16px] font-semibold text-white mb-1">Themes</div>
                           <div className="text-[14px] text-gray-400 font-medium">Browse and apply themes to your project</div>
                        </div>
                        <ChevronRight size={20} className="text-gray-500 group-hover:text-white transition-colors translate-y-[1px]" />
                     </div>
                  </div>
               </div>
            </div>
          ) : activeTab === 'agents' && !isChatMode ? (
            <div className="space-y-4">
               {/* Spacer to maintain vertical position of cards precisely matching Visual Edits header height */}
               <div className="h-[40px]" />

               {/* Builder Card */}
               <div
                 onClick={() => onTabChange('agent-builder')}
                 className="group bg-[#27272a] rounded-2xl p-[18px] cursor-pointer hover:ring-1 hover:ring-white/20 transition-shadow duration-200"
               >
                  <div className="flex flex-col gap-[14px]">
                     <div className="text-white flex items-center justify-between">
                        <AgentIcon size={20} />
                        <button
                          onClick={(e) => { e.stopPropagation(); requestedWorkflowId.set('__new__'); onTabChange('agent-builder'); }}
                          className="text-[12px] font-medium text-gray-400 hover:text-white transition-colors flex items-center gap-1"
                          title="Create a new workflow"
                        >
                          <Plus size={14} /> New
                        </button>
                     </div>
                     <div className="flex items-end justify-between">
                        <div>
                           <div className="text-[16px] font-semibold text-white mb-1">Builder</div>
                           <div className="text-[14px] text-gray-400 font-medium">Create and manage your AI Agents</div>
                        </div>
                        <ChevronRight size={20} className="text-gray-500 group-hover:text-white transition-colors translate-y-[1px]" />
                     </div>
                  </div>
               </div>

               {/* Library Card */}
               <div
                 onClick={() => setShowAgentLibrary((v) => !v)}
                 className="group bg-[#27272a] rounded-2xl p-[18px] cursor-pointer hover:ring-1 hover:ring-white/20 transition-shadow duration-200">
                  <div className="flex flex-col gap-[14px]">
                     <div className="text-white flex items-center justify-between">
                        <Library size={20} strokeWidth={1.5} />
                        <span className={`w-2 h-2 rounded-full ${abStatus === 'up' ? 'bg-green-400' : abStatus === 'down' ? 'bg-red-400' : 'bg-yellow-400'}`} title={`Backend ${abStatus}`} />
                     </div>
                     <div className="flex items-end justify-between">
                        <div>
                           <div className="text-[16px] font-semibold text-white mb-1">Library</div>
                           <div className="text-[14px] text-gray-400 font-medium">
                             {abStatus === 'down' ? 'Backend offline — start it to load agents' : `${abWorkflows.length} saved workflow${abWorkflows.length === 1 ? '' : 's'}`}
                           </div>
                        </div>
                        <ChevronRight size={20} className={`text-gray-500 group-hover:text-white transition-transform translate-y-[1px] ${showAgentLibrary ? 'rotate-90' : ''}`} />
                     </div>
                  </div>
               </div>

               {/* Saved workflows list */}
               {showAgentLibrary && (
                 <div className="flex flex-col gap-2 pl-1">
                   {abWorkflows.length === 0 && (
                     <div className="text-[13px] text-gray-500 px-2 py-1">
                       {abStatus === 'up' ? 'No saved workflows yet. Open the Builder to create one.' : 'Start the Agent Builder backend to see your workflows.'}
                     </div>
                   )}
                   {workflowActionError && (
                     <div className="rounded-lg bg-red-500/10 px-2.5 py-2 text-[12px] text-red-300">{workflowActionError}</div>
                   )}
                   {abWorkflows.map((w) => (
                     <div
                       key={w.id}
                       onClick={() => {
                         if (editingWorkflowId === w.id) return;
                         requestedWorkflowId.set(w.id);
                         onTabChange('agent-builder');
                       }}
                       className="group flex items-center justify-between gap-2 bg-[#232326] hover:bg-[#2c2c30] rounded-xl px-3.5 py-2.5 cursor-pointer transition-colors"
                     >
                       <div className="min-w-0 flex-1">
                         {editingWorkflowId === w.id ? (
                           <input
                             autoFocus
                             value={editingWorkflowName}
                             disabled={workflowActionBusy === w.id}
                             onClick={(event) => event.stopPropagation()}
                             onChange={(event) => setEditingWorkflowName(event.target.value)}
                             onKeyDown={(event) => {
                               if (event.key === 'Enter') event.currentTarget.blur();
                               if (event.key === 'Escape') setEditingWorkflowId(null);
                             }}
                             onBlur={() => void renameAgentWorkflow(w.id)}
                             className="h-7 w-full rounded-md border border-[#444] bg-[#18181a] px-2 text-[13px] text-white outline-none focus:border-[#666]"
                           />
                         ) : (
                           <div className="text-[14px] font-medium text-white truncate">{w.name}</div>
                         )}
                         <div className="text-[12px] text-gray-500">{w.nodeCount} nodes · {w.latestVersion > 0 ? `v${w.latestVersion}` : 'draft'}</div>
                       </div>
                       {workflowActionBusy === w.id ? (
                         <Loader2 size={15} className="shrink-0 animate-spin text-gray-400" />
                       ) : (
                         <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
                           <button type="button" title="Rename workflow" aria-label={`Rename ${w.name}`} onClick={(event) => { event.stopPropagation(); setEditingWorkflowId(w.id); setEditingWorkflowName(w.name); }} className="rounded-md p-1.5 text-gray-500 hover:bg-white/5 hover:text-white"><Pencil size={13} /></button>
                           <button type="button" title="Duplicate workflow" aria-label={`Duplicate ${w.name}`} onClick={(event) => { event.stopPropagation(); void duplicateAgentWorkflow(w.id); }} className="rounded-md p-1.5 text-gray-500 hover:bg-white/5 hover:text-white"><Copy size={13} /></button>
                           <button type="button" title="Delete workflow" aria-label={`Delete ${w.name}`} onClick={(event) => { event.stopPropagation(); void deleteAgentWorkflow(w.id, w.name); }} className="rounded-md p-1.5 text-gray-500 hover:bg-red-500/10 hover:text-red-400"><Trash2 size={13} /></button>
                         </div>
                       )}
                     </div>
                   ))}
                 </div>
               )}
            </div>
          ) : activeTab === 'canvas' && !isChatMode ? (
            <div className="space-y-4">
               {/* Spacer to maintain vertical position of cards precisely matching Visual Edits header height */}
               <div className="h-[40px]" />

               {/* Screens Card */}
               <div 
                 onClick={() => onTabChange('canvas-screens')}
                 className="group bg-[#27272a] rounded-2xl p-[18px] cursor-pointer hover:ring-1 hover:ring-white/20 transition-shadow duration-200"
               >
                  <div className="flex flex-col gap-[14px]">
                     <div className="text-white">
                        <Layout size={20} strokeWidth={1.5} />
                     </div>
                     <div className="flex items-end justify-between">
                        <div>
                           <div className="text-[16px] font-semibold text-white mb-1">Screens</div>
                           <div className="text-[14px] text-gray-400 font-medium">View and manage all your app screens</div>
                        </div>
                        <ChevronRight size={20} className="text-gray-500 group-hover:text-white transition-colors translate-y-[1px]" />
                     </div>
                  </div>
               </div>

               {/* Elements Card */}
               <div 
                 onClick={() => onTabChange('canvas-elements')}
                 className="group bg-[#27272a] rounded-2xl p-[18px] cursor-pointer hover:ring-1 hover:ring-white/20 transition-shadow duration-200"
               >
                  <div className="flex flex-col gap-[14px]">
                     <div className="text-white">
                        <Component size={20} strokeWidth={1.5} />
                     </div>
                     <div className="flex items-end justify-between">
                        <div>
                           <div className="text-[16px] font-semibold text-white mb-1">Elements</div>
                           <div className="text-[14px] text-gray-400 font-medium">View and manage all your app elements</div>
                        </div>
                        <ChevronRight size={20} className="text-gray-500 group-hover:text-white transition-colors translate-y-[1px]" />
                     </div>
                  </div>
               </div>
            </div>
           ) : (
          <div className="space-y-12">
            {activeConversationMessages.length === 0 && !prompt && (
              <div className="flex flex-col items-center justify-center text-center mt-12 mb-8">
                <div className="text-[#3f3f46] mb-6">
                  <GeminiLogo size={48} />
                </div>
                <h2 className="text-[19px] font-semibold text-gray-200 mb-10 text-center leading-snug">
                  What do you want to<br />build
                </h2>
                
                {suggestions && suggestions.length > 0 && (
                  <div className="flex flex-col items-center gap-4 w-full mx-auto">
                    {suggestions.slice(0, 3).map((promptText, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          if (isCurrentlyGenerating || !promptText) return;
                          handleSendMessage(promptText);
                        }}
                        className="text-center bg-[#27272a] hover:bg-[#3f3f46] px-5 py-2.5 rounded-full transition-all duration-200 group max-w-[90%]"
                      >
                        <div className="text-[14px] text-gray-300 font-medium leading-relaxed group-hover:text-white transition-colors">
                          {promptText}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {activeConversationMessages.map((msg, msgIndex) => {
              // Check if this is the last assistant message (needs min-height to prevent snap)
              const isLastAssistantMessage = msg.role === 'assistant' &&
                msgIndex === activeConversationMessages.length - 1;
              // The reserve is applied verbatim. Shrinking it once the response settles
              // would drop scrollHeight below the current scrollTop, and the browser's
              // clamp would drag the whole thread down off the anchor.
              const lastAssistantMinHeight = isLastAssistantMessage && responseAreaMinHeight !== undefined
                ? responseAreaMinHeight
                : undefined;
              // Revert/Preview bar. Hoisted because the collapsed case has to cancel
              // its own row gap as well as hide the bar.
              const showSnapshotActions = !msg.isGenerating && !msg.designNodeId &&
                msg.hasCodeChanges && msg.filesSnapshot && activeSnapshotId !== msg.id;

              return (
              <div
                key={msg.id}
                ref={el => { messageRefs.current[msg.id] = el; }}
                className="space-y-8"
              >
                {msg.role === 'user' ? (
                  <div className="flex justify-end -mr-[6px]">
                    <div className="flex flex-col items-end gap-2 max-w-[78%]">
                        {/* Attachments */}
                        {msg.attachments && msg.attachments.length > 0 && (
                            <div className="flex gap-2 flex-wrap justify-end">
                                {msg.attachments.map((att, idx) => (
                                    <div key={idx} className="shrink-0">
                                        {att.type === 'image' ? (
                                            <div className="w-16 h-16 rounded-xl overflow-hidden border border-white/10 bg-[#1c1c1c]">
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img 
                                                    src={`data:${att.mimeType};base64,${att.data}`} 
                                                    alt="Attachment" 
                                                    className="w-full h-full object-cover"
                                                />
                                            </div>
                                        ) : (
                                            <div className="h-[58px] bg-[#1c1c1c] rounded-xl flex items-center px-4 gap-3.5 border border-white/5 min-w-[180px]">
                                                <div className="text-gray-400 flex-shrink-0">
                                                    <Globe size={20} strokeWidth={1.5} />
                                                </div>
                                                <div className="flex flex-col justify-center min-w-0 h-full">
                                                    <span className="text-[13px] font-semibold text-gray-200 truncate max-w-[140px] leading-none mb-1">
                                                        {att.name || 'File'}
                                                    </span>
                                                    <span className="text-[10px] text-gray-500 font-medium uppercase tracking-wide leading-none">
                                                        {(att.name?.split('.').pop() || att.mimeType.split('/').pop() || 'FILE')}
                                                    </span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="bg-[#27272a] text-gray-200 px-4 py-3 rounded-2xl text-[15px] leading-relaxed shadow-sm">
                           {msg.content}
                        </div>
                    </div>
                  </div>
                ) : (
                  <div
                    className="space-y-4"
                    style={{
                      // Dynamic min-height fills the full remaining visible space for scroll.
                      // paddingBottom pushes content above the footer overlay so buttons stay visible.
                      // When needsScrollPadding is true (long response), pb on the scroll container handles it instead.
                      minHeight: lastAssistantMinHeight !== undefined
                        ? `${lastAssistantMinHeight}px`
                        : undefined,
                      paddingBottom: isLastAssistantMessage && responseAreaMinHeight !== undefined && !needsScrollPadding
                        ? `${footerRef.current?.offsetHeight || 210}px`
                        : undefined
                    }}
                  >
                    {/* Thinking indicator - show shimmer while generating, static when done */}
                    {msg.isGenerating ? (
                      <div className="flex items-center gap-2.5" style={{ color: '#81888f' }}>
                        <Lightbulb size={18} />
                        <TextShimmer className="text-[15.15px] font-medium" duration={1.5}>
                          Thinking
                        </TextShimmer>
                      </div>
                    ) : msg.thinkingTime !== undefined ? (
                      <div className="flex items-center gap-2.5" style={{ color: '#81888f' }}>
                        <Lightbulb size={18} />
                        <span className="text-[15.15px] font-medium">
                          Thought for {Math.round(msg.thinkingTime)}s
                        </span>
                      </div>
                    ) : null}

                    {/*
                      * The turn's timeline, for messages the Agent tool produced.
                      *
                      * The narration and the cards it refers to collapse
                      * together, leaving the closing paragraph — which is the
                      * answer — on its own.
                      *
                      * `fallback` is the whole stored message, used for every
                      * message the legacy loop produced (no `codexTurnId`) and
                      * for harness turns no longer in the session store, e.g.
                      * after a reload where only the message text survives. So
                      * this renders byte-identically to what it replaced
                      * whenever the Agent tool was not involved.
                      */}
                    <SettledTurnActivity
                      turnId={msg.codexTurnId}
                      renderText={(text, streaming) => (
                        <div className="text-gray-300 text-[15px] leading-[1.65]">
                          {renderFormattedContent(text, streaming)}
                        </div>
                      )}
                      fallback={
                        <div className="text-gray-300 text-[15px] leading-[1.65]">
                          {renderFormattedContent(msg.content, msg.isGenerating)}
                        </div>
                      }
                    />

                    {/* Design Indicator - clickable design card for design mode messages */}
                    {msg.designNodeId && !msg.isGenerating && (
                      <div className="pt-3">
                        <button
                          onClick={() => focusDesignNode(msg.designNodeId!)}
                          className="group flex items-center gap-3 w-full px-4 py-3 rounded-2xl bg-gradient-to-r from-[#1e1e2e] to-[#252535] border border-white/[0.08] hover:border-white/20 transition-all duration-200 text-left"
                        >
                          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center shrink-0">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-blue-400">
                              <rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" strokeWidth="1.5"/>
                              <path d="M8 12h8M12 8v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                            </svg>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-medium text-gray-200 group-hover:text-white transition-colors truncate">View Design</div>
                            <div className="text-[11px] text-gray-500">Click to highlight on canvas</div>
                          </div>
                          <ChevronRight size={16} className="text-gray-500 group-hover:text-gray-300 transition-colors shrink-0" />
                        </button>
                      </div>
                    )}

                    {/* Snapshot Action Buttons - Only show when message is fully generated and has a snapshot AND is not the current active state */}
                    {/*
                      The wrapper is always in the tree so the bar can animate open, and
                      space-y-4 gives every child a 16px row gap regardless of height --
                      so while collapsed it contributed a second 16px on top of the action
                      row's own, putting the divider 32px below the text but 16px above the
                      buttons. Cancelling it inline because space-y's selector outranks any
                      mt-* class here; margin is already in the transition, so it eases.
                    */}
                    <div
                      className={`grid transition-[grid-template-rows,margin] duration-300 ease-in-out ${showSnapshotActions ? 'grid-rows-[1fr] mt-2 mb-2' : 'grid-rows-[0fr] mt-0 mb-0'}`}
                      style={showSnapshotActions ? undefined : { marginTop: 0 }}
                    >
                      <div className="overflow-hidden">
                        <div className={`w-[95%] max-w-[420px] mx-auto px-5 py-2.5 bg-[#27272a] rounded-[12px] flex justify-center items-center gap-5 flex-wrap transition-[opacity,transform] duration-300 ease-in-out ${showSnapshotActions ? 'opacity-100 translate-y-0 shadow-lg' : 'opacity-0 -translate-y-4 shadow-none'}`}>
                          <button 
                            onClick={() => {
                              if (msg.filesSnapshot) {
                                workbenchStore.restoreFromSnapshot(msg.id, msg.filesSnapshot);
                              }
                            }}
                            className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-full bg-black/25 text-[13px] font-medium select-none group transition-all duration-200 flex-1 max-w-[160px] min-w-0 text-gray-200 hover:text-white hover:bg-black/40"
                          >
                            {width >= 330 && (
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-gray-400 group-hover:text-white transition-colors shrink-0">
                                <path d="M3 10H13C17.4183 10 21 13.5817 21 18V20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                <path d="M8 15L3 10L8 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            )}
                            Revert
                          </button>

                          <button 
                            disabled={previewSnapshot === msg.filesSnapshot}
                            onClick={() => {
                              if (msg.filesSnapshot) {
                                workbenchStore.setPreviewSnapshot(msg.filesSnapshot);
                              }
                            }}
                            className={`flex items-center justify-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-medium select-none group transition-all duration-200 flex-1 max-w-[160px] min-w-0 ${previewSnapshot === msg.filesSnapshot ? 'bg-black/10 text-gray-500 cursor-default' : 'bg-black/25 text-gray-200 hover:text-white hover:bg-black/40'}`}
                          >
                            {width >= 330 && (
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={`${previewSnapshot === msg.filesSnapshot ? 'text-gray-500' : 'text-gray-400 group-hover:text-white transition-colors'} shrink-0`}>
                                <rect x="5.5" y="5.5" width="13" height="13" rx="4" transform="rotate(45 12 12)" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                <path d="M10.5 9.5L14.5 12L10.5 14.5V9.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            )}
                            Preview
                          </button>
                        </div>
                      </div>
                    </div>


                    {/* Fallback for older messages that have code changes but no snapshot yet */}
                    {!msg.isGenerating && !msg.designNodeId && msg.hasCodeChanges && !msg.filesSnapshot && (
                      <div className="pt-2 pb-1 flex justify-center">
                        <button 
                          disabled
                          className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-white/10 text-gray-500 cursor-not-allowed text-[13px] font-medium select-none opacity-60"
                          title="This message was generated before Time Travel was enabled."
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-gray-500">
                            <rect x="5.5" y="5.5" width="13" height="13" rx="4" transform="rotate(45 12 12)" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M10.5 9.5L14.5 12L10.5 14.5V9.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                          Preview
                        </button>
                      </div>
                    )}

                    {/* Action buttons - only show when message is fully generated */}
                    {!msg.isGenerating && (
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
                    )}
                  </div>
                )}
              </div>
            );
            })}

            {/* Current Streaming / Thinking UI - Only for NORMAL messages (not test mode) */}
            {isCurrentlyGenerating && !testStore.isTestMode.get() && (
              <div
                ref={streamingContentRef}
                className="space-y-4"
                style={{
                  // Dynamic min-height fills the full remaining visible space for scroll.
                  // paddingBottom pushes content above the footer overlay.
                  minHeight: responseAreaMinHeight !== undefined
                    ? `${responseAreaMinHeight}px`
                    : undefined,
                  paddingBottom: responseAreaMinHeight !== undefined && !needsScrollPadding
                    ? `${footerRef.current?.offsetHeight || 210}px`
                    : undefined
                }}
              >
                <div className="flex items-center gap-2.5" style={{ color: '#81888f' }}>
                  <Lightbulb size={18} />
                  {isCurrentlyThinking ? (
                    <TextShimmer className="text-[15.15px] font-medium" duration={1.5}>
                      Thinking
                    </TextShimmer>
                  ) : (
                    <span className="text-[15.15px] font-medium">
                      Thought for {Math.round(currentThinkingTime)}s
                    </span>
                  )}
                </div>

                {/*
                  * The live timeline — the narration and every tool call, in
                  * the order they happened. Renders nothing at all unless a
                  * Codex turn is in flight, so the legacy streaming block below
                  * is the only thing on screen when the Agent tool is off.
                  */}
                <LiveTurnActivity
                  turnId={activeCodexTurn}
                  onStop={() => generationAbortControllerRef.current?.abort()}
                  renderText={(text, streaming) => (
                    <div className="text-gray-300 text-[15px] leading-[1.65]">
                      {renderFormattedContent(text, streaming)}
                    </div>
                  )}
                />

                {/* Suppressed for harness turns only: the timeline above already
                  * renders the prose, so leaving this on would show it twice. */}
                {!activeCodexTurn
                  && (activeConversationMode === 'design' ? designStreamingResponse : currentStreamingResponse) && (
                  <div className="text-gray-300 text-[15px] leading-[1.65]">
                    {renderFormattedContent(activeConversationMode === 'design' ? designStreamingResponse : currentStreamingResponse, true)}
                  </div>
                )}
              </div>
            )}
          </div>
          )}
        </div>
    </div>

      {/* Visual Edit Menu Overlay */}
      {sidebarView === 'visual-edit' && (
        <VisualEditMenu 
          isCompact={isCompact}
          onBack={() => {
            handleExitVisualEdit();
          }} 
        />
      )}

      {/* Footer Container */}
      <div ref={footerRef} className="absolute bottom-0 left-0 w-full z-30 pointer-events-none">
        {/* Gradient overlay - fades out when unsaved changes bar is visible */}
        <div className={`h-8 w-full bg-gradient-to-t from-[#1c1c1c] to-transparent transition-opacity duration-300 ${hasUnsaved ? 'opacity-0' : 'opacity-100'}`} />
        <div className="bg-[#1c1c1c] pointer-events-auto">
          {/* Unsaved Changes Bar - Only show in visual edit mode */}
          {/* Unsaved Changes Bar - Only show in visual edit mode */}
          {sidebarView === 'visual-edit' && (
            <>
              {/* Queue Bar - Stacked above Unsaved Changes */}
              <div
                className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${editQueue.length > 0 ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
                style={{ willChange: 'grid-template-rows' }}
              >
                <div className="overflow-hidden">
                  <div
                    className={`transition-opacity duration-300 ease-in-out ${editQueue.length > 0 ? 'opacity-100' : 'opacity-0'}`}
                    style={{ willChange: 'opacity' }}
                  >
                   <div className="px-2"> 
                    <div className="flex items-center justify-between px-4 bg-[#27272a] border border-white/5 rounded-full shadow-lg h-[46px]">
                      <div className="flex items-center gap-2.5 text-[13px] font-medium text-white">
                        <span>
                          {editQueue.length} {editQueue.length === 1 ? 'Prompt' : 'Prompts'} in queue
                        </span>
                      </div>
                    </div>
                   </div>
                  </div>
                </div>
              </div>
              
              <UnsavedChangesBar />
            </>
          )}

          {/* Grid collapses unless the preview tab is active */}
          {/* Uses deferredActiveTab to stagger animation and avoid layout thrashing */}
          <div
            className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${messages.length > 0 && activeTab === 'preview' && suggestionsVisible && !isCurrentlyGenerating ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
            style={{ willChange: 'grid-template-rows' }}
          >
            <div className="overflow-hidden">
              <div
                className={`relative transition-opacity duration-300 ease-in-out ${messages.length > 0 && activeTab === 'preview' && suggestionsVisible && !isCurrentlyGenerating ? 'opacity-100' : 'opacity-0'}`}
                style={{ willChange: 'opacity' }}
              >
                <div
                  ref={tabsScrollRef}
                  onScroll={handleTabsScroll}
                  className="flex gap-2 overflow-x-auto no-scrollbar px-[14px] scroll-smooth"
                >
                   {suggestions.length > 0 ? (
                     suggestions.map((text, i) => (
                       <button
                         key={i}
                         onClick={() => handleSendMessage(text)}
                         className="whitespace-nowrap px-4 py-2 rounded-xl bg-[#27272a] text-sm text-gray-200 hover:bg-[#3f3f46] transition-colors font-medium"
                       >
                         {text}
                       </button>
                     ))
                   ) : (
                     // Show placeholder buttons while no suggestions (maintains layout)
                     Array.from({ length: 5 }).map((_, i) => (
                       <div key={i} className="whitespace-nowrap px-4 py-2 rounded-xl bg-[#27272a] text-sm text-transparent font-medium select-none">
                         Loading...
                       </div>
                     ))
                   )}
                </div>
                <div className={`absolute top-0 right-0 w-12 h-full bg-gradient-to-l from-[#1c1c1c] to-transparent pointer-events-none transition-opacity duration-200 ${showRightGradient ? 'opacity-100' : 'opacity-0'}`} />
                <div className={`absolute top-0 left-0 w-12 h-full bg-gradient-to-r from-[#1c1c1c] to-transparent pointer-events-none transition-opacity duration-200 ${showLeftGradient ? 'opacity-100' : 'opacity-0'}`} />
              </div>
            </div>
          </div>

          <div className="px-[14px] pb-4 pt-4">

            <div className="bg-[#27272a] rounded-[26px] p-3.5 relative flex flex-col shadow-lg border border-white/5">
               <div
                 className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${showContextHeader ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
                 style={{ willChange: 'grid-template-rows' }}
               >
                 <div className="overflow-hidden">
                    <div className={`flex flex-col gap-3 pb-2 transition-opacity duration-300 ${showContextHeader ? 'opacity-100' : 'opacity-0'}`}>
                     {displayTool && (
                       <>
                          <button
                            onClick={() => {
                               // Intercept if in visual edit mode with unsaved changes
                               if (sidebarView === 'visual-edit') {
                                 handleExitVisualEdit(() => {
                                   if (testStore.isTestMode.get()) {
                                     testStore.cancelTest();
                                   }
                                   onTabChange('preview');
                                   setSelectedToolId(null);
                                 });
                                 return;
                               }
                               // Normal path (not in visual edit)
                               exitVisualEdit();
                               if (testStore.isTestMode.get()) {
                                 testStore.cancelTest();
                               }
                               setSidebarView('chat');
                               onTabChange('preview');
                               setSelectedToolId(null);
                             }}
                           className="flex items-center gap-2 text-[#a1a1aa] hover:text-white transition-colors text-sm font-medium self-start ml-1"
                         >
                           <ArrowLeft size={14} />
                           <span>Back to Chat</span>
                         </button>
                         
                         <div className="flex items-center gap-2 bg-[#3f3f46]/50 rounded-xl px-4 h-[44px] py-0 text-white flex-shrink-0 overflow-x-auto no-scrollbar max-w-full">
                             <div className="flex-shrink-0"><displayTool.icon size={18} /></div>
                             <span className="font-medium whitespace-nowrap flex-shrink-0">{displayTool.label}</span>
                             
                             {/* Visual Editor Element Indicator */}
                             {/* Visual Editor Element Indicator (Multi-selection support) */}
                             {sidebarView === 'visual-edit' && selectedEls.length > 0 && (
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                   {(() => {
                                      // Group elements by selection transaction (GroupId)
                                      // This ensures that a single click (selecting a stack) gets ONE pill,
                                      // but separate Ctrl+Clicks get separate pills even if same tag.
                                      const groups = selectedEls.reduce((acc, el, index) => {
                                        // Use selectionGroupId if available, otherwise fallback to unique index to separate
                                        const key = el.selectionGroupId || `legacy-${index}`;
                                        if (!acc[key]) {
                                          acc[key] = [];
                                        }
                                        acc[key].push(el);
                                        return acc;
                                      }, {} as Record<string, SelectedElement[]>);

                                      return Object.entries(groups).map(([key, groupEls]) => {
                                         // Use the tag name of the first element in the group
                                         const primaryEl = groupEls[0];
                                         const label = primaryEl.tagName.toLowerCase();
                                         
                                         return (
                                            <div 
                                              key={key} 
                                              onClick={(e) => {
                                                  e.stopPropagation(); // Prevent bubbling just in case
                                                  // Open the code for this family (using the primary element)
                                                  const el = groupEls[0];
                                                  if (el.sourceLocation) {
                                                      navigateToCode(
                                                          el.sourceLocation.fileName,
                                                          el.sourceLocation.line,
                                                          el.sourceLocation.column
                                                      );
                                                  } else if (el.componentFile) {
                                                      // Fallback to component file if specific location missing
                                                      navigateToCode(
                                                          el.componentFile.filePath,
                                                          1 // Default to top of file
                                                      );
                                                  }
                                              }}
                                              title="Click to open code, Hover icon to remove"
                                              className="group flex items-center justify-center gap-1.5 px-2 h-[21px] bg-[#1e40af] hover:bg-[#1e3a8a] cursor-pointer text-white rounded-full text-[11px] font-medium font-mono leading-none select-none flex-shrink-0 animate-in fade-in zoom-in-95 duration-200 transition-colors"
                                            >
                                              <div className="group-hover:hidden">
                                                <Scan size={12} className="stroke-dashed opacity-90 text-white" />
                                              </div>
                                              <div 
                                                className="hidden group-hover:block hover:bg-white/20 rounded-full"
                                                onClick={(e) => {
                                                  e.stopPropagation(); // Don't trigger navigation
                                                  const newSelection = selectedEls.filter(el => !groupEls.includes(el));
                                                  setSelectedElements(newSelection);
                                                }}
                                              >
                                                <X size={12} className="text-white" />
                                              </div>
                                              <span className="translate-y-[0.5px]">
                                                 {label}
                                              </span>
                                            </div>
                                         );
                                      });
                                   })()}
                                </div>
                             )}
                           </div>
                       </>
                     )}
                   </div>
                 </div>
               </div>

               {/* Attachments Area (includes screen selections + file/image attachments in one row) */}
               <div className={`grid transition-[grid-template-rows] duration-[250ms] ease-in-out ${hasVisibleAttachments ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                 <div className="overflow-hidden">
                   <div className={`flex gap-3 overflow-x-auto no-scrollbar pb-3 -mx-1 px-1 transition-[padding] duration-[250ms] ease-in-out ${showContextHeader ? 'pt-2' : 'pt-2'}`}>
                     {/* Screen attachments from canvas selection */}
                     {activeTab === 'canvas-screens' && displayedScreens.map((screen) => (
                       <div key={`screen-${screen.id}`} className={`relative group flex-shrink-0 transition-[opacity,transform] duration-200 ${fadingOutScreenIds.has(screen.id) ? 'opacity-0 scale-90' : 'opacity-100 scale-100'}`}>
                         <div className="relative">
                           <div className="w-16 h-16 rounded-2xl overflow-hidden border border-white/5 bg-[#0a0a0a]">
                             {screen.thumbnailUrl ? (
                               <img src={screen.thumbnailUrl} alt={screen.fileName || 'Screen'} className="w-full h-full object-cover object-top" />
                             ) : (
                               <div className="w-full h-full bg-[#0a0a0a] animate-pulse" />
                             )}
                           </div>
                           <button
                             onClick={() => {
                               selectedDesignNodeIds.set(selectedDesignIds.filter(id => id !== screen.id));
                             }}
                             className="absolute -top-1.5 -right-1.5 bg-[#27272a] text-gray-400 hover:text-white border border-white/10 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-all duration-200 shadow-xl z-10"
                           >
                             <X size={12} />
                           </button>
                         </div>
                       </div>
                     ))}
                     {/* File / image attachments */}
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

               {/*
                 * The Agent tool's slash-command menu.
                 *
                 * Anchored above the composer and only ever open while the
                 * draft is a bare `/word`, so it cannot appear mid-sentence.
                 * `slashMatches` is hard-empty unless the tool is selected, so
                 * this renders nothing at all otherwise.
                 */}
               {slashMatches.length > 0 && (
                 <div className="cb-root absolute bottom-full left-0 right-0 z-50 mb-2">
                   <div
                     className="overflow-hidden rounded-xl border border-[hsl(var(--cb-line))] bg-[hsl(var(--cb-overlay))] p-1"
                     style={{ boxShadow: '0 18px 44px -12px rgba(0,0,0,0.7)' }}
                   >
                     {slashMatches.map((command, index) => (
                       <button
                         key={command.name}
                         type="button"
                         onMouseEnter={() => setSlashIndex(index)}
                         onClick={() => applySlashCommand(command)}
                         className={`flex w-full items-baseline gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors duration-100 ${
                           index === slashIndex ? 'bg-[hsl(var(--cb-ink)/0.07)]' : ''
                         }`}
                       >
                         <span className="font-mono text-[12.5px] font-medium text-[hsl(var(--cb-ink))]">
                           {command.name}
                         </span>
                         <span className="min-w-0 flex-1 truncate text-[11.5px] text-[hsl(var(--cb-ink-faint))]">
                           {command.hint}
                         </span>
                       </button>
                     ))}
                   </div>
                 </div>
               )}

               <textarea
                  ref={textareaRef}
                  placeholder={hasUnsaved ? "Save or discard changes first..." : "Ask Willow..."}
                  className={`w-full bg-transparent text-gray-100 placeholder-gray-400 resize-none outline-none min-h-[44px] px-3 py-1.5 text-[16px] leading-relaxed font-normal overflow-y-auto transition-opacity duration-200 ${isChatMode ? 'text-lg' : ''} ${hasUnsaved ? 'opacity-40 pointer-events-none' : ''}`}
                  style={{ scrollbarGutter: 'stable' }}
                  value={promptValue}
                  onChange={(e) => setPromptValue(e.target.value)}
                  onKeyDown={(e) => {
                    // The slash menu claims the arrow keys, Tab and Enter while
                    // it is open, so a command can be picked without the message
                    // being sent underneath it. Never entered with the Agent
                    // tool off — `slashMatches` is empty then.
                    if (slashMatches.length > 0) {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setSlashIndex((index) => (index + 1) % slashMatches.length);
                        return;
                      }
                      if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setSlashIndex((index) => (index - 1 + slashMatches.length) % slashMatches.length);
                        return;
                      }
                      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                        e.preventDefault();
                        const picked = slashMatches[slashIndex];
                        if (picked) applySlashCommand(picked);
                        return;
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        setPromptValue('');
                        return;
                      }
                    }

                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage(promptValue);
                    }
                  }}
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
                      const newAttachments: Attachment[] = imageFiles.map(file => ({
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
                  disabled={hasUnsaved}
               />
               <div className="flex items-center justify-between pt-2">
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
                        disabled={hasUnsaved}
                        className={`p-2.5 rounded-full bg-[#3f3f46]/60 text-gray-300 hover:bg-[#3f3f46] hover:text-white transition-all flex-shrink-0 ${hasUnsaved ? 'opacity-40 pointer-events-none' : ''}`}
                     >
                        <Plus size={18} />
                     </button>
                     <div className="relative" ref={toolsMenuRef}>
                        {shouldRenderToolsMenu && (
                          <div 
                             style={{
                               boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.95), 0 0 40px -10px rgba(0, 0, 0, 0.8), 0 1px 0 0 rgba(255, 255, 255, 0.05) inset',
                             }}
                             className={`absolute bottom-full left-0 mb-2 w-40 bg-[#1c1c1c] rounded-xl overflow-hidden z-50 ${isClosingToolsMenu ? 'settings-fade-out' : 'settings-fade-in'}`}
                          >
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
                           disabled={hasUnsaved}
                           className={`flex items-center rounded-full transition-all text-[13px] font-medium flex-shrink-0 h-[36px]
                             ${currentTool
                                ? 'bg-[#3b82f6]/20 text-[#3b82f6] hover:bg-[#3b82f6]/30'
                                : 'bg-[#3f3f46]/60 text-gray-300 hover:bg-[#3f3f46] hover:text-white'
                             }
                             ${isCompact
                                ? (currentTool ? 'px-2.5 gap-2.5' : 'px-2.5')
                                : (currentTool ? 'pl-4 pr-2.5 gap-2.5' : 'px-4 gap-2')
                             }
                             ${isToolsMenuOpen ? 'bg-[#3f3f46] text-white' : ''}
                             ${hasUnsaved ? 'opacity-40 pointer-events-none' : ''}
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
                                  className="p-0.5 hover:bg-[#3b82f6]/30 rounded-full transition-colors cursor-pointer flex items-center justify-center"
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

                        {/*
                          * The collaboration-mode and goal indicators.
                          *
                          * Upstream puts both in the TUI footer
                          * (`CollaborationModeIndicator::Plan`,
                          * `GoalStatusIndicator`), and they are not decoration:
                          * Plan mode silently declines every edit, so a user who
                          * cannot see that they are in it experiences the agent
                          * refusing to work. Same for a goal — it starts turns
                          * nobody sent.
                          *
                          * Both are click-to-exit, because the mode document
                          * says the user can "easily switch out of Plan mode",
                          * and a mode with no visible way out is a trap.
                          */}
                        {isAgent && mode === 'plan' && (
                          <button
                            onClick={() => setCollaborationMode('default')}
                            disabled={hasUnsaved}
                            title="In Plan mode — exploring and designing, changing nothing. Click to start building."
                            className="flex h-[36px] shrink-0 items-center gap-2 rounded-full bg-[#a8c7fa]/15 px-3 text-[13px] font-medium text-[#a8c7fa] transition-colors hover:bg-[#a8c7fa]/25"
                          >
                            <FileText size={15} />
                            {!isCompact && <span>Plan</span>}
                            <X size={13} className="opacity-60" />
                          </button>
                        )}

                        {isAgent && goalIsRunning(goal) && goal && (
                          <button
                            onClick={() => setThreadGoal(null)}
                            disabled={hasUnsaved}
                            title={`Goal (${goal.status}): ${goal.objective}\n\nClick to stop pursuing it.`}
                            className="flex h-[36px] min-w-0 shrink items-center gap-2 rounded-full bg-[#3b82f6]/15 px-3 text-[13px] font-medium text-[#93c5fd] transition-colors hover:bg-[#3b82f6]/25"
                          >
                            <Target size={15} className="shrink-0" />
                            {!isCompact && (
                              <span className="truncate max-w-[140px]">{goal.objective}</span>
                            )}
                            <X size={13} className="shrink-0 opacity-60" />
                          </button>
                        )}
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
                            /*
                              * Ultra, appended to the thinking-effort list for
                              * every model — but only while the Agent tool is on.
                              *
                              * It is not one of Willow's numeric levels: upstream
                              * lowers it to the model's own ceiling on the wire and
                              * uses it to turn on proactive sub-agent delegation. So
                              * it is held in the Agent store rather than written into
                              * `selectedModelId` — a non-model id there would leave
                              * the Code tab unable to resolve the selection — and it
                              * means nothing to the legacy loop, which is why the row
                              * is absent when the tool is off.
                              */
                            extraEfforts={isAgent ? [
                              {
                                id: 'codex-ultra',
                                label: EFFORT_LABEL.ultra,
                                badge: 'Sub-agents',
                                selected: isUltra,
                                onSelect: () => setUltraEngaged(true),
                              },
                            ] : undefined}
                            onSelect={(id) => {
                              // Picking a level clears Ultra: the two are one radio
                              // group, so leaving it on would keep delegating after
                              // the user asked for something else.
                              setUltraEngaged(false);
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
                            onAuthRequired={onSettingsClick ? (() => onSettingsClick('models')) : undefined}
                            geminiStyle
                          />
                        )}
                      </div>
                       {isCurrentlyGenerating ? (
                         <button 
                           onClick={() => {
                              // Abort the active provider request. Merely clearing
                              // the local loading flag allowed late stream tokens
                              // to mutate the workbench after the user stopped.
                              generationRunIdRef.current += 1;
                              generationAbortControllerRef.current?.abort();
                              if (testStore.isTestMode.get()) testStore.cancelTest();
                              setCurrentStreamingResponse('');
                              setIsCurrentlyGenerating(false);
                              setIsCurrentlyThinking(false);
                              if (thinkingTimerRef.current) {
                                clearInterval(thinkingTimerRef.current);
                                thinkingTimerRef.current = null;
                              }
                              workbenchStore.isGenerating.set(false);
                              sandpackStore.isGenerating.set(false);
                           }}
                           className="w-[38px] h-[38px] rounded-full bg-[#3b82f6]/20 text-[#3b82f6] hover:bg-[#3b82f6]/30 transition-colors flex items-center justify-center shadow-md flex-shrink-0"
                         >
                           <div className="w-[14px] h-[14px] bg-current rounded-[3px]" />
                         </button>
                       ) : (
                         <button 
                            onClick={() => handleSendMessage(promptValue)}
                            disabled={hasUnsaved}
                            className={`w-[38px] h-[38px] rounded-full bg-[#d4d4d8] text-black hover:bg-white transition-all flex items-center justify-center shadow-md flex-shrink-0 ${hasUnsaved ? 'opacity-40 pointer-events-none' : ''}`}
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

      {/* Global Error Popups - rendered via portal to escape sidebar stacking context */}
      <GlobalErrorToasts
        globalErrors={globalErrors}
        dismissGlobalError={dismissGlobalError}
        onSettingsClick={onSettingsClick}
      />
    </>
  );
};

export default Sidebar;
