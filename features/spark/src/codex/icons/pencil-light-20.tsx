import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const pencilLight20 = defineIconAsset({
  name: "pencil-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 2.249023, y: 2.246582, width: 15.501953, height: 15.505859 },
    visualBounds: { x: 2.249023, y: 2.246582, width: 15.501953, height: 15.505859 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.249023, y: 2.246582, width: 15.501953, height: 15.505859 },
    center: { x: 10, y: 9.999512 },
    insets: { top: 2.246582, right: 2.249024, bottom: 2.247559, left: 2.249023 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10, y: 9.999512 },
      foreground: { x: 10, y: 9.999512 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M11.6258 3.30375C13.0516 1.88123 15.3202 1.91012 16.6805 3.29496C18.0834 4.64996 18.1292 6.92825 16.6893 8.36821L9.68929 15.3682L9.68832 15.3672C8.9762 16.1131 8.0665 16.6184 7.11605 16.8389L7.11507 16.8399L3.24789 17.7276L3.24691 17.7256C3.08016 17.7653 2.74207 17.799 2.4725 17.5303C2.20162 17.2601 2.23613 16.9199 2.27621 16.753H2.27425L3.1639 12.8956C3.38813 11.8986 3.89924 11.028 4.6014 10.3272L11.6258 3.30375ZM5.54183 11.2686C5.00143 11.8078 4.62462 12.4592 4.46078 13.1905L4.4598 13.1944L3.7557 16.2461L6.81722 15.543C7.52306 15.3789 8.20539 15.0001 8.73617 14.4405L14.3944 8.78129L11.2118 5.5977L5.54183 11.2686ZM15.742 4.23637C14.9045 3.37296 13.4757 3.3368 12.5653 4.24516L12.1522 4.65727L15.3348 7.84086L15.7489 7.42778C16.6655 6.51112 16.6228 5.08792 15.7577 4.252L15.742 4.23637Z" fill="currentColor"/>`,
});

export const PencilLight20Icon = createIconComponent(pencilLight20);
