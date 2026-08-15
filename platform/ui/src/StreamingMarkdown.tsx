import React, { useEffect, useInsertionEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import hljs from 'highlight.js/lib/common';
import katex from 'katex';
import 'katex/contrib/mhchem';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import 'katex/dist/katex.min.css';
import { BentoCardGroup } from './GeminiBentoCard';
import { GeminiInlineImage } from './GeminiInlineImage';
import { GeminiSingleImage } from './GeminiSingleImage';
import { isBentoFence, parseBentoCards } from './gemini-cards';
import { MaterialSymbol } from './MaterialSymbol';
import {
  RichResource,
  RichResourceGroup,
  resourceFromUrl,
} from './RichResourcePreview';
import { SourceChip, type SourceChipItem } from './SourceChip';
import {
  geminiBlockRevealTimings,
  geminiRevealTailMs,
  geminiRevealTimingAt,
  type GeminiBlockRevealTiming,
  initialStreamingReveal,
  nextStreamingRevealDelayMs,
  nextStreamingRevealLength,
  reconcileStreamingReveal,
} from './streaming-text-reveal';

import { useInjectStyles } from './streaming-markdown-styles';

/** Mirrors `MessageCitations` from @willow/ai/grounding, declared structurally
 *  so this component keeps no dependency on the AI layer. */
export interface SourceCitations {
  sources: SourceChipItem[];
  citations: { startIndex: number; endIndex: number; sourceIndices: number[] }[];
}

interface ChipGroup {
  start: number;
  end: number;
  sources: SourceChipItem[];
}

/**
 * Flattens citations into one entry per cited run, in document order.
 *
 * Grouping into blocks happens later, in `chipSourcesForRange`, because only the
 * renderer knows where a block starts and ends.
 */
function buildChipGroups(citations?: SourceCitations): ChipGroup[] {
  if (!citations?.citations?.length || !citations.sources?.length) return [];
  const groups: ChipGroup[] = [];
  for (const citation of citations.citations) {
    const sources = citation.sourceIndices
      .map((index) => citations.sources[index])
      .filter((source): source is SourceChipItem => !!source && !!source.uri);
    if (!sources.length) continue;
    groups.push({ start: citation.startIndex, end: citation.endIndex, sources });
  }
  return groups.sort((a, b) => a.end - b.end);
}

/**
 * Every source cited anywhere inside `[start, end)`, de-duplicated by URL and
 * kept in first-cited order.
 *
 * A run is claimed by the block its *end* falls in, so a citation spanning a
 * block boundary attributes to where it finishes — the same place Gemini puts
 * the chip. Duplicate URLs collapse; duplicate titles do not, which is why one
 * measured chip reads "NDTV +1" for two different NDTV pages.
 */
function chipSourcesForRange(context: RenderContext, start: number, end: number): SourceChipItem[] {
  const groups = context.chipGroups;
  if (!groups?.length || end <= start) return [];
  const seen = new Set<string>();
  const sources: SourceChipItem[] = [];
  for (const group of groups) {
    if (group.end <= start || group.end > end) continue;
    for (const source of group.sources) {
      if (seen.has(source.uri)) continue;
      seen.add(source.uri);
      sources.push(source);
    }
  }
  return sources;
}

/**
 * The typography `.smd-root` itself declares.
 *
 * Named once because two separate things depend on these exact numbers: the
 * root element's inline `font-variation-settings`, and the test below that
 * decides whether a word's own span is redundant with what it inherits. If the
 * two ever disagreed, settled text would silently render at the wrong weight —
 * so they are derived from this rather than written out twice.
 *
 * `font-weight: 400` in `streaming-markdown-styles.ts` is the third copy and
 * cannot import from here without a cycle; a test pins it to this value.
 */
const ROOT_TYPOGRAPHY = { weight: 400, width: 92, roundness: 0 } as const;

const fontVariation = (roundness: number, slant: number, width: number, weight: number): string =>
  '"ROND" ' + roundness + ', "slnt" ' + slant + ', "wdth" ' + width + ', "wght" ' + weight;

const ROOT_VARIATION = fontVariation(
  ROOT_TYPOGRAPHY.roundness,
  0,
  ROOT_TYPOGRAPHY.width,
  ROOT_TYPOGRAPHY.weight,
);

/**
 * Whether a word span under this context would be indistinguishable from the
 * text it wraps.
 *
 * Every word gets its own `<span>` so the streaming fade can address it. Once a
 * message settles the fade is gone — `.smd-w` and `.smd-settled` exist only
 * under `.smd-streaming` — and for ordinary body text the span's inline styles
 * restate what `.smd-root` already provides, character for character. Thousands
 * of those spans are not free: each carries its own `font-variation-settings`,
 * so the font engine shapes every word as an isolated run instead of caching
 * glyph runs across a line, and the whole thread re-shapes word by word on every
 * frame of the context panel's width animation.
 *
 * Deliberately conservative. Headings (`variant: 'h'`) and anything bold, italic
 * or struck carry real style the span is load-bearing for, so they keep it; only
 * the default body case is dropped, which is the overwhelming majority of a long
 * conversation and all of the cost.
 */
const isInertWordStyle = (context: RenderContext): boolean =>
  context.variant === 'w' &&
  !context.strong &&
  !context.em &&
  !context.strike &&
  context.weight === ROOT_TYPOGRAPHY.weight &&
  context.width === ROOT_TYPOGRAPHY.width &&
  context.roundness === ROOT_TYPOGRAPHY.roundness;

interface WordProps {
  children: string;
  variant: 'w' | 'h';
  strong?: boolean;
  em?: boolean;
  strike?: boolean;
  settled?: boolean;
  weight: number;
  width: number;
  roundness: number;
}

const Word = React.memo(
  function Word({
    children,
    variant,
    strong,
    em,
    strike,
    settled,
    weight,
    width,
    roundness,
  }: WordProps) {
    const settledAtMount = useRef(settled).current;
    const effectiveWeight = strong ? Math.max(540, weight) : weight;
    const variation = fontVariation(roundness, em ? -10 : 0, width, effectiveWeight);

    return (
      <span
        className={'smd-' + variant + (settledAtMount ? ' smd-settled' : '')}
        style={{
          fontVariationSettings: variation,
          fontWeight: effectiveWeight,
          textDecoration: strike ? 'line-through' : undefined,
        }}
      >
        {children}
      </span>
    );
  },
  (previous, next) =>
    previous.children === next.children &&
    previous.variant === next.variant &&
    previous.strong === next.strong &&
    previous.em === next.em &&
    previous.strike === next.strike &&
    previous.weight === next.weight &&
    previous.width === next.width &&
    previous.roundness === next.roundness
);

function RevealBlock({
  as: Tag,
  start,
  settled,
  revealTiming,
  className,
  children,
  ...props
}: {
  as: React.ElementType;
  start: number;
  settled?: boolean;
  revealTiming?: GeminiBlockRevealTiming;
  className?: string;
  children: React.ReactNode;
  [key: string]: any;
}) {
  const settledAtMount = useRef(settled).current;
  const timingAtMount = useRef(revealTiming).current;
  const mergedStyle = {
    ...props.style,
    ...(timingAtMount ? {
      '--animation-duration': `${timingAtMount.durationMs}ms`,
      '--smd-inner-delay': `${timingAtMount.innerDelayMs}ms`,
    } : {}),
  } as React.CSSProperties;
  return (
    <Tag
      {...props}
      style={mergedStyle}
      className={(className || '') + ' smd-reveal-block' + (settledAtMount ? ' smd-settled' : '')}
      data-reveal-start={start}
    >
      {children}
    </Tag>
  );
}

const revealTimingStyle = (timing?: GeminiBlockRevealTiming): React.CSSProperties | undefined =>
  timing
    ? {
        '--animation-duration': `${timing.durationMs}ms`,
        '--smd-inner-delay': `${timing.innerDelayMs}ms`,
      } as React.CSSProperties
    : undefined;

const InlineCode = React.memo(
  function InlineCode({
    value,
    settled,
  }: {
    value: string;
    settled?: boolean;
  }) {
    const settledAtMount = useRef(settled).current;
    return (
      <code className={'smd-inline-code smd-w' + (settledAtMount ? ' smd-settled' : '')}>
        {value}
      </code>
    );
  },
  (previous, next) => previous.value === next.value
);

const MathExpression = React.memo(
  function MathExpression({
    value,
    display,
    settled,
    revealTiming,
  }: {
    value: string;
    display?: boolean;
    settled?: boolean;
    revealTiming?: GeminiBlockRevealTiming;
  }) {
    const settledAtMount = useRef(settled).current;
    const timingAtMount = useRef(revealTiming).current;
    const rendered = useMemo(() => {
      try {
        return katex.renderToString(value, {
          displayMode: Boolean(display),
          output: 'htmlAndMathml',
          strict: 'ignore',
          throwOnError: false,
          trust: false,
        });
      } catch {
        return '';
      }
    }, [display, value]);

    const className =
      (display ? 'smd-math-display' : 'smd-math-inline smd-w') +
      (settledAtMount ? ' smd-settled' : '');
    const Tag = display ? 'div' : 'span';

    if (!rendered) {
      return <Tag className={className + ' smd-math-error'} style={revealTimingStyle(timingAtMount)}>{value}</Tag>;
    }

    return (
      <Tag
        className={className}
        style={revealTimingStyle(timingAtMount)}
        dangerouslySetInnerHTML={{ __html: rendered }}
      />
    );
  },
  (previous, next) => previous.value === next.value && previous.display === next.display
);

function offsetOf(node: any, fallback = 0): number {
  return node?.position?.start?.offset ?? fallback;
}

function endOffsetOf(node: any, fallback = 0): number {
  return node?.position?.end?.offset ?? fallback;
}

function normalizeIdentifier(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function safeHref(value: string | undefined): string {
  const href = String(value ?? '').trim();
  if (!href) return '';
  if (/^(https?:|mailto:|tel:|blob:|data:image\/|data:video\/|\/|#)/i.test(href)) return href;
  return '';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function copyToClipboard(value: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Use the compatibility fallback below.
    }
  }
  if (typeof document === 'undefined') return;
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function downloadText(filename: string, value: string, type: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const blob = new Blob([value], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

const LANGUAGE_ALIASES: Record<string, string> = {
  csharp: 'csharp',
  cs: 'csharp',
  cxx: 'cpp',
  htm: 'xml',
  html: 'xml',
  js: 'javascript',
  jsx: 'javascript',
  md: 'markdown',
  py: 'python',
  rb: 'ruby',
  sh: 'bash',
  shell: 'bash',
  svg: 'xml',
  ts: 'typescript',
  tsx: 'typescript',
  yml: 'yaml',
};

const LANGUAGE_LABELS: Record<string, string> = {
  bash: 'Shell',
  c: 'C',
  cpp: 'C++',
  csharp: 'C#',
  css: 'CSS',
  go: 'Go',
  html: 'HTML',
  java: 'Java',
  javascript: 'JavaScript',
  js: 'JavaScript',
  json: 'JSON',
  jsx: 'JSX',
  kotlin: 'Kotlin',
  markdown: 'Markdown',
  md: 'Markdown',
  php: 'PHP',
  plaintext: 'Code',
  python: 'Python',
  py: 'Python',
  ruby: 'Ruby',
  rust: 'Rust',
  sql: 'SQL',
  svg: 'SVG',
  swift: 'Swift',
  ts: 'TypeScript',
  tsx: 'TSX',
  typescript: 'TypeScript',
  xml: 'XML',
  yaml: 'YAML',
};

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  bash: 'sh',
  c: 'c',
  cpp: 'cpp',
  csharp: 'cs',
  css: 'css',
  go: 'go',
  html: 'html',
  java: 'java',
  javascript: 'js',
  json: 'json',
  jsx: 'jsx',
  kotlin: 'kt',
  markdown: 'md',
  php: 'php',
  python: 'py',
  ruby: 'rb',
  rust: 'rs',
  sql: 'sql',
  svg: 'svg',
  swift: 'swift',
  tsx: 'tsx',
  typescript: 'ts',
  xml: 'xml',
  yaml: 'yml',
};

function sourceLanguage(rawLanguage: string): string {
  return rawLanguage.trim().split(/\s+/)[0].replace(/^language-/, '').toLowerCase();
}

function highlightLanguage(rawLanguage: string): string {
  const source = sourceLanguage(rawLanguage);
  return LANGUAGE_ALIASES[source] || source;
}

function displayLanguage(rawLanguage: string): string {
  const source = sourceLanguage(rawLanguage);
  return LANGUAGE_LABELS[source] || (source ? source.toUpperCase() : 'Code');
}

function highlightedCode(value: string, rawLanguage: string): string {
  const language = highlightLanguage(rawLanguage);
  if (!language || language === 'text' || language === 'txt' || language === 'plaintext') {
    return escapeHtml(value);
  }
  try {
    if (hljs.getLanguage(language)) {
      return hljs.highlight(value, { language, ignoreIllegals: true }).value;
    }
  } catch {
    // Fall through to safely escaped plain code.
  }
  return escapeHtml(value);
}

function svgPreviewDocument(source: string): string {
  const svg = source
    .replace(/^\s*<\?xml[\s\S]*?\?>\s*/i, '')
    .replace(/^\s*<!doctype\s+svg[\s\S]*?>\s*/i, '');

  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8">',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: blob:; media-src data: blob:; font-src data:; style-src \'unsafe-inline\';">',
    '<style>',
    'html,body{width:100%;min-height:100%;margin:0;background:#131314;}',
    'html{overflow:auto;scrollbar-color:#747775 transparent;scrollbar-width:thin;}',
    'body{overflow:visible;}',
    'svg{display:block;width:100% !important;height:auto !important;max-width:none !important;max-height:none !important;}',
    '::-webkit-scrollbar{width:10px;height:10px;background:transparent;}',
    '::-webkit-scrollbar-track{background:transparent;}',
    '::-webkit-scrollbar-thumb{border:3px solid transparent;border-radius:9999px;background:#747775;background-clip:content-box;}',
    '::-webkit-scrollbar-corner{background:transparent;}',
    '</style></head><body>',
    svg,
    '</body></html>',
  ].join('');
}

const SvgPreview = React.memo(function SvgPreview({
  source,
  settled,
  revealTiming,
}: {
  source: string;
  settled?: boolean;
  revealTiming?: GeminiBlockRevealTiming;
}) {
  const [copied, setCopied] = useState(false);
  const documentSource = useMemo(() => svgPreviewDocument(source), [source]);

  const handleCopy = async () => {
    await copyToClipboard(source);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div
      className={'smd-svg-preview-block' + (settled ? ' smd-settled' : '')}
      style={revealTimingStyle(revealTiming)}
    >
      <div className="smd-svg-preview-toolbar">
        <span className="smd-svg-preview-label">SVG</span>
        <div className="smd-svg-preview-actions">
          <button
            type="button"
            className="smd-svg-preview-button"
            aria-label={copied ? 'SVG copied' : 'Copy SVG'}
            title={copied ? 'Copied' : 'Copy SVG'}
            onClick={() => void handleCopy()}
          >
            <MaterialSymbol
              family="google-symbols"
              name={copied ? 'check' : 'content_copy'}
              size={16}
              weight={400}
              roundness={0}
            />
          </button>
          <button
            type="button"
            className="smd-svg-preview-button"
            aria-label="Download SVG"
            title="Download SVG"
            onClick={() => downloadText('image.svg', source, 'image/svg+xml;charset=utf-8')}
          >
            <MaterialSymbol family="google-symbols" name="download" size={16} weight={400} roundness={0} />
          </button>
        </div>
      </div>
      <div className="smd-svg-preview-canvas">
        <iframe
          className="smd-svg-preview-frame"
          title="SVG preview"
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={documentSource}
        />
      </div>
    </div>
  );
});

const CodeBlock = React.memo(
  function CodeBlock({
    value,
    language,
    settled,
    revealTiming,
  }: {
    value: string;
    language: string;
    settled?: boolean;
    revealTiming?: GeminiBlockRevealTiming;
  }) {
    const [copied, setCopied] = useState(false);
    const settledAtMount = useRef(settled).current;
    const source = value.replace(/\n$/, '');
    const html = useMemo(() => highlightedCode(source, language), [language, source]);
    const normalized = highlightLanguage(language);
    const extension = LANGUAGE_EXTENSIONS[sourceLanguage(language)] || LANGUAGE_EXTENSIONS[normalized] || 'txt';
    const isSvg = sourceLanguage(language) === 'svg' || /^\s*<svg(?:\s|>)/i.test(source);
    const hasCompleteSvg = isSvg && /<\/svg>\s*$/i.test(source);

    const handleCopy = async () => {
      await copyToClipboard(source);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    };

    if (isSvg) {
      return hasCompleteSvg
        ? <SvgPreview source={source} settled={settledAtMount} revealTiming={revealTiming} />
        : null;
    }

    return (
      <div
        className={'smd-code-block' + (settledAtMount ? ' smd-settled' : '')}
        style={revealTimingStyle(revealTiming)}
      >
        <div className="smd-code-header">
          <span
            className="smd-code-language"
            style={{ fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 92, "wght" 540' }}
          >
            {displayLanguage(language)}
          </span>
          <div className="smd-code-buttons">
            <button
              type="button"
              className="smd-icon-button"
              aria-label="Download code"
              title="Download code"
              onClick={() => downloadText('code.' + extension, source, 'text/plain;charset=utf-8')}
            >
              <MaterialSymbol family="luminous" name="arrow_circle_down" size={24} weight={300} roundness={100} />
            </button>
            <button
              type="button"
              className="smd-icon-button"
              aria-label={copied ? 'Code copied' : 'Copy code'}
              title={copied ? 'Copied' : 'Copy code'}
              onClick={() => void handleCopy()}
            >
              <MaterialSymbol
                family="luminous"
                name={copied ? 'check' : 'content_copy'}
                size={24}
                weight={300}
                roundness={100}
              />
            </button>
          </div>
        </div>
        <div className="smd-code-scroll smd-scroll">
          <pre className="smd-code-pre">
            <code
              className={'hljs' + (normalized ? ' language-' + normalized : '')}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </pre>
        </div>
      </div>
    );
  },
  (previous, next) => previous.value === next.value && previous.language === next.language
);

interface DefinitionRecord {
  url: string;
  title?: string;
}

interface RenderContext {
  source: string;
  settledBefore: number;
  mediaItems?: any[];
  onOpenResource?: (resource: RichResource) => void;
  definitions: Map<string, DefinitionRecord>;
  footnoteNumbers: Map<string, number>;
  variant: 'w' | 'h';
  weight: number;
  width: number;
  roundness: number;
  strong?: boolean;
  em?: boolean;
  strike?: boolean;
  /** Source chips to place, each keyed by the character offset it follows. */
  chipGroups?: ChipGroup[];
  /**
   * Running count of chips emitted this render, used to stagger their entrance.
   *
   * A holder object rather than a number because the context is spread
   * (`{...context}`) when descending into strong/em/list children -- a plain
   * field would be copied and each branch would restart its own count. Spreading
   * copies the reference, so every branch shares one counter and the ordinals
   * follow document order.
   */
  chipOrder?: { next: number };
  /**
   * Whether the per-word fade is running for this message.
   *
   * False for every settled turn in the thread, which is what lets the word
   * spans be dropped — see `isInertWordStyle`. Threaded through the context
   * rather than read from a module flag because two messages render under
   * different values at the same time: the newest is streaming while the rest
   * are static.
   */
  animating?: boolean;
  revealBlockTimings?: GeminiBlockRevealTiming[];
  revealBlockOrder?: { next: number };
  revealWithinParent?: boolean;
}

const nextRevealBlockTiming = (
  context: RenderContext,
  settled = false,
): GeminiBlockRevealTiming | undefined => {
  if (settled) return undefined;
  const order = context.revealBlockOrder;
  if (!order) return undefined;
  const timing = context.revealBlockTimings?.[order.next] || geminiRevealTimingAt(order.next);
  order.next += 1;
  return timing;
};

function renderAnimatedText(value: string, start: number, context: RenderContext): React.ReactNode[] {
  // Settled body text needs no per-word handles: nothing addresses them once the
  // fade is over, and their styles are the ones already inherited. Hand the run
  // back as a single text node so the font engine can shape it as one run.
  if (!context.animating && isInertWordStyle(context)) return [value];

  const nodes: React.ReactNode[] = [];
  const expression = /\S+/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = expression.exec(value))) {
    if (match.index > cursor) nodes.push(value.slice(cursor, match.index));
    const absoluteOffset = start + match.index;
    nodes.push(
      <Word
        key={absoluteOffset}
        variant={context.variant}
        settled={absoluteOffset < context.settledBefore}
        strong={context.strong}
        em={context.em}
        strike={context.strike}
        weight={context.weight}
        width={context.width}
        roundness={context.roundness}
      >
        {match[0]}
      </Word>
    );
    cursor = match.index + match[0].length;
  }

  if (cursor < value.length) nodes.push(value.slice(cursor));
  return nodes;
}

function definitionFor(node: any, context: RenderContext): DefinitionRecord | undefined {
  return context.definitions.get(normalizeIdentifier(node?.identifier || node?.label));
}

function resolveMediaItem(url: string, mediaItems?: any[]) {
  const globalItems =
    typeof window !== 'undefined' && Array.isArray((window as any).canvasMediaItems)
      ? (window as any).canvasMediaItems
      : [];
  const allItems = [...(mediaItems || []), ...globalItems];
  if (!url.startsWith('media-id:')) {
    return { item: undefined, url, loading: false };
  }
  const id = url.slice('media-id:'.length);
  const item = allItems.find((candidate: any) => String(candidate?.id) === id);
  return {
    item,
    url: item?.url || '',
    loading: !item || item.status === 'generating' || (!item.url && item.status !== 'failed'),
  };
}

function ratioToCss(value: unknown): string {
  const ratio = String(value || '4:3');
  const match = ratio.match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/);
  if (!match) return '4 / 3';
  return match[1] + ' / ' + match[2];
}

interface MediaDescriptor {
  key: string;
  start: number;
  url: string;
  alt: string;
  title?: string;
  href?: string;
}

function MediaCard({
  descriptor,
  mediaItems,
}: {
  descriptor: MediaDescriptor;
  mediaItems?: any[];
}) {
  const resolved = resolveMediaItem(descriptor.url, mediaItems);
  const item = resolved.item;
  const failed = item?.status === 'failed';
  const ratio = ratioToCss(item?.ratio);
  const destination = safeHref(descriptor.href || resolved.url);

  const open = () => {
    if (item && typeof window !== 'undefined' && typeof (window as any).openCanvasItemInFullscreen === 'function') {
      (window as any).openCanvasItemInFullscreen(item);
      return;
    }
    if (destination && typeof window !== 'undefined') {
      window.open(destination, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <button
      type="button"
      className="smd-media-card"
      aria-label={descriptor.alt || descriptor.title || 'Open media'}
      onClick={open}
    >
      <span
        className="smd-media-frame"
        style={{ '--smd-media-ratio': ratio } as React.CSSProperties}
      >
        {failed ? (
          <span className="smd-media-error">
            <MaterialSymbol family="luminous" name="warning" size={20} weight={300} roundness={100} />
            <span className="smd-media-error-title">Failed</span>
            <span className="smd-media-error-detail">
              {item?.error || 'This media could not be generated.'}
            </span>
          </span>
        ) : resolved.loading ? (
          <span className="smd-media-loading" aria-label="Generating media" />
        ) : item?.kind === 'video' ? (
          <video src={resolved.url} autoPlay loop muted playsInline />
        ) : (
          <img
            src={safeHref(resolved.url)}
            alt={descriptor.alt}
            title={descriptor.title}
            loading="lazy"
            decoding="async"
          />
        )}
      </span>
    </button>
  );
}

const MediaGallery = React.memo(
  function MediaGallery({
    items,
    mediaItems,
    settled,
    revealTiming,
  }: {
    items: MediaDescriptor[];
    mediaItems?: any[];
    settled?: boolean;
    revealTiming?: GeminiBlockRevealTiming;
  }) {
    const settledAtMount = useRef(settled).current;
    return (
      <div
        className={'smd-media-gallery' + (settledAtMount ? ' smd-settled' : '')}
        data-count={String(items.length)}
        style={revealTimingStyle(revealTiming)}
      >
        {items.map((item) => (
          <MediaCard key={item.key} descriptor={item} mediaItems={mediaItems} />
        ))}
      </div>
    );
  },
  (previous, next) => previous.items === next.items && previous.mediaItems === next.mediaItems
);

function renderInlineImage(node: any, context: RenderContext): React.ReactNode {
  const definition = node.type === 'imageReference' ? definitionFor(node, context) : undefined;
  const rawUrl = node.url || definition?.url || '';
  const resolved = resolveMediaItem(rawUrl, context.mediaItems);
  if (resolved.loading) {
    return <span className="smd-math-error">Generating image…</span>;
  }
  const src = safeHref(resolved.url);
  if (!src) return renderAnimatedText(node.alt || '', offsetOf(node), context);
  return (
    <img
      key={offsetOf(node)}
      className="smd-inline-image"
      src={src}
      alt={node.alt || ''}
      title={node.title || definition?.title}
      loading="lazy"
      decoding="async"
    />
  );
}

function renderInlineNode(node: any, context: RenderContext, index: number): React.ReactNode {
  const start = offsetOf(node, index);
  const key = node.type + '-' + start + '-' + index;

  switch (node.type) {
    case 'text':
      return renderAnimatedText(node.value || '', start, context);
    case 'strong':
      return (
        <b
          key={key}
          className="smd-strong"
          style={{
            fontVariationSettings:
              '"ROND" ' + context.roundness +
              ', "slnt" ' + (context.em ? -10 : 0) +
              ', "wdth" ' + context.width +
              ', "wght" ' + Math.max(540, context.weight),
          }}
        >
          {renderInlineNodes(node.children || [], { ...context, strong: true })}
        </b>
      );
    case 'emphasis':
      return (
        <i
          key={key}
          className="smd-emphasis"
          style={{
            fontStyle: 'normal',
            fontVariationSettings:
              '"ROND" ' + context.roundness +
              ', "slnt" -10' +
              ', "wdth" ' + context.width +
              ', "wght" ' + context.weight,
          }}
        >
          {renderInlineNodes(node.children || [], { ...context, em: true })}
        </i>
      );
    case 'delete':
      return (
        <React.Fragment key={key}>
          {renderAnimatedText('~~', start, context)}
          {renderInlineNodes(node.children || [], context)}
          {renderAnimatedText(
            '~~',
            Math.max(start + 2, endOffsetOf(node, start + 4) - 2),
            context
          )}
        </React.Fragment>
      );
    case 'inlineCode':
      return (
        <InlineCode
          key={key}
          value={node.value || ''}
          settled={start < context.settledBefore}
        />
      );
    case 'inlineMath':
      return (
        <MathExpression
          key={key}
          value={node.value || ''}
          settled={start < context.settledBefore}
        />
      );
    case 'link': {
      const href = safeHref(node.url);
      const children = renderInlineNodes(node.children || [], context);
      const resource = href ? resourceFromUrl(href, nodeText(node)) : null;
      return href ? (
        <a
          key={key}
          className="smd-link"
          href={href}
          title={node.title}
          target={href.startsWith('#') ? undefined : '_blank'}
          rel={href.startsWith('#') ? undefined : 'noopener noreferrer'}
          onClick={resource && context.onOpenResource ? (event) => {
            event.preventDefault();
            context.onOpenResource?.(resource);
          } : undefined}
        >
          {children}
        </a>
      ) : (
        <React.Fragment key={key}>{children}</React.Fragment>
      );
    }
    case 'linkReference': {
      const definition = definitionFor(node, context);
      const href = safeHref(definition?.url);
      const children = renderInlineNodes(node.children || [], context);
      const resource = href ? resourceFromUrl(href, nodeText(node)) : null;
      return href ? (
        <a
          key={key}
          className="smd-link"
          href={href}
          title={definition?.title}
          target="_blank"
          rel="noopener noreferrer"
          onClick={resource && context.onOpenResource ? (event) => {
            event.preventDefault();
            context.onOpenResource?.(resource);
          } : undefined}
        >
          {children}
        </a>
      ) : (
        <React.Fragment key={key}>{children}</React.Fragment>
      );
    }
    case 'image':
    case 'imageReference':
      return renderInlineImage(node, context);
    case 'break':
      return <br key={key} />;
    case 'html':
      return (
        <React.Fragment key={key}>
          {renderAnimatedText(node.value || '', start, context)}
        </React.Fragment>
      );
    case 'footnoteReference': {
      const identifier = normalizeIdentifier(node.identifier);
      const number = context.footnoteNumbers.get(identifier) || 1;
      return (
        <sup key={key} className="smd-footnote-ref">
          <a className="smd-link" href={'#smd-footnote-' + identifier}>{number}</a>
        </sup>
      );
    }
    default:
      if (Array.isArray(node.children)) {
        return (
          <React.Fragment key={key}>
            {renderInlineNodes(node.children, context)}
          </React.Fragment>
        );
      }
      if (typeof node.value === 'string') {
        return (
          <React.Fragment key={key}>
            {renderAnimatedText(node.value, start, context)}
          </React.Fragment>
        );
      }
      return null;
  }
}

function renderInlineNodes(nodes: any[], context: RenderContext): React.ReactNode[] {
  return nodes.map((node, index) => renderInlineNode(node, context, index));
}

function nodeText(node: any): string {
  if (!node) return '';
  if (typeof node.value === 'string') return node.value;
  if (node.type === 'image' || node.type === 'imageReference') return node.alt || '';
  if (!Array.isArray(node.children)) return '';
  return node.children.map(nodeText).join('');
}

function richResourcesInNode(node: any, context: RenderContext): RichResource[] {
  if (!context.onOpenResource) return [];
  const resources: RichResource[] = [];
  const seen = new Set<string>();

  const visit = (candidate: any) => {
    if (!candidate) return;
    if (candidate.type === 'link' || candidate.type === 'linkReference') {
      const definition = candidate.type === 'linkReference' ? definitionFor(candidate, context) : undefined;
      const href = safeHref(candidate.url || definition?.url);
      const resource = href ? resourceFromUrl(href, nodeText(candidate)) : null;
      if (resource && !seen.has(resource.url)) {
        seen.add(resource.url);
        resources.push(resource);
      }
    }
    for (const child of candidate.children || []) visit(child);
  };

  visit(node);
  return resources;
}

function TableBlock({
  node,
  context,
  revealTiming,
}: {
  node: any;
  context: RenderContext;
  revealTiming?: GeminiBlockRevealTiming;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState({
    hasScrollbar: false,
    atStart: true,
    atEnd: true,
  });
  const settledAtMount = useRef(offsetOf(node) < context.settledBefore).current;
  const rows = node.children || [];
  const alignments = node.align || [];
  const plainRows = rows.map((row: any) => (row.children || []).map((cell: any) => nodeText(cell)));
  const tsv = plainRows.map((row: string[]) => row.join('\t')).join('\n');

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const update = () => {
      const hasScrollbar = element.scrollWidth > element.clientWidth + 1;
      const atStart = !hasScrollbar || element.scrollLeft <= 1;
      const atEnd =
        !hasScrollbar || element.scrollLeft >= element.scrollWidth - element.clientWidth - 1;
      setScrollState((previous) =>
        previous.hasScrollbar === hasScrollbar &&
        previous.atStart === atStart &&
        previous.atEnd === atEnd
          ? previous
          : { hasScrollbar, atStart, atEnd }
      );
    };

    update();
    element.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    observer?.observe(element);
    if (element.firstElementChild) observer?.observe(element.firstElementChild);
    window.addEventListener('resize', update);

    return () => {
      element.removeEventListener('scroll', update);
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [node]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menuOpen]);

  const copy = async () => {
    await copyToClipboard(tsv);
    setCopied(true);
    setMenuOpen(false);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const exportToSheets = () => {
    // A browser-only client cannot create a populated Google Sheet without a
    // signed-in Sheets API grant. Match Gemini's entry point while placing the
    // tab-separated table on the clipboard so it can be pasted immediately.
    void copyToClipboard(tsv);
    window.open('https://sheets.new', '_blank', 'noopener,noreferrer');
    setMenuOpen(false);
  };

  return (
    <div
      className={
        'smd-table-block' +
        (settledAtMount ? ' smd-settled' : '') +
        (scrollState.hasScrollbar ? ' has-scrollbar' : '') +
        (scrollState.atStart ? ' is-at-scroll-start' : '') +
        (scrollState.atEnd ? ' is-at-scroll-end' : '')
      }
      style={revealTimingStyle(revealTiming)}
    >
      <div ref={scrollRef} className="smd-table-content smd-scroll">
        <table className="smd-table">
          {rows.length > 0 && (
            <thead>
              <tr>
                {(rows[0].children || []).map((cell: any, columnIndex: number) => (
                  <th
                    key={offsetOf(cell, columnIndex)}
                    style={{ textAlign: alignments[columnIndex] || 'left' }}
                  >
                    {renderInlineNodes(cell.children || [], context)}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          {rows.length > 1 && (
            <tbody>
              {rows.slice(1).map((row: any, rowIndex: number) => (
                <tr key={offsetOf(row, rowIndex)}>
                  {(row.children || []).map((cell: any, columnIndex: number) => (
                    <td
                      key={offsetOf(cell, columnIndex)}
                      style={{ textAlign: alignments[columnIndex] || 'left' }}
                    >
                      {renderInlineNodes(cell.children || [], context)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </div>
      <div className="smd-table-footer" ref={menuRef}>
        <button
          type="button"
          className="smd-table-menu-trigger"
          aria-label="More options"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <MaterialSymbol family="luminous" name="more_horiz" size={24} weight={300} roundness={100} />
        </button>
        {menuOpen && (
          <div className="smd-table-menu" role="menu">
            <button type="button" role="menuitem" onClick={exportToSheets}>
              <MaterialSymbol family="luminous" name="share_1" size={20} weight={300} roundness={100} />
              Export to Sheets
            </button>
            <button type="button" role="menuitem" onClick={() => void copy()}>
              <MaterialSymbol family="luminous" name={copied ? 'check' : 'copy'} size={20} weight={300} roundness={100} />
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const HEADING_METRICS: Record<number, { weight: number; width: number; roundness: number }> = {
  1: { weight: 350, width: 100, roundness: 20 },
  2: { weight: 380, width: 100, roundness: 20 },
  3: { weight: 470, width: 94, roundness: 20 },
  4: { weight: 470, width: 94, roundness: 20 },
  5: { weight: 470, width: 94, roundness: 20 },
  6: { weight: 470, width: 94, roundness: 20 },
};

function isWhitespaceText(node: any): boolean {
  return node?.type === 'text' && !/\S/.test(node.value || '');
}

function isDisplayDelimitedMath(node: any, context: RenderContext): boolean {
  if (node?.type !== 'inlineMath') return false;
  const raw = context.source
    .slice(offsetOf(node), endOffsetOf(node, context.source.length))
    .trim();
  return (
    (raw.startsWith('$$') && raw.endsWith('$$')) ||
    (raw.startsWith('\\[') && raw.endsWith('\\]'))
  );
}

/**
 * An image written *into* prose, which Gemini's markdown emitter renders as
 * `.inline-image-container` — a floated block, not an inline `<img>`.
 *
 * It has to be hoisted out of the `<p>`, and that is not a stylistic choice.
 * Gemini's host writes its markdown as an HTML string, so the parser gets the
 * last word, and the parser hoists: `<p>before<div>…</div>after</p>` parses as
 * `<p>before</p>` + `<div>…</div>` + `"after"` (verified against Chrome's own
 * parser; a `<span>` in the same position stays nested, so it is the block
 * display that causes it). React builds via the DOM API and would happily nest
 * the div inside the p instead, producing a tree Gemini never has — so the
 * hoist is reproduced explicitly here.
 *
 * `media-id:` images are excluded for the same reason as in
 * `standaloneInlineImage`: they are Willow's own canvas media and belong to
 * `MediaGallery`, which carries their status and ratio.
 */
function hoistableInlineImage(node: any, context: RenderContext) {
  if (node.type !== 'image' && node.type !== 'imageReference') return null;
  const definition = node.type === 'imageReference' ? definitionFor(node, context) : undefined;
  const url = node.url || definition?.url || '';
  if (!url || url.startsWith('media-id:')) return null;
  const src = safeHref(url);
  if (!src) return null;
  return { src, alt: node.alt || '', credit: node.title || definition?.title || '' };
}

function renderParagraphNode(node: any, context: RenderContext, key: string): React.ReactNode {
  const children = node.children || [];
  const blocks: React.ReactNode[] = [];
  const richResources = richResourcesInNode(node, context);
  let inlineNodes: any[] = [];
  let skipLeadingWhitespace = false;
  // Gemini renders exactly one chip per block, as its last child, aggregating
  // every source cited anywhere in that block (measured: 6 chips over 6
  // paragraphs, never two in one block, 8 citation spans collapsing into 6).
  const chipSources = chipSourcesForRange(context, offsetOf(node), endOffsetOf(node, offsetOf(node)));

  const flushInline = () => {
    while (inlineNodes.length && isWhitespaceText(inlineNodes[inlineNodes.length - 1])) {
      inlineNodes.pop();
    }
    if (!inlineNodes.length) return;
    const paragraphStart = offsetOf(inlineNodes[0], offsetOf(node));
    const settled = paragraphStart < context.settledBefore;
    const renderedInline = renderInlineNodes(inlineNodes, context);
    blocks.push(context.revealWithinParent ? (
      <p key={'paragraph-' + paragraphStart} className="smd-paragraph">
        {renderedInline}
      </p>
    ) : (
      <RevealBlock
        as="p"
        key={'paragraph-' + paragraphStart}
        start={paragraphStart}
        settled={settled}
        revealTiming={nextRevealBlockTiming(context, settled)}
        className="smd-paragraph"
      >
        {renderedInline}
      </RevealBlock>
    ));
    inlineNodes = [];
  };

  children.forEach((child: any, childIndex: number) => {
    if (isDisplayDelimitedMath(child, context)) {
      flushInline();
      const mathStart = offsetOf(child, offsetOf(node) + childIndex);
      blocks.push(
        <MathExpression
          key={'display-math-' + mathStart}
          value={child.value || ''}
          display
          settled={mathStart < context.settledBefore}
          revealTiming={nextRevealBlockTiming(
            context,
            mathStart < context.settledBefore || context.revealWithinParent,
          )}
        />
      );
      skipLeadingWhitespace = true;
      return;
    }

    const hoisted = hoistableInlineImage(child, context);
    if (hoisted) {
      flushInline();
      const imageStart = offsetOf(child, offsetOf(node) + childIndex);
      blocks.push(
        <GeminiInlineImage
          key={'inline-image-' + imageStart}
          src={hoisted.src}
          alt={hoisted.alt}
          credit={hoisted.credit}
        />
      );
      skipLeadingWhitespace = true;
      return;
    }

    if (skipLeadingWhitespace && isWhitespaceText(child)) return;
    skipLeadingWhitespace = false;
    inlineNodes.push(child);
  });

  flushInline();
  // The chip is the last child of the block's final paragraph, so it sits on the
  // same line as the closing text and wraps with it. A block whose last element
  // is display math gets the chip appended as its own trailing paragraph.
  if (chipSources.length > 0) {
    const lastIndex = blocks.length - 1;
    const last = lastIndex >= 0 ? blocks[lastIndex] : null;
    const chip = (
      <SourceChip
        key="source-chip"
        sources={chipSources}
        ordinal={context.chipOrder ? context.chipOrder.next++ : 0}
      />
    );
    if (
      React.isValidElement(last)
      && (
        (last.type === RevealBlock && (last.props as any).as === 'p')
        || last.type === 'p'
      )
    ) {
      const existing = (last.props as any).children;
      // Passing `existing` and `chip` as separate child arguments nests an
      // existing child array, changing every word's React key path. Keep the
      // list flat so adding a citation does not remount the paragraph text.
      const appendedChildren = Array.isArray(existing)
        ? [...existing, chip]
        : [existing, chip];
      blocks[lastIndex] = React.cloneElement(
        last as React.ReactElement<any>,
        undefined,
        appendedChildren,
      );
    } else {
      blocks.push(context.revealWithinParent ? (
        <p key={'paragraph-chip-' + offsetOf(node)} className="smd-paragraph">
          {chip}
        </p>
      ) : (
        <RevealBlock
          as="p"
          key={'paragraph-chip-' + offsetOf(node)}
          start={offsetOf(node)}
          settled={offsetOf(node) < context.settledBefore}
          revealTiming={nextRevealBlockTiming(
            context,
            offsetOf(node) < context.settledBefore || context.revealWithinParent,
          )}
          className="smd-paragraph"
        >
          {chip}
        </RevealBlock>
      ));
    }
  }
  const paragraph = blocks.length === 1
    ? blocks[0]
    : <React.Fragment key={key}>{blocks}</React.Fragment>;
  if (!richResources.length || !context.onOpenResource) return paragraph;
  const firstStart = offsetOf(node);
  const resourcesSettled = firstStart < context.settledBefore;
  return (
    <React.Fragment key={key}>
      {paragraph}
      <RichResourceGroup
        resources={richResources}
        onOpen={context.onOpenResource}
        settled={resourcesSettled}
        style={revealTimingStyle(nextRevealBlockTiming(
          context,
          resourcesSettled || context.revealWithinParent,
        ))}
      />
    </React.Fragment>
  );
}

function renderBlockNode(node: any, context: RenderContext, index: number): React.ReactNode {
  const start = offsetOf(node, index);
  const key = node.type + '-' + start + '-' + index;

  switch (node.type) {
    case 'paragraph': {
      return renderParagraphNode(node, context, key);
    }
    case 'heading': {
      const depth = Math.min(6, Math.max(1, node.depth || 1));
      const Tag = ('h' + depth) as React.ElementType;
      const metrics = HEADING_METRICS[depth];
      const settled = start < context.settledBefore;
      const headingContext: RenderContext = {
        ...context,
        variant: 'h',
        weight: metrics.weight,
        width: metrics.width,
        roundness: metrics.roundness,
      };
      return (
        <RevealBlock
          as={Tag}
          key={key}
          start={start}
          settled={settled}
          revealTiming={nextRevealBlockTiming(context, settled || context.revealWithinParent)}
          className={'smd-heading smd-heading-' + depth}
          style={{
            fontVariationSettings:
              '"ROND" ' + metrics.roundness +
              ', "slnt" 0, "wdth" ' + metrics.width +
              ', "wght" ' + metrics.weight,
          }}
        >
          {renderInlineNodes(node.children || [], headingContext)}
        </RevealBlock>
      );
    }
    case 'list': {
      const ordered = Boolean(node.ordered);
      const Tag = ordered ? 'ol' : 'ul';
      const startNumber = ordered ? Math.max(1, node.start || 1) : 1;
      return (
        <Tag
          key={key}
          className={'smd-list ' + (ordered ? 'smd-list-ordered' : 'smd-list-unordered')}
          style={ordered ? { counterReset: 'smd-list-item ' + (startNumber - 1) } : undefined}
        >
          {(node.children || []).map((item: any, itemIndex: number) => {
            const checked = typeof item.checked === 'boolean' ? item.checked : undefined;
            const itemStart = offsetOf(item, itemIndex);
            const firstChild = item.children?.[0];
            const taskSource = checked === undefined
              ? ''
              : context.source.slice(itemStart, endOffsetOf(firstChild, itemStart + 8));
            const taskMatch = checked === undefined ? null : /\[[ xX]\]/.exec(taskSource);
            const taskMarker = checked === undefined
              ? ''
              : taskMatch?.[0] || (checked ? '[x]' : '[ ]');
            const taskMarkerStart = itemStart + (taskMatch?.index || 0);
            const settled = itemStart < context.settledBefore;
            const itemContext: RenderContext = {
              ...context,
              revealWithinParent: true,
            };
            return (
              <RevealBlock
                as="li"
                key={itemStart}
                start={itemStart}
                settled={settled}
                revealTiming={nextRevealBlockTiming(context, settled)}
                className={checked !== undefined ? 'smd-task-item' : undefined}
              >
                <div className="smd-list-content">
                  {(item.children || []).map((child: any, childIndex: number) => {
                    if (checked !== undefined && childIndex === 0 && child.type === 'paragraph') {
                      return (
                        <p key={'task-' + offsetOf(child)} className="smd-paragraph">
                          {renderAnimatedText(taskMarker + ' ', taskMarkerStart, itemContext)}
                          {renderInlineNodes(child.children || [], itemContext)}
                        </p>
                      );
                    }
                    return renderBlockNode(child, itemContext, childIndex);
                  })}
                </div>
              </RevealBlock>
            );
          })}
        </Tag>
      );
    }
    case 'blockquote':
      return (
        <blockquote key={key} className="smd-blockquote">
          {(node.children || []).map((child: any, childIndex: number) =>
            renderBlockNode(child, context, childIndex)
          )}
        </blockquote>
      );
    case 'code': {
      // A card fence carries JSON, not source. While the block is still
      // arriving the JSON does not parse, and `parseBentoCards` returns null —
      // we render nothing at all rather than flashing a code block that turns
      // into cards a token later.
      if (isBentoFence(node.lang)) {
        const cards = parseBentoCards(node.value || '');
        return cards ? <BentoCardGroup key={key} cards={cards} /> : null;
      }
      const settled = start < context.settledBefore;
      return (
        <CodeBlock
          key={key}
          value={node.value || ''}
          language={node.lang || ''}
          settled={settled}
          revealTiming={nextRevealBlockTiming(context, settled || context.revealWithinParent)}
        />
      );
    }
    case 'math': {
      const settled = start < context.settledBefore;
      return (
        <MathExpression
          key={key}
          value={node.value || ''}
          display
          settled={settled}
          revealTiming={nextRevealBlockTiming(context, settled || context.revealWithinParent)}
        />
      );
    }
    case 'table': {
      const settled = start < context.settledBefore;
      return (
        <TableBlock
          key={key}
          node={node}
          context={context}
          revealTiming={nextRevealBlockTiming(context, settled || context.revealWithinParent)}
        />
      );
    }
    case 'thematicBreak':
      return null;
    case 'html': {
      const settled = start < context.settledBefore;
      return (
        <RevealBlock
          as="p"
          key={key}
          start={start}
          settled={settled}
          revealTiming={nextRevealBlockTiming(context, settled || context.revealWithinParent)}
        >
          {renderAnimatedText(node.value || '', start, context)}
        </RevealBlock>
      );
    }
    case 'definition':
    case 'footnoteDefinition':
      return null;
    default:
      if (Array.isArray(node.children)) {
        return (
          <div key={key}>
            {node.children.map((child: any, childIndex: number) =>
              renderBlockNode(child, context, childIndex)
            )}
          </div>
        );
      }
      if (typeof node.value === 'string') {
        const settled = start < context.settledBefore;
        return (
          <RevealBlock
            as="p"
            key={key}
            start={start}
            settled={settled}
            revealTiming={nextRevealBlockTiming(context, settled || context.revealWithinParent)}
          >
            {renderAnimatedText(node.value, start, context)}
          </RevealBlock>
        );
      }
      return null;
  }
}

function descriptorFromImage(
  node: any,
  context: RenderContext,
  href?: string
): MediaDescriptor | null {
  const definition = node.type === 'imageReference' ? definitionFor(node, context) : undefined;
  const url = node.url || definition?.url || '';
  if (!url) return null;
  const start = offsetOf(node);
  return {
    key: node.type + '-' + start,
    start,
    url,
    alt: node.alt || '',
    title: node.title || definition?.title,
    href,
  };
}

function standaloneMedia(node: any, context: RenderContext): MediaDescriptor[] | null {
  if (node.type !== 'paragraph') return null;
  const meaningful = (node.children || []).filter(
    (child: any) => child.type !== 'text' || /\S/.test(child.value || '')
  );
  if (meaningful.length === 0) return null;
  const media: MediaDescriptor[] = [];

  for (const child of meaningful) {
    if (child.type === 'image' || child.type === 'imageReference') {
      const descriptor = descriptorFromImage(child, context);
      if (!descriptor) return null;
      media.push(descriptor);
      continue;
    }
    if (child.type === 'link' || child.type === 'linkReference') {
      const linkDefinition = child.type === 'linkReference' ? definitionFor(child, context) : undefined;
      const href = safeHref(child.url || linkDefinition?.url);
      const linkChildren = (child.children || []).filter(
        (grandchild: any) => grandchild.type !== 'text' || /\S/.test(grandchild.value || '')
      );
      if (!href || linkChildren.length === 0) return null;
      for (const grandchild of linkChildren) {
        if (grandchild.type !== 'image' && grandchild.type !== 'imageReference') return null;
        const descriptor = descriptorFromImage(grandchild, context, href);
        if (!descriptor) return null;
        media.push(descriptor);
      }
      continue;
    }
    return null;
  }

  return media.length ? media : null;
}

function collectDefinitions(tree: any): Map<string, DefinitionRecord> {
  const definitions = new Map<string, DefinitionRecord>();
  for (const child of tree.children || []) {
    if (child.type !== 'definition') continue;
    definitions.set(normalizeIdentifier(child.identifier || child.label), {
      url: child.url || '',
      title: child.title,
    });
  }
  return definitions;
}

function collectFootnoteNumbers(node: any, numbers = new Map<string, number>()): Map<string, number> {
  if (node?.type === 'footnoteReference') {
    const identifier = normalizeIdentifier(node.identifier);
    if (!numbers.has(identifier)) numbers.set(identifier, numbers.size + 1);
  }
  for (const child of node?.children || []) collectFootnoteNumbers(child, numbers);
  return numbers;
}

function renderFootnotes(tree: any, context: RenderContext): React.ReactNode | null {
  const definitions = (tree.children || []).filter((child: any) => child.type === 'footnoteDefinition');
  if (!definitions.length) return null;
  return (
    <section className="smd-footnotes" aria-label="Footnotes">
      <ol>
        {definitions.map((definition: any, index: number) => {
          const identifier = normalizeIdentifier(definition.identifier);
          return (
            <li key={identifier || index} id={'smd-footnote-' + identifier}>
              {(definition.children || []).map((child: any, childIndex: number) =>
                renderBlockNode(child, context, childIndex)
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * A paragraph holding one image and nothing else, where that image is an
 * ordinary URL rather than a `media-id:` reference.
 *
 * The split is deliberate. `media-id:` images are Willow's own generated canvas
 * media — they carry a status, a ratio and a fullscreen action, which is what
 * `MediaGallery` exists to render. An image the model merely *cites* has none of
 * that, and it is exactly the case Gemini renders with `.inline-image-container`.
 *
 * Gemini's own emitter takes `alt` and a separate credit field. Markdown has no
 * credit field, so the title (`![alt](url "title")`) is mapped onto it — that
 * mapping is ours; everything downstream of it is Gemini's.
 */
function standaloneInlineImage(node: any, context: RenderContext) {
  if (node.type !== 'paragraph') return null;
  const meaningful = (node.children || []).filter(
    (child: any) => child.type !== 'text' || /\S/.test(child.value || '')
  );
  if (meaningful.length !== 1) return null;
  const child = meaningful[0];
  if (child.type !== 'image' && child.type !== 'imageReference') return null;
  const definition = child.type === 'imageReference' ? definitionFor(child, context) : undefined;
  const url = child.url || definition?.url || '';
  if (!url || url.startsWith('media-id:')) return null;
  const src = safeHref(url);
  if (!src) return null;
  return { src, alt: child.alt || '', credit: child.title || definition?.title || '' };
}

function renderRoot(tree: any, context: RenderContext): React.ReactNode[] {
  const rendered: React.ReactNode[] = [];
  let pendingMedia: MediaDescriptor[] = [];

  const flushMedia = () => {
    if (!pendingMedia.length) return;
    const items = pendingMedia;
    pendingMedia = [];
    const settled = items[0].start < context.settledBefore;
    rendered.push(
      <MediaGallery
        key={'media-' + items[0].start}
        items={items}
        mediaItems={context.mediaItems}
        settled={settled}
        revealTiming={nextRevealBlockTiming(context, settled)}
      />
    );
  };

  (tree.children || []).forEach((node: any, index: number) => {
    if (node.type === 'definition' || node.type === 'footnoteDefinition') return;
    const inlineImage = standaloneInlineImage(node, context);
    if (inlineImage) {
      flushMedia();
      rendered.push(
        <GeminiSingleImage
          key={'inline-image-' + offsetOf(node, index)}
          src={inlineImage.src}
          alt={inlineImage.alt}
          caption={inlineImage.alt}
          captionSource={inlineImage.credit}
        />
      );
      return;
    }
    const media = standaloneMedia(node, context);
    if (media) {
      pendingMedia.push(...media);
      return;
    }
    flushMedia();
    rendered.push(renderBlockNode(node, context, index));
  });

  flushMedia();
  const footnotes = renderFootnotes(tree, context);
  if (footnotes) rendered.push(footnotes);
  return rendered;
}

const TICK = String.fromCharCode(96);
const FENCE = TICK.repeat(3);

function occurrences(value: string, token: string): number {
  return value.split(token).length - 1;
}

function isEscapedAt(source: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

const CURRENCY_AMOUNT = /^[+-]?(?:(?:\d{1,3}(?:,\d{3})+)|\d+)(?:\.\d+)?(?:[kKmMbB])?/;
const CURRENCY_RATE_UNIT = /^\/(?:seconds?|minutes?|hours?|days?|weeks?|months?|quarters?|years?|secs?|mins?|hrs?|wks?|mos?|qtrs?|yrs?)\b/i;

function isCurrencyDollar(source: string, index: number): boolean {
  if (source[index] !== '$' || isEscapedAt(source, index) || source[index + 1] === '$') return false;

  // A currency marker starts at a textual boundary. This prevents a closing
  // math delimiter such as the second "$" in "$x$" from being reclassified.
  const previous = source[index - 1] || '';
  if (previous && /[A-Za-z0-9_$)\]}]/.test(previous)) return false;

  const amount = source.slice(index + 1).match(CURRENCY_AMOUNT)?.[0];
  if (!amount) return false;

  const amountEnd = index + 1 + amount.length;
  const immediate = source[amountEnd] || '';
  if (immediate === '$') return false;

  const rate = source.slice(amountEnd).match(CURRENCY_RATE_UNIT)?.[0];
  if (rate) return source[amountEnd + rate.length] !== '$';

  if (!immediate || /[,.;:!?)\]}]/.test(immediate)) return true;
  if (source.startsWith('**', amountEnd) || source.startsWith('__', amountEnd) || source.startsWith('~~', amountEnd)) {
    return true;
  }

  if (/\s/.test(immediate)) {
    let cursor = amountEnd;
    while (/\s/.test(source[cursor] || '')) cursor += 1;
    const next = source[cursor] || '';
    if (!next) return true;

    const spacedRate = source.slice(cursor).match(CURRENCY_RATE_UNIT)?.[0];
    if (spacedRate) return source[cursor + spacedRate.length] !== '$';

    // Operators and TeX commands identify numeric math such as "$3 + 4$".
    if (/[+\-=*^_]/.test(next) || next === '\\' || next === '$') return false;
    if (next === '/' && !spacedRate) return false;
    return true;
  }

  // A directly adjacent variable is math (for example "$2x$"). Currency
  // suffixes were consumed by CURRENCY_AMOUNT above.
  return false;
}

function mathDollarDelimiterCounts(source: string): { display: number; inline: number } {
  let display = 0;
  let inline = 0;

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== '$' || isEscapedAt(source, index) || isCurrencyDollar(source, index)) continue;
    if (source[index + 1] === '$' && !isEscapedAt(source, index + 1)) {
      display += 1;
      index += 1;
    } else {
      inline += 1;
    }
  }

  return { display, inline };
}

function hasDanglingAsterisk(source: string): boolean {
  let open = false;

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== '*' || isEscapedAt(source, index)) continue;

    const previous = source[index - 1] || '';
    const next = source[index + 1] || '';
    const canOpen = !!next && !/\s/.test(next);
    const canClose = !!previous && !/\s/.test(previous);

    if (open && canClose) open = false;
    else if (canOpen) open = true;
  }

  return open;
}

function closeDangling(source: string): string {
  if (!source) return source;
  if (occurrences(source, FENCE) % 2 === 1) return source;

  const tail = source.slice(source.lastIndexOf('\n') + 1);
  let suffix = '';
  if (occurrences(tail, TICK) % 2 === 1) suffix += TICK;

  const withoutCode = tail.replace(new RegExp(TICK + '[^' + TICK + ']*' + TICK, 'g'), '');
  if (occurrences(withoutCode, '**') % 2 === 1) suffix += '**';
  if (occurrences(withoutCode, '__') % 2 === 1) suffix += '__';

  const withoutStrong = withoutCode.replace(/\*\*/g, '').replace(/__/g, '');
  if (hasDanglingAsterisk(withoutStrong)) suffix += '*';
  if (occurrences(withoutStrong, '_') % 2 === 1) suffix += '_';
  if (occurrences(withoutCode, '~~') % 2 === 1) suffix += '~~';

  const dollarDelimiters = mathDollarDelimiterCounts(withoutCode);
  if (dollarDelimiters.display % 2 === 1) suffix += '$$';
  else if (dollarDelimiters.inline % 2 === 1) suffix += '$';

  return suffix ? source + suffix : source;
}

interface NormalizedMathSource {
  source: string;
  boundaries: number[];
}

function normalizeLatexDelimiters(source: string): NormalizedMathSource {
  let normalized = '';
  const boundaries = [0];
  let codeDelimiter = 0;

  const append = (value: string, consumedFrom: number, consumedTo: number) => {
    for (let index = 0; index < value.length; index += 1) {
      normalized += value[index];
      const progress = (index + 1) / value.length;
      boundaries.push(Math.round(consumedFrom + (consumedTo - consumedFrom) * progress));
    }
  };

  for (let index = 0; index < source.length;) {
    if (source[index] === '`') {
      let run = 1;
      while (source[index + run] === '`') run += 1;
      if (codeDelimiter === 0) codeDelimiter = run;
      else if (codeDelimiter === run) codeDelimiter = 0;
      append(source.slice(index, index + run), index, index + run);
      index += run;
      continue;
    }

    const escapedByBackslash = isEscapedAt(source, index);
    if (codeDelimiter === 0 && source[index] === '$' && isCurrencyDollar(source, index)) {
      append('\\', index, index);
      append('$', index, index + 1);
      index += 1;
      continue;
    }
    if (
      codeDelimiter === 0 &&
      !escapedByBackslash &&
      source[index] === '\\' &&
      (source[index + 1] === '(' || source[index + 1] === ')')
    ) {
      append('$', index, index + 2);
      index += 2;
      continue;
    }
    if (
      codeDelimiter === 0 &&
      !escapedByBackslash &&
      source[index] === '\\' &&
      (source[index + 1] === '[' || source[index + 1] === ']')
    ) {
      append('$$', index, index + 2);
      index += 2;
      continue;
    }

    append(source[index], index, index + 1);
    index += 1;
  }

  return { source: normalized, boundaries };
}

function remapTreeOffsets(node: any, boundaries: number[], sourceLength: number): void {
  const mapOffset = (offset: unknown) => {
    if (typeof offset !== 'number') return offset;
    const bounded = Math.max(0, Math.min(boundaries.length - 1, offset));
    return Math.min(sourceLength, boundaries[bounded] ?? sourceLength);
  };

  if (node?.position?.start) node.position.start.offset = mapOffset(node.position.start.offset);
  if (node?.position?.end) node.position.end.offset = mapOffset(node.position.end.offset);
  for (const child of node?.children || []) remapTreeOffsets(child, boundaries, sourceLength);
}

const MARKDOWN_PROCESSOR = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .freeze();

export interface StreamingMarkdownProps {
  text: string;
  isStreaming: boolean;
  animate?: boolean;
  /**
   * Pace incoming text through a pending queue before it becomes visible.
   * Defaults to the live streaming animation state. It can also be enabled for
   * a newly-created, hard-coded assistant message such as an inline error.
   */
  reveal?: boolean;
  /** Reveal the complete source in one animated chunk instead of pacing sentences. */
  revealAsSingleChunk?: boolean;
  /** Fires after the pending reveal and its final fade have both finished. */
  onRevealComplete?: () => void;
  className?: string;
  mediaItems?: any[];
  onOpenResource?: (resource: RichResource) => void;
  /** Grounded web sources indexed against `text`, rendered as inline chips. */
  citations?: SourceCitations;
}

export const StreamingMarkdown: React.FC<StreamingMarkdownProps> = React.memo(
  function StreamingMarkdown({
    text,
    isStreaming,
    animate = true,
    reveal,
    revealAsSingleChunk = false,
    onRevealComplete,
    className = '',
    mediaItems,
    onOpenResource,
    citations,
  }) {
    useInjectStyles();

    const [prefersReducedMotion, setPrefersReducedMotion] = useState(() =>
      typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
    useEffect(() => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
      const query = window.matchMedia('(prefers-reduced-motion: reduce)');
      const update = () => setPrefersReducedMotion(query.matches);
      update();
      query.addEventListener('change', update);
      return () => query.removeEventListener('change', update);
    }, []);

    const revealRequested = !prefersReducedMotion && (reveal ?? (animate && isStreaming));
    const [shown, setShown] = useState(() => initialStreamingReveal(
      text,
      revealRequested && !revealAsSingleChunk,
    ));
    const [revealActive, setRevealActive] = useState(revealRequested);
    const previousText = useRef(text);
    const previousRequest = useRef(revealRequested);
    const latestText = useRef(text);
    const revealTimer = useRef<number | null>(null);
    latestText.current = text;

    useLayoutEffect(() => {
      const sourceChanged = previousText.current !== text;
      const requestStarted = !previousRequest.current && revealRequested;
      previousText.current = text;
      previousRequest.current = revealRequested;

      if (prefersReducedMotion) {
        setShown(text);
        setRevealActive(false);
        return;
      }

      if (revealAsSingleChunk && revealRequested) {
        setShown(text);
        setRevealActive(false);
        return;
      }

      // A live stream stays armed even when it momentarily catches up, ready to
      // pace the next provider delta. A non-streaming reveal (an inline error)
      // starts only once for that source and switches itself off after draining.
      if (revealRequested && (isStreaming || sourceChanged || requestStarted)) {
        setRevealActive(true);
      }

      setShown((current) => reconcileStreamingReveal(
        current,
        text,
        revealActive || revealRequested,
      ));
    }, [isStreaming, prefersReducedMotion, revealActive, revealAsSingleChunk, revealRequested, text]);

    // The ref means "a promotion is already scheduled", and the guard below
    // trusts it. So clearing the timer MUST clear the ref: StrictMode runs this
    // cleanup between the two dev mount passes, and leaving a stale handle here
    // left the guard convinced a timer was pending that had just been cancelled
    // — no promotion was ever scheduled again, so every response froze at its
    // first chunk with `revealActive` stuck on.
    useEffect(() => () => {
      if (revealTimer.current !== null) {
        window.clearTimeout(revealTimer.current);
        revealTimer.current = null;
      }
    }, []);

    useEffect(() => {
      if (!revealActive) {
        if (revealTimer.current !== null) {
          window.clearTimeout(revealTimer.current);
          revealTimer.current = null;
        }
        return;
      }
      if (shown === text) {
        if (!isStreaming) setRevealActive(false);
        return;
      }
      // Provider deltas often arrive faster than the visual cadence. Keep an
      // already-scheduled promotion anchored instead of restarting its delay on
      // every token, which could otherwise starve the reveal until generation
      // stops completely.
      if (revealTimer.current !== null) return;

      revealTimer.current = window.setTimeout(() => {
        revealTimer.current = null;
        setShown((current) => {
          const source = latestText.current;
          const reconciled = reconcileStreamingReveal(current, source, true);
          if (reconciled !== current) return reconciled;
          const nextLength = nextStreamingRevealLength(source, current.length);
          return source.slice(0, nextLength);
        });
      }, nextStreamingRevealDelayMs(text, shown.length));
    }, [isStreaming, revealActive, shown, text]);

    const effectiveStreaming = isStreaming || revealActive;
    const shouldAnimateStream = (animate && isStreaming) || revealActive;
    const [keepTailAnimation, setKeepTailAnimation] = useState(shouldAnimateStream);

    useEffect(() => {
      if (shouldAnimateStream) {
        if (!keepTailAnimation) setKeepTailAnimation(true);
        return;
      }
      if (!keepTailAnimation) return;
      const timeoutId = window.setTimeout(
        () => setKeepTailAnimation(false),
        geminiRevealTailMs(text),
      );
      return () => window.clearTimeout(timeoutId);
    }, [keepTailAnimation, shouldAnimateStream, text]);

    const animationEnabled = shouldAnimateStream || keepTailAnimation;
    const revealCompletionSent = useRef(false);
    useEffect(() => {
      if (animationEnabled) {
        revealCompletionSent.current = false;
        return;
      }
      if (revealCompletionSent.current) return;
      revealCompletionSent.current = true;
      onRevealComplete?.();
    }, [animationEnabled, onRevealComplete]);

    const tree = useMemo(() => {
      try {
        const closed = effectiveStreaming ? closeDangling(shown) : shown;
        const normalized = normalizeLatexDelimiters(closed);
        const parsed = MARKDOWN_PROCESSOR.parse(normalized.source) as any;
        remapTreeOffsets(parsed, normalized.boundaries, shown.length);
        return parsed;
      } catch {
        return {
          type: 'root',
          children: [{
            type: 'paragraph',
            children: [{ type: 'text', value: shown, position: { start: { offset: 0 } } }],
            position: { start: { offset: 0 } },
          }],
        };
      }
    }, [effectiveStreaming, shown]);

    const committedLength = useRef(0);
    useEffect(() => {
      committedLength.current = shown.length;
    }, [shown]);
    const settledBefore = committedLength.current;

    const definitions = useMemo(() => collectDefinitions(tree), [tree]);
    const footnoteNumbers = useMemo(() => collectFootnoteNumbers(tree), [tree]);
    // Chips only appear once the turn is complete: the citation offsets describe
    // the finished answer, and Gemini likewise shows none while text streams.
    const chipGroups = useMemo(
      () => (effectiveStreaming ? [] : buildChipGroups(citations)),
      [effectiveStreaming, citations],
    );
    const context: RenderContext = {
      source: shown,
      settledBefore,
      mediaItems,
      onOpenResource,
      definitions,
      footnoteNumbers,
      variant: 'w',
      weight: ROOT_TYPOGRAPHY.weight,
      width: ROOT_TYPOGRAPHY.width,
      roundness: ROOT_TYPOGRAPHY.roundness,
      chipGroups,
      animating: animationEnabled,
      revealBlockTimings: geminiBlockRevealTimings(text),
      revealBlockOrder: { next: 0 },
      // Fresh each render, so ordinals are recomputed from zero in document order
      // and stay stable for a given tree instead of drifting upward on re-render.
      chipOrder: { next: 0 },
    };
    const rendered = renderRoot(tree, context);

    return (
      <div
        className={
          'smd-root ' +
          (animationEnabled ? 'smd-streaming ' : 'smd-static ') +
          className
        }
        data-streaming={animationEnabled ? 'true' : undefined}
        style={{ fontVariationSettings: ROOT_VARIATION }}
      >
        {rendered}
      </div>
    );
  }
);

export default StreamingMarkdown;
