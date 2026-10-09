import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const stickyNotesLight20 = defineIconAsset({
  name: "sticky-notes-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 2.668213, y: 2.667969, width: 14.663086, height: 14.663086 },
    visualBounds: { x: 2.668213, y: 2.667969, width: 14.663086, height: 14.663086 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.668213, y: 2.667969, width: 14.663086, height: 14.663086 },
    center: { x: 9.999756, y: 9.999512 },
    insets: { top: 2.667969, right: 2.668701, bottom: 2.668945, left: 2.668213 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 9.999756, y: 9.999512 },
      foreground: { x: 9.999756, y: 9.999512 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M14.0002 2.66797C15.7595 2.66813 17.3313 3.94313 17.3313 5.68555V10.6113C17.3313 11.4506 16.9979 12.2561 16.4045 12.8496L12.8518 16.4033C12.2581 16.9971 11.4522 17.3311 10.6125 17.3311C9.07511 17.331 7.53777 17.3311 6.00024 17.3311C4.24103 17.3311 2.66848 16.0558 2.66821 14.3135V5.68555C2.66823 3.94302 4.24089 2.66797 6.00024 2.66797H14.0002ZM6.00024 3.99805C4.81411 3.99805 3.99831 4.82911 3.99829 5.68555V14.3135C3.99857 15.1698 4.8143 16.001 6.00024 16.001C7.38949 16.001 8.77888 16.0009 10.1682 16.001V12.5C10.1684 11.2125 11.2127 10.1691 12.5002 10.1689H16.0012V5.68555C16.0012 4.82919 15.1862 3.9982 14.0002 3.99805H6.00024ZM12.5002 11.499C11.9473 11.4992 11.4985 11.947 11.4983 12.5V15.7705C11.6479 15.6879 11.7874 15.5859 11.9104 15.4629L15.4641 11.9092C15.5866 11.7866 15.6894 11.6481 15.7717 11.499H12.5002Z" fill="currentColor"/>`,
});

export const StickyNotesLight20Icon = createIconComponent(stickyNotesLight20);
