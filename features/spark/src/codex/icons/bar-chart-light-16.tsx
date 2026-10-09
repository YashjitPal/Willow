import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const barChartLight16 = defineIconAsset({
  name: "bar-chart-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 1.474609, y: 1.474609, width: 13.050781, height: 13.050781 },
    visualBounds: { x: 1.474609, y: 1.474609, width: 13.050781, height: 13.050781 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.474609, y: 1.474609, width: 13.050781, height: 13.050781 },
    center: { x: 8, y: 8 },
    insets: { top: 1.474609, right: 1.47461, bottom: 1.47461, left: 1.474609 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8, y: 8 },
      foreground: { x: 8, y: 8 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M8.50195 1.47461C9.62033 1.47461 10.5273 2.38162 10.5273 3.5V4.47461H12.5C13.6184 4.47461 14.5254 5.38162 14.5254 6.5V12.5C14.5254 13.6184 13.6184 14.5254 12.5 14.5254H3.5C2.38162 14.5254 1.47461 13.6184 1.47461 12.5V9.5C1.47461 8.38162 2.38162 7.47461 3.5 7.47461H5.47168V3.5C5.47168 2.38162 6.37869 1.47461 7.49707 1.47461H8.50195ZM10.5273 13.4746H12.5C13.0385 13.4746 13.4746 13.0385 13.4746 12.5V6.5C13.4746 5.96152 13.0385 5.52539 12.5 5.52539H10.5273V13.4746ZM7.49707 2.52539C6.95859 2.52539 6.52246 2.96152 6.52246 3.5V13.4746H9.47754V3.5C9.47754 2.96152 9.04043 2.52539 8.50195 2.52539H7.49707ZM3.5 8.52539C2.96152 8.52539 2.52539 8.96152 2.52539 9.5V12.5C2.52539 13.0385 2.96152 13.4746 3.5 13.4746H5.47168V8.52539H3.5Z" fill="currentColor"/>`,
});

export const BarChartLight16Icon = createIconComponent(barChartLight16);
