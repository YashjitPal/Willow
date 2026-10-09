import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const exclamationMarkCircleLight28 = defineIconAsset({
  name: "exclamation-mark-circle-light-28",
  canvas: {
    width: 28,
    height: 28,
    viewBox: "0 0 28 28",
    frame: { x: 0, y: 0, width: 28, height: 28 },
    inkBounds: { x: 2.169922, y: 2.169922, width: 23.660156, height: 23.660156 },
    visualBounds: { x: 2.169922, y: 2.169922, width: 23.660156, height: 23.660156 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "circular",
    bounds: { x: 2.169922, y: 2.169922, width: 23.660156, height: 23.660156 },
    center: { x: 14, y: 14 },
    insets: { top: 2.169922, right: 2.169922, bottom: 2.169922, left: 2.169922 },
    anchors: {
      frame: { x: 14, y: 14 },
      ink: { x: 14, y: 14 },
      foreground: { x: 14, y: 14 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M14.1377 16.377C14.8139 16.4458 15.3418 17.0175 15.3418 17.7119C15.3416 18.4524 14.7414 19.0523 14.001 19.0527C13.3064 19.0527 12.7347 18.5251 12.666 17.8486L12.6592 17.7119L12.666 17.5742C12.7348 16.8979 13.3065 16.3701 14.001 16.3701L14.1377 16.377Z" fill="currentColor"/> <path d="M14 8.94727C14.4583 8.9474 14.8301 9.31903 14.8301 9.77734V13.5693C14.8299 14.0275 14.4582 14.3993 14 14.3994C13.5417 14.3994 13.1701 14.0276 13.1699 13.5693V9.77734C13.1699 9.31895 13.5416 8.94727 14 8.94727Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M14 2.16992C20.5335 2.16992 25.8301 7.46647 25.8301 14C25.8301 20.5335 20.5335 25.8301 14 25.8301C7.46647 25.8301 2.16992 20.5335 2.16992 14C2.16992 7.46647 7.46647 2.16992 14 2.16992ZM14 3.83008C8.38326 3.83008 3.83008 8.38326 3.83008 14C3.83008 19.6167 8.38326 24.1699 14 24.1699C19.6167 24.1699 24.1699 19.6167 24.1699 14C24.1699 8.38326 19.6167 3.83008 14 3.83008Z" fill="currentColor"/>`,
});

export const ExclamationMarkCircleLight28Icon = createIconComponent(exclamationMarkCircleLight28);
