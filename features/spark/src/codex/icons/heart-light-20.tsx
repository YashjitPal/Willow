import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const heartLight20 = defineIconAsset({
  name: "heart-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 1.417969, y: 2.230469, width: 17.16333, height: 15.50293 },
    visualBounds: { x: 1.417969, y: 2.230469, width: 17.16333, height: 15.50293 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.417969, y: 2.230469, width: 17.16333, height: 15.50293 },
    center: { x: 9.999634, y: 9.981934 },
    insets: { top: 2.230469, right: 1.418701, bottom: 2.266601, left: 1.417969 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 9.999634, y: 9.981934 },
      foreground: { x: 9.999634, y: 9.981934 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M13.2785 2.23302C16.0792 2.14377 18.5593 4.41517 18.5812 7.5836C18.6022 10.6571 16.3389 14.3501 10.4435 17.6188C10.1682 17.7713 9.83108 17.7714 9.55581 17.6188C3.66045 14.3501 1.39712 10.6571 1.41811 7.5836C1.44 4.4151 3.92099 2.14365 6.72182 2.23302C7.83892 2.26876 8.97676 2.68172 9.99917 3.52305C11.0219 2.6812 12.161 2.26869 13.2785 2.23302ZM13.3205 3.56212C12.4407 3.59024 11.4981 3.93962 10.6291 4.73692C10.2735 5.06294 9.72574 5.06304 9.37026 4.73692C8.50112 3.93956 7.5587 3.59019 6.67886 3.56212C4.64694 3.49734 2.76488 5.15023 2.74819 7.59337C2.73232 9.93185 4.45459 13.2121 9.99917 16.3414C15.5445 13.212 17.267 9.932 17.2511 7.59337C17.2344 5.15016 15.3524 3.49725 13.3205 3.56212Z" fill="currentColor"/>`,
});

export const HeartLight20Icon = createIconComponent(heartLight20);
