import { Icon, type IconProps } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const plusLgLight16 = defineIconAsset({
  name: "plus-lg-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 2.141113, y: 2.141113, width: 11.716797, height: 11.716797 },
    visualBounds: { x: 2.141113, y: 2.141113, width: 11.716797, height: 11.716797 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.141113, y: 2.141113, width: 11.716797, height: 11.716797 },
    center: { x: 7.999512, y: 7.999512 },
    insets: { top: 2.141113, right: 2.14209, bottom: 2.14209, left: 2.141113 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 7.999512, y: 7.999512 },
      foreground: { x: 7.999512, y: 7.999512 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M8.00049 2.14111C8.29021 2.14138 8.52588 2.37672 8.52588 2.6665V7.4751H13.3335C13.6233 7.47527 13.8579 7.71065 13.8579 8.00049C13.8576 8.29011 13.6231 8.5257 13.3335 8.52588H8.52588V13.3335C8.5257 13.6231 8.29011 13.8576 8.00049 13.8579C7.71065 13.8579 7.47527 13.6233 7.4751 13.3335V8.52588H2.6665C2.37672 8.52588 2.14138 8.29021 2.14111 8.00049C2.14111 7.71054 2.37655 7.4751 2.6665 7.4751H7.4751V2.6665C7.4751 2.37655 7.71054 2.14111 8.00049 2.14111Z" fill="currentColor"/>`,
});

export function PlusLgLight16Icon(props: Omit<IconProps, "asset">) {
  return <Icon asset={plusLgLight16} {...props} />;
}
