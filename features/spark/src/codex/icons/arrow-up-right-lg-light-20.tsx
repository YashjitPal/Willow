import { Icon, type IconProps } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const arrowUpRightLgLight20 = defineIconAsset({
  name: "arrow-up-right-lg-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 4.335205, y: 4.334961, width: 11.330322, height: 11.334473 },
    visualBounds: { x: 4.335205, y: 4.334961, width: 11.330322, height: 11.334473 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 4.335205, y: 4.334961, width: 11.330322, height: 11.334473 },
    center: { x: 10.000366, y: 10.002198 },
    insets: { top: 4.334961, right: 4.334473, bottom: 4.330566, left: 4.335205 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10.000366, y: 10.002198 },
      foreground: { x: 10.000366, y: 10.002198 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M14.9672 4.33789C15.1481 4.32879 15.3319 4.39124 15.4702 4.5293C15.6086 4.6677 15.6698 4.85193 15.6606 5.0332C15.6625 5.05513 15.6655 5.07719 15.6655 5.09961V13.333C15.6655 13.7001 15.3675 13.9978 15.0004 13.998C14.6333 13.9979 14.3354 13.7002 14.3354 13.333V6.60449L5.47017 15.4746C5.21053 15.7343 4.78948 15.7342 4.52974 15.4746C4.27046 15.2149 4.27026 14.7938 4.52974 14.5342L13.3959 5.66504H6.66743C6.30016 5.66504 6.00239 5.36727 6.00239 5C6.00239 4.63273 6.30016 4.33496 6.66743 4.33496H14.9008C14.9232 4.33498 14.9454 4.33599 14.9672 4.33789Z" fill="currentColor"/>`,
});

export function ArrowUpRightLgLight20Icon(props: Omit<IconProps, "asset">) {
  return <Icon asset={arrowUpRightLgLight20} {...props} />;
}
