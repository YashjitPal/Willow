/**
 * Shared Canvas chrome — the parts the full-screen panel and the inline thread card
 * both render.
 *
 * ## Where the numbers come from
 *
 * Gemini's Canvas, re-measured over CDP in October 2026 (1536x826 / DPR 1.25, plus
 * 390x844 and 800x1280 under device emulation). The values live in `canvas.css`
 * beside the measurement that justifies each one, because the capture tree
 * (`tools/ui-research/captures/gemini/canvas-2026/`) is gitignored.
 *
 * ## Icon faces
 *
 * Each icon names the face Gemini draws it from: Luminous Symbols (`luminous`) for
 * undo/redo, chevrons, share_2, expand/collapse_content, close, docs, article and
 * arrow_upward; Google Symbols for cloud_done, file_export, share, description,
 * arrow_drop_down, more_vert, the format_* set, function(s), check, terminal,
 * drag_indicator, button_magic and ink_selection. Both are SUBSET faces declared in
 * apps/studio/index.html, and a ligature a face lacks renders as its own name in
 * words — the Google Symbols subset was regenerated to add the ones this needed.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import {
  copyToClipboard,
  downloadText,
  highlightedCode,
} from '@willow/ui/StreamingMarkdown';
import { useInjectStyles } from '@willow/ui/streaming-markdown-styles';
import { showCopyToast } from '@willow/ui/copy-toast-store';
import { tokenSource } from '@willow/personal';
import { codeExtension, isPreviewable, type CanvasDoc } from './canvas-store';
import { CANVAS_BLOCK_LABELS, type CanvasBlockKind } from './canvas-markdown';
import './canvas.css';

export type CanvasTab = 'code' | 'preview';

export type CanvasIconFamily = 'material-rounded' | 'luminous' | 'google-symbols';

/**
 * `c_<hash>_<name>.<ext>` -> `<name>.<ext>`.
 *
 * The filename half of the document id is what Download and Export name the file,
 * which is the whole reason `canvasDocId` builds one instead of using a bare hash.
 */
export const canvasFileName = (doc: CanvasDoc): string => {
  const match = /^c_[0-9a-f]+_(.+\..+)$/.exec(doc.docId);
  if (match) return match[1];
  const ext = doc.kind === 'code' ? codeExtension(doc.language) : 'md';
  const slug = doc.title.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
  return `${slug || 'document'}.${ext}`;
};

const MIME_BY_EXTENSION: Record<string, string> = {
  md: 'text/markdown;charset=utf-8',
  html: 'text/html;charset=utf-8',
  htm: 'text/html;charset=utf-8',
  css: 'text/css;charset=utf-8',
  js: 'text/javascript;charset=utf-8',
  json: 'application/json;charset=utf-8',
};

export const downloadCanvas = (doc: CanvasDoc, content: string): void => {
  const name = canvasFileName(doc);
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  downloadText(name, content, MIME_BY_EXTENSION[extension] ?? 'text/plain;charset=utf-8');
};

export const copyCanvas = async (content: string): Promise<void> => {
  await copyToClipboard(content);
  // Same feedback as copying a response: the bottom-left snackbar, no tick swap.
  showCopyToast('Copied to clipboard');
};

const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/**
 * "Export to Docs": the document as a new Google Doc in the user's Drive.
 *
 * Drive converts an uploaded `text/markdown` body into a Doc when the metadata asks
 * for the Docs MIME type, so headings, lists and emphasis arrive as Docs formatting
 * rather than as asterisks. `drive.file` is enough — it grants access only to files
 * Willow creates — and the token comes from the same Google token source the
 * Connected Apps use, so the consent popup is Google's own and only ever opens from
 * this press.
 *
 * The new tab is opened after the upload, which is no longer inside the gesture once
 * a consent popup has been shown; when the browser blocks it the snackbar carries an
 * Open button instead, which is a gesture of its own.
 */
export const exportCanvasToDocs = async (doc: CanvasDoc, content: string): Promise<void> => {
  try {
    const source = tokenSource('google');
    const token = (await source.get([DRIVE_FILE_SCOPE])) ?? (await source.request([DRIVE_FILE_SCOPE]));
    if (!token) throw new Error('Google Docs is not connected');
    const boundary = `willow-${Math.random().toString(36).slice(2)}`;
    const metadata = { name: doc.title || 'Untitled document', mimeType: 'application/vnd.google-apps.document' };
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      'Content-Type: text/markdown; charset=UTF-8',
      '',
      content,
      `--${boundary}--`,
      '',
    ].join('\r\n');
    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    if (response.status === 401) source.invalidate([DRIVE_FILE_SCOPE]);
    if (!response.ok) throw new Error(`Drive answered ${response.status}`);
    const file = (await response.json()) as { id: string; webViewLink?: string };
    const url = file.webViewLink || `https://docs.google.com/document/d/${file.id}/edit`;
    const opened = window.open(url, '_blank', 'noopener');
    if (!opened) showCopyToast('Exported to Docs', { label: 'Open', onClick: () => { window.open(url, '_blank', 'noopener'); } });
  } catch (error) {
    console.warn('[canvas] export to Docs failed', error);
    showCopyToast('Couldn\u2019t export to Docs');
  }
};

/**
 * The script every preview document runs FIRST, before any of the model's own.
 *
 * ## Why a preview needs a shim at all
 *
 * The frame has an OPAQUE origin, because it must (see `CANVAS_PREVIEW_SANDBOX`).
 * In an opaque origin, merely *touching* `localStorage` throws a `SecurityError` —
 * not on write, on property access — and a model asked for a game writes
 * `localStorage.getItem('highScore')` in its init path more often than not. The
 * throw aborts init, so the listeners are never attached and every button in the
 * document is inert. So storage is replaced with an in-memory stand-in when the
 * real one is unreachable. A high score does not survive a reload; the game runs.
 *
 * ## What it reports
 *
 * Uncaught errors and every `console` call are relayed to the embedder: errors are
 * logged there, and the console lines are what the code panel's Console shows (it
 * is Gemini's `console` pane, fed the only way an opaque frame allows).
 *
 * ## What it answers
 *
 * Select-and-ask draws a rectangle over the preview and asks the frame what is in
 * it; the frame replies with the elements whose boxes the rectangle covers. That is
 * what the model is told the user selected, since an opaque frame cannot be
 * screenshotted from outside.
 */
export const CANVAS_PREVIEW_SHIM = `<script>(function(){
var post=function(kind,detail,level){try{parent.postMessage({source:'willow-canvas-preview',kind:kind,detail:String(detail),level:level},'*');}catch(e){}};
var memory=function(){var m=Object.create(null);return{getItem:function(k){k=String(k);return k in m?m[k]:null;},setItem:function(k,v){m[String(k)]=String(v);},removeItem:function(k){delete m[String(k)];},clear:function(){m=Object.create(null);},key:function(i){var keys=Object.keys(m);return i<keys.length?keys[i]:null;},get length(){return Object.keys(m).length;}};};
['localStorage','sessionStorage'].forEach(function(name){var ok=false;try{var store=window[name];if(store){store.setItem('__willow_probe','1');store.removeItem('__willow_probe');ok=true;}}catch(e){}
if(!ok){try{Object.defineProperty(window,name,{configurable:true,value:memory()});post('shim',name);}catch(e){}}});
try{void document.cookie;}catch(e){try{Object.defineProperty(Document.prototype,'cookie',{configurable:true,get:function(){return '';},set:function(){}});post('shim','cookie');}catch(_){}}
var show=function(v){if(typeof v==='string')return v;try{return JSON.stringify(v);}catch(e){return String(v);}};
['log','info','warn','error','debug'].forEach(function(level){var original=console[level];console[level]=function(){try{post('console',Array.prototype.map.call(arguments,show).join(' '),level);}catch(e){}if(original)return original.apply(console,arguments);};});
window.addEventListener('error',function(event){post('error',(event.message||'Script error')+' ('+(event.filename||'inline')+':'+(event.lineno||0)+')');});
window.addEventListener('unhandledrejection',function(event){var reason=event.reason;post('error','Unhandled rejection: '+((reason&&reason.message)||reason));});
window.addEventListener('message',function(event){var data=event.data;if(!data||data.source!=='willow-canvas-host'||data.kind!=='region')return;var r=data.rect,found=[];var all=document.body?document.body.querySelectorAll('*'):[];
for(var i=0;i<all.length&&found.length<24;i++){var el=all[i],b=el.getBoundingClientRect();if(!b.width||!b.height)continue;if(b.left>=r.x-2&&b.top>=r.y-2&&b.right<=r.x+r.w+2&&b.bottom<=r.y+r.h+2){var p=el.parentElement,pb=p&&p.getBoundingClientRect();if(pb&&pb.left>=r.x-2&&pb.top>=r.y-2&&pb.right<=r.x+r.w+2&&pb.bottom<=r.y+r.h+2)continue;
var label=el.tagName.toLowerCase()+(el.id?'#'+el.id:'')+(typeof el.className==='string'&&el.className.trim()?'.'+el.className.trim().split(/\\s+/).slice(0,3).join('.'):'');var text=(el.innerText||el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,80);found.push(label+(text?' "'+text+'"':''));}}
post('region',found.join('\\n'));});
})();</script>`;

/**
 * Put the shim in front of the document's own scripts.
 *
 * A pass-through document is edited rather than rewrapped: nesting `<html>` inside
 * `<html>` makes the browser drop the inner `<head>`. The insertion point is after
 * `<head>` where there is one, and after `<html>` or at the very front where there
 * is not — all three leave the model's markup intact.
 */
const withPreviewShim = (document_: string): string => {
  const head = /<head[^>]*>/i.exec(document_);
  if (head) {
    const at = head.index + head[0].length;
    return document_.slice(0, at) + CANVAS_PREVIEW_SHIM + document_.slice(at);
  }
  const html = /<html[^>]*>/i.exec(document_);
  if (html) {
    const at = html.index + html[0].length;
    return document_.slice(0, at) + CANVAS_PREVIEW_SHIM + document_.slice(at);
  }
  return CANVAS_PREVIEW_SHIM + document_;
};

/**
 * The document the Preview tab runs.
 *
 * Anything that already declares `<html>` or a doctype is passed through untouched;
 * a bare fragment gets the minimum wrapper needed for it to lay out at all.
 */
export const canvasPreviewDocument = (content: string): string => {
  if (/<!doctype/i.test(content) || /<html[\s>]/i.test(content)) return withPreviewShim(content);
  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<style>html,body{margin:0;min-height:100%;background:#fff;',
    'font-family:"Google Sans Text",system-ui,-apple-system,sans-serif;}</style>',
    CANVAS_PREVIEW_SHIM,
    '</head><body>',
    content,
    '</body></html>',
  ].join('');
};

/**
 * The sandbox the preview iframe runs under.
 *
 * A DELIBERATE DEPARTURE from Gemini, which adds `allow-same-origin`. It can: its
 * preview is served from a per-conversation `*.scf.usercontent.goog` origin. Willow
 * renders the document with `srcDoc`, and `allow-scripts` + `allow-same-origin` on a
 * srcdoc frame resolves to *Willow's own origin* — model-authored script would then
 * read the app's `localStorage`, its IndexedDB and its auth tokens. Omitting it
 * gives the frame an opaque origin, which costs the document nothing it needs.
 */
export const CANVAS_PREVIEW_SANDBOX = [
  'allow-scripts',
  'allow-forms',
  'allow-modals',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  'allow-downloads',
  'allow-pointer-lock',
].join(' ');

/* ------------------------------------------------------------------ buttons */

/** A glyph in the face Gemini draws it from. */
export const CanvasIcon: React.FC<{
  name: string;
  family?: CanvasIconFamily;
  size?: number;
  weight?: number;
  className?: string;
}> = ({ name, family = 'google-symbols', size = 24, weight = 300, className = '' }) => (
  <MaterialSymbol
    name={name}
    family={family}
    size={size}
    weight={weight}
    roundness={100}
    opticalSize={size}
    className={`relative ${className}`}
  />
);

export type CanvasButtonSize = 24 | 36 | 40 | 56;

/** Glyph size per button size: 24 in 36 and 56, 20 in the toolbar's 40, 16 in the xsmall 24. */
const GLYPH: Record<CanvasButtonSize, number> = { 24: 16, 36: 24, 40: 20, 56: 24 };
const GLYPH_WEIGHT: Record<CanvasButtonSize, number> = { 24: 330, 36: 300, 40: 400, 56: 300 };

export const CanvasIconButton: React.FC<{
  icon: string;
  family?: CanvasIconFamily;
  /** The accessible name. Gemini shows a tooltip on only some of these — see `tooltip`. */
  label: string;
  /** The hover tooltip, when Gemini shows one (Willow's GlobalTooltips reads `title`). */
  tooltip?: string;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  size?: CanvasButtonSize;
  expanded?: boolean;
  pressed?: boolean;
  className?: string;
}> = ({ icon, family = 'google-symbols', label, tooltip, onClick, disabled, size = 36, expanded, pressed, className = '' }) => (
  <button
    type="button"
    aria-label={label}
    title={tooltip}
    aria-expanded={expanded}
    aria-pressed={pressed}
    onClick={onClick}
    disabled={disabled}
    className={`cv-icon-btn cv-icon-btn--${size} ${className}`}
  >
    <CanvasIcon name={icon} family={family} size={GLYPH[size]} weight={GLYPH_WEIGHT[size]} />
  </button>
);

/** Export / Download: 36px tonal pill, icon + label (+ the Export chevron). */
export const CanvasPill = React.forwardRef<HTMLButtonElement, {
  icon: string;
  family?: CanvasIconFamily;
  label: string;
  onClick?: () => void;
  expanded?: boolean;
  chevron?: boolean;
  disabled?: boolean;
}>(({ icon, family = 'google-symbols', label, onClick, expanded, chevron, disabled }, ref) => (
  <button
    ref={ref}
    type="button"
    aria-label={label}
    aria-haspopup={chevron ? 'menu' : undefined}
    aria-expanded={chevron ? !!expanded : undefined}
    onClick={onClick}
    disabled={disabled}
    className="cv-pill"
  >
    <CanvasIcon name={icon} family={family} size={24} />
    <span>{label}</span>
    {chevron && <CanvasIcon name="keyboard_arrow_down" family="luminous" size={24} />}
  </button>
));
CanvasPill.displayName = 'CanvasPill';

/* ------------------------------------------------------------------ menus */

/** Closes on an outside pointer-down or Escape, the two ways every menu in the shell closes. */
const useDismissable = (open: boolean, onClose: () => void) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onCloseRef.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // One Escape closes one thing: the panel's own Escape-to-collapse must not also fire.
      event.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);
  return rootRef;
};

export interface CanvasMenuItem {
  id: string;
  label: string;
  ariaLabel: string;
  icon: string;
  family?: CanvasIconFamily;
  onSelect: () => void;
}

/**
 * Export: Docs and .md, Gemini's two. The menu is a gem-menu that opens and closes
 * with no animation, 4px under the pill with the right edges aligned.
 */
export const CanvasExportMenu: React.FC<{ items: CanvasMenuItem[]; disabled?: boolean }> = ({ items, disabled }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useDismissable(open, () => setOpen(false));
  return (
    <div ref={rootRef} className="cv-anchor">
      <CanvasPill
        icon="file_export"
        label="Export"
        chevron
        expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      />
      {open && (
        <div role="menu" className="cv-gem-menu">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              aria-label={item.ariaLabel}
              className="cv-gem-menu__item"
              onClick={() => { setOpen(false); item.onSelect(); }}
            >
              <CanvasIcon name={item.icon} family={item.family} size={20} weight={320} />
              <span className="cv-gem-menu__label">{item.label}</span>
              <span className="cv-gem-menu__trailing" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/** Export and Download share one builder so the panel and the card cannot drift apart. */
export const canvasExportItems = (doc: CanvasDoc, content: string): CanvasMenuItem[] => [
  {
    id: 'docs',
    label: 'Docs',
    ariaLabel: 'Export to Docs',
    icon: 'docs',
    family: 'luminous',
    onSelect: () => { void exportCanvasToDocs(doc, content); },
  },
  {
    id: 'md',
    label: '.md',
    ariaLabel: 'Download .md',
    icon: 'description',
    family: 'google-symbols',
    onSelect: () => downloadCanvas(doc, content),
  },
];

const BLOCK_KINDS: CanvasBlockKind[] = ['p', 'h1', 'h2', 'h3'];
const MAT_MENU_EXIT_MS = 125;

/**
 * Styles: "Normal text / Heading 1 / Heading 2 / Heading 3", each item set in the
 * style it applies, the current one checked. Material's mat-menu, with its own
 * enter (scale .8 -> 1, 120ms) and exit (fade, 100ms after 25ms).
 */
export const CanvasStylesMenu: React.FC<{
  current: CanvasBlockKind;
  onSelect: (kind: CanvasBlockKind) => void;
  disabled?: boolean;
}> = ({ current, onSelect, disabled }) => {
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const close = () => {
    if (!open || leaving) return;
    setLeaving(true);
    window.setTimeout(() => { setOpen(false); setLeaving(false); }, MAT_MENU_EXIT_MS);
  };
  const rootRef = useDismissable(open && !leaving, close);
  return (
    <div ref={rootRef} className="cv-anchor">
      <button
        type="button"
        title="Styles"
        aria-label={`Styles, ${CANVAS_BLOCK_LABELS[current]}`}
        aria-haspopup="menu"
        aria-expanded={open && !leaving}
        disabled={disabled}
        className="cv-styles-btn"
        /* The editor's selection must survive the press, so the button never takes focus. */
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="cv-styles-btn__label">{CANVAS_BLOCK_LABELS[current]}</span>
        <CanvasIcon name="arrow_drop_down" size={18} weight={400} className="cv-styles-btn__icon" />
      </button>
      {open && (
        <div role="menu" className={`cv-mat-menu${leaving ? ' cv-mat-menu--leaving' : ''}`}>
          <div className="cv-mat-menu__list">
            {BLOCK_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                role="menuitemradio"
                aria-checked={kind === current}
                className="cv-mat-menu__item"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => { onSelect(kind); close(); }}
              >
                <span className={`cv-mat-menu__text cv-format-${kind}`}>{CANVAS_BLOCK_LABELS[kind]}</span>
                {kind === current && (
                  <CanvasIcon name="check" size={20} weight={400} className="cv-mat-menu__check" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/** The formatting row: Bold, Italic, the two lists, inline and block equations. */
export interface CanvasFormatActions {
  bold: () => void;
  italic: () => void;
  bulletedList: () => void;
  numberedList: () => void;
  inlineEquation: () => void;
  blockEquation: () => void;
}

const FORMAT_BUTTONS: { key: keyof CanvasFormatActions; icon: string; label: string }[] = [
  { key: 'bold', icon: 'format_bold', label: 'Bold' },
  { key: 'italic', icon: 'format_italic', label: 'Italic' },
  { key: 'bulletedList', icon: 'format_list_bulleted', label: 'Bulleted list' },
  { key: 'numberedList', icon: 'format_list_numbered', label: 'Numbered list' },
  { key: 'inlineEquation', icon: 'function', label: 'Insert Equation' },
  { key: 'blockEquation', icon: 'functions', label: 'Insert block equation' },
];

export const CanvasFormatButtons: React.FC<{ actions: CanvasFormatActions; disabled?: boolean }> = ({ actions, disabled }) => (
  <>
    {FORMAT_BUTTONS.map((button) => (
      <button
        key={button.key}
        type="button"
        aria-label={button.label}
        title={button.label}
        disabled={disabled}
        className="cv-icon-btn cv-icon-btn--40"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => actions[button.key]()}
      >
        <CanvasIcon name={button.icon} size={20} weight={400} />
      </button>
    ))}
  </>
);

/**
 * `cloud_done` · undo · redo — the versioning trio.
 *
 * 36px on an 8px gap in the card's title row (24px glyphs, cloud_done from Google
 * Symbols, the arrows from Luminous); 40px with no gap in the panel toolbar (20px
 * Google Symbols glyphs). `cloud_done` does nothing: it is the "Changes saved"
 * status, shown as a button because that is what the app shows.
 *
 * Undo/Redo are version history, NOT text editing — they step `CanvasDoc.versions`,
 * the fold of every turn that touched this document (see canvas-store.ts).
 */
export const CanvasVersionNav: React.FC<{
  versionCount: number;
  version: number;
  onVersionChange: (version: number) => void;
  variant: 'card' | 'panel';
}> = ({ versionCount, version, onVersionChange, variant }) => {
  const size: CanvasButtonSize = variant === 'card' ? 36 : 40;
  const arrows: CanvasIconFamily = variant === 'card' ? 'luminous' : 'google-symbols';
  const saved = version === versionCount - 1;
  return (
    <div className={`cv-toolbar__group${variant === 'card' ? ' gap-2' : ''}`}>
      <CanvasIconButton
        icon="cloud_done"
        label={saved ? 'Changes saved' : `Version ${version + 1} of ${versionCount}`}
        tooltip={variant === 'panel' ? (saved ? 'Changes saved' : `Version ${version + 1} of ${versionCount}`) : undefined}
        size={size}
      />
      <CanvasIconButton
        icon="undo"
        family={arrows}
        label="Previous version"
        tooltip={variant === 'panel' ? 'Previous version' : undefined}
        size={size}
        disabled={version <= 0}
        onClick={() => onVersionChange(version - 1)}
      />
      <CanvasIconButton
        icon="redo"
        family={arrows}
        label="Next version"
        tooltip={variant === 'panel' ? 'Next version' : undefined}
        size={size}
        disabled={version >= versionCount - 1}
        onClick={() => onVersionChange(version + 1)}
      />
    </div>
  );
};

/**
 * Code / Preview — Gemini's `mat-button-toggle-group` (a radiogroup labelled "Tab
 * Selection"): a 36px track, 4px in, 2px between, cells sized to their labels with
 * 12px sides. The checked cell is DARKER than the track and switches in one frame;
 * nothing slides.
 */
export const CanvasTabToggle: React.FC<{
  tab: CanvasTab;
  onChange: (tab: CanvasTab) => void;
}> = ({ tab, onChange }) => (
  <div role="radiogroup" aria-label="Tab Selection" className="cv-toggle">
    {(['code', 'preview'] as CanvasTab[]).map((value) => (
      <button
        key={value}
        type="button"
        role="radio"
        aria-checked={tab === value}
        className="cv-toggle__cell"
        onClick={() => onChange(value)}
      >
        <span>{value === 'code' ? 'Code' : 'Preview'}</span>
      </button>
    ))}
  </div>
);

/**
 * A document the user is typing into, held locally and committed on a timer.
 *
 * Two problems, one hook: the store round-trip is not per keystroke (committing on
 * every character would put a full ChatView render between the key and the glyph),
 * and the commit ECHOES BACK — `content` arrives a moment later as the value just
 * sent, and syncing on it would clobber whatever was typed in the meantime. So an
 * incoming value is only adopted when it differs from what was last sent. The
 * pending edit is flushed on unmount so closing mid-word cannot lose the word.
 */
const CANVAS_EDIT_COMMIT_MS = 400;

export const useCanvasDraft = (
  content: string,
  onChange?: (next: string) => void,
): [string, (next: string) => void] => {
  const [draft, setDraft] = useState(content);
  const sentRef = useRef(content);
  const timerRef = useRef<number | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (content === sentRef.current) return;
    sentRef.current = content;
    setDraft(content);
  }, [content]);

  const pendingRef = useRef<string | null>(null);
  const flush = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending === null || pending === sentRef.current) return;
    sentRef.current = pending;
    onChangeRef.current?.(pending);
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;

  useEffect(() => () => flushRef.current(), []);

  const edit = (next: string) => {
    setDraft(next);
    if (!onChangeRef.current) return;
    pendingRef.current = next;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => flushRef.current(), CANVAS_EDIT_COMMIT_MS);
  };

  return [draft, edit];
};

/* ------------------------------------------------------------------ code body */

/**
 * The editor's measured text metrics, shared by the `<pre>` that paints the tokens
 * and the `<textarea>` that takes the keystrokes: Monaco's 14px/19px Google Sans Code.
 *
 * ONE constant, deliberately: the transparent-textarea-over-highlighted-pre
 * technique only works while the two agree to the pixel on family, size,
 * line-height and tab width.
 */
const CANVAS_CODE_FONT_CLASS =
  "block bg-transparent font-['Google_Sans_Code',ui-monospace,SFMono-Regular,Consolas,monospace] "
  + 'text-[14px] font-normal leading-[19px] [tab-size:4]';

/**
 * A textarea whose value ends in a newline shows an empty last line and lets the
 * caret sit on it; a `<pre>` does not reliably generate that line box. A zero-width
 * space pins it without adding a visible character.
 */
const withTrailingLineBox = (value: string): string => (
  value.endsWith('\n') ? `${value}\u200b` : value
);

/**
 * Monaco's bracket-pair colours over hljs output: `(`, `[` and `{` take the colour
 * of their depth (gold, orchid, blue, repeating) and their partner matches. Brackets
 * inside strings, comments and markup tags are text, and stay uncoloured.
 */
export const colorBrackets = (html: string): string => {
  let depth = 0;
  let skip = 0;
  const spans: boolean[] = [];
  return html.replace(/<span class="([^"]*)">|<\/span>|([()[\]{}])/g, (match, cls: string | undefined, bracket: string | undefined) => {
    if (cls !== undefined) {
      const text = /\bhljs-(string|comment|regexp|meta|tag|attr|template-tag)\b/.test(cls);
      spans.push(text);
      if (text) skip += 1;
      return match;
    }
    if (match === '</span>') {
      if (spans.pop()) skip -= 1;
      return match;
    }
    if (skip > 0 || !bracket) return match;
    if (bracket === '(' || bracket === '[' || bracket === '{') {
      const colored = `<span class="cv-bracket-${depth % 3}">${bracket}</span>`;
      depth += 1;
      return colored;
    }
    depth = Math.max(0, depth - 1);
    return `<span class="cv-bracket-${depth % 3}">${bracket}</span>`;
  });
};

export interface CanvasConsoleLine {
  id: number;
  level: string;
  text: string;
}

/**
 * Code body: the editor and the preview as SIBLINGS, switched by a `hidden` class.
 *
 * Gemini's `div.container` holds `web-preview`, `xap-code-editor` and `console` at
 * once and toggles `.hidden` between them, so a running app SURVIVES a trip to the
 * Code tab — the iframe is never torn down and never re-executes. `display: none`
 * is safe for that: unlike moving an iframe in the DOM, hiding it does not reload
 * its document.
 *
 * Editor geometry: Monaco at a 48px inset each side, first line 48px down, 14px/19px
 * Google Sans Code on rgb(20,20,20), no line numbers. Willow runs no Monaco: with
 * `onContentChange` the body is a transparent `<textarea>` exactly on top of the
 * highlighted `<pre>`, so selection, undo and IME are the browser's own.
 */
export const CanvasCodeView: React.FC<{
  doc: CanvasDoc;
  content: string;
  tab: CanvasTab;
  /** 48 in the panel, 0 in the card. */
  inset?: number;
  /** Hold the iframe out of the DOM until the container has finished animating. */
  previewMounted?: boolean;
  /** Absent = read-only. Called on a debounce, not per keystroke. */
  onContentChange?: (next: string) => void;
  /** Every `console.*` line the running document writes. */
  onConsole?: (line: Omit<CanvasConsoleLine, 'id'>) => void;
  /** The frame, for select-and-ask's region query. */
  frameRef?: React.MutableRefObject<HTMLIFrameElement | null>;
  /** Drawn over the running preview (select-and-ask, the floating tools). */
  overlay?: React.ReactNode;
}> = ({ doc, content, tab, inset = 48, previewMounted = true, onContentChange, onConsole, frameRef: externalFrameRef, overlay }) => {
  useInjectStyles();
  const previewable = isPreviewable(doc);
  /*
   * `wantPreview` is the TAB; `showPreview` is the tab and a frame to show for it.
   * The gap between them is the panel's 500ms scale, and the code body stays hidden
   * through it — "the codebase appears in the place of the preview… before the
   * flash" was worse than a moment of the shell's own dark fill.
   */
  const wantPreview = previewable && tab === 'preview';
  const showPreview = wantPreview && previewMounted;
  /*
   * The white flash: a sub-frame paints white as soon as it has a box, before the
   * document's own background is parsed. So the frame is transparent until `load`.
   * A ONE-WAY LATCH, never reset — `srcDoc` changes on every committed edit.
   */
  const [previewPainted, setPreviewPainted] = useState(false);
  useEffect(() => {
    if (!showPreview || previewPainted) return;
    const timer = window.setTimeout(() => setPreviewPainted(true), 400);
    return () => window.clearTimeout(timer);
  }, [showPreview, previewPainted]);
  const [draft, setDraft] = useCanvasDraft(content, onContentChange);
  const editable = !!onContentChange;
  const source = editable ? withTrailingLineBox(draft) : content;
  const html = useMemo(
    () => (source.length > 200_000
      ? highlightedCode(source, 'text')
      : colorBrackets(highlightedCode(source, doc.language || 'html'))),
    [source, doc.language],
  );
  const previewSource = useMemo(
    () => (previewable ? canvasPreviewDocument(editable ? draft : content) : ''),
    [previewable, editable, draft, content],
  );

  /*
   * What the shim relays. `event.origin` is "null" for an opaque frame and cannot be
   * checked, so the frame's own `contentWindow` is the identity test — otherwise any
   * page in any tab could write into this console.
   */
  const ownFrameRef = useRef<HTMLIFrameElement | null>(null);
  const onConsoleRef = useRef(onConsole);
  onConsoleRef.current = onConsole;
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = ownFrameRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      const data = event.data;
      if (!data || data.source !== 'willow-canvas-preview') return;
      if (data.kind === 'error') {
        console.warn(`[canvas preview] ${doc.title}: ${data.detail}`);
        onConsoleRef.current?.({ level: 'error', text: String(data.detail) });
      } else if (data.kind === 'console') {
        onConsoleRef.current?.({ level: String(data.level || 'log'), text: String(data.detail) });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [doc.title]);

  /*
   * Inset > 0 is the panel: Monaco's box sits `inset` in from each side of the body
   * (`.xap-monaco-container` is padded 0 48px), dark only inside it, with the panel's
   * own surface in the margins, and its first line `inset` down. Inset 0 is the card,
   * edge to edge.
   */
  const pad = inset > 0 ? `${inset}px 0` : 0;
  return (
    <div className={`relative flex min-h-0 flex-1 flex-col ${inset > 0 ? '' : 'bg-[rgb(20,20,20)]'}`}>
      {previewable && previewMounted && (
        <iframe
          ref={(node) => {
            ownFrameRef.current = node;
            if (externalFrameRef) externalFrameRef.current = node;
          }}
          /* `aria-label`, NOT `title`: an iframe's title doubles as a native tooltip,
             so hovering anywhere in a running preview popped up the document's name. */
          aria-label={`${doc.title} preview`}
          /* No background of its own: a sub-frame rasterises on whole device pixels,
             and the element's background would paint in the sub-pixel seam the
             bleeding card leaves — a white hairline down the preview's left edge. */
          className={
            showPreview
              ? `h-full w-full border-0 transition-opacity duration-200 ${
                previewPainted ? 'opacity-100' : 'opacity-0'
              }`
              : 'hidden'
          }
          onLoad={() => setPreviewPainted(true)}
          sandbox={CANVAS_PREVIEW_SANDBOX}
          referrerPolicy="no-referrer"
          srcDoc={previewSource}
        />
      )}
      {showPreview && overlay}
      {/* `.cv-code-tokens` is the Monaco palette and nothing else — the scroller owns
          its own overflow in both axes. */}
      <div
        className={
          wantPreview
            ? 'hidden'
            : 'cv-code-tokens gemini-chat-scrollbar min-h-0 flex-1 overflow-auto overscroll-contain bg-[rgb(20,20,20)]'
        }
        style={wantPreview || inset === 0 ? undefined : { marginLeft: inset, marginRight: inset }}
      >
        <div className={`relative ${editable ? 'w-max min-w-full' : ''}`}>
          <pre
            className="m-0 w-max min-w-full bg-transparent"
            style={{ padding: pad }}
            aria-hidden={editable || undefined}
          >
            <code
              className={`hljs ${CANVAS_CODE_FONT_CLASS} text-white`}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </pre>
          {editable && (
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              spellCheck={false}
              wrap="off"
              aria-label={`Edit ${doc.title}`}
              className={
                'absolute inset-0 resize-none overflow-hidden whitespace-pre border-0 outline-none '
                + 'text-transparent caret-white selection:bg-[rgba(255,255,255,0.22)] '
                + CANVAS_CODE_FONT_CLASS
              }
              style={{ padding: pad }}
            />
          )}
        </div>
      </div>
    </div>
  );
};
