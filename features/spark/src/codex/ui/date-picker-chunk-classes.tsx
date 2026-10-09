import type { ReactNode } from "react";
import { DsButtonClassNames } from "./ds-button";
import { DsPopoverClassNames } from "./ds-popover";
import { TransitionGroupClassNames } from "./transition-group";

const buttonClassNames = { Button: "_Button_r3d2l_1", ButtonInner: "_ButtonInner_r3d2l_4", ButtonLoader: "_ButtonLoader_r3d2l_802" };
const popoverClassNames = { popover: "_Popover_15mw4_2", transition: "_Transition_15mw4_2" };
const transitionGroupClassNames = { TransitionGroupChild: "_TransitionGroupChild_8bll3_1" };

/**
 * `DatePicker-653dbdbea596.js` bundles its own copies of the button (`il`), popover (`gc`) and transition group (`Bo`);
 * they render like `DsButton` / `DsPopover` / `TransitionGroup` but with these module classes.
 */
export function DatePickerChunkClassNames({ children }: { children: ReactNode }) {
  return (
    <DsButtonClassNames value={buttonClassNames}>
      <DsPopoverClassNames value={popoverClassNames}>
        <TransitionGroupClassNames value={transitionGroupClassNames}>{children}</TransitionGroupClassNames>
      </DsPopoverClassNames>
    </DsButtonClassNames>
  );
}
