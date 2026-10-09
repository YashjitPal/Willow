/**
 * The Media rail: All Media … Uploads, Tools with its dock, Trash and Collapse. Drawn by
 * MediaView, and by the Tools pages, which sit over the editor and show the same rail in the same
 * place so moving between them never shifts it.
 *
 * Flow's expanded rail: 212x48 rows inset 16px, 16px radius, on a 52.8px pitch, with a 24px glyph
 * 12px in and the label 16px past it at 14px/20px weight 500. Collapsing drops the label and
 * narrows the panel to 80px, which leaves a 48px content column and turns the row into a 48x48
 * square; the glyph stays at x=28 either way (see MediaView's history of these numbers).
 *
 * The dock is Flow's `tools-sublist`: under Tools, the pinned tools and then the ones opened
 * lately, five at most and "and N more" past that, behind the Tools row's chevron (shown once
 * there is anything to list). Each row is 40px: the tool's 32px icon 8px in, its name, and a
 * pin button that pins or unpins it.
 *
 * Every row is a button or a link, never a bare element: MediaView starts a marquee selection on
 * a press over anything else, and the marquee turns the rail's pointer events off, so the click
 * never arrives. The Tools row and dock rows are links, as Flow's are, with their buttons inside.
 *
 * Below 961px the rail is Willow's drawer (`media-responsive.css`): on a phone it is not drawn in
 * place at all and opens from the header's menu button; on a tablet the collapsed icon column
 * stays, and its last row opens the full rail as the drawer. The drawer starts with Home, since a
 * phone's header has no room for it, and has no Collapse.
 */
import React from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import {
  AllMediaIcon,
  ImagesIcon,
  VideoIcon,
  UploadsIcon,
  CharactersIcon,
  MusicIcon,
  ScenesIcon,
  ToolsIcon,
  TrashIcon,
  CollapseIcon,
} from './media-icons';

export interface DockTool {
  id: string;
  name: string;
  icon: string;
  pinned: boolean;
}

export interface MediaSidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** 'all', 'images', 'video', 'characters', 'music', 'scenes', 'uploads' or 'tools'. */
  activeTab: string;
  /** The Tools manager is open (Tools is the selected row). */
  toolsActive?: boolean;
  onNavigate: (tab: string) => void;
  /** Where the Tools row and a dock row lead, so they are links (a new tab on Ctrl or middle click). */
  toolsHref?: string;
  toolHref?: (id: string) => string;
  /** The nav's slide when Media's header hides on scroll. */
  navStyle?: React.CSSProperties;
  /** Room above the first row: Media's header overlays the rail, the Tools pages' does not. */
  topInset?: number;
  trashDropActive?: boolean;
  dock?: { items: DockTool[]; more: number; total: number };
  dockOpen?: boolean;
  onToggleDock?: () => void;
  /** The tool open now, whose dock row is selected. */
  activeToolId?: string | null;
  onOpenTool?: (id: string) => void;
  onTogglePin?: (id: string) => void;
  /** Below 961px: `rail` on a tablet (the icon column, opening the drawer), `drawer` on a phone. */
  presentation?: 'desktop' | 'rail' | 'drawer';
  drawerOpen?: boolean;
  onDrawerOpenChange?: (open: boolean) => void;
  /** The drawer's Home row: back to Willow. */
  onHome?: () => void;
}

const SELECTED = 'bg-[rgba(218,220,224,0.25)] !text-white';
const HOVER = 'hover:bg-[#171717]';

export const MediaSidebar: React.FC<MediaSidebarProps> = (props) => {
  const { collapsed, presentation = 'desktop', drawerOpen = false, onDrawerOpenChange, onHome, topInset = 76 } = props;
  if (presentation === 'desktop') {
    return (
      <aside
        className={`${collapsed ? 'w-[80px] px-4' : 'w-[232px] pl-4 pr-px'} flex flex-col justify-between pb-2 shrink-0 relative z-[75]`}
        style={{ paddingTop: topInset }}
      >
        <RailRows {...props} />
      </aside>
    );
  }
  const close = () => onDrawerOpenChange?.(false);
  const drawer = (
    <>
      <div
        className={`media-drawer-scrim${drawerOpen ? ' is-open' : ''}`}
        onClick={close}
        aria-hidden="true"
      />
      <aside
        className={`media-drawer${drawerOpen ? ' is-open' : ''}`}
        aria-label="Media"
        aria-hidden={drawerOpen ? undefined : true}
        inert={!drawerOpen}
      >
        <div className="media-drawer-head">
          <button type="button" className="media-drawer-home" onClick={() => { close(); onHome?.(); }} aria-label="Home">
            <MaterialSymbol name="home" family="google-symbols" size={24} weight={400} variationSettings='"FILL" 0, "wght" 300' />
            <span>Home</span>
          </button>
          <button type="button" className="media-drawer-close" onClick={close} aria-label="Close menu">
            <MaterialSymbol name="close" family="google-symbols" size={24} weight={400} variationSettings='"FILL" 0, "wght" 300' />
          </button>
        </div>
        <RailRows {...props} collapsed={false} inDrawer onNavigate={(tab) => { close(); props.onNavigate(tab); }} />
      </aside>
    </>
  );
  if (presentation === 'drawer') return drawer;
  return (
    <>
      <aside className="media-rail w-[80px] flex flex-col justify-between pb-2 px-4 shrink-0 relative z-[75]" style={{ paddingTop: topInset }}>
        <RailRows {...props} collapsed onExpand={() => onDrawerOpenChange?.(true)} />
      </aside>
      {drawer}
    </>
  );
};

/** The rail's two navs: the tabs, Tools and its dock above; Trash and Collapse below. */
const RailRows: React.FC<MediaSidebarProps & { inDrawer?: boolean; onExpand?: () => void }> = ({
  collapsed,
  onToggleCollapsed,
  activeTab,
  toolsActive = false,
  onNavigate,
  toolsHref,
  toolHref,
  navStyle,
  trashDropActive = false,
  dock,
  dockOpen = false,
  onToggleDock,
  activeToolId = null,
  onOpenTool,
  onTogglePin,
  inDrawer = false,
  onExpand,
}) => {
  const row = (selected: boolean) =>
    // `!` because the row's base colour is an arbitrary value; without it the two classes tie on
    // specificity and Tailwind's output order decides, which put the dimmed colour on the selected row.
    `flex items-center ${collapsed ? 'justify-center' : 'gap-4 pl-3 pr-4'} h-12 ${selected ? SELECTED : HOVER} rounded-2xl text-[#e8eaed] transition-colors group`;
  const tab = (id: string, label: string, icon: React.ReactNode) => (
    <button onClick={() => onNavigate(id)} className={row(!toolsActive && !activeToolId && activeTab === id)} aria-label={collapsed ? label : undefined}>
      {icon}
      {!collapsed && <span className="text-[14px] leading-5 font-medium">{label}</span>}
    </button>
  );
  const hasDock = !!dock && dock.total > 0;
  return (
    <>
      <nav className="flex flex-col gap-[4.8px]" style={inDrawer ? undefined : navStyle}>
        {tab('all', 'All Media', <AllMediaIcon />)}
        {tab('images', 'Images', <ImagesIcon />)}
        {tab('video', 'Video', <VideoIcon />)}
        {tab('characters', 'Characters', <CharactersIcon />)}
        {tab('music', 'Music', <MusicIcon />)}
        {tab('scenes', 'Scenes', <ScenesIcon />)}
        {tab('uploads', 'Uploads', <UploadsIcon />)}

        {/* Flow runs this rule the full width of a row when expanded, and pulls it in to a
          * 32px stub — 8px either side of the 48px column — when collapsed. */}
        <div className={`h-[1px] bg-white/20 ${collapsed ? 'mx-2' : 'mx-0'} my-2`} />

        <a
          href={toolsHref}
          aria-current={toolsActive ? 'page' : undefined}
          aria-label={collapsed ? 'Tools' : undefined}
          onClick={(e) => {
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            onNavigate('tools');
          }}
          className={`${row(toolsActive)} cursor-pointer ${hasDock && !collapsed ? '!pr-2' : ''}`}
        >
          <ToolsIcon />
          {!collapsed && <span className="text-[14px] leading-5 font-medium flex-1">Tools</span>}
          {!collapsed && hasDock && (
            <button
              type="button"
              aria-label="Toggle tools"
              title="Toggle tools"
              className="w-[34px] h-[34px] rounded-full flex items-center justify-center text-[#e3e3e3] hover:bg-white/[0.08] shrink-0"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleDock?.(); }}
            >
              <MaterialSymbol name={dockOpen ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} family="google-symbols" size={18} weight={400} variationSettings='"FILL" 0, "wght" 400' />
            </button>
          )}
        </a>

        {hasDock && dockOpen && (
          <div className="flex flex-col gap-[4.8px]">
            {dock!.items.map((tool) => (
              <a
                key={tool.id}
                href={toolHref?.(tool.id)}
                aria-label={tool.name}
                aria-current={activeToolId === tool.id ? 'page' : undefined}
                title={collapsed ? tool.name : undefined}
                onClick={(e) => {
                  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                  e.preventDefault();
                  onOpenTool?.(tool.id);
                }}
                className={`flex items-center ${collapsed ? 'justify-center' : 'pl-2 pr-2'} h-10 ${activeToolId === tool.id ? SELECTED : HOVER} rounded-2xl text-[#e8eaed] transition-colors cursor-pointer`}
              >
                <img src={tool.icon} alt="" className="w-8 h-8 rounded-[10px] object-cover shrink-0" draggable={false} />
                {!collapsed && <span className="ml-3 text-[14px] leading-5 font-medium flex-1 min-w-0 truncate">{tool.name}</span>}
                {!collapsed && (
                  <button
                    type="button"
                    aria-label={tool.pinned ? 'Unpin' : 'Pin'}
                    title={tool.pinned ? 'Unpin' : 'Pin'}
                    className="w-[34px] h-[34px] rounded-full flex items-center justify-center text-[#e3e3e3] hover:bg-white/[0.08] shrink-0"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onTogglePin?.(tool.id); }}
                  >
                    <MaterialSymbol name="push_pin" family="google-symbols" size={18} weight={400} variationSettings={`"FILL" ${tool.pinned ? 1 : 0}, "wght" 400`} />
                  </button>
                )}
              </a>
            ))}
            {dock!.more > 0 && (collapsed ? (
              <div className="mx-auto w-10 h-10 rounded-xl bg-white/[0.15] flex items-center justify-center text-[14px] font-medium text-[#e8eaed] select-none" title={`and ${dock!.more} more`}>
                +{dock!.more}
              </div>
            ) : (
              <div className="flex items-center gap-3 py-3 pl-3 pr-4 text-[12px] leading-4 text-[#5f6368] select-none before:content-[''] before:flex-1 before:h-px before:bg-[#3c4043] before:opacity-[0.35] after:content-[''] after:flex-1 after:h-px after:bg-[#3c4043] after:opacity-[0.35]">
                and {dock!.more} more
              </div>
            ))}
          </div>
        )}
      </nav>

      <nav className="flex flex-col gap-[4.8px] mb-2">
        <button
          data-drop-trash
          className={`${row(false)}${trashDropActive ? ' dg-trash-target' : ''}`}
          aria-label={collapsed ? 'Trash' : undefined}
        >
          <TrashIcon />
          {!collapsed && <span className="text-[14px] leading-5 font-medium">Trash</span>}
        </button>
        {onExpand ? (
          <button onClick={onExpand} className={row(false)} aria-label="Open menu">
            <MaterialSymbol name="menu" family="google-symbols" size={24} weight={400} variationSettings='"FILL" 0, "wght" 300' />
          </button>
        ) : !inDrawer && (
          <button onClick={onToggleCollapsed} className={row(false)}>
            <CollapseIcon />
            {!collapsed && <span className="text-[14px] leading-5 font-medium">Collapse</span>}
          </button>
        )}
      </nav>
    </>
  );
};
