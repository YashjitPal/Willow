import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const filterLight16 = defineIconAsset({
  name: "filter-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 1.474609, y: 3.474609, width: 13.050781, height: 9.050781 },
    visualBounds: { x: 1.474609, y: 3.474609, width: 13.050781, height: 9.050781 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.474609, y: 3.474609, width: 13.050781, height: 9.050781 },
    center: { x: 8, y: 8 },
    insets: { top: 3.474609, right: 1.47461, bottom: 3.47461, left: 1.474609 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8, y: 8 },
      foreground: { x: 8, y: 8 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M10 11.4746C10.2899 11.4746 10.5254 11.7101 10.5254 12C10.5254 12.2899 10.2899 12.5254 10 12.5254H6C5.71005 12.5254 5.47461 12.2899 5.47461 12C5.47461 11.7101 5.71005 11.4746 6 11.4746H10Z" fill="currentColor"/> <path d="M12 7.47461C12.2899 7.47461 12.5254 7.71005 12.5254 8C12.5254 8.28995 12.2899 8.52539 12 8.52539H4C3.71005 8.52539 3.47461 8.28995 3.47461 8C3.47461 7.71005 3.71005 7.47461 4 7.47461H12Z" fill="currentColor"/> <path d="M14 3.47461C14.2899 3.47461 14.5254 3.71005 14.5254 4C14.5254 4.28995 14.2899 4.52539 14 4.52539H2C1.71005 4.52539 1.47461 4.28995 1.47461 4C1.47461 3.71005 1.71005 3.47461 2 3.47461H14Z" fill="currentColor"/>`,
});

export const FilterLight16Icon = createIconComponent(filterLight16);
