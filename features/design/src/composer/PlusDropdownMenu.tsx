import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { TOOL_SYMBOLS, TOOL_TOOLTIPS, type ToolId } from './composer-options';
import {
  CodexGoalIcon,
  CodexPetIcon,
  CodexPlanIcon,
  CodexSideChatIcon,
  StitchComponentsIcon,
  StitchIdeateIcon,
} from './composer-icons';

/**
 * Gemini's plus menu, transcribed rather than designed.
 */

/** Measured surface tokens. */
const SURFACE = '#1f1f1f';
const ON_SURFACE = '#e6e6e6';
const HOVER_LAYER = 'rgba(230,230,230,0.08)';
const DIVIDER = 'rgba(255,255,255,0.12)';
const MENU_SHADOW = '0 0 20px rgba(0,0,0,0.28)';

/** 13px/17px Google Sans Flex at `"wdth" 92`, colour #e6e6e6. */
const LABEL_CLASS =
  "text-[13px] leading-[17px] font-normal text-[#e6e6e6] font-['Google_Sans_Flex','Google_Sans','Helvetica_Neue',sans-serif]";
const LABEL_STYLE: React.CSSProperties = {
  fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 92, "wght" 400',
};

type IconFamily = 'luminous' | 'google-symbols';

/** A glyph in Gemini's 24x24 icon box, rendered at 20px. */
const Glyph: React.FC<{ name: string; family?: IconFamily; className?: string }> = ({
  name,
  family = 'luminous',
  className = '',
}) => (
  <span className={`flex h-6 w-6 shrink-0 items-center justify-center ${className}`}>
    <MaterialSymbol
      name={name}
      family={family}
      size={20}
      weight={family === 'luminous' ? 320 : 330}
      variationSettings={
        family === 'luminous'
          ? '"FILL" 0, "GRAD" 0, "ROND" 100, "opsz" 20, "wght" 320'
          : name === 'more_horiz'
            ? undefined
            : '"wght" 330'
      }
      className="text-[#e6e6e6]"
    />
  </span>
);

const PERSONAL_RECOMMENDATIONS_MASK =
  'url("https://fonts.gstatic.com/render/v1/Luminous+Symbols/28px/personal_recommendations.svg?var=opsz,wght@28,260")';

const PersonalRecommendationsGlyph: React.FC = () => (
  <span className="flex h-6 w-6 shrink-0 items-center justify-center">
    <span
      aria-hidden="true"
      className="block h-5 w-5 shrink-0"
      style={{
        backgroundColor: ON_SURFACE,
        maskImage: PERSONAL_RECOMMENDATIONS_MASK,
        WebkitMaskImage: PERSONAL_RECOMMENDATIONS_MASK,
        maskSize: 'contain',
        WebkitMaskSize: 'contain',
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
        maskPosition: 'center',
        WebkitMaskPosition: 'center',
      }}
    />
  </span>
);

/**
 * One 36px row.
 */
const Row: React.FC<{
  glyph?: string;
  family?: IconFamily;
  icon?: React.ReactNode;
  label: string;
  labelInset?: 40 | 44;
  tooltip?: string;
  trailingChevron?: boolean;
  selected?: boolean;
  onClick?: () => void;
  onMouseEnter?: () => void;
  ariaHasPopup?: boolean;
  expanded?: boolean;
}> = ({
  glyph,
  family,
  icon,
  label,
  labelInset = 40,
  tooltip,
  trailingChevron,
  selected,
  onClick,
  onMouseEnter,
  ariaHasPopup,
  expanded,
}) => (
  <button
    type="button"
    role={ariaHasPopup ? undefined : 'menuitem'}
    aria-haspopup={ariaHasPopup ? 'menu' : undefined}
    aria-expanded={ariaHasPopup ? !!expanded : undefined}
    title={tooltip}
    onClick={onClick}
    onMouseEnter={onMouseEnter}
    data-tooltip-position="right"
    className="group/row relative flex h-9 w-full items-center rounded-xl px-2 text-left"
    style={selected ? { backgroundColor: '#171717' } : undefined}
  >
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 rounded-xl opacity-0 group-hover/row:opacity-100 group-focus-visible/row:opacity-100"
      style={{ backgroundColor: HOVER_LAYER }}
    />
    {icon ?? (glyph ? <Glyph name={glyph} family={family} /> : null)}
    <span
      className={`relative ${LABEL_CLASS} whitespace-nowrap`}
      style={{ ...LABEL_STYLE, marginLeft: labelInset - 32 }}
    >
      {label}
    </span>
    {trailingChevron && (
      <span className="relative ml-auto">
        <Glyph name="chevron_right" family="luminous" />
      </span>
    )}
  </button>
);

/** The card every menu and submenu is drawn on. */
const MenuCard: React.FC<{
  width: number;
  origin: string;
  className?: string;
  style?: React.CSSProperties;
  label: string;
  children: React.ReactNode;
}> = ({ width, origin, className = '', style, label, children }) => (
  <div
    role="menu"
    aria-label={label}
    className={`willow-gem-menu-in overflow-auto ${className}`}
    style={{
      width,
      backgroundColor: SURFACE,
      borderRadius: 20,
      padding: 8,
      boxShadow: MENU_SHADOW,
      transformOrigin: origin,
      ...style,
    }}
  >
    {children}
  </div>
);

/** Divider */
const Divider: React.FC = () => (
  <div
    role="separator"
    className="mx-2 my-2"
    style={{ height: 0, borderTop: `0.8px solid ${DIVIDER}` }}
  />
);

export const PlusDropdownMenu: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onFileSelect: () => void;
  onImportCode?: () => void;
  buttonRef: React.RefObject<HTMLButtonElement>;
  onToolSelect: (toolId: string) => void;
  selectedTool?: ToolId | null;
  geminiStyle?: boolean;
  sparkMode?: boolean;
  sparkToolsEnabled?: boolean;
  onAddFromDrive?: () => void;
  onAddPhotos?: () => void;
  onAddAvatar?: () => void;
  onAddNotebook?: () => void;
  personalIntelligence?: boolean;
  onTogglePersonalIntelligence?: (next: boolean) => void;
}> = ({
  isOpen,
  onClose,
  onFileSelect,
  onImportCode,
  buttonRef,
  onToolSelect,
  selectedTool,
  onAddFromDrive,
  onAddPhotos,
  onAddAvatar,
  onAddNotebook,
  personalIntelligence = false,
  onTogglePersonalIntelligence,
  sparkMode = false,
  sparkToolsEnabled = false,
}) => {
  const [openSub, setOpenSub] = useState<null | 'uploads' | 'tools'>(null);
  const [subTop, setSubTop] = useState(0);
  const [side, setSide] = useState<'bottom' | 'top'>('bottom');
  const menuRef = useRef<HTMLDivElement>(null);
  const uploadsRef = useRef<HTMLDivElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isOpen) setOpenSub(null);
  }, [isOpen]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const recompute = () => {
      const btn = buttonRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const menuH = menuRef.current?.offsetHeight ?? 320;
      const spaceBelow = window.innerHeight - rect.bottom;
      setSide(spaceBelow < menuH + 8 && rect.top > spaceBelow ? 'top' : 'bottom');
    };
    recompute();
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, [isOpen, buttonRef]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node)
        && buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (isOpen) {
      document.addEventListener('mousedown', onDown);
      document.addEventListener('keydown', onKey);
    }
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [isOpen, onClose, buttonRef]);

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  if (!isOpen) return null;

  const openWith = (which: 'uploads' | 'tools') => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    const trigger = which === 'uploads' ? uploadsRef.current : toolsRef.current;
    if (trigger) setSubTop(trigger.offsetTop);
    setOpenSub(which);
  };
  const closeSoon = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpenSub(null), 150);
  };

  const pickTool = (id: ToolId) => { onToolSelect(id); onClose(); };
  const act = (fn?: () => void) => () => { fn?.(); onClose(); };

  const subProps = {
    onMouseEnter: () => { if (closeTimer.current) clearTimeout(closeTimer.current); },
    onMouseLeave: closeSoon,
  };
  const SUB_LEFT = 249 - 8;

  return (
    <div
      ref={menuRef}
      className={`absolute left-0 z-[100] ${side === 'top' ? 'bottom-[calc(100%+8px)]' : 'top-[calc(100%+8px)]'}`}
    >
      <MenuCard
        width={249}
        origin={side === 'top' ? '0 100%' : '0 0'}
        label="Upload and tools"
      >
        <Row glyph="attach_file" label="Upload files" onClick={act(onFileSelect)} onMouseEnter={() => setOpenSub(null)} />
        <Row glyph="drive" family="google-symbols" label="Add from Drive" onClick={act(onAddFromDrive)} onMouseEnter={() => setOpenSub(null)} />

        <div ref={uploadsRef} onMouseEnter={() => openWith('uploads')} onMouseLeave={closeSoon}>
          <Row
            glyph="more_horiz"
            family="google-symbols"
            label="More uploads"
            trailingChevron
            ariaHasPopup
            expanded={openSub === 'uploads'}
            onClick={() => openWith('uploads')}
          />
        </div>

        {!sparkMode && (
          <>
            <Divider />

            <Row glyph={TOOL_SYMBOLS.images} label="Create image" tooltip={TOOL_TOOLTIPS.images} labelInset={44} selected={selectedTool === 'images'} onClick={() => pickTool('images')} onMouseEnter={() => setOpenSub(null)} />
            <Row glyph={TOOL_SYMBOLS.video} label="Create video" tooltip={TOOL_TOOLTIPS.video} labelInset={44} selected={selectedTool === 'video'} onClick={() => pickTool('video')} onMouseEnter={() => setOpenSub(null)} />
            <Row icon={<span className="flex h-6 w-6 shrink-0 items-center justify-center text-[#e6e6e6]"><StitchIdeateIcon size={20} /></span>} label="Plan" tooltip={TOOL_TOOLTIPS.plan} labelInset={44} selected={selectedTool === 'plan'} onClick={() => pickTool('plan')} onMouseEnter={() => setOpenSub(null)} />
            <Row glyph={TOOL_SYMBOLS.mobile} family="google-symbols" label="Mobile" tooltip={TOOL_TOOLTIPS.mobile} labelInset={44} selected={selectedTool === 'mobile'} onClick={() => pickTool('mobile')} onMouseEnter={() => setOpenSub(null)} />

            <div ref={toolsRef} onMouseEnter={() => openWith('tools')} onMouseLeave={closeSoon}>
              <Row
                glyph="more_horiz"
                family="google-symbols"
                label="More tools"
                trailingChevron
                ariaHasPopup
                expanded={openSub === 'tools'}
                onClick={() => openWith('tools')}
              />
            </div>
          </>
        )}
        {sparkMode && sparkToolsEnabled && (
          <>
            <Divider />
            <Row icon={<span className="flex h-6 w-6 shrink-0 items-center justify-center text-[#e6e6e6]"><CodexPlanIcon size={18} strokeWidth={2} /></span>} label="Plan" labelInset={44} selected={selectedTool === 'plan'} onClick={() => pickTool('plan')} onMouseEnter={() => setOpenSub(null)} />
            <Row icon={<span className="flex h-6 w-6 shrink-0 items-center justify-center text-[#e6e6e6]"><CodexGoalIcon size={18} strokeWidth={2} /></span>} label="Goal" labelInset={44} selected={selectedTool === 'goal'} onClick={() => pickTool('goal')} onMouseEnter={() => setOpenSub(null)} />
            <Row glyph={TOOL_SYMBOLS['computer-use']} family="google-symbols" label="Computer Use" labelInset={44} selected={selectedTool === 'computer-use'} onClick={() => pickTool('computer-use')} onMouseEnter={() => setOpenSub(null)} />
            <Row icon={<span className="flex h-6 w-6 shrink-0 items-center justify-center text-[#e6e6e6]"><CodexSideChatIcon size={18} strokeWidth={2} /></span>} label="Side chat" labelInset={44} onClick={onClose} onMouseEnter={() => setOpenSub(null)} />
            <div ref={toolsRef} onMouseEnter={() => openWith('tools')} onMouseLeave={closeSoon}>
              <Row
                glyph="more_horiz"
                family="google-symbols"
                label="More tools"
                trailingChevron
                ariaHasPopup
                expanded={openSub === 'tools'}
                onClick={() => openWith('tools')}
              />
            </div>
          </>
        )}
      </MenuCard>

      {openSub === 'uploads' && (
        <div className="absolute z-[110]" style={{ left: SUB_LEFT, top: subTop - 8 }} {...subProps}>
          <MenuCard width={220} origin="0 0" label="More upload options">
            {sparkMode ? (
              <>
                <Row glyph="code" label="Code" onClick={act(onImportCode)} />
                <Row glyph="photos" family="google-symbols" label="Photos" onClick={act(onAddPhotos)} />
              </>
            ) : (
              <>
                <Row glyph="photos" family="google-symbols" label="Photos" onClick={act(onAddPhotos)} />
                <Row glyph="likeness_lumi_icon" label="Avatar" onClick={act(onAddAvatar)} />
                <Row glyph="code" label="Import code" onClick={act(onImportCode)} />
                <Row glyph="notebook" label="Notebooks" onClick={act(onAddNotebook)} />
              </>
            )}
          </MenuCard>
        </div>
      )}

      {openSub === 'tools' && (
        <div className="absolute z-[110]" style={{ left: SUB_LEFT, top: subTop - 8 }} {...subProps}>
          {sparkMode && sparkToolsEnabled ? (
            <MenuCard width={253} origin="0 0" label="More tools">
              <Row glyph={TOOL_SYMBOLS['create-skill']} family="google-symbols" label="Create skill" labelInset={44} selected={selectedTool === 'create-skill'} onClick={() => pickTool('create-skill')} />
              <Row icon={<span className="flex h-6 w-6 shrink-0 items-center justify-center text-[#e6e6e6]"><CodexPetIcon size={18} strokeWidth={2} /></span>} label="Create pet" labelInset={44} selected={selectedTool === 'create-pet'} onClick={() => pickTool('create-pet')} />
              <Row icon={<PersonalRecommendationsGlyph />} label="Personal Intelligence" labelInset={44} selected={selectedTool === 'personal-intelligence'} onClick={() => pickTool('personal-intelligence')} />
            </MenuCard>
          ) : (
            <MenuCard width={253} origin="0 0" label="More tools">
              <Row icon={<span className="flex h-6 w-6 shrink-0 items-center justify-center text-[#e6e6e6]"><StitchComponentsIcon size={18} strokeWidth={2} /></span>} label="Components" tooltip={TOOL_TOOLTIPS.components} labelInset={44} selected={selectedTool === 'components'} onClick={() => pickTool('components')} />
              <Row glyph={TOOL_SYMBOLS.learn} label="Guided learning" tooltip={TOOL_TOOLTIPS.learn} labelInset={44} selected={selectedTool === 'learn'} onClick={() => pickTool('learn')} />
              {onTogglePersonalIntelligence && (
                <PersonalIntelligenceRow
                  checked={personalIntelligence}
                  onChange={onTogglePersonalIntelligence}
                />
              )}
            </MenuCard>
          )}
        </div>
      )}
    </div>
  );
};

const PersonalIntelligenceRow: React.FC<{
  checked: boolean;
  onChange: (next: boolean) => void;
}> = ({ checked, onChange }) => (
  <button
    type="button"
    role="menuitemcheckbox"
    aria-checked={checked}
    onClick={() => onChange(!checked)}
    className="group/row relative flex h-12 w-full items-center rounded-xl px-2 text-left"
  >
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 rounded-xl opacity-0 group-hover/row:opacity-100 group-focus-visible/row:opacity-100"
      style={{ backgroundColor: HOVER_LAYER }}
    />
    <PersonalRecommendationsGlyph />
    <span className="relative flex flex-col" style={{ marginLeft: 12 }}>
      <span className={LABEL_CLASS} style={LABEL_STYLE}>Personal Intelligence</span>
      <span
        className="text-[13px] leading-[17px] font-normal font-['Google_Sans_Flex','Google_Sans','Helvetica_Neue',sans-serif]"
        style={{ ...LABEL_STYLE, color: 'rgba(255,255,255,0.55)' }}
      >
        Labs
      </span>
    </span>
    <span className="relative ml-auto" aria-hidden="true">
      <GeminiSwitch checked={checked} />
    </span>
  </button>
);

const GeminiSwitch: React.FC<{ checked: boolean }> = ({ checked }) => (
  <span
    className="relative block"
    style={{ width: 52, height: 32, transform: 'scale(0.75)', transformOrigin: 'center' }}
  >
    <span
      className="absolute inset-0 block"
      style={{
        borderRadius: 9999,
        backgroundColor: checked ? '#a8c7fa' : '#444746',
        transition: 'background-color 75ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    />
    <span
      className="absolute flex items-center justify-center"
      style={{
        top: '50%',
        left: 0,
        width: checked ? 24 : 16,
        height: checked ? 24 : 16,
        transform: `translate(${checked ? '24px' : '4px'}, -50%)`,
        transition: 'transform 75ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      <span
        className="block h-full w-full rounded-full"
        style={{
          backgroundColor: checked ? '#062e6f' : '#8e918f',
          transition: 'background-color 75ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      />
    </span>
  </span>
);
