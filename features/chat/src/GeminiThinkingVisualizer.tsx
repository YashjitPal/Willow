// Gemini's three-bouncing-dots "Thinking" indicator, played through lottie-web.
//
// Split out of `ChatView.tsx` with its animation data (`gemini-thinking-dots.ts`)
// so the ~9KB JSON blob no longer sits in the middle of the chat component.
// Self-contained: it owns the player's whole lifecycle and takes no props.

import React, { useEffect, useRef } from 'react';
import lottie from 'lottie-web';
import { GEMINI_THINKING_DOTS_DATA } from './gemini-thinking-dots';

export const GeminiThinkingVisualizer = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const anim = lottie.loadAnimation({
      container: containerRef.current,
      renderer: 'svg',
      loop: true,
      autoplay: true,
      animationData: GEMINI_THINKING_DOTS_DATA,
    });
    return () => anim.destroy();
  }, []);

  return <div ref={containerRef} style={{ width: 24, height: 24 }} />;
};
