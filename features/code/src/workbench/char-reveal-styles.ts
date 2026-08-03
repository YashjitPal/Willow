/**
 * Installs the keyframes behind the transcript's word-by-word reveal.
 *
 * Injected once per document and keyed by element id, because re-inserting the
 * stylesheet would restart every in-flight .char-reveal animation mid-stream.
 */
export const injectCharRevealStyles = (): void => {
  const styleId = 'char-reveal-animation-styles';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
        @keyframes reveal {
          0% { opacity: 0; transform: translateY(10px) scale(0.95); filter: blur(10px); }
          100% { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
        }
        .char-reveal {
          display: inline-block;
          animation: reveal 0.4s cubic-bezier(0.2, 0.65, 0.3, 0.9) forwards;
          opacity: 0;
        }
      `;
    document.head.appendChild(style);
  }
};
