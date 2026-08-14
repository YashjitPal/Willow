import React from 'react';

interface TopLoadingBarProps {
  active: boolean;
  leftOffset?: number;
  workspaceColor?: string;
}

/**
 * Transform from background glow accent to top horizontal loadbar color in OKLCh space.
 * Derived from the baseline pair:
 *   Blue Background Glow (#14204f) -> Material Blue Loadbar (#a8c7fa).
 *
 * Lightness shift (additive): +0.5605 (L_bar = L_glow + 0.56049)
 * Chroma multiplier:          ~0.9075 (C_bar = C_glow * 0.907467)
 * Hue shift:                  -8.5897° (h_bar = h_glow - 8.589695°)
 */
export const GLOW_TO_LOADBAR_TRANSFORM = {
  lightnessDelta: 0.5604911382198095,
  chromaRatio: 0.9074670591087199,
  hueShiftDeg: -8.589695401377128,
} as const;

export const TOP_LOADING_BAR_COLORS = {
  blue: { bar: '#a8c7fa', shadow: 'rgba(168,199,250,0.85)' },
  pink: { bar: '#fab2cd', shadow: 'rgba(250,178,205,0.85)' },
  yellow: { bar: '#efdbae', shadow: 'rgba(239,219,174,0.85)' },
  orange: { bar: '#f6c5ac', shadow: 'rgba(246,197,172,0.85)' },
  green: { bar: '#4a7c59', shadow: 'rgba(74,124,89,0.85)' },
} as const;

const getLoadingBarColorClass = (color?: string) => {
  switch (color) {
    case 'blue':
      return 'bg-[#a8c7fa] shadow-[0_0_8px_rgba(168,199,250,0.85)]';
    case 'pink':
      return 'bg-[#fab2cd] shadow-[0_0_8px_rgba(250,178,205,0.85)]';
    case 'yellow':
      return 'bg-[#efdbae] shadow-[0_0_8px_rgba(239,219,174,0.85)]';
    case 'orange':
      return 'bg-[#f6c5ac] shadow-[0_0_8px_rgba(246,197,172,0.85)]';
    case 'green':
    default:
      return 'bg-[#4a7c59] shadow-[0_0_8px_rgba(74,124,89,0.85)]';
  }
};

export const TopLoadingBar: React.FC<TopLoadingBarProps> = ({ active, leftOffset = 0, workspaceColor }) => {
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
        className={`h-full w-full origin-left ${getLoadingBarColorClass(workspaceColor)} motion-reduce:transition-none`}
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
