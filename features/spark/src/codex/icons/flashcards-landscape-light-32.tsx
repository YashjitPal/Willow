import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const flashcardsLandscapeLight32 = defineIconAsset({
  name: "flashcards-landscape-light-32",
  canvas: {
    width: 32,
    height: 32,
    viewBox: "0 0 32 32",
    frame: { x: 0, y: 0, width: 32, height: 32 },
    inkBounds: { x: 1.806396, y: 2.287109, width: 28.299805, height: 27.521484 },
    visualBounds: { x: 1.806396, y: 2.287109, width: 28.299805, height: 27.521484 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.806396, y: 2.287109, width: 28.299805, height: 27.521484 },
    center: { x: 15.956298, y: 16.047851 },
    insets: { top: 2.287109, right: 1.893799, bottom: 2.191407, left: 1.806396 },
    anchors: {
      frame: { x: 16, y: 16 },
      ink: { x: 15.956298, y: 16.047851 },
      foreground: { x: 15.956298, y: 16.047851 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M8.57798 5.52197C8.96093 3.36408 11.0519 1.96844 13.2108 2.34911L26.7782 4.74169C28.9385 5.12261 30.4276 7.15172 30.0467 9.31201L28.0897 20.4067C27.8028 22.0338 26.5448 23.2273 25.0184 23.5552C25.2287 25.6644 23.6954 27.553 21.576 27.8511L7.93247 29.7681C5.76016 30.0734 3.71727 28.6035 3.41197 26.4311L1.84458 15.2739C1.53951 13.1018 3.09722 11.1261 5.26939 10.8208L7.67857 10.4819L8.57798 5.52197ZM19.1629 10.686L9.21861 12.0835L9.20005 12.1899L8.87876 12.1313L5.52036 12.604C4.28973 12.777 3.46686 13.8784 3.62779 15.0239L5.19517 26.1802C5.35616 27.3257 6.45095 28.1586 7.6815 27.9858L21.3251 26.0688C22.5556 25.8959 23.3785 24.7935 23.2176 23.6479L21.6493 12.4907C21.4882 11.3452 20.3936 10.5131 19.1629 10.686ZM12.8983 4.12255C11.6746 3.90678 10.5516 4.69938 10.3504 5.83837L10.3495 5.84228L9.5565 10.2173L18.9129 8.90283C21.085 8.59774 23.1269 10.0678 23.4325 12.2397L24.7704 21.7622C25.5571 21.5437 26.1736 20.9089 26.3172 20.0942L28.2743 8.99951C28.4751 7.86026 27.6895 6.73093 26.4657 6.51513L12.8983 4.12255Z" fill="currentColor"/>`,
});

export const FlashcardsLandscapeLight32Icon = createIconComponent(flashcardsLandscapeLight32);
