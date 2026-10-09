import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const plusLgLight20 = defineIconAsset({
  name: "plus-lg-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 2.668457, y: 2.668457, width: 14.663086, height: 14.663086 },
    visualBounds: { x: 2.668457, y: 2.668457, width: 14.663086, height: 14.663086 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.668457, y: 2.668457, width: 14.663086, height: 14.663086 },
    center: { x: 10, y: 10 },
    insets: { top: 2.668457, right: 2.668457, bottom: 2.668457, left: 2.668457 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10, y: 10 },
      foreground: { x: 10, y: 10 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M10.0005 2.66846C10.3675 2.66872 10.6655 2.96639 10.6655 3.3335V9.33545H16.6665C17.0338 9.33545 17.3315 9.63322 17.3315 10.0005C17.3313 10.3675 17.0336 10.6655 16.6665 10.6655H10.6655V16.6665C10.6655 17.0336 10.3675 17.3313 10.0005 17.3315C9.63322 17.3315 9.33545 17.0338 9.33545 16.6665V10.6655H3.3335C2.96639 10.6655 2.66872 10.3675 2.66846 10.0005C2.66846 9.63322 2.96623 9.33545 3.3335 9.33545H9.33545V3.3335C9.33545 2.96623 9.63322 2.66846 10.0005 2.66846Z" fill="currentColor"/>`,
});

export const PlusLgLight20Icon = createIconComponent(plusLgLight20);
