import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const bookLight16 = defineIconAsset({
  name: "book-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 2.741455, y: 1.474609, width: 10.387451, height: 13.052734 },
    visualBounds: { x: 2.741455, y: 1.474609, width: 10.387451, height: 13.052734 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.741455, y: 1.474609, width: 10.387451, height: 13.052734 },
    center: { x: 7.935181, y: 8.000976 },
    insets: { top: 1.474609, right: 2.871094, bottom: 1.472657, left: 2.741455 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 7.935181, y: 8.000976 },
      foreground: { x: 7.935181, y: 8.000976 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M11.9338 1.47461C12.5918 1.47479 13.1252 2.00896 13.1252 2.66699V11.3008C13.1368 11.4012 13.122 11.5072 13.0735 11.6074C12.9979 11.7636 12.7942 12.2363 12.7942 12.6689C12.7944 13.0701 12.9554 13.5014 13.0393 13.6943C13.2049 14.0758 12.9335 14.5273 12.4944 14.5273H4.60083C3.57441 14.5273 2.74172 13.6944 2.74146 12.668V4C2.74146 2.60556 3.87244 1.47474 5.26685 1.47461H11.9338ZM4.60083 11.8594C4.15414 11.8597 3.79235 12.2217 3.79224 12.668C3.7925 13.1143 4.15407 13.4765 4.60083 13.4766H11.8577C11.7949 13.2355 11.7445 12.9554 11.7444 12.6689C11.7444 12.3813 11.7972 12.0984 11.8645 11.8545L4.60083 11.8594ZM5.26685 2.52539C4.45234 2.52552 3.79224 3.18546 3.79224 4V10.9951C4.03662 10.8768 4.31023 10.8098 4.59985 10.8096L12.0754 10.8037V2.66699C12.0754 2.58886 12.0119 2.52557 11.9338 2.52539H5.26685Z" fill="currentColor"/>`,
});

export const BookLight16Icon = createIconComponent(bookLight16);
