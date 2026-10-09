import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const chevronRightSmLight16 = defineIconAsset({
  name: "chevron-right-sm-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 6.141846, y: 4.808594, width: 3.578125, height: 6.382813 },
    visualBounds: { x: 6.141846, y: 4.808594, width: 3.578125, height: 6.382813 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 6.141846, y: 4.808594, width: 3.578125, height: 6.382813 },
    center: { x: 7.930909, y: 8.000001 },
    insets: { top: 4.808594, right: 6.280029, bottom: 4.808593, left: 6.141846 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 7.930909, y: 8.000001 },
      foreground: { x: 7.930909, y: 8.000001 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M6.29561 10.2954C6.09064 10.5003 6.09075 10.8325 6.29561 11.0376C6.50064 11.2426 6.83278 11.2426 7.0378 11.0376L9.46847 8.60689C9.80367 8.27169 9.80367 7.72823 9.46847 7.39303L7.0378 4.96236C6.83278 4.75734 6.50064 4.75734 6.29561 4.96236C6.09059 5.16739 6.09059 5.49952 6.29561 5.70455L8.59054 7.99947L6.29561 10.2954Z" fill="currentColor"/>`,
});

export const ChevronRightSmLight16Icon = createIconComponent(chevronRightSmLight16);
