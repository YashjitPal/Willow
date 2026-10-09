import { Icon, type IconProps } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const arrowCurvedpathLeftLgLight16 = defineIconAsset({
  name: "arrow-curvedpath-left-lg-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 3.014648, y: 4.14209, width: 10.142822, height: 7.716309 },
    visualBounds: { x: 3.014648, y: 4.14209, width: 10.142822, height: 7.716309 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 3.014648, y: 4.14209, width: 10.142822, height: 7.716309 },
    center: { x: 8.086059, y: 8.000244 },
    insets: { top: 4.14209, right: 2.84253, bottom: 4.141601, left: 3.014648 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8.086059, y: 8.000244 },
      foreground: { x: 8.086059, y: 8.000244 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M12.632 4.14209C12.9218 4.14227 13.1574 4.37764 13.1574 4.66748V7.36279C13.1573 7.88272 12.9871 8.35824 12.6408 8.70459C12.2945 9.05086 11.8189 9.22007 11.299 9.22021H4.62814L6.37032 10.9624C6.57524 11.1673 6.57502 11.4995 6.37032 11.7046C6.16529 11.9096 5.83315 11.9096 5.62814 11.7046L3.31466 9.39209C2.91475 8.99179 2.91454 8.34206 3.31466 7.94189L5.62814 5.62939C5.83305 5.42465 6.16532 5.42479 6.37032 5.62939C6.57513 5.83438 6.57513 6.1666 6.37032 6.37158L4.57052 8.17041H11.299C11.5893 8.17027 11.7812 8.07883 11.8986 7.96143C12.0158 7.84395 12.1065 7.65266 12.1067 7.36279V4.66748C12.1067 4.37753 12.3421 4.14209 12.632 4.14209Z" fill="currentColor"/>`,
});

export function ArrowCurvedpathLeftLgLight16Icon(props: Omit<IconProps, "asset">) {
  return <Icon asset={arrowCurvedpathLeftLgLight16} {...props} />;
}
