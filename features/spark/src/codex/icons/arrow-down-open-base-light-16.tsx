import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const arrowDownOpenBaseLight16 = defineIconAsset({
  name: "arrow-down-open-base-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 2.141235, y: 2.141113, width: 11.716797, height: 11.717773 },
    visualBounds: { x: 2.141235, y: 2.141113, width: 11.716797, height: 11.717773 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.141235, y: 2.141113, width: 11.716797, height: 11.717773 },
    center: { x: 7.999634, y: 7.999999 },
    insets: { top: 2.141113, right: 2.141968, bottom: 2.141114, left: 2.141235 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 7.999634, y: 7.999999 },
      foreground: { x: 7.999634, y: 7.999999 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M13.3336 8.14209C13.6234 8.14227 13.858 8.37764 13.858 8.66748V11.2007C13.8578 12.6686 12.6678 13.8589 11.1998 13.8589H4.80042C3.33242 13.8589 2.1415 12.6686 2.14124 11.2007V8.66748C2.14124 8.37753 2.37668 8.14209 2.66663 8.14209C2.95658 8.14209 3.19202 8.37753 3.19202 8.66748V11.2007C3.19228 12.0887 3.91232 12.8091 4.80042 12.8091H11.1998C12.0879 12.8091 12.808 12.0887 12.8082 11.2007V8.66748C12.8082 8.37753 13.0437 8.14209 13.3336 8.14209Z" fill="currentColor"/> <path d="M7.99963 2.14111C8.28958 2.14111 8.52502 2.37655 8.52502 2.6665V8.23291L10.4625 6.29541C10.6675 6.09069 10.9997 6.09069 11.2047 6.29541C11.4093 6.50038 11.4094 6.83266 11.2047 7.0376L8.60706 9.63525L8.54163 9.69385C8.22703 9.95044 7.77327 9.95034 7.45862 9.69385L7.39319 9.63525L4.79553 7.0376C4.59079 6.83261 4.59075 6.50037 4.79553 6.29541C5.0005 6.09069 5.33275 6.09069 5.53772 6.29541L7.47424 8.23193V2.6665C7.47424 2.37667 7.70984 2.14129 7.99963 2.14111Z" fill="currentColor"/>`,
});

export const ArrowDownOpenBaseLight16Icon = createIconComponent(arrowDownOpenBaseLight16);
