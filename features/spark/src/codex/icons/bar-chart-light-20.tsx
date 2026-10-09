import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const barChartLight20 = defineIconAsset({
  name: "bar-chart-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 1.834961, y: 1.835938, width: 16.330078, height: 16.330078 },
    visualBounds: { x: 1.834961, y: 1.835938, width: 16.330078, height: 16.330078 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.834961, y: 1.835938, width: 16.330078, height: 16.330078 },
    center: { x: 10, y: 10.000977 },
    insets: { top: 1.835938, right: 1.834961, bottom: 1.833984, left: 1.834961 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10, y: 10.000977 },
      foreground: { x: 10, y: 10.000977 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M10.6279 1.83594C12.0307 1.83594 13.168 2.97317 13.168 4.37598V5.58594H15.625C17.0278 5.58594 18.165 6.72317 18.165 8.12598V15.626C18.165 17.0288 17.0278 18.166 15.625 18.166H4.375C2.9722 18.166 1.83496 17.0288 1.83496 15.626V11.876C1.83496 10.4732 2.9722 9.33594 4.375 9.33594H6.83203V4.37598C6.83203 2.97317 7.96927 1.83594 9.37207 1.83594H10.6279ZM13.168 16.8359H15.625C16.2933 16.8359 16.835 16.2942 16.835 15.626V8.12598C16.835 7.45771 16.2933 6.91602 15.625 6.91602H13.168V16.8359ZM9.37207 3.16602C8.70381 3.16602 8.16211 3.70771 8.16211 4.37598V16.8359H11.8379V4.37598C11.8379 3.70771 11.2962 3.16602 10.6279 3.16602H9.37207ZM4.375 10.666C3.70674 10.666 3.16504 11.2077 3.16504 11.876V15.626C3.16504 16.2942 3.70674 16.8359 4.375 16.8359H6.83203V10.666H4.375Z" fill="currentColor"/>`,
});

export const BarChartLight20Icon = createIconComponent(barChartLight20);
