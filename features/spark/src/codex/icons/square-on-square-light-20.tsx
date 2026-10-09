import { Icon, type IconProps } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const squareOnSquareLight20 = defineIconAsset({
  name: "square-on-square-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 1.834961, y: 1.785156, width: 16.330078, height: 16.330078 },
    visualBounds: { x: 1.834961, y: 1.785156, width: 16.330078, height: 16.330078 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.834961, y: 1.785156, width: 16.330078, height: 16.330078 },
    center: { x: 10, y: 9.950195 },
    insets: { top: 1.785156, right: 1.834961, bottom: 1.884766, left: 1.834961 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10, y: 9.950195 },
      foreground: { x: 10, y: 9.950195 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M15.1006 1.78516C16.793 1.78556 18.165 3.15808 18.165 4.85059V10.8838C18.1649 12.5762 16.7929 13.9478 15.1006 13.9482H13.998V15.0508C13.9976 16.7431 12.626 18.1151 10.9336 18.1152H4.90039C3.20789 18.1152 1.83537 16.7432 1.83496 15.0508V9.01758C1.83496 7.32482 3.20764 5.95215 4.90039 5.95215H6.00195V4.85059C6.00195 3.15783 7.37463 1.78516 9.06738 1.78516H15.1006ZM4.90039 7.28223C3.94218 7.28223 3.16504 8.05936 3.16504 9.01758V15.0508C3.16544 16.0087 3.94243 16.7852 4.90039 16.7852H10.9336C11.8914 16.785 12.6676 16.0086 12.668 15.0508V9.01758C12.668 8.05945 11.8917 7.28237 10.9336 7.28223H4.90039ZM9.06738 3.11523C8.10917 3.11523 7.33203 3.89237 7.33203 4.85059V5.95215H10.9336C12.6262 5.95229 13.998 7.32491 13.998 9.01758V12.6182H15.1006C16.0584 12.6178 16.8348 11.8416 16.835 10.8838V4.85059C16.835 3.89262 16.0585 3.11564 15.1006 3.11523H9.06738Z" fill="currentColor"/>`,
});

export function SquareOnSquareLight20Icon(props: Omit<IconProps, "asset">) {
  return <Icon asset={squareOnSquareLight20} {...props} />;
}
