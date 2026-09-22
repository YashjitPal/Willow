import React from 'react';

interface CustomizeSkeletonGridProps {
  tab: 'discover' | 'connectors' | 'skills';
  count?: number;
}

export const CustomizeSkeletonGrid: React.FC<CustomizeSkeletonGridProps> = ({
  tab,
  count = 8,
}) => {
  return (
    <div className={`${tab}-skeleton-grid`} aria-hidden="true">
      {Array.from({ length: count }).map((_, idx) => (
        <div key={idx} className="placeholder-card">
          <div className="placeholder-icon gem-shimmer-active" />
          <div className="placeholder-content">
            <div className="placeholder-title gem-shimmer-active" />
            <div className="placeholder-subtitle gem-shimmer-active" />
          </div>
        </div>
      ))}
    </div>
  );
};
