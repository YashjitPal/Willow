import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const xmarkLgLight20 = defineIconAsset({
  name: "xmark-lg-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 4.084503, y: 4.084473, width: 11.830734, height: 11.830688 },
    visualBounds: { x: 4.084503, y: 4.084473, width: 11.830734, height: 11.830688 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 4.084503, y: 4.084473, width: 11.830734, height: 11.830688 },
    center: { x: 9.99987, y: 9.999817 },
    insets: { top: 4.084473, right: 4.084763, bottom: 4.084839, left: 4.084503 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 9.99987, y: 9.999817 },
      foreground: { x: 9.99987, y: 9.999817 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M14.779 4.27903C15.0386 4.01948 15.4607 4.01977 15.7204 4.27903C15.9801 4.53873 15.9801 4.96074 15.7204 5.22043L10.9411 9.99973L15.7204 14.779C15.9801 15.0387 15.9801 15.4607 15.7204 15.7204C15.4607 15.9801 15.0387 15.9801 14.779 15.7204L9.99973 10.9411L5.22043 15.7204C4.96073 15.9801 4.53872 15.9801 4.27903 15.7204C4.01977 15.4607 4.01948 15.0386 4.27903 14.779L9.05832 9.99973L4.27903 5.22043C4.01978 4.9607 4.01949 4.53858 4.27903 4.27903C4.53858 4.01948 4.9607 4.01978 5.22043 4.27903L9.99973 9.05832L14.779 4.27903Z" fill="currentColor"/>`,
});

export const XmarkLgLight20Icon = createIconComponent(xmarkLgLight20);
