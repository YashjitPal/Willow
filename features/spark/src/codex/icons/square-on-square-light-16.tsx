import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const squareOnSquareLight16 = defineIconAsset({
  name: "square-on-square-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 1.474609, y: 1.434082, width: 13.050781, height: 13.050781 },
    visualBounds: { x: 1.474609, y: 1.434082, width: 13.050781, height: 13.050781 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.474609, y: 1.434082, width: 13.050781, height: 13.050781 },
    center: { x: 8, y: 7.959473 },
    insets: { top: 1.434082, right: 1.47461, bottom: 1.515137, left: 1.474609 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8, y: 7.959473 },
      foreground: { x: 8, y: 7.959473 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M12.001 1.43408C13.3951 1.43452 14.5254 2.56522 14.5254 3.95947V8.62646C14.5252 10.0206 13.395 11.1504 12.001 11.1509H11.1914V11.9604C11.191 13.3545 10.0611 14.4847 8.66699 14.4849H4C2.60575 14.4849 1.47505 13.3546 1.47461 11.9604V7.29346C1.47461 5.89894 2.60548 4.76807 4 4.76807H4.80859V3.95947C4.80859 2.56495 5.93947 1.43408 7.33398 1.43408H12.001ZM4 5.81885C3.18538 5.81885 2.52539 6.47884 2.52539 7.29346V11.9604C2.52583 12.7747 3.18565 13.4351 4 13.4351H8.66699C9.48119 13.4349 10.1412 12.7746 10.1416 11.9604V7.29346C10.1416 6.47895 9.48146 5.81902 8.66699 5.81885H4ZM7.33398 2.48486C6.51936 2.48486 5.85938 3.14485 5.85938 3.95947V4.76807H8.66699C10.0614 4.76824 11.1914 5.89905 11.1914 7.29346V10.1011H12.001C12.8151 10.1006 13.4754 9.44066 13.4756 8.62646V3.95947C13.4756 3.14512 12.8152 2.4853 12.001 2.48486H7.33398Z" fill="currentColor"/>`,
});

export const SquareOnSquareLight16Icon = createIconComponent(squareOnSquareLight16);
