import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const codeLight16 = defineIconAsset({
  name: "code-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 1.507813, y: 4.808105, width: 12.98877, height: 6.445313 },
    visualBounds: { x: 1.507813, y: 4.808105, width: 12.98877, height: 6.445313 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.507813, y: 4.808105, width: 12.98877, height: 6.445313 },
    center: { x: 8.002198, y: 8.030762 },
    insets: { top: 4.808105, right: 1.503417, bottom: 4.746582, left: 1.507813 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8.002198, y: 8.030762 },
      foreground: { x: 8.002198, y: 8.030762 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M3.58126 5.02178C3.75323 4.78839 4.08222 4.73855 4.31564 4.91045C4.54904 5.08245 4.59894 5.4114 4.42696 5.64482L2.65353 8.05107L4.42404 10.4144C4.59781 10.6464 4.55063 10.9749 4.31857 11.1487C4.0865 11.3223 3.75792 11.2752 3.58419 11.0433L1.63888 8.44658C1.46519 8.21431 1.46404 7.89502 1.63595 7.66143L3.58126 5.02178Z" fill="currentColor"/> <path d="M11.6887 4.91045C11.9221 4.73845 12.2511 4.78835 12.4231 5.02178L14.3684 7.66143C14.5405 7.89505 14.5392 8.21423 14.3654 8.44658L12.4201 11.0433C12.2463 11.2752 11.9178 11.3225 11.6858 11.1487C11.4538 10.975 11.4067 10.6464 11.5803 10.4144L13.3508 8.05107L11.5774 5.64482C11.4054 5.41147 11.4555 5.08249 11.6887 4.91045Z" fill="currentColor"/> <path d="M8.85372 5.10185C8.98163 4.84174 9.2967 4.73483 9.55685 4.8626C9.81654 4.99067 9.92374 5.30479 9.79611 5.56475L7.14669 10.9515C7.0187 11.2115 6.70467 11.3186 6.44454 11.1907C6.18458 11.0627 6.07753 10.7487 6.20529 10.4886L8.85372 5.10185Z" fill="currentColor"/>`,
});

export const CodeLight16Icon = createIconComponent(codeLight16);
