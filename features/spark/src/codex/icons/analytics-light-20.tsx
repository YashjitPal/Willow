import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const analyticsLight20 = defineIconAsset({
  name: "analytics-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 2.501465, y: 2.501953, width: 14.99707, height: 14.99707 },
    visualBounds: { x: 2.501465, y: 2.501953, width: 14.99707, height: 14.99707 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.501465, y: 2.501953, width: 14.99707, height: 14.99707 },
    center: { x: 10, y: 10.000488 },
    insets: { top: 2.501953, right: 2.501465, bottom: 2.500977, left: 2.501465 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10, y: 10.000488 },
      foreground: { x: 10, y: 10.000488 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M14.4419 2.50195C16.1298 2.50216 17.4985 3.8706 17.4985 5.55859V14.4424C17.4983 16.1302 16.1297 17.4988 14.4419 17.499H5.55811C3.87023 17.4989 2.50168 16.1302 2.50146 14.4424V5.55859C2.5015 3.87058 3.87012 2.50212 5.55811 2.50195H14.4419ZM8.58154 13.1299C8.22986 13.6215 7.49858 13.6216 7.14697 13.1299L5.38623 10.665H3.83154V14.4424C3.83175 15.3957 4.60477 16.1688 5.55811 16.1689H14.4419C15.3952 16.1687 16.1682 15.3957 16.1685 14.4424V10.665H14.3823C14.0977 10.665 13.8301 10.5275 13.6646 10.2959L12.1353 8.15527L8.58154 13.1299ZM5.55811 3.83203C4.60466 3.8322 3.83158 4.60512 3.83154 5.55859V9.33496H5.61768C5.90214 9.33502 6.16898 9.47276 6.33447 9.7041L7.86377 11.8457L11.4175 6.87109C11.7471 6.40961 12.4113 6.38044 12.7827 6.78418L12.853 6.87109L14.6118 9.33496H16.1685V5.55859C16.1684 4.60514 15.3953 3.83224 14.4419 3.83203H5.55811Z" fill="currentColor"/>`,
});

export const AnalyticsLight20Icon = createIconComponent(analyticsLight20);
