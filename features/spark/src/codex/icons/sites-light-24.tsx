import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const sitesLight24 = defineIconAsset({
  name: "sites-light-24",
  canvas: {
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    frame: { x: 0, y: 0, width: 24, height: 24 },
    inkBounds: { x: 2.25, y: 2.25, width: 19.5, height: 19.5 },
    visualBounds: { x: 2.25, y: 2.25, width: 19.5, height: 19.5 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.25, y: 2.25, width: 19.5, height: 19.5 },
    center: { x: 12, y: 12 },
    insets: { top: 2.25, right: 2.25, bottom: 2.25, left: 2.25 },
    anchors: {
      frame: { x: 12, y: 12 },
      ink: { x: 12, y: 12 },
      foreground: { x: 12, y: 12 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M7 15.25C7.9665 15.25 8.75 16.0335 8.75 17V20C8.75 20.9665 7.9665 21.75 7 21.75H4C3.0335 21.75 2.25 20.9665 2.25 20V17C2.25 16.0335 3.0335 15.25 4 15.25H7ZM4 16.75C3.86193 16.75 3.75 16.8619 3.75 17V20C3.75 20.1381 3.86193 20.25 4 20.25H7C7.13807 20.25 7.25 20.1381 7.25 20V17C7.25 16.8619 7.13807 16.75 7 16.75H4Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M10 2.25C11.5188 2.25 12.75 3.48122 12.75 5V11.25H19C20.5188 11.25 21.75 12.4812 21.75 14V19C21.75 20.5188 20.5188 21.75 19 21.75H14C12.4812 21.75 11.25 20.5188 11.25 19V12.75H5C3.48122 12.75 2.25 11.5188 2.25 10V5C2.25 3.48122 3.48122 2.25 5 2.25H10ZM12.75 19C12.75 19.6904 13.3096 20.25 14 20.25H19C19.6904 20.25 20.25 19.6904 20.25 19V14C20.25 13.3096 19.6904 12.75 19 12.75H12.75V19ZM5 3.75C4.30964 3.75 3.75 4.30964 3.75 5V10C3.75 10.6904 4.30964 11.25 5 11.25H11.25V5C11.25 4.30964 10.6904 3.75 10 3.75H5Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M20 2.25C20.9665 2.25 21.75 3.0335 21.75 4V7C21.75 7.9665 20.9665 8.75 20 8.75H17C16.0335 8.75 15.25 7.9665 15.25 7V4C15.25 3.0335 16.0335 2.25 17 2.25H20ZM17 3.75C16.8619 3.75 16.75 3.86193 16.75 4V7C16.75 7.13807 16.8619 7.25 17 7.25H20C20.1381 7.25 20.25 7.13807 20.25 7V4C20.25 3.86193 20.1381 3.75 20 3.75H17Z" fill="currentColor"/>`,
});

export const SitesLight24Icon = createIconComponent(sitesLight24);
