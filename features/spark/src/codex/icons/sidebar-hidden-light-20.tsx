import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const sidebarHiddenLight20 = defineIconAsset({
  name: "sidebar-hidden-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 1.834961, y: 2.876953, width: 16.330078, height: 14.24707 },
    visualBounds: { x: 1.834961, y: 2.876953, width: 16.330078, height: 14.24707 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.834961, y: 2.876953, width: 16.330078, height: 14.24707 },
    center: { x: 10, y: 10.000488 },
    insets: { top: 2.876953, right: 1.834961, bottom: 2.875977, left: 1.834961 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10, y: 10.000488 },
      foreground: { x: 10, y: 10.000488 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M5.83301 6.00098C6.20028 6.00098 6.49805 6.29875 6.49805 6.66602V13.333C6.49787 13.7001 6.20017 13.998 5.83301 13.998C5.46596 13.9979 5.16814 13.7 5.16797 13.333V6.66602C5.16797 6.29883 5.46585 6.00111 5.83301 6.00098Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M14.5 2.87695C16.5241 2.87695 18.165 4.51787 18.165 6.54199V13.459C18.1649 15.483 16.524 17.124 14.5 17.124H5.5C3.47598 17.124 1.83514 15.483 1.83496 13.459V6.54199C1.83496 4.51787 3.47588 2.87695 5.5 2.87695H14.5ZM5.5 4.20703C4.21042 4.20703 3.16504 5.25241 3.16504 6.54199V13.459C3.16521 14.7484 4.21052 15.7939 5.5 15.7939H14.5C15.7895 15.7939 16.8348 14.7484 16.835 13.459V6.54199C16.835 5.25241 15.7896 4.20703 14.5 4.20703H5.5Z" fill="currentColor"/>`,
});

export const SidebarHiddenLight20Icon = createIconComponent(sidebarHiddenLight20);
