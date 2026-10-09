import clsx from "clsx";

const trackSizeClasses = {
  default: "h-5 w-8",
  sm: "h-4 w-7",
} as const;

const thumbSizeClasses = {
  default:
    "h-4 w-4 data-[state=unchecked]:translate-x-[2px] data-[state=checked]:translate-x-[14px] rtl:data-[state=unchecked]:-translate-x-[2px] rtl:data-[state=checked]:-translate-x-[14px]",
  sm: "h-3 w-3 data-[state=unchecked]:translate-x-[2px] data-[state=checked]:translate-x-[14px] rtl:data-[state=unchecked]:-translate-x-[2px] rtl:data-[state=checked]:-translate-x-[14px]",
} as const;

export interface SwitchIndicatorProps {
  checked?: boolean;
  size?: keyof typeof trackSizeClasses;
  tone?: "accent" | "neutral";
  trackClassName?: string;
  thumbClassName?: string;
}

/** Decorative (aria-hidden) switch track + thumb (`hC` in the bundles); the owning control provides semantics. */
export function SwitchIndicator({ checked, size = "default", tone = "accent", trackClassName, thumbClassName }: SwitchIndicatorProps) {
  const state = checked ? "checked" : "unchecked";
  return (
    <span
      aria-hidden
      className={clsx(
        "relative inline-flex shrink-0 items-center rounded-full transition-colors duration-basic ease-out",
        checked && (tone === "neutral" ? "bg-text" : "bg-chart-blue"),
        !checked && "bg-text/10",
        trackSizeClasses[size],
        trackClassName,
      )}
      data-state={state}
    >
      <span
        className={clsx(
          "rounded-full border shadow-sm transition-transform duration-basic ease-out data-[state=unchecked]:translate-x-0",
          tone === "neutral" && checked ? "border-transparent bg-surface" : "border-control-thumb-on-accent bg-control-thumb-on-accent",
          thumbSizeClasses[size],
          thumbClassName,
        )}
        data-state={state}
      />
    </span>
  );
}
