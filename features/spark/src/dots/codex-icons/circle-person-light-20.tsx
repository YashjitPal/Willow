import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const circlePersonLight20 = defineIconAsset({
  name: "circle-person-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 1.834961, y: 1.834961, width: 16.330078, height: 16.330078 },
    visualBounds: { x: 1.834961, y: 1.834961, width: 16.330078, height: 16.330078 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "circular",
    bounds: { x: 1.834961, y: 1.834961, width: 16.330078, height: 16.330078 },
    center: { x: 10, y: 10 },
    insets: { top: 1.834961, right: 1.834961, bottom: 1.834961, left: 1.834961 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10, y: 10 },
      foreground: { x: 10, y: 10 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M10 5.16895C11.748 5.16895 13.165 6.586 13.165 8.33398C13.1648 10.0817 11.7478 11.499 10 11.499C8.25218 11.499 6.83522 10.0817 6.83496 8.33398C6.83496 6.586 8.25202 5.16895 10 5.16895ZM10 6.49902C8.98656 6.49902 8.16504 7.32054 8.16504 8.33398C8.1653 9.3472 8.98672 10.1689 10 10.1689C11.0133 10.1689 11.8347 9.3472 11.835 8.33398C11.835 7.32054 11.0134 6.49902 10 6.49902Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M10 1.83496C14.5094 1.83496 18.165 5.49059 18.165 10C18.165 14.5094 14.5094 18.165 10 18.165C5.49059 18.165 1.83496 14.5094 1.83496 10C1.83496 5.4906 5.4906 1.83496 10 1.83496ZM10 13.999C8.53381 13.9991 7.23801 14.7278 6.45312 15.8438C7.48714 16.4727 8.70125 16.835 10 16.835C11.2984 16.835 12.512 16.4724 13.5459 15.8438C12.7609 14.7282 11.4659 13.9991 10 13.999ZM10 3.16504C6.22513 3.16504 3.16504 6.22513 3.16504 10C3.16504 11.998 4.02285 13.7952 5.38965 15.0449C6.41662 13.6079 8.09755 12.669 10 12.6689C11.9026 12.669 13.5826 13.6087 14.6094 15.0459C15.9768 13.7961 16.835 11.9985 16.835 10C16.835 6.22513 13.7749 3.16504 10 3.16504Z" fill="currentColor"/>`,
});

export const CirclePersonLight20Icon = createIconComponent(circlePersonLight20);
