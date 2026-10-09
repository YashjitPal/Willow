import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const arrowUpRightLgLight16 = defineIconAsset({
  name: "arrow-up-right-lg-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 3.475098, y: 3.474609, width: 9.050049, height: 9.055176 },
    visualBounds: { x: 3.475098, y: 3.474609, width: 9.050049, height: 9.055176 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 3.475098, y: 3.474609, width: 9.050049, height: 9.055176 },
    center: { x: 8.000123, y: 8.002197 },
    insets: { top: 3.474609, right: 3.474853, bottom: 3.470215, left: 3.475098 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8.000123, y: 8.002197 },
      foreground: { x: 8.000123, y: 8.002197 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M11.9489 3.47949C12.0996 3.46465 12.2552 3.51279 12.3707 3.62793C12.4862 3.74328 12.5337 3.89898 12.5192 4.0498C12.5205 4.06633 12.525 4.08275 12.525 4.09961V10.667C12.5249 10.9565 12.2901 11.191 12.0006 11.1914C11.7108 11.1914 11.4754 10.9568 11.4752 10.667V5.2666L4.37172 12.376C4.16672 12.5807 3.83352 12.5808 3.62855 12.376C3.42373 12.1711 3.42384 11.8388 3.62855 11.6338L10.733 4.52539H5.33363C5.04368 4.52539 4.80824 4.28995 4.80824 4C4.80824 3.71005 5.04368 3.47461 5.33363 3.47461H11.9C11.9165 3.47462 11.9327 3.47822 11.9489 3.47949Z" fill="currentColor"/>`,
});

export const ArrowUpRightLgLight16Icon = createIconComponent(arrowUpRightLgLight16);
