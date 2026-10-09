import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const sidebarHiddenBadgeLight16 = defineIconAsset({
  name: "sidebar-hidden-badge-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 1.474609, y: 0.806641, width: 14.296875, height: 12.885742 },
    visualBounds: { x: 1.474609, y: 0.806641, width: 14.296875, height: 12.885742 }
  },
  paint: {
    kind: "multicolor",
    layers: [
      {
        role: "foreground",
        color: "currentColor",
        bounds: { x: 1.474609, y: 2.308594, width: 13.050781, height: 11.383789 }
      },
      {
        role: "fixed",
        color: "#3A83F7",
        bounds: { x: 10.719727, y: 0.806641, width: 5.051758, height: 5.050781 }
      }
    ]
  },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.474609, y: 0.806641, width: 14.296875, height: 12.885742 },
    center: { x: 8.623047, y: 7.249512 },
    insets: { top: 0.806641, right: 0.228516, bottom: 2.307617, left: 1.474609 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8.623047, y: 7.249512 },
      foreground: { x: 8, y: 8.000488 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M8.33301 2.30859C8.62296 2.30859 8.8584 2.54403 8.8584 2.83398C8.8584 3.12393 8.62296 3.35938 8.33301 3.35938H4.5C3.40924 3.35938 2.52539 4.24322 2.52539 5.33398V10.667C2.52539 11.7578 3.40924 12.6426 4.5 12.6426H11.5C12.5908 12.6426 13.4746 11.7578 13.4746 10.667V8.33398C13.4746 8.04403 13.7101 7.80859 14 7.80859C14.2899 7.80859 14.5254 8.04403 14.5254 8.33398V10.667C14.5254 12.3377 13.1707 13.6924 11.5 13.6924H4.5C2.82934 13.6924 1.47461 12.3377 1.47461 10.667V5.33398C1.47461 3.66332 2.82934 2.30859 4.5 2.30859H8.33301Z" fill="currentColor"/> <path d="M4.66699 4.80859C4.95683 4.80873 5.19238 5.04412 5.19238 5.33398V10.667C5.19238 10.9569 4.95683 11.1923 4.66699 11.1924C4.37704 11.1924 4.1416 10.9569 4.1416 10.667V5.33398C4.1416 5.04403 4.37704 4.80859 4.66699 4.80859Z" fill="currentColor"/> <path d="M13.2461 0.806641C14.6404 0.806905 15.7715 1.93767 15.7715 3.33203C15.7715 4.72639 14.6404 5.85716 13.2461 5.85742C11.8516 5.85742 10.7197 4.72655 10.7197 3.33203C10.7197 1.93751 11.8516 0.806641 13.2461 0.806641Z" fill="#3A83F7"/>`,
});

export const SidebarHiddenBadgeLight16Icon = createIconComponent(sidebarHiddenBadgeLight16);
