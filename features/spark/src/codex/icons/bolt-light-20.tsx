import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const boltLight20 = defineIconAsset({
  name: "bolt-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 2.628906, y: 1.644775, width: 14.742096, height: 16.710449 },
    visualBounds: { x: 2.628906, y: 1.644775, width: 14.742096, height: 16.710449 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.628906, y: 1.644775, width: 14.742096, height: 16.710449 },
    center: { x: 9.999954, y: 10 },
    insets: { top: 1.644775, right: 2.628998, bottom: 1.644776, left: 2.628906 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 9.999954, y: 10 },
      foreground: { x: 9.999954, y: 10 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M10.539 1.99613C11.3831 1.15224 12.8619 1.94353 12.5693 3.1514L11.6699 6.86136H16.0781C17.1749 6.86136 17.7719 8.14348 17.0654 8.98245L9.54097 17.917C8.71451 18.8984 7.12861 18.0955 7.43062 16.8487L8.33003 13.1387H3.92183C2.82501 13.1387 2.22802 11.8566 2.93452 11.0176L10.4589 2.08304L10.539 1.99613ZM4.00777 11.8086H8.85738C9.4499 11.8086 9.88652 12.3636 9.74703 12.9395L8.83882 16.6856L15.9921 8.19144H11.1425C10.55 8.19144 10.1134 7.63642 10.2529 7.06058L11.1601 3.31351L4.00777 11.8086Z" fill="currentColor"/>`,
});

export const BoltLight20Icon = createIconComponent(boltLight20);
