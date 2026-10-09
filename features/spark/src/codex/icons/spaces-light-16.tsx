import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const spacesLight16 = defineIconAsset({
  name: "spaces-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
  },
  paint: { kind: "monochrome" },
  optical: { shape: "non-circular" },
  capabilities: ["icon"],
  body: `<defs><mask id="back" maskUnits="userSpaceOnUse" x="0" y="0" width="16" height="16"><path d="M0 0h16v16H0z" fill="white"/><path d="M7.7 3.55c.67-.05 1.32.18 1.83.62l1.58 1.38c.5.44.82 1.06.86 1.73l.4 5.5a2.6 2.6 0 0 1-2.4 2.78l-5.97.42a2.6 2.6 0 0 1-2.78-2.4L.76 6.5a2.6 2.6 0 0 1 2.4-2.78l4.54-.17Z" fill="black" stroke="black" stroke-width="2.125"/></mask></defs><g transform="translate(1.85 1.35) scale(.8)"><path d="M6.9.7 12.6 1a2.1 2.1 0 0 1 1.96 2.31l-.6 7.16a2.1 2.1 0 0 1-2.3 1.94l-5.45-.46a2.1 2.1 0 0 1-1.92-2.28l.63-7.05A2.1 2.1 0 0 1 6.9.7Z" fill="none" stroke="currentColor" stroke-width="1.3125" mask="url(#back)"/><path d="M7.7 3.55c.67-.05 1.32.18 1.83.62l1.58 1.38c.5.44.82 1.06.86 1.73l.4 5.5a2.6 2.6 0 0 1-2.4 2.78l-5.97.42a2.6 2.6 0 0 1-2.78-2.4L.76 6.5a2.6 2.6 0 0 1 2.4-2.78l4.54-.17Zm.05.05.19 2.21c.07.8.56 1.12 1.26 1.06l2.06-.15" fill="none" stroke="currentColor" stroke-width="1.3125" stroke-linecap="round" stroke-linejoin="round"/></g>`,
});

export const SpacesLight16Icon = createIconComponent(spacesLight16);
