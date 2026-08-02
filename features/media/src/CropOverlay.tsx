// The crop tool's overlay: four dimming strips around the crop box, the box
// border itself, and the drag handles (interior to move, corners to resize).
//
// Stateless — `cropBox` and the pointer handler live in MediaView, which owns
// the drag math. The container ref is here because MediaView measures it to turn
// mouse positions into percentages.

import React from 'react';

export type CropHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se';

interface CropOverlayProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  cropBox: { x: number; y: number; w: number; h: number };
  onPointerDown: (e: React.MouseEvent, type: CropHandle) => void;
}

export function CropOverlay({ containerRef, cropBox, onPointerDown }: CropOverlayProps) {
  return (
    <div ref={containerRef} className="absolute inset-0 z-20 select-none" style={{ cursor: 'default' }}>
      {/* Dark overlay strips around the crop box (contained within image bounds) */}
      {/* Top strip */}
      <div className="absolute bg-black/50" style={{ left: 0, top: 0, right: 0, height: `${cropBox.y}%` }} />
      {/* Bottom strip */}
      <div className="absolute bg-black/50" style={{ left: 0, top: `${cropBox.y + cropBox.h}%`, right: 0, bottom: 0 }} />
      {/* Left strip (between top and bottom) */}
      <div className="absolute bg-black/50" style={{ left: 0, top: `${cropBox.y}%`, width: `${cropBox.x}%`, height: `${cropBox.h}%` }} />
      {/* Right strip (between top and bottom) */}
      <div className="absolute bg-black/50" style={{ left: `${cropBox.x + cropBox.w}%`, top: `${cropBox.y}%`, right: 0, height: `${cropBox.h}%` }} />

      {/* The crop box border */}
      <div
        className="absolute border-2 border-white"
        style={{
          left: `${cropBox.x}%`,
          top: `${cropBox.y}%`,
          width: `${cropBox.w}%`,
          height: `${cropBox.h}%`,
        }}
      >
        {/* Move handle — full interior */}
        <div
          className="absolute inset-0 cursor-move"
          onMouseDown={(e) => onPointerDown(e, 'move')}
        />
        {/* Corner handles (L-shaped vertices) */}
        {/* Top-Left */}
        <div
          className="absolute top-[-3px] left-[-3px] w-5 h-5 border-t-[3px] border-l-[3px] border-white cursor-nwse-resize z-10"
          onMouseDown={(e) => onPointerDown(e, 'nw')}
        />
        {/* Top-Right */}
        <div
          className="absolute top-[-3px] right-[-3px] w-5 h-5 border-t-[3px] border-r-[3px] border-white cursor-nesw-resize z-10"
          onMouseDown={(e) => onPointerDown(e, 'ne')}
        />
        {/* Bottom-Left */}
        <div
          className="absolute bottom-[-3px] left-[-3px] w-5 h-5 border-b-[3px] border-l-[3px] border-white cursor-nesw-resize z-10"
          onMouseDown={(e) => onPointerDown(e, 'sw')}
        />
        {/* Bottom-Right */}
        <div
          className="absolute bottom-[-3px] right-[-3px] w-5 h-5 border-b-[3px] border-r-[3px] border-white cursor-nwse-resize z-10"
          onMouseDown={(e) => onPointerDown(e, 'se')}
        />
      </div>
    </div>
  );
}
