// The overlays Flow's editors open from their header and history: the asset info popover, the
// Download menu, the Share dialog and the Flag output dialog. Measured off flow.google.com with
// tools/ui-research/scrapers/flow/media/02-image-editor.cjs; styled in image-editor.css.
import React from 'react';
import { createPortal } from 'react-dom';
import type { MediaItem } from '../types';
import { FlowIcon, FlowMatMenu, FlowMatMenuItem, type MenuAnchor } from '../scenes/flow-ui';
import { showSnack } from '../scenes/scene-store';
import { downloadMedia, IMAGE_DOWNLOADS, VIDEO_DOWNLOADS } from './media-download';
import './image-editor.css';

const ratioIcon = (ratio: string | undefined) => {
  const [w, h] = (ratio || '16:9').split(':').map(Number);
  if (!w || !h) return 'crop_16_9';
  const ar = w / h;
  if (ar > 1.5) return 'crop_16_9';
  if (ar > 1.1) return 'crop_landscape';
  if (ar > 0.9) return 'crop_square';
  if (ar > 0.65) return 'crop_portrait';
  return 'crop_9_16';
};

export { ratioIcon };

/** Flow's info popover: the name, when it was made and its shape, under the info button. */
export const InfoPopover: React.FC<{
  item: MediaItem;
  anchor: DOMRect | null;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLElement | null>;
}> = ({ item, anchor, onClose, triggerRef }) => {
  const ref = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    if (!anchor) return undefined;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || triggerRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [anchor, onClose, triggerRef]);
  if (!anchor) return null;
  const created = new Date(item.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return createPortal(
    <aside
      ref={ref}
      aria-label="Asset info"
      className="ie-info"
      style={{ left: anchor.left, top: anchor.bottom }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="ie-info__container">
        <div role="heading" aria-level={2} className="ie-info__title">{item.shortenedPrompt || item.prompt}</div>
        <div className="ie-info__meta">
          <div className="ie-info__row">Created {created}</div>
          <div className="ie-info__row">
            <FlowIcon name={ratioIcon(item.ratio)} size={14} />
            <span>{item.ratio || '16:9'}</span>
          </div>
        </div>
      </div>
    </aside>,
    document.body,
  );
};

/** The download sizes, original first: the rows of the Download menu and of a tile's Download submenu. */
export const DownloadOptions: React.FC<{ item: MediaItem }> = ({ item }) => (
  <>
    {(item.kind === 'video' ? VIDEO_DOWNLOADS : IMAGE_DOWNLOADS).map((o) => (
      <FlowMatMenuItem
        key={o.size}
        className="ie-menu-two-line"
        disabled={!o.available}
        label={(
          <span className="ie-two-line">
            <span className="ie-two-line__label">{o.label}</span>
            <span className="ie-two-line__caption">{o.caption}</span>
          </span>
        )}
        onSelect={() => {
          void downloadMedia(item, o.size).catch(() => {
            showSnack({ icon: 'error', tone: 'error', text: 'The download failed.', actions: [{ label: 'Dismiss' }] });
          });
        }}
      />
    ))}
  </>
);

/** The Download menu: original size first for images, then the sizes Flow upscales to. */
export const DownloadMenu: React.FC<{
  item: MediaItem | null;
  anchor: MenuAnchor | null;
  onClose: () => void;
  ignoreRefs?: React.RefObject<HTMLElement | null>[];
}> = ({ item, anchor, onClose, ignoreRefs }) => (
  <FlowMatMenu open={!!anchor && !!item} onClose={onClose} anchor={anchor} ignoreRefs={ignoreRefs} ariaLabel="Download options">
    {item && <DownloadOptions item={item} />}
  </FlowMatMenu>
);

/** A dialog on CDK's blurred backdrop. A press on the backdrop or Escape closes it. */
const Dialog: React.FC<{ open: boolean; onClose: () => void; className: string; labelledBy?: string; children: React.ReactNode }> = ({ open, onClose, className, labelledBy, children }) => {
  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
      <div className="ie-dialog-backdrop" onClick={onClose} />
      <div className="ie-dialog-wrap">
        <div role="dialog" aria-modal="true" aria-labelledby={labelledBy} className={`ie-dialog ${className}`}>{children}</div>
      </div>
    </div>,
    document.body,
  );
};

/** flow-confirmation-dialog: a question, what it will do, Cancel (focused, as Material opens it) and the action. */
/**
 * flow-confirmation-dialog, both ways Flow shows it: a title over the message (Move collection to
 * trash?), or — with `icon` and no title — a glyph over a centered message with the two buttons
 * sharing the width (Do you want to create a collection with: …).
 */
export const ConfirmDialog: React.FC<{
  open: boolean;
  title?: string;
  icon?: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}> = ({ open, title, icon, message, confirmLabel, onConfirm, onClose }) => {
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (open) window.setTimeout(() => cancelRef.current?.focus({ preventScroll: true }), 0);
  }, [open]);
  const confirm = () => { onClose(); onConfirm(); };
  return (
    <Dialog open={open} onClose={onClose} className={`ie-confirm${icon ? ' ie-confirm--icon' : ''}`} labelledBy={title ? 'ie-confirm-title' : undefined}>
      {icon
        ? <div className="ie-confirm__icon"><FlowIcon name={icon} size={20} /></div>
        : <h2 id="ie-confirm-title" className="ie-confirm__title">{title}</h2>}
      <div className="ie-confirm__content"><p className="ie-confirm__message">{message}</p></div>
      {icon ? (
        <div className="ie-confirm__actions">
          <button ref={cancelRef} type="button" className="sb-btn ie-dialog-btn ie-dialog-btn--primary" onClick={onClose}>Cancel</button>
          <button type="button" className="sb-btn ie-dialog-btn ie-dialog-btn--tonal" onClick={confirm}>
            <span className="ie-confirm__action">{confirmLabel}</span>
          </button>
        </div>
      ) : (
        <div className="ie-confirm__actions">
          <button ref={cancelRef} type="button" className="sb-btn ie-dialog-btn ie-dialog-btn--tonal" onClick={onClose}>Cancel</button>
          <button type="button" className="sb-btn ie-dialog-btn ie-dialog-btn--primary" onClick={confirm}>
            <span className="ie-confirm__action">{confirmLabel}</span>
          </button>
        </div>
      )}
    </Dialog>
  );
};

const FLAG_REASONS = ['This is offensive.', 'This is inaccurate.', 'The quality is low.'];

/** flow-feedback-dialog: what is wrong with this output? Submit stays disabled until a pick. */
export const FlagDialog: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const [reason, setReason] = React.useState<string | null>(null);
  // Material's dialog focuses its first control on open, and the first radio shows its focus ring
  // until the user does something.
  const [initialFocus, setInitialFocus] = React.useState(true);
  const firstRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (!open) return;
    setReason(null);
    setInitialFocus(true);
    window.setTimeout(() => firstRef.current?.focus(), 0);
  }, [open]);
  return (
    <Dialog open={open} onClose={onClose} className={`ie-flag${initialFocus ? ' is-initial-focus' : ''}`} labelledBy="ie-flag-title">
      <h2 id="ie-flag-title" className="ie-flag__title">What is wrong with this output?</h2>
      <div role="radiogroup" aria-labelledby="ie-flag-title" className="ie-flag__options" onPointerDown={() => setInitialFocus(false)}>
        {FLAG_REASONS.map((r, i) => (
          <label key={r} className="ie-radio">
            <span className="ie-radio__control">
              <input ref={i === 0 ? firstRef : undefined} type="radio" name="ie-flag" checked={reason === r} onChange={() => { setReason(r); setInitialFocus(false); }} />
              <span className="ie-radio__outer" />
            </span>
            <span className="ie-radio__label">{r}</span>
          </label>
        ))}
      </div>
      <div className="ie-flag__actions">
        <button type="button" className="sb-btn ie-dialog-btn ie-dialog-btn--tonal" onClick={onClose}>Cancel</button>
        <button
          type="submit"
          className="sb-btn ie-dialog-btn ie-dialog-btn--flat"
          disabled={!reason}
          onClick={() => {
            onClose();
            showSnack({ icon: 'check_circle', text: 'Thanks for your feedback', actions: [{ label: 'Dismiss' }] });
          }}
        >
          Submit
        </button>
      </div>
    </Dialog>
  );
};

const CheckGlyph = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="3.12" d="M1.73,12.91 8.1,19.28 22.79,4.59" /></svg>
);

const OverlayCheck: React.FC<{ checked: boolean; label: string; onChange: (v: boolean) => void }> = ({ checked, label, onChange }) => (
  <button type="button" role="checkbox" aria-checked={checked} aria-label={label} className="ie-overlay-check" onClick={() => onChange(!checked)}>
    <span className="ie-overlay-check__box">{checked && <CheckGlyph />}</span>
  </button>
);

/** flow-share-dialog. Willow has no hosted link, so Copy link copies the file's own address when
 * it has one and the picture itself when it lives only on this device. */
export const ShareDialog: React.FC<{ item: MediaItem | null; parent?: MediaItem; onClose: () => void }> = ({ item, parent, onClose }) => {
  const [includeInputs, setIncludeInputs] = React.useState(true);
  const [includePrompt, setIncludePrompt] = React.useState(true);
  const [includeIngredient, setIncludeIngredient] = React.useState(true);
  React.useEffect(() => {
    if (!item) return;
    setIncludeInputs(true);
    setIncludePrompt(true);
    setIncludeIngredient(true);
  }, [item]);
  const copy = async () => {
    if (!item?.url) return;
    try {
      if (/^https?:/.test(item.url)) {
        await navigator.clipboard.writeText(item.url);
      } else if (item.kind === 'image' && 'ClipboardItem' in window) {
        const blob = await (await fetch(item.url)).blob();
        const png = blob.type === 'image/png' ? blob : await new Promise<Blob>((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            const c = document.createElement('canvas');
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            c.getContext('2d')?.drawImage(img, 0, 0);
            c.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/png');
          };
          img.onerror = reject;
          img.src = URL.createObjectURL(blob);
        });
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      } else {
        await navigator.clipboard.writeText(item.url);
      }
      showSnack({ icon: 'check_circle', text: 'Link copied', actions: [{ label: 'Dismiss' }] });
    } catch {
      showSnack({ icon: 'error', tone: 'error', text: 'The link could not be copied.', actions: [{ label: 'Dismiss' }] });
    }
  };
  // Any generation has inputs to share (its prompt, and for an edit the image it was made from);
  // an upload or a saved frame has none.
  const hasInputs = !!item && item.modelId !== 'upload' && item.modelId !== 'crop' && !!item.prompt;
  return (
    <Dialog open={!!item} onClose={onClose} className="ie-share" labelledBy="ie-share-title">
      <h2 className="ie-share__header">
        <span id="ie-share-title">Share</span>
        <button type="button" aria-label="Close share dialog" className="sb-icon-btn sb-icon-btn--lg" onClick={onClose}>
          <FlowIcon name="close" size={24} />
        </button>
      </h2>
      {item && (
        <div className="ie-share__content">
          <div className="ie-share__card">
            <div className="ie-share__preview">
              {item.kind === 'video' ? <video src={item.url} muted playsInline /> : <img src={item.url} alt="" draggable={false} />}
              {item.kind === 'video' && <span className="ie-share__badge"><FlowIcon name="play_circle" size={18} /></span>}
            </div>
            <div className="ie-share__info">
              <div className="ie-share__model">{item.modelName}</div>
            </div>
          </div>
          {hasInputs && (
            <div className="ie-share__inputs">
              <div className="ie-share__toggle-row">
                <label className="ie-switch">
                  <button type="button" role="switch" aria-checked={includeInputs} className="ie-switch__track" onClick={() => setIncludeInputs(!includeInputs)}>
                    <span className="ie-switch__handle" />
                  </button>
                  <span style={{ paddingLeft: 4 }}>Include inputs</span>
                </label>
                <button type="button" aria-label="More information about including inputs" className="sb-icon-btn">
                  <FlowIcon name="info" size={18} />
                </button>
              </div>
              {includeInputs && (
                <>
                  <div className="ie-share__prompt">
                    <OverlayCheck checked={includePrompt} label="Include prompt" onChange={setIncludePrompt} />
                    {item.prompt}
                  </div>
                  {parent?.url && (
                    <div className="ie-share__ingredients">
                      <div className="ie-share__ingredient">
                        <OverlayCheck checked={includeIngredient} label="Include input media" onChange={setIncludeIngredient} />
                        <img src={parent.url} alt="" draggable={false} />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          <div className="ie-share__divider"><hr /></div>
          <div className="ie-share__link">
            <button type="button" className="ie-share__copy" onClick={() => void copy()}>
              <FlowIcon name="link" size={18} />
              <span>Copy link</span>
            </button>
            <div className="ie-share__note">
              <FlowIcon name="info" size={14} />
              <span>Anyone with this link can view and use your creation.</span>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
};
