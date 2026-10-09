import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const magnifyingGlassLgLight16 = defineIconAsset({
  name: "magnifying-glass-lg-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 1.970062, y: 1.910156, width: 12.226837, height: 12.283203 },
    visualBounds: { x: 1.970062, y: 1.910156, width: 12.226837, height: 12.283203 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.970062, y: 1.910156, width: 12.226837, height: 12.283203 },
    center: { x: 8.083481, y: 8.051758 },
    insets: { top: 1.910156, right: 1.803101, bottom: 1.806641, left: 1.970062 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8.083481, y: 8.051758 },
      foreground: { x: 8.083481, y: 8.051758 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M7.32849 1.91016C10.2877 1.91016 12.6867 4.30938 12.6869 7.26855C12.6869 8.57363 12.2192 9.7688 11.4437 10.6982L14.0433 13.2979C14.2481 13.5028 14.2481 13.8351 14.0433 14.04C13.8384 14.245 13.5062 14.2449 13.3011 14.04L10.6957 11.4346C9.77536 12.1793 8.60462 12.627 7.32849 12.627C4.36931 12.6268 1.97009 10.2278 1.97009 7.26855C1.97027 4.30949 4.36942 1.91033 7.32849 1.91016ZM7.32849 2.96094C4.94932 2.96111 3.02105 4.88939 3.02087 7.26855C3.02087 9.64787 4.94921 11.577 7.32849 11.5771C9.70792 11.5771 11.6371 9.64798 11.6371 7.26855C11.6369 4.88928 9.70781 2.96094 7.32849 2.96094Z" fill="currentColor"/>`,
});

export const MagnifyingGlassLgLight16Icon = createIconComponent(magnifyingGlassLgLight16);
