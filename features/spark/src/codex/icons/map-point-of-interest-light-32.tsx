import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const mapPointOfInterestLight32 = defineIconAsset({
  name: "map-point-of-interest-light-32",
  canvas: {
    width: 32,
    height: 32,
    viewBox: "0 0 32 32",
    frame: { x: 0, y: 0, width: 32, height: 32 },
    inkBounds: { x: 3.766357, y: 2.432617, width: 24.466797, height: 27.083008 },
    visualBounds: { x: 3.766357, y: 2.432617, width: 24.466797, height: 27.083008 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 3.766357, y: 2.432617, width: 24.466797, height: 27.083008 },
    center: { x: 15.999756, y: 15.974121 },
    insets: { top: 2.432617, right: 3.766846, bottom: 2.484375, left: 3.766357 },
    anchors: {
      frame: { x: 16, y: 16 },
      ink: { x: 15.999756, y: 15.974121 },
      foreground: { x: 15.999756, y: 15.974121 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M15.9998 9.11621C18.9696 9.11628 21.3767 11.5243 21.3767 14.4941C21.3766 17.4639 18.9695 19.871 15.9998 19.8711C13.03 19.871 10.6219 17.4639 10.6218 14.4941C10.6218 11.5244 13.03 9.11634 15.9998 9.11621ZM15.9998 10.917C14.0241 10.9171 12.4226 12.5185 12.4226 14.4941C12.4227 16.4698 14.0242 18.0712 15.9998 18.0713C17.9754 18.0712 19.5768 16.4698 19.5769 14.4941C19.5769 12.5184 17.9755 10.9171 15.9998 10.917Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M15.9998 2.43262C22.7559 2.43262 28.233 7.90988 28.2332 14.666C28.2332 19.0262 25.616 22.5321 22.9539 24.9795C20.2756 27.4417 17.4094 28.9665 16.6101 29.3691C16.2203 29.5654 15.7753 29.5642 15.3865 29.3662C14.5882 28.9596 11.7239 27.4197 9.04663 24.9521C6.38657 22.5004 3.76636 18.9971 3.76636 14.666C3.76653 7.90999 9.24373 2.43279 15.9998 2.43262ZM15.9998 4.2334C10.2378 4.23357 5.56731 8.9041 5.56714 14.666C5.56714 18.2487 7.74513 21.3051 10.2664 23.6289C12.5781 25.7596 15.0578 27.1597 16.0017 27.6562C16.9452 27.1651 19.4242 25.7787 21.7351 23.6543C24.2537 21.3389 26.4333 18.2801 26.4333 14.666C26.4332 8.90399 21.7618 4.2334 15.9998 4.2334Z" fill="currentColor"/>`,
});

export const MapPointOfInterestLight32Icon = createIconComponent(mapPointOfInterestLight32);
