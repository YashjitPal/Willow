import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const voiceRegular16 = defineIconAsset({
  name: "voice-regular-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 2.25, y: 1.916748, width: 11.833984, height: 12.166992 },
    visualBounds: { x: 2.25, y: 1.916748, width: 11.833984, height: 12.166992 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.25, y: 1.916748, width: 11.833984, height: 12.166992 },
    center: { x: 8.166992, y: 8.000244 },
    insets: { top: 1.916748, right: 1.916016, bottom: 1.91626, left: 2.25 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8.166992, y: 8.000244 },
      foreground: { x: 8.166992, y: 8.000244 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M6.44434 1.91675C6.85855 1.91675 7.19434 2.25253 7.19434 2.66675V13.3337C7.19412 13.7478 6.85841 14.0837 6.44434 14.0837C6.03037 14.0836 5.69455 13.7477 5.69434 13.3337V2.66675C5.69434 2.25262 6.03023 1.91688 6.44434 1.91675Z" fill="currentColor"/> <path d="M9.88867 3.74976C10.3028 3.74976 10.6385 4.08565 10.6387 4.49976V11.1667C10.6385 11.5808 10.3028 11.9167 9.88867 11.9167C9.47468 11.9166 9.13885 11.5807 9.13867 11.1667V4.49976C9.1388 4.08574 9.47465 3.74989 9.88867 3.74976Z" fill="currentColor"/> <path d="M3 5.41675C3.41421 5.41675 3.75 5.75253 3.75 6.16675V9.83374C3.74982 10.2478 3.41411 10.5837 3 10.5837C2.58589 10.5837 2.25018 10.2478 2.25 9.83374V6.16675C2.25 5.75253 2.58579 5.41675 3 5.41675Z" fill="currentColor"/> <path d="M13.334 5.91675C13.748 5.91701 14.084 6.2527 14.084 6.66675V9.33374C14.0838 9.74764 13.7479 10.0835 13.334 10.0837C12.9199 10.0837 12.5842 9.7478 12.584 9.33374V6.66675C12.584 6.25253 12.9198 5.91675 13.334 5.91675Z" fill="currentColor"/>`,
});

export const VoiceRegular16Icon = createIconComponent(voiceRegular16);
