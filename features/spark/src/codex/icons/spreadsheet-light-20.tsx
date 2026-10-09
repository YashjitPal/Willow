import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const spreadsheetLight20 = defineIconAsset({
  name: "spreadsheet-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 1.834961, y: 2.667969, width: 16.330078, height: 14.663086 },
    visualBounds: { x: 1.834961, y: 2.667969, width: 16.330078, height: 14.663086 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.834961, y: 2.667969, width: 16.330078, height: 14.663086 },
    center: { x: 10, y: 9.999512 },
    insets: { top: 2.667969, right: 1.834961, bottom: 2.668945, left: 1.834961 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10, y: 9.999512 },
      foreground: { x: 10, y: 9.999512 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M15.0332 2.66846C16.7628 2.66846 18.165 4.07072 18.165 5.80029V14.1997C18.165 15.9293 16.7628 17.3315 15.0332 17.3315H4.9668C3.23723 17.3315 1.83496 15.9293 1.83496 14.1997V5.80029C1.83496 4.07072 3.23723 2.66846 4.9668 2.66846H15.0332ZM3.16504 8.99854V14.1997C3.16504 15.1947 3.97176 16.0015 4.9668 16.0015H6.83496V8.99854H3.16504ZM8.16504 8.99854V16.0015H15.0332C16.0282 16.0015 16.835 15.1947 16.835 14.1997V8.99854H8.16504ZM4.9668 3.99854C3.97176 3.99854 3.16504 4.80526 3.16504 5.80029V7.66846H6.83496V3.99854H4.9668ZM8.16504 7.66846H16.835V5.80029C16.835 4.80526 16.0282 3.99854 15.0332 3.99854H8.16504V7.66846Z" fill="currentColor"/>`,
});

export const SpreadsheetLight20Icon = createIconComponent(spreadsheetLight20);
