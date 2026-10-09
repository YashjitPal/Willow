import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const chevronDownSmLight16 = defineIconAsset({
  name: "chevron-down-sm-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 4.808594, y: 6.391602, width: 6.382813, height: 3.578125 },
    visualBounds: { x: 4.808594, y: 6.391602, width: 6.382813, height: 3.578125 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 4.808594, y: 6.391602, width: 6.382813, height: 3.578125 },
    center: { x: 8.000001, y: 8.180664 },
    insets: { top: 6.391602, right: 4.808593, bottom: 6.030273, left: 4.808594 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8.000001, y: 8.180664 },
      foreground: { x: 8.000001, y: 8.180664 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M10.2954 6.54537C10.5003 6.3404 10.8325 6.34051 11.0376 6.54537C11.2426 6.7504 11.2426 7.08253 11.0376 7.28756L8.60689 9.71822C8.27169 10.0534 7.72823 10.0534 7.39303 9.71822L4.96236 7.28756C4.75734 7.08253 4.75734 6.7504 4.96236 6.54537C5.16739 6.34035 5.49952 6.34035 5.70455 6.54537L7.99947 8.84029L10.2954 6.54537Z" fill="currentColor"/>`,
});

export const ChevronDownSmLight16Icon = createIconComponent(chevronDownSmLight16);
