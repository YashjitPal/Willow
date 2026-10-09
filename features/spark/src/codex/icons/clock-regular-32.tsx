import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const clockRegular32 = defineIconAsset({
  name: "clock-regular-32",
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
  body: `<path d="M16 8.08398C16.6901 8.08423 17.25 8.64378 17.25 9.33398V15.7939C17.2498 16.2578 17.0653 16.7033 16.7373 17.0312L13.5508 20.2178C13.0628 20.7058 12.2714 20.7055 11.7832 20.2178C11.2951 19.7296 11.2951 18.9384 11.7832 18.4502L14.75 15.4834V9.33398C14.75 8.64374 15.3098 8.08416 16 8.08398Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M16 2.75C23.3178 2.75 29.25 8.68223 29.25 16C29.25 23.3178 23.3178 29.25 16 29.25C8.68223 29.25 2.75 23.3178 2.75 16C2.75 8.68223 8.68223 2.75 16 2.75ZM16 5.25C10.0629 5.25 5.25 10.0629 5.25 16C5.25 21.9371 10.0629 26.75 16 26.75C21.9371 26.75 26.75 21.9371 26.75 16C26.75 10.0629 21.9371 5.25 16 5.25Z" fill="currentColor"/>`,
});

export const ClockRegular32Icon = createIconComponent(clockRegular32);
