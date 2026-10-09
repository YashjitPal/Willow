import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const arrowDownLgLight16 = defineIconAsset({
  name: "arrow-down-lg-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 2.808594, y: 2.141602, width: 10.382568, height: 11.578613 },
    visualBounds: { x: 2.808594, y: 2.141602, width: 10.382568, height: 11.578613 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.808594, y: 2.141602, width: 10.382568, height: 11.578613 },
    center: { x: 7.999878, y: 7.930909 },
    insets: { top: 2.141602, right: 2.808838, bottom: 2.279785, left: 2.808594 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 7.999878, y: 7.930909 },
      foreground: { x: 7.999878, y: 7.930909 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M8.00022 2.1416C8.29017 2.1416 8.52562 2.37704 8.52562 2.66699V12.0645L12.2951 8.2959C12.5 8.091 12.8323 8.09124 13.0373 8.2959C13.2424 8.50092 13.2424 8.83306 13.0373 9.03809L8.60667 13.4688C8.27145 13.8037 7.72792 13.8039 7.3928 13.4688L2.96214 9.03809C2.7574 8.83313 2.75743 8.50087 2.96214 8.2959C3.1671 8.09094 3.49928 8.09108 3.70433 8.2959L7.47483 12.0664V2.66699C7.47483 2.37708 7.71033 2.14167 8.00022 2.1416Z" fill="currentColor"/>`,
});

export const ArrowDownLgLight16Icon = createIconComponent(arrowDownLgLight16);
