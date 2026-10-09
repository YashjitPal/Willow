import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const phoneFill24 = defineIconAsset({
  name: "phone-fill-24",
  canvas: { width: 24, height: 24, viewBox: "0 0 24 24" },
  paint: { kind: "monochrome" },
  optical: { shape: "non-circular" },
  capabilities: ["icon"],
  body: `<path fill="currentColor" d="M7.237 2c.567 0 1.042.125 1.425.375s.684.637.9 1.162l.988 2.388c.216.516.283.996.2 1.437-.075.442-.304.872-.688 1.288l-1.278 1.37c.618 1.22 1.33 2.252 2.142 3.093.81.84 1.804 1.559 2.978 2.159l1.36-1.359c.408-.4.833-.641 1.274-.725.442-.091.93-.024 1.463.2l2.463 1.025c.533.225.92.525 1.162.9.25.376.375.85.375 1.425v1.938c0 .608-.155 1.166-.463 1.675a3.325 3.325 0 0 1-1.25 1.2c-.517.3-1.08.45-1.687.45-2.95 0-5.7-.783-8.25-2.35-2.55-1.566-4.579-3.587-6.087-6.062C2.754 11.105 2 8.575 2 6c0-.733.175-1.404.525-2.013a3.91 3.91 0 0 1 1.45-1.45A3.96 3.96 0 0 1 6 2h1.237Z"/>`,
});

export const PhoneFill24Icon = createIconComponent(phoneFill24);
