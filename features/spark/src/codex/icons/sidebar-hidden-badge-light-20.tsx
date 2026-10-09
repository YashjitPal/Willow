import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const sidebarHiddenBadgeLight20 = defineIconAsset({
  name: "sidebar-hidden-badge-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 1.834961, y: 0.875977, width: 17.953125, height: 16.24707 },
    visualBounds: { x: 1.834961, y: 0.875977, width: 17.953125, height: 16.24707 }
  },
  paint: {
    kind: "multicolor",
    layers: [
      {
        role: "foreground",
        color: "currentColor",
        bounds: { x: 1.834961, y: 2.875977, width: 16.330078, height: 14.24707 }
      },
      {
        role: "fixed",
        color: "#3A83F7",
        bounds: { x: 13.458008, y: 0.875977, width: 6.330078, height: 6.330078 }
      }
    ]
  },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.834961, y: 0.875977, width: 17.953125, height: 16.24707 },
    center: { x: 10.811524, y: 8.999512 },
    insets: { top: 0.875977, right: 0.211914, bottom: 2.876953, left: 1.834961 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10.811524, y: 8.999512 },
      foreground: { x: 10, y: 9.999512 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M10.667 2.87598C11.0341 2.87615 11.332 3.17385 11.332 3.54102C11.332 3.90818 11.0341 4.20588 10.667 4.20605H5.5C4.21042 4.20605 3.16504 5.25143 3.16504 6.54102V13.458C3.16521 14.7474 4.21052 15.793 5.5 15.793H14.5C15.7895 15.793 16.8348 14.7474 16.835 13.458V10.166C16.835 9.79875 17.1327 9.50098 17.5 9.50098C17.8673 9.50098 18.165 9.79875 18.165 10.166V13.458C18.1649 15.482 16.524 17.123 14.5 17.123H5.5C3.47598 17.123 1.83514 15.482 1.83496 13.458V6.54102C1.83496 4.51689 3.47588 2.87598 5.5 2.87598H10.667Z" fill="currentColor"/> <path d="M5.83301 6.00098C6.20028 6.00098 6.49805 6.29875 6.49805 6.66602V13.333C6.49787 13.7001 6.20017 13.998 5.83301 13.998C5.46596 13.9979 5.16814 13.7 5.16797 13.333V6.66602C5.16797 6.29883 5.46585 6.00111 5.83301 6.00098Z" fill="currentColor"/> <path d="M16.623 0.875977C18.3709 0.876109 19.7881 2.29312 19.7881 4.04102C19.7881 5.78892 18.3709 7.20592 16.623 7.20605C14.8751 7.20605 13.458 5.789 13.458 4.04102C13.458 2.29303 14.8751 0.875977 16.623 0.875977Z" fill="#3A83F7"/>`,
});

export const SidebarHiddenBadgeLight20Icon = createIconComponent(sidebarHiddenBadgeLight20);
