import { Icon, type IconProps } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const clockLight24 = defineIconAsset({
  name: "clock-light-24",
  canvas: {
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    frame: { x: 0, y: 0, width: 24, height: 24 },
    inkBounds: { x: 2.25, y: 2.25, width: 19.5, height: 19.5 },
    visualBounds: { x: 2.25, y: 2.25, width: 19.5, height: 19.5 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "circular",
    bounds: { x: 2.25, y: 2.25, width: 19.5, height: 19.5 },
    center: { x: 12, y: 12 },
    insets: { top: 2.25, right: 2.25, bottom: 2.25, left: 2.25 },
    anchors: {
      frame: { x: 12, y: 12 },
      ink: { x: 12, y: 12 },
      foreground: { x: 12, y: 12 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M12 6.25C12.4142 6.25003 12.75 6.58581 12.75 7V11.793C12.75 12.1244 12.6182 12.4424 12.3838 12.6768L10.0303 15.0303C9.73739 15.3232 9.26262 15.3231 8.96973 15.0303C8.67683 14.7374 8.67683 14.2626 8.96973 13.9697L11.25 11.6895V7C11.25 6.58579 11.5858 6.25 12 6.25Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2.25C17.3848 2.25 21.75 6.61522 21.75 12C21.75 17.3848 17.3848 21.75 12 21.75C6.61522 21.75 2.25 17.3848 2.25 12C2.25 6.61522 6.61522 2.25 12 2.25ZM12 3.75C7.44365 3.75 3.75 7.44365 3.75 12C3.75 16.5563 7.44365 20.25 12 20.25C16.5563 20.25 20.25 16.5563 20.25 12C20.25 7.44365 16.5563 3.75 12 3.75Z" fill="currentColor"/>`,
});

export function ClockLight24Icon(props: Omit<IconProps, "asset">) {
  return <Icon asset={clockLight24} {...props} />;
}
