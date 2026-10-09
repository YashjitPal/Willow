import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const infoCircleLight20 = defineIconAsset({
  name: "info-circle-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 1.841797, y: 1.841797, width: 16.316406, height: 16.316406 },
    visualBounds: { x: 1.841797, y: 1.841797, width: 16.316406, height: 16.316406 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "circular",
    bounds: { x: 1.841797, y: 1.841797, width: 16.316406, height: 16.316406 },
    center: { x: 10, y: 10 },
    insets: { top: 1.841797, right: 1.841797, bottom: 1.841797, left: 1.841797 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10, y: 10 },
      foreground: { x: 10, y: 10 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M10 9.3418C10.3638 9.3418 10.6582 9.63623 10.6582 10V13.333C10.6582 13.6968 10.3638 13.9922 10 13.9922C9.63623 13.9922 9.3418 13.6968 9.3418 13.333V10C9.3418 9.63623 9.63623 9.3418 10 9.3418Z" fill="currentColor"/> <path d="M10.0869 6.14648C10.5121 6.18991 10.8444 6.54881 10.8447 6.98535C10.8447 7.4514 10.466 7.82995 10 7.83008C9.56327 7.82988 9.20446 7.4976 9.16113 7.07227L9.15625 6.98535L9.16113 6.89941C9.2045 6.47411 9.5633 6.1418 10 6.1416L10.0869 6.14648Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M10 1.8418C14.5059 1.8418 18.1582 5.49409 18.1582 10C18.1582 14.5059 14.5059 18.1582 10 18.1582C5.49409 18.1582 1.8418 14.5059 1.8418 10C1.8418 5.49409 5.49409 1.8418 10 1.8418ZM10 3.1582C6.22164 3.1582 3.1582 6.22164 3.1582 10C3.1582 13.7784 6.22164 16.8418 10 16.8418C13.7784 16.8418 16.8418 13.7784 16.8418 10C16.8418 6.22164 13.7784 3.1582 10 3.1582Z" fill="currentColor"/>`,
});

export const InfoCircleLight20Icon = createIconComponent(infoCircleLight20);
