import { Icon, type IconProps } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const checkmarkLgLight12 = defineIconAsset({
  name: "checkmark-lg-light-12",
  canvas: {
    width: 12,
    height: 12,
    viewBox: "0 0 12 12",
    frame: { x: 0, y: 0, width: 12, height: 12 },
    inkBounds: { x: 1.722496, y: 2.050293, width: 8.541985, height: 7.773438 },
    visualBounds: { x: 1.722496, y: 2.050293, width: 8.541985, height: 7.773438 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.722496, y: 2.050293, width: 8.541985, height: 7.773438 },
    center: { x: 5.993489, y: 5.937012 },
    insets: { top: 2.050293, right: 1.735519, bottom: 2.176269, left: 1.722496 },
    anchors: {
      frame: { x: 6, y: 6 },
      ink: { x: 5.993489, y: 5.937012 },
      foreground: { x: 5.993489, y: 5.937012 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M9.53532 2.22277C9.66082 2.04108 9.91018 1.99578 10.092 2.12121C10.2737 2.2467 10.319 2.49606 10.1935 2.67785L5.40544 9.61535C5.2377 9.86166 4.88746 9.89564 4.67692 9.68469L1.84098 6.87023C1.68424 6.71471 1.68269 6.46066 1.83805 6.30383C1.99355 6.14723 2.24668 6.14665 2.40348 6.30187L4.96598 8.84386L9.53532 2.22277Z" fill="currentColor"/>`,
});

export function CheckmarkLgLight12Icon(props: Omit<IconProps, "asset">) {
  return <Icon asset={checkmarkLgLight12} {...props} />;
}
