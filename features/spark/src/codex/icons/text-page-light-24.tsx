import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const textPageLight24 = defineIconAsset({
  name: "text-page-light-24",
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
  body: `<path d="M13 13.25C13.4142 13.25 13.75 13.5858 13.75 14C13.75 14.4142 13.4142 14.75 13 14.75H9C8.58579 14.75 8.25 14.4142 8.25 14C8.25 13.5858 8.58579 13.25 9 13.25H13Z" fill="currentColor"/> <path d="M15 9.25C15.4142 9.25 15.75 9.58579 15.75 10C15.75 10.4142 15.4142 10.75 15 10.75H9C8.58579 10.75 8.25 10.4142 8.25 10C8.25 9.58579 8.58579 9.25 9 9.25H15Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M16.7002 2.75C18.6607 2.75011 20.2499 4.33935 20.25 6.2998V17.7002C20.2499 19.6607 18.6607 21.2499 16.7002 21.25H7.2998C5.33935 21.2499 3.75011 19.6607 3.75 17.7002V6.2998C3.75011 4.33935 5.33935 2.75011 7.2998 2.75H16.7002ZM7.2998 4.25C6.16778 4.25011 5.25011 5.16778 5.25 6.2998V17.7002C5.25011 18.8322 6.16778 19.7499 7.2998 19.75H16.7002C17.8322 19.7499 18.7499 18.8322 18.75 17.7002V6.2998C18.7499 5.16778 17.8322 4.25011 16.7002 4.25H7.2998Z" fill="currentColor"/>`,
});

export const TextPageLight24Icon = createIconComponent(textPageLight24);
