import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { motion } from 'framer-motion';
import { Lightbulb, ThumbsUp, ThumbsDown, Copy, Check, Search, Terminal } from 'lucide-react';
import { InputBar } from './InputBar';
import { HeroSection } from './HeroSection';
import { BottomPanel } from './BottomPanel';
import { TextShimmer } from './ui/text-shimmer';
import { StreamingMarkdown } from './ui/StreamingMarkdown';
import { streamChat, ChatMessage as AiChatMessage, StreamPhase } from '../lib/ai';
import {
  GeminiLiveSession,
  LIVE_MODEL_ID,
  LiveHistoryTurn,
  playLiveChime,
  primeLiveChimes,
} from '../lib/live';
import { useUserDataContext } from '../context/UserDataContext';
import { useBackground } from '../context/BackgroundContext';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────
interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinkingTime?: number;
  isError?: boolean;
  isGenerating?: boolean;
  /** User bubble is a live-voice utterance whose transcript hasn't arrived yet. */
  isTranscribing?: boolean;
  /** Assistant turn driven by the Live API (no Thinking row). */
  isLive?: boolean;
  /** Live reply cut short by user barge-in — rendered without the action row. */
  wasInterrupted?: boolean;
}

interface DashboardChatProps {
  modelConfig: any;
  selectedModelId: string;
  setSelectedModelId: (id: string) => void;
  isAuthenticated?: boolean;
  onAuthRequired?: () => void;
  agentSwarmEnabled?: boolean;
  onSwarmToggle?: (enabled: boolean) => void;
  onOpenDriveSettings?: () => void;
}

// ──────────────────────────────────────────────────────────────────────────────
// Pure conversational system prompt (no code-gen artifacts)
// ──────────────────────────────────────────────────────────────────────────────
const CHAT_SYSTEM_PROMPT =
  'You are Willow, a friendly and highly capable AI assistant. ' +
  'Respond conversationally and helpfully. Use markdown for formatting ' +
  '(bold, bullet lists, fenced code blocks, tables) when it improves clarity. ' +
  'For simple math or chemistry, prefer plain Unicode (e.g. CO₂, x², →, π) over LaTeX. ' +
  'Only use $$...$$ for genuinely complex equations. ' +
  'Do not wrap responses in boltArtifact or any XML tags.';

// ──────────────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────────────
export const DashboardChat: React.FC<DashboardChatProps> = ({
  modelConfig,
  selectedModelId,
  setSelectedModelId,
  isAuthenticated,
  onAuthRequired,
  agentSwarmEnabled,
  onSwarmToggle,
  onOpenDriveSettings,
}) => {
  const { apiKeys } = useUserDataContext();
  const { background } = useBackground();

  const effectiveBackground = isAuthenticated ? background : 'lines';
  const bgColor = effectiveBackground === 'solid' ? '#212121' : '#1c1c1c';

  // ── State ──────────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [streaming, setStreaming] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  // Pre-response activity label. Stays on the shimmer row until the first real
  // text token streams ('responding'), so tool calls (search / code exec) don't
  // prematurely flip the row to "Thought for Ns".
  const [thinkingPhase, setThinkingPhase] = useState<StreamPhase>('thinking');
  const [thinkSeconds, setThinkSeconds] = useState(0);
  const [reactions, setReactions] = useState<Record<string, 'like' | 'dislike' | null>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // ── Live voice mode (Gemini Live API) ──────────────────────────────────────
  const [isLive, setIsLive] = useState(false);
  const liveSessionRef = useRef<GeminiLiveSession | null>(null);
  // Current in-flight live turn: the user + assistant message ids we're
  // writing into. `acc` mirrors `streaming` so finalize can read it without a
  // stale-closure round-trip.
  const liveTurnRef = useRef<{ userId: string; assistantId: string; acc: string } | null>(null);

  const hasStarted = messages.length > 0 || isGenerating || isLive;

  // ── Scroll-to-top + dynamic response-area sizing (ported from Staging) ─────
  // When you send, your bubble animates to `TARGET_VISUAL_OFFSET` from the top
  // and the assistant block below it is given exactly enough min-height to fill
  // the remaining visible viewport, so you can't scroll into empty space before
  // the reply fills it. The gap below the 👍👎Copy row and the top of the input
  // box matches Staging's gap to its suggestions row (both = the 32px gradient).
  const TARGET_VISUAL_OFFSET = 80; // = pt-20 on the thread column
  const MESSAGE_GAP = 32;          // = gap-8 between message groups

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // Inner content of the last assistant block — measured for the overflow
  // check so it's independent of the outer minHeight/paddingBottom we apply.
  const lastAssistantContentRef = useRef<HTMLDivElement | null>(null);
  const lastScrolledUserId = useRef<string | null>(null);
  const scrollAnimRaf = useRef<number | null>(null);

  const [responseAreaMinHeight, setResponseAreaMinHeight] = useState<number | undefined>(undefined);
  const [needsScrollPadding, setNeedsScrollPadding] = useState(false);
  // Live footer (input overlay) height — InputBar grows with multi-line text /
  // tool chips / attachments, so this must be reactive for the reserve + gap
  // math to stay correct.
  const [footerH, setFooterH] = useState(0);

  // Mirror messages in a ref so resize-driven recomputes can read the latest
  // list without re-running (and racing) on every setMessages.
  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  useLayoutEffect(() => {
    const el = footerRef.current;
    if (!el) return;
    // Keep footerH AND responseAreaMinHeight in lock-step. The rendered
    // reserve is `responseAreaMinHeight + footerH`; if the two update in
    // separate renders the sum dips for one frame, scrollHeight shrinks, the
    // browser clamps scrollTop, and content visibly 'vibrates' while InputBar
    // animates (tool chip add/remove). Setting both in the same RO tick lets
    // React 18 auto-batch them into a single commit with a matched pair.
    const sync = () => {
      const h = el.offsetHeight;
      setFooterH(h);
      setResponseAreaMinHeight((prev) => {
        if (prev === undefined) return prev;
        const c = chatScrollRef.current;
        const msgs = messagesRef.current;
        const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
        const msgEl = lastUser ? messageRefs.current[lastUser.id] : null;
        if (!c || !msgEl) return prev;
        return Math.max(
          0,
          c.clientHeight - TARGET_VISUAL_OFFSET - msgEl.offsetHeight - MESSAGE_GAP - h,
        );
      });
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasStarted]);

  // ── Refs ───────────────────────────────────────────────────────────────────
  const thinkTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const thinkStart = useRef<number>(0);
  const isThinkingRef = useRef(false);
  const thinkSecondsRef = useRef(0);

  useEffect(() => { isThinkingRef.current = isThinking; }, [isThinking]);
  useEffect(() => { thinkSecondsRef.current = thinkSeconds; }, [thinkSeconds]);

  useEffect(() => () => {
    if (thinkTimer.current) clearInterval(thinkTimer.current);
    if (scrollAnimRaf.current) cancelAnimationFrame(scrollAnimRaf.current);
  }, []);

  // ── Scroll-to-top animation on each new user turn ──────────────────────────
  // Mirrors StagingSidebar: reserve the response-area height FIRST via
  // flushSync so the scroll target is always reachable (turn-1 clamp fix),
  // then 85% instant-jump + 200ms ease-out to land the bubble at
  // TARGET_VISUAL_OFFSET.
  useLayoutEffect(() => {
    const container = chatScrollRef.current;
    if (!container) return;

    const userMsgs = messages.filter((m) => m.role === 'user');
    const lastUser = userMsgs[userMsgs.length - 1];
    if (!lastUser || lastUser.id === lastScrolledUserId.current) return;
    lastScrolledUserId.current = lastUser.id;

    requestAnimationFrame(() => {
      const msgEl = messageRefs.current[lastUser.id];
      if (!msgEl || !chatScrollRef.current) return;
      const c = chatScrollRef.current;

      // Reserve response-area height on the new placeholder BEFORE scrolling so
      // there's enough scrollHeight to reach the target. Read the LIVE footer
      // height from the DOM (InputBar has just shrunk after submit) and commit
      // it to state in the same flushSync so the reserve render uses matching
      // numbers — otherwise `responseAreaMinHeight` (computed with the small
      // live value) would be paired with a stale large `footerH` state.
      const liveFooterH = footerRef.current?.offsetHeight ?? 0;
      const preMinH =
        c.clientHeight - TARGET_VISUAL_OFFSET - msgEl.offsetHeight - MESSAGE_GAP - liveFooterH;
      flushSync(() => {
        setFooterH(liveFooterH);
        setResponseAreaMinHeight(Math.max(0, preMinH));
        setNeedsScrollPadding(false);
      });

      // The previous reply is now at its natural height, so the 👍👎Copy row
      // sits directly above the new bubble and they sweep together.
      // Animate from the CURRENT scroll position — never snap — so nothing
      // teleports; the bubble simply rises from exactly where it appeared.
      const targetScrollTop = Math.max(0, msgEl.offsetTop - TARGET_VISUAL_OFFSET);
      const animStart = Math.min(c.scrollTop, targetScrollTop);
      // Animate the FULL distance (no instant-jump) so the bubble visibly
      // rises from the prompt box to the top.
      const distance = targetScrollTop - animStart;
      const t0 = performance.now();
      const dur = 320;
      const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

      const step = (now: number) => {
        const p = Math.min((now - t0) / dur, 1);
        c.scrollTop = animStart + distance * easeOutCubic(p);
        if (p < 1) {
          scrollAnimRaf.current = requestAnimationFrame(step);
        } else {
          c.scrollTop = targetScrollTop;
          scrollAnimRaf.current = null;
        }
      };
      scrollAnimRaf.current = requestAnimationFrame(step);
    });
  }, [messages]);

  // ── Recalculate reserved height when the viewport OR footer height changes.
  //    Intentionally NOT keyed on `messages` — the scroll-to-top RAF is the
  //    single authority for per-turn recompute; this effect only corrects for
  //    real size changes (window resize, InputBar grow/shrink between turns).
  useEffect(() => {
    const c = chatScrollRef.current;
    if (!c) return;
    const recompute = () => {
      setResponseAreaMinHeight((prev) => {
        if (prev === undefined) return prev;
        const msgs = messagesRef.current;
        const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
        const msgEl = lastUser ? messageRefs.current[lastUser.id] : null;
        if (!msgEl) return prev;
        // Read the live footer height so a container resize always commits a
        // matched (responseAreaMinHeight, footerH) pair even mid-InputBar
        // animation; the footer RO above keeps footerH itself in sync.
        const liveFooterH = footerRef.current?.offsetHeight ?? 0;
        return Math.max(
          0,
          c.clientHeight - TARGET_VISUAL_OFFSET - msgEl.offsetHeight - MESSAGE_GAP - liveFooterH,
        );
      });
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(c);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasStarted]);

  // ── Keep needsScrollPadding in sync with whether the reply CONTENT fits
  //    above the footer. Bidirectional: flips true when content outgrows the
  //    reserve (long reply, or footer grew), and flips back false when it fits
  //    again (footer shrank / tool chip removed). Measures the inner content
  //    wrapper so the comparison is independent of the minHeight/paddingBottom
  //    we conditionally apply to the outer block — avoids feedback loops.
  useEffect(() => {
    if (responseAreaMinHeight === undefined) return;
    const el = lastAssistantContentRef.current;
    if (!el) return;
    const check = () => {
      const contentH = el.offsetHeight;
      const fits = contentH <= responseAreaMinHeight + 5;
      setNeedsScrollPadding((prev) => (prev === !fits ? prev : !fits));
    };
    const ro = new ResizeObserver(check);
    ro.observe(el);
    check();
    return () => ro.disconnect();
  }, [messages, responseAreaMinHeight, streaming, footerH]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const stopThinking = useCallback(() => {
    if (thinkTimer.current) { clearInterval(thinkTimer.current); thinkTimer.current = null; }
    isThinkingRef.current = false;
    setIsThinking(false);
  }, []);

  const resolveModel = useCallback(() => {
    const all = [
      ...(modelConfig?.gemini?.savedModels || []).map((m: any) => ({ ...m, provider: 'gemini' as const })),
      ...(modelConfig?.openai?.savedModels || []).map((m: any) => ({ ...m, provider: 'openai' as const })),
      ...(modelConfig?.anthropic?.savedModels || []).map((m: any) => ({ ...m, provider: 'anthropic' as const })),
    ];
    const sel = all.find((m) => m.id === selectedModelId);
    const provider = (sel?.provider ?? 'gemini') as 'gemini' | 'openai' | 'anthropic';
    const model = sel?.modelId ?? modelConfig?.gemini?.model ?? 'gemini-3-flash-preview';
    const thinkingLevel: number = sel?.thinkingLevel ?? modelConfig?.[provider]?.thinkingLevel ?? 0;
    const apiKey: string | undefined = apiKeys?.[provider]?.[0];
    return { provider, model, thinkingLevel, apiKey };
  }, [modelConfig, selectedModelId, apiKeys]);

  const newId = () => crypto.randomUUID?.() || Math.random().toString(36).slice(2);

  const finalizeAssistant = (
    id: string,
    content: string,
    thinkingTime?: number,
    isError = false
  ) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id
          ? { ...m, content, thinkingTime, isError, isGenerating: false }
          : m
      )
    );
  };

  // ── Send ───────────────────────────────────────────────────────────────────
  const handleSend = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isGenerating) return;
      if (!isAuthenticated) { onAuthRequired?.(); return; }

      const userMsg: ChatMsg = { id: newId(), role: 'user', content: trimmed };
      const assistantId = newId();
      const assistantPlaceholder: ChatMsg = {
        id: assistantId,
        role: 'assistant',
        content: '',
        isGenerating: true,
      };

      const prevMessages = messages;
      // Push user + assistant placeholder in one update so the assistant block
      // mounts once and never remounts (prevents completion flicker).
      setMessages((prev) => [...prev, userMsg, assistantPlaceholder]);

      setIsGenerating(true);
      setIsThinking(true);
      setThinkingPhase('thinking');
      isThinkingRef.current = true;
      setThinkSeconds(0);
      thinkSecondsRef.current = 0;
      setStreaming('');
      thinkStart.current = Date.now();
      if (thinkTimer.current) clearInterval(thinkTimer.current);
      thinkTimer.current = setInterval(() => {
        const s = Math.ceil((Date.now() - thinkStart.current) / 1000);
        thinkSecondsRef.current = s;
        setThinkSeconds(s);
      }, 1000);

      const { provider, model, thinkingLevel, apiKey } = resolveModel();
      if (!apiKey) {
        stopThinking();
        setIsGenerating(false);
        finalizeAssistant(
          assistantId,
          `API key for **${provider}** is missing. Add one in **Settings → Models** to start chatting.`,
          undefined,
          true
        );
        return;
      }

      const history: AiChatMessage[] = [...prevMessages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      let acc = '';
      try {
        await streamChat(
          history,
          // Chat mode: search grounding + native code execution both offered.
          { provider, model, apiKey, thinkingLevel, enableSearch: true, enableCodeExecution: true },
          (token) => {
            if (isThinkingRef.current) {
              const elapsed = Math.max(1, Math.ceil((Date.now() - thinkStart.current) / 1000));
              thinkSecondsRef.current = elapsed;
              setThinkSeconds(elapsed);
              stopThinking();
            }
            acc += token;
            setStreaming(acc);
          },
          () => {},
          CHAT_SYSTEM_PROMPT,
          (phase) => {
            // Keep the shimmer row live with the right label until real text
            // streams. 'responding' is handled by the onToken branch above.
            if (phase !== 'responding') setThinkingPhase(phase);
          }
        );
        finalizeAssistant(assistantId, acc, thinkSecondsRef.current);
      } catch (e: any) {
        finalizeAssistant(
          assistantId,
          `Something went wrong: ${e?.message || 'Unknown error.'}`,
          undefined,
          true
        );
      } finally {
        stopThinking();
        setStreaming('');
        setIsGenerating(false);
      }
    },
    [messages, isGenerating, isAuthenticated, onAuthRequired, resolveModel, stopThinking]
  );

  // ── Live mode ──────────────────────────────────────────────────────────────
  // A live "turn" maps onto the exact same message shape as a typed turn:
  //   • onTurnStart    → push user bubble (isTranscribing) + assistant placeholder
  //                       in ONE setMessages — same as handleSend — so the
  //                       scroll-to-top useLayoutEffect + flushSync reserve fire
  //                       identically and all spacing rules hold.
  //   • onUserTranscript → fill the user bubble's `content`, drop isTranscribing
  //   • onModelText      → append to `streaming` (same render path as typed)
  //   • onTurnComplete   → finalizeAssistant + clear streaming, ready for next
  //                       utterance; session stays open.
  const openLiveTurn = useCallback(() => {
    const userId = newId();
    const assistantId = newId();
    liveTurnRef.current = { userId, assistantId, acc: '' };

    setMessages((prev) => [
      ...prev,
      { id: userId, role: 'user', content: '', isTranscribing: true },
      { id: assistantId, role: 'assistant', content: '', isGenerating: true, isLive: true },
    ]);

    // Live turns are real-time: no "Thinking" shimmer, no "Thought for Xs".
    // Keep isGenerating so the streaming render path + action-row gate work,
    // but leave the think timer alone.
    setIsGenerating(true);
    setIsThinking(false);
    isThinkingRef.current = false;
    setStreaming('');
  }, []);

  const closeLiveTurn = useCallback(
    (opts?: { error?: string; aborted?: boolean }) => {
      const turn = liveTurnRef.current;
      liveTurnRef.current = null;
      stopThinking();
      setIsGenerating(false);
      if (!turn) return;
      // If neither a transcript nor a model token ever arrived (e.g. mic blip),
      // drop the empty pair rather than leave dangling bubbles.
      if (!opts?.error && turn.acc.length === 0) {
        let hadTranscript = false;
        setMessages((prev) => {
          hadTranscript = !!prev.find((m) => m.id === turn.userId)?.content;
          return hadTranscript
            ? prev
            : prev.filter((m) => m.id !== turn.userId && m.id !== turn.assistantId);
        });
        // If we removed them, also drop the reserve + scroll bookkeeping so the
        // next real turn re-runs the sweep from scratch.
        if (!hadTranscript) {
          lastScrolledUserId.current = null;
          setResponseAreaMinHeight(undefined);
        }
        if (!hadTranscript) { setStreaming(''); return; }
      }
      // Interrupted: the text released so far is exactly what was *spoken*
      // (the audio-synced drain dropped everything after the barge-in point).
      // Append an em-dash so it reads as cut-off, and flag the message so the
      // render skips the like/dislike/copy row — and so any later typed turn
      // sends only the spoken-so-far text as context.
      const finalText = opts?.error
        ? opts.error
        : opts?.aborted && turn.acc
          ? `${turn.acc.replace(/\s+$/, '')} —`
          : turn.acc;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === turn.userId
            ? { ...m, isTranscribing: false, content: m.content || '…' }
            : m.id === turn.assistantId
              ? {
                  ...m,
                  content: finalText,
                  isGenerating: false,
                  isError: !!opts?.error,
                  wasInterrupted: !!opts?.aborted,
                  thinkingTime: undefined,
                }
              : m
        )
      );
      setStreaming('');
    },
    [stopThinking]
  );

  const handleStopLive = useCallback(() => {
    // Falling two-note earcon = "done listening". Only on explicit user stop —
    // error closes stay silent.
    playLiveChime('end');
    liveSessionRef.current?.stop();
    liveSessionRef.current = null;
    setIsLive(false);
    // If the model was mid-reply, treat stop as an interruption: `turn.acc` is
    // exactly what was *heard* (audio-synced release already dropped anything
    // unspoken), so finalise with the trailing `—` just like a barge-in.
    if (liveTurnRef.current) closeLiveTurn({ aborted: true });
  }, [closeLiveTurn]);

  const handleStartLive = useCallback(() => {
    if (isLive || isGenerating) return;
    if (!isAuthenticated) { onAuthRequired?.(); return; }

    const apiKey: string | undefined = apiKeys?.gemini?.[0];
    if (!apiKey) {
      // Surface the same friendly inline error style as typed chat.
      const uId = newId();
      const aId = newId();
      setMessages((prev) => [
        ...prev,
        { id: uId, role: 'user', content: 'Start live voice chat' },
        {
          id: aId,
          role: 'assistant',
          content:
            'A **Gemini** API key is required for live voice mode ' +
            `(\`${LIVE_MODEL_ID}\`). Add one in **Settings → Models**.`,
          isError: true,
        },
      ]);
      return;
    }

    // Still inside the click gesture: create/resume the chime AudioContext and
    // kick off both fetches so the start cue is decoded before onOpen fires.
    primeLiveChimes();

    setIsLive(true);

    // Prime the live model with everything already in the thread so a mid-chat
    // voice session has full context. Read from the ref (fresh) not the
    // closed-over `messages`.
    const history: LiveHistoryTurn[] = messagesRef.current
      .filter((m) => m.content)
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        text: m.content,
      }));

    const session = new GeminiLiveSession({
      apiKey,
      model: LIVE_MODEL_ID,
      systemPrompt: CHAT_SYSTEM_PROMPT,
      history,
      // Rising two-note earcon the moment the socket ACKs setup + mic is hot —
      // i.e. the exact instant it's actually listening.
      onOpen: () => playLiveChime('start'),
      onTurnStart: () => openLiveTurn(),
      onUserTranscript: (full) => {
        const turn = liveTurnRef.current;
        if (!turn) return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === turn.userId ? { ...m, content: full, isTranscribing: false } : m
          )
        );
      },
      onModelText: (chunk) => {
        const turn = liveTurnRef.current;
        if (!turn) return;
        // `chunk` is released by live.ts only when its audio is actually being
        // spoken, so `turn.acc` == what the user has *heard* so far.
        turn.acc += chunk;
        setStreaming(turn.acc);
      },
      onTurnComplete: ({ aborted }) => closeLiveTurn({ aborted }),
      onError: (err) => {
        // eslint-disable-next-line no-console
        console.error('[DashboardChat] live error', err);
        if (liveTurnRef.current) {
          // Mid-turn failure → finalise the in-flight assistant bubble with the error.
          closeLiveTurn({ error: `Live session error: ${err.message}` });
        } else {
          // Connect/setup failed before any speech. closeLiveTurn() would
          // early-return (no turn), leaving the user staring at a silent
          // bounce back to the empty state. Push an explicit error pair so
          // the scroll/reserve machinery has something to anchor on AND the
          // user can read what went wrong.
          const uId = newId();
          const aId = newId();
          setMessages((prev) => [
            ...prev,
            { id: uId, role: 'user', content: 'Start live voice chat' },
            {
              id: aId,
              role: 'assistant',
              isError: true,
              content:
                `Couldn't start live mode (\`${LIVE_MODEL_ID}\`).\n\n` +
                `> ${err.message}\n\n` +
                'Check that your Gemini key has **Live API** access and that ' +
                'microphone permission was granted.',
            },
          ]);
        }
        liveSessionRef.current = null;
        setIsLive(false);
      },
      onClose: () => {
        // onError (above) already handled the unhappy path; a clean close just
        // drops back to typed mode.
        liveSessionRef.current = null;
        setIsLive(false);
      },
    });
    liveSessionRef.current = session;
    void session.start();
  }, [
    isLive,
    isGenerating,
    isAuthenticated,
    onAuthRequired,
    apiKeys,
    openLiveTurn,
    closeLiveTurn,
    stopThinking,
  ]);

  // Tear down the socket + mic if the component unmounts mid-session.
  useEffect(() => () => { liveSessionRef.current?.stop(); }, []);

  const handleCopy = (msg: ChatMsg) => {
    navigator.clipboard.writeText(msg.content);
    setCopiedId(msg.id);
    setTimeout(() => setCopiedId((id) => (id === msg.id ? null : id)), 1600);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  // EMPTY STATE — render the *actual* HeroSection + BottomPanel so the layout
  // is literally the same component tree as Develop mode (single source of
  // truth for prompt-box position). Only `onPromptSubmit` differs: it starts
  // an in-dashboard chat instead of navigating to Staging.
  if (!hasStarted) {
    return (
      <div className="flex flex-col min-h-full">
        <HeroSection
          initialMode="chat"
          onPromptSubmit={(prompt) => handleSend(prompt)}
          onStartLive={handleStartLive}
          modelConfig={modelConfig}
          selectedModelId={selectedModelId}
          setSelectedModelId={setSelectedModelId}
          onAuthRequired={onAuthRequired}
          isAuthenticated={isAuthenticated}
          agentSwarmEnabled={agentSwarmEnabled}
          onSwarmToggle={onSwarmToggle}
        />
        {isAuthenticated && (
          <div className="pb-20">
            <BottomPanel onOpenDriveSettings={onOpenDriveSettings} />
          </div>
        )}
      </div>
    );
  }

  // ACTIVE STATE — ChatGPT-style thread with bottom-docked input
  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;

  return (
    <div className="relative flex flex-col h-full w-full">
      {/* Scrollable message thread
          scrollbar-gutter:stable keeps the mx-auto column from nudging left
          the moment streamed content grows tall enough to spawn a scrollbar. */}
      <div
        ref={chatScrollRef}
        className="flex-1 overflow-y-auto"
        style={{ scrollbarGutter: 'stable' }}
      >
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25, delay: 0.15 }}
          className="mx-auto w-full max-w-[768px] px-5 pt-20 flex flex-col gap-8"
          style={{
            paddingBottom:
              responseAreaMinHeight !== undefined && !needsScrollPadding ? 0 : footerH,
          }}
        >
          {messages.map((msg) => {
            if (msg.role === 'user') {
              return (
                <motion.div
                  key={msg.id}
                  ref={(el) => { messageRefs.current[msg.id] = el; }}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className="flex justify-end"
                >
                  <div className="max-w-[78%] min-w-0 bg-[#27272a] text-gray-200 px-4 py-3 rounded-2xl text-[15px] leading-relaxed shadow-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                    {msg.isTranscribing && !msg.content ? (
                      // Live-mode utterance whose transcript hasn't landed yet.
                      // The model has *already* got the raw audio — this is
                      // purely a visual placeholder until inputTranscription
                      // streams back.
                      <span className="italic text-gray-500 select-none">Transcribing…</span>
                    ) : (
                      msg.content
                    )}
                  </div>
                </motion.div>
              );
            }

            // Assistant — single persistent element across thinking → streaming → done.
            const generating = !!msg.isGenerating;
            // While generating, body comes from the live `streaming` buffer; once
            // finalised, `msg.content` holds the full text. Using `||` (not a
            // ternary) means the instant generation flips off we keep rendering
            // the same string, so StreamingMarkdown's RAF buffer can finish
            // draining without a content swap.
            const bodyText = generating ? streaming : msg.content || streaming;
            const thoughtSecs = generating ? thinkSeconds : msg.thinkingTime;
            // Live turns: no "Thinking" shimmer, no "Thought for Xs" — the
            // voice starts near-instantly so the row is noise.
            const showThinkingRow =
              !msg.isError &&
              !msg.isLive &&
              (generating || msg.thinkingTime !== undefined);
            const isLastAssistant = msg.id === lastAssistantId;

            return (
              <div
                key={msg.id}
                ref={(el) => { messageRefs.current[msg.id] = el; }}
                style={
                  isLastAssistant && responseAreaMinHeight !== undefined
                    ? {
                        // Reserve exactly the visible area below the user bubble.
                        // paddingBottom = footer height so the action row clears
                        // the input overlay by the same 32px (h-8 gradient) that
                        // separates action-row → suggestions in Staging.
                        minHeight: !needsScrollPadding
                          ? responseAreaMinHeight + footerH
                          : undefined,
                        paddingBottom: !needsScrollPadding ? footerH : undefined,
                      }
                    : undefined
                }
              >
                {/* Inner wrapper = pure content height, unaffected by the outer
                    minHeight/paddingBottom. Measured for the overflow check. */}
                <div
                  ref={isLastAssistant ? lastAssistantContentRef : undefined}
                  className="space-y-4"
                >
                {showThinkingRow && (() => {
                  const active = generating && isThinking;
                  const PhaseIcon =
                    active && thinkingPhase === 'searching' ? Search
                    : active && thinkingPhase === 'executing' ? Terminal
                    : Lightbulb;
                  const phaseLabel =
                    thinkingPhase === 'searching' ? 'Searching'
                    : thinkingPhase === 'executing' ? 'Running code'
                    : 'Thinking';
                  return (
                    <div className="flex items-center gap-2.5" style={{ color: '#81888f' }}>
                      <PhaseIcon size={18} />
                      {active ? (
                        <TextShimmer className="text-[15.15px] font-medium" duration={1.5}>
                          {phaseLabel}
                        </TextShimmer>
                      ) : (
                        <span className="text-[15.15px] font-medium">
                          Thought for {Math.round(thoughtSecs ?? 0)}s
                        </span>
                      )}
                    </div>
                  );
                })()}

                <StreamingMarkdown
                  text={bodyText}
                  isStreaming={generating}
                  animate={!msg.isError}
                />

                {/* Action row — fades in only after completion to avoid layout jump */}
                <motion.div
                  initial={false}
                  animate={{
                    opacity: generating ? 0 : 1,
                    height: generating ? 0 : 'auto',
                  }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="flex items-center gap-3 pt-4 border-t border-white/5">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() =>
                          setReactions((r) => ({ ...r, [msg.id]: r[msg.id] === 'like' ? null : 'like' }))
                        }
                        className={`p-1.5 transition-colors ${
                          reactions[msg.id] === 'like' ? 'text-white' : 'text-gray-500 hover:text-gray-300'
                        }`}
                      >
                        <ThumbsUp size={14} fill={reactions[msg.id] === 'like' ? 'currentColor' : 'none'} />
                      </button>
                      <button
                        onClick={() =>
                          setReactions((r) => ({ ...r, [msg.id]: r[msg.id] === 'dislike' ? null : 'dislike' }))
                        }
                        className={`p-1.5 transition-colors ${
                          reactions[msg.id] === 'dislike' ? 'text-white' : 'text-gray-500 hover:text-gray-300'
                        }`}
                      >
                        <ThumbsDown size={14} fill={reactions[msg.id] === 'dislike' ? 'currentColor' : 'none'} />
                      </button>
                    </div>
                    <button
                      onClick={() => handleCopy(msg)}
                      className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors"
                    >
                      {copiedId === msg.id ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </div>
                </motion.div>
                </div>
              </div>
            );
          })}
        </motion.div>
      </div>

      {/* Bottom-docked input (footer). h-8 gradient matches Staging so the gap
          action-row → input-top here == action-row → suggestions-top there. */}
      <motion.div
        ref={footerRef}
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', duration: 0.55, bounce: 0.15 }}
        className="absolute bottom-0 left-0 right-0 z-30 flex flex-col items-center pointer-events-none"
      >
        <div
          className="h-8 w-full max-w-[820px]"
          style={{ background: `linear-gradient(to top, ${bgColor} 20%, ${bgColor}00)` }}
        />
        <div
          className="w-full flex justify-center px-4 pb-5 pointer-events-auto"
          style={{ backgroundColor: bgColor }}
        >
          <InputBar
            chatVariant
            currentMode="chat"
            onModeChange={() => {}}
            onSubmit={(prompt) => {
              // Typing + Enter while live implicitly ends the voice session and
              // falls back to the regular typed path.
              if (isLive) handleStopLive();
              handleSend(prompt);
            }}
            liveActive={isLive}
            onStartLive={handleStartLive}
            onStopLive={handleStopLive}
            modelConfig={modelConfig}
            selectedModelId={selectedModelId}
            setSelectedModelId={setSelectedModelId}
            onAuthRequired={onAuthRequired}
            isAuthenticated={isAuthenticated}
          />
        </div>
      </motion.div>
    </div>
  );
};

export default DashboardChat;
