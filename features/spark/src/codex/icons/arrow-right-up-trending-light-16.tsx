import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const arrowRightUpTrendingLight16 = defineIconAsset({
  name: "arrow-right-up-trending-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 1.474121, y: 4.141113, width: 13.051025, height: 7.717285 },
    visualBounds: { x: 1.474121, y: 4.141113, width: 13.051025, height: 7.717285 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.474121, y: 4.141113, width: 13.051025, height: 7.717285 },
    center: { x: 7.999634, y: 7.999756 },
    insets: { top: 4.141113, right: 1.474854, bottom: 4.141602, left: 1.474121 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 7.999634, y: 7.999756 },
      foreground: { x: 7.999634, y: 7.999756 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M13.9001 4.14111C14.2448 4.14159 14.5249 4.42141 14.5251 4.76611V8.6665C14.5251 8.95629 14.2895 9.19163 13.9997 9.19189C13.7098 9.19189 13.4743 8.95645 13.4743 8.6665V5.93311L8.79759 10.6108C8.54058 10.8673 8.12388 10.8674 7.86692 10.6108L5.66478 8.40869L2.36985 11.7046C2.16481 11.9093 1.8326 11.9095 1.62767 11.7046C1.4229 11.4996 1.42298 11.1674 1.62767 10.9624L5.19993 7.39014L5.30345 7.30518C5.52239 7.16081 5.80916 7.16073 6.02806 7.30518L6.1306 7.39014L8.33177 9.59033L12.7312 5.19189H9.99974C9.70979 5.19189 9.47435 4.95645 9.47435 4.6665C9.47435 4.37655 9.70979 4.14111 9.99974 4.14111H13.9001Z" fill="currentColor"/>`,
});

export const ArrowRightUpTrendingLight16Icon = createIconComponent(arrowRightUpTrendingLight16);
