import React from 'react';
import { ArrowUpRight } from 'lucide-react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { useThemeMode } from '@willow/core/theme-mode';

export const SidebarItem: React.FC<{ 
  icon?: React.ElementType; 
  symbol?: string;
  label: string; 
  customLabel?: React.ReactNode;
  active?: boolean; 
  isCollapsed: boolean;
  onClick?: () => void;
  href?: string;
  actions?: React.ReactNode;
  keepActionsVisible?: boolean;
  flushRight?: boolean;
  /** Optional optical correction for an individual icon. */
  iconClassName?: string;
  /**
   * The keyboard shortcut Gemini reveals in the row's trailing slot on hover —
   * "Ctrl+Shift+O" on New chat, "Ctrl+Shift+K" on Search chats.
   *
   * A hint only: nothing here binds the key. Willow's own bindings live with the
   * shell's key handling, and printing a combination the app does not answer to
   * would be worse than printing none.
   */
  shortcut?: string;
}> = ({ icon: Icon, symbol, label, customLabel, active, isCollapsed, onClick, href, actions, keepActionsVisible, flushRight, shortcut, iconClassName = '' }) => {
  const { isLight } = useThemeMode();
  return (
  <div className={flushRight ? 'pl-1.5 pr-0' : 'px-1.5'}>
    <div
      role="button"
      tabIndex={0}
      /*
       * Collapsed, the label is only readable as a tooltip. `title` routes it
       * through <GlobalTooltips>, so the rail gets Gemini's tooltip rather than
       * a second, hand-rolled one.
       *
       * `right` is measured, not chosen: hovering a Gemini sidebar row put the
       * surface at x=284 against a trigger ending at 276 (gap 8) with its
       * vertical centre on the trigger's, under `mat-mdc-tooltip-panel-right`.
       */
      title={isCollapsed ? label : undefined}
      data-tooltip-position="right"
      onClick={href ? () => window.open(href, '_blank') : onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if (href) window.open(href, '_blank');
          else if (onClick) onClick();
        }
      }}
      className={`relative flex h-8 max-[960px]:h-11 items-center transition-colors duration-150 group/item cursor-pointer outline-none
        ${isCollapsed ? 'ml-1 mr-0 w-8 gap-0 px-1.5 overflow-visible' : `mx-auto w-full gap-1.5 max-[960px]:gap-3 ${!Icon && !symbol ? 'pl-[8px] max-[960px]:pl-3.5 pr-1.5 max-[960px]:pr-3.5' : 'px-1.5 max-[960px]:px-3.5'} overflow-hidden`}
        ${active ? 'bg-[#171717]' : ''} ${isLight ? (active ? '!bg-[#f2f0f0] !text-[#000000]' : '!text-[#000000] hover:!bg-black/[0.05]') : 'text-[#e6e6e6] hover:bg-[rgba(230,230,230,0.08)]'}
        rounded-full`}
    >
      {symbol ? (
        <div className={`${isCollapsed ? 'h-5 w-5' : 'h-7 w-7 max-[960px]:h-9 max-[960px]:w-9'} flex items-center justify-center shrink-0`}>
          <MaterialSymbol
            family="luminous"
            name={symbol}
            size={20}
            opticalSize={20}
            fill={active}
            className="transition-transform duration-200 group-active/item:scale-90 max-[960px]:!w-6 max-[960px]:!h-6 max-[960px]:!text-[24px]"
          />
        </div>
      ) : Icon ? (
        <div className={`${isCollapsed ? 'h-5 w-5' : 'h-7 w-7 max-[960px]:h-9 max-[960px]:w-9'} flex items-center justify-center shrink-0 ${iconClassName}`}>
          <Icon size={20} strokeWidth={active ? 2 : 1.85} className="transition-transform duration-200 group-active/item:scale-90 max-[960px]:w-6 max-[960px]:h-6" />
        </div>
      ) : null}
      {!isCollapsed && (
        <span className={`whitespace-nowrap text-[13px] leading-[17px] max-[960px]:text-[15px] max-[960px]:leading-5 transition-opacity duration-200 ease-linear ${active ? 'font-medium text-white' : 'font-normal text-[#e6e6e6]'} ${isLight ? '!text-[#000000]' : ''} opacity-100 flex-1 min-w-0 overflow-hidden text-ellipsis`}>
          {customLabel || label}
        </span>
      )}
      
      {href && !isCollapsed && (
        <div className="ml-auto pr-3 opacity-0 group-hover/item:opacity-100 transition-opacity flex items-center justify-center shrink-0">
          <ArrowUpRight size={16} strokeWidth={1.5} className="text-zinc-400 group-hover/item:text-white" />
        </div>
      )}

      {/*
       * Gemini's `.mat-mdc-list-item-meta.trailing-content`, measured on its own
       * New chat row: `justify-content: end`, holding a 13px/17px span at weight
       * 400 in `rgb(196,199,197)` with axes `"ROND" 0, "slnt" 0, "wdth" 92`.
       * Its transition is `opacity .15s cubic-bezier(0,0,0,0) .1s, visibility` —
       * the 100ms delay is why a cursor crossing the sidebar does not strobe
       * every row it passes over.
       *
       * Collapsed to zero width at rest rather than merely transparent, so the
       * label gets the whole row until the pointer is actually on it, then
       * truncates to make room. That is Gemini's behaviour and it matches how
       * `actions` below already works.
       */}
      {shortcut && !isCollapsed && (
        <span
          aria-hidden="true"
          className="ml-auto flex shrink-0 items-center justify-end whitespace-nowrap text-[13px] font-normal leading-[17px] text-[#c4c7c5] max-w-0 overflow-hidden opacity-0 group-hover/item:max-w-none group-hover/item:pl-2 group-hover/item:mr-0.5 group-hover/item:opacity-100"
          style={{ fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 92, "wght" 400' }}
        >
          {shortcut}
        </span>
      )}

      {actions && !isCollapsed && (
        <div className={`ml-auto pr-0.5 max-[960px]:pr-1.5 flex items-center justify-center shrink-0 ${
          keepActionsVisible ? 'opacity-100' : 'max-w-0 overflow-hidden opacity-0 group-hover/item:max-w-none group-hover/item:overflow-visible group-hover/item:opacity-100 max-[960px]:opacity-100 max-[960px]:max-w-none max-[960px]:overflow-visible'
        }`}>
          {actions}
        </div>
      )}

    </div>
  </div>
  );
};

export const SidebarSkeleton: React.FC<{ isCollapsed: boolean }> = ({ isCollapsed }) => {
  return (
    <div className="px-1.5">
      <div className="sidebar-skeleton">
        <div className="sidebar-skeleton-shimmer" />
        {isCollapsed && (
          <div className="sidebar-skeleton-tooltip">
            Renaming...
          </div>
        )}
      </div>
    </div>
  );
};

export const SectionHeader: React.FC<{
  title: string;
  isCollapsed: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  controlsId: string;
}> = ({ title, isCollapsed, isExpanded, onToggle, controlsId }) => {
  const { isLight } = useThemeMode();
  if (isCollapsed) {
    return <div aria-hidden="true" className="h-3 shrink-0" />;
  }

  return (
    <button
      type="button"
      aria-label={`Toggle ${title}`}
      aria-expanded={isExpanded}
      aria-controls={controlsId}
      onClick={onToggle}
      className={`group/section mt-3 max-[960px]:mt-4 flex h-8 max-[960px]:h-10 w-[calc(100%-12px)] items-center overflow-hidden pl-[14px] max-[960px]:pl-4 pr-1.5 max-[960px]:pr-3 text-left text-[13px] leading-[17px] max-[960px]:text-[14.5px] max-[960px]:leading-5 font-normal ${
        isLight ? 'text-[rgba(0,0,0,0.55)]' : 'text-white/55'
      } outline-none`}
    >
      {/*
       * NOT flex-1. Gemini's `.expandable-section-title` is `white-space: nowrap;
       * vertical-align: middle` and nothing else, so it shrink-wraps its text and the
       * chevron sits directly against it. Measured on both sections: title right edge
       * to icon left edge is exactly 4px ("Notebooks" 14->80.38 then icon at 84.38;
       * "Recents" 14->62.28 then icon at 66.28). A flex-1 title consumed the row and
       * pushed the chevron to the far edge, which is the visible gap.
       */}
      <span className="min-w-0 truncate">{title}</span>
      <span
        aria-hidden="true"
        /*
         * `margin-inline-start: var(--gem-sys-spacing--xs)` = 4px, in a 16px box.
         * Hidden at rest and revealed on hover/focus-visible:
         *   .toggle-icon { transition: transform .2s cubic-bezier(.2,0,0,1), opacity .2s ease }
         *   .expandable-section-header:hover .toggle-icon,
         *   .expandable-section-header:focus-visible .toggle-icon { opacity: 1 }
         */
        className="luminous-symbols ml-1 max-[960px]:ml-1.5 inline-flex h-4 w-4 max-[960px]:h-5 max-[960px]:w-5 shrink-0 items-center justify-center text-[16px] leading-4 max-[960px]:text-[18px] opacity-0 transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.2,0,0,1)] group-hover/section:opacity-100 group-focus-visible/section:opacity-100 max-[960px]:opacity-100"
        style={{
          fontFamily: "'Luminous Symbols', sans-serif",
          fontWeight: 330,
          fontVariationSettings: '"FILL" 0, "wght" 330, "GRAD" 0, "opsz" 16, "ROND" 100',
        }}
      >
        {isExpanded ? 'keyboard_arrow_down' : 'keyboard_arrow_right'}
      </span>
    </button>
  );
};
