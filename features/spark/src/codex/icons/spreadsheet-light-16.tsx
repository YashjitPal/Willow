import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const spreadsheetLight16 = defineIconAsset({
  name: "spreadsheet-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 1.474609, y: 2.140625, width: 13.050781, height: 11.716797 },
    visualBounds: { x: 1.474609, y: 2.140625, width: 13.050781, height: 11.716797 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.474609, y: 2.140625, width: 13.050781, height: 11.716797 },
    center: { x: 8, y: 7.999024 },
    insets: { top: 2.140625, right: 1.47461, bottom: 2.142578, left: 1.474609 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8, y: 7.999024 },
      foreground: { x: 8, y: 7.999024 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M11.8662 2.14111C13.3344 2.14111 14.5254 3.33214 14.5254 4.80029V11.1997C14.5254 12.6679 13.3344 13.8579 11.8662 13.8579H4.13379C2.66563 13.8579 1.47461 12.6679 1.47461 11.1997V4.80029C1.47461 3.33214 2.66563 2.14111 4.13379 2.14111H11.8662ZM2.52539 7.19287V11.1997C2.52539 12.088 3.24553 12.8081 4.13379 12.8081H5.47461V7.19287H2.52539ZM6.52539 7.19287V12.8081H11.8662C12.7545 12.8081 13.4746 12.088 13.4746 11.1997V7.19287H6.52539ZM4.13379 3.19189C3.24553 3.19189 2.52539 3.91203 2.52539 4.80029V6.14209H5.47461V3.19189H4.13379ZM6.52539 6.14209H13.4746V4.80029C13.4746 3.91204 12.7545 3.19189 11.8662 3.19189H6.52539V6.14209Z" fill="currentColor"/>`,
});

export const SpreadsheetLight16Icon = createIconComponent(spreadsheetLight16);
