import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const photoLight24 = defineIconAsset({
  name: "photo-light-24",
  canvas: {
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    frame: { x: 0, y: 0, width: 24, height: 24 },
    inkBounds: { x: 2.25, y: 3.25, width: 19.5, height: 17.5 },
    visualBounds: { x: 2.25, y: 3.25, width: 19.5, height: 17.5 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.25, y: 3.25, width: 19.5, height: 17.5 },
    center: { x: 12, y: 12 },
    insets: { top: 3.25, right: 2.25, bottom: 3.25, left: 2.25 },
    anchors: {
      frame: { x: 12, y: 12 },
      ink: { x: 12, y: 12 },
      foreground: { x: 12, y: 12 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M15.0625 6.65039C16.7469 6.65039 18.1122 8.01582 18.1123 9.7002C18.112 11.3844 16.7468 12.75 15.0625 12.75C13.3783 12.7498 12.013 11.3843 12.0127 9.7002C12.0128 8.01592 13.3782 6.65056 15.0625 6.65039ZM15.0625 8.15039C14.2067 8.15056 13.5128 8.84435 13.5127 9.7002C13.513 10.5559 14.2068 11.2498 15.0625 11.25C15.9184 11.25 16.612 10.556 16.6123 9.7002C16.6122 8.84424 15.9185 8.15039 15.0625 8.15039Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M18.2002 3.25C20.1607 3.25011 21.7499 4.83935 21.75 6.7998V17.2002C21.7499 19.1607 20.1607 20.7499 18.2002 20.75H5.7998C3.83935 20.7499 2.25011 19.1607 2.25 17.2002V6.7998C2.25011 4.83935 3.83935 3.25011 5.7998 3.25H18.2002ZM5.7998 4.75C4.66778 4.75011 3.75011 5.66778 3.75 6.7998V14.1553L5.11328 12.792C6.3825 11.523 8.44082 11.5229 9.70996 12.792L16.168 19.25H18.2002C19.3322 19.2499 20.2499 18.3322 20.25 17.2002V6.7998C20.2499 5.66778 19.3322 4.75011 18.2002 4.75H5.7998ZM8.64941 13.8525C7.96606 13.1692 6.85726 13.1693 6.17383 13.8525L3.81445 16.2119L3.75 16.1475V17.2002C3.75011 18.3322 4.66778 19.2499 5.7998 19.25H14.0459L8.64941 13.8525Z" fill="currentColor"/>`,
});

export const PhotoLight24Icon = createIconComponent(photoLight24);
