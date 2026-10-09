import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const magnifyingGlassMdLight24 = defineIconAsset({
  name: "magnifying-glass-md-light-24",
  canvas: {
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    frame: { x: 0, y: 0, width: 24, height: 24 },
    inkBounds: { x: 3.745117, y: 3.745117, width: 15.977478, height: 16.008789 },
    visualBounds: { x: 3.745117, y: 3.745117, width: 15.977478, height: 16.008789 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 3.745117, y: 3.745117, width: 15.977478, height: 16.008789 },
    center: { x: 11.733856, y: 11.749512 },
    insets: { top: 3.745117, right: 4.277405, bottom: 4.246094, left: 3.745117 },
    anchors: {
      frame: { x: 12, y: 12 },
      ink: { x: 11.733856, y: 11.749512 },
      foreground: { x: 11.733856, y: 11.749512 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M10.4951 3.74512C14.223 3.74512 17.2451 6.7672 17.2451 10.4951C17.2451 12.0968 16.686 13.5672 15.7539 14.7246L19.5029 18.4736C19.7958 18.7665 19.7958 19.2413 19.5029 19.5342C19.21 19.8271 18.7353 19.8271 18.4424 19.5342L14.6895 15.7812C13.5374 16.6966 12.0808 17.2451 10.4951 17.2451C6.7672 17.2451 3.74512 14.223 3.74512 10.4951C3.74512 6.7672 6.7672 3.74512 10.4951 3.74512ZM10.4951 5.24512C7.59562 5.24512 5.24512 7.59562 5.24512 10.4951C5.24512 13.3946 7.59562 15.7451 10.4951 15.7451C13.3946 15.7451 15.7451 13.3946 15.7451 10.4951C15.7451 7.59562 13.3946 5.24512 10.4951 5.24512Z" fill="currentColor"/>`,
});

export const MagnifyingGlassMdLight24Icon = createIconComponent(magnifyingGlassMdLight24);
