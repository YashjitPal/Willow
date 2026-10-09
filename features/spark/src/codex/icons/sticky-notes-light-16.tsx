import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const stickyNotesLight16 = defineIconAsset({
  name: "sticky-notes-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 2.141357, y: 2.142578, width: 11.716797, height: 11.716797 },
    visualBounds: { x: 2.141357, y: 2.142578, width: 11.716797, height: 11.716797 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.141357, y: 2.142578, width: 11.716797, height: 11.716797 },
    center: { x: 7.999756, y: 8.000977 },
    insets: { top: 2.142578, right: 2.141846, bottom: 2.140625, left: 2.141357 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 7.999756, y: 8.000977 },
      foreground: { x: 7.999756, y: 8.000977 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M11.2 2.14258C12.6044 2.14258 13.8582 3.16044 13.8582 4.5498V8.49023C13.8582 9.15977 13.5923 9.80188 13.1189 10.2754L10.2761 13.1191C9.80251 13.5928 9.15979 13.8594 8.48999 13.8594C7.26017 13.8593 6.03042 13.8594 4.80054 13.8594C3.39606 13.8594 2.14136 12.8405 2.14136 11.4512V4.5498C2.14136 3.16044 3.39606 2.14258 4.80054 2.14258H11.2ZM4.80054 3.19238C3.8486 3.19238 3.19214 3.85998 3.19214 4.5498V11.4512C3.19214 12.141 3.8486 12.8086 4.80054 12.8086C5.91408 12.8086 7.02774 12.8086 8.14136 12.8086V10.001C8.14136 8.97476 8.97358 8.14275 9.99976 8.14258H12.8083V4.5498C12.8083 3.85998 12.1519 3.19238 11.2 3.19238H4.80054ZM9.99976 9.19238C9.55348 9.19256 9.19214 9.55465 9.19214 10.001V12.6299C9.31649 12.5627 9.43224 12.4787 9.53394 12.377L12.3767 9.5332C12.4782 9.43167 12.5625 9.31641 12.6296 9.19238H9.99976Z" fill="currentColor"/>`,
});

export const StickyNotesLight16Icon = createIconComponent(stickyNotesLight16);
