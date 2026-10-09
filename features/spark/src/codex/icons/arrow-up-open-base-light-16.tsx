import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const arrowUpOpenBaseLight16 = defineIconAsset({
  name: "arrow-up-open-base-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 2.141357, y: 2.280273, width: 11.716797, height: 11.578125 },
    visualBounds: { x: 2.141357, y: 2.280273, width: 11.716797, height: 11.578125 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.141357, y: 2.280273, width: 11.716797, height: 11.578125 },
    center: { x: 7.999756, y: 8.069336 },
    insets: { top: 2.280273, right: 2.141846, bottom: 2.141602, left: 2.141357 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 7.999756, y: 8.069336 },
      foreground: { x: 7.999756, y: 8.069336 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M13.3337 8.14162C13.6235 8.14179 13.8582 8.37716 13.8582 8.66701V11.2002C13.8582 12.6684 12.6681 13.8584 11.2 13.8584H4.80054C3.33238 13.8584 2.14136 12.6684 2.14136 11.2002V8.66701C2.14136 8.37706 2.3768 8.14162 2.66675 8.14162C2.9567 8.14162 3.19214 8.37706 3.19214 8.66701V11.2002C3.19214 12.0885 3.91228 12.8086 4.80054 12.8086H11.2C12.0882 12.8086 12.8083 12.0885 12.8083 11.2002V8.66701C12.8083 8.37706 13.0438 8.14162 13.3337 8.14162Z" fill="currentColor"/> <path d="M7.45874 2.47267C7.77339 2.21619 8.22716 2.21609 8.54175 2.47267L8.60718 2.53126L11.2048 5.12892C11.4097 5.33383 11.4095 5.66606 11.2048 5.87111C10.9998 6.07613 10.6677 6.07613 10.4626 5.87111L8.52515 3.93361V9.50001C8.52515 9.78996 8.28971 10.0254 7.99976 10.0254C7.70996 10.0252 7.47437 9.78986 7.47437 9.50001V3.93361L5.53784 5.87111C5.33282 6.07613 5.00068 6.07613 4.79565 5.87111C4.5908 5.66607 4.59069 5.33389 4.79565 5.12892L7.39331 2.53126L7.45874 2.47267Z" fill="currentColor"/>`,
});

export const ArrowUpOpenBaseLight16Icon = createIconComponent(arrowUpOpenBaseLight16);
