import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const stopSmFillRegular28 = defineIconAsset({
  name: "stop-sm-fill-regular-28",
  canvas: {
    width: 28,
    height: 28,
    viewBox: "0 0 28 28",
    frame: { x: 0, y: 0, width: 28, height: 28 },
    inkBounds: { x: 7.583374, y: 7.583252, width: 12.833374, height: 12.833252 },
    visualBounds: { x: 7.583374, y: 7.583252, width: 12.833374, height: 12.833252 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 7.583374, y: 7.583252, width: 12.833374, height: 12.833252 },
    center: { x: 14.000061, y: 13.999878 },
    insets: { top: 7.583252, right: 7.583252, bottom: 7.583496, left: 7.583374 },
    anchors: {
      frame: { x: 14, y: 14 },
      ink: { x: 14.000061, y: 13.999878 },
      foreground: { x: 14.000061, y: 13.999878 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M7.58333 9.04171C7.58333 8.23629 8.23625 7.58337 9.04167 7.58337H18.9583C19.7637 7.58337 20.4167 8.23629 20.4167 9.04171V18.9584C20.4167 19.7638 19.7637 20.4167 18.9583 20.4167H9.04167C8.23625 20.4167 7.58333 19.7638 7.58333 18.9584V9.04171Z" fill="currentColor"/>`,
});

export const StopSmFillRegular28Icon = createIconComponent(stopSmFillRegular28);
