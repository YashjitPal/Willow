import React from 'react';
import { GeminiDialog, GeminiDialogPill } from '@willow/ui/GeminiDialog';

import type { Notebook } from './notebook-types';

/**
 * "Delete notebook everywhere?" — recorded at **512x193**.
 *
 *   surface  bg `rgb(31,31,31)`, radius 32, shadow `0 0 20px rgba(0,0,0,0.28)`
 *   backdrop `rgba(0,0,0,0.32)`
 *   title    h1, `padding: 24px 24px 0`, 20px/24px w470 `rgb(227,227,227)`
 *   body     `padding: 16px 24px 0`, 15px/20px w400 `rgb(230,230,230)`
 *   actions  `padding: 16px`, flex-end, `gap: 8px`, tonal pills h36 `rgb(23,23,23)`
 *
 * Every one of those numbers is what `GeminiDialog` was already built from — it came
 * out of the sidebar's Delete-chat dialog, and this recording shows the two are the
 * same component at different widths. So this is a thin wrapper, not a re-build.
 *
 * The button ORDER is the part worth preserving: Gemini puts **Delete everywhere
 * first and Cancel second** (measured at dx 266.5 and 425.3), the reverse of the
 * usual confirm layout — and neither pill is tinted, so the destructive one is the
 * same tonal grey as Cancel.
 */
export const DeleteNotebookDialog: React.FC<{
  notebook: Notebook;
  onClose: () => void;
  onDeleted: () => void;
}> = ({ onClose, onDeleted }) => (
  <GeminiDialog
    headingAs="h1"
    title="Delete notebook everywhere?"
    width={512}
    onDismiss={onClose}
    actions={(
      <>
        <GeminiDialogPill onClick={onDeleted}>Delete everywhere</GeminiDialogPill>
        <GeminiDialogPill onClick={onClose}>Cancel</GeminiDialogPill>
      </>
    )}
  >
    <p>
      This notebook, including all sources and chats, will be permanently deleted from
      Gemini Apps on all your devices.
    </p>
  </GeminiDialog>
);
