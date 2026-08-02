// The pen tool's flyout panel: draw/text/rect sub-tool row, colour capsule with
// its swatch grid, brush-size slider, and undo/redo/reset.
//
// Stateless — every value it renders and every setter it calls lives in
// MediaView. The animating `motion.div` wrapper stays there too, so it remains a
// direct child of `AnimatePresence` and the enter/exit transition is unchanged.
// The `<style>` block rides along because `.pen-menu-range` styles the slider
// below it and has no other user in the repo.

import React from 'react';
import { Undo2, Redo2, RotateCcw } from 'lucide-react';

export type PenSubTool = 'draw' | 'text' | 'rect';

const SWATCHES = ['#ff0000', '#ff9500', '#ffcc00', '#34c759', '#007aff', '#af52de', '#ffffff', '#000000'];

interface PenMenuProps {
  activePenSubTool: PenSubTool;
  setActivePenSubTool: (tool: PenSubTool) => void;
  activeColor: string;
  setActiveColor: (color: string) => void;
  showColorPicker: boolean;
  setShowColorPicker: (show: boolean) => void;
  penSize: number;
  setPenSize: (size: number) => void;
  annotationCount: number;
  redoCount: number;
  onUndo: () => void;
  onRedo: () => void;
  onReset: () => void;
}

export function PenMenu({
  activePenSubTool,
  setActivePenSubTool,
  activeColor,
  setActiveColor,
  showColorPicker,
  setShowColorPicker,
  penSize,
  setPenSize,
  annotationCount,
  redoCount,
  onUndo,
  onRedo,
  onReset,
}: PenMenuProps) {
  return (
    <>
      <style>{`
        .pen-menu-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #ffffff;
          cursor: pointer;
          border: none;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
          transition: transform 0.1s ease;
        }
        .pen-menu-range::-webkit-slider-thumb:hover {
          transform: scale(1.15);
        }
        .pen-menu-range::-webkit-slider-thumb:active {
          transform: scale(0.9);
        }
        .pen-menu-range::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #ffffff;
          cursor: pointer;
          border: none;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
          transition: transform 0.1s ease;
        }
        .pen-menu-range::-moz-range-thumb:hover {
          transform: scale(1.15);
        }
        .pen-menu-range::-moz-range-thumb:active {
          transform: scale(0.9);
        }
      `}</style>

      {/* Sub-tools Row */}
      <div className="flex justify-center items-center gap-1.5">
        <button
          onClick={() => {
            setActivePenSubTool('draw');
            setShowColorPicker(false);
          }}
          className={`w-9 h-9 flex items-center justify-center rounded-[12px] transition-all active:scale-95 ${
            activePenSubTool === 'draw' ? 'bg-[#303030] text-white' : 'text-white/60 hover:text-white hover:bg-white/5'
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={18} height={18}>
            <defs>
              <mask id="pen-mask-menu">
                <rect width="100%" height="100%" fill="white" />
                <path d="M 4 20 L 4 16.5 L 15.5 5 A 2.475 2.475 0 0 1 19 8.5 L 7.5 20 Z"
                      fill="black" stroke="black" stroke-width="2.75" stroke-linejoin="round" />
              </mask>
            </defs>
            <path d="M 4 7 C 4 3, 9 3, 11 6 C 13 9, 13 14, 15 17 C 17 20, 20 19, 21 17"
                  fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" mask="url(#pen-mask-menu)" />
            <path d="M 4 20 L 4 16.5 L 15.5 5 A 2.475 2.475 0 0 1 19 8.5 L 7.5 20 Z M 7 16 L 14 9 L 15 10 L 8 17 Z"
                  fill="currentColor" fill-rule="evenodd" />
          </svg>
        </button>
        <button
          onClick={() => {
            setActivePenSubTool('text');
            setShowColorPicker(false);
          }}
          className={`w-9 h-9 flex items-center justify-center rounded-[12px] transition-all active:scale-95 ${
            activePenSubTool === 'text' ? 'bg-[#303030] text-white' : 'text-white/60 hover:text-white hover:bg-white/5'
          }`}
        >
          <span className="text-[17px] font-bold select-none leading-none tracking-tighter font-sans">Tt</span>
        </button>
        <button
          onClick={() => {
            setActivePenSubTool('rect');
            setShowColorPicker(false);
          }}
          className={`w-9 h-9 flex items-center justify-center rounded-[12px] transition-all active:scale-95 ${
            activePenSubTool === 'rect' ? 'bg-[#303030] text-white' : 'text-white/60 hover:text-white hover:bg-white/5'
          }`}
        >
          <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round">
            <rect x={3} y={4} width={18} height={16} rx={1} />
          </svg>
        </button>
      </div>

      {/* Color Selector Capsule */}
      <div className="relative w-full flex flex-col gap-2">
        <button
          onClick={() => setShowColorPicker(!showColorPicker)}
          className="w-full h-7 rounded-full border border-white/80 p-[2px] flex items-center justify-center transition-all hover:border-white active:scale-98"
        >
          <div
            className="w-full h-full rounded-full transition-colors"
            style={{ backgroundColor: activeColor }}
          />
        </button>

        {showColorPicker && (
          <div className="grid grid-cols-4 gap-1.5 p-1.5 bg-[#1f2022] border border-white/10 rounded-2xl transition-all duration-200 shadow-inner justify-items-center">
            {SWATCHES.map((color) => (
              <button
                key={color}
                onClick={() => {
                  setActiveColor(color);
                  setShowColorPicker(false);
                }}
                className={`w-[22px] h-[22px] rounded-full border transition-all relative flex items-center justify-center ${
                  activeColor === color ? 'border-white scale-110 shadow-md' : 'border-transparent hover:scale-105'
                }`}
                style={{ backgroundColor: color }}
              >
                {activeColor === color && (
                  <span className={`w-1.5 h-1.5 rounded-full ${color === '#ffffff' ? 'bg-black' : 'bg-white'}`} />
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Brush Size Slider */}
      <div className="flex flex-col gap-0.5">
        <div className="text-[12px] font-bold text-white/95 select-none pl-0.5">{penSize}px</div>
        <div className="relative flex items-center h-4">
          <input
            type="range"
            min={1}
            max={20}
            value={penSize}
            onChange={(e) => setPenSize(parseInt(e.target.value))}
            className="pen-menu-range w-full h-[2px] bg-white/20 rounded-lg appearance-none cursor-pointer focus:outline-none"
            style={{
              background: `linear-gradient(to right, #ffffff 0%, #ffffff ${(penSize - 1) / 19 * 100}%, rgba(255,255,255,0.2) ${(penSize - 1) / 19 * 100}%, rgba(255,255,255,0.2) 100%)`
            }}
          />
        </div>
      </div>

      {/* Actions Row */}
      <div className="flex justify-center items-center gap-1.5 pt-1">
        <button
          className={`w-9 h-9 flex items-center justify-center rounded-[12px] transition-all active:scale-90 ${
            annotationCount === 0
              ? 'text-white/20 cursor-not-allowed pointer-events-none'
              : 'text-white/60 hover:text-white hover:bg-white/5'
          }`}
          onClick={onUndo}
          title="Undo"
        >
          <Undo2 size={18} strokeWidth={2.25} />
        </button>
        <button
          className={`w-9 h-9 flex items-center justify-center rounded-[12px] transition-all active:scale-90 ${
            redoCount === 0
              ? 'text-white/20 cursor-not-allowed pointer-events-none'
              : 'text-white/60 hover:text-white hover:bg-white/5'
          }`}
          onClick={onRedo}
          title="Redo"
        >
          <Redo2 size={18} strokeWidth={2.25} />
        </button>
        <button
          className={`w-9 h-9 flex items-center justify-center rounded-[12px] transition-all active:scale-90 ${
            annotationCount === 0 && redoCount === 0 && activeColor === '#ff0000' && penSize === 4 && activePenSubTool === 'draw'
              ? 'text-white/20 cursor-not-allowed pointer-events-none'
              : 'text-white/60 hover:text-white hover:bg-white/5'
          }`}
          onClick={onReset}
          title="Reset"
        >
          <RotateCcw size={15} strokeWidth={2.25} />
        </button>
      </div>
    </>
  );
}
