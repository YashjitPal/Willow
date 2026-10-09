import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const spacesLight20 = defineIconAsset({
  name: "spaces-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
  },
  paint: { kind: "monochrome" },
  optical: { shape: "non-circular" },
  capabilities: ["icon"],
  body: `<defs><mask id="back" maskUnits="userSpaceOnUse" x="-1" y="-1" width="22" height="23"><path d="M-1-1h22v23H-1z" fill="white"/><rect x="1.66016" y="3.46295" width="13.6636" height="3.94167" transform="rotate(-3.9429 1.66016 3.46295)" fill="black"/><rect x="16.127" y="4.28009" width="13.6636" height="13.3934" transform="rotate(86.1575 16.127 4.28009)" fill="black"/></mask></defs><g transform="translate(2 1.88) scale(.8)"><rect x="6.37022" y="0.415331" width="12.67" height="14.67" rx="2.835" transform="rotate(5.30338 6.37022 0.415331)" fill="none" stroke="currentColor" stroke-width="1.6625" mask="url(#back)"/><path fill-rule="evenodd" clip-rule="evenodd" d="M9.36653 4.44879C10.204 4.39334 11.0297 4.6727 11.6611 5.22566L13.6497 6.96724C14.2811 7.52028 14.6668 8.3019 14.7223 9.13941L15.2044 16.4213C15.3197 18.1653 13.9994 19.6731 12.2553 19.7885L4.77171 20.284C3.02766 20.3994 1.52014 19.0789 1.4045 17.3349L0.798928 8.18797C0.683455 6.44381 2.00381 4.93624 3.74797 4.82076L9.36653 4.44879ZM3.83583 6.14794C2.82461 6.21488 2.05915 7.08888 2.1261 8.10011L2.73168 17.2471C2.79879 18.2581 3.67273 19.0238 4.68385 18.9568L12.1675 18.4614C13.1786 18.3944 13.944 17.5203 13.8772 16.5092L13.4807 10.5203L11.2346 10.669C9.9498 10.7541 8.83885 9.78097 8.75366 8.49616L8.57741 5.83402L3.83583 6.14794ZM10.0808 8.40829C10.1175 8.96017 10.5949 9.37841 11.1468 9.34187L13.3909 9.1933C13.3508 8.72067 13.1309 8.28085 12.7734 7.96774L10.7849 6.22616C10.5343 6.00673 10.2306 5.86301 9.90839 5.80365L10.0808 8.40829Z" fill="currentColor" stroke="currentColor" stroke-width=".3325" stroke-linejoin="round"/></g>`,
});

export const SpacesLight20Icon = createIconComponent(spacesLight20);
