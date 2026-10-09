import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const filterLight20 = defineIconAsset({
  name: "filter-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 1.834961, y: 4.334961, width: 16.330078, height: 11.330078 },
    visualBounds: { x: 1.834961, y: 4.334961, width: 16.330078, height: 11.330078 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.834961, y: 4.334961, width: 16.330078, height: 11.330078 },
    center: { x: 10, y: 10 },
    insets: { top: 4.334961, right: 1.834961, bottom: 4.334961, left: 1.834961 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10, y: 10 },
      foreground: { x: 10, y: 10 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M12.5 14.335C12.8673 14.335 13.165 14.6327 13.165 15C13.165 15.3673 12.8673 15.665 12.5 15.665H7.5C7.13273 15.665 6.83496 15.3673 6.83496 15C6.83496 14.6327 7.13273 14.335 7.5 14.335H12.5Z" fill="currentColor"/> <path d="M15 9.33496C15.3673 9.33496 15.665 9.63273 15.665 10C15.665 10.3673 15.3673 10.665 15 10.665H5C4.63273 10.665 4.33496 10.3673 4.33496 10C4.33496 9.63273 4.63273 9.33496 5 9.33496H15Z" fill="currentColor"/> <path d="M17.5 4.33496C17.8673 4.33496 18.165 4.63273 18.165 5C18.165 5.36727 17.8673 5.66504 17.5 5.66504H2.5C2.13273 5.66504 1.83496 5.36727 1.83496 5C1.83496 4.63273 2.13273 4.33496 2.5 4.33496H17.5Z" fill="currentColor"/>`,
});

export const FilterLight20Icon = createIconComponent(filterLight20);
