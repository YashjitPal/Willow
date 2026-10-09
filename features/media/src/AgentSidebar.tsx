import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, memo } from 'react';
import { flushSync } from 'react-dom';
import { Menu, Edit, X, Plus, ArrowRight, ArrowLeft, ChevronDown, Trash2, Check, FileText, ThumbsUp, ThumbsDown, Copy, TriangleAlert, ImageIcon, Film, Eye, LayoutGrid, UserRound, Clapperboard } from 'lucide-react';
import { motion } from 'framer-motion';
import { useStore } from '@nanostores/react';
import { StreamingMarkdown } from '@willow/ui/StreamingMarkdown';
import type { ImageAttachment, MediaItem } from './types';
import { PromptValue, type PromptStore } from './PromptTextarea';
import { MediaTilePreview } from './GalleryTile';
import { AgentLinkCards } from './agent/AgentLinkCards';
import { splitReplyAtCards } from './agent/agent-context';
import { AgentThinkingRow } from './agent/AgentThinkingRow';
import { AgentUserBubble } from './agent/AgentUserBubble';
import {
  pruneMissingMedia,
  stripMediaMarkdown,
  type AgentActivity,
  type AgentApproval,
  type AgentInstruction,
  type AgentMessage,
  type MediaAgent,
} from './agent/agent-session';
import type { AgentModelOption } from './agent/agent-tools';

export type { AgentInstruction } from './agent/agent-session';

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
  referenceThumb?: string;
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
  referenceThumb,
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
          className={`w-[72px] h-[72px] rounded-[12px] border flex flex-col items-center justify-center gap-1 transition-colors duration-200 cursor-pointer select-none shrink-0 relative group overflow-visible ${
            inst.referenceName
              ? 'border-white bg-[#2a2b2d] text-white hover:border-white'
              : 'border-dashed border-white/10 bg-[#2a2b2d] hover:border-white/40 hover:bg-[#333437] text-[#a0a0a0] hover:text-white'
          }`}
          title={inst.referenceName}
        >
          {inst.referenceName ? (
            <>
              {referenceThumb ? (
                <img src={referenceThumb} alt={inst.referenceName} className="absolute inset-0 w-full h-full object-cover rounded-[11px]" />
              ) : (
                <>
                  <FileText size={18} strokeWidth={2} />
                  <span className="text-[8px] font-medium tracking-tight truncate max-w-[60px] px-1">{inst.referenceName}</span>
                </>
              )}
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

/*
 * The composer's field. It subscribes to the shared prompt itself, so a keystroke in either
 * prompt box re-renders this field rather than the whole sidebar.
 */
const SidebarPromptField: React.FC<{
  store: PromptStore;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  isOpen: boolean;
  sidebarView: string;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
}> = ({ store, textareaRef, isOpen, sidebarView, onKeyDown, onPaste }) => {
  const prompt = useStore(store);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [textareaRef]);

  // Late fonts and the first frame of layout. Registered once, not per keystroke — each pass
  // forces a layout.
  useEffect(() => {
    const fonts = 'fonts' in document ? document.fonts : undefined;
    let live = true;
    const frame = requestAnimationFrame(adjustHeight);
    fonts?.ready.then(() => { if (live) adjustHeight(); });
    fonts?.addEventListener('loadingdone', adjustHeight);
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      fonts?.removeEventListener('loadingdone', adjustHeight);
    };
  }, [adjustHeight]);

  useEffect(() => {
    adjustHeight();
    const timer = setTimeout(adjustHeight, 200);
    return () => clearTimeout(timer);
  }, [prompt, isOpen, sidebarView, adjustHeight]);

  return (
    <textarea
      ref={textareaRef}
      value={prompt}
      onChange={(e) => store.set(e.target.value)}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      placeholder="What do you want to create?"
      rows={1}
      className="bg-transparent border-none outline-none text-[#e2e2e2] text-[14px] font-medium placeholder-[#606060] w-full px-2 pt-0.5 pb-1.5 resize-none overflow-y-auto no-scrollbar"
      style={{
        scrollbarWidth: 'none',
        msOverflowStyle: 'none'
      }}
    />
  );
};

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

const relativeTime = (timestamp: number): string => {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'Just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const activityIcon = (kind: AgentActivity['kind']) => {
  switch (kind) {
    case 'image': return <ImageIcon size={14} className="text-zinc-400 shrink-0" />;
    case 'video': return <Film size={14} className="text-zinc-400 shrink-0" />;
    case 'analyze': return <Eye size={14} className="text-zinc-400 shrink-0" />;
    case 'character': return <UserRound size={14} className="text-zinc-400 shrink-0" />;
    case 'scene': return <Clapperboard size={14} className="text-zinc-400 shrink-0" />;
    default: return <LayoutGrid size={14} className="text-zinc-400 shrink-0" />;
  }
};

const ApprovalCard: React.FC<{ approval: AgentApproval; onDecide: (approved: boolean) => void }> = ({ approval, onDecide }) => {
  const meta = [
    approval.modelName,
    approval.ratio,
    approval.duration,
    approval.kind === 'character' ? plural(approval.count, 'image') : '',
    approval.referenceCount ? plural(approval.referenceCount, approval.kind === 'video' ? 'frame' : 'reference') : '',
  ].filter(Boolean).join(' · ');
  return (
    <div className="rounded-[16px] bg-[#232426] border border-white/[0.06] p-3.5 flex flex-col gap-2.5 animate-in fade-in duration-200">
      <div className="flex items-center gap-2 text-[12.5px] font-medium text-white">
        {activityIcon(approval.kind)}
        <span>{approval.title ?? `Generate ${plural(approval.count, approval.kind)}?`}</span>
      </div>
      <p className="text-[12.5px] leading-relaxed text-[#c4c4c4] line-clamp-3 break-words">{approval.prompt}</p>
      <div className="text-[11px] text-[#8c8c8c]">{meta}</div>
      <div className="flex items-center justify-end gap-2 pt-0.5">
        <button
          type="button"
          onClick={() => onDecide(false)}
          className="px-3.5 py-1.5 rounded-full text-[12px] font-medium text-[#d0d0d0] hover:bg-white/5 hover:text-white transition-colors cursor-pointer outline-none"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={() => onDecide(true)}
          className="px-4 py-1.5 rounded-full text-[12px] font-semibold bg-white text-black hover:bg-zinc-200 transition-colors cursor-pointer outline-none"
        >
          {approval.kind === 'character' ? 'Create' : 'Generate'}
        </button>
      </div>
    </div>
  );
};

/** Work that shows as a card in the chat (media, a character, a scene) and so needs no status. */
const CARDED_ACTIVITIES = new Set<AgentActivity['kind']>(['image', 'video', 'character', 'scene']);

/*
 * Approvals and the thinking row for the reply being written. Subscribed on its own so phase and
 * tool changes re-render this block, not the transcript around it.
 */
const AgentLiveStatus: React.FC<{ agent: MediaAgent }> = ({ agent }) => {
  const turn = useStore(agent.$turn);
  const activities = useStore(agent.$activities);
  const approvals = useStore(agent.$approvals);
  if (!turn.running) return null;
  if (approvals.length) {
    return (
      <div className="flex flex-col gap-2.5">
        {approvals.map((approval) => (
          <ApprovalCard
            key={approval.id}
            approval={approval}
            onDecide={(approved) => agent.resolveApproval(approval.id, approved)}
          />
        ))}
      </div>
    );
  }
  // A generation's card is its progress; only a tool with nothing on screen gets a status.
  const uncarded = activities.find((a) => !CARDED_ACTIVITIES.has(a.kind));
  if (uncarded) return <AgentThinkingRow agent={agent} status={uncarded.label} />;
  if (!turn.waiting) return null;
  return <AgentThinkingRow agent={agent} status={turn.phase === 'searching' ? 'Searching the web' : null} />;
};

/** Chat media cards draw the canvas tile's own surfaces. Module-level so its identity is stable. */
const renderAgentMedia = (item: MediaItem | undefined) => <MediaTilePreview item={item} />;

interface MessageRowProps {
  message: AgentMessage;
  index: number;
  isLast: boolean;
  /** Off for rows that were already there when the conversation opened. */
  animateEntrance: boolean;
  agent: MediaAgent;
  mediaItems?: MediaItem[];
  knownMediaIds: Set<string>;
  copied: boolean;
  onCopy: (message: AgentMessage) => void;
  onRetry: () => void;
}

/*
 * One transcript entry. Memoized with stable props, so a streamed token re-renders only the
 * reply it lands in — every other row's message object is unchanged.
 */
const MessageRow = memo(function MessageRow({
  message,
  index,
  isLast,
  animateEntrance,
  agent,
  mediaItems,
  knownMediaIds,
  copied,
  onCopy,
  onRetry,
}: MessageRowProps) {
  if (message.role === 'user') {
    return (
      <div id={`media-agent-message-${index}`} className={`flex justify-end shrink-0 ${animateEntrance ? 'animate-in fade-in slide-in-from-bottom-2 duration-200' : ''}`}>
        <AgentUserBubble content={message.content} attachments={message.attachments} />
      </div>
    );
  }

  const streaming = message.status === 'streaming';
  const showActions = !streaming && stripMediaMarkdown(message.content).length > 0;
  // The reply's text with each character or scene card where the reply made it, as its media is
  // inline; only the last stretch of text is still streaming.
  const parts = splitReplyAtCards(message.content, message.links);
  let lastText = -1;
  parts.forEach((part, i) => { if ('text' in part) lastText = i; });

  return (
    <div id={`media-agent-message-${index}`} className={`flex flex-col gap-2 shrink-0 ${animateEntrance ? 'animate-in fade-in duration-300' : ''}`}>
      {parts.map((part, i) => {
        if ('card' in part) return <AgentLinkCards key={`${part.card.kind}:${part.card.id}`} links={[part.card]} mediaItems={mediaItems} />;
        const text = streaming ? part.text : pruneMissingMedia(part.text, knownMediaIds);
        return text.trim().length > 0 && (
          <div key={i} className="text-[#e2e2e2] text-[13.5px] leading-relaxed max-w-full overflow-hidden">
            <StreamingMarkdown text={text} isStreaming={streaming && i === lastText} animate={true} mediaItems={mediaItems} renderMediaItem={renderAgentMedia} />
          </div>
        );
      })}

      {streaming && <AgentLiveStatus agent={agent} />}

      {message.status === 'stopped' && (
        <div className="text-[12px] text-zinc-500">Stopped</div>
      )}

      {message.status === 'error' && (
        <div className="flex items-start gap-2 rounded-[12px] bg-red-950/20 border border-red-500/20 px-3 py-2.5">
          <TriangleAlert size={14} className="text-red-300 mt-0.5 shrink-0" />
          <span className="text-[12.5px] leading-relaxed text-red-200/90 flex-1 min-w-0 [overflow-wrap:anywhere]">{message.error || 'Something went wrong.'}</span>
          {isLast && (
            <button
              type="button"
              onClick={onRetry}
              className="text-[12px] font-semibold text-white hover:underline shrink-0 cursor-pointer outline-none"
            >
              Retry
            </button>
          )}
        </div>
      )}

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
              onClick={() => agent.setReaction(message.id, message.reaction === 'like' ? null : 'like')}
              className={`p-1 transition-colors rounded hover:bg-white/5 cursor-pointer outline-none ${
                message.reaction === 'like' ? 'text-white' : 'text-gray-500 hover:text-gray-300'
              }`}
              title="Like response"
            >
              <ThumbsUp size={14.5} fill={message.reaction === 'like' ? 'currentColor' : 'none'} />
            </button>
            <button
              onClick={() => agent.setReaction(message.id, message.reaction === 'dislike' ? null : 'dislike')}
              className={`p-1 transition-colors rounded hover:bg-white/5 cursor-pointer outline-none ${
                message.reaction === 'dislike' ? 'text-white' : 'text-gray-500 hover:text-gray-300'
              }`}
              title="Dislike response"
            >
              <ThumbsDown size={14.5} fill={message.reaction === 'dislike' ? 'currentColor' : 'none'} />
            </button>
          </div>
          <button
            onClick={() => onCopy(message)}
            className="p-1 text-gray-500 hover:text-gray-300 transition-colors rounded hover:bg-white/5 cursor-pointer outline-none"
            title="Copy response"
          >
            {copied ? <Check size={14.5} className="text-emerald-400" /> : <Copy size={14.5} />}
          </button>
        </div>
      </motion.div>
    </div>
  );
});

type SidebarView = 'main' | 'settings' | 'instructions' | 'history';

interface AgentSidebarProps {
  onClose: () => void;
  isOpen: boolean;
  isHeaderVisible: boolean;
  sidebarTransition?: string;
  promptStore: PromptStore;
  attachments: ImageAttachment[];
  setAttachments: React.Dispatch<React.SetStateAction<ImageAttachment[]>>;
  agent: MediaAgent;
  /** Sends text plus the composer's attachments, or text alone when `fromComposer` is false. */
  onSend: (text: string, options?: { fromComposer?: boolean }) => void;
  userName?: string;
  imageModels: AgentModelOption[];
  videoModels: AgentModelOption[];
  /** Opens Settings → Models, offered when a kind has no model added. */
  onAddModel?: () => void;

  imageRatio: string;
  setImageRatio: React.Dispatch<React.SetStateAction<string>>;
  imageBatch: string;
  setImageBatch: React.Dispatch<React.SetStateAction<string>>;
  imageModel: string;
  setImageModel: (id: string) => void;
  videoRatio: string;
  setVideoRatio: React.Dispatch<React.SetStateAction<string>>;
  videoBatch: string;
  setVideoBatch: React.Dispatch<React.SetStateAction<string>>;
  videoModel: string;
  setVideoModel: (id: string) => void;
  onPlusClick?: (
    ref: React.RefObject<any>,
    source: 'sidebar' | 'instruction-reference',
    instructionId?: string
  ) => void;
  mediaItems?: MediaItem[];
}

export const AgentSidebar: React.FC<AgentSidebarProps> = ({
  onClose,
  isOpen,
  isHeaderVisible,
  sidebarTransition = '0.5s cubic-bezier(0.16, 1, 0.3, 1)',
  promptStore,
  attachments,
  setAttachments,
  agent,
  onSend,
  userName,
  imageModels,
  videoModels,
  onAddModel,
  mediaItems,
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
}) => {
  const messages = useStore(agent.$messages);
  const isGenerating = useStore(agent.$running);
  const session = useStore(agent.$session);
  const history = useStore(agent.$history);
  const settings = useStore(agent.$settings);
  const instructions = settings.instructions;

  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());

  const sidebarTextareaRef = useRef<HTMLTextAreaElement>(null);
  const sidebarFileInputRef = useRef<HTMLInputElement>(null);
  const sidebarPlusButtonRef = useRef<HTMLButtonElement>(null);

  const [sidebarView, setSidebarView] = useState<SidebarView>('main');
  const [isImgDropdownOpen, setIsImgDropdownOpen] = useState(false);
  const [isVidDropdownOpen, setIsVidDropdownOpen] = useState(false);
  const [lastSubView, setLastSubView] = useState<Exclude<SidebarView, 'main'>>('instructions');

  useEffect(() => {
    if (!isImgDropdownOpen && !isVidDropdownOpen) return undefined;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-agent-model-dropdown]')) return;
      setIsImgDropdownOpen(false);
      setIsVidDropdownOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside, { capture: true });
    return () => document.removeEventListener('mousedown', handleClickOutside, { capture: true });
  }, [isImgDropdownOpen, isVidDropdownOpen]);

  // Synchronous render-phase state update to completely eliminate any 1-frame transition lag or flash
  if (sidebarView !== 'main' && lastSubView !== sidebarView) {
    setLastSubView(sidebarView);
  }

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const handleCopy = useCallback((message: AgentMessage) => {
    void navigator.clipboard.writeText(stripMediaMarkdown(message.content));
    setCopiedId(message.id);
    setTimeout(() => {
      setCopiedId((prev) => (prev === message.id ? null : prev));
    }, 1600);
  }, []);
  const handleRetry = useCallback(() => agent.retry(), [agent]);

  const knownMediaIds = React.useMemo(() => new Set((mediaItems ?? []).map((m) => m.id)), [mediaItems]);

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const messageEl = (index: number) => document.getElementById(`media-agent-message-${index}`);

  const prevMessagesLength = useRef(0);
  const [collapsedSpacerHeight, setCollapsedSpacerHeight] = useState(32);
  const spacerRef = useRef<HTMLDivElement>(null);

  /** Room left below the last exchange, so it can sit at the top of the panel. */
  const measureSpacer = (count: number): number => {
    const container = chatScrollRef.current;
    const userMessageEl = messageEl(count - 2);
    const assistantMessageEl = messageEl(count - 1);
    if (!container || count < 2 || !userMessageEl || !assistantMessageEl) return 32;
    const requiredHeightBelowUser = container.clientHeight;
    const actualHeightBelowUserStart = (assistantMessageEl.offsetTop + assistantMessageEl.offsetHeight) - userMessageEl.offsetTop;
    return Math.max(32, requiredHeightBelowUser - actualHeightBelowUserStart - 24);
  };

  useEffect(() => {
    if (isGenerating) return;

    const updateSpacerHeight = () => setCollapsedSpacerHeight(measureSpacer(messages.length));

    // Run once when generation finishes, with a small delay for DOM to settle
    const timer = setTimeout(updateSpacerHeight, 100);

    // Run on window resize for complete responsiveness
    window.addEventListener('resize', updateSpacerHeight);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updateSpacerHeight);
    };
  }, [isGenerating, messages.length, session.id]);

  /*
   * While a reply is written, the room under it is just enough for its question to sit at the top,
   * so the panel ends there (or 32px under a longer reply) and a scroll down stops on its own.
   * Pulling the scroll back once the browser has drawn it makes the chat jump. Fitted again before
   * each paint as the reply grows.
   */
  useLayoutEffect(() => {
    const container = chatScrollRef.current;
    const spacer = spacerRef.current;
    const question = messageEl(messages.length - 2);
    const reply = messageEl(messages.length - 1);
    if (!isGenerating || !container || !spacer || !question || !reply) return undefined;
    const fit = () => {
      const top = Math.max(0, question.offsetTop - 24);
      const end = Math.max(top, reply.offsetTop + reply.offsetHeight - container.clientHeight + 32);
      const padding = parseFloat(getComputedStyle(container).paddingBottom) || 0;
      const height = Math.max(0, Math.round(end + container.clientHeight - spacer.offsetTop - padding));
      spacer.style.height = `${height}px`;
      setCollapsedSpacerHeight(height);
    };
    fit();
    const observer = new ResizeObserver(fit);
    [container, question, reply].forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [isGenerating, messages.length, session.id]);

  // Smart Snap-to-Top scroll behavior
  useEffect(() => {
    if (!chatScrollRef.current) return;

    const isNewMessage = messages.length > prevMessagesLength.current;
    prevMessagesLength.current = messages.length;

    if (isNewMessage && isGenerating) {
      // Wait for DOM to render the new messages
      setTimeout(() => {
        if (!chatScrollRef.current) return;
        const userMessageEl = messageEl(messages.length - 2);
        if (userMessageEl) {
          const isFirstPair = messages.length === 2;
          // Snap the user message to near the top (instant for the first message, smooth for history)
          chatScrollRef.current.scrollTo({
            top: Math.max(0, userMessageEl.offsetTop - 24),
            behavior: isFirstPair ? 'auto' : 'smooth'
          });
        }
      }, 50);
    }
  }, [messages.length, isGenerating]);

  /*
   * A reopened conversation opens at its latest exchange, settled before the first paint:
   * spacer sized and scroll position set in the same layout pass, so it never draws at the
   * top and jumps, and the spacer never animates in underneath it.
   */
  useLayoutEffect(() => {
    const count = agent.$messages.get().length;
    prevMessagesLength.current = count;
    const container = chatScrollRef.current;
    const spacer = spacerRef.current;
    if (!container || !spacer) return undefined;
    const height = measureSpacer(count);
    // Written to the element so the scroll below measures the final height. The transition
    // must be off first: reading scrollHeight would otherwise start it from the old height.
    spacer.style.transition = 'none';
    spacer.style.height = `${height}px`;
    container.scrollTop = container.scrollHeight;
    setCollapsedSpacerHeight(height);
    const frame = requestAnimationFrame(() => { spacer.style.transition = ''; });
    return () => cancelAnimationFrame(frame);
  }, [session.id, agent]);

  // When this conversation became the one on screen; rows older than that don't animate in.
  const [openedAt, setOpenedAt] = useState(() => ({ id: session.id, at: Date.now() }));
  if (openedAt.id !== session.id) {
    setOpenedAt({ id: session.id, at: Date.now() });
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isGenerating) onSend(promptStore.get());
    }
  };

  const setInstructions = (next: AgentInstruction[]) => agent.updateSettings({ instructions: next });

  const addInstruction = () => {
    const newInst: AgentInstruction = {
      id: Math.random().toString(36).substring(7),
      title: 'Instruction title',
      isActive: true,
      content: '',
      isEditingTitle: true
    };
    setInstructions([...instructions, newInst]);
  };

  const deleteInstruction = (id: string) => {
    setInstructions(instructions.filter(inst => inst.id !== id));
  };

  const hasActiveAttachments = attachments.length > 0 && !attachments.every(att => removingIds.has(att.id));

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

  const openHistory = () => {
    setSidebarView('history');
    void agent.refreshHistory();
  };

  // Load first, then slide back: sliding first showed the old conversation for the length
  // of the transition and swapped it out mid-slide. `flushSync` puts the slide in the same
  // frame as the loaded chat; set from a promise it would wait for a later task.
  const openFromHistory = async (sessionId: string) => {
    await agent.openSession(sessionId);
    flushSync(() => setSidebarView('main'));
  };

  const imageModelName = imageModels.find((m) => m.id === imageModel)?.name ?? (imageModel || 'No image model');
  const videoModelName = videoModels.find((m) => m.id === videoModel)?.name ?? (videoModel || 'No video model');
  const addModelRows = (label: string, close: () => void) => (
    <>
      <span className="px-3 pt-2 pb-1 text-[12px] text-[#808080]">{label}</span>
      {onAddModel && (
        <button
          type="button"
          onClick={() => {
            close();
            onAddModel();
          }}
          className="w-full flex items-center gap-1.5 text-left px-3 py-2 rounded-[10px] text-[12px] font-normal transition-colors cursor-pointer text-white hover:bg-white/5"
        >
          <Plus size={14} strokeWidth={2} />
          Add a model
        </button>
      )}
    </>
  );
  const confirmMode = settings.confirmBeforeGenerating ? 'always' : 'never';

  return (
    <div
      className="fixed w-[348px] bg-[#171719] rounded-[18px] shadow-2xl z-[70] flex flex-col overflow-hidden agent-sidebar-container"
      style={{
        // From the window's edges, or the page's in the desktop app's frame.
        top: `calc(${isHeaderVisible ? '76px' : '14px'} + var(--willow-frame-top, 0px))`,
        right: 'calc(8px + var(--willow-frame-right, 0px))',
        bottom: 'calc(8px + var(--willow-frame-bottom, 0px))',
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
          <div className="flex items-center justify-between gap-3 pl-6 pr-4 py-5 relative z-10 shrink-0">
            <div className="flex items-center gap-4 min-w-0">
              <button
                onClick={openHistory}
                className="text-[#a0a0a0] hover:text-white transition-colors outline-none cursor-pointer shrink-0"
                title="Chat history"
              >
                <Menu size={18} strokeWidth={2} />
              </button>
              <span className="text-white font-medium text-[15px] tracking-wide truncate">{session.title}</span>
            </div>
            <div className="flex items-center gap-4 shrink-0">
              <button
                onClick={() => void agent.newSession()}
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
            {messages.length === 0 && !isGenerating ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
                className="agent-empty-state absolute inset-0 flex flex-col items-center justify-start p-6 pt-[136px] select-none"
              >
                <div className="text-center space-y-4 mb-8" style={{ fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}>
                  <h2 className="text-[#8c8c8c] text-[22px] font-medium tracking-tight">{userName ? `Hi ${userName}` : 'Hi there'}</h2>
                  <h1 className="text-[#e2e2e2] text-[26px] font-medium leading-[1.15] tracking-tight">
                    What would you like to<br />do?
                  </h1>
                </div>

                <div className="flex flex-col items-center gap-3 w-full">
                  <button
                    onClick={() => onSend('Create a character', { fromComposer: false })}
                    className="w-fit py-3 px-5 rounded-full border border-white/10 hover:bg-white/5 transition-colors text-[#d0d0d0] hover:text-white text-[13px] font-medium tracking-wide cursor-pointer outline-none"
                  >
                    Create a character
                  </button>
                  <button
                    onClick={() => onSend('Storyboard a scene', { fromComposer: false })}
                    className="w-fit py-3 px-5 rounded-full border border-white/10 hover:bg-white/5 transition-colors text-[#d0d0d0] hover:text-white text-[13px] font-medium tracking-wide cursor-pointer outline-none"
                  >
                    Storyboard a scene
                  </button>
                  <button
                    onClick={() => onSend('Generate concept art', { fromComposer: false })}
                    className="w-fit py-3 px-5 rounded-full border border-white/10 hover:bg-white/5 transition-colors text-[#d0d0d0] hover:text-white text-[13px] font-medium tracking-wide cursor-pointer outline-none"
                  >
                    Generate concept art
                  </button>
                </div>
              </motion.div>
            ) : (
              <div
                ref={chatScrollRef}
                className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-6 min-h-0 no-scrollbar"
                // Chat's typeface for everything in the conversation; replies already set it.
                style={{ scrollbarWidth: 'none', fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif' }}
              >
                {messages.map((message, idx) => (
                  <MessageRow
                    key={message.id}
                    message={message}
                    index={idx}
                    isLast={idx === messages.length - 1}
                    animateEntrance={message.createdAt > openedAt.at}
                    agent={agent}
                    mediaItems={mediaItems}
                    knownMediaIds={knownMediaIds}
                    copied={copiedId === message.id}
                    onCopy={handleCopy}
                    onRetry={handleRetry}
                  />
                ))}
                <div
                  ref={spacerRef}
                  className={`flex-shrink-0 ${!isGenerating ? 'transition-[height] duration-500 ease-out' : ''}`}
                  style={{ height: `${collapsedSpacerHeight}px` }}
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
              /* Chat cards hold the canvas tile's own surfaces, so they share its 18px corner. */
              .agent-sidebar-container .smd-media-frame {
                border-radius: 18px;
              }
              /* The sidebar is dark in either theme; Chat's dots and thought line follow the theme. */
              .agent-sidebar-container .agent-thinking-row .thought-summary-line {
                color: rgb(227, 227, 227);
              }
              .agent-sidebar-container .agent-thinking-row .gemini-thinking-visualizer svg path {
                fill: rgb(227, 227, 227) !important;
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

              <SidebarPromptField
                store={promptStore}
                textareaRef={sidebarTextareaRef}
                isOpen={isOpen}
                sidebarView={sidebarView}
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
                    title="Agent instructions"
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
                    title="Agent settings"
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
                  <PromptValue store={promptStore}>
                    {(prompt) => {
                      const canSend = !!prompt.trim() || hasActiveAttachments;
                      return (
                        <button
                          onClick={() => {
                            if (isGenerating) {
                              agent.stop();
                              return;
                            }
                            if (canSend) onSend(prompt);
                          }}
                          disabled={!isGenerating && !canSend}
                          title={isGenerating ? 'Stop' : 'Send'}
                          className={`w-[30px] h-[30px] flex items-center justify-center rounded-full ml-1 transition-colors outline-none ${
                            isGenerating || canSend
                              ? 'bg-white text-black hover:bg-gray-200 cursor-pointer'
                              : 'bg-white/5 text-[#606060] cursor-not-allowed'
                          }`}
                        >
                          {isGenerating ? (
                            <div className="w-[9px] h-[9px] bg-black rounded-[1px]" />
                          ) : (
                            <ArrowRight size={15} strokeWidth={2.5} />
                          )}
                        </button>
                      );
                    }}
                  </PromptValue>
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
                    onClick={() => agent.updateSettings({ confirmBeforeGenerating: true })}
                    className={`w-full flex items-center gap-3.5 p-3.5 rounded-[14px] border-none text-left transition-all duration-200 cursor-pointer outline-none ${confirmMode === 'always' ? 'bg-[#4a4a4a] text-white' : 'bg-[#1e1f21]/50 text-gray-400 hover:bg-white/5 hover:text-white'}`}
                  >
                    <div className="flex-shrink-0">
                      <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors duration-200 ${confirmMode === 'always' ? 'border-white' : 'border-gray-500'}`}>
                        {confirmMode === 'always' && <div className="w-2 h-2 rounded-full bg-white animate-in zoom-in-50 duration-150" />}
                      </div>
                    </div>
                    <div className="space-y-0.5">
                      <div className={`text-[13px] font-medium transition-colors ${confirmMode === 'always' ? 'text-white' : 'text-gray-200'}`}>Always</div>
                      <div className={`text-[11px] leading-relaxed transition-colors ${confirmMode === 'always' ? 'text-gray-200' : 'text-[#8c8c8c]'}`}>Agent shows each generation and waits for you to approve it.</div>
                    </div>
                  </button>

                  <button
                    onClick={() => agent.updateSettings({ confirmBeforeGenerating: false })}
                    className={`w-full flex items-center gap-3.5 p-3.5 rounded-[14px] border-none text-left transition-all duration-200 cursor-pointer outline-none ${confirmMode === 'never' ? 'bg-[#4a4a4a] text-white' : 'bg-[#1e1f21]/50 text-gray-400 hover:bg-white/5 hover:text-white'}`}
                  >
                    <div className="flex-shrink-0">
                      <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors duration-200 ${confirmMode === 'never' ? 'border-white' : 'border-gray-500'}`}>
                        {confirmMode === 'never' && <div className="w-2 h-2 rounded-full bg-white animate-in zoom-in-50 duration-150" />}
                      </div>
                    </div>
                    <div className="space-y-0.5">
                      <div className={`text-[13px] font-medium transition-colors ${confirmMode === 'never' ? 'text-white' : 'text-gray-200'}`}>Never</div>
                      <div className={`text-[11px] leading-relaxed transition-colors ${confirmMode === 'never' ? 'text-gray-200' : 'text-[#8c8c8c]'}`}>Agent generates media right away, using your API keys.</div>
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
                  <div className="relative w-full" data-agent-model-dropdown>
                    <button
                      type="button"
                      onClick={() => {
                        setIsImgDropdownOpen(!isImgDropdownOpen);
                        setIsVidDropdownOpen(false);
                      }}
                      className="w-full flex items-center justify-between bg-[#1e1f21]/50 backdrop-blur-md hover:bg-[#202020]/50 transition-colors rounded-[14px] px-3 py-3 text-white text-[13px] font-normal cursor-pointer outline-none"
                    >
                      <span className="flex items-center gap-2 truncate">
                        {imageModelName}
                      </span>
                      <ChevronDown size={16} className={`text-[#a0a0a0] transition-transform duration-200 ${isImgDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {isImgDropdownOpen && (
                      <div className="absolute top-[calc(100%+6px)] left-0 right-0 bg-[#141517]/90 backdrop-blur-xl border border-white/5 rounded-[14px] p-1 flex flex-col shadow-2xl z-50">
                        {imageModels.map((modelOpt) => (
                          <button
                            key={modelOpt.id}
                            type="button"
                            onClick={() => {
                              setImageModel(modelOpt.id);
                              setIsImgDropdownOpen(false);
                            }}
                            className={`w-full text-left px-3 py-2 rounded-[10px] text-[12px] font-normal transition-colors cursor-pointer ${imageModel === modelOpt.id ? 'bg-[#4a4a4a] text-white' : 'text-[#a0a0a0] hover:text-white hover:bg-white/5'}`}
                          >
                            {modelOpt.name}
                          </button>
                        ))}
                        {imageModels.length === 0 && addModelRows('No image models added', () => setIsImgDropdownOpen(false))}
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
                  <div className="relative w-full" data-agent-model-dropdown>
                    <button
                      type="button"
                      onClick={() => {
                        setIsVidDropdownOpen(!isVidDropdownOpen);
                        setIsImgDropdownOpen(false);
                      }}
                      className="w-full flex items-center justify-between bg-[#1e1f21]/50 backdrop-blur-md hover:bg-[#202020]/50 transition-colors rounded-[14px] px-3 py-3 text-white text-[13px] font-normal cursor-pointer outline-none"
                    >
                      <span className="flex items-center gap-2 truncate">
                        {videoModelName}
                      </span>
                      <ChevronDown size={16} className={`text-[#a0a0a0] transition-transform duration-200 ${isVidDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {isVidDropdownOpen && (
                      <div className="absolute top-[calc(100%+6px)] left-0 right-0 bg-[#141517]/90 backdrop-blur-xl border border-white/5 rounded-[14px] p-1 flex flex-col shadow-2xl z-50">
                        {videoModels.map((modelOpt) => (
                          <button
                            key={modelOpt.id}
                            type="button"
                            onClick={() => {
                              setVideoModel(modelOpt.id);
                              setIsVidDropdownOpen(false);
                            }}
                            className={`w-full text-left px-3 py-2 rounded-[10px] text-[12px] font-normal transition-colors cursor-pointer ${videoModel === modelOpt.id ? 'bg-[#4a4a4a] text-white' : 'text-[#a0a0a0] hover:text-white hover:bg-white/5'}`}
                          >
                            {modelOpt.name}
                          </button>
                        ))}
                        {videoModels.length === 0 && addModelRows('No video models added', () => setIsVidDropdownOpen(false))}
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
                {instructions.map((inst) => {
                  const reference = inst.referenceId ? mediaItems?.find((m) => m.id === inst.referenceId) : undefined;
                  return (
                    <InstructionCard
                      key={inst.id}
                      inst={inst}
                      referenceThumb={reference?.kind === 'image' && reference.url ? reference.url : undefined}
                      toggleActive={() => agent.updateInstruction(inst.id, { isActive: !inst.isActive })}
                      updateTitle={(title) => agent.updateInstruction(inst.id, { title })}
                      updateContent={(content) => agent.updateInstruction(inst.id, { content })}
                      setEditingTitle={(isEditingTitle) => agent.updateInstruction(inst.id, { isEditingTitle })}
                      deleteSelf={() => deleteInstruction(inst.id)}
                      toggleReference={(ref) => {
                        if (onPlusClick) {
                          onPlusClick(ref, 'instruction-reference', inst.id);
                        }
                      }}
                      clearReference={() => agent.updateInstruction(inst.id, { referenceName: undefined, referenceId: undefined })}
                    />
                  );
                })}
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

          {/* History Panel */}
          <div
            className="absolute inset-0 h-full flex flex-col"
            style={{
              display: lastSubView === 'history' ? 'flex' : 'none',
              pointerEvents: lastSubView === 'history' ? 'auto' : 'none'
            }}
          >
          <div className="flex items-center justify-between pl-4 pr-4 pt-[18px] pb-[14px] relative z-10 border-none shrink-0">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSidebarView('main')}
                className="text-[#a0a0a0] hover:text-white transition-colors outline-none cursor-pointer p-1 rounded-full hover:bg-white/5"
              >
                <ArrowLeft size={18} strokeWidth={2} />
              </button>
              <span className="text-white font-medium text-[15px] tracking-wide" style={{ fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}>Chat history</span>
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

          <div className="flex-1 overflow-y-auto no-scrollbar px-3 pt-1 pb-4 min-h-0 select-none">
            {history.sessions.length === 0 ? (
              <div className="px-3 pt-10 text-center text-[13px] leading-relaxed text-[#8c8c8c]">
                {history.loading ? 'Loading...' : 'No saved chats yet. Conversations in this project are saved here automatically.'}
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {history.sessions.map((summary) => {
                  const isCurrent = summary.id === session.id;
                  return (
                    <div
                      key={summary.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => void openFromHistory(summary.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void openFromHistory(summary.id);
                      }}
                      className={`group flex items-center gap-2 rounded-[14px] px-3 py-2.5 cursor-pointer outline-none transition-colors ${isCurrent ? 'bg-[#4a4a4a]' : 'hover:bg-white/5'}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-white truncate">{summary.title}</div>
                        <div className="text-[11px] text-[#8c8c8c] truncate">
                          {relativeTime(summary.updatedAt)}
                          {summary.preview ? ` · ${summary.preview}` : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void agent.deleteSession(summary.id);
                        }}
                        className="shrink-0 p-1 rounded text-[#8e8e93] hover:text-red-400 hover:bg-white/5 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity cursor-pointer outline-none"
                        title="Delete chat"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="px-2 pb-2 pt-1 shrink-0 bg-[#171719]">
            <button
              onClick={() => {
                void agent.newSession();
                setSidebarView('main');
              }}
              className="w-full bg-white hover:bg-zinc-200 text-black py-2 rounded-xl font-semibold text-[13px] transition-colors cursor-pointer text-center outline-none"
            >
              New chat
            </button>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
};
