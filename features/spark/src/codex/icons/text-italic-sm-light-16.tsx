import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const textItalicSmLight16 = defineIconAsset({
  name: "text-italic-sm-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 5.130493, y: 3.810547, width: 5.740234, height: 8.379883 },
    visualBounds: { x: 5.130493, y: 3.810547, width: 5.740234, height: 8.379883 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 5.130493, y: 3.810547, width: 5.740234, height: 8.379883 },
    center: { x: 8.00061, y: 8.000488 },
    insets: { top: 3.810547, right: 5.129273, bottom: 3.80957, left: 5.130493 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8.00061, y: 8.000488 },
      foreground: { x: 8.00061, y: 8.000488 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M10.4533 3.81055C10.7099 3.81061 10.9052 4.03724 10.8654 4.28613C10.8335 4.48552 10.6586 4.63373 10.4533 4.63379H9.0754L9.06857 4.6748L7.87228 11.3096L7.86154 11.3682H9.10275C9.3614 11.3682 9.55713 11.5982 9.51388 11.8486C9.47973 12.0457 9.30603 12.1904 9.10275 12.1904H5.54708C5.28945 12.1904 5.09448 11.9626 5.13595 11.7129C5.16904 11.5146 5.34278 11.3682 5.54708 11.3682H6.92111L6.92892 11.3271L8.12521 4.69238L8.13497 4.63379H6.89669C6.63899 4.63379 6.44394 4.40506 6.48556 4.15527C6.51865 3.957 6.69239 3.81055 6.89669 3.81055H10.4533Z" fill="currentColor"/>`,
});

export const TextItalicSmLight16Icon = createIconComponent(textItalicSmLight16);
