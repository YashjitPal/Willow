/**
 * Voice dictation for the composer textarea.
 *
 * Lifted out of Composer.tsx verbatim — every `useState`, `useRef`,
 * `useCallback` and `useEffect` below is byte-identical to what ran inside
 * `InputBar`, dependency arrays included. A custom hook keeps that possible:
 * the block only ever read outer values, so those reads become parameters and
 * nothing inside had to be reshaped.
 *
 * The composer keeps its own JSX. This hook owns no markup; it returns the
 * flags the render tree branches on plus the one handler the mic button calls.
 *
 * `useUserDataContext` moved in with it: `apiKeys` was read nowhere else in
 * Composer.tsx, and a hook consumes context from the same tree position as the
 * component that calls it.
 *
 * Timing that must not drift:
 *  - 3200ms error-placeholder auto-clear
 *  - 350ms `revealing` phase, which is how long the reveal animation gets
 *  - 400ms mic ripple, driven by `isMicRippling`
 *  - the double `requestAnimationFrame` before restoring the caret, so focus
 *    lands after React has committed the new prompt text
 *  - `dictationRequestIdRef` is the staleness guard: every async path re-checks
 *    it, so a second recording started mid-transcription discards the first.
 */

import { useState, useRef, useEffect, useCallback, type RefObject } from 'react';
import { useUserDataContext } from '@willow/auth/UserDataContext';
import { transcribeRecordedAudio } from '@willow/ai/transcription';

export interface UseComposerDictationOptions {
  /** Live prompt text, mirrored into a ref so async callbacks read the latest. */
  promptText: string;
  setPromptText: (value: string) => void;
  /** The composer textarea, for caret placement after a transcript lands. */
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** Provider/model settings, forwarded to the transcription call. */
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
  isMicRippling: boolean;
  isDictating: boolean;
  isTranscribingDictation: boolean;
  /** recording OR processing — the composer collapses for both. */
  isDictationActive: boolean;
  /** The 350ms window after a transcript lands. */
  isExitingDictation: boolean;
  handleToggleDictation: () => void;
}

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
  const [dictationPhase, setDictationPhaseState] = useState<'idle' | 'recording' | 'processing' | 'revealing'>('idle');
  const [dictationStream, setDictationStream] = useState<MediaStream | null>(null);
  const [dictationPlaceholder, setDictationPlaceholder] = useState<string | null>(null);
  const [isMicRippling, setIsMicRippling] = useState(false);
  const dictationPrevPromptRef = useRef<string>("");
  const dictationSelectionRef = useRef({ start: 0, end: 0 });
  const dictationPhaseRef = useRef(dictationPhase);
  const dictationRequestIdRef = useRef(0);
  const dictationRecorderRef = useRef<MediaRecorder | null>(null);
  const dictationStreamRef = useRef<MediaStream | null>(null);
  const dictationAbortRef = useRef<AbortController | null>(null);
  const dictationRevealTimerRef = useRef<number | null>(null);
  const dictationPlaceholderTimerRef = useRef<number | null>(null);
  const promptTextRef = useRef(promptText);
  const isDictating = dictationPhase === 'recording';
  const isTranscribingDictation = dictationPhase === 'processing';
  const isDictationActive = isDictating || isTranscribingDictation;
  const isExitingDictation = dictationPhase === 'revealing';

  const setDictationPhase = useCallback((phase: typeof dictationPhase) => {
    dictationPhaseRef.current = phase;
    setDictationPhaseState(phase);
  }, []);

  useEffect(() => {
    promptTextRef.current = promptText;
  }, [promptText]);

  const releaseDictationStream = useCallback((stream?: MediaStream | null) => {
    const targetStream = stream || dictationStreamRef.current;
    targetStream?.getTracks().forEach((track) => track.stop());
    if (!stream || dictationStreamRef.current === stream) {
      dictationStreamRef.current = null;
    }
    setDictationStream((current) => current === targetStream ? null : current);
  }, []);

  const surfaceDictationError = useCallback((message: string) => {
    console.warn('[Dictation]', message);
    setDictationPlaceholder(message);
    if (dictationPlaceholderTimerRef.current) {
      window.clearTimeout(dictationPlaceholderTimerRef.current);
    }
    dictationPlaceholderTimerRef.current = window.setTimeout(() => {
      setDictationPlaceholder(null);
      dictationPlaceholderTimerRef.current = null;
    }, 3200);
  }, []);

  const revealDictationResult = useCallback((
    requestId: number,
    rawTranscript: string,
    errorMessage?: string,
  ) => {
    if (dictationRequestIdRef.current !== requestId) return;

    dictationAbortRef.current = null;
    const transcript = rawTranscript.trim();
    const basePrompt = dictationPrevPromptRef.current;
    const selectionStart = Math.max(0, Math.min(dictationSelectionRef.current.start, basePrompt.length));
    const selectionEnd = Math.max(selectionStart, Math.min(dictationSelectionRef.current.end, basePrompt.length));
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
    } else if (errorMessage) {
      surfaceDictationError(errorMessage);
    }

    setDictationPhase('revealing');
    if (dictationRevealTimerRef.current) {
      window.clearTimeout(dictationRevealTimerRef.current);
    }
    dictationRevealTimerRef.current = window.setTimeout(() => {
      if (dictationRequestIdRef.current !== requestId) return;
      setDictationPhase('idle');
      dictationRevealTimerRef.current = null;
    }, 350);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(nextCaret, nextCaret);
      });
    });
  }, [setDictationPhase, surfaceDictationError]);

  const stopDictationRecording = useCallback(() => {
    if (dictationPhaseRef.current !== 'recording') return;
    setDictationPhase('processing');

    const recorder = dictationRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
        return;
      } catch {
        // Fall through to the empty-result recovery below.
      }
    }

    releaseDictationStream();
    revealDictationResult(
      dictationRequestIdRef.current,
      '',
      "Didn't catch that. Try speaking again.",
    );
  }, [releaseDictationStream, revealDictationResult, setDictationPhase]);

  const startDictationRecording = useCallback(async () => {
    const requestId = ++dictationRequestIdRef.current;
    if (dictationRevealTimerRef.current) {
      window.clearTimeout(dictationRevealTimerRef.current);
      dictationRevealTimerRef.current = null;
    }
    dictationAbortRef.current?.abort();
    dictationAbortRef.current = null;
    releaseDictationStream();
    setDictationPlaceholder(null);
    setIsModelsOpen(false);
    setIsPlusMenuOpen(false);
    if (isComposerMaximized) setIsComposerMaximized(false);

    const textarea = textareaRef.current;
    const basePrompt = promptTextRef.current;
    dictationPrevPromptRef.current = basePrompt;
    dictationSelectionRef.current = {
      start: textarea?.selectionStart ?? basePrompt.length,
      end: textarea?.selectionEnd ?? basePrompt.length,
    };
    setDictationPhase('recording');

    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        throw new Error('Voice recording is not supported in this browser.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      if (
        dictationRequestIdRef.current !== requestId
        || dictationPhaseRef.current !== 'recording'
      ) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      dictationStreamRef.current = stream;
      setDictationStream(stream);
      const preferredMimeType = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
      ].find((mimeType) => MediaRecorder.isTypeSupported?.(mimeType));
      const recorder = new MediaRecorder(stream, preferredMimeType ? { mimeType: preferredMimeType } : undefined);
      const recordedChunks: Blob[] = [];
      dictationRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunks.push(event.data);
      };

      recorder.onerror = () => {
        if (dictationRequestIdRef.current !== requestId) return;
        dictationRecorderRef.current = null;
        releaseDictationStream(stream);
        revealDictationResult(requestId, '', 'Voice recording stopped unexpectedly. Try again.');
      };

      recorder.onstop = async () => {
        if (dictationRecorderRef.current === recorder) dictationRecorderRef.current = null;
        const audio = new Blob(recordedChunks, {
          type: recorder.mimeType || preferredMimeType || 'audio/webm',
        });
        releaseDictationStream(stream);

        if (dictationRequestIdRef.current !== requestId) return;
        if (dictationPhaseRef.current === 'revealing' || dictationPhaseRef.current === 'idle') return;
        if (dictationPhaseRef.current === 'recording') setDictationPhase('processing');
        if (!audio.size) {
          revealDictationResult(requestId, '', "Didn't catch that. Try speaking again.");
          return;
        }

        const controller = new AbortController();
        dictationAbortRef.current = controller;
        try {
          const transcript = await transcribeRecordedAudio({
            audio,
            apiKeys,
            modelConfig,
            signal: controller.signal,
          });
          revealDictationResult(
            requestId,
            transcript,
            transcript ? undefined : "Didn't catch that. Try speaking again.",
          );
        } catch (error) {
          if (controller.signal.aborted || dictationRequestIdRef.current !== requestId) return;
          revealDictationResult(
            requestId,
            '',
            error instanceof Error ? error.message : 'Voice transcription failed. Try again.',
          );
        }
      };

      recorder.start();
    } catch (error) {
      releaseDictationStream();
      revealDictationResult(
        requestId,
        '',
        error instanceof Error ? error.message : 'Voice recording could not be started.',
      );
    }
  }, [apiKeys, isComposerMaximized, modelConfig, releaseDictationStream, revealDictationResult, setDictationPhase]);

  useEffect(() => () => {
    dictationRequestIdRef.current += 1;
    dictationAbortRef.current?.abort();
    if (dictationRevealTimerRef.current) window.clearTimeout(dictationRevealTimerRef.current);
    if (dictationPlaceholderTimerRef.current) window.clearTimeout(dictationPlaceholderTimerRef.current);
    const recorder = dictationRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch {}
    }
    releaseDictationStream();
  }, [releaseDictationStream]);

  const handleToggleDictation = () => {
    if (isTranscribingDictation) return;
    setIsMicRippling(true);
    window.setTimeout(() => setIsMicRippling(false), 400);

    if (isDictating) {
      stopDictationRecording();
    } else {
      void startDictationRecording();
    }
  };

  return {
    dictationStream,
    dictationPlaceholder,
    isMicRippling,
    isDictating,
    isTranscribingDictation,
    isDictationActive,
    isExitingDictation,
    handleToggleDictation,
  };
};
