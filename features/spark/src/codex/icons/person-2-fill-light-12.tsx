import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const person2FillLight12 = defineIconAsset({
  name: "person-2-fill-light-12",
  canvas: {
    width: 12,
    height: 12,
    viewBox: "0 0 12 12",
    frame: { x: 0, y: 0, width: 12, height: 12 },
    inkBounds: { x: 0.263916, y: 1.289063, width: 11.594482, height: 9.070313 },
    visualBounds: { x: 0.263916, y: 1.289063, width: 11.594482, height: 9.070313 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 0.263916, y: 1.289063, width: 11.594482, height: 9.070313 },
    center: { x: 6.061157, y: 5.82422 },
    insets: { top: 1.289063, right: 0.141602, bottom: 1.640624, left: 0.263916 },
    anchors: {
      frame: { x: 6, y: 6 },
      ink: { x: 6.061157, y: 5.82422 },
      foreground: { x: 6.061157, y: 5.82422 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M4.02552 6.36523C5.90815 6.36541 7.47086 7.73284 7.77649 9.52832C7.85542 9.99236 7.48147 10.3591 7.06556 10.3594H0.985478C0.569397 10.3593 0.195549 9.99252 0.27454 9.52832L0.306767 9.36133C0.678066 7.64867 2.20155 6.36523 4.02552 6.36523Z" fill="currentColor"/> <path d="M8.61634 6.37695C10.2248 6.37709 11.5621 7.53355 11.8458 9.05957C11.9331 9.53062 11.5517 9.89613 11.1388 9.89648H8.72181C8.74905 9.71972 8.7458 9.56462 8.73255 9.44434C8.71758 9.30884 8.68574 9.17225 8.67786 9.13672C8.46419 8.17242 7.95791 7.31817 7.25794 6.6709C7.67198 6.48259 8.13182 6.37698 8.61634 6.37695Z" fill="currentColor"/> <path d="M4.02552 1.28906C5.23735 1.28928 6.21985 2.27249 6.21985 3.48438C6.2197 4.69613 5.23725 5.67849 4.02552 5.67871C2.81359 5.67871 1.83036 4.69626 1.8302 3.48438C1.8302 2.27235 2.8135 1.28906 4.02552 1.28906Z" fill="currentColor"/> <path d="M9.01673 1.73145C10.0702 1.7319 10.9249 2.58701 10.9249 3.64062C10.9244 4.69379 10.0699 5.54838 9.01673 5.54883C7.96316 5.54883 7.10807 4.69407 7.10755 3.64062C7.10755 2.58674 7.96284 1.73145 9.01673 1.73145Z" fill="currentColor"/>`,
});

export const Person2FillLight12Icon = createIconComponent(person2FillLight12);
