import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const folderLight16 = defineIconAsset({
  name: "folder-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 1.641602, y: 2.141357, width: 12.716797, height: 11.716797 },
    visualBounds: { x: 1.641602, y: 2.141357, width: 12.716797, height: 11.716797 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.641602, y: 2.141357, width: 12.716797, height: 11.716797 },
    center: { x: 8.000001, y: 7.999756 },
    insets: { top: 2.141357, right: 1.641601, bottom: 2.141846, left: 1.641602 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8.000001, y: 7.999756 },
      foreground: { x: 8.000001, y: 7.999756 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M5.55933 2.14136C6.06479 2.14136 6.55777 2.30207 6.96655 2.59937L7.81812 3.21851C8.04741 3.38523 8.32368 3.47534 8.60718 3.47534H11.9666C13.2874 3.47534 14.3582 4.54606 14.3582 5.86694V11.4666C14.3582 12.7874 13.2874 13.8582 11.9666 13.8582H4.03296C2.71229 13.8579 1.64136 12.7873 1.64136 11.4666V4.53296C1.6416 3.21244 2.71244 2.1416 4.03296 2.14136H5.55933ZM2.69214 7.85913V11.4666C2.69214 12.2074 3.29219 12.8081 4.03296 12.8083H11.9666C12.7075 12.8083 13.3083 12.2075 13.3083 11.4666V7.85913H2.69214ZM4.03296 3.19214C3.29234 3.19238 2.69239 3.79234 2.69214 4.53296V6.80835H13.3083V5.86694C13.3083 5.12596 12.7075 4.52515 11.9666 4.52515H8.60718C8.10172 4.52515 7.60874 4.36541 7.19995 4.06812L6.34839 3.448C6.11917 3.28145 5.84268 3.19214 5.55933 3.19214H4.03296Z" fill="currentColor"/>`,
});

export const FolderLight16Icon = createIconComponent(folderLight16);
