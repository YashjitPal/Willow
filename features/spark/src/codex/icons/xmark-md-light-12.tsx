import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const xmarkMdLight12 = defineIconAsset({
  name: "xmark-md-light-12",
  canvas: {
    width: 12,
    height: 12,
    viewBox: "0 0 12 12",
    frame: { x: 0, y: 0, width: 12, height: 12 },
    inkBounds: { x: 3.09964, y: 3.099609, width: 5.80072, height: 5.800659 },
    visualBounds: { x: 3.09964, y: 3.099609, width: 5.80072, height: 5.800659 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 3.09964, y: 3.099609, width: 5.80072, height: 5.800659 },
    center: { x: 6, y: 5.999939 },
    insets: { top: 3.099609, right: 3.09964, bottom: 3.099732, left: 3.09964 },
    anchors: {
      frame: { x: 6, y: 6 },
      ink: { x: 6, y: 5.999939 },
      foreground: { x: 6, y: 5.999939 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M8.21677 3.21677C8.37298 3.06056 8.62696 3.06056 8.78317 3.21677C8.93935 3.37298 8.93937 3.62697 8.78317 3.78317L6.56638 5.99997L8.78317 8.21677C8.93935 8.37298 8.93937 8.62697 8.78317 8.78317C8.62697 8.93937 8.37298 8.93935 8.21677 8.78317L5.99997 6.56638L3.78317 8.78317C3.62697 8.93937 3.37298 8.93935 3.21677 8.78317C3.06056 8.62696 3.06056 8.37298 3.21677 8.21677L5.43356 5.99997L3.21677 3.78317C3.06056 3.62696 3.06056 3.37298 3.21677 3.21677C3.37298 3.06056 3.62696 3.06056 3.78317 3.21677L5.99997 5.43356L8.21677 3.21677Z" fill="currentColor"/>`,
});

export const XmarkMdLight12Icon = createIconComponent(xmarkMdLight12);
