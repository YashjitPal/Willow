import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Dynamically glob all audio files placed inside assets/voices/ and subfolders (e.g. assets/voices/Google/)
 * Supported extensions: mp3, wav, m4a, ogg, aac, webm
 */
const voiceAudioModules = import.meta.glob(
  '@willow/assets/voices/**/*.{mp3,wav,m4a,ogg,aac,webm}',
  { eager: true, import: 'default' },
) as Record<string, string>;

function normalizeName(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/^l/, 'i')
    .replace(/irel$/, 'riel');
}

/**
 * Resolves the audio URL for a voice ID.
 * Matches case-insensitively and gracefully across subfolders in `assets/voices/`.
 */
export function getVoicePreviewUrl(
  voiceId: string,
  providerId?: string,
  providerLabel?: string,
): string {
  const targetExact = voiceId.toLowerCase();
  const targetNorm = normalizeName(voiceId);

  const providerHints = [
    providerId?.toLowerCase(),
    providerLabel?.toLowerCase(),
    'google',
    'gemini',
  ].filter(Boolean) as string[];

  // Pass 1: Match provider subfolder + exact filename
  for (const [key, url] of Object.entries(voiceAudioModules)) {
    const parts = key.toLowerCase().split('/');
    const filename = parts.pop()?.split('.')[0] || '';
    if (filename === targetExact && providerHints.some((hint) => parts.includes(hint))) {
      return url;
    }
  }

  // Pass 2: Match provider subfolder + normalized filename
  for (const [key, url] of Object.entries(voiceAudioModules)) {
    const parts = key.toLowerCase().split('/');
    const filename = parts.pop()?.split('.')[0] || '';
    if (normalizeName(filename) === targetNorm && providerHints.some((hint) => parts.includes(hint))) {
      return url;
    }
  }

  // Pass 3: Exact filename match anywhere in assets/voices/
  for (const [key, url] of Object.entries(voiceAudioModules)) {
    const filename = key.split('/').pop()?.split('.')[0]?.toLowerCase();
    if (filename === targetExact) {
      return url;
    }
  }

  // Pass 4: Normalized filename match anywhere in assets/voices/
  for (const [key, url] of Object.entries(voiceAudioModules)) {
    const filename = key.split('/').pop()?.split('.')[0] || '';
    if (normalizeName(filename) === targetNorm) {
      return url;
    }
  }

  // Fallback path
  return `/assets/voices/${providerLabel || 'Google'}/${voiceId}.mp3`;
}

export function useVoicePreview({
  activeVoiceId,
  providerId,
  providerLabel,
  open,
}: {
  activeVoiceId: string;
  providerId?: string;
  providerLabel?: string;
  open: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const lastPlayedVoiceRef = useRef<string | null>(null);

  const stopPreview = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlaying(false);
  }, []);

  const playPreview = useCallback(
    (voiceId: string) => {
      stopPreview();

      const url = getVoicePreviewUrl(voiceId, providerId, providerLabel);
      if (!audioRef.current) {
        audioRef.current = new Audio();
      }

      const audio = audioRef.current;
      audio.src = url;

      const onEnded = () => setIsPlaying(false);
      const onError = () => setIsPlaying(false);

      audio.onended = onEnded;
      audio.onerror = onError;

      lastPlayedVoiceRef.current = voiceId;

      const promise = audio.play();
      if (promise !== undefined) {
        promise
          .then(() => {
            setIsPlaying(true);
          })
          .catch(() => {
            // Gracefully handled if file doesn't exist or play was interrupted
            setIsPlaying(false);
          });
      }
    },
    [providerId, providerLabel, stopPreview],
  );

  // Play preview when activeVoiceId changes while dialog is open
  useEffect(() => {
    if (!open) {
      stopPreview();
      lastPlayedVoiceRef.current = null;
      return;
    }

    if (activeVoiceId && lastPlayedVoiceRef.current !== activeVoiceId) {
      playPreview(activeVoiceId);
    }
  }, [activeVoiceId, open, playPreview, stopPreview]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopPreview();
    };
  }, [stopPreview]);

  return {
    isPlaying,
    playPreview: (voiceId?: string) => playPreview(voiceId || activeVoiceId),
    stopPreview,
  };
}
