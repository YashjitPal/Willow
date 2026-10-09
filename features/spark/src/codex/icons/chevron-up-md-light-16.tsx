import { Icon, type IconProps } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const chevronUpMdLight16 = defineIconAsset({
  name: "chevron-up-md-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 3.475098, y: 4.946289, width: 9.049805, height: 4.911621 },
    visualBounds: { x: 3.475098, y: 4.946289, width: 9.049805, height: 4.911621 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 3.475098, y: 4.946289, width: 9.049805, height: 4.911621 },
    center: { x: 8, y: 7.4021 },
    insets: { top: 4.946289, right: 3.475097, bottom: 6.14209, left: 3.475098 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8, y: 7.4021 },
      foreground: { x: 8, y: 7.4021 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M11.6289 9.70417C11.8339 9.9092 12.166 9.9092 12.3711 9.70417C12.5761 9.49915 12.5761 9.16701 12.3711 8.96199L8.60641 5.19734C8.27129 4.86261 7.72863 4.86261 7.39352 5.19734L3.62887 8.96199C3.42384 9.16701 3.42384 9.49915 3.62887 9.70417C3.83389 9.9092 4.16603 9.9092 4.37105 9.70417L7.99996 6.07527L11.6289 9.70417Z" fill="currentColor"/>`,
});

export function ChevronUpMdLight16Icon(props: Omit<IconProps, "asset">) {
  return <Icon asset={chevronUpMdLight16} {...props} />;
}
