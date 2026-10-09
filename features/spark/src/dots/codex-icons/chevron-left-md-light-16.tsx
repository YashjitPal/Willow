import { Icon, type IconProps } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const chevronLeftMdLight16 = defineIconAsset({
  name: "chevron-left-md-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 5.113281, y: 3.475098, width: 4.911621, height: 9.049805 },
    visualBounds: { x: 5.113281, y: 3.475098, width: 4.911621, height: 9.049805 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 5.113281, y: 3.475098, width: 4.911621, height: 9.049805 },
    center: { x: 7.569092, y: 8 },
    insets: { top: 3.475098, right: 5.975098, bottom: 3.475097, left: 5.113281 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 7.569092, y: 8 },
      foreground: { x: 7.569092, y: 8 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M9.87117 11.6289C10.0762 11.8339 10.0762 12.166 9.87117 12.3711C9.66614 12.5761 9.334 12.5761 9.12898 12.3711L5.36433 8.60641C5.0296 8.27129 5.0296 7.72863 5.36433 7.39351L9.12898 3.62887C9.334 3.42384 9.66614 3.42384 9.87117 3.62887C10.0762 3.83389 10.0762 4.16603 9.87117 4.37105L6.24226 7.99996L9.87117 11.6289Z" fill="currentColor"/>`,
});

export function ChevronLeftMdLight16Icon(props: Omit<IconProps, "asset">) {
  return <Icon asset={chevronLeftMdLight16} {...props} />;
}
