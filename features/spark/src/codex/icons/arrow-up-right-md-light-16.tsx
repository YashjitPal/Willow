import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const arrowUpRightMdLight16 = defineIconAsset({
  name: "arrow-up-right-md-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 4.153076, y: 4.802246, width: 7.059326, height: 7.049316 },
    visualBounds: { x: 4.153076, y: 4.802246, width: 7.059326, height: 7.049316 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 4.153076, y: 4.802246, width: 7.059326, height: 7.049316 },
    center: { x: 7.682739, y: 8.326904 },
    insets: { top: 4.802246, right: 4.787598, bottom: 4.148438, left: 4.153076 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 7.682739, y: 8.326904 },
      foreground: { x: 7.682739, y: 8.326904 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M10.5874 4.80225L10.7144 4.81494C10.9582 4.86507 11.1498 5.05739 11.1997 5.30127L11.2124 5.42725V10.0415C11.2123 10.3313 10.9778 10.5658 10.688 10.5659C10.3982 10.5659 10.1627 10.3313 10.1626 10.0415V6.58447L5.04935 11.6987C4.84434 11.9034 4.51209 11.9025 4.30717 11.6978C4.10225 11.4928 4.1015 11.1606 4.30619 10.9556L9.4097 5.85205H5.97318C5.68352 5.85171 5.44877 5.6164 5.44877 5.32666C5.44908 5.03719 5.68371 4.80258 5.97318 4.80225H10.5874Z" fill="currentColor"/>`,
});

export const ArrowUpRightMdLight16Icon = createIconComponent(arrowUpRightMdLight16);
