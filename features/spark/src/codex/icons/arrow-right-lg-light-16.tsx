import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const arrowRightLgLight16 = defineIconAsset({
  name: "arrow-right-lg-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 2.14209, y: 2.808594, width: 11.578125, height: 10.382324 },
    visualBounds: { x: 2.14209, y: 2.808594, width: 11.578125, height: 10.382324 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.14209, y: 2.808594, width: 11.578125, height: 10.382324 },
    center: { x: 7.931153, y: 7.999756 },
    insets: { top: 2.808594, right: 2.279785, bottom: 2.809082, left: 2.14209 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 7.931153, y: 7.999756 },
      foreground: { x: 7.931153, y: 7.999756 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M8.29541 2.96214C8.50038 2.75742 8.83263 2.7574 9.0376 2.96214L13.4692 7.3928L13.5278 7.45823C13.7842 7.77279 13.7842 8.22666 13.5278 8.54124L13.4692 8.60667L9.0376 13.0373C8.83256 13.2422 8.50038 13.2423 8.29541 13.0373C8.09082 12.8323 8.09067 12.5001 8.29541 12.2951L12.0669 8.52562H2.6665C2.37676 8.52544 2.14218 8.28999 2.14209 8.00022C2.14209 7.71038 2.3767 7.47501 2.6665 7.47483H12.0669L8.29541 3.70433C8.09071 3.49939 8.09078 3.16712 8.29541 2.96214Z" fill="currentColor"/>`,
});

export const ArrowRightLgLight16Icon = createIconComponent(arrowRightLgLight16);
