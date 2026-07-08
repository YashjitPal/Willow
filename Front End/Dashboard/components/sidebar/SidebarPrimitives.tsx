import React from 'react';
import { ArrowUpRight } from 'lucide-react';

export const SidebarItem: React.FC<{ 
  icon?: React.ElementType; 
  label: string; 
  customLabel?: React.ReactNode;
  active?: boolean; 
  isCollapsed: boolean;
  onClick?: () => void;
  href?: string;
  actions?: React.ReactNode;
  keepActionsVisible?: boolean;
}> = ({ icon: Icon, label, customLabel, active, isCollapsed, onClick, href, actions, keepActionsVisible }) => (
  <div className="px-[14px]">
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
      className={`relative flex items-center h-[36px] w-full transition-colors duration-150 group/item overflow-hidden cursor-pointer outline-none
        ${active ? 'bg-[#1f1f1f] text-white' : 'text-white hover:bg-[#272729] hover:text-white'}
        rounded-xl`}
    >
      {Icon ? (
        <div className="flex items-center justify-center w-[36px] shrink-0">
          <Icon size={18} strokeWidth={active ? 2.2 : 2} className="transition-transform duration-200 group-active/item:scale-90" />
        </div>
      ) : (
        <div className="w-[9px] shrink-0" />
      )}
      <span className={`whitespace-nowrap text-[13.5px] font-medium tracking-tight transition-opacity duration-200 ease-linear ${isCollapsed ? 'opacity-0' : 'opacity-100'} flex-1 min-w-0 overflow-hidden text-ellipsis`}>
        {!isCollapsed && (customLabel || label)}
      </span>
      
      {href && !isCollapsed && (
        <div className="ml-auto pr-3 opacity-0 group-hover/item:opacity-100 transition-opacity flex items-center justify-center shrink-0">
          <ArrowUpRight size={16} strokeWidth={1.5} className="text-zinc-400 group-hover/item:text-white" />
        </div>
      )}

      {actions && !isCollapsed && (
        <div className={`ml-auto pr-2 transition-opacity flex items-center justify-center shrink-0 ${
          keepActionsVisible ? 'opacity-100' : 'opacity-0 group-hover/item:opacity-100'
        }`}>
          {actions}
        </div>
      )}

      {isCollapsed && (
        <div className="absolute left-[54px] ml-2 px-3 py-1.5 bg-[#18181b] text-white text-[12px] font-medium rounded-lg opacity-0 group-hover/item:opacity-100 pointer-events-none transition-opacity duration-200 whitespace-nowrap z-50 border border-white/5 shadow-2xl">
          {label}
        </div>
      )}
    </div>
  </div>
);

export const SidebarSkeleton: React.FC<{ isCollapsed: boolean }> = ({ isCollapsed }) => {
  return (
    <div className="px-[14px]">
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

export const SectionHeader: React.FC<{ title: string; isCollapsed: boolean }> = ({ title, isCollapsed }) => (
  <div className="h-[36px] mt-4 mb-0.5 flex items-center overflow-hidden" style={{ paddingLeft: '23px' }}>
    <span className={`text-[13.5px] font-medium text-white transition-opacity duration-150 ${isCollapsed ? 'opacity-0' : 'opacity-100'}`}>
      {!isCollapsed && title}
    </span>
  </div>
);
