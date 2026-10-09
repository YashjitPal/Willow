import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const checkmarkSquareLight16 = defineIconAsset({
  name: "checkmark-square-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 1.807861, y: 1.807861, width: 12.383789, height: 12.383789 },
    visualBounds: { x: 1.807861, y: 1.807861, width: 12.383789, height: 12.383789 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.807861, y: 1.807861, width: 12.383789, height: 12.383789 },
    center: { x: 7.999756, y: 7.999756 },
    insets: { top: 1.807861, right: 1.80835, bottom: 1.80835, left: 1.807861 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 7.999756, y: 7.999756 },
      foreground: { x: 7.999756, y: 7.999756 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M9.82642 5.80396C9.98785 5.56358 10.3143 5.49847 10.5549 5.65942C10.7955 5.8207 10.8602 6.14719 10.6995 6.38794L7.98657 10.4338C7.70849 10.8483 7.11711 10.8955 6.77661 10.5305L5.35376 9.0061C5.15615 8.79416 5.1674 8.4617 5.37915 8.26392C5.59109 8.06648 5.9236 8.07764 6.12134 8.28931L7.30688 9.56079L9.82642 5.80396Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M11.6829 1.80786C13.0682 1.80786 14.1917 2.93134 14.1917 4.31665V11.6829C14.1917 13.0682 13.0682 14.1917 11.6829 14.1917H4.31665C2.93134 14.1917 1.80786 13.0682 1.80786 11.6829V4.31665C1.80786 2.93134 2.93134 1.80786 4.31665 1.80786H11.6829ZM4.31665 2.85864C3.51124 2.85864 2.85864 3.51124 2.85864 4.31665V11.6829C2.85864 12.4883 3.51124 13.1418 4.31665 13.1418H11.6829C12.4883 13.1418 13.1418 12.4883 13.1418 11.6829V4.31665C13.1418 3.51124 12.4883 2.85864 11.6829 2.85864H4.31665Z" fill="currentColor"/>`,
});

export const CheckmarkSquareLight16Icon = createIconComponent(checkmarkSquareLight16);
