import React from 'react';

export const DiscordIcon = ({ size = 18, strokeWidth = 1.2, ...props }: any) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="-2 -2 20 20" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth={strokeWidth} 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    {...props}
  >
    <path d="M13.545 2.907a13.2 13.2 0 0 0-3.257-1.011.05.05 0 0 0-.052.025c-.141.25-.297.577-.406.833a12.2 12.2 0 0 0-3.658 0 8 8 0 0 0-.412-.833.05.05 0 0 0-.052-.025c-1.125.194-2.22.534-3.257 1.011a.04.04 0 0 0-.021.018C.356 6.024-.213 9.047.066 12.032q.003.022.021.037a13.3 13.3 0 0 0 3.995 2.02.05.05 0 0 0 .056-.019q.463-.63.818-1.329a.05.05 0 0 0-.01-.059l-.018-.011a9 9 0 0 1-1.248-.595.05.05 0 0 1-.02-.066l.015-.019q.127-.095.248-.195a.05.05 0 0 1 .051-.007c2.619 1.196 5.454 1.196 8.041 0a.05.05 0 0 1 .053.007q.121.1.248.195a.05.05 0 0 1-.004.085 8 8 0 0 1-1.249.594.05.05 0 0 0-.03.03.05.05 0 0 0 .003.041c.24.465.515.909.817 1.329a.05.05 0 0 0 .056.019 13.2 13.2 0 0 0 4.001-2.02.05.05 0 0 0 .021-.037c.334-3.451-.559-6.449-2.366-9.106a.03.03 0 0 0-.02-.019m-8.198 7.307c-.789 0-1.438-.724-1.438-1.612s.637-1.613 1.438-1.613c.807 0 1.45.73 1.438 1.613 0 .888-.637 1.612-1.438 1.612m5.316 0c-.788 0-1.438-.724-1.438-1.612s.637-1.613 1.438-1.613c.807 0 1.451.73 1.438 1.613 0 .888-.631 1.612-1.438 1.612"/>
  </svg>
);

export const MediaIcon = ({ size = 18, className = '', strokeWidth, ...props }: any) => {
  const adjustedSize = Math.round(size * 1.15);
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      viewBox="18 1 128 128" 
      width={adjustedSize} 
      height={adjustedSize} 
      className={className}
      style={{
        position: 'relative',
        top: '-2.5px',
        left: '2px',
        ...props.style
      }}
      {...props}
    >
      <path d="M 84 33
               L 36 33
               A 12 12 0 0 0 24 45
               L 24 78
               A 12 12 0 0 0 36 90
               L 104 90
               A 12 12 0 0 0 116 78
               L 116 65"
            fill="none" 
            stroke="currentColor" 
            strokeWidth={strokeWidth ? strokeWidth * 5 : 10} 
            strokeLinecap="butt" />
      <path d="M 29 104 
               L 111 104 
               A 9 9 0 0 1 102 113 
               L 38 113 
               A 9 9 0 0 1 29 104 Z"
            fill="currentColor" />
      <path d="M 39 120 
               L 101 120 
               A 5 5 0 0 1 96 125 
               L 44 125 
               A 5 5 0 0 1 39 120 Z"
            fill="currentColor" />
      <path d="M 116 6
               Q 116 33 143 33
               Q 116 33 116 60
               Q 116 33 89 33
               Q 116 33 116 6 Z"
            fill="currentColor" />
    </svg>
  );
};
