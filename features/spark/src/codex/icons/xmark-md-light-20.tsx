import { Icon, type IconProps } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const xmarkMdLight20 = defineIconAsset({
  name: "xmark-md-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 5.167847, y: 5.167847, width: 9.664551, height: 9.663696 },
    visualBounds: { x: 5.167847, y: 5.167847, width: 9.664551, height: 9.663696 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 5.167847, y: 5.167847, width: 9.664551, height: 9.663696 },
    center: { x: 10.000123, y: 9.999695 },
    insets: { top: 5.167847, right: 5.167602, bottom: 5.168457, left: 5.167847 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10.000123, y: 9.999695 },
      foreground: { x: 10.000123, y: 9.999695 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M13.6964 5.36252C13.9561 5.10319 14.3782 5.10304 14.6378 5.36252C14.8974 5.62211 14.8972 6.0442 14.6378 6.30393L10.9405 10.0002L14.6368 13.6965C14.8964 13.9562 14.8965 14.3773 14.6368 14.6369C14.3772 14.8966 13.9561 14.8965 13.6964 14.6369L10.0001 10.9406L6.30381 14.6369C6.0441 14.8965 5.62302 14.8966 5.36338 14.6369C5.10384 14.3773 5.10388 13.9562 5.36338 13.6965L9.05869 10.0002L5.3624 6.30393C5.10314 6.0442 5.10285 5.62208 5.3624 5.36252C5.62195 5.10297 6.04407 5.10326 6.30381 5.36252L10.0001 9.05881L13.6964 5.36252Z" fill="currentColor"/>`,
});

export function XmarkMdLight20Icon(props: Omit<IconProps, "asset">) {
  return <Icon asset={xmarkMdLight20} {...props} />;
}
