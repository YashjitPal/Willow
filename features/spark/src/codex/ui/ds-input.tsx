import clsx from "clsx";
import { useEffect, useId, useRef, useState, type AnimationEvent, type InputHTMLAttributes, type MouseEvent, type ReactNode, type Ref } from "react";

const css = { container: "_Container_1pj83_2", input: "_Input_1pj83_2" } as const;

export interface DsInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "className"> {
  className?: string;
  inputClassName?: string;
  variant?: "outline" | "soft";
  size?: "3xs" | "2xs" | "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";
  gutterSize?: "2xs" | "xs" | "sm" | "md" | "lg" | "xl";
  invalid?: boolean;
  pill?: boolean;
  opticallyAlign?: "start" | "end";
  allowAutofillExtensions?: boolean;
  autoSelect?: boolean;
  startAdornment?: ReactNode;
  endAdornment?: ReactNode;
  onAutofill?: () => void;
  ref?: Ref<HTMLInputElement>;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T) {
  if (typeof ref === "function") ref(value);
  else if (ref != null) ref.current = value;
}

/** `Sz` (`bRo`, app-initial): design-system text input with optional adornments inside its frame. */
export function DsInput({
  id,
  name,
  type = "text",
  variant = "outline",
  size = "md",
  gutterSize,
  className,
  autoComplete,
  disabled = false,
  readOnly = false,
  invalid = false,
  allowAutofillExtensions = type === "password" || !!name || (!!autoComplete && autoComplete !== "off"),
  onFocus,
  onBlur,
  onAnimationStart,
  onAutofill,
  autoSelect,
  startAdornment,
  endAdornment,
  inputClassName,
  pill = false,
  opticallyAlign,
  ref,
  ...rest
}: DsInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fallbackId = `search-ui-input-${useId()}`;
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (autoSelect) inputRef.current?.select();
  }, [autoSelect]);

  const onMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    const input = inputRef.current;
    const target = event.target;
    if (!(target instanceof Element) || input == null || input.contains(target) || target.closest("button, [type='button'], [role='button'], [role='menuitem']")) return;
    event.preventDefault();
    if (document.activeElement !== input) input.focus();
    const { left, top } = input.getBoundingClientRect();
    const before = event.clientY < top || event.clientX < left;
    if (event.detail === 1) {
      const caret = before ? 0 : input.value.length;
      input.setSelectionRange(caret, caret);
    } else if (event.detail === 2) {
      const words = input.value.match(/\w+|[^\w\s]/g) ?? [];
      const word = before ? words.at(0) : words.at(-1);
      if (word) {
        const start = before ? input.value.indexOf(word) : input.value.lastIndexOf(word);
        input.setSelectionRange(start, start + word.length);
      }
    } else {
      input.select();
    }
  };

  const handleAnimationStart = (event: AnimationEvent<HTMLInputElement>) => {
    onAnimationStart?.(event);
    if (event.animationName === "native-autofill-in") onAutofill?.();
  };

  return (
    <div
      className={clsx(css.container, className)}
      data-variant={variant}
      data-size={size}
      data-gutter-size={gutterSize}
      data-focused={focused}
      data-disabled={disabled ? "" : undefined}
      data-readonly={readOnly ? "" : undefined}
      data-invalid={invalid ? "" : undefined}
      data-pill={pill ? "" : undefined}
      data-optically-align={opticallyAlign}
      data-has-start-adornment={startAdornment ? "" : undefined}
      data-has-end-adornment={endAdornment ? "" : undefined}
      onMouseDown={onMouseDown}
    >
      {startAdornment}
      <input
        {...rest}
        ref={(node) => {
          inputRef.current = node;
          assignRef(ref, node);
        }}
        id={id || (allowAutofillExtensions ? undefined : fallbackId)}
        className={clsx(css.input, inputClassName)}
        type={type}
        name={name}
        autoComplete={autoComplete}
        readOnly={readOnly}
        disabled={disabled}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        onAnimationStart={handleAnimationStart}
        data-lpignore={!allowAutofillExtensions || undefined}
        data-1p-ignore={!allowAutofillExtensions || undefined}
      />
      {endAdornment}
    </div>
  );
}
