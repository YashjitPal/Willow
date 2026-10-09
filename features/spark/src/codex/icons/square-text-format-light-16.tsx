import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const squareTextFormatLight16 = defineIconAsset({
  name: "square-text-format-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 2.141602, y: 2.141357, width: 11.716797, height: 11.716797 },
    visualBounds: { x: 2.141602, y: 2.141357, width: 11.716797, height: 11.716797 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.141602, y: 2.141357, width: 11.716797, height: 11.716797 },
    center: { x: 8, y: 7.999756 },
    insets: { top: 2.141357, right: 2.141601, bottom: 2.141846, left: 2.141602 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8, y: 7.999756 },
      foreground: { x: 8, y: 7.999756 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M10.6621 4.64624C11.0439 4.64643 11.3535 4.95674 11.3535 5.33862V5.98022C11.3531 6.26985 11.1178 6.50464 10.8281 6.50464C10.5385 6.50448 10.3041 6.26975 10.3037 5.98022V5.69702H8.52539V10.3035H9.21191C9.50179 10.3035 9.73633 10.539 9.73633 10.8289C9.73632 11.1187 9.50179 11.3542 9.21191 11.3542H6.78711C6.49717 11.3542 6.26173 11.1188 6.26172 10.8289C6.26172 10.5389 6.49716 10.3035 6.78711 10.3035H7.47461V5.69702H5.69629V5.98022C5.69591 6.26985 5.46062 6.50464 5.1709 6.50464C4.88118 6.50464 4.64588 6.26985 4.64551 5.98022V5.33862C4.64551 4.95663 4.95589 4.64624 5.33789 4.64624H10.6621Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M11.4668 2.14136C12.7875 2.14136 13.8582 3.21229 13.8584 4.53296V11.4666C13.8584 12.7874 12.7877 13.8582 11.4668 13.8582H4.5332C3.21253 13.8579 2.1416 12.7873 2.1416 11.4666V4.53296C2.14185 3.21244 3.21268 2.1416 4.5332 2.14136H11.4668ZM4.5332 3.19214C3.79258 3.19238 3.19263 3.79234 3.19238 4.53296V11.4666C3.19238 12.2074 3.79243 12.8081 4.5332 12.8083H11.4668C12.2078 12.8083 12.8086 12.2075 12.8086 11.4666V4.53296C12.8083 3.79219 12.2076 3.19214 11.4668 3.19214H4.5332Z" fill="currentColor"/>`,
});

export const SquareTextFormatLight16Icon = createIconComponent(squareTextFormatLight16);
