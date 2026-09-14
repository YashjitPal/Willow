import React from 'react';
import './flow-loading-page.css';

export interface FlowLoadingPageProps {
  className?: string;
  isFadingOut?: boolean;
  onFadedOut?: () => void;
  disclaimer?: string;
}

const LETTERS = ['L', 'o', 'a', 'd', 'i', 'n', 'g', '...'];
const CYCLE_DURATION_MS = 1600;

const getGlobalAnimationTime = (): number => {
  if (typeof window === 'undefined') return 0;
  if (typeof document !== 'undefined' && document.timeline?.currentTime != null) {
    return Number(document.timeline.currentTime);
  }
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
};

export const FlowLoadingPage: React.FC<FlowLoadingPageProps> = ({
  className = '',
  isFadingOut = false,
  onFadedOut,
  disclaimer,
}) => {
  const [cycleOffset] = React.useState(() => {
    const now = getGlobalAnimationTime();
    return ((now % CYCLE_DURATION_MS) + CYCLE_DURATION_MS) % CYCLE_DURATION_MS;
  });

  const fadedOutRef = React.useRef(false);

  const handleFadedOut = React.useCallback(() => {
    if (fadedOutRef.current) return;
    fadedOutRef.current = true;
    onFadedOut?.();
  }, [onFadedOut]);

  const handleAnimationEnd = (e: React.AnimationEvent<HTMLDivElement>) => {
    if (e.animationName === 'willow-flow-fade-out') {
      handleFadedOut();
    }
  };

  // Safety timer in case onAnimationEnd is throttled in background tabs
  React.useEffect(() => {
    if (!isFadingOut) return;
    const timer = window.setTimeout(() => {
      handleFadedOut();
    }, 600);
    return () => window.clearTimeout(timer);
  }, [isFadingOut, handleFadedOut]);

  return (
    <div
      className={`flow-loading-host ${isFadingOut ? 'loading-page-fade-out' : ''} ${className}`.trim()}
      onAnimationEnd={handleAnimationEnd}
      role="status"
      aria-label="Loading..."
    >
      <div className="flow-loading-text-container">
        {LETTERS.map((letter, index) => {
          const baseDelay = index * 100;
          const phase = ((cycleOffset - baseDelay) % CYCLE_DURATION_MS + CYCLE_DURATION_MS) % CYCLE_DURATION_MS;
          return (
            <span
              key={index}
              className="flow-loading-letter"
              style={{ '--animation-delay': `${-phase}ms` } as React.CSSProperties}
            >
              {letter}
            </span>
          );
        })}
      </div>
      {disclaimer ? (
        <div className="flow-loading-footer">
          <p className="flow-loading-disclaimer-text">{disclaimer}</p>
        </div>
      ) : null}
    </div>
  );
};

export default FlowLoadingPage;
