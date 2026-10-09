import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const chatBubbleFillLight24 = defineIconAsset({
  name: "chat-bubble-fill-light-24",
  canvas: {
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    frame: { x: 0, y: 0, width: 24, height: 24 },
    inkBounds: { x: 2.25, y: 2.75, width: 19.5, height: 18.5 },
    visualBounds: { x: 2.25, y: 2.75, width: 19.5, height: 18.5 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.25, y: 2.75, width: 19.5, height: 18.5 },
    center: { x: 12, y: 12 },
    insets: { top: 2.75, right: 2.25, bottom: 2.75, left: 2.25 },
    anchors: {
      frame: { x: 12, y: 12 },
      ink: { x: 12, y: 12 },
      foreground: { x: 12, y: 12 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M12 2.75C17.3438 2.75 21.75 6.85155 21.75 12C21.75 17.1484 17.3438 21.25 12 21.25C10.1791 21.25 8.64202 20.7067 7.13281 20L4.47168 20.6914C3.78471 20.8695 3.15194 20.2583 3.30566 19.5654L3.86523 17.04C3.09243 15.5283 2.25 14.0679 2.25 12C2.25 6.85155 6.65619 2.75 12 2.75Z" fill="currentColor"/>`,
});

export const ChatBubbleFillLight24Icon = createIconComponent(chatBubbleFillLight24);
