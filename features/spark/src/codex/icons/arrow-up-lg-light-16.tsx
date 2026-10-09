import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const arrowUpLgLight16 = defineIconAsset({
  name: "arrow-up-lg-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 2.808594, y: 2.279785, width: 10.382568, height: 11.578125 },
    visualBounds: { x: 2.808594, y: 2.279785, width: 10.382568, height: 11.578125 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.808594, y: 2.279785, width: 10.382568, height: 11.578125 },
    center: { x: 7.999878, y: 8.068848 },
    insets: { top: 2.279785, right: 2.808838, bottom: 2.14209, left: 2.808594 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 7.999878, y: 8.068848 },
      foreground: { x: 7.999878, y: 8.068848 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M7.45819 2.4721C7.77271 2.21556 8.22656 2.2158 8.5412 2.4721L8.60663 2.53069L13.0373 6.96233C13.2423 7.16736 13.2423 7.49949 13.0373 7.70452C12.8322 7.90905 12.5 7.90938 12.2951 7.70452L8.52557 3.93401V13.3334C8.5254 13.6232 8.29002 13.8578 8.00018 13.8578C7.71034 13.8578 7.47497 13.6232 7.47479 13.3334V3.93206L3.70429 7.70452C3.49929 7.90915 3.16702 7.90927 2.9621 7.70452C2.75738 7.49959 2.75747 7.16732 2.9621 6.96233L7.39276 2.53069L7.45819 2.4721Z" fill="currentColor"/>`,
});

export const ArrowUpLgLight16Icon = createIconComponent(arrowUpLgLight16);
