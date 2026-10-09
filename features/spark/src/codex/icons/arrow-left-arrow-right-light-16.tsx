import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const arrowLeftArrowRightLight16 = defineIconAsset({
  name: "arrow-left-arrow-right-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 2.742676, y: 1.51709, width: 10.514648, height: 13.049316 },
    visualBounds: { x: 2.742676, y: 1.51709, width: 10.514648, height: 13.049316 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.742676, y: 1.51709, width: 10.514648, height: 13.049316 },
    center: { x: 8, y: 8.041748 },
    insets: { top: 1.51709, right: 2.742676, bottom: 1.433594, left: 2.742676 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8, y: 8.041748 },
      foreground: { x: 8, y: 8.041748 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M9.77686 8.34154C9.97974 8.13456 10.3119 8.13094 10.5191 8.33373L12.9995 10.7615L13.0601 10.8269C13.3232 11.1435 13.323 11.6059 13.0601 11.9226L12.9995 11.988L10.5191 14.4167C10.3119 14.6194 9.97969 14.6158 9.77686 14.4089C9.57423 14.2018 9.57773 13.8696 9.78468 13.6667L11.5894 11.9001H3.70851C3.41856 11.9001 3.18311 11.6647 3.18311 11.3747C3.18331 11.085 3.41868 10.8494 3.70851 10.8494H11.5884L9.78468 9.08373C9.57762 8.88099 9.57435 8.54874 9.77686 8.34154Z" fill="currentColor"/> <path d="M5.48097 1.66674C5.68804 1.46414 6.02032 1.46775 6.22315 1.67455C6.42562 1.88169 6.42224 2.21398 6.21534 2.41674L4.41065 4.18334H12.3755C12.6653 4.18354 12.9009 4.41891 12.9009 4.70873C12.9008 4.9985 12.6652 5.23392 12.3755 5.23412H4.41163L6.21534 6.99975C6.42224 7.20251 6.42563 7.5348 6.22315 7.74194C6.02035 7.94904 5.68814 7.95243 5.48097 7.74975L3.0005 5.32104L2.93995 5.25561C2.6771 4.9388 2.67673 4.4765 2.93995 4.1599L3.0005 4.09447L5.48097 1.66674Z" fill="currentColor"/>`,
});

export const ArrowLeftArrowRightLight16Icon = createIconComponent(arrowLeftArrowRightLight16);
