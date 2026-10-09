import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const paperclipLight16 = defineIconAsset({
  name: "paperclip-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 3.474609, y: 1.307861, width: 9.078125, height: 13.383789 },
    visualBounds: { x: 3.474609, y: 1.307861, width: 9.078125, height: 13.383789 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 3.474609, y: 1.307861, width: 9.078125, height: 13.383789 },
    center: { x: 8.013672, y: 7.999756 },
    insets: { top: 1.307861, right: 3.447266, bottom: 1.30835, left: 3.474609 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8.013672, y: 7.999756 },
      foreground: { x: 8.013672, y: 7.999756 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M6.1416 10.1663V4.50024C6.1416 2.70191 7.53472 1.30803 9.33301 1.30786C11.1487 1.30786 12.5526 2.71648 12.5527 4.53052V10.1575C12.5527 12.7348 10.5696 14.6916 7.99902 14.6917C5.43579 14.6917 3.47461 12.7291 3.47461 10.1663V5.83325C3.47461 5.5433 3.71005 5.30786 4 5.30786C4.28995 5.30786 4.52539 5.5433 4.52539 5.83325V10.1663C4.52539 12.1496 6.01605 13.6418 7.99902 13.6418C9.99647 13.6418 11.5029 12.1482 11.5029 10.1575V4.53052C11.5028 3.29473 10.5672 2.35864 9.33301 2.35864C8.11462 2.35881 7.19141 3.28181 7.19141 4.50024V10.1663C7.19141 10.6338 7.53247 10.9749 8 10.9749C8.46812 10.9749 8.80859 10.6344 8.80859 10.1663V5.83325C8.80859 5.54341 9.04321 5.30804 9.33301 5.30786C9.62296 5.30786 9.8584 5.5433 9.8584 5.83325V10.1663C9.8584 11.2143 9.04802 12.0247 8 12.0247C6.95257 12.0247 6.1416 11.2137 6.1416 10.1663Z" fill="currentColor"/>`,
});

export const PaperclipLight16Icon = createIconComponent(paperclipLight16);
