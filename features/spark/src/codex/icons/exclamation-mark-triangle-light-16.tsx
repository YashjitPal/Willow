import { Icon, type IconProps } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const exclamationMarkTriangleLight16 = defineIconAsset({
  name: "exclamation-mark-triangle-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 1.182861, y: 2.03125, width: 13.633789, height: 11.82666 },
    visualBounds: { x: 1.182861, y: 2.03125, width: 13.633789, height: 11.82666 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.182861, y: 2.03125, width: 13.633789, height: 11.82666 },
    center: { x: 7.999756, y: 7.94458 },
    insets: { top: 2.03125, right: 1.18335, bottom: 2.14209, left: 1.182861 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 7.999756, y: 7.94458 },
      foreground: { x: 7.999756, y: 7.94458 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M8.08418 10.0542C8.49587 10.0964 8.81746 10.4439 8.81758 10.8667C8.81758 11.3179 8.45132 11.6838 8.0002 11.6841C7.57726 11.684 7.22966 11.3626 7.1877 10.9507L7.18281 10.8667L7.1877 10.7837C7.22943 10.3716 7.57709 10.0494 8.0002 10.0493L8.08418 10.0542Z" fill="currentColor"/> <path d="M8.0002 5.80713C8.29003 5.80726 8.52559 6.04265 8.52559 6.33252V8.49951C8.52515 8.78901 8.28976 9.0238 8.0002 9.02393C7.71052 9.02393 7.47524 8.78909 7.47481 8.49951V6.33252C7.47481 6.04257 7.71025 5.80713 8.0002 5.80713Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M6.41426 2.92041C7.13894 1.73491 8.86056 1.73481 9.58516 2.92041L14.5412 11.0298C15.2977 12.2681 14.4064 13.8579 12.9553 13.8579H3.04316C1.59251 13.8574 0.702069 12.2678 1.4582 11.0298L6.41426 2.92041ZM8.68965 3.46826C8.37446 2.95249 7.62496 2.95249 7.30977 3.46826L2.35371 11.5776C2.0252 12.116 2.4125 12.8066 3.04316 12.8071H12.9553C13.5864 12.8071 13.9736 12.1162 13.6447 11.5776L8.68965 3.46826Z" fill="currentColor"/>`,
});

export function ExclamationMarkTriangleLight16Icon(props: Omit<IconProps, "asset">) {
  return <Icon asset={exclamationMarkTriangleLight16} {...props} />;
}
