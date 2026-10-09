import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const arrowUpMdLight16 = defineIconAsset({
  name: "arrow-up-md-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 4.141602, y: 3.613281, width: 7.716309, height: 8.912109 },
    visualBounds: { x: 4.141602, y: 3.613281, width: 7.716309, height: 8.912109 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 4.141602, y: 3.613281, width: 7.716309, height: 8.912109 },
    center: { x: 7.999757, y: 8.069335 },
    insets: { top: 3.613281, right: 4.142089, bottom: 3.47461, left: 4.141602 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 7.999757, y: 8.069335 },
      foreground: { x: 7.999757, y: 8.069335 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M7.3928 3.86445C7.72786 3.52942 8.27144 3.52969 8.60667 3.86445L11.7043 6.96211C11.9091 7.16709 11.9091 7.49931 11.7043 7.7043C11.4994 7.90925 11.1672 7.90915 10.9621 7.7043L8.52562 5.26777V12.0002C8.52555 12.2901 8.29013 12.5256 8.00022 12.5256C7.71031 12.5256 7.4749 12.2901 7.47483 12.0002V5.2668L5.03733 7.7043C4.83231 7.9093 4.50017 7.90932 4.29515 7.7043C4.09056 7.49924 4.09028 7.16699 4.29515 6.96211L7.3928 3.86445Z" fill="currentColor"/>`,
});

export const ArrowUpMdLight16Icon = createIconComponent(arrowUpMdLight16);
