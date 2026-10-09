import clsx from "clsx";
import type { ReactNode } from "react";
import { Spinner } from "../../codex-ui/spinner";

const css = { delayedIndicator: "_delayedIndicator_ovcb0_1" } as const;

export interface CharacterEditorLayoutProps {
  controls: ReactNode;
  title?: ReactNode;
  preview: ReactNode;
  footer?: ReactNode;
  /** When set, a delayed spinner covers the preview and announces this label. */
  loadingLabel?: ReactNode;
}

/** Controls on the left, preview and footer on a tinted side panel (`Se1Component`). */
export function CharacterEditorLayout({ controls, title, preview, footer, loadingLabel }: CharacterEditorLayoutProps) {
  return (
    <div className="grid grid-cols-1 sm:h-120 sm:min-h-0 sm:grid-cols-5 sm:grid-rows-1">
      <div className="order-2 flex min-h-0 min-w-0 flex-col sm:order-1 sm:col-span-3">{controls}</div>
      <div className="order-1 flex min-h-0 min-w-0 flex-col gap-4 border-b border-subtle bg-surface-secondary px-8 pt-14 pb-8 sm:order-2 sm:col-span-2 sm:border-s sm:border-b-0 dark:bg-surface-tertiary">
        {title}
        <div className="relative -mx-8 flex h-56 min-h-0 items-center justify-center overflow-hidden sm:h-auto sm:flex-1">
          {preview}
          {loadingLabel != null && (
            <div
              className={clsx("pointer-events-none absolute inset-0 flex items-center justify-center bg-surface-secondary/70 dark:bg-surface-tertiary/70", css.delayedIndicator)}
              role="status"
            >
              <Spinner />
              <span className="sr-only">{loadingLabel}</span>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-3">{footer}</div>
      </div>
    </div>
  );
}
