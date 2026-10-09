import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const xmarkLgRegular20 = defineIconAsset({
  name: "xmark-lg-regular-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 3.874573, y: 3.874634, width: 12.250641, height: 12.25061 },
    visualBounds: { x: 3.874573, y: 3.874634, width: 12.250641, height: 12.25061 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 3.874573, y: 3.874634, width: 12.250641, height: 12.25061 },
    center: { x: 9.999893, y: 9.999939 },
    insets: { top: 3.874634, right: 3.874786, bottom: 3.874756, left: 3.874573 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 9.999893, y: 9.999939 },
      foreground: { x: 9.999893, y: 9.999939 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M14.6306 4.13058C14.9722 3.78902 15.5272 3.7893 15.8689 4.13058C16.2106 4.47229 16.2106 5.02715 15.8689 5.36886L11.2381 9.99972L15.8689 14.6306C16.2106 14.9723 16.2106 15.5272 15.8689 15.8689C15.5272 16.2106 14.9724 16.2106 14.6306 15.8689L9.99978 11.238L5.36892 15.8689C5.02722 16.2106 4.47235 16.2106 4.13064 15.8689C3.78936 15.5271 3.78908 14.9721 4.13064 14.6306L8.7615 9.99972L4.13064 5.36886C3.78936 5.02712 3.78908 4.47215 4.13064 4.13058C4.47221 3.78901 5.02718 3.7893 5.36892 4.13058L9.99978 8.76144L14.6306 4.13058Z" fill="currentColor"/>`,
});

export const XmarkLgRegular20Icon = createIconComponent(xmarkLgRegular20);
