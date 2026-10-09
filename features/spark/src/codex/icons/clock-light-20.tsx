import { Icon, type IconProps } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const clockLight20 = defineIconAsset({
  name: "clock-light-20",
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
  body: `<path d="M10 5.16895C10.3673 5.16895 10.665 5.46672 10.665 5.83398V9.82812C10.6649 10.1147 10.5513 10.3901 10.3486 10.5928L8.3877 12.5547C8.12804 12.814 7.70591 12.8141 7.44629 12.5547C7.18668 12.2951 7.18687 11.873 7.44629 11.6133L9.33496 9.72461V5.83398C9.33496 5.46685 9.63291 5.16916 10 5.16895Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M10 1.83496C14.5094 1.83496 18.165 5.49059 18.165 10C18.165 14.5094 14.5094 18.165 10 18.165C5.49059 18.165 1.83496 14.5094 1.83496 10C1.83496 5.49059 5.49059 1.83496 10 1.83496ZM10 3.16504C6.22513 3.16504 3.16504 6.22513 3.16504 10C3.16504 13.7749 6.22513 16.835 10 16.835C13.7749 16.835 16.835 13.7749 16.835 10C16.835 6.22513 13.7749 3.16504 10 3.16504Z" fill="currentColor"/>`,
});

export function ClockLight20Icon(props: Omit<IconProps, "asset">) {
  return <Icon asset={clockLight20} {...props} />;
}
