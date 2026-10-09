import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const playLight16 = defineIconAsset({
  name: "play-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 3.474609, y: 2.165039, width: 10.258774, height: 11.725342 },
    visualBounds: { x: 3.474609, y: 2.165039, width: 10.258774, height: 11.725342 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 3.474609, y: 2.165039, width: 10.258774, height: 11.725342 },
    center: { x: 8.603996, y: 8.02771 },
    insets: { top: 2.165039, right: 2.266617, bottom: 2.109619, left: 3.474609 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8.603996, y: 8.02771 },
      foreground: { x: 8.603996, y: 8.02771 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M4.33594 2.33289C4.80057 2.10819 5.39866 2.08949 5.90332 2.39735L12.9395 6.67957L13.0352 6.74207C13.9964 7.41933 13.9651 8.91629 12.9414 9.5409L12.9336 9.54579L5.89648 13.6639L5.89551 13.663C5.39251 13.9659 4.79815 13.9461 4.33594 13.7225C3.86641 13.4954 3.47443 13.0257 3.47461 12.3954V3.66004C3.47443 3.02975 3.8664 2.56008 4.33594 2.33289ZM4.52539 12.3954C4.52535 12.549 4.61423 12.6918 4.79297 12.7782C4.97639 12.8669 5.19331 12.8628 5.35742 12.7626L5.36621 12.7577L12.3945 8.64442C12.7798 8.40935 12.7791 7.81131 12.3936 7.57704L5.3584 3.29383L5.35742 3.29286C5.19331 3.1926 4.97638 3.1895 4.79297 3.27821C4.61448 3.36467 4.52535 3.50652 4.52539 3.66004V12.3954Z" fill="currentColor"/>`,
});

export const PlayLight16Icon = createIconComponent(playLight16);
