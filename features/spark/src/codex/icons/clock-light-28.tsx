import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const clockLight28 = defineIconAsset({
  name: "clock-light-28",
  canvas: {
    width: 28,
    height: 28,
    viewBox: "0 0 28 28",
    frame: { x: 0, y: 0, width: 28, height: 28 },
    inkBounds: { x: 2.669922, y: 2.669922, width: 22.660156, height: 22.660156 },
    visualBounds: { x: 2.669922, y: 2.669922, width: 22.660156, height: 22.660156 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "circular",
    bounds: { x: 2.669922, y: 2.669922, width: 22.660156, height: 22.660156 },
    center: { x: 14, y: 14 },
    insets: { top: 2.669922, right: 2.669922, bottom: 2.669922, left: 2.669922 },
    anchors: {
      frame: { x: 14, y: 14 },
      ink: { x: 14, y: 14 },
      foreground: { x: 14, y: 14 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M14.0001 7.33691C14.4584 7.33709 14.8302 7.7087 14.8302 8.16699V13.793C14.8301 14.1454 14.6897 14.4841 14.4406 14.7334L11.67 17.5039C11.3459 17.8276 10.8202 17.8279 10.4962 17.5039C10.1722 17.1799 10.1725 16.6543 10.4962 16.3301L13.17 13.6562V8.16699C13.17 7.70874 13.5419 7.33714 14.0001 7.33691Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M14.0001 2.66992C20.2575 2.66992 25.3302 7.74261 25.3302 14C25.3302 20.2574 20.2575 25.3301 14.0001 25.3301C7.74274 25.3301 2.67004 20.2574 2.67004 14C2.67004 7.74261 7.74274 2.66992 14.0001 2.66992ZM14.0001 4.33008C8.65953 4.33008 4.3302 8.65941 4.3302 14C4.3302 19.3406 8.65953 23.6699 14.0001 23.6699C19.3407 23.6699 23.67 19.3406 23.67 14C23.67 8.65941 19.3407 4.33008 14.0001 4.33008Z" fill="currentColor"/>`,
});

export const ClockLight28Icon = createIconComponent(clockLight28);
