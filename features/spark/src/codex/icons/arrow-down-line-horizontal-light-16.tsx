import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const arrowDownLineHorizontalLight16 = defineIconAsset({
  name: "arrow-down-line-horizontal-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 2.307861, y: 2.141113, width: 11.383789, height: 11.717773 },
    visualBounds: { x: 2.307861, y: 2.141113, width: 11.383789, height: 11.717773 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.307861, y: 2.141113, width: 11.383789, height: 11.717773 },
    center: { x: 7.999756, y: 7.999999 },
    insets: { top: 2.141113, right: 2.30835, bottom: 2.141114, left: 2.307861 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 7.999756, y: 7.999999 },
      foreground: { x: 7.999756, y: 7.999999 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M13.1663 12.8081C13.4562 12.8081 13.6917 13.0435 13.6917 13.3335C13.6915 13.6233 13.4561 13.8589 13.1663 13.8589H2.83325C2.54341 13.8589 2.30803 13.6233 2.30786 13.3335C2.30786 13.0435 2.5433 12.8081 2.83325 12.8081H13.1663Z" fill="currentColor"/> <path d="M8.00024 2.14111C8.29004 2.14129 8.52563 2.37667 8.52563 2.6665V8.73096L10.9622 6.29541C11.1671 6.0906 11.4994 6.0906 11.7043 6.29541C11.9092 6.50039 11.9092 6.83261 11.7043 7.0376L8.72485 10.0171C8.32455 10.4172 7.67489 10.4173 7.27466 10.0171L4.29517 7.0376C4.09036 6.83262 4.09036 6.5004 4.29517 6.29541C4.50014 6.09044 4.83232 6.09054 5.03735 6.29541L7.47485 8.73291V2.6665C7.47485 2.37655 7.71029 2.14111 8.00024 2.14111Z" fill="currentColor"/>`,
});

export const ArrowDownLineHorizontalLight16Icon = createIconComponent(arrowDownLineHorizontalLight16);
