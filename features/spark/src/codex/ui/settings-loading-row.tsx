import type { ReactNode } from "react";
import { SettingsRow } from "./settings-row";
import { Spinner } from "./spinner";

/** Spinner row shown inside a settings group while its rows load (`settings-loading-row` chunk). */
export function SettingsLoadingRow({ children }: { children?: ReactNode }) {
  return (
    <div role="status">
      <SettingsRow
        label={
          <span className="flex items-center gap-2 font-normal text-secondary">
            <Spinner className="icon-xs shrink-0 text-secondary" />
            <span className="text-balance">{children}</span>
          </span>
        }
        control={null}
      />
    </div>
  );
}
