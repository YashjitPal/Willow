import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const folderLight24 = defineIconAsset({
  name: "folder-light-24",
  canvas: {
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    frame: { x: 0, y: 0, width: 24, height: 24 },
    inkBounds: { x: 2.5, y: 3.25, width: 19, height: 17.5 },
    visualBounds: { x: 2.5, y: 3.25, width: 19, height: 17.5 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.5, y: 3.25, width: 19, height: 17.5 },
    center: { x: 12, y: 12 },
    insets: { top: 3.25, right: 2.5, bottom: 3.25, left: 2.5 },
    anchors: {
      frame: { x: 12, y: 12 },
      ink: { x: 12, y: 12 },
      foreground: { x: 12, y: 12 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M8.33984 3.25C9.08998 3.25008 9.82106 3.4875 10.4277 3.92871L11.7051 4.85742C12.0554 5.11218 12.477 5.24992 12.9102 5.25H17.9502C19.9107 5.25011 21.4999 6.83935 21.5 8.7998V17.2002C21.4999 19.1607 19.9107 20.7499 17.9502 20.75H6.0498C4.08935 20.7499 2.50011 19.1607 2.5 17.2002V6.7998C2.50011 4.83935 4.08935 3.25011 6.0498 3.25H8.33984ZM4 11.75V17.2002C4.00011 18.3322 4.91778 19.2499 6.0498 19.25H17.9502C19.0822 19.2499 19.9999 18.3322 20 17.2002V11.75H4ZM6.0498 4.75C4.91778 4.75011 4.00011 5.66778 4 6.7998V10.25H20V8.7998C19.9999 7.66778 19.0822 6.75011 17.9502 6.75H12.9102C12.16 6.74992 11.4289 6.5125 10.8223 6.07129L9.54492 5.14258C9.19463 4.88782 8.77297 4.75008 8.33984 4.75H6.0498Z" fill="currentColor"/>`,
});

export const FolderLight24Icon = createIconComponent(folderLight24);
