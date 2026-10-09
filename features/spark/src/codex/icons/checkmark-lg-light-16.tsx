import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const checkmarkLgLight16 = defineIconAsset({
  name: "checkmark-lg-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 2.304909, y: 2.77002, width: 11.373291, height: 10.3479 },
    visualBounds: { x: 2.304909, y: 2.77002, width: 11.373291, height: 10.3479 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.304909, y: 2.77002, width: 11.373291, height: 10.3479 },
    center: { x: 7.991554, y: 7.94397 },
    insets: { top: 2.77002, right: 2.3218, bottom: 2.88208, left: 2.304909 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 7.991554, y: 7.94397 },
      foreground: { x: 7.991554, y: 7.94397 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M12.7216 2.99666C12.8863 2.75824 13.2125 2.69837 13.4511 2.86287C13.6895 3.0274 13.75 3.35377 13.5858 3.59236L7.20011 12.8472C6.97922 13.1685 6.52057 13.2111 6.24405 12.9361L2.45987 9.18123C2.25451 8.97704 2.25305 8.64475 2.45694 8.43904C2.66115 8.23343 2.99433 8.23205 3.20011 8.43611L6.62296 11.8326L12.7216 2.99666Z" fill="currentColor"/>`,
});

export const CheckmarkLgLight16Icon = createIconComponent(checkmarkLgLight16);
