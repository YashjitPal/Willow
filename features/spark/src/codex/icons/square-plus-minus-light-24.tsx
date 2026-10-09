import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const squarePlusMinusLight24 = defineIconAsset({
  name: "square-plus-minus-light-24",
  canvas: {
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    frame: { x: 0, y: 0, width: 24, height: 24 },
    inkBounds: { x: 3.25, y: 3.25, width: 17.5, height: 17.5 },
    visualBounds: { x: 3.25, y: 3.25, width: 17.5, height: 17.5 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 3.25, y: 3.25, width: 17.5, height: 17.5 },
    center: { x: 12, y: 12 },
    insets: { top: 3.25, right: 3.25, bottom: 3.25, left: 3.25 },
    anchors: {
      frame: { x: 12, y: 12 },
      ink: { x: 12, y: 12 },
      foreground: { x: 12, y: 12 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M14.5 15.25C14.9142 15.25 15.25 15.5858 15.25 16C15.25 16.4142 14.9142 16.75 14.5 16.75H9.5C9.08579 16.75 8.75 16.4142 8.75 16C8.75 15.5858 9.08579 15.25 9.5 15.25H14.5Z" fill="currentColor"/> <path d="M12 6.75C12.4142 6.75 12.75 7.08579 12.75 7.5V9.25H14.5C14.9142 9.25 15.25 9.58579 15.25 10C15.25 10.4142 14.9142 10.75 14.5 10.75H12.75V12.5C12.75 12.9142 12.4142 13.25 12 13.25C11.5858 13.25 11.25 12.9142 11.25 12.5V10.75H9.5C9.08579 10.75 8.75 10.4142 8.75 10C8.75 9.58579 9.08579 9.25 9.5 9.25H11.25V7.5C11.25 7.08579 11.5858 6.75 12 6.75Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M17.2002 3.25C19.1607 3.25011 20.7499 4.83935 20.75 6.7998V17.2002C20.7499 19.1607 19.1607 20.7499 17.2002 20.75H6.7998C4.83935 20.7499 3.25011 19.1607 3.25 17.2002V6.7998C3.25011 4.83935 4.83935 3.25011 6.7998 3.25H17.2002ZM6.7998 4.75C5.66778 4.75011 4.75011 5.66778 4.75 6.7998V17.2002C4.75011 18.3322 5.66778 19.2499 6.7998 19.25H17.2002C18.3322 19.2499 19.2499 18.3322 19.25 17.2002V6.7998C19.2499 5.66778 18.3322 4.75011 17.2002 4.75H6.7998Z" fill="currentColor"/>`,
});

export const SquarePlusMinusLight24Icon = createIconComponent(squarePlusMinusLight24);
