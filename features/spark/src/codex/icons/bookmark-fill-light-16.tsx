import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const bookmarkFillLight16 = defineIconAsset({
  name: "bookmark-fill-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 2.474609, y: 1.474609, width: 11.050781, height: 12.623047 },
    visualBounds: { x: 2.474609, y: 1.474609, width: 11.050781, height: 12.623047 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.474609, y: 1.474609, width: 11.050781, height: 12.623047 },
    center: { x: 8, y: 7.786133 },
    insets: { top: 1.474609, right: 2.47461, bottom: 1.902344, left: 2.474609 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8, y: 7.786133 },
      foreground: { x: 8, y: 7.786133 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M10.2002 1.47461C12.0364 1.47472 13.5253 2.96361 13.5254 4.7998V12.0703C13.5254 13.6286 11.8383 14.6026 10.4883 13.8242L8.4873 12.6709C8.18589 12.4971 7.81411 12.4971 7.5127 12.6709L5.51172 13.8242C4.16172 14.6026 2.47461 13.6286 2.47461 12.0703V4.7998C2.47472 2.96361 3.96361 1.47472 5.7998 1.47461H10.2002Z" fill="currentColor"/>`,
});

export const BookmarkFillLight16Icon = createIconComponent(bookmarkFillLight16);
