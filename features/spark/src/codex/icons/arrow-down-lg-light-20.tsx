import { Icon, type IconProps } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const arrowDownLgLight20 = defineIconAsset({
  name: "arrow-down-lg-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 3.501221, y: 2.667969, width: 12.996826, height: 14.490723 },
    visualBounds: { x: 3.501221, y: 2.667969, width: 12.996826, height: 14.490723 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 3.501221, y: 2.667969, width: 12.996826, height: 14.490723 },
    center: { x: 9.999634, y: 9.91333 },
    insets: { top: 2.667969, right: 3.501953, bottom: 2.841308, left: 3.501221 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 9.999634, y: 9.91333 },
      foreground: { x: 9.999634, y: 9.91333 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M10.0005 2.66797C10.3676 2.6681 10.6655 2.96582 10.6655 3.33301V15.0596L15.3628 10.3623C15.6223 10.1029 16.0435 10.1032 16.3032 10.3623C16.5629 10.622 16.5629 11.044 16.3032 11.3037L10.7651 16.8418C10.3427 17.264 9.65717 17.2641 9.23484 16.8418L3.69578 11.3037C3.43635 11.0441 3.43639 10.622 3.69578 10.3623C3.95541 10.1027 4.37747 10.1028 4.63718 10.3623L9.33542 15.0605V3.33301C9.33542 2.96574 9.63319 2.66797 10.0005 2.66797Z" fill="currentColor"/>`,
});

export function ArrowDownLgLight20Icon(props: Omit<IconProps, "asset">) {
  return <Icon asset={arrowDownLgLight20} {...props} />;
}
