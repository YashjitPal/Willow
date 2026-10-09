import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const ellipsisHorizontalLight20 = defineIconAsset({
  name: "ellipsis-horizontal-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 2.668335, y: 8.501465, width: 14.664063, height: 2.99707 },
    visualBounds: { x: 2.668335, y: 8.501465, width: 14.664063, height: 2.99707 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.668335, y: 8.501465, width: 14.664063, height: 2.99707 },
    center: { x: 10.000367, y: 10 },
    insets: { top: 8.501465, right: 2.667602, bottom: 8.501465, left: 2.668335 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10.000367, y: 10 },
      foreground: { x: 10.000367, y: 10 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M4.16638 8.50146C4.99378 8.50146 5.66523 9.17215 5.66541 9.99951C5.66541 10.827 4.99389 11.4985 4.16638 11.4985C3.33902 11.4984 2.66833 10.8269 2.66833 9.99951C2.66851 9.17226 3.33913 8.50164 4.16638 8.50146Z" fill="currentColor"/> <path d="M9.99939 8.50146C10.8268 8.50146 11.4982 9.17215 11.4984 9.99951C11.4984 10.827 10.8269 11.4985 9.99939 11.4985C9.17214 11.4982 8.50134 10.8268 8.50134 9.99951C8.50152 9.17234 9.17225 8.50177 9.99939 8.50146Z" fill="currentColor"/> <path d="M15.8334 8.50146C16.6606 8.50166 17.3322 9.17228 17.3324 9.99951C17.3324 10.8269 16.6607 11.4983 15.8334 11.4985C15.006 11.4984 14.3353 10.8269 14.3353 9.99951C14.3355 9.17226 15.0061 8.50164 15.8334 8.50146Z" fill="currentColor"/>`,
});

export const EllipsisHorizontalLight20Icon = createIconComponent(ellipsisHorizontalLight20);
