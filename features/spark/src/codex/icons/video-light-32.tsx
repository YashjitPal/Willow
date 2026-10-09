import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const videoLight32 = defineIconAsset({
  name: "video-light-32",
  canvas: {
    width: 32,
    height: 32,
    viewBox: "0 0 32 32",
    frame: { x: 0, y: 0, width: 32, height: 32 },
    inkBounds: { x: 3.099609, y: 6.433105, width: 26.466797, height: 19.133789 },
    visualBounds: { x: 3.099609, y: 6.433105, width: 26.466797, height: 19.133789 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 3.099609, y: 6.433105, width: 26.466797, height: 19.133789 },
    center: { x: 16.333008, y: 16 },
    insets: { top: 6.433105, right: 2.433594, bottom: 6.433106, left: 3.099609 },
    anchors: {
      frame: { x: 16, y: 16 },
      ink: { x: 16.333008, y: 16 },
      foreground: { x: 16.333008, y: 16 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M17.333 6.43311C20.0392 6.43311 22.2334 8.6273 22.2334 11.3335V12.2612L26.8623 8.87256L26.9688 8.80029C28.0825 8.10107 29.5664 8.89624 29.5664 10.2446V21.7563C29.5662 23.148 27.9853 23.9504 26.8623 23.1284L22.2334 19.7388V20.6665C22.2334 23.3727 20.0392 25.5669 17.333 25.5669H8C5.2938 25.5669 3.09961 23.3727 3.09961 20.6665V11.3335C3.09961 8.6273 5.2938 6.43311 8 6.43311H17.333ZM8 8.23389C6.28792 8.23389 4.90039 9.62141 4.90039 11.3335V20.6665C4.90039 22.3786 6.28792 23.7671 8 23.7671H17.333C19.0451 23.7671 20.4336 22.3786 20.4336 20.6665V11.3335C20.4336 9.62141 19.0451 8.23389 17.333 8.23389H8ZM22.2334 14.4917V17.5083L27.7666 21.5591V10.4409L22.2334 14.4917Z" fill="currentColor"/>`,
});

export const VideoLight32Icon = createIconComponent(videoLight32);
