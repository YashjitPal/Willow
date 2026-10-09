import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const bookmarkFillLight12 = defineIconAsset({
  name: "bookmark-fill-light-12",
  canvas: {
    width: 12,
    height: 12,
    viewBox: "0 0 12 12",
    frame: { x: 0, y: 0, width: 12, height: 12 },
    inkBounds: { x: 1.849609, y: 1.099609, width: 8.300781, height: 9.572266 },
    visualBounds: { x: 1.849609, y: 1.099609, width: 8.300781, height: 9.572266 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.849609, y: 1.099609, width: 8.300781, height: 9.572266 },
    center: { x: 6, y: 5.885742 },
    insets: { top: 1.099609, right: 1.84961, bottom: 1.328125, left: 1.849609 },
    anchors: {
      frame: { x: 6, y: 6 },
      ink: { x: 6, y: 5.885742 },
      foreground: { x: 6, y: 5.885742 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M7.9502 1.09961C9.16507 1.09972 10.1503 2.08493 10.1504 3.2998V9.26953C10.1501 10.3465 8.98395 11.0202 8.05078 10.4824L6.2998 9.47266C6.11432 9.36571 5.88568 9.36571 5.7002 9.47266L3.94922 10.4824C3.01605 11.0202 1.84991 10.3465 1.84961 9.26953V3.2998C1.84971 2.08493 2.83493 1.09971 4.0498 1.09961H7.9502Z" fill="currentColor"/>`,
});

export const BookmarkFillLight12Icon = createIconComponent(bookmarkFillLight12);
