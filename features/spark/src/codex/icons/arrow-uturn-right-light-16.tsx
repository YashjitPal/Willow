import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const arrowUturnRightLight16 = defineIconAsset({
  name: "arrow-uturn-right-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 2.196289, y: 2.192871, width: 11.46814, height: 11.615234 },
    visualBounds: { x: 2.196289, y: 2.192871, width: 11.46814, height: 11.615234 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.196289, y: 2.192871, width: 11.46814, height: 11.615234 },
    center: { x: 7.930359, y: 8.000488 },
    insets: { top: 2.192871, right: 2.335571, bottom: 2.191895, left: 2.196289 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 7.930359, y: 8.000488 },
      foreground: { x: 7.930359, y: 8.000488 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M10.1865 2.34642C10.3914 2.14154 10.7237 2.14184 10.9287 2.34642L13.4131 4.83079C13.7483 5.16599 13.7483 5.70946 13.4131 6.04466L10.9287 8.52903C10.7237 8.73389 10.3915 8.73394 10.1865 8.52903C9.98198 8.32402 9.98178 7.99174 10.1865 7.78685L12.0088 5.9636H6.63281C4.76376 5.9636 3.24719 7.49289 3.24707 9.36888C3.24707 11.2373 4.76542 12.7585 6.63281 12.7585H9.57617C9.86592 12.7587 10.1005 12.9932 10.1006 13.2829C10.1006 13.5728 9.86596 13.8081 9.57617 13.8083H6.63281C4.18446 13.8083 2.19629 11.8162 2.19629 9.36888C2.19641 6.91996 4.17691 4.91282 6.63281 4.91282H12.0107L10.1865 3.0886C9.98195 2.88354 9.98165 2.55129 10.1865 2.34642Z" fill="currentColor"/>`,
});

export const ArrowUturnRightLight16Icon = createIconComponent(arrowUturnRightLight16);
