import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const bookmarkLight16 = defineIconAsset({
  name: "bookmark-light-16",
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
  body: `<path d="M6.98828 11.7607C7.6143 11.3998 8.3857 11.3998 9.01172 11.7607L11.0127 12.915C11.6627 13.2898 12.4746 12.8206 12.4746 12.0703V4.7998C12.4745 3.54351 11.4565 2.5255 10.2002 2.52539H5.7998C4.54351 2.5255 3.5255 3.54351 3.52539 4.7998V12.0703C3.52539 12.8206 4.33731 13.2898 4.9873 12.915L6.98828 11.7607ZM13.5254 12.0703C13.5254 13.6286 11.8383 14.6026 10.4883 13.8242L8.4873 12.6709C8.18589 12.4971 7.81411 12.4971 7.5127 12.6709L5.51172 13.8242C4.16172 14.6026 2.47461 13.6286 2.47461 12.0703V4.7998C2.47472 2.96361 3.96361 1.47472 5.7998 1.47461H10.2002C12.0364 1.47472 13.5253 2.96361 13.5254 4.7998V12.0703Z" fill="currentColor"/>`,
});

export const BookmarkLight16Icon = createIconComponent(bookmarkLight16);
