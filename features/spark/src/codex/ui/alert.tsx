import clsx from "clsx";
import type { ComponentType, ReactNode } from "react";
import { useIntl } from "react-intl";
import { Icon } from "../icons/icon";
import { xmarkMdLight16 } from "../icons/xmark-md-light-16";

export type AlertLevel = "info" | "success" | "warning" | "danger";
export type AlertVariant = "default" | "successNeutral" | "chatgptSuccess" | "dangerSolid";

export interface AlertProps {
  actions?: ReactNode;
  actionsInline?: boolean;
  announce?: boolean;
  className?: string;
  level?: AlertLevel;
  fullWidth?: boolean;
  children?: ReactNode;
  contentAlignment?: "start" | "center";
  icon?: ComponentType<{ className?: string }>;
  leading?: ReactNode;
  onRemove?: () => void;
  richColors?: boolean;
  testId?: string;
  variant?: AlertVariant;
}

/** `Lb` in app-shared. */
export function Alert({
  actions,
  actionsInline = false,
  announce = true,
  className,
  level = "info",
  fullWidth,
  children,
  contentAlignment,
  icon: IconComponent,
  leading,
  onRemove,
  richColors = false,
  testId,
  variant = "default",
}: AlertProps) {
  const intl = useIntl();
  const isDefault = variant === "default";
  const rootClassName = clsx(
    "alert-root inline-flex flex-col gap-2 rounded-xl px-3 py-2 text-base leading-[1.4] pointer-events-auto box-shadow-lg border",
    {
      flex: fullWidth,
      "border-default bg-surface-elevated-secondary": isDefault && (level === "info" || (level === "success" && !richColors)),
      "border-text-success/20 bg-background-success-surface": isDefault && level === "success" && richColors,
      "border-transparent bg-primary-solid text-primary-solid": variant === "successNeutral",
      "border-transparent bg-(--color-background-chatgpt-success-solid) text-success-solid": variant === "chatgptSuccess",
      "border-transparent bg-danger-solid text-danger-solid": variant === "dangerSolid",
      "border-warning-outline bg-warning-surface": isDefault && level === "warning",
      "border-danger-outline bg-danger-surface": isDefault && level === "danger",
      "text-default": isDefault && (!richColors || level === "info"),
      "text-success": isDefault && richColors && level === "success",
      "text-warning": isDefault && richColors && level === "warning",
      "text-danger": isDefault && richColors && level === "danger",
    },
    className,
  );
  const leadingNode =
    leading != null || IconComponent ? (
      <div
        className={clsx(
          "flex size-6 shrink-0 grow-0 items-center justify-center",
          contentAlignment !== "center" && "self-start",
          isDefault && !richColors && "text-default",
        )}
      >
        {leading ?? (IconComponent ? <IconComponent className="icon-xs" /> : null)}
      </div>
    ) : null;
  const body = typeof children === "string" ? <div className="font-medium">{children}</div> : children;
  return (
    <div className={rootClassName} role={announce ? "alert" : undefined} data-testid={testId}>
      <div className={clsx("flex min-w-0", contentAlignment === "center" ? "items-center gap-3" : "items-start gap-1")}>
        {leadingNode}
        <div className={clsx("flex min-w-0 flex-1 gap-3", contentAlignment === "center" ? "items-center" : "items-start")}>
          <div className="min-w-0 flex-1 justify-center gap-2 break-words">{body}</div>
          {actionsInline && actions != null ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label={intl.formatMessage({
              id: "codex.alert.closeAriaLabel",
              defaultMessage: "Close",
              description: "Aria label for the close button on an alert/toast component",
            })}
            className={clsx(
              "flex size-6 shrink-0 grow-0 cursor-interaction items-center justify-center rounded-full hover:bg-background-primary-ghost-hover/5",
              contentAlignment !== "center" && "self-start",
            )}
          >
            <Icon aria-hidden={false} asset={xmarkMdLight16} />
          </button>
        ) : null}
      </div>
      {!actionsInline && actions != null ? <div className="flex items-center justify-end gap-2">{actions}</div> : null}
    </div>
  );
}
