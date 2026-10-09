import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const checkmarkMdLight24 = defineIconAsset({
  name: "checkmark-md-light-24",
  canvas: {
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    frame: { x: 0, y: 0, width: 24, height: 24 },
    inkBounds: { x: 5.250076, y: 5.744385, width: 13.494095, height: 12.431641 },
    visualBounds: { x: 5.250076, y: 5.744385, width: 13.494095, height: 12.431641 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 5.250076, y: 5.744385, width: 13.494095, height: 12.431641 },
    center: { x: 11.997124, y: 11.960206 },
    insets: { top: 5.744385, right: 5.255829, bottom: 5.823974, left: 5.250076 },
    anchors: {
      frame: { x: 12, y: 12 },
      ink: { x: 11.997124, y: 11.960206 },
      foreground: { x: 11.997124, y: 11.960206 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M17.3741 6.07252C17.607 5.73007 18.0736 5.64144 18.4161 5.87428C18.7585 6.10719 18.8472 6.57376 18.6143 6.91627L11.2256 17.7825C10.9079 18.2494 10.2437 18.3112 9.84477 17.9114L5.4688 13.5266C5.17628 13.2334 5.17754 12.7586 5.47075 12.4661C5.76398 12.1736 6.23877 12.1739 6.5313 12.4671L10.3926 16.3381L17.3741 6.07252Z" fill="currentColor"/>`,
});

export const CheckmarkMdLight24Icon = createIconComponent(checkmarkMdLight24);
