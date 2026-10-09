import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const textDocumentLight16 = defineIconAsset({
  name: "text-document-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 2.474609, y: 1.807617, width: 11.050781, height: 12.383789 },
    visualBounds: { x: 2.474609, y: 1.807617, width: 11.050781, height: 12.383789 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.474609, y: 1.807617, width: 11.050781, height: 12.383789 },
    center: { x: 8, y: 7.999512 },
    insets: { top: 1.807617, right: 2.47461, bottom: 1.808594, left: 2.474609 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8, y: 7.999512 },
      foreground: { x: 8, y: 7.999512 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M10 10.1406C10.2899 10.1406 10.5254 10.3761 10.5254 10.666C10.5254 10.956 10.2899 11.1914 10 11.1914H6C5.71005 11.1914 5.47461 10.956 5.47461 10.666C5.47461 10.3761 5.71005 10.1406 6 10.1406H10Z" fill="currentColor"/> <path d="M8.66699 7.47461C8.95679 7.47478 9.19141 7.71016 9.19141 8C9.19141 8.28984 8.95679 8.52522 8.66699 8.52539H6C5.71005 8.52539 5.47461 8.28995 5.47461 8C5.47461 7.71005 5.71005 7.47461 6 7.47461H8.66699Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M9.50488 1.80762C10.1745 1.80762 10.8165 2.07433 11.29 2.54785L12.7852 4.04297C13.2587 4.5165 13.5254 5.15846 13.5254 5.82812V11.666C13.5254 13.0605 12.3945 14.1914 11 14.1914H5C3.60548 14.1914 2.47461 13.0605 2.47461 11.666V4.33301C2.47461 2.93849 3.60548 1.80762 5 1.80762H9.50488ZM5 2.8584C4.18538 2.8584 3.52539 3.51839 3.52539 4.33301V11.666C3.52539 12.4806 4.18538 13.1416 5 13.1416H11C11.8146 13.1416 12.4746 12.4806 12.4746 11.666V6.85938H10.666C9.64006 6.85907 8.80779 6.02697 8.80762 5.00098V2.8584H5ZM9.8584 5.00098C9.85857 5.44707 10.22 5.80829 10.666 5.80859H12.4736C12.4686 5.42447 12.315 5.05716 12.043 4.78516L10.5479 3.29004C10.3563 3.09845 10.1171 2.96616 9.8584 2.90234V5.00098Z" fill="currentColor"/>`,
});

export const TextDocumentLight16Icon = createIconComponent(textDocumentLight16);
