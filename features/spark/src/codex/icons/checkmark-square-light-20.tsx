import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const checkmarkSquareLight20 = defineIconAsset({
  name: "checkmark-square-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 2.501709, y: 2.501709, width: 14.99707, height: 14.99707 },
    visualBounds: { x: 2.501709, y: 2.501709, width: 14.99707, height: 14.99707 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.501709, y: 2.501709, width: 14.99707, height: 14.99707 },
    center: { x: 10.000244, y: 10.000244 },
    insets: { top: 2.501709, right: 2.501221, bottom: 2.501221, left: 2.501709 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10.000244, y: 10.000244 },
      foreground: { x: 10.000244, y: 10.000244 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M12.2761 7.18823C12.4806 6.88318 12.8939 6.80109 13.199 7.00562C13.5038 7.21016 13.585 7.6235 13.3806 7.92847L9.94702 13.0505C9.61882 13.5399 8.91942 13.5964 8.51733 13.1658L6.6853 11.2019C6.43483 10.9334 6.4492 10.512 6.71753 10.2615C6.98607 10.0109 7.40742 10.0261 7.65796 10.2947L9.13257 11.8757L12.2761 7.18823Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M14.4421 2.50171C16.1301 2.50192 17.4987 3.87036 17.4988 5.55835V14.4421C17.4986 16.13 16.13 17.4986 14.4421 17.4988H5.55835C3.87036 17.4987 2.50192 16.1301 2.50171 14.4421V5.55835C2.50174 3.87025 3.87025 2.50174 5.55835 2.50171H14.4421ZM5.55835 3.83179C4.60479 3.83182 3.83182 4.60479 3.83179 5.55835V14.4421C3.832 15.3955 4.6049 16.1687 5.55835 16.1687H14.4421C15.3954 16.1685 16.1685 15.3954 16.1687 14.4421V5.55835C16.1687 4.6049 15.3955 3.832 14.4421 3.83179H5.55835Z" fill="currentColor"/>`,
});

export const CheckmarkSquareLight20Icon = createIconComponent(checkmarkSquareLight20);
