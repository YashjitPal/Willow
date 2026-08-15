// The "Show code" panel: the code the model ran and what the sandbox printed.
//
// Structure and timings are a transcription of Gemini's `code-block` +
// `codeBlockRevealAnimation`, captured over CDP. Two details are load-bearing and
// look like mistakes if you only read the code:
//
//  1. The reveal wrapper is `overflow: visible`. Nothing clips the content while
//     the height grows — what hides it is the fade's opacity sitting at 0 for the
//     first half of its 800ms. Clipping instead would chisel the panel's 40px
//     corners (see MARKDOWN_BLOCK_BLEED_PX).
//  2. The wrapper's resting expanded state carries no inline height at all, so the
//     panel can grow when `output` arrives after `code`. Height is inline only
//     while an animation is in flight.
//
// The inner chrome reuses the markdown code block's classes, because Gemini
// reuses that same component here.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MaterialSymbol } from './MaterialSymbol';
import {
  codeFileExtension,
  copyToClipboard,
  displayLanguage,
  downloadText,
  highlightLanguage,
  highlightedCode,
} from './StreamingMarkdown';
import { useInjectStyles } from './streaming-markdown-styles';

/**
 * Reveal timings.
 *
 * Deliberately *not* Gemini's. Gemini animates margin (300ms) and height (400ms)
 * on the wrapper while holding the content at opacity 0 for the first 400ms of an
 * 800ms fade, so the panel spends half a second as an empty growing box before
 * anything readable appears — and it needs that hold, because its wrapper is
 * `overflow: visible` and the content would otherwise spill out of a 0-height box.
 *
 * Clipping the wrapper instead frees the content to fade in *while* the box
 * grows, which reads as immediate. Height is the only geometry that animates, so
 * the measured target cannot drift mid-flight.
 */
const EXPAND_HEIGHT_MS = 340;
const EXPAND_FADE_MS = 280;
const EXPAND_FADE_DELAY_MS = 60;
const COLLAPSE_HEIGHT_MS = 260;
const COLLAPSE_HEIGHT_DELAY_MS = 40;
const COLLAPSE_FADE_MS = 160;
/** Decelerating, for things coming in. */
const EASE_OUT = 'cubic-bezier(0.2, 0, 0, 1)';
/** Accelerating, for things leaving. */
const EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)';

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface CodeExecutionPanelProps {
  language: string;
  code: string;
  /** Absent while the sandbox is still running: the output section is omitted. */
  output?: string;
  /** Whether the response-level toggle currently has code shown. */
  open: boolean;
}

export const CodeExecutionPanel: React.FC<CodeExecutionPanelProps> = ({
  language,
  code,
  output,
  open,
}) => {
  useInjectStyles();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const fadeRef = useRef<HTMLDivElement | null>(null);
  const runningRef = useRef<Animation[]>([]);
  // Nothing should animate on first paint: a turn loaded from disk, or one whose
  // panel mounts already open, must simply be in its resting state.
  const openAtMount = useRef(open).current;
  const previousOpen = useRef(open);
  const [copied, setCopied] = useState(false);

  const source = useMemo(() => code.replace(/\n$/, ''), [code]);
  const html = useMemo(() => highlightedCode(source, language), [language, source]);
  const normalized = highlightLanguage(language);

  const handleCopy = useCallback(async () => {
    await copyToClipboard(source);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }, [source]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const fade = fadeRef.current;
    if (!wrapper || !fade) return;
    if (previousOpen.current === open) return;
    previousOpen.current = open;

    // A rapid re-toggle must not leave the previous run's `fill: both` values
    // pinned to the element, so in-flight animations are dropped first.
    runningRef.current.forEach((animation) => { try { animation.cancel(); } catch { /* */ } });
    runningRef.current = [];

    const settle = () => {
      wrapper.classList.toggle('is-open', open);
      wrapper.style.removeProperty('height');
      wrapper.style.removeProperty('display');
      fade.style.removeProperty('opacity');
      fade.style.removeProperty('transform');
    };

    if (prefersReducedMotion()) {
      settle();
      return;
    }

    const track = (animations: Animation[]) => {
      runningRef.current = animations;
      Promise.all(animations.map((animation) => animation.finished))
        .then(settle)
        .catch(() => { /* cancelled by a re-toggle; the new run owns the settle */ });
    };

    if (open) {
      // Measured with the final width already in force. Width never changes
      // during the animation (no margin animation), so this stays exact.
      wrapper.style.display = 'block';
      wrapper.style.height = 'auto';
      const target = wrapper.offsetHeight;
      wrapper.style.height = '0px';

      track([
        wrapper.animate(
          [{ height: '0px' }, { height: `${target}px` }],
          { duration: EXPAND_HEIGHT_MS, easing: EASE_OUT, fill: 'both' },
        ),
        fade.animate(
          [
            { opacity: 0, transform: 'translateY(-6px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ],
          {
            duration: EXPAND_FADE_MS,
            delay: EXPAND_FADE_DELAY_MS,
            easing: EASE_OUT,
            fill: 'both',
          },
        ),
      ]);
      return;
    }

    // Content leaves first, then the box closes behind it.
    const current = wrapper.offsetHeight;
    track([
      fade.animate(
        [
          { opacity: 1, transform: 'translateY(0)' },
          { opacity: 0, transform: 'translateY(-4px)' },
        ],
        { duration: COLLAPSE_FADE_MS, easing: EASE_IN, fill: 'both' },
      ),
      wrapper.animate(
        [{ height: `${current}px` }, { height: '0px' }],
        {
          duration: COLLAPSE_HEIGHT_MS,
          delay: COLLAPSE_HEIGHT_DELAY_MS,
          easing: EASE_IN,
          fill: 'both',
        },
      ),
    ]);
  }, [open]);

  return (
    <div
      ref={wrapperRef}
      className={'smd-code-exec-reveal' + (openAtMount ? ' is-open' : '')}
      aria-hidden={!open}
    >
      <div className="smd-code-exec-panel">
        <div ref={fadeRef} className="smd-code-exec-fade">
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
                tabIndex={open ? undefined : -1}
                onClick={() => downloadText(
                  'code.' + codeFileExtension(language),
                  source,
                  'text/plain;charset=utf-8',
                )}
              >
                <MaterialSymbol family="luminous" name="arrow_circle_down" size={24} weight={300} roundness={100} />
              </button>
              <button
                type="button"
                className="smd-icon-button"
                aria-label={copied ? 'Code copied' : 'Copy code'}
                title={copied ? 'Copied' : 'Copy code'}
                tabIndex={open ? undefined : -1}
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
          <div className="smd-code-exec-code smd-code-scroll smd-scroll">
            <pre className="smd-code-pre">
              <code
                className={'hljs' + (normalized ? ' language-' + normalized : '')}
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </pre>
          </div>
          {output !== undefined && (
            <>
              <div className="smd-code-exec-output-header">
                <span>Code output</span>
              </div>
              <hr className="smd-code-exec-divider" />
              <div className="smd-code-exec-output smd-code-scroll smd-scroll">
                <pre className="smd-code-pre">
                  <code>{output}</code>
                </pre>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
