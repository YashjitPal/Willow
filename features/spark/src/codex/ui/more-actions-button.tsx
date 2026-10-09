import clsx from "clsx";
import type { MouseEvent } from "react";
import { EllipsisHorizontalLight16Icon } from "../icons/ellipsis-horizontal-light-16";
import { EllipsisHorizontalLight20Icon } from "../icons/ellipsis-horizontal-light-20";
import { DsButton, type DsButtonProps } from "./ds-button";
import { SizedIcon } from "./sized-icon";

export interface MoreActionsButtonProps extends Omit<DsButtonProps, "children" | "variant" | "iconSize" | "size"> {
  label: string;
  iconClassName?: string;
  iconSize?: "sm" | "lg";
  size?: DsButtonProps["size"] | "toolbar";
}

const css = { Toolbar: "_Toolbar_jg414_1" } as const;

/** `Am` (`rLi`): ellipsis ghost button that opens an actions menu without activating its row. */
export function MoreActionsButton({ className, label, onClick, iconClassName, iconSize = "sm", size = "md", uniform = true, ...rest }: MoreActionsButtonProps) {
  const Glyph = iconSize === "lg" ? EllipsisHorizontalLight20Icon : EllipsisHorizontalLight16Icon;
  const isToolbar = size === "toolbar";
  return (
    <DsButton
      className={clsx(isToolbar && css.Toolbar, className)}
      color="secondary"
      variant="ghost"
      pill={false}
      size={isToolbar ? "xl" : size}
      iconSize={iconSize}
      uniform={uniform}
      aria-label={label}
      {...rest}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        onClick?.(event);
      }}
    >
      {isToolbar ? (
        <SizedIcon className={iconClassName} data-no-autosize icon={{ 16: EllipsisHorizontalLight16Icon, 20: EllipsisHorizontalLight20Icon }} />
      ) : (
        <Glyph className={iconClassName} />
      )}
    </DsButton>
  );
}
