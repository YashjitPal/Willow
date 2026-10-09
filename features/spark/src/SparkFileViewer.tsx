import React, { useEffect, useRef, useState } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import type { SparkGeneratedFile } from './spark-types';
import { getActiveSparkStorageScope } from './spark-store';
import { readSparkWorkspaceFile } from './harness/workspace/workspace';
import './SparkFileViewer.css';

export const GEMINI_DOCS_LOGO = 'https://www.gstatic.com/images/branding/productlogos/docs_2026/v2/web-96dp/logo_docs_2026_color_2x_web_96dp.png';

/** The files the card and the viewer draw with Docs' logo; the rest get a generic glyph. */
export const usesDocsIcon = (file: SparkGeneratedFile): boolean =>
  file.mimeType.startsWith('text/')
  || file.mimeType === 'application/vnd.google-apps.document'
  || /\.(doc|docx)$/i.test(file.name);

const CODE_FILE = /\.(html?|css|s[ac]ss|less|[cm]?[jt]sx?|json|xml|svg|ya?ml|toml|py|rb|go|rs|java|kt|c|cc|cpp|h|hpp|cs|php|sh|bash|ps1|sql|vue|svelte)$/i;
const HTML_FILE = /\.html?$/i;

/** Docs' zoom list, less "Fit": the page here already fits its panel. */
const ZOOM_STEPS = [50, 75, 90, 100, 125, 150, 200] as const;

/* How long a blob the viewer hands the browser stays readable. */
const BLOB_LIFETIME_MS = 60_000;

const MISSING_RETRIES = 3;
const MISSING_RETRY_MS = 300;

type Contents = { state: 'loading' } | { state: 'ready'; text: string } | { state: 'missing' };

const escapeHtml = (text: string): string => text
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const releaseLater = (url: string) => window.setTimeout(() => URL.revokeObjectURL(url), BLOB_LIFETIME_MS);

const downloadFile = (file: SparkGeneratedFile, text: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: `${file.mimeType || 'text/plain'};charset=utf-8` }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  releaseLater(url);
};

/*
 * A page opens as itself, in a frame with no origin of its own: its scripts run, but
 * cannot reach Willow's storage. Anything else opens as its text.
 */
const openFileInNewTab = (file: SparkGeneratedFile, text: string) => {
  const blob = HTML_FILE.test(file.name)
    ? new Blob([
      `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(file.name)}</title>`
      + '<style>html,body{margin:0;height:100%}iframe{display:block;width:100%;height:100%;border:0}</style></head>'
      + `<body><iframe sandbox="allow-scripts allow-forms allow-popups allow-modals" srcdoc="${escapeHtml(text)}"></iframe></body></html>`,
    ], { type: 'text/html;charset=utf-8' })
    : new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  releaseLater(url);
};

const printFile = (file: SparkGeneratedFile, text: string, isCode: boolean) => {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;';
  document.body.appendChild(frame);
  const view = frame.contentWindow;
  const doc = frame.contentDocument;
  if (!view || !doc) {
    frame.remove();
    return;
  }
  const font = isCode ? '10pt/1.4 "Roboto Mono", Consolas, monospace' : '11pt/1.15 Arial, "Liberation Sans", sans-serif';
  doc.open();
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(file.name)}</title>`
    + `<style>@page{margin:1in}body{margin:0;color:#000;font:${font}}pre{margin:0;font:inherit;white-space:pre-wrap;overflow-wrap:break-word}</style>`
    + `</head><body><pre>${escapeHtml(text)}</pre></body></html>`,
  );
  doc.close();
  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    frame.remove();
  };
  view.addEventListener('afterprint', remove);
  view.focus();
  view.print();
  window.setTimeout(remove, BLOB_LIFETIME_MS);
};

/* Docs' app-bar glyph (`docs-icon-document`): an 18px blue page with three white lines. */
const ViewerIcon: React.FC<{ file: SparkGeneratedFile }> = ({ file }) => (
  <span className={`spark-file-viewer__icon${usesDocsIcon(file) ? '' : ' is-generic'}`} aria-hidden="true">
    <MaterialSymbol family="material-rounded" name={usesDocsIcon(file) ? 'article' : 'draft'} size={24} weight={400} fill />
  </span>
);

/** Docs' zoom combobox: the level, and the list it opens. */
const ZoomControl: React.FC<{ zoom: number; onZoom: (zoom: number) => void }> = ({ zoom, onZoom }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);
  return (
    <div ref={rootRef} className="spark-file-viewer__zoom-root">
      <button
        type="button"
        className="spark-file-viewer__zoom"
        aria-label={`Zoom, ${zoom}%`}
        title={open ? undefined : 'Zoom'}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="spark-file-viewer__zoom-value">{zoom}%</span>
        <MaterialSymbol family="material-rounded" name="arrow_drop_down" size={18} weight={400} fill />
      </button>
      {open && (
        <div className="spark-file-viewer__zoom-menu" role="listbox" aria-label="Zoom">
          {ZOOM_STEPS.map((step) => (
            <button
              key={step}
              type="button"
              role="option"
              aria-selected={step === zoom}
              className="spark-file-viewer__zoom-option"
              onClick={() => {
                onZoom(step);
                setOpen(false);
              }}
            >
              {step === zoom && (
                <MaterialSymbol family="material-rounded" name="check" size={18} weight={400} className="spark-file-viewer__zoom-check" />
              )}
              {step}%
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * A file a Spark run created, as Gemini's side panel shows one: the Google Docs embed
 * filling the card — its header and toolbar over a white page holding the file's text.
 * Willow's files are plain text in the browser's own storage rather than Docs in Drive,
 * so the page is read-only and the chrome keeps what that can do: Download (where Docs
 * has Share), Open in new tab, Close, Print and Zoom.
 *
 * `compact` is Gemini's phone and tablet embed: the page alone, in the full-screen
 * overlay whose bar holds the close button.
 *
 * Gemini's card stays empty while the embed loads, which is also while it grows in.
 * The page here waits out the same motion (`revealDelayMs`), so its text is not laid
 * out again at every width the card passes through.
 */
export const SparkFileViewer: React.FC<{
  file: SparkGeneratedFile;
  onClose: () => void;
  compact?: boolean;
  revealDelayMs?: number;
  /** Changes when the file may have changed under the viewer: the task's run moved on. */
  refreshKey?: string;
}> = ({ file, onClose, compact = false, revealDelayMs = 0, refreshKey }) => {
  const [contents, setContents] = useState<Contents>({ state: 'loading' });
  const [zoom, setZoom] = useState(100);
  // Without motion there is no growth to wait out.
  const [revealed, setRevealed] = useState(() => revealDelayMs <= 0
    || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true);
  const isCode = CODE_FILE.test(file.name);

  useEffect(() => {
    if (revealed) return undefined;
    const timer = window.setTimeout(() => setRevealed(true), revealDelayMs);
    return () => window.clearTimeout(timer);
  }, [revealed, revealDelayMs]);

  // Another file starts from nothing; the same one keeps its text until the new read lands.
  // A run reports a file a moment before its write to OPFS lands, so a miss is retried
  // before it is believed.
  const pathRef = useRef(file.path);
  useEffect(() => {
    let live = true;
    let timer: number | undefined;
    if (pathRef.current !== file.path) {
      pathRef.current = file.path;
      setContents({ state: 'loading' });
    }
    const attempt = (left: number) => {
      void readSparkWorkspaceFile(getActiveSparkStorageScope(), file.path).then((text) => {
        if (!live) return;
        if (text !== null) setContents({ state: 'ready', text });
        else if (left > 0) timer = window.setTimeout(() => attempt(left - 1), MISSING_RETRY_MS);
        else setContents({ state: 'missing' });
      });
    };
    attempt(MISSING_RETRIES);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [file.path, refreshKey]);

  if (!revealed) return null;
  const text = contents.state === 'ready' ? contents.text : null;

  return (
    <div
      className={`spark-file-viewer${compact ? ' is-compact' : ''}`}
      onKeyDown={(event) => {
        if (compact || event.key !== 'Escape' || !event.shiftKey) return;
        event.preventDefault();
        onClose();
      }}
    >
      {!compact && (
        <>
          <header className="spark-file-viewer__appbar">
            <ViewerIcon file={file} />
            <h2 className="spark-file-viewer__title" title={file.name}>{file.name}</h2>
            <div className="spark-file-viewer__actions">
              <button
                type="button"
                className="spark-file-viewer__primary"
                disabled={text === null}
                onClick={() => text !== null && downloadFile(file, text)}
              >
                Download
              </button>
              <button
                type="button"
                className="spark-file-viewer__icon-button"
                aria-label="Open in new tab"
                title="Open in new tab"
                disabled={text === null}
                onClick={() => text !== null && openFileInNewTab(file, text)}
              >
                <MaterialSymbol family="material-rounded" name="open_in_new" size={24} weight={400} />
              </button>
              <button
                type="button"
                className="spark-file-viewer__icon-button"
                aria-label="Close"
                title="Close (Shift+Esc)"
                onClick={onClose}
              >
                <MaterialSymbol family="material-rounded" name="close" size={24} weight={400} />
              </button>
            </div>
          </header>
          <div className="spark-file-viewer__toolbar" role="toolbar" aria-label="File">
            <button
              type="button"
              className="spark-file-viewer__tool"
              aria-label="Print"
              title="Print (Ctrl+P)"
              disabled={text === null}
              onClick={() => text !== null && printFile(file, text, isCode)}
            >
              <MaterialSymbol family="material-rounded" name="print" size={20} weight={400} />
            </button>
            <ZoomControl zoom={zoom} onZoom={setZoom} />
          </div>
        </>
      )}
      <div
        className="spark-file-viewer__scroll"
        role="document"
        aria-label={file.name}
        aria-busy={contents.state === 'loading'}
        tabIndex={0}
      >
        <div
          className={`spark-file-viewer__page${isCode ? ' is-code' : ''}`}
          style={zoom === 100 ? undefined : { zoom: zoom / 100 }}
        >
          {contents.state === 'ready' && <pre className="spark-file-viewer__text">{contents.text}</pre>}
          {contents.state === 'missing' && (
            <p className="spark-file-viewer__missing">
              This file isn&apos;t in this browser. Willow keeps the files a task makes in the browser it ran in.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
