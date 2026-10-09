import { Icon, type IconProps } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const photoLight16 = defineIconAsset({
  name: "photo-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 1.474609, y: 2.141113, width: 13.050781, height: 11.716797 },
    visualBounds: { x: 1.474609, y: 2.141113, width: 13.050781, height: 11.716797 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.474609, y: 2.141113, width: 13.050781, height: 11.716797 },
    center: { x: 8, y: 7.999512 },
    insets: { top: 2.141113, right: 1.47461, bottom: 2.14209, left: 1.474609 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8, y: 7.999512 },
      foreground: { x: 8, y: 7.999512 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M10.0811 4.49963C11.1994 4.49963 12.1064 5.40665 12.1064 6.52502C12.1062 7.64318 11.1993 8.55042 10.0811 8.55042C8.96284 8.55042 8.05593 7.64318 8.05566 6.52502C8.05566 5.40665 8.96268 4.49963 10.0811 4.49963ZM10.0811 5.55042C9.54258 5.55042 9.10645 5.98655 9.10645 6.52502C9.10671 7.06328 9.54274 7.49963 10.0811 7.49963C10.6194 7.49963 11.0554 7.06328 11.0557 6.52502C11.0557 5.98655 10.6195 5.55042 10.0811 5.55042Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M11.8662 2.14124C13.3344 2.14124 14.5254 3.33226 14.5254 4.80042V11.1998C14.5254 12.668 13.3344 13.858 11.8662 13.858H4.13379C2.66563 13.858 1.47461 12.668 1.47461 11.1998V4.80042C1.47461 3.33226 2.66563 2.14124 4.13379 2.14124H11.8662ZM4.13379 3.19202C3.24553 3.19202 2.52539 3.91216 2.52539 4.80042V9.58557L3.55371 8.55823C4.34438 7.76773 5.62617 7.76687 6.41699 8.55725L10.6699 12.8082H11.8662C12.7545 12.8082 13.4746 12.0881 13.4746 11.1998V4.80042C13.4746 3.91216 12.7545 3.19202 11.8662 3.19202H4.13379ZM5.6748 9.30042C5.29407 8.91989 4.6766 8.91989 4.2959 9.30042L2.52539 11.0709V11.1998C2.52539 12.0881 3.24553 12.8082 4.13379 12.8082H9.18457L5.6748 9.30042Z" fill="currentColor"/>`,
});

export function PhotoLight16Icon(props: Omit<IconProps, "asset">) {
  return <Icon asset={photoLight16} {...props} />;
}
