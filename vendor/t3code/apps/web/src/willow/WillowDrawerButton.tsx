/**
 * The button that opens the sidebar's drawer at Willow's compact width, as Willow's own does
 * (apps/studio StudioLayout's `.studio-sidebar-mobile-open`, Sidebar.css): 48px and round, 8px in
 * from the page's top left over its header, Gemini's 32px `menu` in Luminous Symbols at weight
 * 240. It goes while the drawer is open, whose scrim and rows close it again (sidebar.css).
 */
import { useSidebar } from "../components/ui/sidebar";

export function WillowDrawerButton() {
  const { isMobile, openMobile, setOpenMobile } = useSidebar();
  if (!isMobile || openMobile) return null;
  return (
    <button
      type="button"
      className="willow-drawer-open"
      aria-label="Open sidebar"
      onClick={() => setOpenMobile(true)}
    >
      <span className="willow-drawer-open__glyph" aria-hidden="true">
        menu
      </span>
    </button>
  );
}
