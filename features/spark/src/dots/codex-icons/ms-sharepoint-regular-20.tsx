import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const msSharepointRegular20 = defineIconAsset({
  name: "ms-sharepoint-regular-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 1.518066, y: 2.578125, width: 16.963867, height: 14.843262 },
    visualBounds: { x: 1.518066, y: 2.578125, width: 16.963867, height: 14.843262 }
  },
  paint: {
    kind: "multicolor",
    layers: [
      {
        role: "accent",
        color: "#000000",
        bounds: { x: 6.819336, y: 6.288818, width: 5.30127, height: 9.54248 },
        foundationToken: "black",
        wideGamut: "color(display-p3 0.000000 0.000000 0.000000 / 1)"
      },
      {
        role: "accent",
        color: "#FFFFFF",
        bounds: { x: 4.168457, y: 7.349365, width: 4.241211, height: 5.30127 },
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
    bounds: { x: 1.518066, y: 2.578125, width: 16.963867, height: 14.843262 },
    center: { x: 10, y: 9.999756 },
    insets: { top: 2.578125, right: 1.518067, bottom: 2.578613, left: 1.518066 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10, y: 9.999756 },
      accent: { x: 8.144531, y: 11.060058 }
    }
  },
  capabilities: ["icon", "mask"],
  body: `<path d="M9.735 12.6507C12.5165 12.6507 14.7713 10.3959 14.7713 7.6144C14.7713 4.83294 12.5165 2.57812 9.735 2.57812C6.95355 2.57812 4.69873 4.83294 4.69873 7.6144C4.69873 10.3959 6.95355 12.6507 9.735 12.6507Z" fill="url(#paint0_linear_41234_1119)"/> <path d="M14.2411 14.7712C16.5834 14.7712 18.4821 12.8724 18.4821 10.5301C18.4821 8.18785 16.5834 6.28906 14.2411 6.28906C11.8988 6.28906 10 8.18785 10 10.5301C10 12.8724 11.8988 14.7712 14.2411 14.7712Z" fill="url(#paint1_linear_41234_1119)"/> <mask id="mask0_41234_1119" maskUnits="userSpaceOnUse" x="6" y="4" width="8" height="14"> <path d="M13.7111 13.9761C13.7111 15.8792 12.1683 17.4219 10.2652 17.4219C8.36208 17.4219 6.81934 15.8792 6.81934 13.9761C6.81934 12.073 6.81934 4.69873 6.81934 4.69873H13.7111C13.7111 4.69873 13.7111 12.7561 13.7111 13.9761Z" fill="#C4C4C4"/> </mask> <g mask="url(#mask0_41234_1119)"> <path d="M10.2652 17.4213C12.1683 17.4213 13.7111 15.8785 13.7111 13.9754C13.7111 12.0723 12.1683 10.5295 10.2652 10.5295C8.3621 10.5295 6.81934 12.0723 6.81934 13.9754C6.81934 15.8785 8.3621 17.4213 10.2652 17.4213Z" fill="url(#paint2_linear_41234_1119)"/> <path d="M5.229 7.87922C5.229 7.00084 5.94105 6.28882 6.81941 6.28882H10.5303C11.4087 6.28882 12.1207 7.00084 12.1207 7.87922V14.2408C12.1207 15.1192 11.4087 15.8312 10.5303 15.8312H5.229V7.87922Z" fill="black" fill-opacity="0.3"/> </g> <path d="M10.0002 5.22876H2.57833C1.99276 5.22876 1.51807 5.70346 1.51807 6.28903V13.7109C1.51807 14.2965 1.99276 14.7712 2.57833 14.7712H10.0002C10.5858 14.7712 11.0605 14.2965 11.0605 13.7109V6.28903C11.0605 5.70346 10.5858 5.22876 10.0002 5.22876Z" fill="url(#paint3_linear_41234_1119)"/> <path d="M8.40953 11.1255C8.40953 10.3036 7.8583 9.94082 6.71132 9.51878C5.81332 9.18559 5.59993 9.08932 5.59993 8.77097C5.59993 8.497 5.86666 8.31188 6.32011 8.31188C6.78245 8.31188 7.21811 8.46736 7.70715 8.73392L8.20506 7.85283C7.68044 7.52707 7.05806 7.34937 6.30233 7.34937C5.14648 7.34937 4.31961 7.94168 4.31961 8.84498C4.31961 9.77049 4.97755 10.0667 6.08005 10.4591C6.96025 10.7701 7.1292 10.9255 7.1292 11.1995C7.1292 11.5253 6.81801 11.6882 6.329 11.6882C5.75108 11.6882 5.24428 11.4883 4.73749 11.1625L4.16846 12.0065C4.79083 12.436 5.56436 12.6507 6.35568 12.6507C7.54711 12.6507 8.40953 12.088 8.40953 11.1255Z" fill="white"/> <defs> <linearGradient id="paint0_linear_41234_1119" x1="4.69873" y1="7.6144" x2="15.6106" y2="7.6144" gradientUnits="userSpaceOnUse"> <stop stop-color="#103A3B"/> <stop offset="1" stop-color="#116B6E"/> </linearGradient> <linearGradient id="paint1_linear_41234_1119" x1="11.0603" y1="8.4096" x2="18.4821" y2="12.6507" gradientUnits="userSpaceOnUse"> <stop stop-color="#1D9097"/> <stop offset="1" stop-color="#29BBC2"/> </linearGradient> <linearGradient id="paint2_linear_41234_1119" x1="7.8796" y1="12.9151" x2="13.7111" y2="15.5658" gradientUnits="userSpaceOnUse"> <stop stop-color="#28A6B5"/> <stop offset="1" stop-color="#31D6EC"/> </linearGradient> <linearGradient id="paint3_linear_41234_1119" x1="1.51807" y1="9.99996" x2="11.8557" y2="9.99996" gradientUnits="userSpaceOnUse"> <stop stop-color="#105557"/> <stop offset="1" stop-color="#116B6E"/> </linearGradient> </defs>`,
});

export const MsSharepointRegular20Icon = createIconComponent(msSharepointRegular20);
