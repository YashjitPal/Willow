import { Icon, type IconProps } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const laptopLight20 = defineIconAsset({
  name: "laptop-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 0.760742, y: 3.084961, width: 18.47168, height: 13.995117 },
    visualBounds: { x: 0.760742, y: 3.084961, width: 18.47168, height: 13.995117 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 0.760742, y: 3.084961, width: 18.47168, height: 13.995117 },
    center: { x: 9.996582, y: 10.08252 },
    insets: { top: 3.084961, right: 0.767578, bottom: 2.919922, left: 0.760742 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 9.996582, y: 10.08252 },
      foreground: { x: 9.996582, y: 10.08252 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M15.833 3.08496C17.1208 3.08496 18.165 4.12925 18.165 5.41699V12.6729C18.7739 12.7251 19.232 13.243 19.2324 13.8477V14.8691C19.2324 16.0762 18.2715 17.0798 17.0557 17.0801H2.93848C1.72246 17.0801 0.760742 16.0764 0.760742 14.8691V13.8477C0.76117 13.2408 1.22278 12.722 1.83496 12.6729V5.41699C1.83496 4.12925 2.87925 3.08496 4.16699 3.08496H15.833ZM2.09082 14.8691C2.09082 15.3689 2.4838 15.75 2.93848 15.75H17.0557C17.5101 15.7497 17.9023 15.3687 17.9023 14.8691V13.998H2.09082V14.8691ZM4.16699 4.41504C3.61379 4.41504 3.16504 4.86379 3.16504 5.41699V12.668H16.835V5.41699C16.835 4.86379 16.3862 4.41504 15.833 4.41504H4.16699Z" fill="currentColor"/>`,
});

export function LaptopLight20Icon(props: Omit<IconProps, "asset">) {
  return <Icon asset={laptopLight20} {...props} />;
}
