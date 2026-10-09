import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const arrowCurvedpathLeftLgLight20 = defineIconAsset({
  name: "arrow-curvedpath-left-lg-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 3.709229, y: 5.168457, width: 12.746338, height: 9.663574 },
    visualBounds: { x: 3.709229, y: 5.168457, width: 12.746338, height: 9.663574 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 3.709229, y: 5.168457, width: 12.746338, height: 9.663574 },
    center: { x: 10.082398, y: 10.000244 },
    insets: { top: 5.168457, right: 3.544433, bottom: 5.167969, left: 3.709229 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10.082398, y: 10.000244 },
      foreground: { x: 10.082398, y: 10.000244 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M15.7905 5.16846C16.1578 5.16846 16.4555 5.46623 16.4555 5.8335V9.20166C16.4555 9.85382 16.2421 10.4503 15.8071 10.8853C15.3721 11.3202 14.7756 11.5337 14.1235 11.5337H5.80709L7.97017 13.6968C8.22982 13.9564 8.22971 14.3775 7.97017 14.6372C7.71044 14.8965 7.28932 14.8968 7.02974 14.6372L4.05025 11.6577C3.59545 11.2029 3.59566 10.4652 4.05025 10.0103L7.02974 7.02979C7.2894 6.77048 7.71056 6.7704 7.97017 7.02979C8.22987 7.28948 8.22987 7.71149 7.97017 7.97119L5.73677 10.2036H14.1235C14.4848 10.2036 14.7217 10.0897 14.8667 9.94482C15.0116 9.79986 15.1254 9.56299 15.1254 9.20166V5.8335C15.1254 5.46629 15.4233 5.16856 15.7905 5.16846Z" fill="currentColor"/>`,
});

export const ArrowCurvedpathLeftLgLight20Icon = createIconComponent(arrowCurvedpathLeftLgLight20);
