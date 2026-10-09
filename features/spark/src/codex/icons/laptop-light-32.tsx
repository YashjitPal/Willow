import { Icon, type IconProps } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const laptopLight32 = defineIconAsset({
  name: "laptop-light-32",
  canvas: {
    width: 32,
    height: 32,
    viewBox: "0 0 32 32",
    frame: { x: 0, y: 0, width: 32, height: 32 },
    inkBounds: { x: 1.38623, y: 5.099609, width: 29.22168, height: 21.958984 },
    visualBounds: { x: 1.38623, y: 5.099609, width: 29.22168, height: 21.958984 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.38623, y: 5.099609, width: 29.22168, height: 21.958984 },
    center: { x: 15.99707, y: 16.079101 },
    insets: { top: 5.099609, right: 1.39209, bottom: 4.941407, left: 1.38623 },
    anchors: {
      frame: { x: 16, y: 16 },
      ink: { x: 15.99707, y: 16.079101 },
      foreground: { x: 15.99707, y: 16.079101 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M25.0005 5.09961C27.1542 5.09987 28.9009 6.84625 28.9009 9V20.4326C29.8432 20.4327 30.6077 21.1974 30.6079 22.1396V23.7383C30.6079 25.5716 29.1219 27.0586 27.2886 27.0586H4.70654C2.8732 27.0586 1.38623 25.5716 1.38623 23.7383V22.1396C1.38643 21.1973 2.1509 20.4326 3.09326 20.4326H3.1001V9C3.1001 6.84609 4.84658 5.09961 7.00049 5.09961H25.0005ZM3.18701 23.7383C3.18701 24.5775 3.86731 25.2578 4.70654 25.2578H27.2886C28.1278 25.2578 28.8081 24.5775 28.8081 23.7383V22.2334H3.18701V23.7383ZM7.00049 6.90039C5.84069 6.90039 4.90088 7.8402 4.90088 9V20.4326H27.1001V9C27.1001 7.84036 26.1601 6.90065 25.0005 6.90039H7.00049Z" fill="currentColor"/>`,
});

export function LaptopLight32Icon(props: Omit<IconProps, "asset">) {
  return <Icon asset={laptopLight32} {...props} />;
}
