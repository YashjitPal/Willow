import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const starFillRegular12 = defineIconAsset({
  name: "star-fill-regular-12",
  canvas: {
    width: 12,
    height: 12,
    viewBox: "0 0 12 12",
    frame: { x: 0, y: 0, width: 12, height: 12 },
    inkBounds: { x: 0.311478, y: 0.492554, width: 11.376236, height: 10.898071 },
    visualBounds: { x: 0.311478, y: 0.492554, width: 11.376236, height: 10.898071 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 0.311478, y: 0.492554, width: 11.376236, height: 10.898071 },
    center: { x: 5.999596, y: 5.94159 },
    insets: { top: 0.492554, right: 0.312286, bottom: 0.609375, left: 0.311478 },
    anchors: {
      frame: { x: 6, y: 6 },
      ink: { x: 5.999596, y: 5.94159 },
      foreground: { x: 5.999596, y: 5.94159 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M5.3656 0.803948C5.68214 0.388581 6.3176 0.388605 6.63416 0.803948L6.69666 0.899651L8.14783 3.47387L11.0453 4.05883C11.6562 4.18209 11.8977 4.9262 11.476 5.385L9.47498 7.55981L9.81482 10.4973C9.88627 11.1163 9.25354 11.576 8.68689 11.3166L5.99939 10.0852L3.31189 11.3166C2.74536 11.5756 2.11258 11.1162 2.18396 10.4973L2.52381 7.56078L0.522829 5.385C0.101634 4.92634 0.343226 4.18247 0.953493 4.05883L3.84998 3.47387L5.3031 0.899651L5.3656 0.803948Z" fill="currentColor"/>`,
});

export const StarFillRegular12Icon = createIconComponent(starFillRegular12);
