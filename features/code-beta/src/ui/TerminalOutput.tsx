import React, { useEffect, useMemo, useRef } from 'react';
import { Caret, cn } from './primitives';
import type { OutputChunk } from '../harness/runtime/protocol';

/**
 * Terminal output with minimal ANSI SGR support.
 *
 * Real tool output arrives with escape sequences. Stripping them loses the
 * signal — a test runner's pass/fail is carried entirely by colour — and
 * rendering them literally is worse. This handles the 8/16 colour set, bright
 * variants, bold and dim, which covers essentially everything a build or test
 * runner emits.
 */

interface Span {
  text: string;
  className: string;
}

const FG: Record<number, string> = {
  30: 'text-[hsl(var(--cb-ink-ghost))]',
  31: 'text-[hsl(var(--cb-negative))]',
  32: 'text-[hsl(var(--cb-positive))]',
  33: 'text-[hsl(var(--cb-warning))]',
  34: 'text-[hsl(205_90%_66%)]',
  35: 'text-[hsl(285_70%_74%)]',
  36: 'text-[hsl(186_70%_58%)]',
  37: 'text-[hsl(var(--cb-ink-muted))]',
  90: 'text-[hsl(var(--cb-ink-ghost))]',
  91: 'text-[hsl(var(--cb-negative))]',
  92: 'text-[hsl(var(--cb-positive))]',
  93: 'text-[hsl(var(--cb-warning))]',
  94: 'text-[hsl(205_90%_66%)]',
  95: 'text-[hsl(285_75%_78%)]',
  96: 'text-[hsl(186_75%_62%)]',
  97: 'text-[hsl(var(--cb-ink))]',
};

const ANSI = /\u001b\[([0-9;]*)m/g;

function parseAnsi(text: string, base: string): Span[] {
  const spans: Span[] = [];
  let cursor = 0;
  let className = base;
  let match: RegExpExecArray | null;

  ANSI.lastIndex = 0;
  while ((match = ANSI.exec(text)) !== null) {
    if (match.index > cursor) {
      spans.push({ text: text.slice(cursor, match.index), className });
    }

    for (const code of (match[1] ?? '0').split(';').map((v) => Number(v || '0'))) {
      if (code === 0) className = base;
      else if (code === 1) className = cn(className, 'font-semibold text-[hsl(var(--cb-ink))]');
      else if (code === 2) className = cn(className, 'opacity-60');
      else if (code === 3) className = cn(className, 'italic');
      else if (code === 4) className = cn(className, 'underline');
      else if (FG[code]) className = cn(base, FG[code]);
      else if (code === 39) className = base;
    }

    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) spans.push({ text: text.slice(cursor), className });
  return spans;
}

export function TerminalOutput({
  chunks,
  running,
  maxHeight = 280,
  className,
}: {
  chunks: OutputChunk[];
  running?: boolean;
  maxHeight?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Output only ever appends, so pinning to the bottom is unconditional — there
  // is no "user scrolled up" case worth preserving inside a card this small.
  useEffect(() => {
    const node = ref.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [chunks.length, running]);

  const spans = useMemo(
    () =>
      chunks.flatMap((chunk) =>
        parseAnsi(
          chunk.text,
          chunk.stream === 'stderr'
            ? 'text-[hsl(var(--cb-negative)/0.9)]'
            : 'text-[hsl(var(--cb-ink-muted))]',
        ),
      ),
    [chunks],
  );

  if (chunks.length === 0 && !running) {
    return (
      <p className={cn('px-3 py-2 text-[11px] italic text-[hsl(var(--cb-ink-ghost))]', className)}>
        No output
      </p>
    );
  }

  return (
    <div
      ref={ref}
      className={cn('cb-scroll overflow-auto bg-[hsl(var(--cb-inset))] px-3 py-2', className)}
      style={{ maxHeight }}
    >
      <pre className="whitespace-pre-wrap break-words font-mono text-[11.5px] leading-[1.6]">
        {spans.map((span, index) => (
          <span key={index} className={span.className}>
            {span.text}
          </span>
        ))}
        {running && <Caret className="bg-[hsl(var(--cb-ink-muted))]" />}
      </pre>
    </div>
  );
}
