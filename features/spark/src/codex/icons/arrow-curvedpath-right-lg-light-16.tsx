import { Icon, type IconProps } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const arrowCurvedpathRightLgLight16 = defineIconAsset({
  name: "arrow-curvedpath-right-lg-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 2.807861, y: 4.14209, width: 10.141968, height: 7.716309 },
    visualBounds: { x: 2.807861, y: 4.14209, width: 10.141968, height: 7.716309 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.807861, y: 4.14209, width: 10.141968, height: 7.716309 },
    center: { x: 7.878845, y: 8.000244 },
    insets: { top: 4.14209, right: 3.050171, bottom: 4.141601, left: 2.807861 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 7.878845, y: 8.000244 },
      foreground: { x: 7.878845, y: 8.000244 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M3.33325 4.14209C3.6232 4.14209 3.85864 4.37753 3.85864 4.66748V7.36279C3.85874 7.65279 3.94942 7.84396 4.06665 7.96143C4.1841 8.07888 4.37583 8.17034 4.66626 8.17041H11.3938L9.59399 6.37158C9.38948 6.16657 9.38928 5.83428 9.59399 5.62939C9.79887 5.42455 10.1311 5.42483 10.3362 5.62939L12.6497 7.94189C13.0499 8.34217 13.0499 8.9918 12.6497 9.39209L10.3362 11.7046C10.1312 11.9096 9.79902 11.9096 9.59399 11.7046C9.38959 11.4995 9.38917 11.1672 9.59399 10.9624L11.3362 9.22021H4.66626C4.14622 9.22014 3.67085 9.05093 3.32446 8.70459C2.9781 8.35823 2.80797 7.88281 2.80786 7.36279V4.66748C2.80786 4.37753 3.0433 4.14209 3.33325 4.14209Z" fill="currentColor"/>`,
});

export function ArrowCurvedpathRightLgLight16Icon(props: Omit<IconProps, "asset">) {
  return <Icon asset={arrowCurvedpathRightLgLight16} {...props} />;
}
