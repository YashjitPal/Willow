import React from 'react';

interface DesignLogoProps {
  className?: string;
}

export const DesignLogo: React.FC<DesignLogoProps> = ({ className = '' }) => {
  return (
    <div className={`inline-flex items-center gap-2 select-none ${className}`}>
      <span
        style={{
          fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", -apple-system, sans-serif',
        }}
        className="text-[24px] leading-[32px] font-medium tracking-tight text-white"
      >
        Design
      </span>
      <span
        style={{
          fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", -apple-system, sans-serif',
        }}
        className="inline-flex items-center justify-center rounded-full border border-white/60 px-2 py-[2px] text-[11px] leading-none font-medium tracking-[0.06em] text-white uppercase"
      >
        BETA
      </span>
    </div>
  );
};

export default DesignLogo;
