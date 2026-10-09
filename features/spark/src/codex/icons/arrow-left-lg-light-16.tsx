import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const arrowLeftLgLight16 = defineIconAsset({
  name: "arrow-left-lg-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 2.279785, y: 2.808594, width: 11.578125, height: 10.382324 },
    visualBounds: { x: 2.279785, y: 2.808594, width: 11.578125, height: 10.382324 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.279785, y: 2.808594, width: 11.578125, height: 10.382324 },
    center: { x: 8.068848, y: 7.999756 },
    insets: { top: 2.808594, right: 2.14209, bottom: 2.809082, left: 2.279785 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8.068848, y: 7.999756 },
      foreground: { x: 8.068848, y: 7.999756 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M6.96231 2.96214C7.16727 2.7574 7.49953 2.75742 7.7045 2.96214C7.90913 3.16712 7.9092 3.49939 7.7045 3.70433L3.93301 7.47483H13.3334C13.6232 7.47501 13.8578 7.71038 13.8578 8.00022C13.8577 8.28999 13.6232 8.52544 13.3334 8.52562H3.93301L7.7045 12.2951C7.90924 12.5001 7.90909 12.8323 7.7045 13.0373C7.49953 13.2423 7.16735 13.2422 6.96231 13.0373L2.53067 8.60667L2.47208 8.54124C2.21571 8.22666 2.21566 7.77279 2.47208 7.45823L2.53067 7.3928L6.96231 2.96214Z" fill="currentColor"/>`,
});

export const ArrowLeftLgLight16Icon = createIconComponent(arrowLeftLgLight16);
