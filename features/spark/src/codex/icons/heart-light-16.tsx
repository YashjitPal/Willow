import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const heartLight16 = defineIconAsset({
  name: "heart-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 1.14209, y: 1.791016, width: 13.716064, height: 12.382813 },
    visualBounds: { x: 1.14209, y: 1.791016, width: 13.716064, height: 12.382813 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.14209, y: 1.791016, width: 13.716064, height: 12.382813 },
    center: { x: 8.000122, y: 7.982423 },
    insets: { top: 1.791016, right: 1.141846, bottom: 1.826171, left: 1.14209 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8.000122, y: 7.982423 },
      foreground: { x: 8.000122, y: 7.982423 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M10.6227 1.79305C12.8594 1.72165 14.8406 3.53638 14.858 6.06746C14.8748 8.51826 13.0735 11.4653 8.37658 14.0763C8.14339 14.2058 7.85687 14.2058 7.62365 14.0763C2.92672 11.4653 1.12547 8.51827 1.14221 6.06746C1.15961 3.53656 3.14009 1.72192 5.37658 1.79305C6.2699 1.82155 7.18162 2.15182 7.99963 2.82625C8.81766 2.15167 9.72929 1.82161 10.6227 1.79305ZM10.6559 2.84286C9.96125 2.86514 9.21887 3.13745 8.53185 3.75496C8.23013 4.02618 7.77014 4.0261 7.46838 3.75496C6.78117 3.13725 6.03818 2.86502 5.34338 2.84286C3.71381 2.79093 2.20538 4.11696 2.19201 6.07528C2.17941 7.95025 3.56002 10.5775 7.99963 13.0821C12.4396 10.5774 13.8208 7.95033 13.8082 6.07528C13.7948 4.11689 12.2855 2.79083 10.6559 2.84286Z" fill="currentColor"/>`,
});

export const HeartLight16Icon = createIconComponent(heartLight16);
