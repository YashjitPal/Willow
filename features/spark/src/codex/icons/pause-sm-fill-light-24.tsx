import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const pauseSmFillLight24 = defineIconAsset({
  name: "pause-sm-fill-light-24",
  canvas: {
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    frame: { x: 0, y: 0, width: 24, height: 24 },
    inkBounds: { x: 5.75, y: 6.25, width: 12.5, height: 11.5 },
    visualBounds: { x: 5.75, y: 6.25, width: 12.5, height: 11.5 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 5.75, y: 6.25, width: 12.5, height: 11.5 },
    center: { x: 12, y: 12 },
    insets: { top: 6.25, right: 5.75, bottom: 6.25, left: 5.75 },
    anchors: {
      frame: { x: 12, y: 12 },
      ink: { x: 12, y: 12 },
      foreground: { x: 12, y: 12 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M8.7998 6.25C9.60062 6.25 10.25 6.89938 10.25 7.7002V16.2998C10.25 17.1006 9.60062 17.75 8.7998 17.75H7.2002C6.39938 17.75 5.75 17.1006 5.75 16.2998V7.7002C5.75 6.89938 6.39938 6.25 7.2002 6.25H8.7998Z" fill="currentColor"/> <path d="M16.7998 6.25C17.6006 6.25 18.25 6.89938 18.25 7.7002V16.2998C18.25 17.1006 17.6006 17.75 16.7998 17.75H15.2002C14.3994 17.75 13.75 17.1006 13.75 16.2998V7.7002C13.75 6.89938 14.3994 6.25 15.2002 6.25H16.7998Z" fill="currentColor"/>`,
});

export const PauseSmFillLight24Icon = createIconComponent(pauseSmFillLight24);
