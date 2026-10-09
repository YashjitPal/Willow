import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const sidebarHiddenLight16 = defineIconAsset({
  name: "sidebar-hidden-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 1.474609, y: 2.307617, width: 13.050781, height: 11.383789 },
    visualBounds: { x: 1.474609, y: 2.307617, width: 13.050781, height: 11.383789 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.474609, y: 2.307617, width: 13.050781, height: 11.383789 },
    center: { x: 8, y: 7.999512 },
    insets: { top: 2.307617, right: 1.47461, bottom: 2.308594, left: 1.474609 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8, y: 7.999512 },
      foreground: { x: 8, y: 7.999512 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M4.66699 4.80859C4.95683 4.80873 5.19238 5.04412 5.19238 5.33398V10.667C5.19238 10.9569 4.95683 11.1923 4.66699 11.1924C4.37704 11.1924 4.1416 10.9569 4.1416 10.667V5.33398C4.1416 5.04403 4.37704 4.80859 4.66699 4.80859Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M11.5 2.30762C13.1707 2.30762 14.5254 3.66235 14.5254 5.33301V10.666C14.5254 12.3367 13.1707 13.6914 11.5 13.6914H4.5C2.82934 13.6914 1.47461 12.3367 1.47461 10.666V5.33301C1.47461 3.66235 2.82934 2.30762 4.5 2.30762H11.5ZM4.5 3.3584C3.40924 3.3584 2.52539 4.24225 2.52539 5.33301V10.666C2.52539 11.7568 3.40924 12.6416 4.5 12.6416H11.5C12.5908 12.6416 13.4746 11.7568 13.4746 10.666V5.33301C13.4746 4.24225 12.5908 3.3584 11.5 3.3584H4.5Z" fill="currentColor"/>`,
});

export const SidebarHiddenLight16Icon = createIconComponent(sidebarHiddenLight16);
