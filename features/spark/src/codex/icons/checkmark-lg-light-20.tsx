import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const checkmarkLgLight20 = defineIconAsset({
  name: "checkmark-lg-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 2.872433, y: 3.474854, width: 14.233868, height: 12.952393 },
    visualBounds: { x: 2.872433, y: 3.474854, width: 14.233868, height: 12.952393 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.872433, y: 3.474854, width: 14.233868, height: 12.952393 },
    center: { x: 9.989367, y: 9.951051 },
    insets: { top: 3.474854, right: 2.893699, bottom: 3.572753, left: 2.872433 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 9.989367, y: 9.951051 },
      foreground: { x: 9.989367, y: 9.951051 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M15.8938 3.76175C16.1024 3.45946 16.5173 3.38422 16.8196 3.59281C17.1214 3.80153 17.197 4.21553 16.9886 4.51761L9.00711 16.085C8.72796 16.4912 8.14868 16.545 7.7991 16.1973L3.06863 11.5049C2.80796 11.2463 2.8071 10.8252 3.0657 10.5645C3.32438 10.3038 3.74542 10.3019 4.00613 10.5606L8.27761 14.7998L15.8938 3.76175Z" fill="currentColor"/>`,
});

export const CheckmarkLgLight20Icon = createIconComponent(checkmarkLgLight20);
