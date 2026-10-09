/**
 * Voice dictation for the composer textarea: the take's phases and where its text lands.
 * The take itself — recording, the browser's recognizer, models, on-device Whisper and the
 * fallbacks between them — is `@willow/ai/dictation/dictation-session`, which works in every
 * browser and in the desktop app.
 *
 * The composer keeps its own JSX. This hook owns no markup; it returns the flags the render
 * tree branches on and the handlers the mic and send buttons call.
 *
 * Timing that must not drift:
 *  - 3200ms error-placeholder auto-clear
 *  - 350ms `revealing` phase, which is how long the reveal animation gets
 *  - 400ms mic ripple, driven by `isMicRippling`
 *  - the double `requestAnimationFrame` before restoring the caret, so focus lands after React
 *    has committed the new prompt text
 *  - `requestIdRef` is the staleness guard: every async path re-checks it, so a take started
 *    while another is transcribing discards the first.
 */

import { useState, useRef, useEffect, useCallback, type RefObject } from 'react';
import { useUserDataContext } from '@willow/auth/UserDataContext';
import { startDictation, type DictationSession } from '@willow/ai/dictation/dictation-session';

export interface UseComposerDictationOptions {
  /** Live prompt text, mirrored into a ref so async callbacks read the latest. */
  promptText: string;
  setPromptText: (value: string) => void;
  /** The composer textarea, for caret placement after a transcript lands. */
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** Provider/model settings: which route transcribes, and with what. */
  modelConfig: any;
  /** Fullscreen composer is collapsed when recording starts. */
  isComposerMaximized: boolean;
  setIsComposerMaximized: (value: boolean) => void;
  /** Both menus are closed when recording starts. */
  setIsModelsOpen: (value: boolean) => void;
  setIsPlusMenuOpen: (value: boolean) => void;
}

export interface ComposerDictation {
  /** Live mic input, for the waveform. */
  dictationStream: MediaStream | null;
  /** Transient error text shown in place of the textarea placeholder. */
  dictationPlaceholder: string | null;
  /** While transcribing, what is happening when it takes a while (the on-device model's first download). */
  dictationStatus: string | null;
  isMicRippling: boolean;
  isDictating: boolean;
  isTranscribingDictation: boolean;
  /** recording OR processing — the composer collapses for both. */
  isDictationActive: boolean;
  /** The 350ms window after a transcript lands. */
  isExitingDictation: boolean;
  handleToggleDictation: () => void;
  /** Stops the take and calls `then` once its transcript is in the prompt (Gemini's send while dictating). */
  stopDictationThen: (then: () => void) => void;
}

const DIDNT_CATCH = "Didn't catch that. Try speaking again.";

export const useComposerDictation = ({
  promptText,
  setPromptText,
  textareaRef,
  modelConfig,
  isComposerMaximized,
  setIsComposerMaximized,
  setIsModelsOpen,
  setIsPlusMenuOpen,
}: UseComposerDictationOptions): ComposerDictation => {
  const { apiKeys } = useUserDataContext();
  const [phase, setPhaseState] = useState<'idle' | 'recording' | 'processing' | 'revealing'>('idle');
  const [dictationStream, setDictationStream] = useState<MediaStream | null>(null);
  const [dictationPlaceholder, setDictationPlaceholder] = useState<string | null>(null);
  const [dictationStatus, setDictationStatus] = useState<string | null>(null);
  const [isMicRippling, setIsMicRippling] = useState(false);
  const phaseRef = useRef(phase);
  const requestIdRef = useRef(0);
  const sessionRef = useRef<DictationSession | null>(null);
  const prevPromptRef = useRef('');
  const selectionRef = useRef({ start: 0, end: 0 });
  const revealTimerRef = useRef<number | null>(null);
  const placeholderTimerRef = useRef<number | null>(null);
  const afterRevealRef = useRef<(() => void) | null>(null);
  const stopWhenReadyRef = useRef(false);
  const promptTextRef = useRef(promptText);
  const isDictating = phase === 'recording';
  const isTranscribingDictation = phase === 'processing';
  const isDictationActive = isDictating || isTranscribingDictation;
  const isExitingDictation = phase === 'revealing';

  const setPhase = useCallback((next: typeof phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  useEffect(() => {
    promptTextRef.current = promptText;
  }, [promptText]);

  const surfaceError = useCallback((message: string) => {
    console.warn('[Dictation]', message);
    setDictationPlaceholder(message);
    if (placeholderTimerRef.current) window.clearTimeout(placeholderTimerRef.current);
    placeholderTimerRef.current = window.setTimeout(() => {
      setDictationPlaceholder(null);
      placeholderTimerRef.current = null;
    }, 3200);
  }, []);

  const reveal = useCallback((requestId: number, rawTranscript: string, errorMessage?: string) => {
    if (requestIdRef.current !== requestId) return;
    sessionRef.current = null;
    setDictationStream(null);
    setDictationStatus(null);
    const transcript = rawTranscript.trim();
    const basePrompt = prevPromptRef.current;
    const selectionStart = Math.max(0, Math.min(selectionRef.current.start, basePrompt.length));
    const selectionEnd = Math.max(selectionStart, Math.min(selectionRef.current.end, basePrompt.length));
    let nextPrompt = basePrompt;
    let nextCaret = selectionStart;

    if (transcript) {
      const before = basePrompt.slice(0, selectionStart);
      const after = basePrompt.slice(selectionEnd);
      const leadingSpace = before && !/\s$/.test(before) ? ' ' : '';
      const trailingSpace = after && !/^\s/.test(after) ? ' ' : '';
      nextPrompt = `${before}${leadingSpace}${transcript}${trailingSpace}${after}`;
      nextCaret = before.length + leadingSpace.length + transcript.length;
      promptTextRef.current = nextPrompt;
      setPromptText(nextPrompt);
      setDictationPlaceholder(null);
    } else {
      afterRevealRef.current = null;
      surfaceError(errorMessage || DIDNT_CATCH);
    }

    setPhase('revealing');
    if (revealTimerRef.current) window.clearTimeout(revealTimerRef.current);
    revealTimerRef.current = window.setTimeout(() => {
      if (requestIdRef.current !== requestId) return;
      setPhase('idle');
      revealTimerRef.current = null;
    }, 350);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const then = afterRevealRef.current;
        afterRevealRef.current = null;
        if (then) {
          then();
          return;
        }
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(nextCaret, nextCaret);
      });
    });
  }, [setPhase, setPromptText, surfaceError, textareaRef]);

  const stop = useCallback(() => {
    const session = sessionRef.current;
    if (phaseRef.current !== 'recording') return;
    // Still waiting on the microphone (a permission prompt): stop the moment it starts.
    if (!session) {
      stopWhenReadyRef.current = true;
      return;
    }
    const requestId = requestIdRef.current;
    setPhase('processing');
    void session.stop().then(
      (result) => reveal(requestId, result.text, result.error),
      (error) => reveal(requestId, '', error instanceof Error ? error.message : 'Voice transcription failed. Try again.'),
    );
  }, [reveal, setPhase]);

  const start = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    if (revealTimerRef.current) {
      window.clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
    sessionRef.current?.cancel();
    sessionRef.current = null;
    setDictationStream(null);
    setDictationPlaceholder(null);
    setDictationStatus(null);
    stopWhenReadyRef.current = false;
    setIsModelsOpen(false);
    setIsPlusMenuOpen(false);
    if (isComposerMaximized) setIsComposerMaximized(false);

    const textarea = textareaRef.current;
    const basePrompt = promptTextRef.current;
    prevPromptRef.current = basePrompt;
    selectionRef.current = {
      start: textarea?.selectionStart ?? basePrompt.length,
      end: textarea?.selectionEnd ?? basePrompt.length,
    };
    setPhase('recording');

    try {
      const session = await startDictation({
        modelConfig,
        apiKeys,
        onProgress: ({ stage, progress }) => {
          if (requestIdRef.current !== requestId) return;
          setDictationStatus(stage === 'preparing'
            ? `Setting up voice typing on this device… ${Math.round((progress ?? 0) * 100)}%`
            : null);
        },
      });
      if (requestIdRef.current !== requestId || phaseRef.current !== 'recording') {
        session.cancel();
        return;
      }
      sessionRef.current = session;
      setDictationStream(session.stream);
      if (stopWhenReadyRef.current) {
        stopWhenReadyRef.current = false;
        stop();
      }
    } catch (error) {
      reveal(requestId, '', error instanceof Error ? error.message : 'Voice recording could not be started.');
    }
  }, [apiKeys, isComposerMaximized, modelConfig, reveal, setIsComposerMaximized, setIsModelsOpen, setIsPlusMenuOpen, setPhase, stop, textareaRef]);

  useEffect(() => () => {
    requestIdRef.current += 1;
    sessionRef.current?.cancel();
    sessionRef.current = null;
    if (revealTimerRef.current) window.clearTimeout(revealTimerRef.current);
    if (placeholderTimerRef.current) window.clearTimeout(placeholderTimerRef.current);
  }, []);

  const handleToggleDictation = () => {
    if (isTranscribingDictation) return;
    setIsMicRippling(true);
    window.setTimeout(() => setIsMicRippling(false), 400);
    if (isDictating) stop();
    else void start();
  };

  const stopDictationThen = (then: () => void) => {
    afterRevealRef.current = then;
    if (phaseRef.current === 'recording') stop();
  };

  return {
    dictationStream,
    dictationPlaceholder,
    dictationStatus,
    isMicRippling,
    isDictating,
    isTranscribingDictation,
    isDictationActive,
    isExitingDictation,
    handleToggleDictation,
    stopDictationThen,
  };
};
