import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const arrowRotateCounterclockwiseLight16 = defineIconAsset({
  name: "arrow-rotate-counterclockwise-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 1.641357, y: 1.641113, width: 12.716797, height: 12.716797 },
    visualBounds: { x: 1.641357, y: 1.641113, width: 12.716797, height: 12.716797 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.641357, y: 1.641113, width: 12.716797, height: 12.716797 },
    center: { x: 7.999756, y: 7.999512 },
    insets: { top: 1.641113, right: 1.641846, bottom: 1.64209, left: 1.641357 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 7.999756, y: 7.999512 },
      foreground: { x: 7.999756, y: 7.999512 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M7.99976 1.64111C11.5112 1.64113 14.358 4.48806 14.3582 7.99951C14.3582 11.5111 11.5113 14.3579 7.99976 14.3579C4.97337 14.3578 2.4422 12.244 1.79956 9.4126C1.7354 9.12984 1.91231 8.84785 2.19507 8.78369C2.4778 8.71959 2.75884 8.89745 2.823 9.18018C3.35943 11.5439 5.47433 13.308 7.99976 13.3081C10.9314 13.3081 13.3083 10.9312 13.3083 7.99951C13.3082 5.06796 10.9313 2.69191 7.99976 2.69189C5.96105 2.69201 4.19199 3.84248 3.30249 5.53076H4.75952C5.04939 5.53086 5.28394 5.76626 5.28394 6.05615C5.28376 6.34589 5.04928 6.58047 4.75952 6.58057H2.16675C1.87691 6.58057 1.64153 6.34595 1.64136 6.05615V3.13916C1.64136 2.84921 1.8768 2.61377 2.16675 2.61377C2.4567 2.61377 2.69214 2.84921 2.69214 3.13916V4.50049C3.82929 2.77918 5.78081 1.64122 7.99976 1.64111Z" fill="currentColor"/>`,
});

export const ArrowRotateCounterclockwiseLight16Icon = createIconComponent(arrowRotateCounterclockwiseLight16);
