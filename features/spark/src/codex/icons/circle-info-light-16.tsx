import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const circleInfoLight16 = defineIconAsset({
  name: "circle-info-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 1.486328, y: 1.486328, width: 13.027344, height: 13.027344 },
    visualBounds: { x: 1.486328, y: 1.486328, width: 13.027344, height: 13.027344 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "circular",
    bounds: { x: 1.486328, y: 1.486328, width: 13.027344, height: 13.027344 },
    center: { x: 8, y: 8 },
    insets: { top: 1.486328, right: 1.486328, bottom: 1.486328, left: 1.486328 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8, y: 8 },
      foreground: { x: 8, y: 8 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M8 7.48633C8.28351 7.48633 8.51367 7.71649 8.51367 8V10.667C8.5135 10.9503 8.2834 11.1797 8 11.1797C7.7166 11.1797 7.4865 10.9503 7.48633 10.667V8C7.48633 7.71649 7.71649 7.48633 8 7.48633Z" fill="currentColor"/> <path d="M8 4.90137C8.37814 4.9015 8.68544 5.20779 8.68555 5.58594C8.68528 5.96395 8.37804 6.27135 8 6.27148C7.62194 6.27138 7.31569 5.96396 7.31543 5.58594C7.31554 5.20778 7.62184 4.90147 8 4.90137Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M8 1.48633C11.5972 1.48633 14.5137 4.40279 14.5137 8C14.5137 11.5972 11.5972 14.5137 8 14.5137C4.40279 14.5137 1.48633 11.5972 1.48633 8C1.48633 4.40279 4.40279 1.48633 8 1.48633ZM8 2.51367C4.9698 2.51367 2.51367 4.9698 2.51367 8C2.51367 11.0302 4.9698 13.4863 8 13.4863C11.0302 13.4863 13.4863 11.0302 13.4863 8C13.4863 4.9698 11.0302 2.51367 8 2.51367Z" fill="currentColor"/>`,
});

export const CircleInfoLight16Icon = createIconComponent(circleInfoLight16);
