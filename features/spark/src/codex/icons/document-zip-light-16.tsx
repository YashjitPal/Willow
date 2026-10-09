import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const documentZipLight16 = defineIconAsset({
  name: "document-zip-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 2.474609, y: 1.808105, width: 11.050781, height: 12.383789 },
    visualBounds: { x: 2.474609, y: 1.808105, width: 11.050781, height: 12.383789 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.474609, y: 1.808105, width: 11.050781, height: 12.383789 },
    center: { x: 8, y: 8 },
    insets: { top: 1.808105, right: 2.47461, bottom: 1.808106, left: 2.474609 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8, y: 8 },
      foreground: { x: 8, y: 8 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M8.48145 8.14209C8.77027 8.14209 9.03323 8.29912 9.17188 8.54541L9.22266 8.65576L10.0234 10.7896C10.217 11.3068 9.83455 11.8586 9.28223 11.8589H6.71777C6.16541 11.8587 5.78301 11.3068 5.97656 10.7896L6.77637 8.65576L6.82812 8.54541C6.96678 8.29916 7.22976 8.1421 7.51855 8.14209H8.48145ZM7.09082 10.8091H8.90918L8.30371 9.19287H7.69629L7.09082 10.8091Z" fill="currentColor"/> <path d="M8.82715 6.14209C9.11673 6.14252 9.35156 6.3778 9.35156 6.66748C9.3513 6.95694 9.11657 7.19244 8.82715 7.19287H7.17383C6.88404 7.19287 6.6487 6.95721 6.64844 6.66748C6.64844 6.37753 6.88388 6.14209 7.17383 6.14209H8.82715Z" fill="currentColor"/> <path d="M8.82715 4.14209C9.11673 4.14252 9.35156 4.3778 9.35156 4.66748C9.3513 4.95694 9.11657 5.19244 8.82715 5.19287H7.17383C6.88404 5.19287 6.6487 4.95721 6.64844 4.66748C6.64844 4.37753 6.88388 4.14209 7.17383 4.14209H8.82715Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M11 1.80811C12.3945 1.80811 13.5254 2.93898 13.5254 4.3335V11.6665C13.5254 13.061 12.3945 14.1919 11 14.1919H5C3.60548 14.1919 2.47461 13.061 2.47461 11.6665V4.3335C2.47461 2.93898 3.60548 1.80811 5 1.80811H11ZM5 2.85889C4.18538 2.85889 3.52539 3.51888 3.52539 4.3335V11.6665C3.52539 12.4811 4.18538 13.1421 5 13.1421H11C11.8146 13.1421 12.4746 12.4811 12.4746 11.6665V4.3335C12.4746 3.51888 11.8146 2.85889 11 2.85889H5Z" fill="currentColor"/>`,
});

export const DocumentZipLight16Icon = createIconComponent(documentZipLight16);
