import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const paperclipLight20 = defineIconAsset({
  name: "paperclip-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 4.334961, y: 1.501709, width: 11.364258, height: 16.99707 },
    visualBounds: { x: 4.334961, y: 1.501709, width: 11.364258, height: 16.99707 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 4.334961, y: 1.501709, width: 11.364258, height: 16.99707 },
    center: { x: 10.01709, y: 10.000244 },
    insets: { top: 1.501709, right: 4.300781, bottom: 1.501221, left: 4.334961 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10.01709, y: 10.000244 },
      foreground: { x: 10.01709, y: 10.000244 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M7.66797 12.8337V5.49976C7.66814 3.24703 9.41421 1.50171 11.667 1.50171C13.9415 1.50188 15.6992 3.2664 15.6992 5.53882V12.822C15.6992 16.0485 13.217 18.4986 9.99902 18.4988C6.79025 18.4988 4.33513 16.042 4.33496 12.8337V7.16675C4.33496 6.79948 4.63273 6.50171 5 6.50171C5.36727 6.50171 5.66504 6.79948 5.66504 7.16675V12.8337C5.6652 15.3079 7.52525 17.1687 9.99902 17.1687C12.4909 17.1685 14.3691 15.3055 14.3691 12.822V5.53882C14.3691 3.99885 13.2048 2.83195 11.667 2.83179C10.1488 2.83179 8.99821 3.98157 8.99805 5.49976V12.8337C8.9982 13.4132 9.42053 13.8347 10 13.8347C10.5802 13.8347 11.0018 13.4139 11.002 12.8337V7.16675C11.002 6.79948 11.2997 6.50171 11.667 6.50171C12.0341 6.50188 12.332 6.79959 12.332 7.16675V12.8337C12.3319 14.1484 11.3147 15.1648 10 15.1648C8.68599 15.1648 7.66814 14.1477 7.66797 12.8337Z" fill="currentColor"/>`,
});

export const PaperclipLight20Icon = createIconComponent(paperclipLight20);
