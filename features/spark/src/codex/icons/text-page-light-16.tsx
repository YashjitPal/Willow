import { Icon, type IconProps } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const textPageLight16 = defineIconAsset({
  name: "text-page-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 2.474609, y: 1.808105, width: 11.050781, height: 12.383789 },
    visualBounds: { x: 2.474609, y: 1.808105, width: 11.050781, height: 12.383789 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.474609, y: 1.808105, width: 11.050781, height: 12.383789 },
    center: { x: 8, y: 8 },
    insets: { top: 1.808105, right: 2.47461, bottom: 1.808106, left: 2.474609 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8, y: 8 },
      foreground: { x: 8, y: 8 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M8.66699 8.9751C8.95679 8.97527 9.19141 9.21065 9.19141 9.50049C9.19114 9.79011 8.95663 10.0257 8.66699 10.0259H6C5.71021 10.0259 5.47487 9.79021 5.47461 9.50049C5.47461 9.21054 5.71005 8.9751 6 8.9751H8.66699Z" fill="currentColor"/> <path d="M10 6.14209C10.2899 6.14209 10.5254 6.37753 10.5254 6.66748C10.5251 6.95721 10.2898 7.19287 10 7.19287H6C5.71021 7.19287 5.47487 6.95721 5.47461 6.66748C5.47461 6.37753 5.71005 6.14209 6 6.14209H10Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M10.8662 1.80811C12.3344 1.80811 13.5254 2.99913 13.5254 4.46729V11.5337C13.5253 13.0018 12.3343 14.1919 10.8662 14.1919H5.13379C3.6657 14.1919 2.47472 13.0018 2.47461 11.5337V4.46729C2.47461 2.99913 3.66563 1.80811 5.13379 1.80811H10.8662ZM5.13379 2.85889C4.24553 2.85889 3.52539 3.57903 3.52539 4.46729V11.5337C3.5255 12.4219 4.2456 13.1421 5.13379 13.1421H10.8662C11.7544 13.1421 12.4745 12.4219 12.4746 11.5337V4.46729C12.4746 3.57903 11.7545 2.85889 10.8662 2.85889H5.13379Z" fill="currentColor"/>`,
});

export function TextPageLight16Icon(props: Omit<IconProps, "asset">) {
  return <Icon asset={textPageLight16} {...props} />;
}
