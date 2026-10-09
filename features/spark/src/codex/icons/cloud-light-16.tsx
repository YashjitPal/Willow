import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const cloudLight16 = defineIconAsset({
  name: "cloud-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 0.808105, y: 2.141602, width: 14.383789, height: 10.383789 },
    visualBounds: { x: 0.808105, y: 2.141602, width: 14.383789, height: 10.383789 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 0.808105, y: 2.141602, width: 14.383789, height: 10.383789 },
    center: { x: 8, y: 7.333497 },
    insets: { top: 2.141602, right: 0.808106, bottom: 3.474609, left: 0.808105 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8, y: 7.333497 },
      foreground: { x: 8, y: 7.333497 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M0.808105 8.66699C0.808105 6.82089 2.10457 5.27853 3.83643 4.89844C4.52497 3.27937 6.12852 2.1416 8.00049 2.1416C10.3351 2.14177 12.2547 3.91029 12.4976 6.18066C14.0242 6.41972 15.1919 7.74044 15.1919 9.33398C15.1917 11.0964 13.7629 12.5252 12.0005 12.5254H4.6665C2.53575 12.5252 0.808105 10.7978 0.808105 8.66699ZM1.85889 8.66699C1.85889 10.2179 3.11565 11.4754 4.6665 11.4756H12.0005C13.183 11.4754 14.1419 10.5165 14.1421 9.33398C14.1421 8.19633 13.2542 7.26537 12.1343 7.19629C11.7804 7.17434 11.4872 6.88876 11.4722 6.52148C11.3961 4.67009 9.87078 3.19255 8.00049 3.19238C6.51003 3.19238 5.23698 4.13104 4.74365 5.45117C4.65518 5.6874 4.44719 5.85562 4.20166 5.89648C2.87209 6.11777 1.85889 7.27473 1.85889 8.66699Z" fill="currentColor"/>`,
});

export const CloudLight16Icon = createIconComponent(cloudLight16);
