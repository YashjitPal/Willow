// The two flyout menus that hang off the image editor's tool rail: the select
// tool's box/lasso picker and the crop tool's ratio picker.
//
// Like `PenMenu`, these are the *contents* of their `motion.div` wrappers — the
// wrappers stay in MediaView so they remain direct children of their
// `AnimatePresence` and keep their exit animations.

import React from 'react';
import { Crop } from 'lucide-react';

export type SelectSubTool = 'box' | 'lasso';
export type CropRatio = '16:9' | '9:16' | '1:1' | 'freeform';

/** Shared by every row in both menus. */
const rowClass = (active: boolean) =>
  `flex items-center gap-3 px-3.5 py-2.5 w-full rounded-[18px] transition-all active:scale-[0.98] ${
    active
      ? 'bg-white/10 text-white font-semibold'
      : 'text-white/60 hover:text-white hover:bg-white/5'
  }`;

const BoxIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
    <rect width="16" height="16" x="4" y="4" rx="2" strokeDasharray="3 3" />
  </svg>
);

const LassoIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7" strokeDasharray="3 3" />
    <path d="M17 17l4 4M17 17h4M17 17v4" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

interface SelectMenuProps {
  activeSelectSubTool: SelectSubTool;
  setActiveSelectSubTool: (tool: SelectSubTool) => void;
  setShowSelectMenu: (show: boolean) => void;
}

export function SelectMenu({ activeSelectSubTool, setActiveSelectSubTool, setShowSelectMenu }: SelectMenuProps) {
  const pick = (tool: SelectSubTool) => {
    setActiveSelectSubTool(tool);
    setShowSelectMenu(false);
  };

  return (
    <>
      <button onClick={() => pick('box')} className={rowClass(activeSelectSubTool === 'box')}>
        <BoxIcon />
        <span className="text-[14px]">Box</span>
      </button>

      <button onClick={() => pick('lasso')} className={rowClass(activeSelectSubTool === 'lasso')}>
        <LassoIcon />
        <span className="text-[14px]">Lasso</span>
      </button>
    </>
  );
}

/** The crop ratios, in the order they appear in the menu. */
const CROP_RATIOS: { ratio: CropRatio; label: string; icon: React.ReactNode }[] = [
  {
    ratio: '16:9',
    label: 'Landscape (16:9)',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
        <rect width="18" height="12" x="3" y="6" rx="1.5" />
      </svg>
    ),
  },
  {
    ratio: '9:16',
    label: 'Portrait (9:16)',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
        <rect width="12" height="18" x="6" y="3" rx="1.5" />
      </svg>
    ),
  },
  {
    ratio: '1:1',
    label: 'Square (1:1)',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
        <rect width="16" height="16" x="4" y="4" rx="1.5" />
      </svg>
    ),
  },
  {
    ratio: 'freeform',
    label: 'Freeform',
    icon: <Crop size={18} strokeWidth={2.25} />,
  },
];

interface CropMenuProps {
  activeTool: 'crop' | 'pen' | 'select';
  setActiveTool: (tool: 'crop' | 'pen' | 'select') => void;
  setPreviousTool: (tool: 'pen' | 'select') => void;
  activeCropRatio: CropRatio;
  setActiveCropRatio: (ratio: CropRatio) => void;
  setShowCropMenu: (show: boolean) => void;
}

export function CropMenu({
  activeTool,
  setActiveTool,
  setPreviousTool,
  activeCropRatio,
  setActiveCropRatio,
  setShowCropMenu,
}: CropMenuProps) {
  // Picking any ratio also enters the crop tool, remembering what to go back to.
  const pick = (ratio: CropRatio) => {
    if (activeTool !== 'crop') {
      setPreviousTool(activeTool as 'pen' | 'select');
      setActiveTool('crop');
    }
    setActiveCropRatio(ratio);
    setShowCropMenu(false);
  };

  return (
    <>
      {CROP_RATIOS.map(({ ratio, label, icon }) => (
        <button key={ratio} onClick={() => pick(ratio)} className={rowClass(activeCropRatio === ratio)}>
          {icon}
          <span className="text-[14px]">{label}</span>
        </button>
      ))}
    </>
  );
}
