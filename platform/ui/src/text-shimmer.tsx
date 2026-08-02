'use client';
import React from 'react';
import { cn } from '@willow/core/utils';

interface TextShimmerProps {
  children: string;
  as?: React.ElementType;
  className?: string;
  duration?: number;
}

export function TextShimmer({
  children,
  as: Component = 'span',
  className,
  duration = 2,
}: TextShimmerProps) {
  return (
    <Component
      className={cn(
        'inline-block bg-clip-text text-transparent',
        'bg-[length:200%_100%]',
        'animate-shimmer',
        className
      )}
      style={{
        backgroundImage: 'linear-gradient(90deg, #81888f 0%, #ffffff 50%, #81888f 100%)',
        animationDuration: `${duration}s`,
      }}
    >
      {children}
    </Component>
  );
}
