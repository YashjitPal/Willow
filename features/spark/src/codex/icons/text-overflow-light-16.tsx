import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const textOverflowLight16 = defineIconAsset({
  name: "text-overflow-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 2.141357, y: 2.141113, width: 11.613525, height: 11.716797 },
    visualBounds: { x: 2.141357, y: 2.141113, width: 11.613525, height: 11.716797 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.141357, y: 2.141113, width: 11.613525, height: 11.716797 },
    center: { x: 7.94812, y: 7.999512 },
    insets: { top: 2.141113, right: 2.245118, bottom: 2.14209, left: 2.141357 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 7.94812, y: 7.999512 },
      foreground: { x: 7.94812, y: 7.999512 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M7.99976 10.1411C8.28971 10.1411 8.52515 10.3766 8.52515 10.6665V13.3335C8.52497 13.6233 8.2896 13.8579 7.99976 13.8579C7.71003 13.8578 7.47454 13.6232 7.47437 13.3335V10.6665C7.47437 10.3766 7.70992 10.1412 7.99976 10.1411Z" fill="currentColor"/> <path d="M10.9626 5.62939C11.1677 5.42437 11.4998 5.42437 11.7048 5.62939L13.5281 7.45264C13.8303 7.75532 13.8306 8.24583 13.5281 8.54834L11.7048 10.3716C11.4999 10.5764 11.1677 10.5762 10.9626 10.3716C10.7576 10.1666 10.7576 9.83442 10.9626 9.62939L12.0662 8.52588H2.66675C2.37696 8.52588 2.14162 8.29021 2.14136 8.00049C2.14136 7.71054 2.3768 7.4751 2.66675 7.4751H12.0662L10.9626 6.37158C10.7576 6.16656 10.7576 5.83442 10.9626 5.62939Z" fill="currentColor"/> <path d="M7.99976 2.14111C8.28971 2.14111 8.52515 2.37655 8.52515 2.6665V5.3335C8.52497 5.6233 8.2896 5.85791 7.99976 5.85791C7.71003 5.85778 7.47454 5.62321 7.47437 5.3335V2.6665C7.47437 2.37664 7.70992 2.14125 7.99976 2.14111Z" fill="currentColor"/>`,
});

export const TextOverflowLight16Icon = createIconComponent(textOverflowLight16);
