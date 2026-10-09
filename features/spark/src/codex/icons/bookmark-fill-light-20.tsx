import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const bookmarkFillLight20 = defineIconAsset({
  name: "bookmark-fill-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 3.084961, y: 1.834961, width: 13.830078, height: 16.070313 },
    visualBounds: { x: 3.084961, y: 1.834961, width: 13.830078, height: 16.070313 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 3.084961, y: 1.834961, width: 13.830078, height: 16.070313 },
    center: { x: 10, y: 9.870118 },
    insets: { top: 1.834961, right: 3.084961, bottom: 2.094726, left: 3.084961 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10, y: 9.870118 },
      foreground: { x: 10, y: 9.870118 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M13.4502 1.83496C15.3637 1.83507 16.9149 3.38629 16.915 5.2998V15.7373C16.9148 17.4031 15.1122 18.4443 13.6689 17.6123L10.417 15.7383C10.1589 15.5894 9.84114 15.5894 9.58301 15.7383L6.33105 17.6123C4.88784 18.4443 3.08518 17.4031 3.08496 15.7373V5.2998C3.08507 3.38629 4.63629 1.83507 6.5498 1.83496H13.4502Z" fill="currentColor"/>`,
});

export const BookmarkFillLight20Icon = createIconComponent(bookmarkFillLight20);
