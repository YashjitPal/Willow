import clsx from "clsx";
import { useId, type ReactNode } from "react";

export type SettingsRowVariant = "default" | "featured" | "recommendation" | "stacked" | "nested";

type ControlRender = (ids: { "aria-labelledby"?: string; "aria-describedby"?: string }) => ReactNode;

export interface SettingsRowProps {
  label?: ReactNode;
  labelSizing?: "grow" | "content";
  labelWeight?: "medium" | "normal";
  layout?: "default" | "split";
  description?: ReactNode;
  control?: ReactNode | ControlRender;
  controlSizing?: "minimum" | "grow" | "content";
  icon?: ReactNode;
  className?: string;
  id?: string;
  inset?: boolean;
  size?: "default" | "compact";
  variant?: SettingsRowVariant;
  verticalAlignment?: "center" | "start";
}

/** Label column of a settings row (`QOi1Component` in app-shared). */
export function SettingsRowLabel({
  label,
  labelId,
  labelSizing,
  labelWeight,
  description,
  descriptionId,
  icon,
  variant,
  verticalAlignment,
}: Pick<SettingsRowProps, "label" | "description" | "icon" | "variant" | "verticalAlignment"> & {
  labelId?: string;
  descriptionId?: string;
  labelSizing: "grow" | "content";
  labelWeight: "medium" | "normal";
}) {
  return (
    <div className={clsx("flex min-w-0 gap-3", verticalAlignment === "start" ? "items-start" : "items-center", labelSizing === "grow" && "flex-1")}>
      {icon == null ? null : <span className="shrink-0">{icon}</span>}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div
          id={labelId}
          className={clsx(
            "ws-settings-row__label",
            "min-w-0 break-words text-default group-data-[density=compact]/settings:leading-4.5",
            variant === "featured" && "text-base",
            variant === "recommendation" && "text-[13px] leading-[18.571429px]",
            variant !== "featured" && variant !== "recommendation" && "text-sm",
            variant !== "nested" && labelWeight === "medium" && "font-medium",
          )}
        >
          {label}
        </div>
        {description ? (
          <div id={descriptionId} className="ws-settings-row__description min-w-0 text-xs leading-4 text-wrap break-words text-secondary">
            {description}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Settings row with label, description and control (`Ny` / `HOi` in app-shared). */
export function SettingsRow({
  label,
  labelSizing = "grow",
  labelWeight = "medium",
  layout = "default",
  description,
  control,
  controlSizing = "minimum",
  icon,
  className,
  id,
  inset = true,
  size = "default",
  variant = "default",
  verticalAlignment = "center",
}: SettingsRowProps) {
  const reactId = useId();
  const hasLabel = label != null || description != null || icon != null;
  const isRenderControl = typeof control === "function";
  const labelId = isRenderControl && label != null ? `${reactId}-label` : undefined;
  const descriptionId = isRenderControl && description ? `${reactId}-description` : undefined;
  const isSplit = layout === "split" && variant === "default";
  const isInline = layout === "default" && (variant === "default" || variant === "featured" || variant === "recommendation");
  return (
    <div
      id={id}
      className={clsx(
        "ws-settings-row",
        "@container/settings-row",
        inset && (layout !== "split" || variant !== "default") && "px-4",
        inset && variant === "nested" && "group-data-[density=form]/settings:px-5",
        variant === "stacked" &&
          "flex flex-col items-stretch gap-1 py-3 group-data-[density=compact]/settings:gap-0.5 group-data-[density=compact]/settings:py-2.5 group-data-[density=compact]/settings:first:pt-3.5 group-data-[density=compact]/settings:last:pb-4",
        variant === "nested" &&
          "flex min-h-10 justify-between gap-3 py-2 max-sm:min-h-0 max-sm:flex-col max-sm:items-stretch group-data-[density=form]/settings:min-h-12 sm:group-data-[density=form]/settings:py-0",
        variant !== "stacked" && (verticalAlignment === "start" ? "items-start" : "items-center"),
        isSplit && "grid grid-cols-1 gap-2 px-0 py-4 sm:grid-cols-3",
        isInline &&
          clsx(
            "flex justify-between",
            variant === "featured" && clsx("gap-6", size === "compact" ? "min-h-11 py-2" : "py-4"),
            variant !== "featured" && (size === "compact" ? "gap-4 py-2" : "gap-6 py-3"),
          ),
        variant === "recommendation" && "dark:bg-primary-ghost-hover",
        className,
      )}
    >
      {hasLabel ? (
        <SettingsRowLabel
          label={label}
          labelId={labelId}
          labelSizing={labelSizing}
          labelWeight={labelWeight}
          description={description}
          descriptionId={descriptionId}
          icon={icon}
          variant={variant}
          verticalAlignment={verticalAlignment}
        />
      ) : null}
      <div
        className={clsx(
          variant === "stacked" && "w-full",
          variant === "nested" && "flex min-w-0 flex-1 items-center justify-end max-sm:justify-stretch",
          isSplit && clsx("flex min-w-0 max-w-full items-center justify-end gap-2", "sm:col-span-2", controlSizing === "grow" && "w-full"),
          isInline &&
            clsx(
              "flex max-w-full items-center justify-end gap-2",
              controlSizing === "grow" ? "min-w-0 flex-1" : "shrink-0",
              controlSizing === "minimum" && "min-w-[min(--spacing(40),40cqw)] empty:min-w-0",
            ),
        )}
      >
        {isRenderControl ? control({ "aria-labelledby": labelId, "aria-describedby": descriptionId }) : control}
      </div>
    </div>
  );
}
