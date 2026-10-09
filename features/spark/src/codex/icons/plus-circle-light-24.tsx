import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const plusCircleLight24 = defineIconAsset({
  name: "plus-circle-light-24",
  canvas: {
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    frame: { x: 0, y: 0, width: 24, height: 24 },
    inkBounds: { x: 2.25, y: 2.25, width: 19.5, height: 19.5 },
    visualBounds: { x: 2.25, y: 2.25, width: 19.5, height: 19.5 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "circular",
    bounds: { x: 2.25, y: 2.25, width: 19.5, height: 19.5 },
    center: { x: 12, y: 12 },
    insets: { top: 2.25, right: 2.25, bottom: 2.25, left: 2.25 },
    anchors: {
      frame: { x: 12, y: 12 },
      ink: { x: 12, y: 12 },
      foreground: { x: 12, y: 12 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M11.9746 7.4873C12.3887 7.48744 12.7246 7.82317 12.7246 8.2373V11.2637H15.75C16.1642 11.2637 16.5 11.5995 16.5 12.0137C16.5 12.4279 16.1642 12.7637 15.75 12.7637H12.7246V15.7891C12.7246 16.2032 12.3887 16.5389 11.9746 16.5391C11.5604 16.5391 11.2246 16.2033 11.2246 15.7891V12.7637H8.19824C7.78414 12.7635 7.44824 12.4278 7.44824 12.0137C7.44824 11.5995 7.78414 11.2638 8.19824 11.2637H11.2246V8.2373C11.2246 7.82309 11.5604 7.4873 11.9746 7.4873Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2.25C17.3848 2.25 21.75 6.61522 21.75 12C21.75 17.3848 17.3848 21.75 12 21.75C6.61522 21.75 2.25 17.3848 2.25 12C2.25 6.61522 6.61522 2.25 12 2.25ZM12 3.75C7.44365 3.75 3.75 7.44365 3.75 12C3.75 16.5563 7.44365 20.25 12 20.25C16.5563 20.25 20.25 16.5563 20.25 12C20.25 7.44365 16.5563 3.75 12 3.75Z" fill="currentColor"/>`,
});

export const PlusCircleLight24Icon = createIconComponent(plusCircleLight24);
