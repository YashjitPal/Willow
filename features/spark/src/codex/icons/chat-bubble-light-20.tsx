import { Icon, type IconProps } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const chatBubbleLight20 = defineIconAsset({
  name: "chat-bubble-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 1.834961, y: 2.251617, width: 16.330078, height: 15.49707 },
    visualBounds: { x: 1.834961, y: 2.251617, width: 16.330078, height: 15.49707 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.834961, y: 2.251617, width: 16.330078, height: 15.49707 },
    center: { x: 10, y: 10.000152 },
    insets: { top: 2.251617, right: 1.834961, bottom: 2.251313, left: 1.834961 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10, y: 10.000152 },
      foreground: { x: 10, y: 10.000152 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M16.835 9.99963C16.8348 6.49033 13.8111 3.58167 10 3.58167C6.18893 3.58167 3.16523 6.49033 3.16504 9.99963C3.16504 11.4141 3.73237 12.3498 4.44727 13.7653C4.53356 13.9364 4.55818 14.1326 4.5166 14.3199L4.19043 15.7887L5.78027 15.3776L5.9248 15.3531C6.02169 15.3457 6.11884 15.3556 6.21191 15.3815L6.34766 15.4323L6.80664 15.6442C7.86864 16.1161 8.86618 16.4186 10 16.4186C13.8112 16.4186 16.835 13.5091 16.835 9.99963ZM18.165 9.99963C18.165 14.3142 14.4731 17.7487 10 17.7487C8.47948 17.7487 7.19622 17.2956 5.94043 16.7086L3.73633 17.2809C3.13492 17.4368 2.58124 16.9021 2.71582 16.2955L3.17871 14.2067C2.53737 12.9532 1.83496 11.7286 1.83496 9.99963C1.83515 5.6852 5.52703 2.25159 10 2.25159C14.473 2.25159 18.1649 5.6852 18.165 9.99963Z" fill="currentColor"/>`,
});

export function ChatBubbleLight20Icon(props: Omit<IconProps, "asset">) {
  return <Icon asset={chatBubbleLight20} {...props} />;
}
