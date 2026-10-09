import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const arrowUpRightArrowDownLeftMdLight16 = defineIconAsset({
  name: "arrow-up-right-arrow-down-left-md-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 2.140747, y: 2.143555, width: 11.71875, height: 11.71875 },
    visualBounds: { x: 2.140747, y: 2.143555, width: 11.71875, height: 11.71875 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.140747, y: 2.143555, width: 11.71875, height: 11.71875 },
    center: { x: 8.000122, y: 8.00293 },
    insets: { top: 2.143555, right: 2.140503, bottom: 2.137695, left: 2.140747 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8.000122, y: 8.00293 },
      foreground: { x: 8.000122, y: 8.00293 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M2.66528 8.81445C2.95513 8.81454 3.19063 9.04999 3.19067 9.33984V12.082L5.9856 9.28711C6.19062 9.08208 6.52276 9.08208 6.72778 9.28711C6.93244 9.49216 6.93269 9.82439 6.72778 10.0293L3.94556 12.8115H6.66333C6.9532 12.8116 7.18872 13.047 7.18872 13.3369C7.18865 13.6268 6.95316 13.8622 6.66333 13.8623H2.76587C2.42086 13.8623 2.14115 13.5822 2.14087 13.2373V9.33984C2.14091 9.04999 2.37544 8.81454 2.66528 8.81445Z" fill="currentColor"/> <path d="M13.2346 2.14355C13.5796 2.14364 13.8594 2.42361 13.8596 2.76855V6.66602C13.8596 6.95582 13.625 7.19123 13.3352 7.19141C13.0453 7.19141 12.8099 6.95593 12.8098 6.66602V3.9248L10.0149 6.71973C9.81001 6.92456 9.47775 6.92429 9.27271 6.71973C9.06786 6.5147 9.06777 6.18251 9.27271 5.97754L12.0559 3.19434H9.33716C9.04721 3.19434 8.81177 2.95889 8.81177 2.66895C8.81177 2.379 9.04721 2.14355 9.33716 2.14355H13.2346Z" fill="currentColor"/>`,
});

export const ArrowUpRightArrowDownLeftMdLight16Icon = createIconComponent(arrowUpRightArrowDownLeftMdLight16);
