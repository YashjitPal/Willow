import { Icon, type IconProps } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const desktopLight16 = defineIconAsset({
  name: "desktop-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 1.474609, y: 2.141357, width: 13.050781, height: 11.716797 },
    visualBounds: { x: 1.474609, y: 2.141357, width: 13.050781, height: 11.716797 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.474609, y: 2.141357, width: 13.050781, height: 11.716797 },
    center: { x: 8, y: 7.999756 },
    insets: { top: 2.141357, right: 1.47461, bottom: 2.141846, left: 1.474609 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8, y: 7.999756 },
      foreground: { x: 8, y: 7.999756 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M12.667 2.14127C13.6931 2.14145 14.5252 2.9736 14.5254 3.99967V9.66666C14.5254 10.6929 13.6932 11.5249 12.667 11.5251H10.8584V12.8327C10.8584 13.3986 10.3998 13.8577 9.83398 13.8581H6.16699C5.6009 13.8581 5.1416 13.3988 5.1416 12.8327V11.5251H3.33301C2.30683 11.5249 1.47461 10.6929 1.47461 9.66666V3.99967C1.47479 2.9736 2.30694 2.14145 3.33301 2.14127H12.667ZM6.19238 11.5251V12.8083H9.80859V11.5251H6.19238ZM3.33301 3.19205C2.88684 3.19223 2.52557 3.5535 2.52539 3.99967V9.66666C2.52539 10.113 2.88673 10.4751 3.33301 10.4753H5.65723C5.66037 10.4752 5.66383 10.4743 5.66699 10.4743C5.67026 10.4743 5.67351 10.4752 5.67676 10.4753H10.3242C10.3274 10.4752 10.3308 10.4743 10.334 10.4743C10.3373 10.4743 10.3405 10.4752 10.3438 10.4753H12.667C13.1133 10.4751 13.4746 10.113 13.4746 9.66666V3.99967C13.4744 3.5535 13.1132 3.19223 12.667 3.19205H3.33301Z" fill="currentColor"/>`,
});

export function DesktopLight16Icon(props: Omit<IconProps, "asset">) {
  return <Icon asset={desktopLight16} {...props} />;
}
