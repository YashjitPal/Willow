import { useEffect, useEffectEvent, useRef, useState } from "react";
import { SymbolBrowser } from "./symbol-browser";
import { SymbolPickerBase, type SymbolPickerProps } from "./symbol-picker";

export type InlineSymbolPickerProps = SymbolPickerProps & {
  /** Text typed after the trigger; searching in the picker overrides it until the typed text changes. */
  query: string;
  /** Element that keeps focus and drives the grid with the arrow keys, Home/End and Enter. */
  keyboardTarget: HTMLElement;
  onDismiss: () => void;
};

/** `C1Component` (`inline-5543a79ea211.js`): `RXt` with the browser chunk loaded up front. */
function EagerSymbolPicker(props: SymbolPickerProps) {
  return <SymbolPickerBase {...props} content={SymbolBrowser} />;
}

/**
 * `t` of `inline-5543a79ea211.js` (`FComponent`): the symbol picker as autocomplete for text typed in an
 * editor. Escape, a pointer down outside both elements, or focus leaving both dismisses it.
 */
export function InlineSymbolPicker({ query: inlineQuery, keyboardTarget, onDismiss, ...props }: InlineSymbolPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState<{ inlineQuery: string; manualQuery: string | undefined }>({ inlineQuery, manualQuery: undefined });
  if (search.inlineQuery !== inlineQuery) setSearch({ inlineQuery, manualQuery: undefined });

  const onPointerDown = useEffectEvent((event: PointerEvent) => {
    if (event.target instanceof Node && !containerRef.current?.contains(event.target) && !keyboardTarget.contains(event.target)) onDismiss();
  });
  useEffect(() => {
    const ownerDocument = keyboardTarget.ownerDocument;
    const listener = (event: PointerEvent) => onPointerDown(event);
    ownerDocument.addEventListener("pointerdown", listener, true);
    return () => ownerDocument.removeEventListener("pointerdown", listener, true);
  }, [keyboardTarget]);

  return (
    <div
      ref={containerRef}
      role="presentation"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget) && !keyboardTarget.contains(event.relatedTarget) && keyboardTarget.ownerDocument.hasFocus()) {
          onDismiss();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.stopPropagation();
          onDismiss();
          keyboardTarget.focus();
        }
      }}
    >
      <EagerSymbolPicker
        {...props}
        autoFocus={false}
        keyboardTarget={keyboardTarget}
        query={search.manualQuery ?? inlineQuery}
        inputValue={search.manualQuery ?? ""}
        onQueryChange={(manualQuery) => setSearch({ inlineQuery, manualQuery })}
      />
    </div>
  );
}
