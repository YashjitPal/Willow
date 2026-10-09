import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const tableLight20 = defineIconAsset({
  name: "table-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 1.834961, y: 3.084961, width: 16.330078, height: 13.830078 },
    visualBounds: { x: 1.834961, y: 3.084961, width: 16.330078, height: 13.830078 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.834961, y: 3.084961, width: 16.330078, height: 13.830078 },
    center: { x: 10, y: 10 },
    insets: { top: 3.084961, right: 1.834961, bottom: 3.084961, left: 1.834961 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10, y: 10 },
      foreground: { x: 10, y: 10 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M15.167 3.08496C16.8227 3.08514 18.1649 4.42733 18.165 6.08301V13.917C18.1649 15.5727 16.8227 16.9149 15.167 16.915H4.83301C3.17733 16.9149 1.83514 15.5727 1.83496 13.917V6.08301C1.83514 4.42733 3.17733 3.08514 4.83301 3.08496H15.167ZM10.665 15.585H15.167C16.0881 15.5848 16.8348 14.8381 16.835 13.917V8.99805H10.665V15.585ZM3.16504 13.917C3.16522 14.8381 3.91187 15.5848 4.83301 15.585H9.33496V8.99805H3.16504V13.917ZM4.83301 4.41504C3.91187 4.41521 3.16521 5.16187 3.16504 6.08301V7.66797H16.835V6.08301C16.8348 5.16187 16.0881 4.41522 15.167 4.41504H4.83301Z" fill="currentColor"/>`,
});

export const TableLight20Icon = createIconComponent(tableLight20);
