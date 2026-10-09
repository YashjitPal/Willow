import clsx from "clsx";
import { useRef, type ComponentType, type HTMLAttributes, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type Ref, type SVGProps } from "react";
import { LegacyDatePickerQl2110Icon, LegacyDatePickerUl4d82Icon, LegacyDatePickerZlD6caIcon } from "../icons";
import { composeRefs } from "./compose-refs";
import { DatePickerChunkClassNames } from "./date-picker-chunk-classes";
import { DsButton, type DsButtonSize } from "./ds-button";
import { setPressableScale } from "./pressable-scale";

const css = {
  SelectControl: "_SelectControl_1qm03_1",
  Clear: "_Clear_1qm03_488",
  DropdownIcon: "_DropdownIcon_1qm03_489",
  TriggerText: "_TriggerText_1qm03_525",
  IndicatorWrapper: "_IndicatorWrapper_1qm03_535",
  StartIcon: "_StartIcon_1qm03_543",
  DropdownIconChevron: "_DropdownIconChevron_1qm03_601",
} as const;

export type SelectControlVariant = "outline" | "soft" | "ghost";
export type SelectControlDropdownIconType = "dropdown" | "chevronDown" | "none";

export interface SelectControlProps extends HTMLAttributes<HTMLSpanElement> {
  ref?: Ref<HTMLSpanElement>;
  /** Replaces the default press handling (and the keyboard's synthetic pointer press). */
  onInteract?: () => void;
  invalid?: boolean;
  disabled?: boolean;
  children?: ReactNode;
  variant?: SelectControlVariant;
  size?: DsButtonSize;
  block?: boolean;
  disablePressable?: boolean;
  opticallyAlign?: "start" | "end";
  pill?: boolean;
  onClearClick?: () => void;
  selected?: boolean;
  StartIcon?: ComponentType<SVGProps<SVGSVGElement>>;
  dropdownIconType?: SelectControlDropdownIconType;
}

function stopPropagation(event: ReactPointerEvent) {
  event.stopPropagation();
}

/**
 * `pu` (export `a` of `DatePicker-653dbdbea596.js`): select-style trigger that presses on pointer down; Space and the
 * arrow keys press it too. The clear button shows while `selected` with `onClearClick`. Not yet: `loading`.
 */
export function SelectControl({
  ref,
  onPointerDown,
  onKeyDown,
  onPointerEnter,
  onInteract,
  invalid,
  disabled,
  children,
  className,
  variant = "outline",
  size = "md",
  block,
  disablePressable,
  opticallyAlign,
  pill = false,
  onClearClick,
  selected = false,
  StartIcon,
  dropdownIconType = "dropdown",
  ...rest
}: SelectControlProps) {
  const elementRef = useRef<HTMLSpanElement>(null);
  const showClear = onClearClick != null && selected && !disabled;
  const showDropdown = dropdownIconType !== "none";

  const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
      case " ":
        event.stopPropagation();
        event.preventDefault();
        if (onInteract) onInteract();
        else elementRef.current?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerType: "mouse" }));
        break;
      case "Enter":
        break;
      default:
        onKeyDown?.(event);
    }
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (event.button === 2) return;
    if (onInteract) {
      event.preventDefault();
      onInteract();
      return;
    }
    event.stopPropagation();
    onPointerDown?.(event);
    rest.onClick?.(event);
  };

  return (
    <span
      ref={composeRefs(elementRef, ref)}
      className={clsx(css.SelectControl, className)}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onPointerEnter={(event) => {
        if (!disablePressable) setPressableScale(event);
        onPointerEnter?.(event);
      }}
      onPointerDown={disabled ? undefined : handlePointerDown}
      onKeyDown={disabled ? undefined : handleKeyDown}
      data-variant={variant}
      data-block={block ? "" : undefined}
      data-disable-pressable={disablePressable ? "" : undefined}
      data-pill={pill ? "" : undefined}
      data-size={size}
      data-optically-align={opticallyAlign}
      data-selected={selected}
      data-invalid={invalid ? "" : undefined}
      data-disabled={disabled ? "" : undefined}
      aria-disabled={disabled}
      {...rest}
      onClick={undefined}
    >
      {StartIcon && <StartIcon className={css.StartIcon} />}
      <span className={css.TriggerText}>{children}</span>
      {(showClear || showDropdown) && (
        <div className={css.IndicatorWrapper}>
          {showClear && (
            <DatePickerChunkClassNames>
              <DsButton
                aria-label="Clear current value"
                className={css.Clear}
                onPointerDown={stopPropagation}
                onPointerEnter={setPressableScale}
                onClick={(event) => {
                  event.stopPropagation();
                  event.preventDefault();
                  onClearClick();
                }}
                color="secondary"
                variant={showDropdown ? "ghost" : "solid"}
                size="3xs"
                uniform
                pill={pill}
                squircle={false}
                data-only-child={showDropdown ? undefined : ""}
              >
                <LegacyDatePickerZlD6caIcon />
              </DsButton>
            </DatePickerChunkClassNames>
          )}
          {showDropdown &&
            (dropdownIconType === "chevronDown" ? (
              <LegacyDatePickerUl4d82Icon className={clsx(css.DropdownIcon, css.DropdownIconChevron)} />
            ) : (
              <LegacyDatePickerQl2110Icon className={css.DropdownIcon} />
            ))}
        </div>
      )}
    </span>
  );
}
