import React from 'react';
import { ArrowUpRight } from 'lucide-react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';

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
}> = ({ icon: Icon, symbol, label, customLabel, active, isCollapsed, onClick, href, actions, keepActionsVisible }) => (
  <div className="px-1.5">
    <div 
      role="button"
      tabIndex={0}
      onClick={href ? () => window.open(href, '_blank') : onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if (href) window.open(href, '_blank');
          else if (onClick) onClick();
        }
      }}
      className={`relative flex h-8 items-center transition-colors duration-150 group/item cursor-pointer outline-none
        ${isCollapsed ? 'ml-1 mr-0 w-8 gap-0 px-1.5 overflow-visible' : `mx-auto w-full gap-1.5 ${!Icon && !symbol ? 'pl-[8px] pr-1.5' : 'px-1.5'} overflow-hidden`}
        ${active ? 'bg-[#171717] text-[#e6e6e6] hover:bg-[#171717]' : 'text-[#e6e6e6] hover:bg-[rgba(230,230,230,0.08)] hover:text-[#e6e6e6]'}
        rounded-full`}
    >
      {symbol ? (
        <div className={`${isCollapsed ? 'h-5 w-5' : 'h-7 w-7'} flex items-center justify-center shrink-0`}>
          <MaterialSymbol
            family="luminous"
            name={symbol}
            size={20}
            opticalSize={20}
            fill={active}
            className="transition-transform duration-200 group-active/item:scale-90"
          />
        </div>
      ) : Icon ? (
        <div className={`${isCollapsed ? 'h-5 w-5' : 'h-7 w-7'} flex items-center justify-center shrink-0 ml-[2px]`}>
          <Icon size={20} strokeWidth={active ? 2 : 1.85} className="transition-transform duration-200 group-active/item:scale-90" />
        </div>
      ) : null}
      {!isCollapsed && (
        <span className={`whitespace-nowrap text-[13px] leading-[17px] transition-opacity duration-200 ease-linear ${active ? 'font-medium text-white' : 'font-normal text-[#e6e6e6]'} opacity-100 flex-1 min-w-0 overflow-hidden text-ellipsis`}>
          {customLabel || label}
        </span>
      )}
      
      {href && !isCollapsed && (
        <div className="ml-auto pr-3 opacity-0 group-hover/item:opacity-100 transition-opacity flex items-center justify-center shrink-0">
          <ArrowUpRight size={16} strokeWidth={1.5} className="text-zinc-400 group-hover/item:text-white" />
        </div>
      )}

      {actions && !isCollapsed && (
        <div className={`ml-auto pr-0.5 flex items-center justify-center shrink-0 ${
          keepActionsVisible ? 'opacity-100' : 'max-w-0 overflow-hidden opacity-0 group-hover/item:max-w-none group-hover/item:overflow-visible group-hover/item:opacity-100'
        }`}>
          {actions}
        </div>
      )}

      {isCollapsed && (
        <div className="absolute left-[46px] ml-2 px-3 py-1.5 bg-[#18181b] text-white text-[12px] font-medium rounded-lg opacity-0 group-hover/item:opacity-100 pointer-events-none transition-opacity duration-200 whitespace-nowrap z-50 border border-white/5 shadow-2xl">
          {label}
        </div>
      )}
    </div>
  </div>
);

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
      className="group/section mt-3 flex h-8 w-[calc(100%-12px)] items-center gap-1 overflow-hidden pl-[14px] pr-1.5 text-left text-[13px] leading-[17px] font-normal text-white/55 outline-none"
    >
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <span
        aria-hidden="true"
        className="luminous-symbols inline-flex h-4 w-4 shrink-0 items-center justify-center text-[16px] leading-4 opacity-0 transition-opacity duration-200 group-hover/section:opacity-100 group-focus-visible/section:opacity-100"
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
