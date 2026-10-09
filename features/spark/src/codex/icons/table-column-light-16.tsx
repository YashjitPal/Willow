import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const tableColumnLight16 = defineIconAsset({
  name: "table-column-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 1.474609, y: 2.141113, width: 13.050781, height: 11.050781 },
    visualBounds: { x: 1.474609, y: 2.141113, width: 13.050781, height: 11.050781 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.474609, y: 2.141113, width: 13.050781, height: 11.050781 },
    center: { x: 8, y: 7.666504 },
    insets: { top: 2.141113, right: 1.47461, bottom: 2.808106, left: 1.474609 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8, y: 7.666504 },
      foreground: { x: 8, y: 7.666504 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M12.1338 2.14111C13.4543 2.14136 14.5251 3.21219 14.5254 4.53271V10.8003C14.5251 12.1208 13.4543 13.1916 12.1338 13.1919H3.86621C2.54569 13.1916 1.47486 12.1208 1.47461 10.8003V4.53271C1.47486 3.2122 2.54569 2.14136 3.86621 2.14111H12.1338ZM8.52539 12.1411H12.1338C12.8744 12.1409 13.4744 11.5409 13.4746 10.8003V4.53271C13.4744 3.79209 12.8744 3.19214 12.1338 3.19189H8.52539V12.1411ZM3.86621 3.19189C3.12559 3.19214 2.52564 3.79209 2.52539 4.53271V10.8003C2.52564 11.5409 3.12559 12.1409 3.86621 12.1411H7.47461V3.19189H3.86621Z" fill="currentColor"/>`,
});

export const TableColumnLight16Icon = createIconComponent(tableColumnLight16);
