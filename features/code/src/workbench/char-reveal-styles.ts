/**
 * Installs the keyframes behind the transcript's word-by-word reveal.
 *
 * Injected once per document and keyed by element id, because re-inserting the
 * stylesheet would restart every in-flight .char-reveal animation mid-stream.
 *
 * The curve is Chat mode's, so a reply reads the same in both tabs: a plain
 * opacity fade over `--animation-duration` on `--fade-animation-function`, and
 * nothing else. See `smd-fade-in-text` in platform/ui/src/streaming-markdown-styles.ts
 * -- no translate, no scale, no blur. Those three read as a word physically
 * arriving, which is a second motion on top of the scroll that Chat never has.
 *
 * No `display` declaration either, for the same reason: Chat's `.smd-w` is a plain
 * inline span, and an inline-block word cannot be broken across a line the way an
 * inline one can, so mid-stream reflow lands differently. Opacity animates fine on
 * an inline box -- `inline-block` was only ever needed by the transform-based
 * reveal this replaced.
 */
export const injectCharRevealStyles = (): void => {
  const styleId = 'char-reveal-animation-styles';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
        @keyframes reveal {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .char-reveal {
          --animation-duration: 400ms;
          --fade-animation-function: ease-out;
          animation-duration: var(--animation-duration);
          animation-fill-mode: forwards;
          animation-iteration-count: 1;
          animation-name: reveal;
          animation-timing-function: var(--fade-animation-function);
          opacity: 0;
        }
        @media (prefers-reduced-motion: reduce) {
          .char-reveal { animation: none !important; opacity: 1; }
        }
      `;
    document.head.appendChild(style);
  }
};
