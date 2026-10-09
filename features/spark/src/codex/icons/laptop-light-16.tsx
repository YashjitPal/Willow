import { Icon, type IconProps } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const laptopLight16 = defineIconAsset({
  name: "laptop-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 0.611084, y: 2.474609, width: 14.767578, height: 11.262695 },
    visualBounds: { x: 0.611084, y: 2.474609, width: 14.767578, height: 11.262695 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 0.611084, y: 2.474609, width: 14.767578, height: 11.262695 },
    center: { x: 7.994873, y: 8.105957 },
    insets: { top: 2.474609, right: 0.621338, bottom: 2.262696, left: 0.611084 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 7.994873, y: 8.105957 },
      foreground: { x: 7.994873, y: 8.105957 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M12.6667 2.47461C13.6928 2.47479 14.525 3.30694 14.5251 4.33301V10.1445C15.0248 10.184 15.3787 10.6177 15.3787 11.0928V11.9355C15.3785 12.9036 14.6274 13.7373 13.6433 13.7373H2.34644C1.36254 13.7371 0.611273 12.9035 0.611084 11.9355V11.0928C0.611084 10.6149 0.970003 10.1796 1.47437 10.1445V4.33301C1.47454 3.30702 2.3068 2.47492 3.33276 2.47461H12.6667ZM1.66187 11.9355C1.66205 12.3765 1.99397 12.6863 2.34644 12.6865H13.6433C13.9959 12.6865 14.3287 12.3767 14.3289 11.9355V11.1924H1.66187V11.9355ZM3.33276 3.52539C2.8867 3.5257 2.52532 3.88692 2.52515 4.33301V10.1416H13.4744V4.33301C13.4742 3.88684 13.1129 3.52557 12.6667 3.52539H3.33276Z" fill="currentColor"/>`,
});

export function LaptopLight16Icon(props: Omit<IconProps, "asset">) {
  return <Icon asset={laptopLight16} {...props} />;
}
