import React from 'react';

export const AgentIcon = ({ className, size = 24 }: { className?: string, size?: number | string }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    viewBox="10 18 88 88" 
    width={size} 
    height={size}
    className={className}
    stroke="currentColor" 
    strokeWidth="8" 
    strokeLinecap="round" 
    strokeLinejoin="round"
    fill="none"
  >
    <g transform="rotate(45 60 60)">
      <path d="M 52.5 27 Q 60 14 67.5 27 L 90 66 Q 60 46 30 66 Z" />
      <line x1="60" y1="76" x2="60" y2="106" />
      <line x1="42" y1="80" x2="42" y2="100" />
      <line x1="78" y1="80" x2="78" y2="100" />
    </g>
  </svg>
);
