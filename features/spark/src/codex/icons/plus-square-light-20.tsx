import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const plusSquareLight20 = defineIconAsset({
  name: "plus-square-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 2.501587, y: 2.501709, width: 14.99707, height: 14.99707 },
    visualBounds: { x: 2.501587, y: 2.501709, width: 14.99707, height: 14.99707 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.501587, y: 2.501709, width: 14.99707, height: 14.99707 },
    center: { x: 10.000122, y: 10.000244 },
    insets: { top: 2.501709, right: 2.501343, bottom: 2.501221, left: 2.501587 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10.000122, y: 10.000244 },
      foreground: { x: 10.000122, y: 10.000244 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M9.99963 5.9187C10.3669 5.9187 10.6647 6.21647 10.6647 6.58374V9.33472H13.4166C13.7836 9.33491 14.0815 9.63272 14.0817 9.99976C14.0817 10.3669 13.7837 10.6646 13.4166 10.6648H10.6647V13.4167C10.6645 13.7839 10.3668 14.0818 9.99963 14.0818C9.63261 14.0816 9.33473 13.7838 9.33459 13.4167V10.6648H6.58362C6.21635 10.6648 5.91858 10.367 5.91858 9.99976C5.91871 9.6326 6.21643 9.33472 6.58362 9.33472H9.33459V6.58374C9.33459 6.21659 9.63253 5.9189 9.99963 5.9187Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M14.442 2.50171C16.13 2.50192 17.4986 3.87036 17.4987 5.55835V14.4421C17.4984 16.13 16.1299 17.4986 14.442 17.4988H5.55823C3.87024 17.4987 2.5018 16.1301 2.50159 14.4421V5.55835C2.50162 3.87025 3.87013 2.50174 5.55823 2.50171H14.442ZM5.55823 3.83179C4.60467 3.83182 3.8317 4.60479 3.83167 5.55835V14.4421C3.83188 15.3955 4.60478 16.1687 5.55823 16.1687H14.442C15.3953 16.1685 16.1684 15.3954 16.1686 14.4421V5.55835C16.1685 4.6049 15.3954 3.832 14.442 3.83179H5.55823Z" fill="currentColor"/>`,
});

export const PlusSquareLight20Icon = createIconComponent(plusSquareLight20);
