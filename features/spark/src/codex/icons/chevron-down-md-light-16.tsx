import { Icon, type IconProps } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const chevronDownMdLight16 = defineIconAsset({
  name: "chevron-down-md-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 3.475098, y: 6.141602, width: 9.049683, height: 4.911621 },
    visualBounds: { x: 3.475098, y: 6.141602, width: 9.049683, height: 4.911621 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 3.475098, y: 6.141602, width: 9.049683, height: 4.911621 },
    center: { x: 7.99994, y: 8.597413 },
    insets: { top: 6.141602, right: 3.475219, bottom: 4.946777, left: 3.475098 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 7.99994, y: 8.597413 },
      foreground: { x: 7.99994, y: 8.597413 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M11.6289 6.29537C11.8339 6.09035 12.166 6.09035 12.3711 6.29537C12.5761 6.5004 12.5761 6.83253 12.3711 7.03756L8.60641 10.8022C8.27129 11.1369 7.72863 11.1369 7.39352 10.8022L3.62887 7.03756C3.42384 6.83253 3.42384 6.5004 3.62887 6.29537C3.83389 6.09035 4.16603 6.09035 4.37105 6.29537L7.99996 9.92428L11.6289 6.29537Z" fill="currentColor"/>`,
});

export function ChevronDownMdLight16Icon(props: Omit<IconProps, "asset">) {
  return <Icon asset={chevronDownMdLight16} {...props} />;
}
