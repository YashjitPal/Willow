import React from 'react';

export const CanvasIcon = ({ className, size = 24 }: { className?: string, size?: number | string }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    viewBox="0 0 24 24" 
    width={size} 
    height={size}
    className={className}
    stroke="currentColor" 
    strokeWidth="1.75" 
    strokeLinecap="round" 
    strokeLinejoin="round"
    fill="none"
  >
    {/* Ultra-minimal, professional 'Artboard' / 'Canvas' symbol */}
    {/* Clean center square */}
    <rect x="6" y="6" width="12" height="12" rx="1" />
    
    {/* Extending crop marks representing the infinite canvas */}
    <path d="M 6 2 L 6 6" />
    <path d="M 6 18 L 6 22" />
    <path d="M 18 2 L 18 6" />
    <path d="M 18 18 L 18 22" />
    
    <path d="M 2 6 L 6 6" />
    <path d="M 18 6 L 22 6" />
    <path d="M 2 18 L 6 18" />
    <path d="M 18 18 L 22 18" />
  </svg>
);
