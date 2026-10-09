import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const arrowUpLgLight20 = defineIconAsset({
  name: "arrow-up-lg-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 3.501465, y: 2.84082, width: 12.996582, height: 14.490234 },
    visualBounds: { x: 3.501465, y: 2.84082, width: 12.996582, height: 14.490234 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 3.501465, y: 2.84082, width: 12.996582, height: 14.490234 },
    center: { x: 9.999756, y: 10.085937 },
    insets: { top: 2.84082, right: 3.501953, bottom: 2.668946, left: 3.501465 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 9.999756, y: 10.085937 },
      foreground: { x: 9.999756, y: 10.085937 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M9.31697 3.08317C9.71331 2.75987 10.2857 2.76021 10.6822 3.08317L10.7652 3.15739L16.3033 8.69645C16.563 8.95614 16.563 9.37718 16.3033 9.63688C16.0436 9.89642 15.6225 9.89653 15.3629 9.63688L10.6656 4.93864V16.6662C10.6656 17.0333 10.3676 17.331 10.0006 17.3312C9.6333 17.3312 9.33553 17.0334 9.33553 16.6662V4.93669L4.63728 9.63688C4.37759 9.89658 3.95558 9.89658 3.69588 9.63688C3.43668 9.37726 3.43664 8.95604 3.69588 8.69645L9.23494 3.15739L9.31697 3.08317Z" fill="currentColor"/>`,
});

export const ArrowUpLgLight20Icon = createIconComponent(arrowUpLgLight20);
