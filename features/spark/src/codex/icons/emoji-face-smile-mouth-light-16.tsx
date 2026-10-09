import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const emojiFaceSmileMouthLight16 = defineIconAsset({
  name: "emoji-face-smile-mouth-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 1.474609, y: 1.474609, width: 13.050781, height: 13.050781 },
    visualBounds: { x: 1.474609, y: 1.474609, width: 13.050781, height: 13.050781 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "circular",
    bounds: { x: 1.474609, y: 1.474609, width: 13.050781, height: 13.050781 },
    center: { x: 8, y: 8 },
    insets: { top: 1.474609, right: 1.47461, bottom: 1.47461, left: 1.474609 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8, y: 8 },
      foreground: { x: 8, y: 8 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M10.2559 9.74316C10.4409 9.52002 10.7719 9.48898 10.9951 9.67383C11.2181 9.85892 11.2494 10.19 11.0645 10.4131C10.3355 11.2923 9.23291 11.8544 8 11.8545C6.76713 11.8545 5.66452 11.2922 4.93555 10.4131C4.75064 10.1899 4.7818 9.85886 5.00488 9.67383C5.2281 9.48889 5.55912 9.51999 5.74414 9.74316C6.28219 10.3919 7.0929 10.8037 8 10.8037C8.90711 10.8037 9.71783 10.3919 10.2559 9.74316Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M8 1.47461C11.6037 1.47461 14.5254 4.39634 14.5254 8C14.5254 11.6037 11.6037 14.5254 8 14.5254C4.39634 14.5254 1.47461 11.6037 1.47461 8C1.47461 4.39634 4.39634 1.47461 8 1.47461ZM8 2.52539C4.97624 2.52539 2.52539 4.97624 2.52539 8C2.52539 11.0238 4.97624 13.4746 8 13.4746C11.0238 13.4746 13.4746 11.0238 13.4746 8C13.4746 4.97624 11.0238 2.52539 8 2.52539Z" fill="currentColor"/>`,
});

export const EmojiFaceSmileMouthLight16Icon = createIconComponent(emojiFaceSmileMouthLight16);
