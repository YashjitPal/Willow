import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const circleExclamationmarkRegular32 = defineIconAsset({
  name: "circle-exclamationmark-regular-32",
  canvas: {
    width: 32,
    height: 32,
    viewBox: "0 0 32 32",
    frame: { x: 0, y: 0, width: 32, height: 32 },
    inkBounds: { x: 2.75, y: 2.75, width: 26.5, height: 26.5 },
    visualBounds: { x: 2.75, y: 2.75, width: 26.5, height: 26.5 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "circular",
    bounds: { x: 2.75, y: 2.75, width: 26.5, height: 26.5 },
    center: { x: 16, y: 16 },
    insets: { top: 2.75, right: 2.75, bottom: 2.75, left: 2.75 },
    anchors: {
      frame: { x: 16, y: 16 },
      ink: { x: 16, y: 16 },
      foreground: { x: 16, y: 16 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M17.7891 20.5755C17.7891 21.5887 16.9677 22.41 15.9546 22.41C14.9414 22.41 14.1201 21.5887 14.1201 20.5755C14.1201 19.5623 14.9414 18.741 15.9546 18.741C16.9677 18.741 17.7891 19.5623 17.7891 20.5755Z" fill="currentColor"/> <path d="M26.75 16C26.75 10.0629 21.9371 5.25 16 5.25C10.0629 5.25 5.25 10.0629 5.25 16C5.25 21.9371 10.0629 26.75 16 26.75C21.9371 26.75 26.75 21.9371 26.75 16ZM29.25 16C29.25 23.3178 23.3178 29.25 16 29.25C8.68223 29.25 2.75 23.3178 2.75 16C2.75 8.68223 8.68223 2.75 16 2.75C23.3178 2.75 29.25 8.68223 29.25 16Z" fill="currentColor"/> <path d="M14.7043 15.8403V10.1733C14.7043 9.48298 15.264 8.92334 15.9543 8.92334C16.6447 8.92334 17.2043 9.48298 17.2043 10.1733V15.8403C17.2042 16.5305 16.6446 17.0903 15.9543 17.0903C15.2641 17.0903 14.7045 16.5305 14.7043 15.8403Z" fill="currentColor"/>`,
});

export const CircleExclamationmarkRegular32Icon = createIconComponent(circleExclamationmarkRegular32);
