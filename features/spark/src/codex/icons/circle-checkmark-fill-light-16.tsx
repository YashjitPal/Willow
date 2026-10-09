import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const circleCheckmarkFillLight16 = defineIconAsset({
  name: "circle-checkmark-fill-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 1.474609, y: 1.474609, width: 13.050781, height: 13.050781 },
    visualBounds: { x: 1.474609, y: 1.474609, width: 13.050781, height: 13.050781 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "circular",
    bounds: { x: 1.474609, y: 1.474609, width: 13.050781, height: 13.050781 },
    center: { x: 8, y: 8 },
    insets: { top: 1.474609, right: 1.47461, bottom: 1.47461, left: 1.474609 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8, y: 8 },
      foreground: { x: 8, y: 8 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M8 1.47461C11.6037 1.47461 14.5254 4.39634 14.5254 8C14.5254 11.6037 11.6037 14.5254 8 14.5254C4.39634 14.5254 1.47461 11.6037 1.47461 8C1.47461 4.39634 4.39634 1.47461 8 1.47461ZM10.5547 5.66016C10.3139 5.49907 9.98754 5.56401 9.82617 5.80469L7.30664 9.56152L6.12109 8.29004C5.92328 8.07816 5.59087 8.06689 5.37891 8.26465C5.16712 8.46247 5.15579 8.7949 5.35352 9.00684L6.77637 10.5312C7.11686 10.8962 7.70825 10.849 7.98633 10.4346L10.6992 6.38867C10.8603 6.14789 10.7954 5.82152 10.5547 5.66016Z" fill="currentColor"/>`,
});

export const CircleCheckmarkFillLight16Icon = createIconComponent(circleCheckmarkFillLight16);
