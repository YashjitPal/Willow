/**
 * The prompt box's plus, as Willow's (features/chat composer/Composer.tsx): a 32px round button
 * whose plus turns to a cross while its menu is open, opening Willow's plus menu above it — Spark's
 * rows (PlusDropdownMenu): Upload files, and the Plan tool, which shows as a chip beside the plus
 * while it is on.
 */
import { useState } from "react";

import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";

import { WillowPlanIcon } from "./icons";

/** T3 collapses its composer to a row while the thread scrolls; Willow's box keeps its shape. */
export const WILLOW_COMPOSER_RESTS: boolean = false;

export function WillowComposerPlus(props: {
  disabled?: boolean;
  onAttach?: (() => void) | undefined;
  planMode?: { on: boolean; onToggle: () => void } | undefined;
}) {
  const [open, setOpen] = useState(false);
  if (!props.onAttach && !props.planMode) return null;
  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger
        disabled={props.disabled}
        aria-label="Upload & tools"
        className="willow-composer-plus"
      >
        <span aria-hidden="true" className="willow-composer-plus__glyph">
          plus
        </span>
      </MenuTrigger>
      <MenuPopup side="top" align="start" sideOffset={8} className="willow-plus-menu">
        {props.onAttach ? (
          <MenuItem onClick={props.onAttach}>
            <span aria-hidden="true" className="willow-plus-menu__icon">
              <span className="willow-plus-menu__glyph">attach_file</span>
            </span>
            <span className="willow-plus-menu__label">Upload files</span>
          </MenuItem>
        ) : null}
        {props.planMode ? (
          <>
            {props.onAttach ? <MenuSeparator /> : null}
            <MenuItem
              data-checked={props.planMode.on ? "" : undefined}
              aria-checked={props.planMode.on}
              role="menuitemcheckbox"
              onClick={props.planMode.onToggle}
            >
              <span aria-hidden="true" className="willow-plus-menu__icon">
                <WillowPlanIcon size={18} strokeWidth={2} />
              </span>
              <span className="willow-plus-menu__label willow-plus-menu__label--tool">Plan</span>
            </MenuItem>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
