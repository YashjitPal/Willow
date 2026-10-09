import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const envelopeRegular16 = defineIconAsset({
  name: "envelope-regular-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 1.25, y: 2.58374, width: 13.5, height: 10.833008 },
    visualBounds: { x: 1.25, y: 2.58374, width: 13.5, height: 10.833008 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.25, y: 2.58374, width: 13.5, height: 10.833008 },
    center: { x: 8, y: 8.000244 },
    insets: { top: 2.58374, right: 1.25, bottom: 2.583252, left: 1.25 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8, y: 8.000244 },
      foreground: { x: 8, y: 8.000244 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M12.1338 2.58374C13.5787 2.58399 14.7499 3.75502 14.75 5.19995V10.8005C14.7498 12.2453 13.5786 13.4165 12.1338 13.4167H3.86621C2.42143 13.4165 1.25025 12.2453 1.25 10.8005V5.19995C1.25007 3.75502 2.42132 2.58399 3.86621 2.58374H12.1338ZM9.21094 9.39526C8.49348 9.92057 7.52125 9.93193 6.79102 9.42456L2.75 6.61499V10.8005C2.75025 11.4169 3.24985 11.9165 3.86621 11.9167H12.1338C12.7501 11.9165 13.2498 11.4169 13.25 10.8005V6.43628L9.21094 9.39526ZM3.86621 4.08374C3.37879 4.08393 2.96467 4.39632 2.8125 4.83179L7.64746 8.19312C7.85189 8.33483 8.12447 8.33232 8.3252 8.1853L13.0938 4.69116C13.1019 4.68521 13.1099 4.67916 13.1182 4.67358C12.9301 4.32263 12.5599 4.08391 12.1338 4.08374H3.86621Z" fill="currentColor"/>`,
});

export const EnvelopeRegular16Icon = createIconComponent(envelopeRegular16);
