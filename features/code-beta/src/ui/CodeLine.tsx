import React, { memo, useMemo } from 'react';
import { cn } from './primitives';
import { tokenize, TOKEN_CLASS, type Language } from './highlight';

/**
 * One syntax-highlighted line.
 *
 * Memoised because a streaming diff re-renders its container on every revealed
 * line, and re-tokenising every previously-settled line each time is what makes
 * a long patch stutter.
 */
export const CodeLine = memo(function CodeLine({
  text,
  language,
  className,
}: {
  text: string;
  language: Language;
  className?: string;
}) {
  const tokens = useMemo(() => tokenize(text, language), [text, language]);

  // A zero-width space keeps an empty line's box height without adding content
  // that would be picked up by a copy.
  if (tokens.length === 0) return <span className={className}>{'\u200B'}</span>;

  return (
    <span className={className}>
      {tokens.map((token, index) => (
        <span key={index} className={TOKEN_CLASS[token.type]}>
          {token.value}
        </span>
      ))}
    </span>
  );
});
