import { Icon, type IconProps } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const plusMdLight12 = defineIconAsset({
  name: "plus-md-light-12",
  canvas: {
    width: 12,
    height: 12,
    viewBox: "0 0 12 12",
    frame: { x: 0, y: 0, width: 12, height: 12 },
    inkBounds: { x: 1.599609, y: 1.599609, width: 8.800781, height: 8.800781 },
    visualBounds: { x: 1.599609, y: 1.599609, width: 8.800781, height: 8.800781 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.599609, y: 1.599609, width: 8.800781, height: 8.800781 },
    center: { x: 6, y: 6 },
    insets: { top: 1.599609, right: 1.59961, bottom: 1.59961, left: 1.599609 },
    anchors: {
      frame: { x: 6, y: 6 },
      ink: { x: 6, y: 6 },
      foreground: { x: 6, y: 6 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M6 1.59961C6.22091 1.59961 6.40039 1.77909 6.40039 2V5.59961H10C10.2209 5.59961 10.4004 5.77909 10.4004 6C10.4004 6.22091 10.2209 6.40039 10 6.40039H6.40039V10C6.40039 10.2209 6.22091 10.4004 6 10.4004C5.77909 10.4004 5.59961 10.2209 5.59961 10V6.40039H2C1.77909 6.40039 1.59961 6.22091 1.59961 6C1.59961 5.77909 1.77909 5.59961 2 5.59961H5.59961V2C5.59961 1.77909 5.77909 1.59961 6 1.59961Z" fill="currentColor"/>`,
});

export function PlusMdLight12Icon(props: Omit<IconProps, "asset">) {
  return <Icon asset={plusMdLight12} {...props} />;
}
