import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  type TouchEvent as ReactTouchEvent,
} from "react";

/** Not part of the vendor CSS: the picker injects it at runtime. */
const styles = `.react-colorful{position:relative;display:flex;flex-direction:column;width:200px;height:200px;-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;user-select:none;cursor:default}.react-colorful__saturation{position:relative;flex-grow:1;border-color:transparent;border-bottom:12px solid #000;border-radius:8px 8px 0 0;background-image:linear-gradient(0deg,#000,transparent),linear-gradient(90deg,#fff,hsla(0,0%,100%,0))}.react-colorful__alpha-gradient,.react-colorful__pointer-fill{content:"";position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;border-radius:inherit}.react-colorful__alpha-gradient,.react-colorful__saturation{box-shadow:inset 0 0 0 1px rgba(0,0,0,.05)}.react-colorful__alpha,.react-colorful__hue{position:relative;height:24px}.react-colorful__hue{background:linear-gradient(90deg,red 0,#ff0 17%,#0f0 33%,#0ff 50%,#00f 67%,#f0f 83%,red)}.react-colorful__last-control{border-radius:0 0 8px 8px}.react-colorful__interactive{position:absolute;left:0;top:0;right:0;bottom:0;border-radius:inherit;outline:none;touch-action:none}.react-colorful__pointer{position:absolute;z-index:1;box-sizing:border-box;width:28px;height:28px;transform:translate(-50%,-50%);background-color:#fff;border:2px solid #fff;border-radius:50%;box-shadow:0 2px 4px rgba(0,0,0,.2)}.react-colorful__interactive:focus .react-colorful__pointer{transform:translate(-50%,-50%) scale(1.1)}.react-colorful__alpha,.react-colorful__alpha-pointer{background-color:#fff;background-image:url('data:image/svg+xml;charset=utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill-opacity=".05"><path d="M8 0h8v8H8zM0 8h8v8H0z"/></svg>')}.react-colorful__saturation-pointer{z-index:3}.react-colorful__hue-pointer{z-index:2}`;

interface Hsva {
  h: number;
  s: number;
  v: number;
  a: number;
}

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface Interaction {
  left: number;
  top: number;
}

const clamp = (value: number, min = 0, max = 1) => (value > max ? max : value < min ? min : value);
const round = (value: number, digits = 0, base = 10 ** digits) => Math.round(base * value) / base;
const formatClassName = (names: (string | false | undefined)[]) => names.filter(Boolean).join(" ");

const hexToRgba = (hex: string): Rgba => {
  if (hex[0] === "#") hex = hex.substring(1);
  if (hex.length < 6) {
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
      a: hex.length === 4 ? round(parseInt(hex[3] + hex[3], 16) / 255, 2) : 1,
    };
  }
  return {
    r: parseInt(hex.substring(0, 2), 16),
    g: parseInt(hex.substring(2, 4), 16),
    b: parseInt(hex.substring(4, 6), 16),
    a: hex.length === 8 ? round(parseInt(hex.substring(6, 8), 16) / 255, 2) : 1,
  };
};

const rgbaToHsva = ({ r, g, b, a }: Rgba): Hsva => {
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  const hh = delta ? (max === r ? (g - b) / delta : max === g ? 2 + (b - r) / delta : 4 + (r - g) / delta) : 0;
  return { h: round(60 * (hh < 0 ? hh + 6 : hh)), s: round(max ? (delta / max) * 100 : 0), v: round((max / 255) * 100), a };
};

const hsvaToRgba = ({ h, s, v, a }: Hsva): Rgba => {
  h = (h / 360) * 6;
  s = s / 100;
  v = v / 100;
  const hh = Math.floor(h);
  const b = v * (1 - s);
  const c = v * (1 - (h - hh) * s);
  const d = v * (1 - (1 - h + hh) * s);
  const index = hh % 6;
  return {
    r: round(255 * [v, c, b, b, d, v][index]),
    g: round(255 * [d, v, v, c, b, b][index]),
    b: round(255 * [b, b, d, v, v, c][index]),
    a: round(a, 2),
  };
};

const hsvaToHslString = ({ h, s, v, a }: Hsva) => {
  const hh = ((200 - s) * v) / 100;
  const hsla = {
    h: round(h),
    s: round(hh > 0 && hh < 200 ? ((s * v) / 100 / (hh <= 100 ? hh : 200 - hh)) * 100 : 0),
    l: round(hh / 2),
    a: round(a, 2),
  };
  return `hsl(${hsla.h}, ${hsla.s}%, ${hsla.l}%)`;
};

const format = (number: number) => {
  const hex = number.toString(16);
  return hex.length < 2 ? `0${hex}` : hex;
};

const rgbaToHex = ({ r, g, b, a }: Rgba) => `#${format(r)}${format(g)}${format(b)}${a < 1 ? format(round(255 * a)) : ""}`;

const equalColorObjects = (first: Hsva | Rgba, second: Hsva | Rgba) => {
  if (first === second) return true;
  for (const prop in first) {
    if (first[prop as keyof typeof first] !== second[prop as keyof typeof second]) return false;
  }
  return true;
};

interface ColorModel {
  defaultColor: string;
  toHsva: (color: string) => Hsva;
  fromHsva: (hsva: Hsva) => string;
  equal: (first: string, second: string) => boolean;
}

const hexColorModel: ColorModel = {
  defaultColor: "000",
  toHsva: (hex) => rgbaToHsva(hexToRgba(hex)),
  fromHsva: ({ h, s, v }) => rgbaToHex(hsvaToRgba({ h, s, v, a: 1 })),
  equal: (first, second) => first.toLowerCase() === second.toLowerCase() || equalColorObjects(hexToRgba(first), hexToRgba(second)),
};

function useEventCallback<Args extends unknown[]>(handler: ((...args: Args) => void) | undefined) {
  const callbackRef = useRef(handler);
  const fn = useRef((...args: Args) => {
    callbackRef.current?.(...args);
  });
  useLayoutEffect(() => {
    callbackRef.current = handler;
  });
  return fn.current;
}

const isTouch = (event: MouseEvent | TouchEvent): event is TouchEvent => "touches" in event;
const getParentWindow = (node: HTMLDivElement | null) => node?.ownerDocument.defaultView ?? self;

function getTouchPoint(touches: TouchList, touchId: number | null) {
  for (let index = 0; index < touches.length; index++) {
    if (touches[index].identifier === touchId) return touches[index];
  }
  return touches[0];
}

function getRelativePosition(node: HTMLDivElement, event: MouseEvent | TouchEvent, touchId: number | null): Interaction {
  const rect = node.getBoundingClientRect();
  const pointer = isTouch(event) ? getTouchPoint(event.touches, touchId) : event;
  return {
    left: clamp((pointer.pageX - (rect.left + getParentWindow(node).pageXOffset)) / rect.width),
    top: clamp((pointer.pageY - (rect.top + getParentWindow(node).pageYOffset)) / rect.height),
  };
}

const preventDefaultMove = (event: MouseEvent | TouchEvent) => {
  if (!isTouch(event)) event.preventDefault();
};

interface InteractiveProps extends Omit<HTMLAttributes<HTMLDivElement>, "onKeyDown" | "onKeyUp" | "onMouseDown" | "onTouchStart"> {
  onMove: (interaction: Interaction) => void;
  onKey: (offset: Interaction) => void;
  onEnd?: () => void;
}

const Interactive = memo(function Interactive({ onMove, onKey, onEnd, ...rest }: InteractiveProps) {
  const container = useRef<HTMLDivElement>(null);
  const onMoveCallback = useEventCallback(onMove);
  const onKeyCallback = useEventCallback(onKey);
  const onEndCallback = useEventCallback(onEnd);
  const touchId = useRef<number | null>(null);
  const hasTouch = useRef(false);

  const [handleMoveStart, handleKeyDown, handleKeyUp, toggleDocumentEvents] = useMemo(() => {
    const handleMove = (event: MouseEvent | TouchEvent) => {
      preventDefaultMove(event);
      const isDown = isTouch(event) ? event.touches.length > 0 : event.buttons > 0;
      if (isDown && container.current) {
        onMoveCallback(getRelativePosition(container.current, event, touchId.current));
      } else {
        toggleDocumentEvents(false);
        onEndCallback();
      }
    };
    const handleMoveEnd = () => {
      toggleDocumentEvents(false);
      onEndCallback();
    };
    function toggleDocumentEvents(state?: boolean) {
      const touch = hasTouch.current;
      const parentWindow = getParentWindow(container.current);
      if (state) {
        parentWindow.addEventListener(touch ? "touchmove" : "mousemove", handleMove);
        parentWindow.addEventListener(touch ? "touchend" : "mouseup", handleMoveEnd);
      } else {
        parentWindow.removeEventListener(touch ? "touchmove" : "mousemove", handleMove);
        parentWindow.removeEventListener(touch ? "touchend" : "mouseup", handleMoveEnd);
      }
    }
    const handleMoveStart = ({ nativeEvent }: ReactMouseEvent | ReactTouchEvent) => {
      const element = container.current;
      if (!element) return;
      preventDefaultMove(nativeEvent);
      if (hasTouch.current && !isTouch(nativeEvent)) return;
      if (isTouch(nativeEvent)) {
        hasTouch.current = true;
        const changedTouches = nativeEvent.changedTouches || [];
        if (changedTouches.length) touchId.current = changedTouches[0].identifier;
      }
      element.focus();
      onMoveCallback(getRelativePosition(element, nativeEvent, touchId.current));
      toggleDocumentEvents(true);
    };
    const handleKeyDown = (event: ReactKeyboardEvent) => {
      const keyCode = event.which || event.keyCode;
      if (keyCode < 37 || keyCode > 40) return;
      event.preventDefault();
      onKeyCallback({ left: keyCode === 39 ? 0.05 : keyCode === 37 ? -0.05 : 0, top: keyCode === 40 ? 0.05 : keyCode === 38 ? -0.05 : 0 });
    };
    const handleKeyUp = (event: ReactKeyboardEvent) => {
      const keyCode = event.which || event.keyCode;
      if (keyCode >= 37 && keyCode <= 40) onEndCallback();
    };
    return [handleMoveStart, handleKeyDown, handleKeyUp, toggleDocumentEvents] as const;
  }, [onKeyCallback, onMoveCallback, onEndCallback]);

  useEffect(() => () => toggleDocumentEvents(), [toggleDocumentEvents]);

  return (
    <div
      {...rest}
      onTouchStart={handleMoveStart}
      onMouseDown={handleMoveStart}
      className="react-colorful__interactive"
      ref={container}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      tabIndex={0}
      role="slider"
    />
  );
});

function Pointer({ className, color, left, top = 0.5 }: { className: string; color: string; left: number; top?: number }) {
  return (
    <div className={formatClassName(["react-colorful__pointer", className])} style={{ top: `${100 * top}%`, left: `${100 * left}%` }}>
      <div className="react-colorful__pointer-fill" style={{ backgroundColor: color }} />
    </div>
  );
}

interface ControlProps {
  onChange: (hsva: Partial<Hsva>) => void;
  onChangeEnd: () => void;
}

const Hue = memo(function Hue({ className, hue, onChange, onChangeEnd }: ControlProps & { className: string; hue: number }) {
  return (
    <div className={formatClassName(["react-colorful__hue", className])}>
      <Interactive
        onMove={(interaction) => onChange({ h: 360 * interaction.left })}
        onKey={(offset) => onChange({ h: clamp(hue + 360 * offset.left, 0, 360) })}
        onEnd={onChangeEnd}
        aria-label="Hue"
        aria-valuenow={round(hue)}
        aria-valuemax={360}
        aria-valuemin={0}
      >
        <Pointer className="react-colorful__hue-pointer" left={hue / 360} color={hsvaToHslString({ h: hue, s: 100, v: 100, a: 1 })} />
      </Interactive>
    </div>
  );
});

const Saturation = memo(function Saturation({ hsva, onChange, onChangeEnd }: ControlProps & { hsva: Hsva }) {
  return (
    <div className="react-colorful__saturation" style={{ backgroundColor: hsvaToHslString({ h: hsva.h, s: 100, v: 100, a: 1 }) }}>
      <Interactive
        onMove={(interaction) => onChange({ s: 100 * interaction.left, v: 100 - 100 * interaction.top })}
        onKey={(offset) => onChange({ s: clamp(hsva.s + 100 * offset.left, 0, 100), v: clamp(hsva.v - 100 * offset.top, 0, 100) })}
        onEnd={onChangeEnd}
        aria-label="Color"
        aria-valuetext={`Saturation ${round(hsva.s)}%, Brightness ${round(hsva.v)}%`}
      >
        <Pointer className="react-colorful__saturation-pointer" top={1 - hsva.v / 100} left={hsva.s / 100} color={hsvaToHslString(hsva)} />
      </Interactive>
    </div>
  );
});

function useColorManipulation(colorModel: ColorModel, color: string, onChange?: (color: string) => void, onChangeEnd?: (color: string) => void) {
  const onChangeCallback = useEventCallback(onChange);
  const onChangeEndCallback = useEventCallback(onChangeEnd);
  const [hsva, updateHsva] = useState(() => colorModel.toHsva(color));
  const cache = useRef({ color, hsva });
  const changed = useRef(false);

  useEffect(() => {
    if (!colorModel.equal(color, cache.current.color)) {
      const newHsva = colorModel.toHsva(color);
      cache.current = { hsva: newHsva, color };
      updateHsva(newHsva);
      changed.current = false;
    }
  }, [color, colorModel]);

  useEffect(() => {
    if (equalColorObjects(hsva, cache.current.hsva)) return;
    const newColor = colorModel.fromHsva(hsva);
    if (colorModel.equal(newColor, cache.current.color)) return;
    cache.current = { hsva, color: newColor };
    onChangeCallback(newColor);
    changed.current = true;
  }, [hsva, colorModel, onChangeCallback]);

  const handleChange = useCallback((params: Partial<Hsva>) => {
    updateHsva((current) => ({ ...current, ...params }));
  }, []);

  const handleChangeEnd = useCallback(() => {
    if (!changed.current) return;
    changed.current = false;
    onChangeEndCallback(cache.current.color);
  }, [onChangeEndCallback]);

  return [hsva, handleChange, handleChangeEnd] as const;
}

const styleSheets = new WeakMap<Document | ShadowRoot, HTMLStyleElement>();

function useStyleSheet(nodeRef: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const node = nodeRef.current;
    if (typeof document === "undefined" || !node) return;
    const rootNode = node.getRootNode ? node.getRootNode() : node.ownerDocument;
    const parentDocument = (rootNode && ("head" in rootNode || "host" in rootNode) ? rootNode : node.ownerDocument) as Document | ShadowRoot;
    if (styleSheets.has(parentDocument)) return;
    const head = "head" in parentDocument ? parentDocument.head : parentDocument;
    const styleElement = (head.ownerDocument || document).createElement("style");
    styleElement.innerHTML = styles;
    styleSheets.set(parentDocument, styleElement);
    head.appendChild(styleElement);
  }, [nodeRef]);
}

export interface HexColorPickerProps extends Omit<HTMLAttributes<HTMLDivElement>, "color" | "onChange" | "children"> {
  color?: string;
  onChange?: (color: string) => void;
  onChangeEnd?: (color: string) => void;
}

/** dist `t` (`I`): react-colorful's hex picker (saturation area + hue slider), with `onChangeEnd` after a drag or arrow key. */
export function HexColorPicker({ className, color = hexColorModel.defaultColor, onChange, onChangeEnd, ...rest }: HexColorPickerProps) {
  const nodeRef = useRef<HTMLDivElement>(null);
  useStyleSheet(nodeRef);
  const [hsva, updateHsva, handleChangeEnd] = useColorManipulation(hexColorModel, color, onChange, onChangeEnd);
  return (
    <div {...rest} ref={nodeRef} className={formatClassName(["react-colorful", className])}>
      <Saturation hsva={hsva} onChange={updateHsva} onChangeEnd={handleChangeEnd} />
      <Hue hue={hsva.h} onChange={updateHsva} onChangeEnd={handleChangeEnd} className="react-colorful__last-control" />
    </div>
  );
}
