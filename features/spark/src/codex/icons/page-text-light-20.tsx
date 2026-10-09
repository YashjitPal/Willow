import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const pageTextLight20 = defineIconAsset({
  name: "page-text-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 3.084961, y: 2.251465, width: 13.830078, height: 15.49707 },
    visualBounds: { x: 3.084961, y: 2.251465, width: 13.830078, height: 15.49707 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 3.084961, y: 2.251465, width: 13.830078, height: 15.49707 },
    center: { x: 10, y: 10 },
    insets: { top: 2.251465, right: 3.084961, bottom: 2.251465, left: 3.084961 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10, y: 10 },
      foreground: { x: 10, y: 10 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M10.833 11.0854C11.2003 11.0854 11.498 11.3832 11.498 11.7505C11.4978 12.1175 11.2001 12.4155 10.833 12.4155H7.5C7.13289 12.4155 6.83522 12.1175 6.83496 11.7505C6.83496 11.3832 7.13273 11.0854 7.5 11.0854H10.833Z" fill="currentColor"/> <path d="M12.5 7.66846C12.8673 7.66846 13.165 7.96623 13.165 8.3335C13.1648 8.70054 12.8671 8.99854 12.5 8.99854H7.5C7.13289 8.99854 6.83522 8.70054 6.83496 8.3335C6.83496 7.96623 7.13273 7.66846 7.5 7.66846H12.5Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M13.7832 2.25146C15.5128 2.25146 16.915 3.65373 16.915 5.3833V14.6167C16.9149 16.3462 15.5127 17.7485 13.7832 17.7485H6.2168C4.48729 17.7485 3.08507 16.3462 3.08496 14.6167V5.3833C3.08496 3.65373 4.48722 2.25146 6.2168 2.25146H13.7832ZM6.2168 3.58154C5.22176 3.58154 4.41504 4.38827 4.41504 5.3833V14.6167C4.41514 15.6116 5.22183 16.4185 6.2168 16.4185H13.7832C14.7782 16.4185 15.5849 15.6116 15.585 14.6167V5.3833C15.585 4.38827 14.7782 3.58154 13.7832 3.58154H6.2168Z" fill="currentColor"/>`,
});

export const PageTextLight20Icon = createIconComponent(pageTextLight20);
