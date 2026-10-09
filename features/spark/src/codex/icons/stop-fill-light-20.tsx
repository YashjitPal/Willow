import { Icon, type IconProps } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const stopFillLight20 = defineIconAsset({
  name: "stop-fill-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 3.918335, y: 3.918457, width: 12.163086, height: 12.163086 },
    visualBounds: { x: 3.918335, y: 3.918457, width: 12.163086, height: 12.163086 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 3.918335, y: 3.918457, width: 12.163086, height: 12.163086 },
    center: { x: 9.999878, y: 10 },
    insets: { top: 3.918457, right: 3.918579, bottom: 3.918457, left: 3.918335 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 9.999878, y: 10 },
      foreground: { x: 9.999878, y: 10 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M13.0834 3.91846C14.7392 3.91846 16.0812 5.26072 16.0814 6.9165V13.0835C16.0814 14.7394 14.7393 16.0815 13.0834 16.0815H6.91638C5.2606 16.0814 3.91833 14.7393 3.91833 13.0835V6.9165C3.91851 5.26083 5.26071 3.91863 6.91638 3.91846H13.0834Z" fill="currentColor"/>`,
});

export function StopFillLight20Icon(props: Omit<IconProps, "asset">) {
  return <Icon asset={stopFillLight20} {...props} />;
}
