import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const msSharepointRegular12 = defineIconAsset({
  name: "ms-sharepoint-regular-12",
  canvas: {
    width: 12,
    height: 12,
    viewBox: "0 0 12 12",
    frame: { x: 0, y: 0, width: 12, height: 12 },
    inkBounds: { x: 0.910645, y: 1.546875, width: 10.178711, height: 8.906006 },
    visualBounds: { x: 0.910645, y: 1.546875, width: 10.178711, height: 8.906006 }
  },
  paint: {
    kind: "multicolor",
    layers: [
      {
        role: "accent",
        color: "#000000",
        bounds: { x: 4.091553, y: 3.773438, width: 3.180664, height: 5.725342 },
        foundationToken: "black",
        wideGamut: "color(display-p3 0.000000 0.000000 0.000000 / 1)"
      },
      {
        role: "accent",
        color: "#FFFFFF",
        bounds: { x: 2.500977, y: 4.409668, width: 2.544678, height: 3.180908 },
        foundationToken: "white",
        wideGamut: "color(display-p3 1.000000 1.000000 1.000000 / 1)"
      },
      { role: "fixed", color: "#103A3B", wideGamut: "color(display-p3 0.0627 0.2275 0.2314)" },
      { role: "fixed", color: "#116B6E", wideGamut: "color(display-p3 0.0667 0.4196 0.4314)" },
      { role: "fixed", color: "#1D9097", wideGamut: "color(display-p3 0.1137 0.5647 0.5922)" },
      { role: "fixed", color: "#29BBC2", wideGamut: "color(display-p3 0.1608 0.7333 0.7608)" },
      { role: "fixed", color: "#28A6B5", wideGamut: "color(display-p3 0.1569 0.6510 0.7098)" },
      { role: "fixed", color: "#31D6EC", wideGamut: "color(display-p3 0.1922 0.8392 0.9255)" },
      { role: "fixed", color: "#105557", wideGamut: "color(display-p3 0.0627 0.3333 0.3412)" }
    ]
  },
  optical: {
    shape: "non-circular",
    bounds: { x: 0.910645, y: 1.546875, width: 10.178711, height: 8.906006 },
    center: { x: 6.000001, y: 5.999878 },
    insets: { top: 1.546875, right: 0.910644, bottom: 1.547119, left: 0.910645 },
    anchors: {
      frame: { x: 6, y: 6 },
      ink: { x: 6.000001, y: 5.999878 },
      accent: { x: 4.886597, y: 6.636109 }
    }
  },
  capabilities: ["icon", "mask"],
  body: `<path d="M5.8411 7.5904C7.50997 7.5904 8.86286 6.23751 8.86286 4.56864C8.86286 2.89976 7.50997 1.54688 5.8411 1.54688C4.17223 1.54688 2.81934 2.89976 2.81934 4.56864C2.81934 6.23751 4.17223 7.5904 5.8411 7.5904Z" fill="url(#paint0_linear_41234_1097)"/> <path d="M8.54464 8.86272C9.95001 8.86272 11.0893 7.72345 11.0893 6.31808C11.0893 4.91271 9.95001 3.77344 8.54464 3.77344C7.13928 3.77344 6 4.91271 6 6.31808C6 7.72345 7.13928 8.86272 8.54464 8.86272Z" fill="url(#paint1_linear_41234_1097)"/> <mask id="mask0_41234_1097" maskUnits="userSpaceOnUse" x="4" y="2" width="5" height="9"> <path d="M8.22635 8.38574C8.22635 9.52762 7.30071 10.4533 6.15883 10.4533C5.01695 10.4533 4.09131 9.52762 4.09131 8.38574C4.09131 7.2439 4.09131 2.81934 4.09131 2.81934H8.22635C8.22635 2.81934 8.22635 7.65378 8.22635 8.38574Z" fill="#C4C4C4"/> </mask> <g mask="url(#mask0_41234_1097)"> <path d="M6.15883 10.4529C7.30069 10.4529 8.22635 9.52725 8.22635 8.38539C8.22635 7.24353 7.30069 6.31787 6.15883 6.31787C5.01697 6.31787 4.09131 7.24353 4.09131 8.38539C4.09131 9.52725 5.01697 10.4529 6.15883 10.4529Z" fill="url(#paint2_linear_41234_1097)"/> <path d="M3.13721 4.72768C3.13721 4.20065 3.56444 3.77344 4.09145 3.77344H6.31801C6.84504 3.77344 7.27225 4.20065 7.27225 4.72768V8.54464C7.27225 9.07167 6.84504 9.49888 6.31801 9.49888H3.13721V4.72768Z" fill="black" fill-opacity="0.3"/> </g> <path d="M5.99993 3.13721H1.54681C1.19546 3.13721 0.910645 3.42203 0.910645 3.77337V8.22649C0.910645 8.57783 1.19546 8.86265 1.54681 8.86265H5.99993C6.35127 8.86265 6.63609 8.57783 6.63609 8.22649V3.77337C6.63609 3.42203 6.35127 3.13721 5.99993 3.13721Z" fill="url(#paint3_linear_41234_1097)"/> <path d="M5.04562 6.67532C5.04562 6.1822 4.71488 5.96454 4.0267 5.71132C3.48789 5.5114 3.35986 5.45364 3.35986 5.26263C3.35986 5.09825 3.5199 4.98717 3.79197 4.98717C4.06937 4.98717 4.33077 5.08047 4.62419 5.2404L4.92294 4.71175C4.60816 4.51629 4.23474 4.40967 3.7813 4.40967C3.08779 4.40967 2.59167 4.76506 2.59167 5.30704C2.59167 5.86234 2.98643 6.04005 3.64793 6.2755C4.17605 6.46208 4.27742 6.55537 4.27742 6.71976C4.27742 6.91522 4.09071 7.01297 3.7973 7.01297C3.45055 7.01297 3.14647 6.89302 2.8424 6.69752L2.50098 7.20397C2.8744 7.46165 3.33852 7.59047 3.81331 7.59047C4.52817 7.59047 5.04562 7.25283 5.04562 6.67532Z" fill="white"/> <defs> <linearGradient id="paint0_linear_41234_1097" x1="2.81934" y1="4.56864" x2="9.36648" y2="4.56864" gradientUnits="userSpaceOnUse"> <stop stop-color="#103A3B"/> <stop offset="1" stop-color="#116B6E"/> </linearGradient> <linearGradient id="paint1_linear_41234_1097" x1="6.63616" y1="5.04576" x2="11.0893" y2="7.5904" gradientUnits="userSpaceOnUse"> <stop stop-color="#1D9097"/> <stop offset="1" stop-color="#29BBC2"/> </linearGradient> <linearGradient id="paint2_linear_41234_1097" x1="4.72747" y1="7.74923" x2="8.22635" y2="9.33963" gradientUnits="userSpaceOnUse"> <stop stop-color="#28A6B5"/> <stop offset="1" stop-color="#31D6EC"/> </linearGradient> <linearGradient id="paint3_linear_41234_1097" x1="0.910645" y1="5.99993" x2="7.11321" y2="5.99993" gradientUnits="userSpaceOnUse"> <stop stop-color="#105557"/> <stop offset="1" stop-color="#116B6E"/> </linearGradient> </defs>`,
});

export const MsSharepointRegular12Icon = createIconComponent(msSharepointRegular12);
