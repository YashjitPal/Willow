import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const arrowDownLeftArrowUpRightSmLight16 = defineIconAsset({
  name: "arrow-down-left-arrow-up-right-sm-light-16",
  canvas: {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    frame: { x: 0, y: 0, width: 16, height: 16 },
    inkBounds: { x: 2.475098, y: 2.474609, width: 11.049805, height: 11.049805 },
    visualBounds: { x: 2.475098, y: 2.474609, width: 11.049805, height: 11.049805 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 2.475098, y: 2.474609, width: 11.049805, height: 11.049805 },
    center: { x: 8, y: 7.999512 },
    insets: { top: 2.474609, right: 2.475097, bottom: 2.475586, left: 2.475098 },
    anchors: {
      frame: { x: 8, y: 8 },
      ink: { x: 8, y: 7.999512 },
      foreground: { x: 8, y: 7.999512 }
    }
  },
  capabilities: ["icon"],
  body: `<path d="M6.16622 8.80776C6.73222 8.80776 7.19146 9.26719 7.19161 9.83315V12.6662C7.19161 12.9561 6.95617 13.1915 6.66622 13.1915C6.37644 13.1913 6.14083 12.956 6.14083 12.6662V10.5939L3.37228 13.3703C3.16754 13.5755 2.83441 13.5759 2.62911 13.3712C2.42414 13.1665 2.4237 12.8343 2.62813 12.629L5.39278 9.85756H3.33321C3.04354 9.85737 2.808 9.62283 2.80782 9.33315C2.80798 9.04345 3.04353 8.80796 3.33321 8.80776H6.16622Z" fill="currentColor"/> <path d="M12.6281 2.62905C12.8326 2.42395 13.1649 2.42297 13.3703 2.6271C13.5757 2.83159 13.5766 3.16477 13.3723 3.37026L10.6125 6.14174H12.6662C12.9561 6.14174 13.1914 6.37636 13.1916 6.66616C13.1916 6.95608 12.9562 7.19155 12.6662 7.19155H9.83321C9.26719 7.19148 8.80785 6.73219 8.80782 6.16616V3.33315C8.80782 3.04324 9.04332 2.80783 9.33321 2.80776C9.62316 2.80776 9.8586 3.0432 9.8586 3.33315V5.4103L12.6281 2.62905Z" fill="currentColor"/>`,
});

export const ArrowDownLeftArrowUpRightSmLight16Icon = createIconComponent(arrowDownLeftArrowUpRightSmLight16);
