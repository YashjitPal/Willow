import { Icon, type IconProps } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const arrowCurvedRightLargeTypographicLight20 = defineIconAsset({
  name: "arrow-curved-right-large-typographic-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 2.25, y: 4, width: 15.45874, height: 12 },
    visualBounds: { x: 2.25, y: 4, width: 15.45874, height: 12 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.25, y: 4, width: 15.45874, height: 12 },
    center: { x: 9.97937, y: 10 },
    insets: { top: 4, right: 2.29126, bottom: 4, left: 2.25 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 9.97937, y: 10 },
      foreground: { x: 9.97937, y: 10 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M3 4C3.41421 4 3.75 4.33579 3.75 4.75V8.25C3.75008 9.49257 4.75741 10.5 6 10.5H15.1885L12.4697 7.78027C12.1769 7.48742 12.177 7.01261 12.4697 6.71973C12.7626 6.42686 13.2374 6.4269 13.5303 6.71973L17.46 10.6484C17.7918 10.9803 17.7915 11.5186 17.46 11.8506L13.5303 15.7803C13.2374 16.0729 12.7626 16.073 12.4697 15.7803C12.177 15.4875 12.1771 15.0126 12.4697 14.7197L15.1885 12H6C3.92898 12 2.25008 10.321 2.25 8.25V4.75C2.25 4.33579 2.58579 4 3 4Z" fill="currentColor"/>`,
});

export function ArrowCurvedRightLargeTypographicLight20Icon(props: Omit<IconProps, "asset">) {
  return <Icon asset={arrowCurvedRightLargeTypographicLight20} {...props} />;
}
