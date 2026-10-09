import { Icon, type IconProps } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const pauseCircleLight20 = defineIconAsset({
  name: "pause-circle-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 1.866211, y: 1.866211, width: 16.267578, height: 16.267578 },
    visualBounds: { x: 1.866211, y: 1.866211, width: 16.267578, height: 16.267578 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "circular",
    bounds: { x: 1.866211, y: 1.866211, width: 16.267578, height: 16.267578 },
    center: { x: 10, y: 10 },
    insets: { top: 1.866211, right: 1.866211, bottom: 1.866211, left: 1.866211 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10, y: 10 },
      foreground: { x: 10, y: 10 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M8.68848 7.31445C8.95409 7.31472 9.16895 7.53023 9.16895 7.7959V12.2031C9.16886 12.4687 8.95403 12.6843 8.68848 12.6846H7.74902C7.48336 12.6844 7.26767 12.4688 7.26758 12.2031V7.7959C7.26758 7.53015 7.4833 7.31459 7.74902 7.31445H8.68848Z" fill="currentColor"/> <path d="M12.2451 7.31445C12.5107 7.31472 12.7256 7.53023 12.7256 7.7959V12.2031C12.7255 12.4687 12.5107 12.6843 12.2451 12.6846H11.3057C11.0399 12.6845 10.8243 12.4688 10.8242 12.2031V7.7959C10.8242 7.53011 11.0399 7.31452 11.3057 7.31445H12.2451Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M10 1.86621C14.4919 1.86621 18.1338 5.50808 18.1338 10C18.1338 14.4919 14.4919 18.1338 10 18.1338C5.50808 18.1338 1.86621 14.4919 1.86621 10C1.86621 5.50808 5.50808 1.86621 10 1.86621ZM10 3.13379C6.20764 3.13379 3.13379 6.20764 3.13379 10C3.13379 13.7924 6.20764 16.8662 10 16.8662C13.7924 16.8662 16.8662 13.7924 16.8662 10C16.8662 6.20764 13.7924 3.13379 10 3.13379Z" fill="currentColor"/>`,
});

export function PauseCircleLight20Icon(props: Omit<IconProps, "asset">) {
  return <Icon asset={pauseCircleLight20} {...props} />;
}
