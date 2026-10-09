import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const exclamationmarkCircleFillLight16 = defineIconAsset({
  name: "exclamationmark-circle-fill-light-16",
  canvas: { width: 16, height: 16, viewBox: "0 0 16 16" },
  paint: { kind: "monochrome" },
  optical: { shape: "circular" },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M8 1.47461C11.6037 1.47461 14.5254 4.39634 14.5254 8C14.5254 11.6037 11.6037 14.5254 8 14.5254C4.39634 14.5254 1.47461 11.6037 1.47461 8C1.47461 4.39634 4.39634 1.47461 8 1.47461ZM8 9.30371C7.57689 9.30383 7.22923 9.62595 7.1875 10.0381L7.18262 10.1211L7.1875 10.2051C7.22945 10.617 7.57705 10.9384 8 10.9385C8.45123 10.9383 8.81738 10.5724 8.81738 10.1211C8.81726 9.69822 8.49579 9.35064 8.08398 9.30859L8 9.30371ZM8 5.06152C7.71005 5.06152 7.47461 5.29696 7.47461 5.58691V7.75391C7.47478 8.04371 7.71016 8.27832 8 8.27832C8.28984 8.27832 8.52522 8.04371 8.52539 7.75391V5.58691C8.52539 5.29696 8.28995 5.06152 8 5.06152Z" fill="currentColor"/>`,
});

export const ExclamationmarkCircleFillLight16Icon = createIconComponent(exclamationmarkCircleFillLight16);
