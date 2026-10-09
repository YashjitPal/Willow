import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const minusMdLight16 = defineIconAsset({
  name: "minus-md-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 2.474609, y: 7.474609, width: 11.050781, height: 1.050781 },
    visualBounds: { x: 2.474609, y: 7.474609, width: 11.050781, height: 1.050781 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.474609, y: 7.474609, width: 11.050781, height: 1.050781 },
    center: { x: 8, y: 8 },
    insets: { top: 7.474609, right: 2.47461, bottom: 7.47461, left: 2.474609 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8, y: 8 },
      foreground: { x: 8, y: 8 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M13 8.52539H3C2.71005 8.52539 2.47461 8.28995 2.47461 8C2.47461 7.71005 2.71005 7.47461 3 7.47461H13C13.2899 7.47461 13.5254 7.71005 13.5254 8C13.5254 8.28995 13.2899 8.52539 13 8.52539Z" fill="currentColor"/>`,
});

export const MinusMdLight16Icon = createIconComponent(minusMdLight16);
