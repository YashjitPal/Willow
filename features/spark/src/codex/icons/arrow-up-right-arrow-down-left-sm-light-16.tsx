import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const arrowUpRightArrowDownLeftSmLight16 = defineIconAsset({
  name: "arrow-up-right-arrow-down-left-sm-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 2.806396, y: 2.810547, width: 10.386719, height: 10.385742 },
    visualBounds: { x: 2.806396, y: 2.810547, width: 10.386719, height: 10.385742 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.806396, y: 2.810547, width: 10.386719, height: 10.385742 },
    center: { x: 7.999755, y: 8.003418 },
    insets: { top: 2.810547, right: 2.806885, bottom: 2.803711, left: 2.806396 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 7.999755, y: 8.003418 },
      foreground: { x: 7.999755, y: 8.003418 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M6.31909 8.95312C6.52412 8.74814 6.85627 8.74811 7.06128 8.95312C7.26625 9.15814 7.26625 9.4903 7.06128 9.69531L4.61108 12.1455H6.66284C6.95279 12.1455 7.18823 12.3809 7.18823 12.6709C7.18797 12.9606 6.95263 13.1963 6.66284 13.1963H3.4314C3.08669 13.1961 2.80687 12.9159 2.8064 12.5713V9.34082C2.8064 9.05093 3.04191 8.81552 3.33179 8.81543C3.62166 8.81552 3.8562 9.05093 3.8562 9.34082V11.416L6.31909 8.95312Z" fill="currentColor"/> <path d="M12.5681 2.81055C12.9131 2.81067 13.1929 3.09062 13.1931 3.43555V6.66602C13.1931 6.95597 12.9577 7.19141 12.6677 7.19141C12.3779 7.19123 12.1433 6.95586 12.1433 6.66602V4.58984L9.68042 7.05273C9.47539 7.25774 9.14325 7.25775 8.93823 7.05273C8.7336 6.84769 8.73336 6.51544 8.93823 6.31055L11.3875 3.86133H9.33667C9.0468 3.86124 8.81128 3.62583 8.81128 3.33594C8.81128 3.04604 9.0468 2.81064 9.33667 2.81055H12.5681Z" fill="currentColor"/>`,
});

export const ArrowUpRightArrowDownLeftSmLight16Icon = createIconComponent(arrowUpRightArrowDownLeftSmLight16);
