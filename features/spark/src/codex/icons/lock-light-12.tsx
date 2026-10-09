import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const lockLight12 = defineIconAsset({
  name: "lock-light-12",
  canvas: {
    width: 12,
    height: 12,
    viewBox: "0 0 12 12",
    frame: { x: 0, y: 0, width: 12, height: 12 },
    inkBounds: { x: 1.599609, y: 1.099609, width: 8.800781, height: 9.800781 },
    visualBounds: { x: 1.599609, y: 1.099609, width: 8.800781, height: 9.800781 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.599609, y: 1.099609, width: 8.800781, height: 9.800781 },
    center: { x: 6, y: 6 },
    insets: { top: 1.099609, right: 1.59961, bottom: 1.09961, left: 1.599609 },
    anchors: {
      frame: { x: 6, y: 6 },
      ink: { x: 6, y: 6 },
      foreground: { x: 6, y: 6 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M6 6.09961C6.49706 6.09961 6.90039 6.50294 6.90039 7C6.90039 7.3531 6.69648 7.65815 6.40039 7.80566V8.5C6.40039 8.72091 6.22091 8.90039 6 8.90039C5.77909 8.90039 5.59961 8.72091 5.59961 8.5V7.80566C5.30352 7.65815 5.09961 7.3531 5.09961 7C5.09961 6.50294 5.50294 6.09961 6 6.09961Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M6 1.09961C7.60163 1.09961 8.90039 2.39837 8.90039 4V4.16504C9.7625 4.38744 10.4002 5.16819 10.4004 6.09961V8.90039C10.4002 10.0047 9.50465 10.9002 8.40039 10.9004H3.59961C2.49535 10.9002 1.59982 10.0047 1.59961 8.90039V6.09961C1.59979 5.16819 2.2375 4.38744 3.09961 4.16504V4C3.09961 2.39837 4.39837 1.09961 6 1.09961ZM3.59961 4.90039C2.93718 4.9006 2.4006 5.43718 2.40039 6.09961V8.90039C2.4006 9.56282 2.93718 10.0994 3.59961 10.0996H8.40039C9.06282 10.0994 9.5994 9.56282 9.59961 8.90039V6.09961C9.5994 5.43718 9.06282 4.9006 8.40039 4.90039H3.59961ZM6 1.90039C4.8402 1.90039 3.90039 2.8402 3.90039 4V4.09961H8.09961V4C8.09961 2.8402 7.1598 1.90039 6 1.90039Z" fill="currentColor"/>`,
});

export const LockLight12Icon = createIconComponent(lockLight12);
