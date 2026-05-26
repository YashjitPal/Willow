import React, { useEffect, useMemo, useRef, useState } from 'react';

/* ════════════════════════════════════════════════════════════════════════════
 * StreamingMarkdown
 * A self-contained, markdown-aware text renderer tuned for LLM token streams.
 *
 *   • Adaptive RAF pacing    — smooths bursty network chunks into a constant,
 *                              readable flow that speeds up when it falls
 *                              behind and coasts when caught up.
 *   • Per-word reveal        — each word mounts exactly once with a GPU-
 *                              accelerated blur→crisp lift. Stable keys mean
 *                              re-renders never replay old words.
 *   • Living caret           — a glowing orb that breathes at the insertion
 *                              point and fades when the stream settles.
 *   • Markdown-native        — headings, lists, fenced code, inline
 *                              bold/italic/code all animate coherently.
 *
 * Everything (keyframes included) lives in this file so it can be dropped
 * into any view without touching global CSS.
 * ══════════════════════════════════════════════════════════════════════════ */

// ────────────────────────────────────────────────────────────────────────────
// Styles (injected once)
// ────────────────────────────────────────────────────────────────────────────
const STYLE_ID = 'streaming-markdown-styles';
const STYLE_CSS = `
@keyframes smd-word-in {
  0%   { opacity: 0; transform: translateY(0.25em); filter: blur(8px); }
  100% { opacity: 1; transform: translateY(0);      filter: blur(0);   }
}
@keyframes smd-head-in {
  0%   { opacity: 0; transform: translateY(0.3em) scale(0.97); filter: blur(10px); }
  60%  { opacity: 1; transform: translateY(-0.04em) scale(1.01); filter: blur(0); }
  100% { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
}
@keyframes smd-code-in {
  0%   { opacity: 0; transform: translateY(6px) scale(0.985); box-shadow: 0 0 0 0 rgba(96,165,250,0); }
  40%  { opacity: 1; transform: translateY(0) scale(1); box-shadow: 0 0 28px -2px rgba(96,165,250,0.28); }
  100% { opacity: 1; transform: translateY(0) scale(1); box-shadow: 0 0 0 0 rgba(96,165,250,0); }
}
/* fill-mode:backwards (not both) — retain the 0% frame before start, but
   release all animated props once finished so the span drops its compositor
   layer instead of holding transform/filter/will-change forever. */
.smd-w {
  display: inline-block;
  animation: smd-word-in 0.42s cubic-bezier(0.22, 0.65, 0.3, 0.98) backwards;
}
.smd-h {
  display: inline-block;
  animation: smd-head-in 0.55s cubic-bezier(0.2, 0.7, 0.2, 1.1) backwards;
}
.smd-code-block {
  animation: smd-code-in 0.9s cubic-bezier(0.22, 0.65, 0.3, 0.98) backwards;
}
.smd-static .smd-w,
.smd-static .smd-h,
.smd-static .smd-code-block,
.smd-settled { animation: none; }

@media (prefers-reduced-motion: reduce) {
  .smd-w, .smd-h, .smd-code-block { animation: none !important; }
}
`;

function useInjectStyles() {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (document.getElementById(STYLE_ID)) return;
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = STYLE_CSS;
    document.head.appendChild(el);
  }, []);
}

// ────────────────────────────────────────────────────────────────────────────
// Adaptive pacing — releases characters at a speed proportional to backlog.
// Guarantees visual smoothness regardless of how bursty the upstream is.
// ────────────────────────────────────────────────────────────────────────────
function useSmoothText(target: string, enabled: boolean) {
  const [len, setLen] = useState(enabled ? 0 : target.length);
  const lenRef = useRef(len);
  const targetRef = useRef(target);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef<number>(0);

  // keep refs fresh without re-kicking the loop effect
  targetRef.current = target;

  const tick = (now: number) => {
    const dt = Math.min(64, now - lastRef.current); // clamp dt (tab-switch safety)
    lastRef.current = now;
    const gap = targetRef.current.length - lenRef.current;

    if (gap > 0) {
      // Adaptive: base 90 cps, +8 cps per buffered char, capped at 2200 cps.
      const speed = Math.min(2200, 90 + gap * 8);
      const advance = Math.max(1, Math.round((speed * dt) / 1000));
      lenRef.current = Math.min(targetRef.current.length, lenRef.current + advance);
      setLen(lenRef.current);
      rafRef.current = requestAnimationFrame(tick);
    } else {
      // Caught up — park the loop until new target arrives.
      rafRef.current = null;
    }
  };
  const tickRef = useRef(tick);
  tickRef.current = tick;

  // Kick (or re-kick) the loop only when there's backlog to drain.
  useEffect(() => {
    if (!enabled) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lenRef.current = target.length;
      setLen(target.length);
      return;
    }
    if (target.length > lenRef.current && rafRef.current === null) {
      lastRef.current = performance.now();
      rafRef.current = requestAnimationFrame((t) => tickRef.current(t));
    }
  }, [enabled, target]);

  // Cancel on unmount
  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    },
    []
  );

  // If target shrinks (shouldn't in append-only streams, but guard anyway)
  useEffect(() => {
    if (len > target.length) {
      lenRef.current = target.length;
      setLen(target.length);
    }
  }, [target, len]);

  const caughtUp = len >= target.length;
  return { text: target.slice(0, len), caughtUp };
}

// ────────────────────────────────────────────────────────────────────────────
// Atomic animated word.
// `settled` is frozen at mount: if this span stays mounted the animation runs
// to completion; if React remounts it later (container reshaped mid-stream)
// the fresh mount reads the *current* `settled` → true → no replay.
// Memo comparator ignores `settled` so the false→true flip one frame after
// mount doesn't trigger a re-render.
// ────────────────────────────────────────────────────────────────────────────
const Word = React.memo(
  function Word({
    children,
    variant = 'w',
    strong,
    em,
    code,
    strike,
    settled,
  }: {
    children: string;
    variant?: 'w' | 'h';
    strong?: boolean;
    em?: boolean;
    code?: boolean;
    strike?: boolean;
    settled?: boolean;
  }) {
    const settledAtMount = useRef(settled).current;
    const base = `smd-${variant}${settledAtMount ? ' smd-settled' : ''}`;
    if (code) {
      return (
        <code className={`${base} bg-white/10 px-1.5 py-0.5 rounded text-[13px] font-mono text-gray-100`}>
          {children}
        </code>
      );
    }
    const cls =
      base +
      (strong ? ' font-semibold text-gray-100' : '') +
      (em ? ' italic' : '') +
      (strike ? ' line-through text-gray-400' : '');
    return <span className={cls}>{children}</span>;
  },
  (a, b) =>
    a.children === b.children &&
    a.variant === b.variant &&
    a.strong === b.strong &&
    a.em === b.em &&
    a.code === b.code &&
    a.strike === b.strike
);

// ── LaTeX-lite → React ──────────────────────────────────────────────────────
// Not a full TeX engine — just enough to make chat math readable:
//   • _x / _{xyz} → <sub>   • ^x / ^{xyz} → <sup>
//   • common \commands → Unicode   • \text{}, \mathrm{} → plain
//   • strips leftover braces/backslashes
const TEX_SYMBOLS: Record<string, string> = {
  times: '×', cdot: '·', pm: '±', mp: '∓', div: '÷',
  to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', Leftarrow: '⇐',
  leftrightarrow: '↔', infty: '∞', approx: '≈', neq: '≠', leq: '≤', geq: '≥',
  le: '≤', ge: '≥', equiv: '≡', propto: '∝', sim: '∼',
  sum: '∑', prod: '∏', int: '∫', partial: '∂', nabla: '∇', sqrt: '√',
  alpha: 'α', beta: 'β', gamma: 'γ', Gamma: 'Γ', delta: 'δ', Delta: 'Δ',
  epsilon: 'ε', theta: 'θ', Theta: 'Θ', lambda: 'λ', Lambda: 'Λ', mu: 'μ',
  nu: 'ν', pi: 'π', Pi: 'Π', rho: 'ρ', sigma: 'σ', Sigma: 'Σ', tau: 'τ',
  phi: 'φ', Phi: 'Φ', psi: 'ψ', Psi: 'Ψ', omega: 'ω', Omega: 'Ω',
  ' ': ' ', ',': ' ', quad: '  ', qquad: '    ',
};

function texToNodes(tex: string): React.ReactNode[] {
  // 1. \frac{a}{b} → (a)/(b)
  let s = tex.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)');
  // 2. \text{..}, \mathrm{..}, \operatorname{..} → contents
  s = s.replace(/\\(?:text|mathrm|mathbf|operatorname)\s*\{([^{}]*)\}/g, '$1');
  // 3. \left / \right sizing hints → drop
  s = s.replace(/\\left|\\right/g, '');
  // 4. known \symbol
  s = s.replace(/\\([a-zA-Z]+)/g, (_, name) => TEX_SYMBOLS[name] ?? name);
  // 5. escaped braces/space
  s = s.replace(/\\([{}\s\\,%])/g, '$1');

  const out: React.ReactNode[] = [];
  const re = /([_^])(\{[^{}]*\}|[^\s{}_^])/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  const clean = (t: string) => t.replace(/[{}]/g, '');
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(clean(s.slice(last, m.index)));
    const body = m[2].startsWith('{') ? m[2].slice(1, -1) : m[2];
    out.push(
      m[1] === '_'
        ? <sub key={key++} className="text-[0.72em]">{clean(body)}</sub>
        : <sup key={key++} className="text-[0.72em]">{clean(body)}</sup>
    );
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(clean(s.slice(last)));
  return out;
}

const MathSpan = React.memo(
  function MathSpan({ tex, display, settled }: { tex: string; display?: boolean; settled?: boolean }) {
    const settledAtMount = useRef(settled).current;
    const anim = settledAtMount ? 'smd-settled' : 'smd-w';
    if (display) {
      return (
        <div
          className={`${anim} my-3 px-4 py-3 text-center text-[16.5px] text-gray-100 font-serif italic overflow-x-auto`}
        >
          {texToNodes(tex)}
        </div>
      );
    }
    return (
      <span className={`${anim} font-serif italic text-gray-100 px-0.5`}>
        {texToNodes(tex)}
      </span>
    );
  },
  (a, b) => a.tex === b.tex && a.display === b.display
);

// ────────────────────────────────────────────────────────────────────────────
// Inline parser → React nodes.
// Word identity = absolute char offset of the word's first character in the
// FULL source stream. Append-only streams guarantee this never changes, so a
// word can be tracked across any container remount / reclassification.
// ────────────────────────────────────────────────────────────────────────────
function renderInline(
  src: string,
  baseOffset: number,
  settledBefore: number,
  variant: 'w' | 'h' = 'w'
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];

  const settledAt = (localStart: number) => baseOffset + localStart < settledBefore;

  const emit = (
    wordStart: number,
    text: string,
    opts: { strong?: boolean; em?: boolean; code?: boolean; strike?: boolean } = {}
  ) => {
    if (!text) return; // speculatively-closed empty marker → render nothing
    const id = baseOffset + wordStart;
    nodes.push(
      <Word key={id} variant={variant} settled={id < settledBefore} {...opts}>
        {text}
      </Word>
    );
  };

  // Markdown markers that escaped matching (mismatched `*`/`_`/`~` stuck to a
  // word or its trailing punctuation) are stripped from word edges so things
  // like `*?`, `puzzle**`, `~~done.` render clean. Pure-marker / `###` words
  // are dropped entirely.
  const isOrphanMarker = (w: string) => /^#{1,6}$/.test(w);
  const stripEdgeMarkers = (w: string) => w.replace(/^[*_~]+|[*_~]+$/g, '');

  const pushWords = (
    text: string,
    runStart: number,
    opts: { strong?: boolean; em?: boolean; strike?: boolean } = {}
  ) => {
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    let cursor = 0;
    while ((m = re.exec(text))) {
      if (m.index > cursor) nodes.push(text.slice(cursor, m.index)); // whitespace
      const cleaned = stripEdgeMarkers(m[0]);
      if (cleaned && !isOrphanMarker(cleaned)) {
        emit(runStart + m.index, cleaned, opts);
      }
      cursor = m.index + m[0].length;
    }
    if (cursor < text.length) nodes.push(text.slice(cursor));
  };

  // Inline scanner — order matters (longest / most specific first).
  //   $$math$$ · \[math\] · $math$ · \(math\) · [text](url) · `code`
  //   · **bold** · ~~strike~~ · *italic*
  const scan =
    /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\$[^\s$][^$\n]*?\$|\\\([\s\S]*?\\\)|\[[^\]\n]+\]\([^)\s]+\)|`[^`\n]*`|\*\*[^*\n]*\*\*|~~[^~\n]+~~|\*[^*\n]*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = scan.exec(src))) {
    if (m.index > last) pushWords(src.slice(last, m.index), last);
    const tok = m[0];
    const at = m.index;

    if (tok.startsWith('$$') || tok.startsWith('\\[')) {
      const tex = tok.startsWith('$$') ? tok.slice(2, -2) : tok.slice(2, -2);
      nodes.push(
        <MathSpan key={baseOffset + at} tex={tex.trim()} settled={settledAt(at)} />
      );
    } else if (tok.startsWith('\\(')) {
      nodes.push(
        <MathSpan key={baseOffset + at} tex={tok.slice(2, -2).trim()} settled={settledAt(at)} />
      );
    } else if (tok.startsWith('$')) {
      nodes.push(
        <MathSpan key={baseOffset + at} tex={tok.slice(1, -1).trim()} settled={settledAt(at)} />
      );
    } else if (tok.startsWith('[')) {
      const mm = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/)!;
      nodes.push(
        <a
          key={baseOffset + at}
          href={mm[2]}
          target="_blank"
          rel="noopener noreferrer"
          className={`${settledAt(at) ? 'smd-settled' : 'smd-w'} text-[#7ab7ff] hover:text-[#a5ceff] underline decoration-[#7ab7ff]/40 hover:decoration-[#a5ceff] underline-offset-2 transition-colors`}
        >
          {mm[1]}
        </a>
      );
    } else if (tok.startsWith('`')) {
      emit(at, tok.slice(1, -1), { code: true });
    } else if (tok.startsWith('**')) {
      pushWords(tok.slice(2, -2), at + 2, { strong: true });
    } else if (tok.startsWith('~~')) {
      pushWords(tok.slice(2, -2), at + 2, { strike: true });
    } else {
      pushWords(tok.slice(1, -1), at + 1, { em: true });
    }
    last = at + tok.length;
  }
  if (last < src.length) pushWords(src.slice(last), last);

  return nodes;
}

// ── Speculative closer ──────────────────────────────────────────────────────
// Inline markdown markers (`**`, `*`, `` ` ``) can't be recognised until the
// closing marker arrives, so the raw `**`/`*`/`` ` `` would flash on screen
// for a few frames. Since the stream is append-only, any unmatched marker is
// guaranteed to be at the trailing edge; we append a phantom closer so the
// parser formats it immediately. The phantom chars live past `shown.length`
// and therefore never affect word offsets / settled-state.
function closeDangling(src: string): string {
  if (!src) return src;
  // Leave open fenced code alone — literal markers inside code are intended.
  const fences = (src.match(/```/g) || []).length;
  if (fences % 2 === 1) return src;

  const nl = src.lastIndexOf('\n');
  const tail = src.slice(nl + 1);
  let suffix = '';

  // inline code
  if (((tail.match(/`/g) || []).length) % 2 === 1) suffix += '`';

  // bold (**) — strip backtick spans first so `**` inside code doesn't count
  const noCode = tail.replace(/`[^`]*`/g, '');
  if (((noCode.match(/\*\*/g) || []).length) % 2 === 1) suffix += '**';

  // italic (*) — count single * that aren't part of **
  if (((noCode.replace(/\*\*/g, '').match(/\*/g) || []).length) % 2 === 1) suffix += '*';

  // strikethrough ~~
  if (((noCode.match(/~~/g) || []).length) % 2 === 1) suffix += '~~';

  // math $$ / $
  if (((noCode.match(/\$\$/g) || []).length) % 2 === 1) suffix += '$$';
  else if (((noCode.replace(/\$\$/g, '').match(/\$/g) || []).length) % 2 === 1) suffix += '$';

  return suffix ? src + suffix : src;
}

// Split helper that preserves the absolute start offset of each piece.
interface Piece { text: string; start: number }
function splitWithOffsets(src: string, baseOffset: number, sep: RegExp): Piece[] {
  const out: Piece[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(sep.source, sep.flags.includes('g') ? sep.flags : sep.flags + 'g');
  while ((m = re.exec(src))) {
    out.push({ text: src.slice(last, m.index), start: baseOffset + last });
    last = m.index + m[0].length;
  }
  out.push({ text: src.slice(last), start: baseOffset + last });
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Block model
// ────────────────────────────────────────────────────────────────────────────
type Block =
  | { type: 'code'; lang: string; body: string; open: boolean; start: number }
  | { type: 'h'; level: 1 | 2 | 3 | 4 | 5 | 6; text: string; start: number; contentStart: number }
  | { type: 'ul' | 'ol'; items: Piece[]; start: number }
  | { type: 'p'; lines: Piece[]; start: number }
  | { type: 'quote'; lines: Piece[]; start: number }
  | { type: 'hr'; start: number }
  | { type: 'math'; tex: string; start: number }
  | { type: 'table'; header: Piece[]; rows: Piece[][]; start: number };

// A line is a heading if it starts with 1–6 `#` followed by whitespace OR
// end-of-line (so a bare "###" streams straight into heading state).
const HEADING_LINE = /^(#{1,6})(?:\s+(.*))?$/;

function parseBlocks(src: string): Block[] {
  const blocks: Block[] = [];
  const fence = /```/g;
  const segs: { code: boolean; body: string; start: number; lang?: string; open?: boolean }[] = [];
  let last = 0;
  let inCode = false;
  let lang = '';
  let m: RegExpExecArray | null;
  while ((m = fence.exec(src))) {
    const chunk = src.slice(last, m.index);
    if (inCode) {
      segs.push({ code: true, body: chunk, start: last, lang, open: false });
    } else if (chunk) {
      segs.push({ code: false, body: chunk, start: last });
    }
    if (!inCode) {
      // opening fence — capture optional language on the same line
      const rest = src.slice(m.index + 3);
      const nl = rest.indexOf('\n');
      lang = (nl >= 0 ? rest.slice(0, nl) : rest).trim();
      last = m.index + 3 + (nl >= 0 ? nl + 1 : rest.length);
      fence.lastIndex = last;
    } else {
      last = m.index + 3;
    }
    inCode = !inCode;
  }
  const tail = src.slice(last);
  if (inCode) {
    segs.push({ code: true, body: tail, start: last, lang, open: true });
  } else if (tail) {
    segs.push({ code: false, body: tail, start: last });
  }

  for (const seg of segs) {
    if (seg.code) {
      blocks.push({ type: 'code', lang: seg.lang || '', body: seg.body, open: !!seg.open, start: seg.start });
      continue;
    }
    const rawBlocks = splitWithOffsets(seg.body, seg.start, /\n{2,}/);
    for (const raw of rawBlocks) {
      // trim leading/trailing newlines but keep absolute offset of first real char
      const leadM = raw.text.match(/^\n+/);
      const lead = leadM ? leadM[0].length : 0;
      const trimmed = raw.text.replace(/^\n+|\n+$/g, '');
      if (!trimmed) continue;
      const blockStart = raw.start + lead;

      const lines = splitWithOffsets(trimmed, blockStart, /\n/);

      // ── hr ──
      if (lines.length === 1 && /^(?:-{3,}|_{3,}|\*{3,})\s*$/.test(trimmed)) {
        blocks.push({ type: 'hr', start: blockStart });
        continue;
      }

      // ── display math: block is exactly $$..$$ or \[..\] ──
      const mBlock =
        trimmed.match(/^\$\$([\s\S]+?)\$\$$/) || trimmed.match(/^\\\[([\s\S]+?)\\\]$/);
      if (mBlock) {
        blocks.push({ type: 'math', tex: mBlock[1].trim(), start: blockStart });
        continue;
      }

      // ── blockquote ──
      if (lines.every((l) => /^\s*>\s?/.test(l.text))) {
        blocks.push({
          type: 'quote',
          start: blockStart,
          lines: lines.map((l) => {
            const mm = l.text.match(/^\s*>\s?/)!;
            return { text: l.text.slice(mm[0].length), start: l.start + mm[0].length };
          }),
        });
        continue;
      }

      // ── heading / table / list / paragraph ──
      // Models frequently omit the blank line that GFM requires before a
      // heading or a table. We therefore walk line-by-line and let a heading
      // line or a contiguous run of `|..|` rows break the current paragraph,
      // so `### Title\n| a | b |\n|---|---|\n| c | d |` renders as
      // heading · table instead of one `<p>` full of pipes.
      const isTableRow = (s: string) => /^\s*\|.*\|\s*$/.test(s);
      const isTableSep = (s: string) => /^\s*\|[\s:|-]+\|\s*$/.test(s) && /-/.test(s);

      const tableCells = (l: Piece): Piece[] => {
        const inner = l.text.replace(/^\s*\|/, '').replace(/\|\s*$/, '');
        const innerStart =
          l.start + (l.text.length - l.text.replace(/^\s*\|/, '').length);
        return splitWithOffsets(inner, innerStart, /\|/).map((c) => ({
          text: c.text.trim(),
          start: c.start + (c.text.length - c.text.trimStart().length),
        }));
      };

      const classifyRun = (run: Piece[]) => {
        if (run.length === 0) return;
        const runStart = run[0].start;
        if (run.every((l) => /^\s*[-*]\s+/.test(l.text))) {
          blocks.push({
            type: 'ul',
            start: runStart,
            items: run.map((l) => {
              const mm = l.text.match(/^\s*[-*]\s+/)!;
              return { text: l.text.slice(mm[0].length), start: l.start + mm[0].length };
            }),
          });
        } else if (run.every((l) => /^\s*\d+\.\s+/.test(l.text))) {
          blocks.push({
            type: 'ol',
            start: runStart,
            items: run.map((l) => {
              const mm = l.text.match(/^\s*\d+\.\s+/)!;
              return { text: l.text.slice(mm[0].length), start: l.start + mm[0].length };
            }),
          });
        } else {
          blocks.push({ type: 'p', start: runStart, lines: run });
        }
      };

      const emitTable = (rows: Piece[]) => {
        if (rows.length >= 2 && isTableSep(rows[1].text)) {
          blocks.push({
            type: 'table',
            start: rows[0].start,
            header: tableCells(rows[0]),
            rows: rows.slice(2).map(tableCells),
          });
        } else {
          // Pipe-framed line(s) that don't form a valid table (no separator
          // row yet / only one row streamed so far) — render as prose so the
          // user at least sees the text; it will reclassify once row 2 lands.
          classifyRun(rows);
        }
      };

      let run: Piece[] = [];
      let tableRun: Piece[] = [];
      const flushRun = () => {
        if (run.length) classifyRun(run);
        run = [];
      };
      const flushTable = () => {
        if (tableRun.length) emitTable(tableRun);
        tableRun = [];
      };

      for (const ln of lines) {
        const h = ln.text.match(HEADING_LINE);
        if (h) {
          flushRun();
          flushTable();
          const content = h[2] ?? '';
          const prefixLen = ln.text.length - content.length;
          blocks.push({
            type: 'h',
            level: h[1].length as 1 | 2 | 3 | 4 | 5 | 6,
            text: content,
            start: ln.start,
            contentStart: ln.start + prefixLen,
          });
        } else if (isTableRow(ln.text)) {
          flushRun();
          tableRun.push(ln);
        } else {
          flushTable();
          run.push(ln);
        }
      }
      flushRun();
      flushTable();
    }
  }
  return blocks;
}

// ────────────────────────────────────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────────────────────────────────────
export interface StreamingMarkdownProps {
  /** Full accumulated text so far. Must be append-only while `isStreaming`. */
  text: string;
  /** True while the upstream is still producing tokens. */
  isStreaming: boolean;
  /** When false, renders instantly with no word animation (history view). */
  animate?: boolean;
  className?: string;
}

// Memoised: completed messages (stable `text`/`isStreaming`) skip re-render
// entirely while a *different* message is streaming.
export const StreamingMarkdown: React.FC<StreamingMarkdownProps> = React.memo(
  function StreamingMarkdown({
  text,
  isStreaming,
  animate = true,
  className = '',
}) {
  useInjectStyles();

  const { text: shown } = useSmoothText(text, animate);
  const blocks = useMemo(() => parseBlocks(closeDangling(shown)), [shown]);
  void isStreaming; // reserved for future caret/indicator use

  // A word / block is "settled" iff its first character already existed in the
  // previously *committed* `shown` string. Purely derived from a post-commit
  // ref — no render-time mutation — so it's StrictMode-safe and immune to
  // container remounts / block-type reclassification mid-stream.
  const committedLen = useRef(0);
  useEffect(() => {
    committedLen.current = shown.length;
  }, [shown]);
  const settledBefore = committedLen.current;

  const rendered: React.ReactNode[] = [];

  blocks.forEach((blk) => {
    if (blk.type === 'code') {
      const settled = blk.start < settledBefore;
      rendered.push(
        <pre
          key={blk.start}
          className={`smd-code-block${settled ? ' smd-settled' : ''} bg-[#0f0f0f] border border-white/5 rounded-xl p-4 my-3 overflow-x-auto text-[13px] leading-relaxed font-mono text-gray-200`}
        >
          <code>{blk.body.replace(/\n$/, '')}</code>
        </pre>
      );
      return;
    }

    if (blk.type === 'h') {
      const nodes = renderInline(blk.text, blk.contentStart, settledBefore, 'h');
      const size =
        blk.level === 1 ? 'text-[20px]'
        : blk.level === 2 ? 'text-[17px]'
        : blk.level === 3 ? 'text-[15.5px]'
        : 'text-[14.5px] uppercase tracking-wide text-gray-300';
      rendered.push(
        <div key={blk.start} className={`${size} font-semibold text-gray-100 mt-4 mb-2`}>
          {nodes}
        </div>
      );
      return;
    }

    if (blk.type === 'hr') {
      rendered.push(
        <hr
          key={blk.start}
          className={`${blk.start < settledBefore ? 'smd-settled' : 'smd-w'} my-5 border-0 h-px bg-white/10`}
        />
      );
      return;
    }

    if (blk.type === 'math') {
      rendered.push(
        <MathSpan key={blk.start} tex={blk.tex} display settled={blk.start < settledBefore} />
      );
      return;
    }

    if (blk.type === 'quote') {
      const qNodes: React.ReactNode[] = [];
      blk.lines.forEach((ln, li) => {
        qNodes.push(
          <React.Fragment key={ln.start}>
            {renderInline(ln.text, ln.start, settledBefore)}
          </React.Fragment>
        );
        if (li < blk.lines.length - 1) qNodes.push(<br key={`br-${ln.start}`} />);
      });
      rendered.push(
        <blockquote
          key={blk.start}
          className="my-3 border-l-[3px] border-white/15 pl-4 pr-2 py-1 text-gray-300/90 italic"
        >
          {qNodes}
        </blockquote>
      );
      return;
    }

    if (blk.type === 'table') {
      rendered.push(
        <div key={blk.start} className="my-3 overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-[14px] border-collapse">
            <thead className="bg-white/[0.04]">
              <tr>
                {blk.header.map((c) => (
                  <th
                    key={c.start}
                    className="px-3.5 py-2 text-left font-semibold text-gray-100 border-b border-white/10"
                  >
                    {renderInline(c.text, c.start, settledBefore)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {blk.rows.map((row, ri) => (
                <tr key={row[0]?.start ?? ri} className="border-t border-white/5">
                  {row.map((c) => (
                    <td key={c.start} className="px-3.5 py-2 align-top text-gray-300">
                      {renderInline(c.text, c.start, settledBefore)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      return;
    }

    if (blk.type === 'ul' || blk.type === 'ol') {
      const Tag = blk.type === 'ul' ? 'ul' : 'ol';
      const listCls =
        blk.type === 'ul'
          ? 'list-disc pl-5 space-y-1.5 my-2'
          : 'list-decimal pl-5 space-y-1.5 my-2';
      const items = blk.items.map((item) => (
        <li key={item.start} className="text-gray-300">
          {renderInline(item.text, item.start, settledBefore)}
        </li>
      ));
      rendered.push(
        <Tag key={blk.start} className={listCls}>
          {items}
        </Tag>
      );
      return;
    }

    // paragraph (may contain soft line breaks)
    const pBlk = blk as Extract<Block, { type: 'p' }>;
    const pNodes: React.ReactNode[] = [];
    pBlk.lines.forEach((ln, li) => {
      pNodes.push(
        <React.Fragment key={ln.start}>
          {renderInline(ln.text, ln.start, settledBefore)}
        </React.Fragment>
      );
      if (li < pBlk.lines.length - 1) pNodes.push(<br key={`br-${ln.start}`} />);
    });
    rendered.push(
      <p key={pBlk.start} className="my-2">
        {pNodes}
      </p>
    );
  });

  return (
    <div
      className={`text-gray-300 text-[15px] leading-[1.7] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 ${
        animate ? '' : 'smd-static'
      } ${className}`}
    >
      {rendered}
    </div>
  );
});

export default StreamingMarkdown;
