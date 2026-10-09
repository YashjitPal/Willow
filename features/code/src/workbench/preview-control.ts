/**
 * Requests the harness makes of the live preview while a turn runs.
 *
 * The preview normally rebuilds only when generation finishes. The agent's
 * preview tools need it sooner: before testing, the preview has to show the
 * edits made so far in the turn, built with source locations so every element
 * names the line that renders it. `WorkbenchPreview` watches these atoms.
 *
 * One set per Code screen (`session/code-session.ts`): each screen has its own
 * preview, and a turn asks its own to rebuild.
 */

import { atom, type WritableAtom } from 'nanostores';

export type PreviewViewportSize = 'mobile' | 'tablet';

/** Device widths the agent can test at; null is the pane's own width. */
export const PREVIEW_VIEWPORTS: Record<PreviewViewportSize, { width: number; label: string }> = {
  mobile: { width: 390, label: 'phone' },
  tablet: { width: 820, label: 'tablet' },
};

export interface PreviewControl {
  /** Bumped to ask for a rebuild from the workbench's current files. */
  rebuildRequest: WritableAtom<number>;
  /** Build the preview with `data-willow-source` on every element, as visual editing does. */
  inspectable: WritableAtom<boolean>;
  viewport: WritableAtom<PreviewViewportSize | null>;
  requestRebuild(): void;
}

export function createPreviewControl(): PreviewControl {
  const rebuildRequest = atom(0);
  return {
    rebuildRequest,
    inspectable: atom(false),
    viewport: atom<PreviewViewportSize | null>(null),
    requestRebuild: () => rebuildRequest.set(rebuildRequest.get() + 1),
  };
}
