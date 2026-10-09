import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const cloudLight20 = defineIconAsset({
  name: "cloud-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 1.001465, y: 2.667969, width: 17.99707, height: 12.99707 },
    visualBounds: { x: 1.001465, y: 2.667969, width: 17.99707, height: 12.99707 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.001465, y: 2.667969, width: 17.99707, height: 12.99707 },
    center: { x: 10, y: 9.166504 },
    insets: { top: 2.667969, right: 1.001465, bottom: 4.334961, left: 1.001465 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10, y: 9.166504 },
      foreground: { x: 10, y: 9.166504 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M1.00146 10.833C1.00146 8.52389 2.6207 6.59406 4.78564 6.11523C5.64822 4.08974 7.65705 2.6681 9.99951 2.66797C12.9202 2.66797 15.3224 4.87836 15.6294 7.71777C17.5386 8.01995 18.9984 9.67212 18.9985 11.666C18.9985 13.8742 17.2077 15.665 14.9995 15.665H5.8335C3.16504 15.665 1.00146 13.5015 1.00146 10.833ZM2.33154 10.833C2.33154 12.7669 3.89958 14.335 5.8335 14.335H14.9995C16.4732 14.335 17.6685 13.1397 17.6685 11.666C17.6683 10.2488 16.5626 9.08908 15.1675 9.00293C14.7207 8.97537 14.3506 8.61516 14.3315 8.15137C14.2366 5.84171 12.3328 3.99805 9.99951 3.99805C8.14049 3.99818 6.55348 5.16887 5.93799 6.81543C5.82644 7.11391 5.5635 7.32722 5.25342 7.37891C3.59561 7.65482 2.33154 9.09703 2.33154 10.833Z" fill="currentColor"/>`,
});

export const CloudLight20Icon = createIconComponent(cloudLight20);
