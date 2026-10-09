import { Icon, type IconProps } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const pauseCircleLight16 = defineIconAsset({
  name: "pause-circle-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 1.533203, y: 1.533203, width: 12.933594, height: 12.933594 },
    visualBounds: { x: 1.533203, y: 1.533203, width: 12.933594, height: 12.933594 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "circular",
    bounds: { x: 1.533203, y: 1.533203, width: 12.933594, height: 12.933594 },
    center: { x: 8, y: 8 },
    insets: { top: 1.533203, right: 1.533203, bottom: 1.533203, left: 1.533203 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8, y: 8 },
      foreground: { x: 8, y: 8 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M6.88867 5.83496C7.10752 5.83522 7.28516 6.01254 7.28516 6.23145V9.76953C7.28498 9.98829 7.10741 10.1658 6.88867 10.166H6.19043C5.97147 10.166 5.79412 9.98845 5.79395 9.76953V6.23145C5.79395 6.01237 5.97136 5.83496 6.19043 5.83496H6.88867Z" fill="currentColor"/> <path d="M9.79785 5.83496C10.0169 5.83503 10.1943 6.01241 10.1943 6.23145V9.76953C10.1942 9.98841 10.0168 10.1659 9.79785 10.166H9.09961C8.88081 10.1658 8.7033 9.98833 8.70312 9.76953V6.23145C8.70312 6.01249 8.8807 5.83516 9.09961 5.83496H9.79785Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M8 1.5332C11.5714 1.5332 14.4668 4.42856 14.4668 8C14.4668 11.5714 11.5714 14.4668 8 14.4668C4.42856 14.4668 1.5332 11.5714 1.5332 8C1.5332 4.42856 4.42856 1.5332 8 1.5332ZM8 2.4668C4.94402 2.4668 2.4668 4.94402 2.4668 8C2.4668 11.056 4.94402 13.5332 8 13.5332C11.056 13.5332 13.5332 11.056 13.5332 8C13.5332 4.94402 11.056 2.4668 8 2.4668Z" fill="currentColor"/>`,
});

export function PauseCircleLight16Icon(props: Omit<IconProps, "asset">) {
  return <Icon asset={pauseCircleLight16} {...props} />;
}
