import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const flashcardsLandscapeLight20 = defineIconAsset({
  name: "flashcards-landscape-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 1.026367, y: 1.326172, width: 17.891846, height: 17.405273 },
    visualBounds: { x: 1.026367, y: 1.326172, width: 17.891846, height: 17.405273 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.026367, y: 1.326172, width: 17.891846, height: 17.405273 },
    center: { x: 9.97229, y: 10.028809 },
    insets: { top: 1.326172, right: 1.081787, bottom: 1.268555, left: 1.026367 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 9.97229, y: 10.028809 },
      foreground: { x: 9.97229, y: 10.028809 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M5.26122 3.43364C5.51105 2.02711 6.87242 1.11994 8.27489 1.36723L16.7544 2.86333C18.1576 3.11092 19.1275 4.4298 18.8794 5.83794L17.6567 12.7725C17.4752 13.8022 16.6969 14.5612 15.7436 14.7998C15.8308 16.1389 14.847 17.3182 13.4995 17.5079L4.97118 18.7061C3.56006 18.9042 2.22982 17.9502 2.03075 16.5342L1.05126 9.56059C0.852434 8.14461 1.86767 6.86056 3.2788 6.66215L4.71141 6.46001L5.26122 3.43364ZM11.9917 6.78032L3.46434 7.97856C2.74909 8.07914 2.27666 8.71778 2.36864 9.37504L3.34813 16.3487C3.44054 17.0062 4.0711 17.4902 4.78661 17.3897L13.314 16.1905C14.0294 16.0898 14.5021 15.4515 14.4097 14.794L13.4292 7.82133C13.3366 7.16408 12.707 6.68 11.9917 6.78032ZM8.04344 2.67778C7.33202 2.55243 6.68428 3.01335 6.56883 3.66704V3.67094L6.09813 6.26469L11.8061 5.46294C13.2173 5.26467 14.5474 6.21985 14.7466 7.63579L15.5659 13.4659C15.9668 13.3138 16.2715 12.9705 16.3472 12.542L17.5708 5.60649C17.6856 4.95282 17.2343 4.29833 16.5229 4.1729L8.04344 2.67778Z" fill="currentColor"/>`,
});

export const FlashcardsLandscapeLight20Icon = createIconComponent(flashcardsLandscapeLight20);
