import clsx from "clsx";
import { useLayoutEffect, useRef, type InputHTMLAttributes, type ReactNode, type Ref, type TextareaHTMLAttributes } from "react";

const css = { inputGroup: "_inputGroup_1jhuu_1", numberField: "_numberField_1jhuu_11" } as const;

const fieldBaseClassName =
  "min-w-0 border text-default outline-none placeholder:text-tertiary aria-invalid:border-text-danger aria-invalid:ring-2 aria-invalid:ring-text-danger/20 disabled:cursor-not-allowed disabled:text-secondary";
const forcedColorsFocusClassName =
  "forced-colors:focus:bg-[Highlight] forced-colors:focus:text-[HighlightText] forced-colors:focus:forced-color-adjust-none forced-colors:focus:placeholder:text-[HighlightText]";
const ghostClassName = "border-transparent enabled:hover:bg-primary-ghost-hover focus:bg-primary-ghost-hover";
const autoResizeMaxHeight = 120;

const inputVariantClasses = {
  amount: "h-10 rounded-lg bg-surface px-3 text-sm font-normal tabular-nums",
  auth: "h-14 rounded-full bg-transparent px-5 text-base focus:ring-1 focus:ring-ring",
  code: "h-9 rounded-md bg-primary-soft px-2.5 font-mono text-sm",
  compact: "h-7 rounded-md bg-primary-soft px-2 text-sm",
  plain: "h-7 rounded-md border-transparent bg-transparent p-0 text-sm",
  default: "h-9 rounded-md bg-primary-soft px-2.5 text-sm",
  field: "h-8 rounded-md bg-primary-soft px-2 text-sm",
  form: "h-12 rounded-2xl border-default bg-transparent px-5 text-form-body font-normal",
  grouped: "h-10 rounded-[inherit] border-transparent bg-transparent px-3 text-sm",
  ghost: "h-token-button-composer rounded-md bg-transparent px-2 text-sm",
  heading: "h-9 rounded-sm bg-surface px-2 text-lg font-medium",
  display: "heading-3xl h-14 rounded-sm border-transparent bg-transparent px-2 text-center font-semibold focus:ring-1 focus:ring-ring",
  settings: "rounded-2xl border-default bg-transparent px-4 py-2 text-base",
  inline: "h-11 rounded-xl bg-surface px-3 py-2 text-heading-lg leading-7 font-medium",
  rounded: "h-12 rounded-2xl bg-surface px-4 text-base dark:bg-surface-secondary/92",
  segmented: "h-10 overflow-hidden rounded-xl bg-primary-soft text-sm",
  tags: "min-h-9 max-h-40 overflow-y-auto rounded-md bg-primary-soft px-2 py-1 text-sm",
  transparent: "h-token-button-composer rounded-md border-transparent bg-transparent px-2 text-sm focus:ring-1 focus:ring-ring",
} as const;

export type InputVariant = keyof typeof inputVariantClasses;

/** `className` is not forwarded, matching the bundles' input. */
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "className"> {
  autoSize?: boolean;
  focusRing?: boolean;
  leadingControl?: ReactNode;
  trailingControl?: ReactNode;
  trailingInlineControl?: ReactNode;
  valueSuffix?: ReactNode;
  variant?: InputVariant;
  ref?: Ref<HTMLInputElement>;
}

/** Text input (`Kln` in the bundles). */
export function Input({
  autoSize = false,
  id,
  ref,
  type,
  leadingControl,
  valueSuffix,
  trailingInlineControl,
  trailingControl,
  variant = "default",
  focusRing = true,
  ...rest
}: InputProps) {
  const hasControls = leadingControl != null || valueSuffix != null || trailingInlineControl != null || trailingControl != null;
  const fieldClassName = clsx(
    fieldBaseClassName,
    autoSize ? "field-sizing-content max-w-full" : "w-full",
    inputVariantClasses[variant],
    variant === "ghost" && ghostClassName,
    focusRing && variant === "form" && !hasControls && ["focus:bg-primary-ghost-hover", forcedColorsFocusClassName],
    focusRing && (variant === "plain" ? "focus-visible:ring-1 focus-visible:ring-ring" : variant !== "ghost" && "focus:border-ring"),
    variant !== "ghost" && variant !== "plain" && variant !== "transparent" && variant !== "grouped" && "disabled:bg-text/5",
    variant === "rounded" && "border-subtle",
    variant !== "ghost" &&
      variant !== "plain" &&
      variant !== "rounded" &&
      variant !== "field" &&
      variant !== "form" &&
      variant !== "settings" &&
      variant !== "segmented" &&
      variant !== "grouped" &&
      variant !== "transparent" &&
      variant !== "display" &&
      "border-primary-outline",
    variant === "field" && (rest.disabled ? "border-transparent" : "border-default"),
    variant === "segmented" && "border-default",
    variant === "segmented" && (leadingControl == null ? "ps-3" : "ps-0"),
    variant === "segmented" && (trailingControl == null ? "pe-3" : "pe-0"),
    variant === "field" && trailingControl != null && "overflow-hidden pe-0",
    (variant === "compact" || variant === "field") && type === "number" && "tabular-nums",
  );
  const input = (
    <input
      {...rest}
      id={id}
      ref={ref}
      className={clsx(
        variant === "field" && type === "number" && css.numberField,
        hasControls
          ? clsx(
              "min-w-0 bg-transparent outline-none placeholder:text-tertiary focus:!outline-none disabled:cursor-not-allowed disabled:text-secondary",
              valueSuffix == null ? "flex-1" : "field-sizing-content flex-initial",
              variant === "tags" ? "h-6 basis-32" : "h-full",
              variant === "segmented" && "placeholder:text-codex-description",
              focusRing && variant === "form" && forcedColorsFocusClassName,
            )
          : clsx(fieldClassName, variant === "segmented" && "focus:!outline-none"),
      )}
      type={type}
    />
  );
  if (!hasControls) return input;
  return (
    <div
      className={clsx(
        fieldClassName,
        "flex items-center",
        focusRing && "focus-within:border-ring",
        variant === "form" ? focusRing && "focus-within:bg-primary-ghost-hover" : "forced-colors:focus-within:outline-2 forced-colors:focus-within:outline-solid",
        variant === "tags" ? "flex-wrap gap-1" : "gap-2",
        variant === "auth" && "focus-within:ring-1 focus-within:ring-ring",
        rest.disabled && variant !== "grouped" && "bg-text/5",
      )}
      aria-invalid={rest["aria-invalid"]}
    >
      {leadingControl}
      {valueSuffix == null ? (
        input
      ) : (
        <label className="flex h-full min-w-0 flex-1 cursor-text items-center gap-1">
          {input}
          {valueSuffix}
        </label>
      )}
      {trailingInlineControl}
      {(variant === "segmented" || variant === "field") && trailingControl != null ? (
        <div className={clsx("flex h-full shrink-0 items-center", variant === "segmented" && "border-s border-default")}>{trailingControl}</div>
      ) : (
        trailingControl
      )}
    </div>
  );
}

/** Bordered group of stacked inputs. */
export function InputGroup({ children }: { children?: ReactNode }) {
  return <div className={clsx(css.inputGroup, "divide-y divide-border overflow-hidden rounded-xl border border-default text-sm text-default")}>{children}</div>;
}

export type TextareaVariant =
  | "default"
  | "display"
  | "segmented"
  | "plain"
  | "feedback"
  | "outlined"
  | "rounded"
  | "settings"
  | "compact"
  | "ghost"
  | "code";

export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className"> {
  autoResize?: boolean;
  focusIndicator?: "default" | (string & {});
  trailingControl?: ReactNode;
  variant?: TextareaVariant;
  ref?: Ref<HTMLTextAreaElement>;
}

function fitDisplayText(textarea: HTMLTextAreaElement) {
  const context = document.createElement("canvas").getContext("2d");
  if (context == null || textarea.clientWidth === 0) return;
  textarea.style.fontSize = "var(--text-base)";
  const minFontSize = parseFloat(getComputedStyle(textarea).fontSize);
  textarea.style.fontSize = "";
  const style = getComputedStyle(textarea);
  const fontSize = parseFloat(style.fontSize);
  context.font = style.font;
  context.letterSpacing = style.letterSpacing;
  const textWidth = Math.max(...textarea.value.split("\n").map((line) => context.measureText(line).width));
  const available = textarea.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const nextFontSize = Math.max(minFontSize, Math.min(fontSize, Math.floor((fontSize * available) / (textWidth || 1))));
  textarea.style.fontSize = `${nextFontSize}px`;
  textarea.style.whiteSpace = nextFontSize > minFontSize ? "pre" : "pre-wrap";
  textarea.style.paddingBlock = "";
  textarea.style.minHeight = "0";
  textarea.style.height = "auto";
  const paddingTop = parseFloat(style.paddingTop);
  const contentHeight = textarea.scrollHeight - paddingTop * 2;
  textarea.style.minHeight = "";
  const paddingBlock = Math.max(paddingTop, (textarea.clientHeight - contentHeight) / 2);
  textarea.style.paddingBlock = `${paddingBlock}px`;
  textarea.style.height = `${contentHeight + paddingBlock * 2 + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)}px`;
}

function fitHeight(textarea: HTMLTextAreaElement) {
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight + 2, autoResizeMaxHeight)}px`;
}

function textareaClassName(variant: TextareaVariant) {
  switch (variant) {
    case "display":
      return clsx(
        fieldBaseClassName,
        "heading-3xl min-h-14 w-full resize-none overflow-hidden rounded-sm border-transparent bg-transparent px-2 py-1 text-center font-semibold focus:border-ring focus:ring-1 focus:ring-ring",
      );
    case "segmented":
      return "w-full min-w-0 min-h-24 resize-y bg-transparent px-3 py-2 text-sm text-default outline-none placeholder:text-codex-description focus:!outline-none disabled:cursor-not-allowed disabled:text-secondary";
    case "plain":
      return clsx(fieldBaseClassName, "w-full min-h-24 resize-y rounded-md border-transparent bg-transparent p-0 text-sm focus-visible:ring-1 focus-visible:ring-ring");
    case "feedback":
      return "w-full min-w-0 min-h-20 resize-y rounded-xl border border-default bg-transparent px-3 py-2 text-sm text-default placeholder:text-tertiary focus:border-ring focus:outline-none";
    case "outlined":
      return clsx(fieldBaseClassName, "field-sizing-content w-full min-h-28 max-h-80 resize-none rounded-3xl border-subtle bg-transparent p-5 text-base leading-6 focus:border-ring");
    case "rounded":
      return clsx(fieldBaseClassName, "w-full min-h-26 resize-none rounded-3xl border-subtle bg-surface-secondary/92 px-4 py-4 text-base leading-5 focus:border-ring disabled:bg-text/5");
    default:
      return clsx(
        fieldBaseClassName,
        "w-full",
        variant === "settings"
          ? "min-h-9 max-h-30 resize-none overflow-y-auto rounded-lg border-primary-outline bg-surface px-3 py-2 text-sm leading-5 focus:border-ring disabled:bg-text/5"
          : clsx(
              "rounded-md text-sm",
              variant === "compact" ? "min-h-9 max-h-30 resize-none overflow-y-auto" : "min-h-24 resize-y",
              variant === "ghost" ? clsx(ghostClassName, "bg-transparent px-2 py-0.5") : "border-primary-outline bg-primary-soft px-2.5 py-2 focus:border-ring disabled:bg-text/5",
            ),
      );
  }
}

/** Multi-line text field (`qln` in the bundles). */
export function Textarea({ autoResize = false, focusIndicator = "default", id, onInput, ref, value, variant = "default", trailingControl, ...rest }: TextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (textarea == null) return;
    if (variant === "display") {
      const fit = () => fitDisplayText(textarea);
      fit();
      const observer = new ResizeObserver(fit);
      observer.observe(textarea);
      document.fonts?.addEventListener("loadingdone", fit);
      return () => {
        observer.disconnect();
        document.fonts?.removeEventListener("loadingdone", fit);
      };
    }
    if (autoResize) fitHeight(textarea);
  }, [autoResize, value, variant]);

  const setRefs = (node: HTMLTextAreaElement | null) => {
    textareaRef.current = node;
    if (typeof ref === "function") return ref(node);
    if (ref != null) ref.current = node;
  };
  const textarea = (
    <textarea
      {...rest}
      id={id}
      ref={setRefs}
      className={clsx(
        textareaClassName(variant),
        (variant === "feedback" || variant === "settings" || variant === "compact") && focusIndicator === "default" && "focus:ring-1 focus:ring-ring",
        variant === "code" && "font-mono",
      )}
      value={value}
      onInput={(event) => {
        if (variant === "display") fitDisplayText(event.currentTarget);
        else if (autoResize) fitHeight(event.currentTarget);
        onInput?.(event);
      }}
    />
  );
  if (variant !== "segmented") return textarea;
  return (
    <div
      className={clsx(
        fieldBaseClassName,
        "flex w-full items-start overflow-hidden rounded-xl border-default bg-primary-soft focus-within:border-ring forced-colors:focus-within:outline-2 forced-colors:focus-within:outline-solid",
        rest.disabled && "bg-text/5",
      )}
      aria-invalid={rest["aria-invalid"]}
    >
      {textarea}
      {trailingControl == null ? null : (
        <div className="shrink-0 self-stretch border-s border-default">
          <div className="flex h-10 items-center">{trailingControl}</div>
        </div>
      )}
    </div>
  );
}
