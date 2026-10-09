import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const checkmarkCircleFillRegular16 = defineIconAsset({
  name: "checkmark-circle-fill-regular-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 1.25, y: 1.25, width: 13.5, height: 13.5 },
    visualBounds: { x: 1.25, y: 1.25, width: 13.5, height: 13.5 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "circular",
    bounds: { x: 1.25, y: 1.25, width: 13.5, height: 13.5 },
    center: { x: 8, y: 8 },
    insets: { top: 1.25, right: 1.25, bottom: 1.25, left: 1.25 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8, y: 8 },
      foreground: { x: 8, y: 8 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M8 1.25C11.7279 1.25 14.75 4.27208 14.75 8C14.75 11.7279 11.7279 14.75 8 14.75C4.27208 14.75 1.25 11.7279 1.25 8C1.25 4.27208 4.27208 1.25 8 1.25ZM10.6807 5.47363C10.3367 5.24301 9.87036 5.33482 9.63965 5.67871L7.27832 9.20117L6.28613 8.13672C6.00361 7.83389 5.52846 7.81716 5.22559 8.09961C4.92276 8.38214 4.90603 8.85728 5.18848 9.16016L6.61133 10.6846C7.05077 11.1556 7.8151 11.0946 8.17383 10.5596L10.8857 6.51465C11.1164 6.17067 11.0246 5.70434 10.6807 5.47363Z" fill="currentColor"/>`,
});

export const CheckmarkCircleFillRegular16Icon = createIconComponent(checkmarkCircleFillRegular16);
