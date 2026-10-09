import { createIconComponent } from "./icon";
import { defineIconAsset } from "./icon-asset";

export const shoppingBagLight32 = defineIconAsset({
  name: "shopping-bag-light-32",
  canvas: {
    width: 32,
    height: 32,
    viewBox: "0 0 32 32",
    frame: { x: 0, y: 0, width: 32, height: 32 },
    inkBounds: { x: 4.100098, y: 3.099609, width: 23.800598, height: 25.800781 },
    visualBounds: { x: 4.100098, y: 3.099609, width: 23.800598, height: 25.800781 }
  },
  paint: { kind: "monochrome" },
  optical: {
    shape: "non-circular",
    bounds: { x: 4.100098, y: 3.099609, width: 23.800598, height: 25.800781 },
    center: { x: 16.000397, y: 16 },
    insets: { top: 3.099609, right: 4.099304, bottom: 3.09961, left: 4.100098 },
    anchors: {
      frame: { x: 16, y: 16 },
      ink: { x: 16.000397, y: 16 },
      foreground: { x: 16.000397, y: 16 }
    }
  },
  capabilities: ["icon"],
  body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M16.0002 3.09961C19.2707 3.09974 20.9006 5.69499 20.9006 8V8.09961H21.8772C24.2804 8.09974 26.3202 9.88068 26.5871 12.2607L27.8713 23.7109C28.1835 26.4958 25.9678 28.9002 23.1614 28.9004H8.83909C6.02044 28.9004 3.80117 26.4757 4.13303 23.6807L5.49241 12.2314C5.77346 9.86453 7.80663 8.09966 10.1985 8.09961H11.0998V8C11.0998 5.69493 12.7296 3.09961 16.0002 3.09961ZM10.1985 9.90039C8.69517 9.90044 7.45029 11.0052 7.27952 12.4434L5.92014 23.8936C5.71955 25.5847 7.06531 27.0996 8.83909 27.0996H23.1614C24.9275 27.0995 26.2712 25.5964 26.0823 23.9111L24.7981 12.4619C24.6359 11.016 23.3877 9.90052 21.8772 9.90039H20.9006V12C20.9006 12.497 20.4972 12.9003 20.0002 12.9004C19.5032 12.9004 19.0998 12.4971 19.0998 12V9.90039H12.9006V12C12.9006 12.497 12.4972 12.9003 12.0002 12.9004C11.5032 12.9004 11.0998 12.4971 11.0998 12V9.90039H10.1985ZM16.0002 4.90039C13.9375 4.90039 12.9006 6.46085 12.9006 8V8.09961H19.0998V8C19.0998 6.46091 18.0628 4.90051 16.0002 4.90039Z" fill="currentColor"/>`,
});

export const ShoppingBagLight32Icon = createIconComponent(shoppingBagLight32);
