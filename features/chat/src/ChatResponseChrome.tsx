import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';

type Reaction = 'like' | 'dislike' | null;

interface ResponseActionsProps {
  reaction: Reaction;
  copied: boolean;
  listening: boolean;
  canRedo: boolean;
  canShowThinking: boolean;
  onLike: () => void;
  onDislike: () => void;
  onRedo: () => void;
  onCopy: () => void;
  onListen: () => void;
  onShowThinking: () => void;
}

interface MenuPosition {
  left: number;
  top?: number;
  bottom?: number;
}

const ACTION_BUTTON =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full p-1 text-[#e6e6e6] transition-colors duration-150 hover:bg-white/[0.08] hover:text-[#e6e6e6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25';

const RESPONSE_SYMBOL_PROPS = {
  family: 'luminous' as const,
  size: 20,
  weight: 320,
  roundness: 100,
  opticalSize: 20,
};

export const ResponseActions: React.FC<ResponseActionsProps> = ({
  reaction,
  copied,
  listening,
  canRedo,
  canShowThinking,
  onLike,
  onDislike,
  onRedo,
  onCopy,
  onListen,
  onShowThinking,
}) => {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition>({ left: 0, bottom: 0 });

  const openMenu = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const menuWidth = 208;
    const menuHeight = canShowThinking ? 232 : 196;
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - menuWidth - 8);
    const opensAbove = rect.top > menuHeight + 16;

    setMenuPosition(
      opensAbove
        ? { left, bottom: window.innerHeight - rect.top + 4 }
        : { left, top: rect.bottom + 4 },
    );
    setMenuOpen(true);
  };

  useEffect(() => {
    if (!menuOpen) return;

    const close = () => setMenuOpen(false);
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [menuOpen]);

  const runMenuAction = (action?: () => void) => {
    setMenuOpen(false);
    action?.();
  };

  const menuItems = [
    { label: 'Branch in new chat', symbol: 'arrow_split' },
    { label: listening ? 'Stop listening' : 'Listen', symbol: listening ? 'stop_circle' : 'tts', action: onListen },
    { label: 'Export to Docs', symbol: 'docs' },
    { label: 'Draft in Gmail', symbol: 'gmail' },
    { label: 'Report legal issue', symbol: 'flag' },
    ...(canShowThinking ? [{ label: 'Show thinking steps', symbol: 'route', action: onShowThinking }] : []),
  ];

  return (
    <>
      <div
        className="flex h-8 items-center"
        aria-label="Response actions"
        style={{
          '--response-action-size': '2rem',
          '--response-icon-size': `${RESPONSE_SYMBOL_PROPS.size}px`,
          marginInlineStart: 'calc((var(--response-icon-size) - var(--response-action-size)) / 2)',
        } as React.CSSProperties}
      >
        <button
          type="button"
          className={`${ACTION_BUTTON} ${reaction === 'like' ? 'bg-white/[0.09] text-[#e3e3e3]' : ''}`}
          onClick={onLike}
          aria-label="Good response"
          title="Good response"
        >
          <MaterialSymbol {...RESPONSE_SYMBOL_PROPS} name="thumb_up" fill={reaction === 'like'} />
        </button>
        <button
          type="button"
          className={`${ACTION_BUTTON} ${reaction === 'dislike' ? 'bg-white/[0.09] text-[#e3e3e3]' : ''}`}
          onClick={onDislike}
          aria-label="Bad response"
          title="Bad response"
        >
          <MaterialSymbol {...RESPONSE_SYMBOL_PROPS} name="thumb_down" fill={reaction === 'dislike'} />
        </button>
        {canRedo && (
          <button type="button" className={ACTION_BUTTON} onClick={onRedo} aria-label="Redo" title="Redo">
            <MaterialSymbol {...RESPONSE_SYMBOL_PROPS} name="refresh" />
          </button>
        )}
        <button type="button" className={ACTION_BUTTON} onClick={onCopy} aria-label="Copy" title="Copy">
          <MaterialSymbol {...RESPONSE_SYMBOL_PROPS} name={copied ? 'check' : 'copy'} weight={copied ? 400 : 320} />
        </button>
        <button
          ref={triggerRef}
          type="button"
          className={`${ACTION_BUTTON} ${menuOpen ? 'bg-white/[0.09] text-[#e3e3e3]' : ''}`}
          onClick={() => (menuOpen ? setMenuOpen(false) : openMenu())}
          aria-label="Show more options"
          aria-expanded={menuOpen}
          title="More"
        >
          <MaterialSymbol {...RESPONSE_SYMBOL_PROPS} name="more_horiz" />
        </button>
      </div>

      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              ref={menuRef}
              role="menu"
              initial={{ opacity: 0, scale: 0.96, y: 5 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 3 }}
              transition={{ duration: 0.14, ease: [0.2, 0, 0, 1] }}
              className="fixed z-[200] w-[208px] rounded-[20px] bg-[#1f1f1f] p-2 text-[#e6e6e6] font-['Google_Sans_Flex','Google_Sans','Helvetica_Neue',sans-serif]"
              style={{
                ...menuPosition,
                transformOrigin: menuPosition.bottom !== undefined ? 'left bottom' : 'left top',
              }}
            >
              {menuItems.map(({ label, symbol, action }) => {
                const unavailable = !action;
                return (
                  <button
                    key={label}
                    type="button"
                    role="menuitem"
                    disabled={unavailable}
                    aria-disabled={unavailable}
                    title={unavailable ? 'Unavailable in Willow' : undefined}
                    className="flex h-9 w-full items-center gap-2 rounded-xl px-2 text-left text-[13px] font-normal leading-[17px] text-[#e6e6e6] transition-colors hover:bg-white/[0.08] focus-visible:bg-white/[0.08] focus-visible:outline-none disabled:cursor-not-allowed disabled:hover:bg-transparent"
                    onClick={() => runMenuAction(action)}
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center text-[#e3e3e3]">
                      {symbol === 'route' ? (
                        <MaterialSymbol
                          family="google-symbols"
                          name="route"
                          size={20}
                          weight={320}
                          variationSettings='"FILL" 0, "GRAD" 0, "ROND" 100, "opsz" 20, "wght" 320'
                        />
                      ) : (
                        <MaterialSymbol {...RESPONSE_SYMBOL_PROPS} name={symbol} />
                      )}
                    </span>
                    <span className="truncate">{label}</span>
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
};

interface ThoughtBlock {
  title?: string;
  body: string;
}

const parseThoughtBlocks = (text: string): ThoughtBlock[] => {
  const chunks = text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);

  const blocks: ThoughtBlock[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const block = chunks[index];
    const standaloneHeading = block.match(/^(?:#{1,6}\s+(.+?)|\*\*(.+?)\*\*):?$/);
    const nextChunk = chunks[index + 1];

    if (standaloneHeading && nextChunk && !/^(?:#{1,6}\s+|\*\*.+?\*\*:?$)/.test(nextChunk)) {
      blocks.push({ title: (standaloneHeading[1] || standaloneHeading[2]).trim(), body: nextChunk });
      index += 1;
      continue;
    }

    const heading = block.match(/^(?:#{1,6}\s+|\*\*)([^\n*]+?)(?:\*\*)?(?:\n+|:\s+)([\s\S]+)$/);
    if (heading) {
      blocks.push({ title: heading[1].trim(), body: heading[2].trim() });
      continue;
    }

    const lines = block.split('\n');
    if (lines.length > 1 && lines[0].length <= 72) {
      blocks.push({
        title: lines[0].replace(/^[-*#\s]+|[*:]+$/g, '').trim(),
        body: lines.slice(1).join('\n').trim(),
      });
      continue;
    }

    blocks.push({ body: block });
  }

  return blocks;
};

interface ThinkingStepsSidebarProps {
  thinkingText: string;
  modelLabel: string;
  onClose: () => void;
}

export const ThinkingStepsSidebar: React.FC<ThinkingStepsSidebarProps> = ({
  thinkingText,
  modelLabel,
  onClose,
}) => {
  const blocks = parseThoughtBlocks(thinkingText);
  const isProModel = /\bpro\b/i.test(modelLabel);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <>
      <motion.button
        type="button"
        aria-label="Close thinking steps"
        className="absolute inset-0 z-40 bg-black/55 min-[1024px]:hidden"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
      />
      <motion.aside
        aria-label="Thinking steps"
        initial={{ opacity: 0, x: 424 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 424 }}
        transition={{
          x: { duration: 0.3, ease: [0.2, 0, 0, 1] },
          opacity: { duration: 0.2, ease: [0.2, 0, 0, 1] },
        }}
        className="absolute bottom-4 right-3 top-4 z-50 flex w-[400px] max-w-[calc(100%_-_32px)] flex-col overflow-hidden rounded-2xl border border-white/[0.12] bg-[var(--studio-surface)] text-[#e3e3e3] font-['Google_Sans_Flex','Google_Sans','Helvetica_Neue',sans-serif]"
      >
        <header className="flex h-16 shrink-0 items-center justify-between py-3 pl-6 pr-3">
          <h2
            className="text-[20px] font-[470] leading-6"
            style={{ fontVariationSettings: '"ROND" 20, "slnt" 0, "wdth" 94, "wght" 470' }}
          >
            Thinking steps
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full text-[#c4c7c5] transition-colors hover:bg-white/[0.08] hover:text-[#e3e3e3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
            aria-label="Close sidebar"
            title="Close"
          >
            <MaterialSymbol
              family="google-symbols"
              name="close"
              size={24}
              weight={400}
              roundness={0}
              symbolWidth={92}
            />
          </button>
        </header>

        <div className="gemini-chat-scrollbar my-2 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-4">
          <div
            className="ml-[7px] flex flex-col gap-2 pl-[25px]"
            style={{
              backgroundImage: 'radial-gradient(circle closest-side, #e6e6e6 100%, transparent 100%)',
              backgroundPosition: '0 0',
              backgroundRepeat: 'repeat-y',
              backgroundSize: '1px 4px',
            }}
          >
            {blocks.map((block, index) => (
              <section
                key={`${block.title || 'thought'}-${index}`}
                className="flex flex-col gap-4 px-2 pb-2"
              >
                {block.title && (
                  <h3
                    className="text-[15px] font-normal leading-5 text-[#e6e6e6]"
                    style={{ fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 92, "wght" 540' }}
                  >
                    {block.title}
                  </h3>
                )}
                <p
                  className="whitespace-pre-wrap text-[15px] font-normal leading-5 text-white/55"
                  style={{ fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 92, "wght" 400' }}
                >
                  {block.body}
                </p>
              </section>
            ))}
          </div>

          <div
            className="flex flex-col gap-4 text-[15px] leading-5"
            style={{ fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 92, "wght" 400' }}
          >
            <div className="flex items-center gap-5">
              <span className="flex h-5 w-5 items-center justify-center text-[#e3e3e3]">
                <MaterialSymbol
                  family="google-symbols"
                  name="check"
                  size={20}
                  weight={400}
                  roundness={0}
                  symbolWidth={92}
                  opticalSize={20}
                />
              </span>
              <span>Done</span>
            </div>
            <div className="flex items-center gap-5">
              <span className="flex h-5 w-5 items-center justify-center text-[#e3e3e3]">
                {isProModel ? (
                  <MaterialSymbol
                    name="auto_awesome"
                    size={20}
                    weight={300}
                    opticalSize={20}
                  />
                ) : (
                  <MaterialSymbol
                    family="luminous"
                    name="spark_outline"
                    size={24}
                    weight={300}
                    roundness={100}
                    opticalSize={24}
                    style={{ width: 20 }}
                  />
                )}
              </span>
              <span>Used {modelLabel}</span>
            </div>
          </div>
        </div>
      </motion.aside>
    </>
  );
};
