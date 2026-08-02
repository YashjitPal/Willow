// The SVG overlay that draws the image editor's annotations.
//
// Renders the committed annotation list plus the one being drawn right now, and
// is the mouse target for the pen/select tools. Stateless — every piece of state
// it draws from lives in MediaView, which also owns the drag handlers.

import React from 'react';
import type { Annotation } from './annotations';

/** Turn a point list into an SVG path `d`; a single point becomes a dot. */
const getSvgPathD = (points: { x: number; y: number }[]) => {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y} L ${points[0].x} ${points[0].y}`;

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x} ${points[i].y}`;
  }
  return d;
};

interface AnnotationOverlayProps {
  svgRef: React.RefObject<SVGSVGElement | null>;
  annotations: Annotation[];
  currentAnnotation: Annotation | null;
  onMouseDown: (e: React.MouseEvent<SVGSVGElement>) => void;
}

export function AnnotationOverlay({ svgRef, annotations, currentAnnotation, onMouseDown }: AnnotationOverlayProps) {
  return (
    <svg
      ref={svgRef}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="absolute inset-0 w-full h-full pointer-events-auto cursor-crosshair select-none z-10"
      onMouseDown={onMouseDown}
      style={{ touchAction: 'none' }}
    >
      {/* Render existing annotations */}
      {annotations.map((ann) => {
        if (ann.type === 'draw' && ann.points) {
          return (
            <path
              key={ann.id}
              d={getSvgPathD(ann.points)}
              stroke={ann.color}
              strokeWidth={ann.size}
              vectorEffect="non-scaling-stroke"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        }
        if (ann.type === 'rect') {
          const x = Math.min(ann.x || 0, (ann.x || 0) + (ann.width || 0));
          const y = Math.min(ann.y || 0, (ann.y || 0) + (ann.height || 0));
          const width = Math.abs(ann.width || 0);
          const height = Math.abs(ann.height || 0);
          return (
            <rect
              key={ann.id}
              x={`${x}%`}
              y={`${y}%`}
              width={`${width}%`}
              height={`${height}%`}
              stroke={ann.color}
              strokeWidth={ann.size}
              vectorEffect="non-scaling-stroke"
              fill="none"
            />
          );
        }
        if (ann.type === 'select-box') {
          const x = Math.min(ann.x || 0, (ann.x || 0) + (ann.width || 0));
          const y = Math.min(ann.y || 0, (ann.y || 0) + (ann.height || 0));
          const width = Math.abs(ann.width || 0);
          const height = Math.abs(ann.height || 0);
          return (
            <g key={ann.id}>
              <rect
                x={`${x}%`}
                y={`${y}%`}
                width={`${width}%`}
                height={`${height}%`}
                stroke="black"
                strokeWidth={ann.size}
                vectorEffect="non-scaling-stroke"
                fill="none"
              />
              <rect
                x={`${x}%`}
                y={`${y}%`}
                width={`${width}%`}
                height={`${height}%`}
                stroke="white"
                strokeWidth={ann.size}
                strokeDasharray="4 4"
                vectorEffect="non-scaling-stroke"
                fill="rgba(255, 255, 255, 0.05)"
              />
            </g>
          );
        }
        if (ann.type === 'select-lasso' && ann.points) {
          return (
            <g key={ann.id}>
              <path
                d={getSvgPathD(ann.points)}
                stroke="black"
                strokeWidth={ann.size}
                vectorEffect="non-scaling-stroke"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d={getSvgPathD(ann.points)}
                stroke="white"
                strokeWidth={ann.size}
                strokeDasharray="4 4"
                vectorEffect="non-scaling-stroke"
                fill="rgba(255, 255, 255, 0.05)"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          );
        }
        if (ann.type === 'text') {
          return (
            <text
              key={ann.id}
              x={`${ann.x}%`}
              y={`${ann.y}%`}
              fill={ann.color}
              fontSize={`${ann.size * 2.5 + 8}px`}
              fontFamily="sans-serif"
              fontWeight="bold"
              dominantBaseline="middle"
            >
              {ann.text}
            </text>
          );
        }
        return null;
      })}
      {/* Render currently drawing annotation */}
      {currentAnnotation && currentAnnotation.type === 'draw' && currentAnnotation.points && (
        <path
          d={getSvgPathD(currentAnnotation.points)}
          stroke={currentAnnotation.color}
          strokeWidth={currentAnnotation.size}
          vectorEffect="non-scaling-stroke"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {currentAnnotation && currentAnnotation.type === 'rect' && (
        <rect
          x={`${Math.min(currentAnnotation.x || 0, (currentAnnotation.x || 0) + (currentAnnotation.width || 0))}%`}
          y={`${Math.min(currentAnnotation.y || 0, (currentAnnotation.y || 0) + (currentAnnotation.height || 0))}%`}
          width={`${Math.abs(currentAnnotation.width || 0)}%`}
          height={`${Math.abs(currentAnnotation.height || 0)}%`}
          stroke={currentAnnotation.color}
          strokeWidth={currentAnnotation.size}
          vectorEffect="non-scaling-stroke"
          fill="none"
        />
      )}
      {currentAnnotation && currentAnnotation.type === 'select-lasso' && currentAnnotation.points && (
        <g>
          <path
            d={getSvgPathD(currentAnnotation.points)}
            stroke="black"
            strokeWidth={currentAnnotation.size}
            vectorEffect="non-scaling-stroke"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={getSvgPathD(currentAnnotation.points)}
            stroke="white"
            strokeWidth={currentAnnotation.size}
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
            fill="rgba(255, 255, 255, 0.05)"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      )}
      {currentAnnotation && currentAnnotation.type === 'select-box' && (
        <g>
          <rect
            x={`${Math.min(currentAnnotation.x || 0, (currentAnnotation.x || 0) + (currentAnnotation.width || 0))}%`}
            y={`${Math.min(currentAnnotation.y || 0, (currentAnnotation.y || 0) + (currentAnnotation.height || 0))}%`}
            width={`${Math.abs(currentAnnotation.width || 0)}%`}
            height={`${Math.abs(currentAnnotation.height || 0)}%`}
            stroke="black"
            strokeWidth={currentAnnotation.size}
            vectorEffect="non-scaling-stroke"
            fill="none"
          />
          <rect
            x={`${Math.min(currentAnnotation.x || 0, (currentAnnotation.x || 0) + (currentAnnotation.width || 0))}%`}
            y={`${Math.min(currentAnnotation.y || 0, (currentAnnotation.y || 0) + (currentAnnotation.height || 0))}%`}
            width={`${Math.abs(currentAnnotation.width || 0)}%`}
            height={`${Math.abs(currentAnnotation.height || 0)}%`}
            stroke="white"
            strokeWidth={currentAnnotation.size}
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
            fill="rgba(255, 255, 255, 0.05)"
          />
        </g>
      )}
    </svg>
  );
}
