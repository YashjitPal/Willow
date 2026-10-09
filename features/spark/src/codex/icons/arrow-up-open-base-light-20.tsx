import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const arrowUpOpenBaseLight20 = defineIconAsset({
  name: "arrow-up-open-base-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 2.668213, y: 2.84082, width: 14.663086, height: 14.490234 },
    visualBounds: { x: 2.668213, y: 2.84082, width: 14.663086, height: 14.490234 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.668213, y: 2.84082, width: 14.663086, height: 14.490234 },
    center: { x: 9.999756, y: 10.085937 },
    insets: { top: 2.84082, right: 2.668701, bottom: 2.668946, left: 2.668213 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 9.999756, y: 10.085937 },
      foreground: { x: 9.999756, y: 10.085937 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M16.6663 10.1681C17.0335 10.1681 17.3313 10.4659 17.3313 10.8332V14.1994C17.3313 15.929 15.929 17.3312 14.1995 17.3312H5.80005C4.07048 17.3312 2.66821 15.929 2.66821 14.1994V10.8332C2.66821 10.4659 2.96598 10.1681 3.33325 10.1681C3.70052 10.1681 3.99829 10.4659 3.99829 10.8332V14.1994C3.99829 15.1944 4.80502 16.0011 5.80005 16.0011H14.1995C15.1945 16.0011 16.0012 15.1944 16.0012 14.1994V10.8332C16.0012 10.466 16.2991 10.1683 16.6663 10.1681Z" fill="currentColor"/> <path d="M9.31763 3.08317C9.71412 2.76014 10.2865 2.75993 10.6829 3.08317L10.7649 3.15739L14.012 6.40446C14.2716 6.66406 14.2714 7.08517 14.012 7.34489C13.7523 7.60459 13.3312 7.60459 13.0715 7.34489L10.6653 4.93864V11.8752C10.6653 12.2423 10.3674 12.54 10.0002 12.5402C9.63297 12.5402 9.33521 12.2424 9.33521 11.8752V4.93669L6.92896 7.34489C6.66926 7.60459 6.24725 7.60459 5.98755 7.34489C5.72836 7.08521 5.72817 6.66402 5.98755 6.40446L9.23462 3.15739L9.31763 3.08317Z" fill="currentColor"/>`,
});

export const ArrowUpOpenBaseLight20Icon = createIconComponent(arrowUpOpenBaseLight20);
