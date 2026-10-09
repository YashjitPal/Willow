import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const filmStripLight16 = defineIconAsset({
  name: "film-strip-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 1.474609, y: 2.141113, width: 13.050781, height: 11.716797 },
    visualBounds: { x: 1.474609, y: 2.141113, width: 13.050781, height: 11.716797 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.474609, y: 2.141113, width: 13.050781, height: 11.716797 },
    center: { x: 8, y: 7.999512 },
    insets: { top: 2.141113, right: 1.47461, bottom: 2.14209, left: 1.474609 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8, y: 7.999512 },
      foreground: { x: 8, y: 7.999512 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M12 2.14111C13.3945 2.14111 14.5254 3.27198 14.5254 4.6665V11.3335C14.5252 12.7279 13.3944 13.8579 12 13.8579H4C2.60559 13.8579 1.47479 12.7279 1.47461 11.3335V4.6665C1.47461 3.27199 2.60548 2.14111 4 2.14111H12ZM2.52539 7.19189V11.3335C2.52557 12.148 3.18549 12.8081 4 12.8081H12C12.8145 12.8081 13.4744 12.148 13.4746 11.3335V7.19189H2.52539ZM9.58105 6.14111H13.4746V4.6665C13.4746 3.85188 12.8146 3.19189 12 3.19189H11.3018L9.58105 6.14111ZM4 3.19189C3.18538 3.19189 2.52539 3.85188 2.52539 4.6665V6.14111H4.36621L6.08594 3.19189H4ZM5.58105 6.14111H8.36621L10.0859 3.19189H7.30176L5.58105 6.14111Z" fill="currentColor"/>`,
});

export const FilmStripLight16Icon = createIconComponent(filmStripLight16);
