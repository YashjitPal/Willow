import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const personalizationLight20 = defineIconAsset({
  name: "personalization-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 1.834961, y: 1.834961, width: 16.330078, height: 16.330078 },
    visualBounds: { x: 1.834961, y: 1.834961, width: 16.330078, height: 16.330078 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "circular",
    bounds: { x: 1.834961, y: 1.834961, width: 16.330078, height: 16.330078 },
    center: { x: 10, y: 10 },
    insets: { top: 1.834961, right: 1.834961, bottom: 1.834961, left: 1.834961 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10, y: 10 },
      foreground: { x: 10, y: 10 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M13.4941 10.1875C13.8503 10.2765 14.0673 10.638 13.9785 10.9941C13.7371 11.96 13.2403 12.7268 12.5264 13.2461C11.8174 13.7616 10.9432 13.998 10 13.998C9.63273 13.998 9.33496 13.7003 9.33496 13.333C9.33514 12.9659 9.63284 12.668 10 12.668C10.7234 12.668 11.3073 12.4876 11.7441 12.1699C12.1758 11.8559 12.5133 11.3725 12.6885 10.6719C12.7776 10.316 13.1381 10.0989 13.4941 10.1875Z" fill="currentColor"/> <path d="M8.61914 6.29004C8.82724 5.98777 9.24046 5.91136 9.54297 6.11914C9.84542 6.32726 9.92286 6.74138 9.71484 7.04395L8.00586 9.5293L9.28516 9.7627C9.64644 9.82844 9.88698 10.1748 9.82129 10.5361C9.75535 10.8971 9.40892 11.1368 9.04785 11.0713L7.38965 10.7695C6.61782 10.6291 6.24818 9.73935 6.69238 9.09277L8.61914 6.29004Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M10 1.83496C14.5094 1.83496 18.165 5.49059 18.165 10C18.165 14.5094 14.5094 18.165 10 18.165C5.49059 18.165 1.83496 14.5094 1.83496 10C1.83496 5.49059 5.49059 1.83496 10 1.83496ZM10 3.16504C6.22513 3.16504 3.16504 6.22513 3.16504 10C3.16504 13.7749 6.22513 16.835 10 16.835C13.7749 16.835 16.835 13.7749 16.835 10C16.835 6.22513 13.7749 3.16504 10 3.16504Z" fill="currentColor"/>`,
});

export const PersonalizationLight20Icon = createIconComponent(personalizationLight20);
