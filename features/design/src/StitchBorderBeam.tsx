import React, { useMemo, useState, useEffect } from 'react';

interface StitchBorderBeamProps {
  className?: string;
  borderRadius?: string;
  duration?: number;
  borderThickness?: number;
  borderOpacity?: number;
  gradientCoverage?: number;
  tailSoftness?: number;
  innerGlowBlur?: number;
  innerGlowOpacity?: number;
  innerGlowInset?: number | string;
  outerGlowExtend?: number;
  outerGlowBlur?: number;
  outerGlowBand?: number;
  outerGlowOpacity?: number;
  colors?: [string, string, string, string];
  fadeInDelay?: number;
  fadeInDuration?: number;
}

const DEFAULT_COLORS: [string, string, string, string] = [
  '#9154E7',
  '#6056F0',
  '#40D9C6',
  '#4285F4',
];

export const StitchBorderBeam: React.FC<StitchBorderBeamProps> = ({
  className = '',
  borderRadius = '32px',
  duration = 3.4,
  borderThickness = 1.5,
  borderOpacity = 1,
  gradientCoverage = 25,
  tailSoftness = 10,
  innerGlowBlur = 35,
  innerGlowOpacity = 0.2,
  innerGlowInset = 53,
  outerGlowExtend = 4,
  outerGlowBlur = 6,
  outerGlowBand = 2,
  outerGlowOpacity = 0.8,
  colors = DEFAULT_COLORS,
  fadeInDelay = 2000,
  fadeInDuration = 1800,
}) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setIsVisible(true);
    }, fadeInDelay);
    return () => window.clearTimeout(timer);
  }, [fadeInDelay]);

  const conicGradient = useMemo(() => {
    const tail = tailSoftness;
    const peak = tail + gradientCoverage;
    const end = Math.min(peak + tailSoftness, 100);
    const step = gradientCoverage / colors.length;
    const stops = colors.map((color, idx) => `${color} ${(tail + step * idx).toFixed(1)}%`);
    stops.push(`${colors[0]} ${peak.toFixed(1)}%`);
    return `conic-gradient(from 0deg, transparent 0%, ${stops.join(', ')}, transparent ${end.toFixed(1)}%)`;
  }, [colors, tailSoftness, gradientCoverage]);

  const insetStr = typeof innerGlowInset === 'number' ? `${innerGlowInset}px` : innerGlowInset;

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 z-[5] ${className}`}
      style={{
        borderRadius,
        opacity: isVisible ? 1 : 0,
        transition: `opacity ${fadeInDuration}ms cubic-bezier(0.4, 0, 0.2, 1)`,
      }}
    >
      <style>{`
        @keyframes stitch-aurora-rotate {
          from { transform: translate(-50%, -50%) rotate(0deg); }
          to { transform: translate(-50%, -50%) rotate(360deg); }
        }
      `}</style>

      {/* 1. Inner Glow Layer */}
      {innerGlowOpacity > 0 && (
        <div
          className="absolute inset-0 overflow-hidden"
          style={{
            borderRadius,
            opacity: innerGlowOpacity,
          }}
        >
          <div
            className="absolute inset-0"
            style={{
              WebkitMaskImage: [
                `linear-gradient(to bottom, black, transparent ${insetStr})`,
                `linear-gradient(to top, black, transparent ${insetStr})`,
                `linear-gradient(to right, black, transparent ${insetStr})`,
                `linear-gradient(to left, black, transparent ${insetStr})`,
              ].join(', '),
              maskImage: [
                `linear-gradient(to bottom, black, transparent ${insetStr})`,
                `linear-gradient(to top, black, transparent ${insetStr})`,
                `linear-gradient(to right, black, transparent ${insetStr})`,
                `linear-gradient(to left, black, transparent ${insetStr})`,
              ].join(', '),
              WebkitMaskComposite: 'source-over',
              maskComposite: 'add',
            }}
          >
            <div
              className="absolute"
              style={{
                inset: `-${innerGlowBlur}px`,
                filter: `blur(${innerGlowBlur}px)`,
                willChange: 'transform',
              }}
            >
              <div
                className="absolute"
                style={{
                  width: '150vmax',
                  height: '150vmax',
                  top: '50%',
                  left: '50%',
                  background: conicGradient,
                  animation: `stitch-aurora-rotate ${duration}s linear infinite`,
                  willChange: 'transform',
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* 2. Outer Glow Layer */}
      {outerGlowExtend > 0 && outerGlowOpacity > 0 && (
        <div
          className="absolute"
          style={{
            inset: `-${outerGlowExtend}px`,
            borderRadius: `calc(${borderRadius} + ${outerGlowExtend}px)`,
            filter: `blur(${outerGlowBlur}px)`,
            opacity: outerGlowOpacity,
            willChange: 'transform',
          }}
        >
          <div
            className="absolute inset-0"
            style={{
              borderRadius: 'inherit',
              mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
              WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
              maskComposite: 'exclude',
              WebkitMaskComposite: 'xor',
              padding: `${outerGlowBand}px`,
            }}
          >
            <div
              className="absolute"
              style={{
                width: '150vmax',
                height: '150vmax',
                top: '50%',
                left: '50%',
                background: conicGradient,
                animation: `stitch-aurora-rotate ${duration}s linear infinite`,
                willChange: 'transform',
              }}
            />
          </div>
        </div>
      )}

      {/* 3. Crisp Traveling Snake Border Line */}
      {borderOpacity > 0 && (
        <div
          className="absolute inset-0 overflow-hidden"
          style={{
            borderRadius,
          }}
        >
          <div
            className="absolute inset-0"
            style={{
              borderRadius,
              mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
              WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
              maskComposite: 'exclude',
              WebkitMaskComposite: 'xor',
              padding: `${borderThickness}px`,
            }}
          >
            <div
              className="absolute"
              style={{
                width: '150vmax',
                height: '150vmax',
                top: '50%',
                left: '50%',
                background: conicGradient,
                animation: `stitch-aurora-rotate ${duration}s linear infinite`,
                opacity: borderOpacity,
                willChange: 'transform',
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default StitchBorderBeam;
