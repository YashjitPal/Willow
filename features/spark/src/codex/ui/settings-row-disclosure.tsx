import type { ReactNode } from "react";
import { settingsRowDividers } from "./settings-group";

export interface SettingsRowDisclosureProps {
  children?: ReactNode;
  content?: ReactNode;
  contentId?: string;
  expanded: boolean;
}

/** A settings row followed by its expandable child rows (`settings-row-disclosure` chunk). */
export function SettingsRowDisclosure({ children, content, contentId, expanded }: SettingsRowDisclosureProps) {
  return (
    <div className={settingsRowDividers.inset}>
      {children}
      {expanded ? (
        <div id={contentId} className={settingsRowDividers.inset}>
          {content}
        </div>
      ) : null}
    </div>
  );
}
