import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const circlePersonLight16 = defineIconAsset({
  name: "circle-person-light-16",
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
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M8 4.1416C9.39452 4.1416 10.5254 5.27247 10.5254 6.66699C10.5251 8.06129 9.39436 9.19238 8 9.19238C6.60564 9.19238 5.47487 8.06129 5.47461 6.66699C5.47461 5.27247 6.60548 4.1416 8 4.1416ZM8 5.19238C7.18538 5.19238 6.52539 5.85237 6.52539 6.66699C6.52565 7.48139 7.18554 8.1416 8 8.1416C8.81446 8.1416 9.47435 7.48139 9.47461 6.66699C9.47461 5.85237 8.81462 5.19238 8 5.19238Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M8 1.47461C11.6037 1.47461 14.5254 4.39634 14.5254 8C14.5254 11.6037 11.6037 14.5254 8 14.5254C4.39634 14.5254 1.47461 11.6037 1.47461 8C1.47461 4.39634 4.39634 1.47461 8 1.47461ZM8 11.1924C6.82222 11.1925 5.78204 11.7791 5.15332 12.6768C5.98281 13.1827 6.95721 13.4746 8 13.4746C9.04297 13.4746 10.0171 13.1819 10.8467 12.6758C10.2178 11.7786 9.17734 11.1925 8 11.1924ZM8 2.52539C4.97624 2.52539 2.52539 4.97624 2.52539 8C2.52539 9.60307 3.21462 11.0447 4.3125 12.0459C5.13249 10.8944 6.47756 10.1417 8 10.1416C9.52227 10.1417 10.8667 10.8946 11.6865 12.0459C12.7847 11.0447 13.4746 9.60333 13.4746 8C13.4746 4.97624 11.0238 2.52539 8 2.52539Z" fill="currentColor"/>`,
});

export const CirclePersonLight16Icon = createIconComponent(circlePersonLight16);
