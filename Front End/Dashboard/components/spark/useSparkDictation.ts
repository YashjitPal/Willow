import { useCallback, useEffect, useRef, useState } from 'react';
import { useUserDataContext } from '../../context/UserDataContext';
import { GeminiLiveSession, LIVE_MODEL_ID } from '../../lib/live';

export interface UseSparkDictationOptions {
  value: string;
  onChange: (value: string) => void;
  onError?: (error: Error) => void;
}

export interface SparkDictationControls {
  error: string | null;
  isDictating: boolean;
  stopDictation: () => void;
  toggleDictation: () => void;
}

const MISSING_KEY_MESSAGE =
  'A Gemini API key is required for voice dictation. Add one in Settings > Models.';

const toError = (error: unknown): Error => {
  if (error instanceof Error) return error;
  if (typeof error === 'string' && error.trim()) return new Error(error);
  return new Error('Voice dictation could not be started.');
};

export const useSparkDictation = ({
  value,
  onChange,
  onError,
}: UseSparkDictationOptions): SparkDictationControls => {
  const { apiKeys } = useUserDataContext();
  const [isDictating, setIsDictating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<GeminiLiveSession | null>(null);
  const baseValueRef = useRef('');
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onErrorRef = useRef(onError);
  const mountedRef = useRef(false);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      const session = sessionRef.current;
      sessionRef.current = null;
      session?.stop();
    };
  }, []);

  const surfaceError = useCallback((cause: unknown) => {
    const nextError = toError(cause);
    if (mountedRef.current) {
      setError(nextError.message);
      setIsDictating(false);
    }
    onErrorRef.current?.(nextError);
  }, []);

  const stopDictation = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    session?.stop();
    if (mountedRef.current) setIsDictating(false);
  }, []);

  const toggleDictation = useCallback(() => {
    if (sessionRef.current) {
      stopDictation();
      return;
    }

    const apiKey = apiKeys?.gemini?.find((key) => key.trim())?.trim();
    if (!apiKey) {
      surfaceError(new Error(MISSING_KEY_MESSAGE));
      return;
    }

    setError(null);
    setIsDictating(true);
    baseValueRef.current = valueRef.current;

    let session: GeminiLiveSession;
    session = new GeminiLiveSession({
      apiKey,
      model: LIVE_MODEL_ID,
      transcribeOnly: true,
      onUserTranscript: (transcript) => {
        if (sessionRef.current !== session) return;

        const baseValue = baseValueRef.current;
        const separator = baseValue.trim() ? ' ' : '';
        const nextValue = `${baseValue}${separator}${transcript}`;
        valueRef.current = nextValue;
        onChangeRef.current(nextValue);
      },
      onTurnComplete: () => {
        if (sessionRef.current === session) {
          baseValueRef.current = valueRef.current;
        }
      },
      onError: (cause) => {
        if (sessionRef.current !== session) return;
        sessionRef.current = null;
        surfaceError(cause);
      },
      onClose: () => {
        if (sessionRef.current !== session) return;
        sessionRef.current = null;
        if (mountedRef.current) setIsDictating(false);
      },
    });

    sessionRef.current = session;
    void session.start().catch((cause: unknown) => {
      if (sessionRef.current !== session) return;
      sessionRef.current = null;
      session.stop();
      surfaceError(cause);
    });
  }, [apiKeys?.gemini, stopDictation, surfaceError]);

  return {
    error,
    isDictating,
    stopDictation,
    toggleDictation,
  };
};

