import React from 'react';
import './SparkDictationWaveform.css';

export interface SparkDictationWaveformProps {
  className?: string;
}

export const SparkDictationWaveform: React.FC<SparkDictationWaveformProps> = () => null;

export const SparkMicPulseOverlay: React.FC = () => (
  <div className="spark-mic-pulse-overlay" aria-hidden="true">
    <div className="spark-mic-pulse"></div>
    <div className="spark-mic-blue-circle"></div>
  </div>
);
