import { Icon, type IconProps } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const chatBubbleLight16 = defineIconAsset({
  name: "chat-bubble-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 1.474609, y: 1.807953, width: 13.050781, height: 12.383789 },
    visualBounds: { x: 1.474609, y: 1.807953, width: 13.050781, height: 12.383789 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.474609, y: 1.807953, width: 13.050781, height: 12.383789 },
    center: { x: 8, y: 7.999848 },
    insets: { top: 1.807953, right: 1.47461, bottom: 1.808258, left: 1.474609 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8, y: 7.999848 },
      foreground: { x: 8, y: 7.999848 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M13.4746 8.00037C13.4746 5.18857 11.0524 2.85876 8 2.85876C4.94756 2.85876 2.52539 5.18857 2.52539 8.00037C2.52548 9.13377 2.98018 9.8833 3.55176 11.015C3.62017 11.1505 3.63938 11.306 3.60645 11.4545L3.34277 12.641L4.62598 12.309L4.74023 12.2894C4.81669 12.2835 4.89333 12.2915 4.9668 12.3119L5.0752 12.3519L5.44238 12.5219C6.29248 12.8996 7.09158 13.142 8 13.142C11.0523 13.142 13.4744 10.812 13.4746 8.00037ZM14.5254 8.00037C14.5252 11.4476 11.5749 14.1918 8 14.1918C6.78477 14.1918 5.75932 13.8293 4.75488 13.3597L2.9873 13.8187C2.5113 13.942 2.07317 13.5185 2.17969 13.0385L2.5498 11.3636C2.03641 10.3601 1.4747 9.38207 1.47461 8.00037C1.47461 4.55293 4.42502 1.80798 8 1.80798C11.575 1.80798 14.5254 4.55293 14.5254 8.00037Z" fill="currentColor"/>`,
});

export function ChatBubbleLight16Icon(props: Omit<IconProps, "asset">) {
  return <Icon asset={chatBubbleLight16} {...props} />;
}
