import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import './GeminiDialog.css';

/*
 * Gemini's Material dialog, from measurement (see GeminiDialog.css for the
 * capture notes). One shell renders every dialog that needs this chrome; the two
 * Recents dialogs — "Rename this chat" and "Delete chat?" — are the first
 * consumers and were measured separately, agreeing on all of it.
 *
 * Measured behaviour that shapes this API:
 *
 *   - Opening: the backdrop fades 0 -> 1 over 400ms cubic-bezier(0.25,0.8,0.25,1)
 *     while the surface scales 0.8 -> 1 over 150ms cubic-bezier(0,0,0.2,1).
 *     Both are CSS transitions, and they overlap — the surface settles well
 *     before the backdrop finishes.
 *
 *   - Closing: the surface does NOT animate. Every sampled frame of the close
 *     read `opacity: 1; transform: none`. Only the backdrop fades, and the node
 *     is removed ~75ms in, mid-fade. So `closing` fades the backdrop and leaves
 *     the surface exactly where it is — deliberately not symmetric.
 *
 * Unmounting stays with the caller, which already holds the shouldRender/
 * isClosing pair the rest of the sidebar uses. `closing` is the render half of
 * that pair.
 */

export interface GeminiDialogProps {
  /** Measured: Rename's title is an H2, Delete's is an H1. */
  headingAs?: 'h1' | 'h2';
  title: string;
  children?: React.ReactNode;
  /** The pill row. Measured 16px padding, 8px gap, flush right. */
  actions?: React.ReactNode;
  /** Measured 512 for Rename, 600 for Delete. */
  width?: number;
  closing?: boolean;
  onDismiss: () => void;
}

export const GeminiDialog: React.FC<GeminiDialogProps> = ({
  headingAs: Heading = 'h2',
  title,
  children,
  actions,
  width = 512,
  closing = false,
  onDismiss,
}) => {
  const [shown, setShown] = useState(false);

  // One frame after mount, so the transition has a `scale(0.8)` start to run
  // from. Setting it during the commit would apply both values in one frame and
  // the scale-in would never be seen.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onDismiss]);

  return createPortal(
    <div className="willow-gdlg-host">
      <div
        aria-hidden="true"
        className={`willow-gdlg-backdrop${shown && !closing ? ' willow-gdlg-backdrop--shown' : ''}${closing ? ' willow-gdlg-backdrop--closing' : ''}`}
        onClick={onDismiss}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`willow-gdlg-surface${shown && !closing ? ' willow-gdlg-surface--shown' : ''}${closing ? ' willow-gdlg-surface--closing' : ''}`}
        style={{ maxWidth: width }}
        onClick={(e) => e.stopPropagation()}
      >
        <Heading className="willow-gdlg-title">{title}</Heading>
        <div className="willow-gdlg-content">{children}</div>
        <div className="willow-gdlg-actions">{actions}</div>
      </div>
    </div>,
    document.body,
  );
};

/*
 * Gemini's `mat-tonal-button`, measured in both dialogs and in both states.
 *
 * Enabled  bg rgb(23, 23, 23),  colour rgb(230, 230, 230)
 * Disabled bg rgba(230,230,230,0.12), colour rgba(230,230,230,0.38)
 *          (reported as `color(srgb 0.901961 ... / 0.12)`, which is 230/255)
 *
 * Hovering an ENABLED one raises its persistent ripple from opacity 0 to 0.08 in
 * rgb(230, 230, 230). The width is content-derived, not authored: Cancel
 * measured 70.72 = 12 + 46.73 + 12 and Rename 78.93 = 12 + 54.92 + 12, both
 * exactly the 12px padding either side of the label.
 */
export const GeminiDialogPill: React.FC<{
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}> = ({ children, disabled, onClick }) => (
  <button type="button" className="willow-gdlg-pill" disabled={disabled} onClick={onClick}>
    <span className="willow-gdlg-pill__label">{children}</span>
  </button>
);

/*
 * Gemini's outlined `mat-form-field`, as the Rename dialog uses it.
 *
 * It is `mdc-notched-outline--no-label`, so the notch piece measured 0x0 and the
 * outline is just the leading (12px, radius 4px 0 0 4px) and trailing (440px,
 * radius 0 4px 4px 0) pieces meeting — visually one 4px-radius box. Reproduced
 * as a single absolutely-positioned border, which is what makes the width swap
 * below layout-neutral: Material's outline is out of flow, so the input never
 * moves when it thickens.
 *
 *   at rest   0.8px rgb(142, 145, 143)
 *   hover     0.8px rgb(230, 230, 230)
 *   focused   1.6px rgb(230, 230, 230)
 *
 * Box: 452x56 with the wrapper padded `0 16px` and the infix `16px 0`, so the
 * 24px-tall input sits centred. Text is 16px/24px 400 at `"wdth" 92` in
 * rgb(230, 230, 230) with a matching caret.
 */
export const GeminiOutlinedField: React.FC<{
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  ariaLabel: string;
}> = ({ value, onChange, onKeyDown, ariaLabel }) => (
  <div className="willow-gdlg-field">
    <input
      className="willow-gdlg-field__input"
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      autoFocus
    />
    <div aria-hidden="true" className="willow-gdlg-field__outline" />
  </div>
);
