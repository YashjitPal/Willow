import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const cubeLight16 = defineIconAsset({
  name: "cube-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 1.722168, y: 1.038086, width: 12.554688, height: 13.92334 },
    visualBounds: { x: 1.722168, y: 1.038086, width: 12.554688, height: 13.92334 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.722168, y: 1.038086, width: 12.554688, height: 13.92334 },
    center: { x: 7.999512, y: 7.999756 },
    insets: { top: 1.038086, right: 1.723144, bottom: 1.038574, left: 1.722168 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 7.999512, y: 7.999756 },
      foreground: { x: 7.999512, y: 7.999756 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M13.2271 10.5539C13.2271 10.8409 13.0742 11.1066 12.8257 11.2502L8.5249 13.7336V8.30679L13.2271 5.66226V10.5539ZM3.08936 4.80777C3.1164 4.78715 3.14441 4.76742 3.17432 4.75015L7.59814 2.19644C7.84673 2.05292 8.15327 2.05292 8.40186 2.19644L12.7671 4.71695L7.9917 7.4025L3.08936 4.80777ZM2.77295 5.8273L7.4751 8.31656V13.7336L3.17432 11.2502C2.92573 11.1066 2.77295 10.8409 2.77295 10.5539V5.8273ZM14.2769 5.44547C14.2767 4.78347 13.9234 4.17198 13.3501 3.84097L8.92627 1.28629C8.35289 0.955427 7.64608 0.955278 7.07275 1.28629L2.64893 3.84097C2.0758 4.17203 1.72233 4.7836 1.72217 5.44547V10.5539C1.72217 11.2159 2.07561 11.8282 2.64893 12.1593L7.07275 14.713C7.64618 15.0441 8.35283 15.0441 8.92627 14.713L13.3501 12.1593C13.9236 11.8282 14.2769 11.216 14.2769 10.5539V5.44547Z" fill="currentColor"/>`,
});

export const CubeLight16Icon = createIconComponent(cubeLight16);
