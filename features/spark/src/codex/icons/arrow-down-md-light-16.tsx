import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const arrowDownMdLight16 = defineIconAsset({
  name: "arrow-down-md-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 4.141846, y: 3.475098, width: 7.716309, height: 8.945801 },
    visualBounds: { x: 4.141846, y: 3.475098, width: 7.716309, height: 8.945801 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 4.141846, y: 3.475098, width: 7.716309, height: 8.945801 },
    center: { x: 8.000001, y: 7.947999 },
    insets: { top: 3.475098, right: 4.141845, bottom: 3.579101, left: 4.141846 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8.000001, y: 7.947999 },
      foreground: { x: 8.000001, y: 7.947999 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M8.00047 3.4751C8.29033 3.4752 8.52586 3.7106 8.52586 4.00049V10.731L10.9624 8.29541C11.1673 8.09067 11.4996 8.09082 11.7046 8.29541C11.9094 8.50039 11.9094 8.83261 11.7046 9.0376L8.54734 12.1938C8.24468 12.4964 7.75427 12.4965 7.45164 12.1938L4.29539 9.0376C4.09077 8.83257 4.09056 8.50031 4.29539 8.29541C4.50029 8.09051 4.83252 8.09076 5.03758 8.29541L7.47508 10.7329V4.00049C7.47508 3.71054 7.71052 3.4751 8.00047 3.4751Z" fill="currentColor"/>`,
});

export const ArrowDownMdLight16Icon = createIconComponent(arrowDownMdLight16);
