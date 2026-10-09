import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const personLight20 = defineIconAsset({
  name: "person-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 2.920387, y: 1.755615, width: 14.158348, height: 16.43808 },
    visualBounds: { x: 2.920387, y: 1.755615, width: 14.158348, height: 16.43808 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.920387, y: 1.755615, width: 14.158348, height: 16.43808 },
    center: { x: 9.999561, y: 9.974655 },
    insets: { top: 1.755615, right: 2.921265, bottom: 1.806305, left: 2.920387 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 9.999561, y: 9.974655 },
      foreground: { x: 9.999561, y: 9.974655 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M9.99908 10.989C13.7126 10.9892 16.7606 13.8384 17.0762 17.4705C17.1078 17.836 16.8372 18.159 16.4717 18.1912C16.1059 18.2229 15.7829 17.9514 15.751 17.5857C15.4946 14.6349 13.0167 12.3193 9.99908 12.3191C6.98142 12.3193 4.50351 14.6349 4.24712 17.5857C4.21526 17.9513 3.89305 18.2227 3.5274 18.1912C3.16161 18.1594 2.89125 17.8362 2.92291 17.4705C3.23857 13.8384 6.28554 10.9892 9.99908 10.989Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M9.99908 1.75562C12.1999 1.75573 13.9844 3.54012 13.9844 5.74097C13.9843 7.94172 12.1998 9.72621 9.99908 9.72632C7.79834 9.72619 6.01384 7.94171 6.01373 5.74097C6.01373 3.54013 7.79827 1.75575 9.99908 1.75562ZM9.99908 3.08569C8.53281 3.08583 7.3438 4.27467 7.3438 5.74097C7.34391 7.20717 8.53288 8.39611 9.99908 8.39624C11.4653 8.39613 12.6542 7.20718 12.6544 5.74097C12.6544 4.27466 11.4654 3.0858 9.99908 3.08569Z" fill="currentColor"/>`,
});

export const PersonLight20Icon = createIconComponent(personLight20);
