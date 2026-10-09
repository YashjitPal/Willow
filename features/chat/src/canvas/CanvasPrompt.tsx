/**
 * The canvas's prompt surfaces — every way to ask about a canvas without the composer.
 *
 *  - `CanvasCoCreateInput`: Gemini's `co-creation-input-view`, a 320x56 pill holding
 *    an input and a 36px send button. One component, three places: under a text
 *    selection ("Ask Willow"), at the full-screen fab, and under a select-and-ask
 *    region ("Describe changes").
 *  - `CanvasSelectionPrompt`: that pill, fixed 4px under the selection's box and
 *    left-aligned with it.
 *  - `CanvasPromptFab`: full screen replaces the composer with a 120x50 "Ask Willow"
 *    fab, centred on the viewport 48px up. Hovering or pressing it opens the pill in
 *    a viewport-wide overlay (any press outside closes it); sending turns the pill
 *    into a floating chat window holding every question asked since it opened. It
 *    closes itself only when an answer rewrites the canvas; a plain answer stays.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { atom } from 'nanostores';
import { useStore } from '@nanostores/react';
import { GeminiThinkingVisualizer } from '../GeminiThinkingVisualizer';
import { CanvasIcon, copyCanvas } from './canvas-view';
import { markdownToEditorHtml } from './canvas-markdown';
import { floatingWindowView, type CanvasFloatingTurn, type FloatingPending } from './canvas-floating';
import type { CanvasDoc } from './canvas-store';
import type { CanvasEditorSelection } from './CanvasRichEditor';

/**
 * Share. Gemini mints a public link here; Willow has nowhere to host one, so it
 * hands the document to the system share sheet where there is one and copies it
 * where there is not.
 */
export const shareCanvas = (doc: CanvasDoc, content: string): void => {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    void navigator.share({ title: doc.title, text: content }).catch((error: unknown) => {
      if ((error as { name?: string } | null)?.name !== 'AbortError') void copyCanvas(content);
    });
    return;
  }
  void copyCanvas(content);
};

export const CanvasCoCreateInput: React.FC<{
  placeholder: string;
  onSend: (text: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  inputRef?: React.MutableRefObject<HTMLInputElement | null>;
  onEscape?: () => void;
  value?: string;
  onValueChange?: (value: string) => void;
}> = ({ placeholder, onSend, autoFocus, disabled = false, className = '', style, inputRef, onEscape, value: controlled, onValueChange }) => {
  const [own, setOwn] = useState('');
  const value = controlled ?? own;
  const setValue = onValueChange ?? setOwn;
  const send = () => {
    const text = value.trim();
    if (!text || disabled) return;
    setValue('');
    onSend(text);
  };
  return (
    <form
      className={`cv-cocreate ${className}`}
      style={style}
      onSubmit={(event) => { event.preventDefault(); send(); }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <input
        ref={inputRef}
        autoFocus={autoFocus}
        aria-label={placeholder}
        placeholder={placeholder}
        className="cv-cocreate__input"
        disabled={disabled}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          event.nativeEvent.stopImmediatePropagation();
          onEscape?.();
        }}
      />
      <button
        type="submit"
        aria-label="Send message"
        title="Send message"
        disabled={!value.trim() || disabled}
        className="cv-cocreate__send"
      >
        <CanvasIcon name="arrow_upward" family="luminous" size={24} />
      </button>
    </form>
  );
};

/** What a selection prompt sends: the passage, then the question about it. */
export const selectionPrompt = (selected: string, request: string): string => (
  `In the canvas, about this passage:\n\n> ${selected.replace(/\n+/g, '\n> ')}\n\n${request}`
);

/** A selection prompt is open; the full-screen fab steps aside for it, as Gemini's does. */
export const $canvasSelectionPromptOpen = atom(false);

export const CanvasSelectionPrompt: React.FC<{
  selection: CanvasEditorSelection;
  onSend: (text: string) => void;
  onDismiss: () => void;
}> = ({ selection, onSend, onDismiss }) => {
  useEffect(() => {
    $canvasSelectionPromptOpen.set(true);
    return () => $canvasSelectionPromptOpen.set(false);
  }, []);
  const width = 320;
  const height = 56;
  const left = Math.max(8, Math.min(selection.rect.left, window.innerWidth - width - 8));
  const below = selection.rect.bottom + 4;
  const top = below + height + 8 > window.innerHeight ? Math.max(8, selection.rect.top - height - 4) : below;
  return createPortal(
    <div className="cv-scope">
      <CanvasCoCreateInput
        placeholder="Ask Willow"
        className="cv-cocreate--fixed"
        style={{ left, top }}
        onEscape={onDismiss}
        onSend={(text) => onSend(selectionPrompt(selection.text, text))}
      />
    </div>,
    document.body,
  );
};

/* ------------------------------------------------------------------ the fab */

/*
 * Gemini's `thinking-indicator`: the thread's 24px `thinking-dots-animation`, padded 4px
 * a side. It follows the turns rather than sitting in one, and stays while the thread
 * generates — under the answer as it streams, too.
 */
export const ThinkingDots: React.FC = () => (
  <div className="cv-float-window__thinking" aria-live="polite" aria-label="Thinking">
    <GeminiThinkingVisualizer />
  </div>
);

/* `.model-response.markdown`: the answer as markdown, at the window's 15/20. Also Ask Willow's
   (AskWillow.tsx), which is this window opened on any page. */
export const FloatingReply: React.FC<{ text: string }> = ({ text }) => {
  const html = useMemo(() => ({ __html: markdownToEditorHtml(text) }), [text]);
  return <div className="cv-float-window__reply" dangerouslySetInnerHTML={html} />;
};

export const CanvasPromptFab: React.FC<{
  /** Sends an ordinary turn; the floating window then follows it. */
  onSend: (text: string) => void;
  isGenerating: boolean;
  /** Every turn in the thread, oldest first. The window shows the ones asked since it opened. */
  turns: CanvasFloatingTurn[];
}> = ({ onSend, isGenerating, turns }) => {
  const [open, setOpen] = useState(false);
  /** The thread's turn count when the pill opened: Gemini's floating session starts there. */
  const [start, setStart] = useState(0);
  /**
   * Sent but not yet a turn — Gemini's `pendingFloatingChatWindowUserPrompt`, which puts
   * the question on screen at once. `base` is the turn count it was sent at; the thread
   * growing past it is the turn arriving.
   */
  const [pending, setPending] = useState<FloatingPending | null>(null);
  /** Submitted mid-turn. The thread runs one turn at a time, so Gemini holds the question,
   *  input disabled, and sends it as soon as the running turn ends. */
  const [queued, setQueued] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const windowRef = useRef<HTMLDivElement | null>(null);
  /** The window follows a growing answer unless the reader has scrolled up off the end. */
  const followRef = useRef(true);

  const expand = () => {
    if (open) return;
    setStart(turns.length);
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    setPending(null);
    setQueued(null);
    setValue('');
    setOffset({ x: 0, y: 0 });
  };

  /* Set by a send and honoured after the commit: the press may have been on the send
     button, which the cleared field has just disabled, or the field may only now be
     enabled again. */
  const refocusRef = useRef(false);

  const send = (text: string) => {
    if (isGenerating) {
      setQueued(text);
      setValue(text);
      return;
    }
    followRef.current = true;
    refocusRef.current = true;
    setPending({ text, base: turns.length });
    onSend(text);
  };

  useEffect(() => {
    if (!open || isGenerating || queued === null) return;
    setQueued(null);
    setValue('');
    followRef.current = true;
    refocusRef.current = true;
    setPending({ text: queued, base: turns.length });
    onSend(queued);
  }, [open, isGenerating, queued, turns.length, onSend]);

  useEffect(() => {
    if (!refocusRef.current || queued !== null) return;
    refocusRef.current = false;
    inputRef.current?.focus();
  });

  const { pendingShown, entries, closeForEdit, thinking } = floatingWindowView(open ? turns : [], start, pending, isGenerating);
  useEffect(() => {
    if (pending && !pendingShown) setPending(null);
  }, [pending, pendingShown]);

  /* The canvas the window was about has just changed behind it. */
  useEffect(() => {
    if (closeForEdit) close();
  }, [closeForEdit]);

  const windowOpen = entries.length > 0 || pendingShown !== null;
  const tail = entries.length ? entries[entries.length - 1].reply.length : 0;

  useLayoutEffect(() => {
    const scroller = windowRef.current;
    if (scroller && followRef.current) scroller.scrollTop = scroller.scrollHeight;
  }, [entries.length, tail, thinking, windowOpen]);

  /* `cdkDragHandle` on the window's header: the card follows the pointer. */
  const startDrag = (event: React.PointerEvent) => {
    event.preventDefault();
    const origin = { x: event.clientX - offset.x, y: event.clientY - offset.y };
    const move = (e: PointerEvent) => setOffset({ x: e.clientX - origin.x, y: e.clientY - origin.y });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const selectionPromptOpen = useStore($canvasSelectionPromptOpen);

  return (
    <div className="cv-scope">
      {!open && (
        <div className={`cv-fab${selectionPromptOpen ? ' cv-fab--hidden' : ''}`}>
          <button
            type="button"
            aria-label="Ask Willow, expand input"
            className="cv-fab__button"
            onMouseEnter={expand}
            onClick={expand}
          >
            <span>Ask Willow</span>
          </button>
        </div>
      )}
      {open && createPortal(
        <div
          className="cv-scope cv-float-overlay"
          onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}
        >
          <div
            className={windowOpen ? 'cv-float-card--window' : ''}
            style={offset.x || offset.y ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : undefined}
            onMouseLeave={() => {
              if (windowOpen || value.trim()) return;
              if (inputRef.current && document.activeElement === inputRef.current) return;
              close();
            }}
          >
            {windowOpen && (
              <div
                ref={windowRef}
                className="cv-float-window"
                onScroll={(event) => {
                  const scroller = event.currentTarget;
                  followRef.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 8;
                }}
              >
                <div className="cv-float-window__header" onPointerDown={startDrag}>
                  <div className="cv-float-window__bar" aria-label="Drag to move" />
                </div>
                {entries.map((turn) => (
                  <div key={turn.id} className="cv-float-window__entry">
                    <div className="cv-float-window__user">{turn.prompt}</div>
                    {turn.reply.trim() && <FloatingReply text={turn.reply} />}
                  </div>
                ))}
                {pendingShown && (
                  <div className="cv-float-window__entry">
                    <div className="cv-float-window__user">{pendingShown.text}</div>
                  </div>
                )}
                {thinking && <ThinkingDots />}
              </div>
            )}
            {/* No Escape: Gemini's floating input ignores it, with or without a conversation. */}
            <CanvasCoCreateInput
              placeholder="Ask Willow"
              autoFocus
              inputRef={inputRef}
              value={value}
              onValueChange={setValue}
              disabled={queued !== null}
              onSend={send}
            />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
};
