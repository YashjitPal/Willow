import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const playLight20 = defineIconAsset({
  name: "play-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 4.334961, y: 2.696289, width: 12.840446, height: 14.675537 },
    visualBounds: { x: 4.334961, y: 2.696289, width: 12.840446, height: 14.675537 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 4.334961, y: 2.696289, width: 12.840446, height: 14.675537 },
    center: { x: 10.755184, y: 10.034058 },
    insets: { top: 2.696289, right: 2.824593, bottom: 2.628174, left: 4.334961 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10.755184, y: 10.034058 },
      foreground: { x: 10.755184, y: 10.034058 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M5.41602 2.90729C5.99952 2.6251 6.75183 2.60101 7.38574 2.98835L7.38477 2.98932L16.1787 8.34186L16.2988 8.42096C17.5052 9.2712 17.4666 11.1487 16.1816 11.9327L16.1709 11.9395L16.1699 11.9385L7.375 17.087L7.37402 17.086C6.74243 17.4664 5.99614 17.4418 5.41602 17.1612C4.86336 16.8938 4.39667 16.3583 4.34082 15.6397L4.33496 15.4942V4.57428C4.3349 3.78256 4.82669 3.19237 5.41602 2.90729ZM5.66504 15.4942C5.66499 15.6822 5.77425 15.857 5.99512 15.9639C6.22208 16.0737 6.49007 16.069 6.69238 15.9454L6.70312 15.9385L15.4902 10.796C15.9646 10.505 15.9637 9.76785 15.4883 9.47858L15.4873 9.4776L6.69336 4.12409L6.69238 4.12311C6.49008 3.9995 6.22206 3.9948 5.99512 4.10456C5.77418 4.21145 5.66499 4.38625 5.66504 4.57428V15.4942Z" fill="currentColor"/>`,
});

export const PlayLight20Icon = createIconComponent(playLight20);
