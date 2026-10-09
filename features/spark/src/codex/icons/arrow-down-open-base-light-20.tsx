import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const arrowDownOpenBaseLight20 = defineIconAsset({
  name: "arrow-down-open-base-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 2.668335, y: 2.668457, width: 14.663086, height: 14.663086 },
    visualBounds: { x: 2.668335, y: 2.668457, width: 14.663086, height: 14.663086 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.668335, y: 2.668457, width: 14.663086, height: 14.663086 },
    center: { x: 9.999878, y: 10 },
    insets: { top: 2.668457, right: 2.668579, bottom: 2.668457, left: 2.668335 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 9.999878, y: 10 },
      foreground: { x: 9.999878, y: 10 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M16.6664 10.1685C17.0337 10.1685 17.3314 10.4662 17.3314 10.8335V14.1997C17.3312 15.9291 15.929 17.3315 14.1996 17.3315H5.80017C4.07076 17.3315 2.6686 15.9291 2.66833 14.1997V10.8335C2.66833 10.4662 2.9661 10.1685 3.33337 10.1685C3.70064 10.1685 3.99841 10.4662 3.99841 10.8335V14.1997C3.99868 15.1945 4.8053 16.0015 5.80017 16.0015H14.1996C15.1945 16.0015 16.0011 15.1945 16.0013 14.1997V10.8335C16.0013 10.4663 16.2993 10.1686 16.6664 10.1685Z" fill="currentColor"/> <path d="M10.0004 2.66846C10.3675 2.66864 10.6654 2.96634 10.6654 3.3335V10.27L13.0717 7.86377C13.3314 7.60407 13.7524 7.60407 14.0121 7.86377C14.2715 8.12349 14.2717 8.5446 14.0121 8.8042L10.765 12.0513L10.683 12.1255C10.2866 12.4487 9.71424 12.4485 9.31775 12.1255L9.23474 12.0513L5.98767 8.8042C5.72829 8.54464 5.72849 8.12345 5.98767 7.86377C6.24737 7.60407 6.66938 7.60407 6.92908 7.86377L9.33533 10.271V3.3335C9.33533 2.96623 9.6331 2.66846 10.0004 2.66846Z" fill="currentColor"/>`,
});

export const ArrowDownOpenBaseLight20Icon = createIconComponent(arrowDownOpenBaseLight20);
