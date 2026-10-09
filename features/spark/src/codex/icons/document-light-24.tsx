import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const documentLight24 = defineIconAsset({
  name: "document-light-24",
  canvas: {
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    frame: { x: 0, y: 0, width: 24, height: 24 },
    inkBounds: { x: 3.75, y: 2.75, width: 16.5, height: 18.5 },
    visualBounds: { x: 3.75, y: 2.75, width: 16.5, height: 18.5 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 3.75, y: 2.75, width: 16.5, height: 18.5 },
    center: { x: 12, y: 12 },
    insets: { top: 2.75, right: 3.75, bottom: 2.75, left: 3.75 },
    anchors: {
      frame: { x: 12, y: 12 },
      ink: { x: 12, y: 12 },
      foreground: { x: 12, y: 12 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M14.2578 2.75C15.2522 2.75012 16.206 3.14548 16.9092 3.84863L19.1514 6.09082C19.8545 6.79397 20.2499 7.74779 20.25 8.74219V17.5C20.25 19.5711 18.5711 21.25 16.5 21.25H7.5C5.42893 21.25 3.75 19.5711 3.75 17.5V6.5C3.75 4.42893 5.42893 2.75 7.5 2.75H14.2578ZM7.5 4.25C6.25736 4.25 5.25 5.25736 5.25 6.5V17.5C5.25 18.7426 6.25736 19.75 7.5 19.75H16.5C17.7426 19.75 18.75 18.7426 18.75 17.5V10.25H16C14.4812 10.25 13.25 9.01878 13.25 7.5V4.25H7.5ZM14.75 7.5C14.75 8.19036 15.3096 8.75 16 8.75H18.75V8.74219C18.7499 8.14561 18.5127 7.57322 18.0908 7.15137L15.8486 4.90918C15.5449 4.60544 15.1627 4.39936 14.75 4.30664V7.5Z" fill="currentColor"/>`,
});

export const DocumentLight24Icon = createIconComponent(documentLight24);
