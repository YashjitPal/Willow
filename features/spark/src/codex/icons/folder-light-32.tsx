import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const folderLight32 = defineIconAsset({
  name: "folder-light-32",
  canvas: {
    width: 32,
    height: 32,
    viewBox: "0 0 32 32",
    frame: { x: 0, y: 0, width: 32, height: 32 },
    inkBounds: { x: 3.432617, y: 4.432861, width: 25.133789, height: 23.133789 },
    visualBounds: { x: 3.432617, y: 4.432861, width: 25.133789, height: 23.133789 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 3.432617, y: 4.432861, width: 25.133789, height: 23.133789 },
    center: { x: 15.999512, y: 15.999756 },
    insets: { top: 4.432861, right: 3.433594, bottom: 4.43335, left: 3.432617 },
    anchors: {
      frame: { x: 16, y: 16 },
      ink: { x: 15.999512, y: 15.999756 },
      foreground: { x: 15.999512, y: 15.999756 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M11.0977 4.43286C12.0908 4.43293 13.0581 4.74821 13.8613 5.33228L15.5293 6.54517C16.025 6.90565 16.6225 7.09985 17.2354 7.09985H23.8662C26.4619 7.09985 28.5664 9.20431 28.5664 11.8V22.8665C28.5664 25.4622 26.4619 27.5667 23.8662 27.5667H8.13281C5.53717 27.5665 3.43262 25.4621 3.43262 22.8665V9.13306C3.43272 6.53748 5.53723 4.43297 8.13281 4.43286H11.0977ZM5.2334 15.5676V22.8665C5.2334 24.468 6.53128 25.7667 8.13281 25.7668H23.8662C25.4678 25.7668 26.7666 24.4681 26.7666 22.8665V15.5676H5.2334ZM8.13281 6.23364C6.53134 6.23375 5.23351 7.53159 5.2334 9.13306V13.7668H26.7666V11.8C26.7666 10.1984 25.4678 8.89966 23.8662 8.89966H17.2354C16.242 8.89965 15.274 8.58545 14.4707 8.00122L12.8027 6.78833C12.3072 6.42791 11.7104 6.23372 11.0977 6.23364H8.13281Z" fill="currentColor"/>`,
});

export const FolderLight32Icon = createIconComponent(folderLight32);
