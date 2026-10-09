import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const arrowCurvedRightLargeTypographicLight16 = defineIconAsset({
  name: "arrow-curved-right-large-typographic-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 1.849854, y: 3.25, width: 12.258545, height: 9.499512 },
    visualBounds: { x: 1.849854, y: 3.25, width: 12.258545, height: 9.499512 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.849854, y: 3.25, width: 12.258545, height: 9.499512 },
    center: { x: 7.979127, y: 7.999756 },
    insets: { top: 3.25, right: 1.891601, bottom: 3.250488, left: 1.849854 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 7.979127, y: 7.999756 },
      foreground: { x: 7.979127, y: 7.999756 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M2.39966 3.25C2.70341 3.25 2.94946 3.49605 2.94946 3.7998V7.5293C2.94946 8.03731 3.36141 8.44907 3.86938 8.44922H12.2717L10.011 6.18848C9.79632 5.97372 9.79635 5.6259 10.011 5.41113C10.2257 5.19637 10.5735 5.19642 10.7883 5.41113L13.9182 8.54004C14.1717 8.79376 14.1716 9.20517 13.9182 9.45898L10.7883 12.5889C10.5736 12.8032 10.2257 12.8032 10.011 12.5889C9.79632 12.3741 9.79635 12.0253 10.011 11.8105L12.2708 9.5498H3.86938C2.7539 9.54966 1.84985 8.64482 1.84985 7.5293V3.7998C1.84985 3.49605 2.0959 3.25 2.39966 3.25Z" fill="currentColor"/>`,
});

export const ArrowCurvedRightLargeTypographicLight16Icon = createIconComponent(arrowCurvedRightLargeTypographicLight16);
