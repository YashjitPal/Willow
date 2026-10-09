import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const dockLight20 = defineIconAsset({
  name: "dock-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 1.834961, y: 3.084961, width: 16.330078, height: 13.830078 },
    visualBounds: { x: 1.834961, y: 3.084961, width: 16.330078, height: 13.830078 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.834961, y: 3.084961, width: 16.330078, height: 13.830078 },
    center: { x: 10, y: 10 },
    insets: { top: 3.084961, right: 1.834961, bottom: 3.084961, left: 1.834961 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10, y: 10 },
      foreground: { x: 10, y: 10 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M13.334 12.168C13.7009 12.1683 13.9989 12.466 13.999 12.833C13.999 13.2001 13.701 13.4977 13.334 13.498H6.66699C6.29972 13.498 6.00195 13.2003 6.00195 12.833C6.00209 12.4659 6.2998 12.168 6.66699 12.168H13.334Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M15.167 3.08496C16.8227 3.08514 18.1649 4.42733 18.165 6.08301V13.917C18.1649 15.5727 16.8227 16.9149 15.167 16.915H4.83301C3.17733 16.9149 1.83514 15.5727 1.83496 13.917V6.08301C1.83514 4.42733 3.17733 3.08514 4.83301 3.08496H15.167ZM4.83301 4.41504C3.91187 4.41521 3.16522 5.16187 3.16504 6.08301V13.917C3.16521 14.8381 3.91187 15.5848 4.83301 15.585H15.167C16.0881 15.5848 16.8348 14.8381 16.835 13.917V6.08301C16.8348 5.16187 16.0881 4.41522 15.167 4.41504H4.83301Z" fill="currentColor"/>`,
});

export const DockLight20Icon = createIconComponent(dockLight20);
