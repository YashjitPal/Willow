import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const arrowDownLineHorizontalLight20 = defineIconAsset({
  name: "arrow-down-line-horizontal-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 3.001709, y: 2.668457, width: 13.99707, height: 14.663086 },
    visualBounds: { x: 3.001709, y: 2.668457, width: 13.99707, height: 14.663086 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 3.001709, y: 2.668457, width: 13.99707, height: 14.663086 },
    center: { x: 10.000244, y: 10 },
    insets: { top: 2.668457, right: 3.001221, bottom: 2.668457, left: 3.001709 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10.000244, y: 10 },
      foreground: { x: 10.000244, y: 10 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M16.3337 16.0015C16.7008 16.0016 16.9986 16.2995 16.9988 16.6665C16.9988 17.0337 16.7009 17.3314 16.3337 17.3315H3.66675C3.29948 17.3315 3.00171 17.0338 3.00171 16.6665C3.00188 16.2994 3.29959 16.0015 3.66675 16.0015H16.3337Z" fill="currentColor"/> <path d="M9.99976 2.66846C10.367 2.66846 10.6648 2.96623 10.6648 3.3335V10.894L13.697 7.86279C13.9567 7.60364 14.3779 7.60342 14.6375 7.86279C14.8969 8.12245 14.8969 8.54454 14.6375 8.8042L10.824 12.6167C10.3691 13.0716 9.63147 13.0715 9.17651 12.6167L5.36304 8.8042C5.10334 8.5445 5.10334 8.12249 5.36304 7.86279C5.62275 7.60326 6.0448 7.60315 6.30444 7.86279L9.33472 10.8931V3.3335C9.33472 2.96634 9.63264 2.66864 9.99976 2.66846Z" fill="currentColor"/>`,
});

export const ArrowDownLineHorizontalLight20Icon = createIconComponent(arrowDownLineHorizontalLight20);
