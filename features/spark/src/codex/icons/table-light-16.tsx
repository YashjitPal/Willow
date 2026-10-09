import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const tableLight16 = defineIconAsset({
  name: "table-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 1.474609, y: 2.474609, width: 13.050781, height: 11.050781 },
    visualBounds: { x: 1.474609, y: 2.474609, width: 13.050781, height: 11.050781 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.474609, y: 2.474609, width: 13.050781, height: 11.050781 },
    center: { x: 8, y: 8 },
    insets: { top: 2.474609, right: 1.47461, bottom: 2.47461, left: 1.474609 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8, y: 8 },
      foreground: { x: 8, y: 8 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M12.1338 2.47461C13.4543 2.47486 14.5251 3.54569 14.5254 4.86621V11.1338C14.5251 12.4543 13.4543 13.5251 12.1338 13.5254H3.86621C2.54569 13.5251 1.47486 12.4543 1.47461 11.1338V4.86621C1.47486 3.54569 2.54569 2.47486 3.86621 2.47461H12.1338ZM8.52539 12.4746H12.1338C12.8744 12.4744 13.4744 11.8744 13.4746 11.1338V7.19238H8.52539V12.4746ZM2.52539 11.1338C2.52564 11.8744 3.12559 12.4744 3.86621 12.4746H7.47461V7.19238H2.52539V11.1338ZM3.86621 3.52539C3.12559 3.52564 2.52564 4.12559 2.52539 4.86621V6.1416H13.4746V4.86621C13.4744 4.12559 12.8744 3.52564 12.1338 3.52539H3.86621Z" fill="currentColor"/>`,
});

export const TableLight16Icon = createIconComponent(tableLight16);
