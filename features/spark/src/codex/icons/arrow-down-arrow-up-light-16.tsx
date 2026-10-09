import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const arrowDownArrowUpLight16 = defineIconAsset({
  name: "arrow-down-arrow-up-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 1.475586, y: 2.784668, width: 13.049316, height: 10.513672 },
    visualBounds: { x: 1.475586, y: 2.784668, width: 13.049316, height: 10.513672 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.475586, y: 2.784668, width: 13.049316, height: 10.513672 },
    center: { x: 8.000244, y: 8.041504 },
    insets: { top: 2.784668, right: 1.475098, bottom: 2.70166, left: 1.475586 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8.000244, y: 8.041504 },
      foreground: { x: 8.000244, y: 8.041504 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M4.66722 3.14218C4.95711 3.14225 5.19261 3.37767 5.19261 3.66757V11.6295L6.95824 9.82578C7.16093 9.61896 7.49327 9.61573 7.70043 9.81796C7.90753 10.0208 7.91092 10.353 7.70824 10.5602L5.27953 13.0406L5.2141 13.1012C4.89729 13.3642 4.43507 13.3645 4.1184 13.1012L4.05297 13.0406L1.62523 10.5602C1.4228 10.353 1.42608 10.0207 1.63304 9.81796C1.8401 9.61558 2.17245 9.61912 2.37523 9.82578L4.14183 11.6295V3.66757C4.14183 3.37762 4.37727 3.14218 4.66722 3.14218Z" fill="currentColor"/> <path d="M10.7854 2.98203C11.1021 2.71876 11.5643 2.719 11.8811 2.98203L11.9465 3.04257L14.3752 5.52304C14.5779 5.73021 14.5745 6.06242 14.3674 6.26523C14.1603 6.46786 13.828 6.46437 13.6252 6.25742L11.8586 4.45175V12.3336C11.8584 12.6233 11.623 12.859 11.3332 12.859C11.0436 12.8588 10.8081 12.6232 10.8078 12.3336V4.45371L9.04222 6.25742C8.83948 6.46447 8.50723 6.46775 8.30004 6.26523C8.093 6.06236 8.08941 5.73017 8.29222 5.52304L10.72 3.04257L10.7854 2.98203Z" fill="currentColor"/>`,
});

export const ArrowDownArrowUpLight16Icon = createIconComponent(arrowDownArrowUpLight16);
