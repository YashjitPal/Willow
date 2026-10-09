import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const plusMdLight16 = defineIconAsset({
  name: "plus-md-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 2.474609, y: 2.474609, width: 11.050781, height: 11.050781 },
    visualBounds: { x: 2.474609, y: 2.474609, width: 11.050781, height: 11.050781 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.474609, y: 2.474609, width: 11.050781, height: 11.050781 },
    center: { x: 8, y: 8 },
    insets: { top: 2.474609, right: 2.47461, bottom: 2.47461, left: 2.474609 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8, y: 8 },
      foreground: { x: 8, y: 8 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M8 2.47461C8.28995 2.47461 8.52539 2.71005 8.52539 3V7.47461H13C13.2899 7.47461 13.5254 7.71005 13.5254 8C13.5254 8.28995 13.2899 8.52539 13 8.52539H8.52539V13C8.52539 13.2899 8.28995 13.5254 8 13.5254C7.71005 13.5254 7.47461 13.2899 7.47461 13V8.52539H3C2.71005 8.52539 2.47461 8.28995 2.47461 8C2.47461 7.71005 2.71005 7.47461 3 7.47461H7.47461V3C7.47461 2.71005 7.71005 2.47461 8 2.47461Z" fill="currentColor"/>`,
});

export const PlusMdLight16Icon = createIconComponent(plusMdLight16);
