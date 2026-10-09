import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const flaskLight20 = defineIconAsset({
  name: "flask-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 2.441162, y: 2.667969, width: 15.117432, height: 15.49707 },
    visualBounds: { x: 2.441162, y: 2.667969, width: 15.117432, height: 15.49707 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.441162, y: 2.667969, width: 15.117432, height: 15.49707 },
    center: { x: 9.999878, y: 10.416504 },
    insets: { top: 2.667969, right: 2.441406, bottom: 1.834961, left: 2.441162 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 9.999878, y: 10.416504 },
      foreground: { x: 9.999878, y: 10.416504 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M14.1668 2.66846C14.534 2.66859 14.8319 2.96631 14.8319 3.3335C14.8319 3.70068 14.534 3.9984 14.1668 3.99854H13.1649V7.71826L17.0887 13.7349C18.3315 15.6406 16.9635 18.1655 14.6883 18.1655H5.31136C3.03631 18.1654 1.66823 15.6405 2.91097 13.7349L6.8348 7.71826V3.99854H5.83382C5.46655 3.99854 5.16878 3.70077 5.16878 3.3335C5.16878 2.96623 5.46655 2.66846 5.83382 2.66846H14.1668ZM4.02523 14.4614C3.35944 15.4824 4.09249 16.8353 5.31136 16.8354H14.6883C15.9073 16.8354 16.6403 15.4825 15.9744 14.4614L14.0418 11.4985H5.95785L4.02523 14.4614ZM8.16488 7.79834C8.1648 8.00468 8.10469 8.20653 7.99203 8.37939L6.82503 10.1685H13.1746L12.0077 8.37939C11.895 8.20654 11.8349 8.00465 11.8348 7.79834V3.99854H8.16488V7.79834Z" fill="currentColor"/>`,
});

export const FlaskLight20Icon = createIconComponent(flaskLight20);
