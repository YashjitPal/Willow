import { Icon, type IconProps } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const arrowUturnLeftLight20 = defineIconAsset({
  name: "arrow-uturn-left-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 2.779297, y: 2.667969, width: 14.552979, height: 14.671875 },
    visualBounds: { x: 2.779297, y: 2.667969, width: 14.552979, height: 14.671875 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.779297, y: 2.667969, width: 14.552979, height: 14.671875 },
    center: { x: 10.055787, y: 10.003907 },
    insets: { top: 2.667969, right: 2.667724, bottom: 2.660156, left: 2.779297 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10.055787, y: 10.003907 },
      foreground: { x: 10.055787, y: 10.003907 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M6.20313 2.86252C6.46271 2.60301 6.88483 2.60322 7.14454 2.86252C7.40422 3.1222 7.40418 3.54423 7.14454 3.80393L4.88282 6.06467H11.6738C14.7799 6.06472 17.3319 8.57222 17.332 11.6897C17.3319 14.8097 14.7913 17.34 11.6738 17.3401H8.29884C7.93176 17.34 7.63396 17.0421 7.6338 16.675C7.63393 16.3079 7.93174 16.0101 8.29884 16.01H11.6738C14.0594 16.0099 16.0019 14.0726 16.002 11.6897C16.0018 9.31817 14.0568 7.3948 11.6738 7.39475H5.00977L7.14454 9.52952C7.40395 9.7891 7.4038 10.2103 7.14454 10.4699C6.88484 10.7296 6.46283 10.7296 6.20313 10.4699L3.04688 7.3137C2.69001 6.95639 2.68987 6.37696 3.04688 6.01975L6.20313 2.86252Z" fill="currentColor"/>`,
});

export function ArrowUturnLeftLight20Icon(props: Omit<IconProps, "asset">) {
  return <Icon asset={arrowUturnLeftLight20} {...props} />;
}
