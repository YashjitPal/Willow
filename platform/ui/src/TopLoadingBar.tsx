import React from 'react';
import { getWorkspaceTheme } from '@willow/core/workspace-theme';

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
  purple: { bar: '#c5b8fa', shadow: 'rgba(197,184,250,0.85)' },
  lilac: { bar: '#dec7fb', shadow: 'rgba(222,199,251,0.85)' },
  coral: { bar: '#ffb1b4', shadow: 'rgba(255,177,180,0.85)' },
  teal: { bar: '#afdbd4', shadow: 'rgba(175,219,212,0.85)' },
} as const;

export const TopLoadingBar: React.FC<TopLoadingBarProps> = ({ active, leftOffset = 0, workspaceColor }) => {
  const [visible, setVisible] = React.useState(false);
  const [progress, setProgress] = React.useState(0.06);
  const [cycle, setCycle] = React.useState(0);
  const theme = getWorkspaceTheme(workspaceColor);

  React.useEffect(() => {
    let leadFrame = 0;
    let progressFrame = 0;
    let trickleTimer: number | undefined;
    let completionTimer: number | undefined;

    if (active) {
      setCycle((current) => current + 1);
      setProgress(0.06);
      setVisible(true);

      const leadSteps = [0.18, 0.32, 0.48];
      let stepIndex = 0;

      const advanceLead = () => {
        if (stepIndex < leadSteps.length) {
          setProgress(leadSteps[stepIndex]);
          stepIndex += 1;
          leadFrame = window.requestAnimationFrame(() => {
            window.setTimeout(advanceLead, 120);
          });
        }
      };

      leadFrame = window.requestAnimationFrame(advanceLead);

      trickleTimer = window.setInterval(() => {
        setProgress((current) => {
          if (current >= 0.88) return current;
          const remaining = 0.88 - current;
          return current + Math.max(0.015, remaining * 0.12);
        });
      }, 260);
    } else if (visible) {
      setProgress(1);
      completionTimer = window.setTimeout(() => {
        setVisible(false);
        progressFrame = window.requestAnimationFrame(() => {
          setProgress(0.06);
        });
      }, 220);
    }

    return () => {
      window.cancelAnimationFrame(leadFrame);
      window.cancelAnimationFrame(progressFrame);
      if (trickleTimer) window.clearInterval(trickleTimer);
      if (completionTimer) window.clearTimeout(completionTimer);
    };
  }, [active, visible]);

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
        className="h-full w-full origin-left motion-reduce:transition-none"
        style={{
          transform: `scaleX(${progress})`,
          backgroundColor: theme.loadbar.hex,
          boxShadow: `0 0 8px ${theme.loadbar.shadow}`,
          transition: progress === 1
            ? 'transform 180ms ease-out'
            : 'transform 720ms cubic-bezier(0.2, 0.75, 0.3, 1)',
        }}
      />
    </div>
  );
};

export default TopLoadingBar;
