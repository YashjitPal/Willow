import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const arrowUpLineHorizontalLight16 = defineIconAsset({
  name: "arrow-up-line-horizontal-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 2.807861, y: 2.182129, width: 10.383789, height: 11.677246 },
    visualBounds: { x: 2.807861, y: 2.182129, width: 10.383789, height: 11.677246 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.807861, y: 2.182129, width: 10.383789, height: 11.677246 },
    center: { x: 7.999756, y: 8.020752 },
    insets: { top: 2.182129, right: 2.80835, bottom: 2.140625, left: 2.807861 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 7.999756, y: 8.020752 },
      foreground: { x: 7.999756, y: 8.020752 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M12.6663 12.8083C12.9562 12.8083 13.1917 13.0438 13.1917 13.3337C13.1916 13.6236 12.9561 13.8591 12.6663 13.8591H3.33325C3.04336 13.8591 2.80796 13.6236 2.80786 13.3337C2.80786 13.0438 3.0433 12.8083 3.33325 12.8083H12.6663Z" fill="currentColor"/> <path d="M7.27466 2.48218C7.64985 2.10704 8.24416 2.08374 8.64673 2.41187L8.72485 2.48218L11.7043 5.46167C11.9092 5.66657 11.909 5.9988 11.7043 6.20386C11.4993 6.40888 11.1672 6.40888 10.9622 6.20386L8.52563 3.76733V10.5007C8.52536 10.7903 8.28989 11.025 8.00024 11.0251C7.71046 11.0251 7.47512 10.7905 7.47485 10.5007V3.76538L5.03735 6.20386C4.83233 6.40888 4.50019 6.40888 4.29517 6.20386C4.09072 5.99879 4.09033 5.6665 4.29517 5.46167L7.27466 2.48218Z" fill="currentColor"/>`,
});

export const ArrowUpLineHorizontalLight16Icon = createIconComponent(arrowUpLineHorizontalLight16);
