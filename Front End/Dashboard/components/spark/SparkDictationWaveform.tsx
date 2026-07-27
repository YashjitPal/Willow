import React from 'react';
import './SparkDictationWaveform.css';

export interface SparkDictationWaveformProps {
  className?: string;
}

const DICTATION_WAVE_BARS = Array.from({ length: 72 }, (_, index) => {
  const distance = Math.abs(index - 35.5) / 35.5;
  return {
    scale: 1.1 + (1 - distance) * 3.2 + ((index * 17) % 7) * 0.18,
    delay: -((index * 37) % 760),
    duration: 720 + ((index * 53) % 360),
  };
});

export const SparkDictationWaveform: React.FC<SparkDictationWaveformProps> = ({
  className = '',
}) => (
  <div
    className={`spark-dictation-waveform ${className}`.trim()}
    aria-hidden="true"
  >
    {DICTATION_WAVE_BARS.map((bar, index) => (
      <span
        key={index}
        className="spark-dictation-waveform__bar"
        style={{
          '--wave-scale': bar.scale,
          animationDelay: `${bar.delay}ms`,
          animationDuration: `${bar.duration}ms`,
        } as React.CSSProperties}
      />
    ))}
  </div>
);

