import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const tableColumnLight20 = defineIconAsset({
  name: "table-column-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 1.834961, y: 2.668457, width: 16.330078, height: 13.830078 },
    visualBounds: { x: 1.834961, y: 2.668457, width: 16.330078, height: 13.830078 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.834961, y: 2.668457, width: 16.330078, height: 13.830078 },
    center: { x: 10, y: 9.583496 },
    insets: { top: 2.668457, right: 1.834961, bottom: 3.501465, left: 1.834961 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10, y: 9.583496 },
      foreground: { x: 10, y: 9.583496 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M15.167 2.66846C16.8227 2.66863 18.1649 4.01083 18.165 5.6665V13.5005C18.1649 15.1562 16.8227 16.4984 15.167 16.4985H4.83301C3.17733 16.4984 1.83514 15.1562 1.83496 13.5005V5.6665C1.83514 4.01083 3.17733 2.66863 4.83301 2.66846H15.167ZM10.665 15.1685H15.167C16.0881 15.1683 16.8348 14.4216 16.835 13.5005V5.6665C16.8348 4.74537 16.0881 3.99871 15.167 3.99854H10.665V15.1685ZM4.83301 3.99854C3.91187 3.99871 3.16521 4.74537 3.16504 5.6665V13.5005C3.16522 14.4216 3.91187 15.1683 4.83301 15.1685H9.33496V3.99854H4.83301Z" fill="currentColor"/>`,
});

export const TableColumnLight20Icon = createIconComponent(tableColumnLight20);
