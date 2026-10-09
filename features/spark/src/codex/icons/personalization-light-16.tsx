import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const personalizationLight16 = defineIconAsset({
  name: "personalization-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 1.474609, y: 1.474609, width: 13.050781, height: 13.050781 },
    visualBounds: { x: 1.474609, y: 1.474609, width: 13.050781, height: 13.050781 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "circular",
    bounds: { x: 1.474609, y: 1.474609, width: 13.050781, height: 13.050781 },
    center: { x: 8, y: 8 },
    insets: { top: 1.474609, right: 1.47461, bottom: 1.47461, left: 1.474609 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8, y: 8 },
      foreground: { x: 8, y: 8 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M10.7939 8.15723C11.0751 8.22756 11.2459 8.51278 11.1758 8.79395C10.9829 9.56501 10.5871 10.1775 10.0176 10.5918C9.45181 11.0032 8.75339 11.1924 8 11.1924C7.71018 11.1924 7.47483 10.9568 7.47461 10.667C7.47461 10.377 7.71005 10.1416 8 10.1416C8.57975 10.1416 9.04857 9.99728 9.39941 9.74219C9.74618 9.48999 10.0167 9.10162 10.1572 8.54004C10.2275 8.2588 10.5127 8.087 10.7939 8.15723Z" fill="currentColor"/> <path d="M6.90039 5.03516C7.06472 4.79669 7.39211 4.7364 7.63086 4.90039C7.86962 5.06459 7.92958 5.39198 7.76562 5.63086L6.3916 7.62793L7.42773 7.81641C7.71256 7.86845 7.90108 8.14185 7.84961 8.42676C7.79774 8.71203 7.52453 8.90148 7.23926 8.84961L5.91309 8.6084C5.30046 8.49698 5.0066 7.79046 5.35938 7.27734L6.90039 5.03516Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M8 1.47461C11.6037 1.47461 14.5254 4.39634 14.5254 8C14.5254 11.6037 11.6037 14.5254 8 14.5254C4.39634 14.5254 1.47461 11.6037 1.47461 8C1.47461 4.39634 4.39634 1.47461 8 1.47461ZM8 2.52539C4.97624 2.52539 2.52539 4.97624 2.52539 8C2.52539 11.0238 4.97624 13.4746 8 13.4746C11.0238 13.4746 13.4746 11.0238 13.4746 8C13.4746 4.97624 11.0238 2.52539 8 2.52539Z" fill="currentColor"/>`,
});

export const PersonalizationLight16Icon = createIconComponent(personalizationLight16);
