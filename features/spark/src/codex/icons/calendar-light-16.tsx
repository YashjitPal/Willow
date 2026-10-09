import { Icon, type IconProps } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const calendarLight16 = defineIconAsset({
  name: "calendar-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 1.814697, y: 1.474609, width: 12.370117, height: 12.71582 },
    visualBounds: { x: 1.814697, y: 1.474609, width: 12.370117, height: 12.71582 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.814697, y: 1.474609, width: 12.370117, height: 12.71582 },
    center: { x: 7.999756, y: 7.832519 },
    insets: { top: 1.474609, right: 1.815186, bottom: 1.809571, left: 1.814697 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 7.999756, y: 7.832519 },
      foreground: { x: 7.999756, y: 7.832519 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M10.6672 1.47461C10.957 1.47487 11.1926 1.71021 11.1926 2V2.47363H11.6604C13.0548 2.4738 14.1848 3.60461 14.1848 4.99902V11.666C14.1844 13.0601 13.0545 14.1903 11.6604 14.1904H4.34009C2.94584 14.1904 1.81514 13.0602 1.8147 11.666V4.99902C1.8147 3.60451 2.94557 2.47363 4.34009 2.47363H4.80786V2C4.80786 1.71005 5.0433 1.47461 5.33325 1.47461C5.6232 1.47461 5.85864 1.71005 5.85864 2V2.47363H10.1418V2C10.1418 1.71005 10.3773 1.47461 10.6672 1.47461ZM2.86548 7.52148V11.666C2.86592 12.4803 3.52574 13.1406 4.34009 13.1406H11.6604C12.4746 13.1405 13.1346 12.4802 13.135 11.666V7.52148H2.86548ZM4.34009 3.52441C3.52547 3.52441 2.86548 4.1844 2.86548 4.99902V6.4707H13.135V4.99902C13.135 4.18451 12.4749 3.52458 11.6604 3.52441H11.1926V4.33105C11.1926 4.62084 10.957 4.85618 10.6672 4.85645C10.3773 4.85645 10.1418 4.621 10.1418 4.33105V3.52441H5.85864V4.33105C5.85864 4.621 5.6232 4.85645 5.33325 4.85645C5.0433 4.85645 4.80786 4.621 4.80786 4.33105V3.52441H4.34009Z" fill="currentColor"/>`,
});

export function CalendarLight16Icon(props: Omit<IconProps, "asset">) {
  return <Icon asset={calendarLight16} {...props} />;
}
