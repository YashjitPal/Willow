import { Icon, type IconProps } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const circleExclamationmarkLight20 = defineIconAsset({
  name: "circle-exclamationmark-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 1.834961, y: 1.834961, width: 16.330078, height: 16.330078 },
    visualBounds: { x: 1.834961, y: 1.834961, width: 16.330078, height: 16.330078 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "circular",
    bounds: { x: 1.834961, y: 1.834961, width: 16.330078, height: 16.330078 },
    center: { x: 10, y: 10 },
    insets: { top: 1.834961, right: 1.834961, bottom: 1.834961, left: 1.834961 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10, y: 10 },
      foreground: { x: 10, y: 10 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M11.0076 12.9014C11.0076 13.4704 10.5463 13.9317 9.97732 13.9317C9.4083 13.9317 8.94702 13.4704 8.94702 12.9014C8.94702 12.3324 9.4083 11.8711 9.97732 11.8711C10.5463 11.8711 11.0076 12.3324 11.0076 12.9014Z" fill="currentColor"/> <path d="M16.835 10C16.835 6.22513 13.7749 3.16504 10 3.16504C6.22513 3.16504 3.16504 6.22513 3.16504 10C3.16504 13.7749 6.22513 16.835 10 16.835C13.7749 16.835 16.835 13.7749 16.835 10ZM18.165 10C18.165 14.5094 14.5094 18.165 10 18.165C5.49059 18.165 1.83496 14.5094 1.83496 10C1.83496 5.49059 5.49059 1.83496 10 1.83496C14.5094 1.83496 18.165 5.49059 18.165 10Z" fill="currentColor"/> <path d="M9.31201 9.94196V6.39996C9.31201 6.03269 9.60978 5.73492 9.97705 5.73492C10.3443 5.73492 10.6421 6.03269 10.6421 6.39996V9.94196C10.6419 10.3091 10.3442 10.607 9.97705 10.607C9.60989 10.607 9.31219 10.3091 9.31201 9.94196Z" fill="currentColor"/>`,
});

export function CircleExclamationmarkLight20Icon(props: Omit<IconProps, "asset">) {
  return <Icon asset={circleExclamationmarkLight20} {...props} />;
}
