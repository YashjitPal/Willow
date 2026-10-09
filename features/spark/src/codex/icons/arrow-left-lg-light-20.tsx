import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const arrowLeftLgLight20 = defineIconAsset({
  name: "arrow-left-lg-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 2.84082, y: 3.501953, width: 14.490234, height: 12.996582 },
    visualBounds: { x: 2.84082, y: 3.501953, width: 14.490234, height: 12.996582 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.84082, y: 3.501953, width: 14.490234, height: 12.996582 },
    center: { x: 10.085937, y: 10.000244 },
    insets: { top: 3.501953, right: 2.668946, bottom: 3.501465, left: 2.84082 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10.085937, y: 10.000244 },
      foreground: { x: 10.085937, y: 10.000244 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M8.6964 3.69651C8.95599 3.43701 9.37713 3.43719 9.63683 3.69651C9.89634 3.95619 9.89639 4.37729 9.63683 4.63694L4.93761 9.33518H16.6661C17.0333 9.33518 17.3311 9.63302 17.3312 10.0002C17.3312 10.3675 17.0334 10.6653 16.6661 10.6653H4.93761L9.63683 15.3625C9.8965 15.6222 9.89644 16.0442 9.63683 16.3039C9.37722 16.5634 8.95607 16.5632 8.6964 16.3039L3.15734 10.7649L3.08312 10.6828C2.76006 10.2864 2.76005 9.71401 3.08312 9.3176L3.15734 9.23459L8.6964 3.69651Z" fill="currentColor"/>`,
});

export const ArrowLeftLgLight20Icon = createIconComponent(arrowLeftLgLight20);
