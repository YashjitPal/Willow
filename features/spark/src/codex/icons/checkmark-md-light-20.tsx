import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const checkmarkMdLight20 = defineIconAsset({
  name: "checkmark-md-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 4.335129, y: 4.746582, width: 11.324936, height: 10.425781 },
    visualBounds: { x: 4.335129, y: 4.746582, width: 11.324936, height: 10.425781 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 4.335129, y: 4.746582, width: 11.324936, height: 10.425781 },
    center: { x: 9.997597, y: 9.959473 },
    insets: { top: 4.746582, right: 4.339935, bottom: 4.827637, left: 4.335129 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 9.997597, y: 9.959473 },
      foreground: { x: 9.997597, y: 9.959473 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M14.4453 5.03754C14.6518 4.73389 15.0654 4.65531 15.3691 4.86176C15.6727 5.06829 15.7513 5.48193 15.5449 5.78558L9.40523 14.8159C9.11759 15.2388 8.51563 15.2949 8.15425 14.933L4.52925 11.3002C4.26993 11.0403 4.27047 10.6192 4.53023 10.3598C4.79023 10.1005 5.21127 10.1008 5.47066 10.3608L8.65523 13.5522L14.4453 5.03754Z" fill="currentColor"/>`,
});

export const CheckmarkMdLight20Icon = createIconComponent(checkmarkMdLight20);
