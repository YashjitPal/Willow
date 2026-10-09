import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const chevronUpRightChevronDownLeftSmLight16 = defineIconAsset({
  name: "chevron-up-right-chevron-down-left-sm-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 4.132813, y: 4.149414, width: 7.734375, height: 7.701172 },
    visualBounds: { x: 4.132813, y: 4.149414, width: 7.734375, height: 7.701172 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 4.132813, y: 4.149414, width: 7.734375, height: 7.701172 },
    center: { x: 8, y: 8 },
    insets: { top: 4.149414, right: 4.132812, bottom: 4.149414, left: 4.132813 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8, y: 8 },
      foreground: { x: 8, y: 8 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M4.6582 7.83984C4.94815 7.83984 5.18359 8.07528 5.18359 8.36523V10.7998H7.67676C7.96671 10.7998 8.20215 11.0352 8.20215 11.3252C8.20215 11.6151 7.96671 11.8506 7.67676 11.8506H4.9082C4.48018 11.8506 4.13281 11.5032 4.13281 11.0752V8.36523C4.13281 8.07528 4.36825 7.83984 4.6582 7.83984Z" fill="currentColor"/> <path d="M11.0918 4.14941C11.5197 4.14955 11.8672 4.49687 11.8672 4.9248V7.63477C11.8672 7.92463 11.6316 8.16002 11.3418 8.16016C11.0518 8.16016 10.8164 7.92472 10.8164 7.63477V5.2002H8.32324C8.03329 5.2002 7.79785 4.96475 7.79785 4.6748C7.79785 4.38486 8.03329 4.14941 8.32324 4.14941H11.0918Z" fill="currentColor"/>`,
});

export const ChevronUpRightChevronDownLeftSmLight16Icon = createIconComponent(chevronUpRightChevronDownLeftSmLight16);
