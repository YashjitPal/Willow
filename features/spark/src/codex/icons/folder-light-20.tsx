import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const folderLight20 = defineIconAsset({
  name: "folder-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 2.042969, y: 2.668213, width: 15.913086, height: 14.663086 },
    visualBounds: { x: 2.042969, y: 2.668213, width: 15.913086, height: 14.663086 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.042969, y: 2.668213, width: 15.913086, height: 14.663086 },
    center: { x: 9.999512, y: 9.999756 },
    insets: { top: 2.668213, right: 2.043945, bottom: 2.668701, left: 2.042969 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 9.999512, y: 9.999756 },
      foreground: { x: 9.999512, y: 9.999756 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M6.94946 2.66821C7.58311 2.66821 8.20067 2.86877 8.71313 3.24146L9.77759 4.01587C10.0627 4.22319 10.4065 4.33521 10.759 4.33521H14.9583C16.6142 4.33521 17.9563 5.67732 17.9563 7.33325V14.3333C17.9563 15.9892 16.6142 17.3313 14.9583 17.3313H5.04126C3.38547 17.3311 2.04321 15.9891 2.04321 14.3333V5.66626C2.04339 4.01058 3.38558 2.66839 5.04126 2.66821H6.94946ZM3.37329 9.83228V14.3333C3.37329 15.2545 4.12001 16.001 5.04126 16.0012H14.9583C15.8796 16.0012 16.6262 15.2546 16.6262 14.3333V9.83228H3.37329ZM5.04126 3.99829C4.12012 3.99847 3.37347 4.74512 3.37329 5.66626V8.5022H16.6262V7.33325C16.6262 6.41186 15.8796 5.66528 14.9583 5.66528H10.759C10.1254 5.66528 9.50784 5.46377 8.99536 5.09106L7.93091 4.31763C7.64576 4.11024 7.30205 3.99829 6.94946 3.99829H5.04126Z" fill="currentColor"/>`,
});

export const FolderLight20Icon = createIconComponent(folderLight20);
