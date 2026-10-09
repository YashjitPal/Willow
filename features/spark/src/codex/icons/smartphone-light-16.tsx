import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const smartphoneLight16 = defineIconAsset({
  name: "smartphone-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 3.674561, y: 1.474609, width: 8.650391, height: 13.050781 },
    visualBounds: { x: 3.674561, y: 1.474609, width: 8.650391, height: 13.050781 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 3.674561, y: 1.474609, width: 8.650391, height: 13.050781 },
    center: { x: 7.999757, y: 8 },
    insets: { top: 1.474609, right: 3.675048, bottom: 1.47461, left: 3.674561 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 7.999757, y: 8 },
      foreground: { x: 7.999757, y: 8 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M8.72534 3.79395C9.01499 3.79425 9.24969 4.02963 9.24976 4.31934C9.24976 4.6091 9.01503 4.84442 8.72534 4.84473H7.34253C7.05258 4.84473 6.81714 4.60929 6.81714 4.31934C6.8172 4.02944 7.05262 3.79395 7.34253 3.79395H8.72534Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M9.93335 1.47461C11.254 1.47464 12.3247 2.54556 12.325 3.86621V12.1338C12.3247 13.4544 11.254 14.5254 9.93335 14.5254H6.06616C4.74564 14.5251 3.67481 13.4543 3.67456 12.1338V3.86621C3.67481 2.54569 4.74564 1.47486 6.06616 1.47461H9.93335ZM6.06616 2.52539C5.32554 2.52564 4.72559 3.12559 4.72534 3.86621V12.1338C4.72559 12.8744 5.32554 13.4744 6.06616 13.4746H9.93335C10.6741 13.4746 11.2749 12.8745 11.2751 12.1338V3.86621C11.2749 3.12546 10.6741 2.52543 9.93335 2.52539H6.06616Z" fill="currentColor"/>`,
});

export const SmartphoneLight16Icon = createIconComponent(smartphoneLight16);
