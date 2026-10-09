import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const bookmarkLight20 = defineIconAsset({
  name: "bookmark-light-20",
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
  body: `<path d="M8.91895 14.5859C9.58818 14.2001 10.4118 14.2001 11.0811 14.5859L14.333 16.46C14.8896 16.7809 15.5847 16.3797 15.585 15.7373V5.2998C15.5849 4.12083 14.6292 3.16515 13.4502 3.16504H6.5498C5.37083 3.16514 4.41514 4.12083 4.41504 5.2998V15.7373C4.41526 16.3797 5.11041 16.7809 5.66699 16.46L8.91895 14.5859ZM16.915 15.7373C16.9148 17.4031 15.1122 18.4443 13.6689 17.6123L10.417 15.7383C10.1589 15.5894 9.84114 15.5894 9.58301 15.7383L6.33105 17.6123C4.88784 18.4443 3.08518 17.4031 3.08496 15.7373V5.2998C3.08507 3.38629 4.63629 1.83507 6.5498 1.83496H13.4502C15.3637 1.83507 16.9149 3.38629 16.915 5.2998V15.7373Z" fill="currentColor"/>`,
});

export const BookmarkLight20Icon = createIconComponent(bookmarkLight20);
