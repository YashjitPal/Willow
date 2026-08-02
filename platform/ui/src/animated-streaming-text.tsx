'use client';

import React, { useRef, useEffect, useState, memo } from 'react';

interface AnimatedStreamingTextProps {
  text: string;
  className?: string;
}

/**
 * AnimatedStreamingText - A component that animates each new word/segment
 * as it appears during AI streaming responses.
 * 
 * Creates a beautiful fade-in effect with subtle blur and slide for each
 * new piece of content as it streams in.
 */
const AnimatedStreamingText = memo(function AnimatedStreamingText({ 
  text, 
  className = '' 
}: AnimatedStreamingTextProps) {
  const [animatedLength, setAnimatedLength] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // When text grows, animate the new content
    if (text.length > animatedLength) {
      // Use a small delay to ensure smooth animation
      const timer = setTimeout(() => {
        setAnimatedLength(text.length);
      }, 10);
      return () => clearTimeout(timer);
    }
  }, [text, animatedLength]);

  // Split into already-visible and new content
  const visibleText = text.slice(0, animatedLength);
  const newText = text.slice(animatedLength);

  return (
    <div ref={containerRef} className={className}>
      {/* Already visible content - no animation */}
      <span>{visibleText}</span>
      
      {/* New content - with fade animation */}
      {newText && (
        <span 
          className="inline animate-textFadeIn"
          style={{ 
            opacity: 0,
          }}
        >
          {newText}
        </span>
      )}
    </div>
  );
});

export { AnimatedStreamingText };
