import { Icon, type IconProps } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const clockLight16 = defineIconAsset({
  name: "clock-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 1.475098, y: 1.474609, width: 13.050781, height: 13.050781 },
    visualBounds: { x: 1.475098, y: 1.474609, width: 13.050781, height: 13.050781 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "circular",
    bounds: { x: 1.475098, y: 1.474609, width: 13.050781, height: 13.050781 },
    center: { x: 8.000488, y: 8 },
    insets: { top: 1.474609, right: 1.474121, bottom: 1.47461, left: 1.475098 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8.000488, y: 8 },
      foreground: { x: 8.000488, y: 8 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M8.00037 4.14209C8.29009 4.14235 8.52478 4.37769 8.52478 4.66748V7.86279C8.52464 8.0901 8.43446 8.30843 8.2738 8.46924L6.70447 10.0386C6.49954 10.2433 6.16728 10.2432 5.96228 10.0386C5.75731 9.8336 5.75742 9.50142 5.96228 9.29639L7.47498 7.78369V4.66748C7.47498 4.37753 7.71042 4.14209 8.00037 4.14209Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M8.00037 1.4751C11.604 1.4751 14.5258 4.39683 14.5258 8.00049C14.5258 11.6041 11.604 14.5259 8.00037 14.5259C4.39671 14.5259 1.47498 11.6041 1.47498 8.00049C1.47498 4.39683 4.39671 1.4751 8.00037 1.4751ZM8.00037 2.52588C4.97661 2.52588 2.52576 4.97673 2.52576 8.00049C2.52576 11.0242 4.97661 13.4751 8.00037 13.4751C11.0241 13.4751 13.475 11.0242 13.475 8.00049C13.475 4.97673 11.0241 2.52588 8.00037 2.52588Z" fill="currentColor"/>`,
});

export function ClockLight16Icon(props: Omit<IconProps, "asset">) {
  return <Icon asset={clockLight16} {...props} />;
}
