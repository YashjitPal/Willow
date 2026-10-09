import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const arrowUpRightMdLight20 = defineIconAsset({
  name: "arrow-up-right-md-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 5.174316, y: 6.001465, width: 8.831299, height: 8.82666 },
    visualBounds: { x: 5.174316, y: 6.001465, width: 8.831299, height: 8.82666 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 5.174316, y: 6.001465, width: 8.831299, height: 8.82666 },
    center: { x: 9.589966, y: 10.414795 },
    insets: { top: 6.001465, right: 5.994385, bottom: 5.171875, left: 5.174316 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 9.589966, y: 10.414795 },
      foreground: { x: 9.589966, y: 10.414795 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M13.3182 6.00635C13.3568 6.01026 13.3948 6.01839 13.4315 6.02783C13.563 6.05001 13.6894 6.11093 13.7908 6.2124C13.8822 6.30381 13.9396 6.41543 13.9666 6.53271C13.9829 6.58314 13.9963 6.63553 14.0018 6.68994L14.0057 6.76709V12.561C14.0051 12.9278 13.7075 13.225 13.3406 13.2251C12.9735 13.2251 12.6747 12.9272 12.6746 12.5601V8.26807L6.3094 14.6333C6.0497 14.893 5.62866 14.893 5.36897 14.6333C5.10952 14.3736 5.10935 13.9525 5.36897 13.6929L11.7303 7.33252H7.44807C7.08095 7.33236 6.78306 7.03463 6.78303 6.66748C6.78306 6.30033 7.08095 6.0026 7.44807 6.00244L13.241 6.00146L13.3182 6.00635Z" fill="currentColor"/>`,
});

export const ArrowUpRightMdLight20Icon = createIconComponent(arrowUpRightMdLight20);
