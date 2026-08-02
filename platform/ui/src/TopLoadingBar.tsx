import React from 'react';

interface TopLoadingBarProps {
  active: boolean;
  leftOffset?: number;
}

export const TopLoadingBar: React.FC<TopLoadingBarProps> = ({ active, leftOffset = 0 }) => {
  const [visible, setVisible] = React.useState(false);
  const [progress, setProgress] = React.useState(0.06);
  const [cycle, setCycle] = React.useState(0);

  React.useEffect(() => {
    let leadFrame = 0;
    let progressFrame = 0;
    let trickleTimer: number | undefined;
    let completionTimer: number | undefined;

    if (active) {
      setCycle((current) => current + 1);
      setVisible(true);
      setProgress(0.06);
      leadFrame = window.requestAnimationFrame(() => {
        progressFrame = window.requestAnimationFrame(() => setProgress(0.72));
      });
      trickleTimer = window.setInterval(() => {
        setProgress((current) => Math.min(0.92, current + (0.92 - current) * 0.14));
      }, 420);
    } else {
      setProgress(1);
      completionTimer = window.setTimeout(() => setVisible(false), 180);
    }

    return () => {
      window.cancelAnimationFrame(leadFrame);
      window.cancelAnimationFrame(progressFrame);
      if (trickleTimer) window.clearInterval(trickleTimer);
      if (completionTimer) window.clearTimeout(completionTimer);
    };
  }, [active]);

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none fixed right-0 top-0 z-[3000] h-[2px] overflow-hidden ${visible ? 'opacity-100' : 'opacity-0'}`}
      style={{
        left: `${leftOffset}px`,
        transition: 'left 280ms cubic-bezier(0.32, 0.72, 0, 1), opacity 150ms ease',
      }}
    >
      <div
        key={cycle}
        className="h-full w-full origin-left bg-[#4a7c59] shadow-[0_0_8px_rgba(74,124,89,0.85)] motion-reduce:transition-none"
        style={{
          transform: `scaleX(${progress})`,
          transition: progress === 1
            ? 'transform 180ms ease-out'
            : 'transform 720ms cubic-bezier(0.2, 0.75, 0.3, 1)',
        }}
      />
    </div>
  );
};

export default TopLoadingBar;
