import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@nanostores/react';
import { isAbortError, streamChat, type ChatMessage } from '@willow/ai/chat';
import { useUserDataContext } from '@willow/auth/UserDataContext';
import { chatSystemPromptFor, resolveChatModel } from './chat-model';
import { formatUpstreamError, friendlyChatErrorFor } from './chat-errors';
import { CanvasCoCreateInput, FloatingReply, ThinkingDots } from './canvas/CanvasPrompt';
import { $askWillow, askAboutPrompt, closeAskWillow, type AskWillowRequest } from './ask-willow';
import './canvas/canvas.css';
import './AskWillow.css';

/*
 * Ask Willow about selected text, from the desktop app's right-click menu (ask-willow.ts): the
 * canvas's own floating prompt — its "Ask Willow" pill, and the floating chat window that pill
 * turns into once a question is sent (CanvasPrompt.tsx) — opened beside the selection on any
 * page. Its questions and answers are its own, a side conversation rather than a chat in
 * Recents; the first one carries the selection, which the window shows at its top.
 */

interface Turn {
  id: number;
  question: string;
  /** What was sent: the first question with the selection it is about. */
  prompt: string;
  reply: string;
  error?: { message: string; detail: string };
}

/** How near the card comes to the window's edges, and how far it stands off the selection. */
const MARGIN = 8;
const GAP = 4;
/** The pill's height (`.cv-cocreate`), which decides the side before anything is asked. */
const PILL_HEIGHT = 56;

/** The model the composer has chosen (App keeps it here). */
const chosenModelId = (): string => {
  try {
    return window.localStorage.getItem('selectedModelId') ?? '';
  } catch {
    return '';
  }
};

function AskWillowWindow({ request, modelConfig }: { request: AskWillowRequest; modelConfig: unknown }) {
  const { apiKeys } = useUserDataContext();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const windowRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  /** The window follows a growing answer unless the reader has scrolled up off its end. */
  const followRef = useRef(true);
  /** Under the selection where the pill fits there, otherwise above it — kept as it grows. */
  const [below] = useState(() => request.near.bottom + GAP + PILL_HEIGHT <= window.innerHeight - MARGIN);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Escape closes it from anywhere, the field included while an answer streams and it is disabled.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeAskWillow();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return undefined;
    const fit = () => {
      const { width, height } = card.getBoundingClientRect();
      const left = Math.min(Math.max(MARGIN, request.near.left), window.innerWidth - width - MARGIN);
      const preferred = below ? request.near.bottom + GAP : request.near.top - GAP - height;
      const top = Math.min(Math.max(MARGIN, preferred), Math.max(MARGIN, window.innerHeight - MARGIN - height));
      setPlace({ left, top });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(card);
    window.addEventListener('resize', fit);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [request, below]);

  const update = (id: number, change: (turn: Turn) => Turn) =>
    setTurns((all) => all.map((turn) => (turn.id === id ? change(turn) : turn)));

  const ask = async (id: number, history: ChatMessage[]) => {
    const model = resolveChatModel({ modelConfig, selectedModelId: chosenModelId(), apiKeys });
    if (!model.apiKey) {
      update(id, (turn) => ({ ...turn, error: { message: 'Add an API key in Settings to ask Willow.', detail: '' } }));
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    try {
      await streamChat(
        history,
        {
          provider: model.provider,
          model: model.model,
          apiKey: model.apiKey,
          apiKeyFallbacks: model.apiKeyFallbacks,
          thinkingLevel: model.thinkingLevel,
          reasoningEffort: model.reasoningEffort,
          enableSearch: false,
          enableCodeExecution: false,
          baseUrl: model.baseUrl,
          apiFormat: model.apiFormat,
          toolPolicy: model.toolPolicy,
          profileId: model.profileId,
          signal: controller.signal,
        },
        (token: string) => update(id, (turn) => ({ ...turn, reply: turn.reply + token })),
        () => undefined,
        chatSystemPromptFor(model.provider),
      );
    } catch (error) {
      if (!isAbortError(error)) {
        update(id, (turn) => ({ ...turn, error: { message: friendlyChatErrorFor([]), detail: formatUpstreamError(error) } }));
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const send = (question: string) => {
    if (busy) return;
    const prompt = turns.length === 0 ? askAboutPrompt(request.text, question) : question;
    // What was answered goes with the question; a question that failed does not.
    const history: ChatMessage[] = turns.flatMap((turn): ChatMessage[] =>
      turn.reply ? [{ role: 'user', content: turn.prompt }, { role: 'assistant', content: turn.reply }] : [],
    );
    history.push({ role: 'user', content: prompt });
    const id = nextId.current++;
    followRef.current = true;
    setTurns((all) => [...all, { id, question, prompt, reply: '' }]);
    void ask(id, history);
  };

  const windowOpen = turns.length > 0;
  const last = turns[turns.length - 1];
  // As the canvas's window has them (canvas-floating.ts): while answering, under the answer too.
  const thinking = busy;
  const tail = last ? last.reply.length : 0;

  useLayoutEffect(() => {
    const scroller = windowRef.current;
    if (scroller && followRef.current) scroller.scrollTop = scroller.scrollHeight;
  }, [turns.length, tail, thinking, windowOpen]);

  /* The window's header moves it, as the canvas's does. */
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

  return createPortal(
    <div
      className="cv-scope ask-willow"
      // A press anywhere outside the card closes it, as the canvas's floating prompt does.
      onMouseDown={(event) => { if (event.target === event.currentTarget) closeAskWillow(); }}
    >
      <div
        ref={cardRef}
        className={`ask-willow__card${windowOpen ? ' cv-float-card--window' : ''}`}
        // Not hidden until measured, which would lose the field its focus: it is placed before
        // the first paint all the same.
        style={{
          left: place?.left ?? request.near.left,
          top: place?.top ?? (below ? request.near.bottom + GAP : request.near.top - GAP - PILL_HEIGHT),
          transform: offset.x || offset.y ? `translate(${offset.x}px, ${offset.y}px)` : undefined,
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
            <blockquote className="ask-willow__quote">{request.text.trim()}</blockquote>
            {turns.map((turn) => (
              <div key={turn.id} className="cv-float-window__entry">
                <div className="cv-float-window__user">{turn.question}</div>
                {turn.reply.trim() && <FloatingReply text={turn.reply} />}
                {turn.error && (
                  <div className="ask-willow__error" role="alert">
                    <span>{turn.error.message}</span>
                    {turn.error.detail && <span className="ask-willow__error-detail">{turn.error.detail}</span>}
                  </div>
                )}
              </div>
            ))}
            {thinking && <ThinkingDots />}
          </div>
        )}
        <CanvasCoCreateInput
          placeholder="Ask Willow"
          autoFocus
          inputRef={inputRef}
          value={value}
          onValueChange={setValue}
          disabled={busy}
          onSend={send}
        />
      </div>
    </div>,
    document.body,
  );
}

/** Mounted once in the desktop app (StudioLayout); shows while a selection is being asked about. */
export function AskWillow({ modelConfig }: { modelConfig: unknown }) {
  const request = useStore($askWillow);
  if (!request) return null;
  return <AskWillowWindow key={request.id} request={request} modelConfig={modelConfig} />;
}
