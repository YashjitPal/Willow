import React, { Fragment, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronsUpDown, UnfoldVertical } from 'lucide-react';
import { cn, usePrefersReducedMotion } from './primitives';
import { languageFromPath, type Language } from './highlight';
import { CodeLine } from './CodeLine';
import type { DiffLine } from '../harness/runtime/protocol';

/**
 * The diff renderer.
 *
 * Two behaviours carry most of the weight here.
 *
 * **Context folding.** A two-line change inside a large hunk is unreadable when
 * surrounded by fifty grey lines, so runs longer than `CONTEXT_FOLD` collapse to
 * a click-to-expand spacer.
 *
 * **Streaming reveal.** While a patch is still arriving, `revealed` caps how
 * many lines are drawn and folding is disabled — folding a growing list makes
 * already-settled lines jump as new ones arrive, which reads as a glitch.
 */

const CONTEXT_FOLD = 6;
const CONTEXT_KEEP = 3;

type Row =
  | { kind: 'line'; line: DiffLine; index: number }
  | { kind: 'fold'; count: number; index: number };

function foldContext(lines: DiffLine[]): Row[] {
  const rows: Row[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line) break;

    if (line.type !== 'ctx') {
      rows.push({ kind: 'line', line, index });
      index += 1;
      continue;
    }

    let end = index;
    while (end < lines.length && lines[end]?.type === 'ctx') end += 1;

    if (end - index > CONTEXT_FOLD) {
      const leading = index === 0;
      const trailing = end === lines.length;

      if (!leading) {
        for (let i = index; i < index + CONTEXT_KEEP; i += 1) {
          const item = lines[i];
          if (item) rows.push({ kind: 'line', line: item, index: i });
        }
      }

      const from = leading ? index : index + CONTEXT_KEEP;
      const to = trailing ? end : end - CONTEXT_KEEP;
      rows.push({ kind: 'fold', count: Math.max(0, to - from), index: from });

      if (!trailing) {
        for (let i = end - CONTEXT_KEEP; i < end; i += 1) {
          const item = lines[i];
          if (item) rows.push({ kind: 'line', line: item, index: i });
        }
      }
    } else {
      for (let i = index; i < end; i += 1) {
        const item = lines[i];
        if (item) rows.push({ kind: 'line', line: item, index: i });
      }
    }

    index = end;
  }

  return rows;
}

export function DiffView({
  lines,
  path,
  revealed,
  className,
  showAllContext,
  maxHeight = 380,
}: {
  lines: DiffLine[];
  path: string;
  revealed?: number;
  className?: string;
  showAllContext?: boolean;
  maxHeight?: number;
}) {
  const language = languageFromPath(path);
  const reduced = usePrefersReducedMotion();
  const [unfolded, setUnfolded] = useState<Set<number>>(() => new Set());

  const streaming = revealed !== undefined && revealed < lines.length;
  const visible = revealed !== undefined ? lines.slice(0, revealed) : lines;

  const rows = useMemo(() => {
    if (showAllContext || streaming) {
      return visible.map((line, index) => ({ kind: 'line', line, index }) as Row);
    }
    return foldContext(visible);
  }, [visible, showAllContext, streaming]);

  // A fixed gutter width stops the code column shifting sideways as line
  // numbers gain digits partway down a long file.
  const gutter = useMemo(() => {
    let max = 0;
    for (const line of lines) max = Math.max(max, line.oldLine ?? 0, line.newLine ?? 0);
    return `${String(max).length}ch`;
  }, [lines]);

  return (
    <div
      className={cn('cb-scroll overflow-auto bg-[hsl(var(--cb-sunken))]', className)}
      style={{ maxHeight }}
    >
      <div className="min-w-full font-mono text-[11.5px] leading-[1.6]">
        {rows.map((row) => {
          if (row.kind === 'fold') {
            const key = `fold-${row.index}`;
            if (unfolded.has(row.index)) {
              return (
                <Fragment key={key}>
                  {lines.slice(row.index, row.index + row.count).map((line, offset) => (
                    <DiffRow
                      key={`${key}-${offset}`}
                      line={line}
                      language={language}
                      gutter={gutter}
                      animate={false}
                    />
                  ))}
                </Fragment>
              );
            }
            return (
              <button
                key={key}
                type="button"
                onClick={() => setUnfolded((set) => new Set(set).add(row.index))}
                className={cn(
                  'flex w-full items-center gap-2 border-y border-[hsl(var(--cb-line-subtle))]',
                  'bg-[hsl(var(--cb-surface)/0.5)] px-3 py-1 text-left text-[11px]',
                  'text-[hsl(var(--cb-ink-ghost))] transition-colors',
                  'hover:bg-[hsl(var(--cb-ink)/0.035)] hover:text-[hsl(var(--cb-ink-muted))]',
                )}
              >
                <UnfoldVertical size={11} aria-hidden />
                Show {row.count} unchanged {row.count === 1 ? 'line' : 'lines'}
              </button>
            );
          }

          return (
            <DiffRow
              key={row.index}
              line={row.line}
              language={language}
              gutter={gutter}
              animate={!reduced && streaming}
            />
          );
        })}

        {streaming && (
          <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-[hsl(var(--cb-ink-ghost))]">
            <ChevronsUpDown size={11} className="cb-breathe" aria-hidden />
            writing…
          </div>
        )}
      </div>
    </div>
  );
}

function DiffRow({
  line,
  language,
  gutter,
  animate,
}: {
  line: DiffLine;
  language: Language;
  gutter: string;
  animate: boolean;
}) {
  if (line.type === 'hunk') {
    return (
      <div
        className={cn(
          'select-none border-y border-[hsl(var(--cb-line-subtle))] bg-[hsl(var(--cb-surface)/0.6)]',
          'px-3 py-1 text-[11px] text-[hsl(var(--cb-ink-ghost))]',
        )}
      >
        {line.content}
      </div>
    );
  }

  const marker = line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' ';

  return (
    <motion.div
      initial={animate ? { opacity: 0, x: -4 } : false}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'flex',
        line.type === 'add' && 'bg-[hsl(var(--cb-diff-add))]',
        line.type === 'del' && 'bg-[hsl(var(--cb-diff-del))]',
      )}
    >
      {/* Line numbers are non-selectable so copying the diff yields code, not
          code interleaved with numbers. */}
      <span
        aria-hidden
        className={cn(
          'cb-tabular sticky left-0 flex shrink-0 select-none gap-2 py-px pl-2.5 pr-2 text-right',
          line.type === 'add'
            ? 'bg-[hsl(var(--cb-diff-add))] text-[hsl(var(--cb-diff-add-ink)/0.7)]'
            : line.type === 'del'
              ? 'bg-[hsl(var(--cb-diff-del))] text-[hsl(var(--cb-diff-del-ink)/0.7)]'
              : 'bg-[hsl(var(--cb-sunken))] text-[hsl(var(--cb-ink-ghost))]',
        )}
      >
        <span style={{ width: gutter }}>{line.oldLine ?? ''}</span>
        <span style={{ width: gutter }}>{line.newLine ?? ''}</span>
      </span>

      <span
        aria-hidden
        className={cn(
          'w-4 shrink-0 select-none text-center',
          line.type === 'add' && 'text-[hsl(var(--cb-diff-add-ink))]',
          line.type === 'del' && 'text-[hsl(var(--cb-diff-del-ink))]',
          line.type === 'ctx' && 'text-transparent',
        )}
      >
        {marker}
      </span>

      <CodeLine
        text={line.content}
        language={language}
        className={cn('flex-1 whitespace-pre pr-3', line.type === 'del' && 'opacity-80')}
      />
    </motion.div>
  );
}
