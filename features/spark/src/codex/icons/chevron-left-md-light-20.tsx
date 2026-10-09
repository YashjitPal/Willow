import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const chevronLeftMdLight20 = defineIconAsset({
  name: "chevron-left-md-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 6.507568, y: 4.334473, width: 6.157959, height: 11.331055 },
    visualBounds: { x: 6.507568, y: 4.334473, width: 6.157959, height: 11.331055 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 6.507568, y: 4.334473, width: 6.157959, height: 11.331055 },
    center: { x: 9.586548, y: 10 },
    insets: { top: 4.334473, right: 7.334473, bottom: 4.334472, left: 6.507568 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 9.586548, y: 10 },
      foreground: { x: 9.586548, y: 10 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M12.4707 14.5292C12.7304 14.7889 12.7304 15.211 12.4707 15.4707C12.211 15.7304 11.789 15.7304 11.5293 15.4707L6.82419 10.7646C6.40203 10.3422 6.40203 9.65767 6.82419 9.2353L11.5293 4.52925C11.789 4.26955 12.211 4.26955 12.4707 4.52925C12.7304 4.78895 12.7304 5.21095 12.4707 5.47065L7.94137 9.99995L12.4707 14.5292Z" fill="currentColor"/>`,
});

export const ChevronLeftMdLight20Icon = createIconComponent(chevronLeftMdLight20);
