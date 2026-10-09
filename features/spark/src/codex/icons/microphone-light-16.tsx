import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const microphoneLight16 = defineIconAsset({
  name: "microphone-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 2.529297, y: 0.974609, width: 10.941162, height: 14.133789 },
    visualBounds: { x: 2.529297, y: 0.974609, width: 10.941162, height: 14.133789 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.529297, y: 0.974609, width: 10.941162, height: 14.133789 },
    center: { x: 7.999878, y: 8.041503 },
    insets: { top: 0.974609, right: 2.529541, bottom: 0.891602, left: 2.529297 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 7.999878, y: 8.041503 },
      foreground: { x: 7.999878, y: 8.041503 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M12.4584 8.96973C12.5671 8.70121 12.8734 8.57227 13.142 8.68066C13.4107 8.78946 13.5408 9.09549 13.432 9.36426C12.6258 11.3552 10.7559 12.8025 8.52577 13.001V14.583C8.52577 14.8729 8.29021 15.1083 8.00038 15.1084C7.71043 15.1084 7.47499 14.873 7.47499 14.583V13.001C5.2445 12.8028 3.374 11.3555 2.56776 9.36426C2.45908 9.09577 2.58862 8.78975 2.85682 8.68066C3.12547 8.57192 3.4315 8.7012 3.54041 8.96973C4.25323 10.7306 5.97877 11.9715 7.99256 11.9746H8.00624C10.0204 11.972 11.7453 10.7308 12.4584 8.96973Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M8.00038 0.974609C9.76293 0.974785 11.1918 2.40439 11.1918 4.16699V7.15625C11.1915 8.91863 9.76277 10.3475 8.00038 10.3477C6.23772 10.3476 4.80799 8.91794 4.80799 7.15527V4.16699C4.80799 2.40432 6.23772 0.974675 8.00038 0.974609ZM8.00038 2.02539C6.81762 2.02546 5.85877 2.98422 5.85877 4.16699V7.15527C5.85877 8.33804 6.81762 9.29779 8.00038 9.29785C9.18287 9.29768 10.1417 8.33873 10.142 7.15625V4.16699C10.142 2.98429 9.18304 2.02557 8.00038 2.02539Z" fill="currentColor"/>`,
});

export const MicrophoneLight16Icon = createIconComponent(microphoneLight16);
