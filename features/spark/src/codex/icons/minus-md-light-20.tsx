import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const minusMdLight20 = defineIconAsset({
  name: "minus-md-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 3.334961, y: 9.334961, width: 13.330078, height: 1.330078 },
    visualBounds: { x: 3.334961, y: 9.334961, width: 13.330078, height: 1.330078 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 3.334961, y: 9.334961, width: 13.330078, height: 1.330078 },
    center: { x: 10, y: 10 },
    insets: { top: 9.334961, right: 3.334961, bottom: 9.334961, left: 3.334961 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10, y: 10 },
      foreground: { x: 10, y: 10 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M16 10.665H4C3.63273 10.665 3.33496 10.3673 3.33496 10C3.33496 9.63273 3.63273 9.33496 4 9.33496H16C16.3673 9.33496 16.665 9.63273 16.665 10C16.665 10.3673 16.3673 10.665 16 10.665Z" fill="currentColor"/>`,
});

export const MinusMdLight20Icon = createIconComponent(minusMdLight20);
