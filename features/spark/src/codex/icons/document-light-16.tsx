import { Icon, type IconProps } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const documentLight16 = defineIconAsset({
  name: "document-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 2.474609, y: 1.807861, width: 11.050781, height: 12.383789 },
    visualBounds: { x: 2.474609, y: 1.807861, width: 11.050781, height: 12.383789 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.474609, y: 1.807861, width: 11.050781, height: 12.383789 },
    center: { x: 8, y: 7.999756 },
    insets: { top: 1.807861, right: 2.47461, bottom: 1.80835, left: 2.474609 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8, y: 7.999756 },
      foreground: { x: 8, y: 7.999756 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M9.50488 1.80786C10.1745 1.80786 10.8165 2.07457 11.29 2.5481L12.7852 4.04321C13.2587 4.51674 13.5254 5.1587 13.5254 5.82837V11.6663C13.5254 13.0608 12.3945 14.1917 11 14.1917H5C3.60548 14.1917 2.47461 13.0608 2.47461 11.6663V4.33325C2.47461 2.93873 3.60548 1.80786 5 1.80786H9.50488ZM5 2.85864C4.18538 2.85864 3.52539 3.51863 3.52539 4.33325V11.6663C3.52539 12.4809 4.18538 13.1418 5 13.1418H11C11.8146 13.1418 12.4746 12.4809 12.4746 11.6663V6.85864H10.666C9.64 6.8584 8.80779 6.02627 8.80762 5.00024V2.85864H5ZM9.8584 5.00024C9.85857 5.44637 10.2199 5.80762 10.666 5.80786H12.4736C12.4683 5.42409 12.3147 5.05718 12.043 4.7854L10.5479 3.29028C10.3563 3.09869 10.1171 2.96641 9.8584 2.90259V5.00024Z" fill="currentColor"/>`,
});

export function DocumentLight16Icon(props: Omit<IconProps, "asset">) {
  return <Icon asset={documentLight16} {...props} />;
}
