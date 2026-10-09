import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const envelopeRegular32 = defineIconAsset({
  name: "envelope-regular-32",
  canvas: {
    width: 32,
    height: 32,
    viewBox: "0 0 32 32",
    frame: { x: 0, y: 0, width: 32, height: 32 },
    inkBounds: { x: 2.25, y: 4.75, width: 27.5, height: 22.5 },
    visualBounds: { x: 2.25, y: 4.75, width: 27.5, height: 22.5 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.25, y: 4.75, width: 27.5, height: 22.5 },
    center: { x: 16, y: 16 },
    insets: { top: 4.75, right: 2.25, bottom: 4.75, left: 2.25 },
    anchors: {
      frame: { x: 16, y: 16 },
      ink: { x: 16, y: 16 },
      foreground: { x: 16, y: 16 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M24.7002 4.75C27.4891 4.75011 29.7499 7.01092 29.75 9.7998V22.2002C29.7499 24.9891 27.4891 27.2499 24.7002 27.25H7.2998C4.51092 27.2499 2.25011 24.9891 2.25 22.2002V9.7998C2.25011 7.01092 4.51092 4.75011 7.2998 4.75H24.7002ZM4.75 22.2002C4.75011 23.6084 5.89163 24.7499 7.2998 24.75H24.7002C26.1084 24.7499 27.2499 23.6084 27.25 22.2002V11.9072L18.7568 17.9561C17.3146 18.9831 15.3866 19.0083 13.918 18.0195L4.75 11.8457V22.2002ZM7.2998 7.25C6.1957 7.25008 5.25792 7.95274 4.90332 8.93457L15.3145 15.9453C15.9191 16.3524 16.7128 16.3427 17.3066 15.9199L27.0996 8.94434C26.7477 7.95748 25.8079 7.25008 24.7002 7.25H7.2998Z" fill="currentColor"/>`,
});

export const EnvelopeRegular32Icon = createIconComponent(envelopeRegular32);
