import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const playSmFillLight16 = defineIconAsset({
  name: "play-sm-fill-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 5.058105, y: 3.731934, width: 7.038147, height: 8.535889 },
    visualBounds: { x: 5.058105, y: 3.731934, width: 7.038147, height: 8.535889 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 5.058105, y: 3.731934, width: 7.038147, height: 8.535889 },
    center: { x: 8.577179, y: 7.999878 },
    insets: { top: 3.731934, right: 3.903748, bottom: 3.732177, left: 5.058105 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8.577179, y: 7.999878 },
      foreground: { x: 8.577179, y: 7.999878 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M5.05811 4.68948C5.05869 3.97957 5.79615 3.53377 6.4126 3.81936L6.53369 3.88675L11.6587 7.19632C12.2422 7.57315 12.242 8.42682 11.6587 8.80374L6.53369 12.1133C5.8972 12.524 5.05821 12.0672 5.05811 11.3096V4.68948Z" fill="currentColor"/>`,
});

export const PlaySmFillLight16Icon = createIconComponent(playSmFillLight16);
