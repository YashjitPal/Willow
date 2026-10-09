import { Icon, type IconProps } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const laptopSlashLight16 = defineIconAsset({
  name: "laptop-slash-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 0.611328, y: 0.809082, width: 14.579346, height: 14.381348 },
    visualBounds: { x: 0.611328, y: 0.809082, width: 14.579346, height: 14.381348 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 0.611328, y: 0.809082, width: 14.579346, height: 14.381348 },
    center: { x: 7.901001, y: 7.999756 },
    insets: { top: 0.809082, right: 0.809326, bottom: 0.80957, left: 0.611328 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 7.901001, y: 7.999756 },
      foreground: { x: 7.901001, y: 7.999756 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M0.962891 0.962627C1.16787 0.757914 1.50012 0.757887 1.70508 0.962627L15.0371 14.2947C15.2419 14.4996 15.2418 14.8319 15.0371 15.0368C14.8321 15.2418 14.5 15.2417 14.2949 15.0368L12.9922 13.7341C12.9834 13.7345 12.9747 13.737 12.9658 13.737H2.34863C1.39899 13.737 0.611525 12.9839 0.611328 12.0115V12.0075L0.618164 11.0661C0.620137 10.5795 0.996941 10.1811 1.47461 10.1443V4.33372C1.47475 3.75483 1.74147 3.23751 2.1582 2.90013L0.962891 1.70481C0.75807 1.49977 0.757934 1.16758 0.962891 0.962627ZM1.66797 11.1921L1.66211 12.0144C1.66386 12.3891 1.96324 12.6863 2.34863 12.6863H11.9443L10.4502 11.1921H1.66797ZM2.91016 3.65208C2.68004 3.78975 2.52556 4.04403 2.52539 4.33372V10.1413H9.39941L2.91016 3.65208Z" fill="currentColor"/> <path d="M12.667 2.47532C13.693 2.47556 14.5242 3.30769 14.5244 4.33372V9.75071C14.5242 10.0404 14.2897 10.276 14 10.2761C13.7103 10.276 13.4749 10.0404 13.4746 9.75071V4.33372C13.4744 3.88758 13.1131 3.52634 12.667 3.5261H6.97949C6.68982 3.52597 6.45437 3.29036 6.4541 3.00071C6.4541 2.71084 6.68965 2.47545 6.97949 2.47532H12.667Z" fill="currentColor"/>`,
});

export function LaptopSlashLight16Icon(props: Omit<IconProps, "asset">) {
  return <Icon asset={laptopSlashLight16} {...props} />;
}
