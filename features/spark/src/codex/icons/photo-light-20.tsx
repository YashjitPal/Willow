import { Icon, type IconProps } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const photoLight20 = defineIconAsset({
  name: "photo-light-20",
  canvas: {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    frame: { x: 0, y: 0, width: 20, height: 20 },
    inkBounds: { x: 1.834961, y: 2.668457, width: 16.330078, height: 14.663086 },
    visualBounds: { x: 1.834961, y: 2.668457, width: 16.330078, height: 14.663086 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 1.834961, y: 2.668457, width: 16.330078, height: 14.663086 },
    center: { x: 10, y: 10 },
    insets: { top: 2.668457, right: 1.834961, bottom: 2.668457, left: 1.834961 },
    anchors: {
      frame: { x: 10, y: 10 },
      ink: { x: 10, y: 10 },
      foreground: { x: 10, y: 10 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M12.5723 5.54724C13.9887 5.54745 15.1367 6.69619 15.1367 8.11267C15.1364 9.52892 13.9885 10.6769 12.5723 10.6771C11.1558 10.6771 10.0071 9.52905 10.0068 8.11267C10.0068 6.69606 11.1557 5.54724 12.5723 5.54724ZM12.5723 6.87732C11.8902 6.87732 11.3369 7.4306 11.3369 8.11267C11.3372 8.79451 11.8904 9.34705 12.5723 9.34705C13.254 9.34683 13.8064 8.79438 13.8066 8.11267C13.8066 7.43073 13.2542 6.87753 12.5723 6.87732Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M15.0332 2.66833C16.7628 2.66833 18.165 4.0706 18.165 5.80017V14.1996C18.165 15.9292 16.7628 17.3314 15.0332 17.3314H4.9668C3.23723 17.3314 1.83496 15.9292 1.83496 14.1996V5.80017C1.83496 4.0706 3.23723 2.66833 4.9668 2.66833H15.0332ZM4.9668 3.99841C3.97176 3.99841 3.16504 4.80514 3.16504 5.80017V11.8031L4.31348 10.6547C5.35418 9.61441 7.04236 9.61425 8.08301 10.6547L13.4307 16.0013H15.0332C16.0282 16.0013 16.835 15.1946 16.835 14.1996V5.80017C16.835 4.80514 16.0282 3.99841 15.0332 3.99841H4.9668ZM7.14258 11.5951C6.62134 11.074 5.77524 11.0752 5.25391 11.5961L3.16504 13.6849V14.1996C3.16504 15.1946 3.97176 16.0013 4.9668 16.0013H11.5488L7.14258 11.5951Z" fill="currentColor"/>`,
});

export function PhotoLight20Icon(props: Omit<IconProps, "asset">) {
  return <Icon asset={photoLight20} {...props} />;
}
