import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const textAlignleftLight16 = defineIconAsset({
  name: "text-alignleft-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 2.141113, y: 2.808594, width: 11.716797, height: 10.382813 },
    visualBounds: { x: 2.141113, y: 2.808594, width: 11.716797, height: 10.382813 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.141113, y: 2.808594, width: 11.716797, height: 10.382813 },
    center: { x: 7.999512, y: 8.000001 },
    insets: { top: 2.808594, right: 2.14209, bottom: 2.808593, left: 2.141113 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 7.999512, y: 8.000001 },
      foreground: { x: 7.999512, y: 8.000001 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M13.3335 12.1406C13.6233 12.1408 13.8579 12.3762 13.8579 12.666C13.8579 12.9559 13.6233 13.1912 13.3335 13.1914H2.6665C2.37655 13.1914 2.14111 12.956 2.14111 12.666C2.14111 12.3761 2.37655 12.1406 2.6665 12.1406H13.3335Z" fill="currentColor"/> <path d="M8.99951 7.47461C9.28946 7.47461 9.5249 7.71005 9.5249 8C9.5249 8.28995 9.28946 8.52539 8.99951 8.52539H2.6665C2.37655 8.52539 2.14111 8.28995 2.14111 8C2.14111 7.71005 2.37655 7.47461 2.6665 7.47461H8.99951Z" fill="currentColor"/> <path d="M13.3335 2.80859C13.6233 2.80877 13.8579 3.04414 13.8579 3.33398C13.8579 3.62383 13.6233 3.8592 13.3335 3.85938H2.6665C2.37655 3.85938 2.14111 3.62393 2.14111 3.33398C2.14111 3.04403 2.37655 2.80859 2.6665 2.80859H13.3335Z" fill="currentColor"/>`,
});

export const TextAlignleftLight16Icon = createIconComponent(textAlignleftLight16);
