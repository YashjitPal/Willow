import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const checkmarkMdLight16 = defineIconAsset({
  name: "checkmark-md-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 3.474655, y: 3.803467, width: 9.046768, height: 8.309814 },
    visualBounds: { x: 3.474655, y: 3.803467, width: 9.046768, height: 8.309814 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 3.474655, y: 3.803467, width: 9.046768, height: 8.309814 },
    center: { x: 7.998039, y: 7.958374 },
    insets: { top: 3.803467, right: 3.478577, bottom: 3.886719, left: 3.474655 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 7.998039, y: 7.958374 },
      foreground: { x: 7.998039, y: 7.958374 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M11.5624 4.0338C11.7255 3.79403 12.0522 3.73111 12.2919 3.89415C12.5314 4.05717 12.5933 4.38398 12.4306 4.62364L7.539 11.818C7.30083 12.1681 6.80219 12.215 6.50286 11.9156L3.62786 9.03478C3.4231 8.82953 3.42363 8.4964 3.62884 8.29161C3.8341 8.08683 4.16722 8.08733 4.372 8.29259L6.92474 10.8512L11.5624 4.0338Z" fill="currentColor"/>`,
});

export const CheckmarkMdLight16Icon = createIconComponent(checkmarkMdLight16);
