import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const chevronDownMdLight12 = defineIconAsset({
  name: "chevron-down-md-light-12",
  canvas: {
    width: 12,
    height: 12,
    viewBox: "0 0 12 12",
    frame: { x: 0, y: 0, width: 12, height: 12 },
    inkBounds: { x: 2.599609, y: 4.599609, width: 6.800781, height: 3.697266 },
    visualBounds: { x: 2.599609, y: 4.599609, width: 6.800781, height: 3.697266 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.599609, y: 4.599609, width: 6.800781, height: 3.697266 },
    center: { x: 5.999999, y: 6.448242 },
    insets: { top: 4.599609, right: 2.59961, bottom: 3.703125, left: 2.599609 },
    anchors: {
      frame: { x: 6, y: 6 },
      ink: { x: 5.999999, y: 6.448242 },
      foreground: { x: 5.999999, y: 6.448242 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M8.71677 4.71677C8.87298 4.56056 9.12696 4.56056 9.28317 4.71677C9.43938 4.87298 9.43938 5.12696 9.28317 5.28317L6.45993 8.10642C6.20609 8.36023 5.79384 8.36023 5.54001 8.10642L2.71677 5.28317C2.56056 5.12696 2.56056 4.87298 2.71677 4.71677C2.87298 4.56056 3.12696 4.56056 3.28317 4.71677L5.99997 7.43356L8.71677 4.71677Z" fill="currentColor"/>`,
});

export const ChevronDownMdLight12Icon = createIconComponent(chevronDownMdLight12);
