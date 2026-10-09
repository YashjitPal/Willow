import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const analyticsLight16 = defineIconAsset({
  name: "analytics-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 1.807861, y: 1.807617, width: 12.383789, height: 12.383789 },
    visualBounds: { x: 1.807861, y: 1.807617, width: 12.383789, height: 12.383789 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.807861, y: 1.807617, width: 12.383789, height: 12.383789 },
    center: { x: 7.999756, y: 7.999512 },
    insets: { top: 1.807617, right: 1.80835, bottom: 1.808594, left: 1.807861 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 7.999756, y: 7.999512 },
      foreground: { x: 7.999756, y: 7.999512 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M11.6829 1.80762C13.0682 1.80762 14.1917 2.93109 14.1917 4.31641V11.6826C14.1917 13.0679 13.0682 14.1914 11.6829 14.1914H4.31665C2.93134 14.1914 1.80786 13.0679 1.80786 11.6826V4.31641C1.80786 2.93109 2.93134 1.80762 4.31665 1.80762H11.6829ZM6.80591 10.5752C6.52341 10.9707 5.93509 10.9707 5.65259 10.5752L4.18774 8.52441H2.85864V11.6826C2.85864 12.488 3.51124 13.1416 4.31665 13.1416H11.6829C12.4883 13.1416 13.1418 12.488 13.1418 11.6826V8.52441H11.636C11.4075 8.52434 11.1928 8.41433 11.0598 8.22852L9.77075 6.42383L6.80591 10.5752ZM4.31665 2.8584C3.51124 2.8584 2.85864 3.51099 2.85864 4.31641V7.47461H4.36353C4.56363 7.47461 4.75368 7.55931 4.88696 7.70508L4.94067 7.77148L6.22876 9.5752L9.19458 5.42383L9.25122 5.35449C9.52958 5.05222 10.0118 5.05237 10.2903 5.35449L10.3469 5.42383L11.8118 7.47461H13.1418V4.31641C13.1418 3.51099 12.4883 2.8584 11.6829 2.8584H4.31665Z" fill="currentColor"/>`,
});

export const AnalyticsLight16Icon = createIconComponent(analyticsLight16);
