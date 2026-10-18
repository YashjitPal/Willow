import React from 'react';

/**
 * Material's indeterminate `mat-spinner`: two half-circle arcs that grow and shrink in clippers
 * while the whole turns, its stroke a tenth of the diameter, in the primary colour.
 */
export const ScheduledSpinner: React.FC<{ size: number; label: string; className?: string }> = ({ size, label, className = '' }) => {
  const stroke = size / 10;
  const radius = (size - 10) / 2;
  const box = radius * 2 + stroke;
  const circumference = 2 * Math.PI * radius;
  const circle = (width: number) => (
    <svg viewBox={`0 0 ${box} ${box}`} focusable="false" aria-hidden="true">
      <circle cx={box / 2} cy={box / 2} r={radius} strokeWidth={width} strokeDasharray={circumference} strokeDashoffset={circumference / 2} />
    </svg>
  );
  return (
    <div role="progressbar" aria-label={label} className={`sched-spinner ${className}`.trim()} style={{ width: size, height: size }}>
      <div className="sched-spinner__container">
        <div className="sched-spinner__layer">
          <div className="sched-spinner__clipper sched-spinner__clipper--left">{circle(stroke * box / size)}</div>
          <div className="sched-spinner__patch">{circle(stroke * box / size * 0.8)}</div>
          <div className="sched-spinner__clipper sched-spinner__clipper--right">{circle(stroke * box / size)}</div>
        </div>
      </div>
    </div>
  );
};
