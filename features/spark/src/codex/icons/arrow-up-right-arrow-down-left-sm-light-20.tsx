import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const arrowUpRightArrowDownLeftSmLight20 = defineIconAsset({
  name: "arrow-up-right-arrow-down-left-sm-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 3.499756, y: 3.504883, width: 13, height: 12.998047 },
    visualBounds: { x: 3.499756, y: 3.504883, width: 13, height: 12.998047 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 3.499756, y: 3.504883, width: 13, height: 12.998047 },
    center: { x: 9.999756, y: 10.003907 },
    insets: { top: 3.504883, right: 3.500244, bottom: 3.49707, left: 3.499756 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 9.999756, y: 10.003907 },
      foreground: { x: 9.999756, y: 10.003907 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M7.89136 11.1846C8.15092 10.925 8.57303 10.9253 8.83276 11.1846C9.09222 11.4442 9.09206 11.8653 8.83276 12.125L5.78491 15.1729H8.32886C8.69607 15.1729 8.99383 15.4707 8.9939 15.8379C8.9939 16.2051 8.69611 16.5029 8.32886 16.5029H4.2644C3.84223 16.5027 3.49997 16.1605 3.49976 15.7383V11.6748C3.49992 11.3077 3.79765 11.0098 4.16479 11.0098C4.53194 11.0098 4.82967 11.3077 4.82983 11.6748V14.2461L7.89136 11.1846Z" fill="currentColor"/> <path d="M15.7351 3.50488C16.1573 3.50512 16.4995 3.84736 16.4998 4.26953V8.33301C16.4997 8.70018 16.2019 8.99802 15.8347 8.99805C15.4677 8.9978 15.1698 8.70004 15.1697 8.33301V5.76172L12.1082 8.82324C11.8485 9.08279 11.4264 9.08277 11.1667 8.82324C10.9073 8.56369 10.9076 8.14251 11.1667 7.88281L14.2146 4.83496H11.6707C11.3036 4.83472 11.0056 4.53704 11.0056 4.16992C11.0056 3.8028 11.3036 3.50512 11.6707 3.50488H15.7351Z" fill="currentColor"/>`,
});

export const ArrowUpRightArrowDownLeftSmLight20Icon = createIconComponent(arrowUpRightArrowDownLeftSmLight20);
