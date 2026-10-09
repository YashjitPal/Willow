import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const plusLgRegular16 = defineIconAsset({
  name: "plus-lg-regular-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 1.916504, y: 1.916504, width: 12.166992, height: 12.166992 },
    visualBounds: { x: 1.916504, y: 1.916504, width: 12.166992, height: 12.166992 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.916504, y: 1.916504, width: 12.166992, height: 12.166992 },
    center: { x: 8, y: 8 },
    insets: { top: 1.916504, right: 1.916504, bottom: 1.916504, left: 1.916504 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8, y: 8 },
      foreground: { x: 8, y: 8 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M8.00049 1.9165C8.41448 1.91677 8.75049 2.25245 8.75049 2.6665V7.25049H13.3335C13.7476 7.25066 14.0835 7.58638 14.0835 8.00049C14.0832 8.41437 13.7474 8.75031 13.3335 8.75049H8.75049V13.3335C8.75031 13.7474 8.41437 14.0832 8.00049 14.0835C7.58638 14.0835 7.25066 13.7476 7.25049 13.3335V8.75049H2.6665C2.25245 8.75049 1.91677 8.41448 1.9165 8.00049C1.9165 7.58627 2.25229 7.25049 2.6665 7.25049H7.25049V2.6665C7.25049 2.25229 7.58627 1.9165 8.00049 1.9165Z" fill="currentColor"/>`,
});

export const PlusLgRegular16Icon = createIconComponent(plusLgRegular16);
