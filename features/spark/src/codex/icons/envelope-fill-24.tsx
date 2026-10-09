import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const envelopeFill24 = defineIconAsset({
  name: "envelope-fill-24",
  canvas: { width: 24, height: 24, viewBox: "0 0 24 24" },
  paint: { kind: "monochrome" },
  optical: { shape: "non-circular" },
  capabilities: ["icon"],
  body: `<path fill="currentColor" d="M6 5h12a3 3 0 0 1 2.58 1.47l-7.83 5.64a1.3 1.3 0 0 1-1.5 0L3.42 6.47A3 3 0 0 1 6 5ZM3 8.03V16c0 .53.14 1.03.38 1.46l5.52-5.18L3 8.03Zm18 0-5.9 4.25 5.52 5.18c.24-.43.38-.93.38-1.46V8.03ZM4.45 18.56C4.91 18.84 5.44 19 6 19h12c.56 0 1.09-.16 1.55-.44l-5.7-5.36-.22.16a2.8 2.8 0 0 1-3.26 0l-.22-.16-5.7 5.36Z"/>`,
});

export const EnvelopeFill24Icon = createIconComponent(envelopeFill24);
