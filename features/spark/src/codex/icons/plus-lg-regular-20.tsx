import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const plusLgRegular20 = defineIconAsset({
  name: "plus-lg-regular-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 2.458496, y: 2.458496, width: 15.083008, height: 15.083008 },
    visualBounds: { x: 2.458496, y: 2.458496, width: 15.083008, height: 15.083008 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.458496, y: 2.458496, width: 15.083008, height: 15.083008 },
    center: { x: 10, y: 10 },
    insets: { top: 2.458496, right: 2.458496, bottom: 2.458496, left: 2.458496 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10, y: 10 },
      foreground: { x: 10, y: 10 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M10.0005 2.4585C10.4835 2.45876 10.8755 2.85041 10.8755 3.3335V9.12549H16.6665C17.1498 9.12549 17.5415 9.51724 17.5415 10.0005C17.5412 10.4835 17.1496 10.8755 16.6665 10.8755H10.8755V16.6665C10.8755 17.1496 10.4835 17.5412 10.0005 17.5415C9.51724 17.5415 9.12549 17.1498 9.12549 16.6665V10.8755H3.3335C2.85041 10.8755 2.45876 10.4835 2.4585 10.0005C2.4585 9.51724 2.85025 9.12549 3.3335 9.12549H9.12549V3.3335C9.12549 2.85025 9.51724 2.4585 10.0005 2.4585Z" fill="currentColor"/>`,
});

export const PlusLgRegular20Icon = createIconComponent(plusLgRegular20);
