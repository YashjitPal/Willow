import clsx from "clsx";
import { FormattedMessage } from "react-intl";

/** `sX` (`Yoo1Component`): middle dot between inline items, hidden when it ends the row. */
export function BulletSeparator({ className }: { className?: string }) {
  return (
    <span aria-hidden className={clsx("last:hidden", className)}>
      <FormattedMessage id="codex.ui.bulletSeparator" defaultMessage="·" description="Middle dot separator used between inline items" />
    </span>
  );
}
