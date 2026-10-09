import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const ellipsisHorizontalLight12 = defineIconAsset({
  name: "ellipsis-horizontal-light-12",
  canvas: {
    width: 12,
    height: 12,
    viewBox: "0 0 12 12",
    frame: { x: 0, y: 0, width: 12, height: 12 },
    inkBounds: { x: 1.599609, y: 5.099609, width: 8.800781, height: 1.800781 },
    visualBounds: { x: 1.599609, y: 5.099609, width: 8.800781, height: 1.800781 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.599609, y: 5.099609, width: 8.800781, height: 1.800781 },
    center: { x: 6, y: 6 },
    insets: { top: 5.099609, right: 1.59961, bottom: 5.09961, left: 1.599609 },
    anchors: {
      frame: { x: 6, y: 6 },
      ink: { x: 6, y: 6 },
      foreground: { x: 6, y: 6 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M2.5 5.09961C2.99706 5.09961 3.40039 5.50294 3.40039 6C3.40039 6.49706 2.99706 6.90039 2.5 6.90039C2.00294 6.90039 1.59961 6.49706 1.59961 6C1.59961 5.50294 2.00294 5.09961 2.5 5.09961Z" fill="currentColor"/> <path d="M6 5.09961C6.49706 5.09961 6.90039 5.50294 6.90039 6C6.90039 6.49706 6.49706 6.90039 6 6.90039C5.50294 6.90039 5.09961 6.49706 5.09961 6C5.09961 5.50294 5.50294 5.09961 6 5.09961Z" fill="currentColor"/> <path d="M9.5 5.09961C9.99706 5.09961 10.4004 5.50294 10.4004 6C10.4004 6.49706 9.99706 6.90039 9.5 6.90039C9.00294 6.90039 8.59961 6.49706 8.59961 6C8.59961 5.50294 9.00294 5.09961 9.5 5.09961Z" fill="currentColor"/>`,
});

export const EllipsisHorizontalLight12Icon = createIconComponent(ellipsisHorizontalLight12);
