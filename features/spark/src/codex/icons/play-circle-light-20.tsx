import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const playCircleLight20 = defineIconAsset({
  name: "play-circle-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 1.834961, y: 1.834961, width: 16.330078, height: 16.330078 },
    visualBounds: { x: 1.834961, y: 1.834961, width: 16.330078, height: 16.330078 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "circular",
    bounds: { x: 1.834961, y: 1.834961, width: 16.330078, height: 16.330078 },
    center: { x: 10, y: 10 },
    insets: { top: 1.834961, right: 1.834961, bottom: 1.834961, left: 1.834961 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10, y: 10 },
      foreground: { x: 10, y: 10 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M7.75977 7.54297C7.75998 6.91799 8.4051 6.52185 8.95117 6.7666L9.05859 6.82422L13.0596 9.33301C13.5895 9.66574 13.589 10.4383 13.0586 10.7705L9.05859 13.2744C8.49362 13.628 7.75987 13.2221 7.75977 12.5557V7.54297Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M10 1.83496C14.5094 1.83496 18.165 5.49059 18.165 10C18.165 14.5094 14.5094 18.165 10 18.165C5.49059 18.165 1.83496 14.5094 1.83496 10C1.83496 5.49059 5.49059 1.83496 10 1.83496ZM10 3.16504C6.22513 3.16504 3.16504 6.22513 3.16504 10C3.16504 13.7749 6.22513 16.835 10 16.835C13.7749 16.835 16.835 13.7749 16.835 10C16.835 6.22513 13.7749 3.16504 10 3.16504Z" fill="currentColor"/>`,
});

export const PlayCircleLight20Icon = createIconComponent(playCircleLight20);
