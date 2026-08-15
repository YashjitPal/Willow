import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { SourceCard, type SourceChipItem } from '@willow/ui/SourceChip';
import { useInjectStyles } from '@willow/ui/streaming-markdown-styles';

type Reaction = 'like' | 'dislike' | null;

interface ResponseActionsProps {
  reaction: Reaction;
  listening: boolean;
  canRedo: boolean;
  canShowThinking: boolean;
  /** Whether the turn was grounded. Gemini only offers "View sources" on a
   *  response that actually used search. */
  canShowSources: boolean;
  /**
   * Turn the user stopped. Gemini drops most of the row for these: rating a
   * reply it never finished writing is meaningless, and there is no complete
   * answer to copy. Measured on two stopped turns in the live app — one with
   * body text, one stopped before any arrived:
   *
   *   stopped + last turn  -> refresh ("Redo"), flag ("Report legal issue")
   *   stopped, not last    -> flag only
   *
   * Redo tracks `canRedo` exactly as it does on a normal turn (only the last
   * assistant turn had it), so the two rules compose rather than conflict.
   */
  isStopped?: boolean;
  onLike: () => void;
  onDislike: () => void;
  onRedo: () => void;
  onCopy: () => void;
  onListen: () => void;
  onShowThinking: () => void;
  onShowSources: () => void;
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

/**
 * The "Show code" / "Hide code" pill for a turn that ran code.
 *
 * Sits in the response header, right-aligned, above the body — Gemini puts it in
 * `response-container-header`, not inside the panel, so it is one control per
 * response rather than one per block.
 *
 * Measured: 32px tall, 0/16px padding, fully round, 5px between label and icon.
 * The label is grey and the 16px icon beside it is blue — the button's own colour
 * is the blue, and the label overrides itself back to grey.
 *
 * The icon is inline SVG rather than a symbol font on purpose: the bundled
 * "Google Symbols" and "Luminous Symbols" faces are *subsetted* kits, and neither
 * contains `code` / `code_off`, so a MaterialSymbol here rendered fallback blobs
 * instead of a glyph. Drawing it also makes the optical centring exact, which the
 * font route did not.
 */
const CodeGlyph: React.FC<{ struck: boolean }> = ({ struck }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M6.1 4.3 L2.5 8 L6.1 11.7" />
    <path d="M9.9 4.3 L13.5 8 L9.9 11.7" />
    {struck && <path d="M13.2 2.8 L2.8 13.2" />}
  </svg>
);

export const ShowCodeToggle: React.FC<{ open: boolean; onToggle: () => void }> = ({
  open,
  onToggle,
}) => (
  <div className="flex h-8 items-center justify-end">
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      data-test-id="toggle-code-button"
      className="flex h-8 items-center justify-center gap-[5px] rounded-full px-4 text-[#a8c7fa] transition-colors duration-150 hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
    >
      <span
        className="text-[15px] font-[370] leading-5 text-[#e3e3e3]"
        style={{ fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 92, "wght" 370' }}
      >
        {open ? 'Hide code' : 'Show code'}
      </span>
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[#a8c7fa]">
        <CodeGlyph struck={open} />
      </span>
    </button>
  </div>
);

export const ResponseActions: React.FC<ResponseActionsProps> = ({
  reaction,
  listening,
  canRedo,
  canShowThinking,
  canShowSources,
  isStopped = false,
  onLike,
  onDislike,
  onRedo,
  onCopy,
  onListen,
  onShowThinking,
  onShowSources,
}) => {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition>({ left: 0, bottom: 0 });

  /*
   * Row order is Gemini's, measured from the open menu: "View sources" sits
   * between "Report legal issue" and "Show thinking steps", not at the end.
   * Both trailing rows are conditional and compose in that order.
   */
  const menuItems = [
    { label: 'Branch in new chat', symbol: 'arrow_split' },
    { label: listening ? 'Stop listening' : 'Listen', symbol: listening ? 'stop_circle' : 'tts', action: onListen },
    { label: 'Export to Docs', symbol: 'docs' },
    { label: 'Draft in Gmail', symbol: 'gmail' },
    { label: 'Report legal issue', symbol: 'flag' },
    ...(canShowSources ? [{ label: 'View sources', symbol: 'link_2', action: onShowSources }] : []),
    ...(canShowThinking ? [{ label: 'Show thinking steps', symbol: 'route', action: onShowThinking }] : []),
  ];

  const openMenu = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const menuWidth = 208;
    // Derived rather than tabulated: each row is h-9 (36px, Gemini's measured
    // row height) inside the pane's p-2. The two constants this replaces (196
    // and 232) are what the formula returns for 5 and 6 rows, and a third
    // conditional row made the table the wrong shape.
    const menuHeight = menuItems.length * 36 + 16;
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

  const rowStyle = {
    '--response-action-size': '2rem',
    '--response-icon-size': `${RESPONSE_SYMBOL_PROPS.size}px`,
    marginInlineStart: 'calc((var(--response-icon-size) - var(--response-action-size)) / 2)',
  } as React.CSSProperties;

  // A stopped turn gets its own short row. Returning early also keeps the
  // more_horiz menu portal unmounted, which is right: the menu is reached
  // through a button this row does not render.
  if (isStopped) {
    return (
      <div className="flex h-8 items-center" aria-label="Response actions" style={rowStyle}>
        {canRedo && (
          <button type="button" className={ACTION_BUTTON} onClick={onRedo} aria-label="Redo" title="Redo">
            <MaterialSymbol {...RESPONSE_SYMBOL_PROPS} name="refresh" />
          </button>
        )}
        <button
          type="button"
          className={ACTION_BUTTON}
          aria-label="Report legal issue"
          /*
           * The button's own label, as Gemini's action row shows it — not
           * "Unavailable in Willow", which is what this used to say. That
           * string was written when the native bubble's several-hundred-ms
           * dwell delay kept it effectively unseen; <GlobalTooltips> shows
           * every `title` instantly, so it became a visible non-Gemini string
           * on an otherwise-matching row. `disabled` + `aria-disabled` carry
           * the unavailability, the same split the three-dot menu rows use.
           */
          title="Report legal issue"
          disabled
          aria-disabled
        >
          <MaterialSymbol {...RESPONSE_SYMBOL_PROPS} name="flag" />
        </button>
      </div>
    );
  }

  return (
    <>
      <div
        className="flex h-8 items-center"
        aria-label="Response actions"
        style={rowStyle}
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
          {/* No tick. Measured before and after a copy in the live app, the
              glyph never changes — the snackbar is the whole feedback. */}
          <MaterialSymbol {...RESPONSE_SYMBOL_PROPS} name="copy" />
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
                    /*
                     * No `title` here. A menu row already states what it does,
                     * and hovering one must not raise a tooltip over the menu —
                     * this used to carry title="Unavailable in Willow", which
                     * was invisible behind the native bubble's dwell delay and
                     * became an instant tooltip once <GlobalTooltips> took over
                     * every `title` in the app. `disabled` + `aria-disabled`
                     * already carry the unavailability, visually and to AT.
                     */
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

/**
 * The right-hand context panel, shared by "Show thinking steps" and "View
 * sources".
 *
 * Shared because Gemini shares it: both are the same `context-sidebar` element
 * with a different child (`side-bar-thoughts` / `side-bar-sources`), so the
 * measurements below describe one surface, not two that happen to match —
 * 400x793.6 at (1120, 16), 16px radius, 0.8px rgba(255,255,255,0.12) border,
 * a 64px header padded `12px 12px 12px 24px`, a 20/24 470-weight title and a
 * 40px `close` button in #c4c7c5 with aria-label "Close sidebar".
 */
const ContextSidebar: React.FC<{
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ title, onClose, children }) => {
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
        aria-label={`Close ${title.toLowerCase()}`}
        className="absolute inset-0 z-40 bg-black/55 min-[1024px]:hidden"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
      />
      <motion.aside
        aria-label={title}
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
            {title}
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
        {children}
      </motion.aside>
    </>
  );
};

/**
 * "View sources". Gemini's `side-bar-sources` is padded `0 12px` and holds
 * `.all-sources` — a 12px-gap flex column with `0 0 12px` padding — of
 * `inline-source-card`, the same component its inline hover pane uses. Willow
 * renders that same component too (`SourceCard`), so the card itself needs no
 * rules here.
 *
 * Gemini's card carries a third row -- a 2-line clamped snippet -- which is why
 * its card measures 98.4px against our 56.4px. `SourceCard` renders that row
 * whenever `GroundingSource.snippet` is set, so this panel gains it for free on
 * the providers that send one (Anthropic's `cited_text`) and keeps the shorter
 * card on the ones that do not (Gemini, OpenAI, xAI). Nothing to decide here:
 * the card owns that choice for both call sites.
 */
export const SourcesSidebar: React.FC<{
  sources: SourceChipItem[];
  onClose: () => void;
}> = ({ sources, onClose }) => {
  // SourceCard's rules live in the streaming-markdown stylesheet, which is
  // injected by StreamingMarkdown. That is already mounted behind this panel,
  // but the call is idempotent and makes the dependency explicit rather than
  // relying on a sibling having rendered first.
  useInjectStyles();

  return (
    <ContextSidebar title="Sources" onClose={onClose}>
      <div className="gemini-chat-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3">
        {sources.map((source, index) => (
          <SourceCard key={`${source.uri}-${index}`} source={source} />
        ))}
      </div>
    </ContextSidebar>
  );
};

interface ThinkingStepsSidebarProps {
  thinkingText: string;
  modelLabel: string;
  isError?: boolean;
  onClose: () => void;
}

export const ThinkingStepsSidebar: React.FC<ThinkingStepsSidebarProps> = ({
  thinkingText,
  modelLabel,
  isError = false,
  onClose,
}) => {
  const blocks = parseThoughtBlocks(thinkingText);
  const isProModel = /\bpro\b/i.test(modelLabel);

  return (
    <ContextSidebar title="Thinking steps" onClose={onClose}>
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
                  style={{
                    fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 92, "wght" 400',
                    overflowWrap: 'anywhere',
                  }}
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
                  name={isError ? 'close' : 'check'}
                  size={20}
                  weight={400}
                  roundness={0}
                  symbolWidth={92}
                  opticalSize={20}
                />
              </span>
              <span>{isError ? 'Error' : 'Done'}</span>
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
    </ContextSidebar>
  );
};
