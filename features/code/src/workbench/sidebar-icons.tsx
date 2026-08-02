// Hand-drawn SVG icons for the Workbench sidebar's visual-edit controls.
//
// Inline SVGs rather than lucide-react imports: the spacing glyphs (margin and
// padding on each edge) need the exact box-and-arrow shapes the visual-edit
// inspector shows, and the Gemini mark is a brand asset. Presentational only —
// no state, no data access, no imports beyond React.
import React from 'react';

export const GeminiLogo = ({ size = 16, className = "" }: { size?: number, className?: string }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 512 512" 
    fill="currentColor" 
    className={className}
  >
    <path d="M256 0C256 0 292 200 512 256C292 312 256 512 256 512C256 512 220 312 0 256C220 200 256 0 256 0Z" />
  </svg>
);

export const AnnotateIcon = ({ size = 16, className = "" }: { size?: number, className?: string }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2.2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <path d="M4 12c0-4 4-7 8-7s8 3 8 7-4 7-8 7-8-3-8-7Z" className="opacity-40" strokeWidth="1.5" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

export const VisualEditsIcon = ({ size = 16, className = "" }: { size?: number, className?: string }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg" 
    className={className}
  >
    <path d="M3 9V6C3 4.344 4.344 3 6 3H9" 
          stroke="currentColor" strokeWidth="2.1" strokeLinecap="round"/>
    <path d="M15 3H18C20.1 3 21 3.9 21 6V9" 
          stroke="currentColor" strokeWidth="2.1" strokeLinecap="round"/>
    <path d="M3 15V18C3 20.1 3.9 21 6 21H9" 
          stroke="currentColor" strokeWidth="2.1" strokeLinecap="round"/>
    <path d="M11.25 11.25L15.75 22.5Q17.25 17.25 22.5 15.75L11.25 11.25Z" 
          stroke="currentColor" strokeWidth="2.1" fill="none"
          strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

export const MarginLeftIcon = ({ size = 16, className = "" }: { size?: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect width="6" height="10" x="9" y="7" rx="2" />
    <path d="M4 21V3" />
  </svg>
);

export const MarginRightIcon = ({ size = 16, className = "" }: { size?: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect width="6" height="10" x="9" y="7" rx="2" />
    <path d="M20 21V3" />
  </svg>
);

export const MarginTopIcon = ({ size = 16, className = "" }: { size?: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect width="10" height="6" x="7" y="9" rx="2" />
    <path d="M3 4H21" />
  </svg>
);

export const MarginBottomIcon = ({ size = 16, className = "" }: { size?: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect width="10" height="6" x="7" y="9" rx="2" />
    <path d="M3 20H21" />
  </svg>
);

export const PaddingHorizontalIcon = ({ size = 16, className = "" }: { size?: number, className?: string }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <rect width="18" height="18" x="3" y="3" rx="5" ry="5" />
    <path d="M9 8v8" />
    <path d="M15 8v8" />
  </svg>
);

export const PaddingVerticalIcon = ({ size = 16, className = "" }: { size?: number, className?: string }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <rect width="18" height="18" x="3" y="3" rx="5" ry="5" />
    <path d="M8 9h8" />
    <path d="M8 15h8" />
  </svg>
);

export const PaddingLeftIcon = ({ size = 16, className = "" }: { size?: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect width="18" height="18" x="3" y="3" rx="5" ry="5" />
    <path d="M9 8v8" />
  </svg>
);

export const PaddingRightIcon = ({ size = 16, className = "" }: { size?: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect width="18" height="18" x="3" y="3" rx="5" ry="5" />
    <path d="M15 8v8" />
  </svg>
);

export const PaddingTopIcon = ({ size = 16, className = "" }: { size?: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect width="18" height="18" x="3" y="3" rx="5" ry="5" />
    <path d="M8 9h8" />
  </svg>
);

export const PaddingBottomIcon = ({ size = 16, className = "" }: { size?: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect width="18" height="18" x="3" y="3" rx="5" ry="5" />
    <path d="M8 15h8" />
  </svg>
);
