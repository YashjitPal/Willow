import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const plusSquareLight16 = defineIconAsset({
  name: "plus-square-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 1.807983, y: 1.807861, width: 12.383789, height: 12.383789 },
    visualBounds: { x: 1.807983, y: 1.807861, width: 12.383789, height: 12.383789 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.807983, y: 1.807861, width: 12.383789, height: 12.383789 },
    center: { x: 7.999878, y: 7.999756 },
    insets: { top: 1.807861, right: 1.808228, bottom: 1.80835, left: 1.807983 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 7.999878, y: 7.999756 },
      foreground: { x: 7.999878, y: 7.999756 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M8.00037 4.64087C8.29007 4.64107 8.52562 4.87654 8.52576 5.16626V7.47485H10.8334C11.1232 7.47503 11.3578 7.7104 11.3578 8.00024C11.3577 8.28997 11.1231 8.52546 10.8334 8.52563H8.52576V10.8333C8.52558 11.1229 8.29004 11.3575 8.00037 11.3577C7.71053 11.3577 7.47515 11.1231 7.47498 10.8333V8.52563H5.16638C4.87668 8.52544 4.64112 8.28996 4.64099 8.00024C4.64099 7.71042 4.8766 7.47505 5.16638 7.47485H7.47498V5.16626C7.47511 4.87642 7.7105 4.64087 8.00037 4.64087Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M11.683 1.80786C13.0683 1.80786 14.1918 2.93134 14.1918 4.31665V11.6829C14.1918 13.0682 13.0683 14.1917 11.683 14.1917H4.31677C2.93146 14.1917 1.80798 13.0682 1.80798 11.6829V4.31665C1.80798 2.93134 2.93146 1.80786 4.31677 1.80786H11.683ZM4.31677 2.85864C3.51136 2.85864 2.85876 3.51124 2.85876 4.31665V11.6829C2.85876 12.4883 3.51136 13.1418 4.31677 13.1418H11.683C12.4884 13.1418 13.142 12.4883 13.142 11.6829V4.31665C13.142 3.51124 12.4884 2.85864 11.683 2.85864H4.31677Z" fill="currentColor"/>`,
});

export const PlusSquareLight16Icon = createIconComponent(plusSquareLight16);
