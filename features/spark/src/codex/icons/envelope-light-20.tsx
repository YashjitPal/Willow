import { Icon, type IconProps } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const envelopeLight20 = defineIconAsset({
  name: "envelope-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 1.834961, y: 3.501221, width: 16.330078, height: 12.99707 },
    visualBounds: { x: 1.834961, y: 3.501221, width: 16.330078, height: 12.99707 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.834961, y: 3.501221, width: 16.330078, height: 12.99707 },
    center: { x: 10, y: 9.999756 },
    insets: { top: 3.501221, right: 1.834961, bottom: 3.501709, left: 1.834961 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10, y: 9.999756 },
      foreground: { x: 10, y: 9.999756 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M15.167 3.50122C16.8228 3.5014 18.165 4.84442 18.165 6.50024V13.5002C18.1649 15.1559 16.8227 16.4981 15.167 16.4983H4.83301C3.17733 16.4981 1.83514 15.1559 1.83496 13.5002V6.50024C1.83496 4.84442 3.17722 3.5014 4.83301 3.50122H15.167ZM11.3311 11.5393C10.5373 12.1078 9.47325 12.1223 8.66504 11.5745L3.16504 7.84497V13.5002C3.16522 14.4214 3.91187 15.168 4.83301 15.1682H15.167C16.0881 15.168 16.8348 14.4214 16.835 13.5002V7.59692L11.3311 11.5393ZM4.83301 4.8313C3.99615 4.83146 3.30546 5.4486 3.18555 6.2522L9.41113 10.4729C9.75832 10.7083 10.2156 10.7025 10.5566 10.4583L16.6309 6.10669C16.6737 6.07601 16.7199 6.05264 16.7666 6.03345C16.5645 5.33947 15.926 4.83144 15.167 4.8313H4.83301Z" fill="currentColor"/>`,
});

export function EnvelopeLight20Icon(props: Omit<IconProps, "asset">) {
  return <Icon asset={envelopeLight20} {...props} />;
}
