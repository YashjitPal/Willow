import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const xmarkCircleFillRegular16 = defineIconAsset({
  name: "xmark-circle-fill-regular-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 1.25, y: 1.25, width: 13.5, height: 13.5 },
    visualBounds: { x: 1.25, y: 1.25, width: 13.5, height: 13.5 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "circular",
    bounds: { x: 1.25, y: 1.25, width: 13.5, height: 13.5 },
    center: { x: 8, y: 8 },
    insets: { top: 1.25, right: 1.25, bottom: 1.25, left: 1.25 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8, y: 8 },
      foreground: { x: 8, y: 8 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M8 1.25C11.7279 1.25 14.75 4.27208 14.75 8C14.75 11.7279 11.7279 14.75 8 14.75C4.27208 14.75 1.25 11.7279 1.25 8C1.25 4.27208 4.27208 1.25 8 1.25ZM10.5332 5.46582C10.2403 5.17333 9.76544 5.17317 9.47266 5.46582L8 6.93848L6.52734 5.46582C6.23456 5.17317 5.75968 5.17333 5.4668 5.46582C5.1739 5.75871 5.1739 6.23445 5.4668 6.52734L6.93848 7.99902L5.46582 9.47363C5.17319 9.76655 5.17302 10.2414 5.46582 10.5342C5.75864 10.8269 6.23349 10.8268 6.52637 10.5342L8 9.06055L9.47363 10.5342C9.76651 10.8268 10.2414 10.8269 10.5342 10.5342C10.827 10.2414 10.8268 9.76655 10.5342 9.47363L9.06055 7.99902L10.5332 6.52734C10.8261 6.23445 10.8261 5.75871 10.5332 5.46582Z" fill="currentColor"/>`,
});

export const XmarkCircleFillRegular16Icon = createIconComponent(xmarkCircleFillRegular16);
