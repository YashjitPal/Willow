import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const arrowUpLineHorizontalLight20 = defineIconAsset({
  name: "arrow-up-line-horizontal-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 3.501709, y: 2.54248, width: 12.99707, height: 14.789063 },
    visualBounds: { x: 3.501709, y: 2.54248, width: 12.99707, height: 14.789063 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 3.501709, y: 2.54248, width: 12.99707, height: 14.789063 },
    center: { x: 10.000244, y: 9.937012 },
    insets: { top: 2.54248, right: 3.501221, bottom: 2.668457, left: 3.501709 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10.000244, y: 9.937012 },
      foreground: { x: 10.000244, y: 9.937012 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M15.8337 16.0017C16.2008 16.0018 16.4987 16.2996 16.4988 16.6667C16.4988 17.0339 16.2009 17.3316 15.8337 17.3317H4.16675C3.79948 17.3317 3.50171 17.034 3.50171 16.6667C3.50175 16.2995 3.7995 16.0017 4.16675 16.0017H15.8337Z" fill="currentColor"/> <path d="M9.17651 2.8835C9.6315 2.42892 10.3691 2.42869 10.824 2.8835L14.6375 6.696C14.897 6.95552 14.8966 7.37669 14.6375 7.63643C14.3778 7.89613 13.9567 7.89613 13.697 7.63643L10.6648 4.6042V12.9997C10.6648 13.367 10.367 13.6648 9.99976 13.6648C9.63263 13.6646 9.33472 13.3669 9.33472 12.9997V4.60518L6.30444 7.63643C6.04474 7.89613 5.62274 7.89613 5.36304 7.63643C5.10374 7.37676 5.10362 6.9556 5.36304 6.696L9.17651 2.8835Z" fill="currentColor"/>`,
});

export const ArrowUpLineHorizontalLight20Icon = createIconComponent(arrowUpLineHorizontalLight20);
