import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const stopFillLight16 = defineIconAsset({
  name: "stop-fill-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 3.141235, y: 3.141113, width: 9.716797, height: 9.716797 },
    visualBounds: { x: 3.141235, y: 3.141113, width: 9.716797, height: 9.716797 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 3.141235, y: 3.141113, width: 9.716797, height: 9.716797 },
    center: { x: 7.999634, y: 7.999512 },
    insets: { top: 3.141113, right: 3.141968, bottom: 3.14209, left: 3.141235 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 7.999634, y: 7.999512 },
      foreground: { x: 7.999634, y: 7.999512 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M10.4664 3.14111C11.7872 3.14111 12.8578 4.21204 12.858 5.53271V10.4663C12.858 11.7872 11.7873 12.8579 10.4664 12.8579H5.53284C4.21217 12.8577 3.14124 11.787 3.14124 10.4663V5.53271C3.14148 4.2122 4.21232 3.14136 5.53284 3.14111H10.4664Z" fill="currentColor"/>`,
});

export const StopFillLight16Icon = createIconComponent(stopFillLight16);
