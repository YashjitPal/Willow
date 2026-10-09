import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const trashLight24 = defineIconAsset({
  name: "trash-light-24",
  canvas: {
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    frame: { x: 0, y: 0, width: 24, height: 24 },
    inkBounds: { x: 2.75, y: 2, width: 18.5, height: 19.780273 },
    visualBounds: { x: 2.75, y: 2, width: 18.5, height: 19.780273 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.75, y: 2, width: 18.5, height: 19.780273 },
    center: { x: 12, y: 11.890137 },
    insets: { top: 2, right: 2.75, bottom: 2.219727, left: 2.75 },
    anchors: {
      frame: { x: 12, y: 12 },
      ink: { x: 12, y: 11.890137 },
      foreground: { x: 12, y: 11.890137 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M10 10.25C10.4142 10.25 10.75 10.5858 10.75 11V16.0195C10.7498 16.4336 10.4141 16.7695 10 16.7695C9.58592 16.7695 9.25022 16.4336 9.25 16.0195V11C9.25 10.5858 9.58579 10.25 10 10.25Z" fill="currentColor"/> <path d="M14 10.25C14.4142 10.25 14.75 10.5858 14.75 11V16.0195C14.7498 16.4336 14.4141 16.7695 14 16.7695C13.5859 16.7695 13.2502 16.4336 13.25 16.0195V11C13.25 10.5858 13.5858 10.25 14 10.25Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C14.4545 2 16.4738 3.86169 16.7236 6.25H20.5C20.9142 6.25 21.25 6.58579 21.25 7C21.25 7.41421 20.9142 7.75 20.5 7.75H19.7207L19.0742 18.2607C18.9524 20.2385 17.3126 21.7802 15.3311 21.7803H8.70312C6.72627 21.7801 5.08866 20.2452 4.96094 18.2725L4.28125 7.75H3.5C3.08579 7.75 2.75 7.41421 2.75 7C2.75 6.58579 3.08579 6.25 3.5 6.25H7.27637C7.52623 3.86169 9.54553 2 12 2ZM6.45801 18.1758C6.53476 19.3593 7.51716 20.2801 8.70312 20.2803H15.3311C16.52 20.2802 17.5041 19.3547 17.5771 18.168L18.2178 7.75H5.7832L6.45801 18.1758ZM12 3.5C10.3751 3.5 9.02858 4.69244 8.78809 6.25H15.2119C14.9714 4.69244 13.6249 3.5 12 3.5Z" fill="currentColor"/>`,
});

export const TrashLight24Icon = createIconComponent(trashLight24);
