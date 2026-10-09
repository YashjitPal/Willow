import clsx from "clsx";

const css = { fillOnMount: "_fillOnMount_77ve5_1" } as const;

const pathLength = 100;

export interface ProgressRingProps {
  percent: number;
  className?: string;
  progressClassName?: string;
  /** Plays the fill animation from empty when the ring mounts. */
  animateOnMount?: boolean;
  animateOnMountDelayMs?: number;
  reducedMotion?: boolean;
  size?: number;
  strokeWidth?: number;
  transitionDurationMs?: number;
}

const clampPercent = (percent: number) => (!Number.isFinite(percent) || percent < 0 ? 0 : percent > pathLength ? pathLength : percent);

/** `OS` (app-shared `$xi`): circular progress indicator drawn in `currentColor` over a faint track. */
export function ProgressRing({
  percent,
  className,
  progressClassName,
  animateOnMount = false,
  animateOnMountDelayMs = 0,
  reducedMotion = false,
  size = 12,
  strokeWidth = 2,
  transitionDurationMs = 120,
}: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const progress = clampPercent(percent);
  const fillOnMount = animateOnMount && !reducedMotion;
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={clsx("shrink-0", className)}>
      <circle cx={size / 2} cy={size / 2} r={radius} stroke="currentColor" strokeWidth={strokeWidth} fill="none" opacity={0.16} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="currentColor"
        strokeWidth={strokeWidth}
        opacity={progress === 0 ? 0 : 1}
        strokeLinecap="round"
        fill="none"
        pathLength={pathLength}
        strokeDasharray={pathLength}
        strokeDashoffset={pathLength - progress}
        className={clsx(progressClassName, fillOnMount && css.fillOnMount)}
        style={{
          animationDelay: fillOnMount ? `${animateOnMountDelayMs}ms` : undefined,
          transition: reducedMotion ? "none" : `stroke-dashoffset ${transitionDurationMs}ms ease-out, opacity ${transitionDurationMs}ms ease-out`,
        }}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}
