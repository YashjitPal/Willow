import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const pinFillLight16 = defineIconAsset({
  name: "pin-fill-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 1.628906, y: 1.470703, width: 12.861969, height: 12.900391 },
    visualBounds: { x: 1.628906, y: 1.470703, width: 12.861969, height: 12.900391 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.628906, y: 1.470703, width: 12.861969, height: 12.900391 },
    center: { x: 8.059891, y: 7.920899 },
    insets: { top: 1.470703, right: 1.509125, bottom: 1.628906, left: 1.628906 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8.059891, y: 7.920899 },
      foreground: { x: 8.059891, y: 7.920899 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M8.69824 2.2735C9.31106 1.36065 10.551 1.2278 11.3721 1.86725L11.5303 2.00592L11.5332 2.00788L13.9766 4.42292L13.9785 4.42487C14.4053 4.85165 14.5365 5.42185 14.4775 5.93073C14.4193 6.43251 14.1705 6.93178 13.7588 7.24909L13.752 7.25495L13.7441 7.26081L11.3291 8.98542C11.1632 9.10408 11.0477 9.28168 11.0068 9.48151L10.4775 12.0723L10.4746 12.0889L10.4707 12.1046C10.2775 12.8194 9.76585 13.4028 9.10547 13.6299C8.42237 13.8647 7.6581 13.6908 7.05664 13.045L5.36328 11.378L2.37109 14.3712L1.62891 13.629L4.61523 10.6417L3.01953 9.0694C2.43146 8.49816 2.23202 7.72081 2.42773 7.02741C2.62416 6.33218 3.20146 5.7772 4.03418 5.61432L6.51465 5.04206C6.70981 4.99696 6.88156 4.8812 6.99609 4.71686L8.69824 2.2735Z" fill="currentColor"/>`,
});

export const PinFillLight16Icon = createIconComponent(pinFillLight16);
