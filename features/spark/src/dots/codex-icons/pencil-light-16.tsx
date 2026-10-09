import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const pencilLight16 = defineIconAsset({
  name: "pencil-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 1.806641, y: 1.804932, width: 12.387695, height: 12.390625 },
    visualBounds: { x: 1.806641, y: 1.804932, width: 12.387695, height: 12.390625 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.806641, y: 1.804932, width: 12.387695, height: 12.390625 },
    center: { x: 8.000488, y: 8.000245 },
    insets: { top: 1.804932, right: 1.805664, bottom: 1.804443, left: 1.806641 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8.000488, y: 8.000245 },
      foreground: { x: 8.000488, y: 8.000245 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M9.41506 2.54535C10.5566 1.516 12.2884 1.57105 13.3399 2.64105C14.4597 3.72222 14.4959 5.5405 13.3467 6.68988L7.75588 12.2797C7.18583 12.8809 6.45561 13.2881 5.6924 13.4653H5.69045L2.59767 14.1762L2.5967 14.1743C2.4644 14.2058 2.19674 14.2328 1.98342 14.02C1.76937 13.8062 1.79632 13.5371 1.82814 13.4047L2.5381 10.3188C2.71723 9.5224 3.12639 8.8269 3.68752 8.26703L9.30568 2.64887L9.41506 2.54535ZM4.4297 9.01019C3.99658 9.44234 3.69398 9.96492 3.56252 10.5512L3.56154 10.5541L2.99513 13.0063L5.45607 12.4418C6.02206 12.3102 6.56957 12.0068 6.99513 11.558L7.00392 11.5483L11.5254 7.02582L8.96877 4.46918L4.4297 9.01019ZM12.5986 3.38422C11.9258 2.69135 10.7787 2.66298 10.0479 3.39203L10.0469 3.39105L9.71193 3.72602L12.2686 6.28266L12.6045 5.94769C13.3406 5.21146 13.3067 4.06829 12.6113 3.39691L12.5986 3.38422Z" fill="currentColor"/>`,
});

export const PencilLight16Icon = createIconComponent(pencilLight16);
