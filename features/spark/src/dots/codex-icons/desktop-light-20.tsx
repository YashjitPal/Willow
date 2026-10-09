import { Icon, type IconProps } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const desktopLight20 = defineIconAsset({
  name: "desktop-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 1.834961, y: 2.668213, width: 16.330078, height: 14.664063 },
    visualBounds: { x: 1.834961, y: 2.668213, width: 16.330078, height: 14.664063 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.834961, y: 2.668213, width: 16.330078, height: 14.664063 },
    center: { x: 10, y: 10.000245 },
    insets: { top: 2.668213, right: 1.834961, bottom: 2.667724, left: 1.834961 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10, y: 10.000245 },
      foreground: { x: 10, y: 10.000245 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M15.833 2.6683C17.1208 2.6683 18.165 3.71258 18.165 5.00033V12.0833C18.165 13.3711 17.1208 14.4154 15.833 14.4154H13.5811V16.1673C13.5807 16.8104 13.0592 17.3324 12.416 17.3324H7.58301C6.93996 17.3322 6.41832 16.8103 6.41797 16.1673V14.4154H4.16699C2.87925 14.4154 1.83496 13.3711 1.83496 12.0833V5.00033C1.83496 3.71259 2.87925 2.6683 4.16699 2.6683H15.833ZM7.74805 14.4154V16.0023H12.251V14.4154H7.74805ZM4.16699 3.99837C3.61379 3.99837 3.16504 4.44712 3.16504 5.00033V12.0833C3.16504 12.6365 3.61379 13.0853 4.16699 13.0853H15.833C16.3862 13.0853 16.835 12.6365 16.835 12.0833V5.00033C16.835 4.44712 16.3862 3.99837 15.833 3.99837H4.16699Z" fill="currentColor"/>`,
});

export function DesktopLight20Icon(props: Omit<IconProps, "asset">) {
  return <Icon asset={desktopLight20} {...props} />;
}
