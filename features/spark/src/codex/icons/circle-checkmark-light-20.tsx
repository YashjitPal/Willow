import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const circleCheckmarkLight20 = defineIconAsset({
  name: "circle-checkmark-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 1.834961, y: 1.834961, width: 16.330078, height: 16.330078 },
    visualBounds: { x: 1.834961, y: 1.834961, width: 16.330078, height: 16.330078 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "circular",
    bounds: { x: 1.834961, y: 1.834961, width: 16.330078, height: 16.330078 },
    center: { x: 10, y: 10 },
    insets: { top: 1.834961, right: 1.834961, bottom: 1.834961, left: 1.834961 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10, y: 10 },
      foreground: { x: 10, y: 10 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M12.2764 7.1875C12.481 6.88276 12.8943 6.80044 13.1992 7.00488C13.504 7.20932 13.5849 7.62277 13.3809 7.92773L9.94727 13.0498C9.61906 13.5393 8.91968 13.5959 8.51758 13.165L6.68555 11.2012C6.43506 10.9327 6.44936 10.5113 6.71777 10.2607C6.98633 10.0105 7.40777 10.0255 7.6582 10.2939L9.13281 11.875L12.2764 7.1875Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M10 1.83496C14.5094 1.83496 18.165 5.49059 18.165 10C18.165 14.5094 14.5094 18.165 10 18.165C5.49059 18.165 1.83496 14.5094 1.83496 10C1.83496 5.49059 5.49059 1.83496 10 1.83496ZM10 3.16504C6.22513 3.16504 3.16504 6.22513 3.16504 10C3.16504 13.7749 6.22513 16.835 10 16.835C13.7749 16.835 16.835 13.7749 16.835 10C16.835 6.22513 13.7749 3.16504 10 3.16504Z" fill="currentColor"/>`,
});

export const CircleCheckmarkLight20Icon = createIconComponent(circleCheckmarkLight20);
