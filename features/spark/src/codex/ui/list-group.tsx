import clsx from "clsx";
import type { ComponentProps } from "react";

const css = { group: "_group_sm7xw_2", groupItem: "_groupItem_sm7xw_2" } as const;

/** `Q7` (`lNa` in app-initial): a stack of `ListRow`s that draws the dividers between its items. */
export function ListGroup({ className, ...rest }: ComponentProps<"div">) {
  return <div {...rest} className={clsx(css.group, className)} />;
}

/** `$7` (`uNa` in app-initial). */
export function ListGroupItem({ className, ...rest }: ComponentProps<"div">) {
  return <div {...rest} className={clsx(css.groupItem, className)} />;
}
