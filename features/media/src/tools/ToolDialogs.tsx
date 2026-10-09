/**
 * The Tools dialogs, each Flow's own DOM inside a MatDialog (`ui.tsx`):
 *
 * - `flow-community-applet-preview-dialog` — "Shared tool: …", the warning, Open in project.
 * - `flow-applet-share-dialog` — Copy link, Allow remixing. Willow has no hosted links, so the
 *   link is the tool's own address in Willow.
 * - `flow-submit-to-gallery-dialog` — Apply to be featured. Willow has no gallery to review it,
 *   so a submitted tool is featured in the user's own Community tab instead.
 * - `flow-applet-icon-selector-dialog` — Edit icon: the 35 presets, or a picture from the project.
 * - `flow-applet-description-dialog` — Edit description, under the header's right end.
 */
import React from 'react';
import { showSnack } from '../scenes/scene-store';
import { ICON_PRESETS } from './catalog';
import type { ToolEntry } from './tools-store';
import { getTool, setToolDescription, setToolIcon, updateTool } from './tools-store';
import { ToolMarkdown } from './ToolMarkdown';
import { cx, FlowButton, FlowDialog, FlowIconButton, MatIcon, SlideToggle } from './ui';

export const REPORT_URL = 'https://support.google.com/legal/troubleshooter/1114905?uraw=r_20cf4f41bc75e35e';
export const openReport = () => window.open(REPORT_URL, '_blank', 'noopener,noreferrer');

/** A picture as a data URL at most `max` px on its longer side, for icons and covers. */
export async function imageToDataUrl(url: string, max: number, type = 'image/png'): Promise<string> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  await img.decode();
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(type, 0.9);
}

/* ------------------------------------------------------------------ *
 * Community preview
 * ------------------------------------------------------------------ */

export const CommunityPreviewDialog: React.FC<{ entry: ToolEntry | null; onClose: (open: boolean) => void }> = ({ entry, onClose }) => {
  const [shown, setShown] = React.useState(entry);
  if (entry && entry !== shown) setShown(entry);
  const tool = entry ?? shown;
  return (
    <FlowDialog open={!!entry} onClose={() => onClose(false)} panelClass="flow-community-applet-preview-dialog-panel" hostClass="ng-flow-community-applet-preview-dialog" ariaLabel="Shared tool">
      {tool && (
        <div className="dialog-container">
          <div className="dialog-header">
            <h2 className="mat-mdc-dialog-title mdc-dialog__title dialog-title">Shared tool: {tool.name || 'Untitled applet'}</h2>
            <FlowIconButton icon="flag" fill label="Report" onClick={openReport} />
          </div>
          <div className="mat-mdc-dialog-content mdc-dialog__content dialog-content">
            <div className="applet-card">
              <div className="applet-thumbnail-container"><img className="applet-thumbnail-image" src={tool.icon} alt="" /></div>
              <div className="applet-info">
                <span className="applet-name">{tool.name}</span>
                <ToolMarkdown text={tool.description} className="applet-description" />
              </div>
            </div>
            <div className="warning-container">
              <div className="warning-header">
                <MatIcon name="warning" className="warning-icon" />
                <span className="warning-title">This app is from another user</span>
              </div>
              <p className="warning-body">
                <span>This tool was developed by another user. Be cautious and only continue with tools you trust.</span>{' '}
                <a className="report-link" href={REPORT_URL} target="_blank" rel="noopener noreferrer">Report unsafe content.</a>
                <br />
                <span>Don&apos;t share personal or sensitive information, such as passwords or payment details. Anyone with this public link can access and edit shared data.</span>
              </p>
            </div>
          </div>
          <div className="dialog-actions">
            <FlowButton variant="secondary" className="full-width-btn open-in-project-btn" onClick={() => onClose(true)}>Open in project</FlowButton>
            <FlowButton variant="transparent" className="full-width-btn cancel-btn" onClick={() => onClose(false)}>Cancel</FlowButton>
          </div>
        </div>
      )}
    </FlowDialog>
  );
};

/* ------------------------------------------------------------------ *
 * Share tool
 * ------------------------------------------------------------------ */

export const ShareToolDialog: React.FC<{ entry: ToolEntry | null; onClose: () => void }> = ({ entry, onClose }) => {
  const [shown, setShown] = React.useState(entry);
  if (entry && entry !== shown) setShown(entry);
  const tool = entry ?? shown;
  const own = tool?.kind === 'self' ? getTool(tool.id) : undefined;
  const [remixing, setRemixing] = React.useState(own?.allowRemixing ?? true);
  React.useEffect(() => { if (entry) setRemixing(getTool(entry.id)?.allowRemixing ?? true); }, [entry]);
  const copy = async () => {
    if (!tool) return;
    const url = `${window.location.origin}/media/tool/${encodeURIComponent(tool.id)}`;
    try {
      await navigator.clipboard.writeText(url);
      showSnack({ icon: 'check_circle', text: 'Link copied to clipboard', actions: [{ label: 'Dismiss' }] });
    } catch {
      showSnack({ icon: 'error', text: 'Failed to copy link', actions: [{ label: 'Dismiss' }], tone: 'error' });
    }
  };
  return (
    <FlowDialog open={!!entry} onClose={onClose} panelClass="flow-share-dialog-panel" hostClass="ng-flow-applet-share-dialog" ariaLabel="Share tool">
      {tool && (
        <>
          <h2 className="dialog-header">
            <span className="mat-mdc-dialog-title mdc-dialog__title dialog-title">Share tool</span>
            <FlowIconButton icon="close" label="Close share dialog" tooltip={null} onClick={onClose} />
          </h2>
          <div className="mat-mdc-dialog-content mdc-dialog__content dialog-content">
            <div className="applet-media-card">
              <div className="applet-thumbnail-container"><img className="applet-thumbnail-image" src={tool.icon} alt="" /></div>
              <div className="applet-info">
                <div className="applet-name">{tool.name}</div>
                <div className="applet-description">{tool.description}</div>
              </div>
            </div>
            <div className="dialog-footer">
              <FlowButton variant="outlined" icon="link" wrapLabel className="copy-link-button" onClick={() => void copy()}>Copy link</FlowButton>
              {own && (
                <div className="toggle-row">
                  <SlideToggle
                    checked={remixing}
                    onChange={(v) => { setRemixing(v); updateTool(own.id, { allowRemixing: v }); }}
                    label={<span className="toggle-label">Allow remixing</span>}
                  />
                </div>
              )}
              <div className="disclaimer-row">
                <MatIcon name="info" />
                <span className="disclaimer-text">Sharing allows anyone with the link to view, remix and reshare your tool. Share responsibly, delete anytime.</span>
              </div>
              <div className="warning-row">
                <span className="warning-text">Warning: This includes media that are stored or grounded within this Tool. If this Tool includes personal images, they will be shared and accessible for others to use.</span>
              </div>
            </div>
          </div>
        </>
      )}
    </FlowDialog>
  );
};

/* ------------------------------------------------------------------ *
 * Apply to be featured
 * ------------------------------------------------------------------ */

const SUBMIT_HERO = 'https://www.gstatic.com/aitestkitchen/website/flow/applets/submit-to-gallery-hero.webp';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const SubmitToGalleryDialog: React.FC<{
  entry: ToolEntry | null;
  onClose: () => void;
  pickImage: () => Promise<string | null>;
}> = ({ entry, onClose, pickImage }) => {
  const [shown, setShown] = React.useState(entry);
  if (entry && entry !== shown) setShown(entry);
  const tool = entry ?? shown;
  const [preview, setPreview] = React.useState<string | null>(null);
  const [icon, setIcon] = React.useState('');
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [remixing, setRemixing] = React.useState(true);
  const [tried, setTried] = React.useState(false);
  React.useEffect(() => {
    if (!entry) return;
    const own = getTool(entry.id);
    setPreview(own?.cover ?? null);
    setIcon(entry.icon);
    setName(entry.name);
    setDescription(entry.description);
    setEmail(own?.featuredRequest?.email ?? '');
    setDisplayName(own?.featuredRequest?.displayName ?? '');
    setRemixing(own?.allowRemixing ?? true);
    setTried(false);
  }, [entry]);
  const errors = {
    preview: !preview ? 'Preview image is required' : '',
    email: !email.trim() ? 'Email is required' : !EMAIL.test(email.trim()) ? 'Please enter a valid email address' : '',
    displayName: !displayName.trim() ? 'Display name is required' : '',
  };
  const submit = () => {
    setTried(true);
    if (!tool || errors.preview || errors.email || errors.displayName) return;
    updateTool(tool.id, {
      name: name.trim() || tool.name,
      description: description.trim(),
      icon,
      cover: preview ?? undefined,
      allowRemixing: remixing,
      featuredRequest: { email: email.trim(), displayName: displayName.trim(), submittedAt: Date.now() },
    });
    onClose();
    showSnack({ icon: 'check_circle', text: 'App submitted! It is featured in your Community tab.', actions: [{ label: 'Dismiss' }] });
  };
  const field = (label: React.ReactNode, input: React.ReactNode, error?: string) => (
    <div className={cx('input-group', tried && error && 'has-error')}>
      <span className="input-label">{label}</span>
      {input}
      {tried && error ? <span className="input-error">{error}</span> : null}
    </div>
  );
  return (
    <FlowDialog open={!!entry} onClose={onClose} panelClass="flow-submit-to-gallery-dialog-panel" hostClass="ng-flow-submit-to-gallery-dialog" backdropClass="cdk-overlay-dark-backdrop" ariaLabel="Apply to be featured" maxWidth="none">
      {tool && (
        <div className="mat-mdc-dialog-content mdc-dialog__content submit-to-gallery-dialog-content">
          <div className="two-column-layout">
            <div className="left-column">
              <img className="hero-background-image" src={SUBMIT_HERO} alt="" />
              <div className="hero-spacer" />
              <div className="hero-content">
                <h2 className="hero-title">Get featured in the Google Flow Tools Gallery</h2>
                <p className="hero-subtitle">Each week tools made by the community are featured in the Flow Tools gallery. Submit yours!</p>
              </div>
              <div className="left-disclaimer">
                <p className="left-disclaimer-text">If your tool is accepted, a duplicate will be created and hosted on the gallery. You can continue updating the original, but updates will not be viewable in the gallery. Featured tools are public, including media stored or grounded within the Tool. If this Tool includes personal images, they will be shared and accessible for others to use.</p>
                <p className="left-disclaimer-text">
                  By submitting this form, you consent to your data being processed in accordance with{' '}
                  <a className="left-disclaimer-link" href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google&apos;s Privacy Policy</a>{' '}
                  and agree to be contacted with the status of your submission; please note that you will only be notified if your tool is selected. If selected, you further agree that Google may feature and promote your tool across its social media channels.
                </p>
              </div>
            </div>
            <div className="right-column">
              <div className="close-row"><FlowIconButton icon="close" label="Close dialog" onClick={onClose} /></div>
              <button
                type="button"
                className={cx('preview-area', preview && 'has-image', tried && errors.preview && 'has-error')}
                aria-label="Add or change preview image"
                onClick={() => { void pickImage().then((p) => { if (p) setPreview(p); }); }}
              >
                {preview ? <img className="preview-image" src={preview} alt="" /> : <span className="placeholder-text">{tried && errors.preview ? errors.preview : 'Add preview image'}</span>}
              </button>
              <div className="form-row">
                <button type="button" className="thumbnail-container" aria-label="Change thumbnail" onClick={() => { void pickImage().then((p) => { if (p) setIcon(p); }); }}>
                  <img className="thumbnail-image" src={icon} alt="" />
                </button>
                <div className="fields-container">
                  {field('App name', <input className="styled-input" aria-label="App name" value={name} onChange={(e) => setName(e.target.value)} />)}
                </div>
              </div>
              {field('Description', <input className="styled-input" aria-label="Description" placeholder="Describe what your app does…" value={description} onChange={(e) => setDescription(e.target.value)} />)}
              {field(<>Email <span className="required-indicator">*</span></>, <input className="styled-input" aria-label="Email" type="email" placeholder="your.email@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />, errors.email)}
              {field(<>Display name <span className="required-indicator">*</span></>, <input className="styled-input" aria-label="Display name" placeholder="Your name or handle" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />, errors.displayName)}
              <div className="toggle-row">
                <SlideToggle checked={remixing} onChange={setRemixing} label={<span className="toggle-label">Allow remixing</span>} />
              </div>
              <FlowButton variant="primary" size="medium" className="submit-button" onClick={submit}>
                <span className="submit-button-content"><MatIcon name="publish" className="flow-icon-s submit-button-icon" /><span>Submit</span></span>
              </FlowButton>
            </div>
          </div>
        </div>
      )}
    </FlowDialog>
  );
};

/* ------------------------------------------------------------------ *
 * Edit icon
 * ------------------------------------------------------------------ */

export const EditIconDialog: React.FC<{ entry: ToolEntry | null; onClose: () => void; pickImage: () => Promise<string | null> }> = ({ entry, onClose, pickImage }) => {
  const [shown, setShown] = React.useState(entry);
  if (entry && entry !== shown) setShown(entry);
  const tool = entry ?? shown;
  const [selected, setSelected] = React.useState('');
  const [custom, setCustom] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!entry) return;
    setSelected(entry.icon);
    setCustom(ICON_PRESETS.includes(entry.icon) ? null : entry.icon);
  }, [entry]);
  const save = () => {
    if (tool && selected && selected !== tool.icon) setToolIcon(tool.id, selected);
    onClose();
  };
  return (
    <FlowDialog open={!!entry} onClose={onClose} panelClass="flow-applet-icon-selector-dialog-panel" hostClass="ng-flow-applet-icon-selector-dialog" ariaLabel="Edit icon" maxWidth="none">
      {tool && (
        <>
          <div className="dialog-header">
            <h2 className="mat-mdc-dialog-title mdc-dialog__title dialog-title">Edit icon</h2>
            <FlowIconButton icon="close" label="Close dialog" tooltip={null} onClick={onClose} />
          </div>
          <div className="mat-mdc-dialog-content mdc-dialog__content dialog-body">
            <div className="preview-box"><img className="preview-image" src={selected || tool.icon} alt="" /></div>
            <div className="details-box">
              <div className="grid-container">
                <button
                  type="button"
                  className="upload-card"
                  aria-label="Upload or select image from project"
                  onClick={() => { void pickImage().then((picked) => { if (picked) { setCustom(picked); setSelected(picked); } }); }}
                >
                  <MatIcon name="add" className="upload-icon" />
                </button>
                {custom && (
                  <button type="button" className="icon-card" aria-label="Uploaded icon" onClick={() => setSelected(custom)}>
                    <img className="card-image" src={custom} alt="" />
                    {selected === custom && <div className="selection-ring" />}
                  </button>
                )}
                {ICON_PRESETS.map((src, i) => (
                  <button key={src} type="button" className="icon-card" aria-label={`Preset icon ${i + 1}`} onClick={() => setSelected(src)}>
                    <img className="card-image" src={src} alt="" loading="lazy" />
                    {selected === src && <div className="selection-ring" />}
                  </button>
                ))}
              </div>
              <div className="dialog-actions">
                <FlowButton variant="primary" className="action-button" onClick={onClose}>Cancel</FlowButton>
                <FlowButton variant="secondary" className="action-button" onClick={save}>Save</FlowButton>
              </div>
            </div>
          </div>
        </>
      )}
    </FlowDialog>
  );
};

/* ------------------------------------------------------------------ *
 * Edit description
 * ------------------------------------------------------------------ */

export const DescriptionDialog: React.FC<{ entry: ToolEntry | null; onClose: () => void }> = ({ entry, onClose }) => {
  const [text, setText] = React.useState('');
  const ref = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => {
    if (!entry) return;
    setText(entry.description);
    window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }, 0);
  }, [entry]);
  return (
    <FlowDialog
      open={!!entry}
      onClose={onClose}
      panelClass="flow-applet-description-dialog-panel"
      hostClass="ng-flow-applet-description-dialog"
      backdropClass="cdk-overlay-dark-backdrop"
      ariaLabel="App description"
      placement="top-end"
    >
      <div className="mat-mdc-dialog-title mdc-dialog__title dialog-title">App description</div>
      <div className="mat-mdc-dialog-content mdc-dialog__content dialog-content">
        <textarea ref={ref} rows={4} className="description-textarea" aria-label="App description" value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <div className="dialog-actions">
        <FlowButton variant="transparent" className="action-button" onClick={onClose}>Cancel</FlowButton>
        <FlowButton variant="secondary" className="action-button" onClick={() => { if (entry) setToolDescription(entry.id, text.trim()); onClose(); }}>Save</FlowButton>
      </div>
    </FlowDialog>
  );
};
