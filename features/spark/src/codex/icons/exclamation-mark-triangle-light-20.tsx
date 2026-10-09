import { Icon, type IconProps } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const exclamationMarkTriangleLight20 = defineIconAsset({
  name: "exclamation-mark-triangle-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 1.469971, y: 2.531738, width: 17.060303, height: 14.800293 },
    visualBounds: { x: 1.469971, y: 2.531738, width: 17.060303, height: 14.800293 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.469971, y: 2.531738, width: 17.060303, height: 14.800293 },
    center: { x: 10.000123, y: 9.931884 },
    insets: { top: 2.531738, right: 1.469726, bottom: 2.667969, left: 1.469971 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10.000123, y: 9.931884 },
      foreground: { x: 10.000123, y: 9.931884 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M10.1056 12.5597C10.625 12.6125 11.0304 13.0517 11.0304 13.5851C11.0304 14.154 10.5691 14.6152 10.0002 14.6153C9.46674 14.6153 9.02754 14.21 8.97476 13.6905L8.96988 13.5851L8.97476 13.4796C9.0276 12.9602 9.46678 12.5548 10.0002 12.5548L10.1056 12.5597Z" fill="currentColor"/> <path d="M10.0002 7.25205C10.3673 7.25218 10.6652 7.5499 10.6652 7.91709V10.6251C10.6652 10.9923 10.3673 11.29 10.0002 11.2901C9.63288 11.2901 9.33511 10.9924 9.33511 10.6251V7.91709C9.33511 7.54982 9.63288 7.25205 10.0002 7.25205Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M8.00992 3.64756C8.9191 2.1598 11.0802 2.1598 11.9894 3.64756L18.1847 13.7843C19.1339 15.338 18.0153 17.3321 16.1945 17.3321H3.80484C1.9842 17.332 0.866475 15.3379 1.81558 13.7843L8.00992 3.64756ZM10.8546 4.34092C10.4641 3.70179 9.53526 3.70179 9.14468 4.34092L2.95035 14.4776C2.54284 15.145 3.02284 16.0019 3.80484 16.002H16.1945C16.9766 16.002 17.4566 15.1451 17.049 14.4776L10.8546 4.34092Z" fill="currentColor"/>`,
});

export function ExclamationMarkTriangleLight20Icon(props: Omit<IconProps, "asset">) {
  return <Icon asset={exclamationMarkTriangleLight20} {...props} />;
}
