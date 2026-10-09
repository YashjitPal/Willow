import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const bookLight20 = defineIconAsset({
  name: "book-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 3.467773, y: 1.834961, width: 13.000244, height: 16.331055 },
    visualBounds: { x: 3.467773, y: 1.834961, width: 13.000244, height: 16.331055 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 3.467773, y: 1.834961, width: 13.000244, height: 16.331055 },
    center: { x: 9.967895, y: 10.000489 },
    insets: { top: 1.834961, right: 3.531983, bottom: 1.833984, left: 3.467773 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 9.967895, y: 10.000489 },
      foreground: { x: 9.967895, y: 10.000489 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M14.9658 1.83496C15.7932 1.83496 16.4647 2.50565 16.4648 3.33301V14.1377C16.4765 14.2606 16.4566 14.3895 16.3975 14.5117C16.3032 14.7067 16.0488 15.2961 16.0488 15.835C16.0491 16.3348 16.2497 16.8734 16.3545 17.1143C16.5636 17.5964 16.2213 18.1658 15.666 18.166H5.7998C4.51218 18.1657 3.46804 17.1217 3.46777 15.834V5C3.46777 3.25202 4.88483 1.83496 6.63281 1.83496H14.9658ZM5.7998 14.832C5.24653 14.8325 4.79787 15.2809 4.79785 15.834C4.79812 16.387 5.2466 16.8356 5.7998 16.8359H14.8584C14.7811 16.5365 14.7189 16.1896 14.7188 15.835C14.7188 15.4786 14.7843 15.1283 14.8672 14.8252L5.7998 14.832ZM6.63281 3.16504C5.61937 3.16504 4.79785 3.98656 4.79785 5V13.7295C5.10133 13.5847 5.44021 13.5022 5.79883 13.502L15.1348 13.4951V3.33301C15.1346 3.24019 15.0587 3.16504 14.9658 3.16504H6.63281Z" fill="currentColor"/>`,
});

export const BookLight20Icon = createIconComponent(bookLight20);
